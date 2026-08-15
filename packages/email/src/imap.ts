import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { EmailConnector, EmailConnectorStatus, SendEmailParams, NormalizedMessage } from './types.js';

export interface IMAPConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  tls?: boolean;
  mailbox?: string;
  pollIntervalSeconds?: number;
  smtp?: {
    host: string;
    port: number;
    user: string;
    password: string;
    tls?: boolean;
  };
}

/**
 * IMAP connector — supports 163/QQ/126/custom mail
 * Polling mode: checks for new mail every N seconds
 */
export class IMAPConnector implements EmailConnector {
  private config: Required<IMAPConfig>;
  private client: ImapFlow | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private handlers: Array<(msg: NormalizedMessage) => Promise<void>> = [];
  private status: EmailConnectorStatus = { connected: false, messagesProcessed: 0 };
  private lastCheckUid = 0;

  constructor(config: IMAPConfig) {
    this.config = {
      host: config.host,
      port: config.port ?? 993,
      user: config.user,
      password: config.password,
      tls: config.tls ?? true,
      mailbox: config.mailbox ?? 'INBOX',
      pollIntervalSeconds: config.pollIntervalSeconds ?? 60,
      smtp: config.smtp as any ?? undefined,
    };
  }

  async startWatching(): Promise<void> {
    this.client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.tls,
      auth: { user: this.config.user, pass: this.config.password },
      logger: false,
    });

    await this.client.connect();
    this.status.connected = true;
    console.warn(`[IMAP] Connected to ${this.config.host}:${this.config.port}`);

    const mailbox = await this.client.mailboxOpen(this.config.mailbox);
    console.warn(`[IMAP] Mailbox "${this.config.mailbox}": ${mailbox.exists} messages`);

    // Record the highest UID to start polling from (don't process old messages)
    if (mailbox.exists > 0) {
      const lastMsg = await this.client.fetchOne(`${mailbox.exists}`, { uid: true });
      this.lastCheckUid = lastMsg ? lastMsg.uid : 0;
      console.warn(`[IMAP] Initialized: ${mailbox.exists} msgs, last UID: ${this.lastCheckUid}`);
    }

    this.startPolling();
  }

  async stopWatching(): Promise<void> {
    if (this.pollingTimer) { clearInterval(this.pollingTimer); this.pollingTimer = null; }
    if (this.client) { await this.client.logout(); this.client = null; }
    this.status.connected = false;
  }

  async fetchMessage(uid: number): Promise<NormalizedMessage> {
    if (!this.client) throw new Error('Not connected');
    const msg = await this.client.fetchOne(String(uid), { source: true, uid: true });
    if (!msg || !msg.source) throw new Error(`Message uid=${uid} not found`);
    return this.parseMessage(msg.source, msg.uid);
  }

  /** Phase 2: fetch full email body on user demand (by UID — O(1) IMAP FETCH) */
  async fetchFullMessage(uid: number): Promise<{ html: string; text: string }> {
    if (!this.client) throw new Error('Not connected');
    // IMAP UID fetch — use fetch() with uid range, not fetchOne() (which uses seq by default)
    const msgs = await this.client.fetch({ uid: `${uid}` }, { source: true, uid: true });
    const msg = Array.isArray(msgs) ? msgs[0] : msgs;
    if (!msg || !msg.source) throw new Error(`Message uid=${uid} not found`);
    const parsed = await simpleParser(msg.source);
    return {
      html: (parsed.html as string) || '',
      text: (parsed.text as string) || '',
    };
  }

  async sendEmail(_params: SendEmailParams): Promise<string> {
    throw new Error('SMTP send via IMAP connector not yet implemented. Use the dedicated SMTP client.');
  }

  onNewMessage(handler: (message: NormalizedMessage) => Promise<void>): void {
    this.handlers.push(handler);
  }

  getStatus(): EmailConnectorStatus {
    return { ...this.status };
  }

  // ── Private ──

  private async fetchBySeq(seq: number): Promise<NormalizedMessage | null> {
    if (!this.client) return null;
    const msg = await this.client.fetchOne(seq, { source: true, uid: true });
    if (!msg || !msg.source) return null;
    return this.parseMessage(msg.source, msg.uid);
  }

  private async parseMessage(source: Buffer, uid: number | undefined): Promise<NormalizedMessage> {
    const parsed = await simpleParser(source);
    return {
      externalId: String(uid ?? ''),
      uid: uid,
      source: 'IMAP_EMAIL',
      from: (Array.isArray(parsed.from) ? parsed.from[0]?.text : parsed.from?.text) ?? '',
      to: (Array.isArray(parsed.to) ? parsed.to[0]?.text : parsed.to?.text) ?? '',
      cc: (Array.isArray(parsed.cc) ? parsed.cc.map((c: any) => c.text).join(', ') : (parsed.cc as any)?.text) || undefined,
      subject: parsed.subject ?? '(无主题)',
      body: (parsed.text as string) || (parsed.html as string) || '',
      threadId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      attachments: parsed.attachments?.map((a: any) => ({
        filename: a.filename ?? 'attachment',
        mimeType: a.contentType,
        sizeBytes: a.size,
      })),
      rawData: parsed as any,
      receivedAt: parsed.date ?? new Date(),
    };
  }

  private async notifyHandlers(msg: NormalizedMessage): Promise<void> {
    for (const handler of this.handlers) {
      try { await handler(msg); } catch (err) {
        console.error('[IMAP] Handler error:', (err as Error).message);
      }
    }
  }

  private startPolling(): void {
    // Clear any existing timer before starting a new one
    if (this.pollingTimer) { clearInterval(this.pollingTimer); this.pollingTimer = null; }
    const interval = this.config.pollIntervalSeconds * 1000;
    this.pollingTimer = setInterval(async () => {
      try {
        if (!this.client || !this.status.connected) {
          console.warn('[IMAP] Reconnecting...');
          await this.startWatching();
          return;
        }
        this.status.lastError = '';
        await this.checkNewMessages();
        this.status.lastCheckAt = new Date();
      } catch (err) {
        const msg = (err as Error).message;
        this.status.lastError = msg;
        console.error('[IMAP] Poll error:', msg);
        this.status.connected = false;
      }
    }, interval);
    console.warn(`[IMAP] Polling every ${this.config.pollIntervalSeconds}s`);
    this.status.polling = true;
  }

  private async checkNewMessages(): Promise<void> {
    if (!this.client) return;
    // 1) Search UNSEEN to catch any missed by UID tracking
    try {
      const unseen = await (this.client as any).search({ unseen: true });
      if (unseen && unseen.length > 0) {
        for (const seq of unseen) {
          try {
            const n = await this.fetchBySeq(typeof seq === 'number' ? seq : (seq as any).seq);
            if (n) { await this.notifyHandlers(n); this.status.messagesProcessed++; }
          } catch {}
        }
      }
    } catch {}
    // 2) UID range for new messages since last check
    const uidRange = `${this.lastCheckUid + 1}:*`;
    const newMsgs = await this.client.fetch({ uid: uidRange }, { uid: true, flags: true });
    if (!newMsgs) return;
    const msgs = Array.isArray(newMsgs) ? newMsgs : [newMsgs];
    let maxUid = this.lastCheckUid;
    for (const msg of msgs) {
      try {
        const normalized = await this.fetchBySeq(msg.seq);
        if (!normalized) continue;
        if (msg.uid > maxUid) maxUid = msg.uid;
        await this.notifyHandlers(normalized);
        this.status.messagesProcessed++;
      } catch (err) {
        console.error('[IMAP] Parse error:', (err as Error).message);
      }
    }
    this.lastCheckUid = Math.max(this.lastCheckUid, maxUid);
  }
}

export function createIMAPConnector(config: IMAPConfig): IMAPConnector {
  return new IMAPConnector(config);
}
