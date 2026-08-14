import { createIMAPConnector } from './imap.js';
import type { EmailConnector, NormalizedMessage } from './types.js';

export interface IMAPConfigRaw {
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
 * EmailManager — manages IMAP/Gmail connectors lifecycle
 * Accepts pre-decrypted configs from the API layer
 */
export class EmailManager {
  private connectors = new Map<string, EmailConnector>();
  private _starting = new Set<string>(); // F1: prevent concurrent startIMAP same-id calls
  private messageHandler: ((msg: NormalizedMessage) => Promise<void>) | null = null;

  /** Set the handler for all incoming messages */
  onMessage(handler: (msg: NormalizedMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /** Start a single IMAP connector with pre-decrypted config */
  async startIMAP(id: string, config: IMAPConfigRaw): Promise<void> {
    // F1: guard against concurrent calls with same id (would orphan connector)
    if (this._starting.has(id)) {
      console.log(`[EmailManager] startIMAP skipped for ${id}: already starting`);
      return;
    }
    this._starting.add(id);

    try {
      if (this.connectors.has(id)) {
        await this.stopOne(id);
        // Small delay to let IMAP server clean up before reconnecting
        await new Promise(r => setTimeout(r, 500));
      }

      const connector = createIMAPConnector({
        host: config.host,
        port: config.port ?? 993,
        user: config.user,
        password: config.password,
        tls: config.tls ?? true,
        mailbox: config.mailbox ?? 'INBOX',
        pollIntervalSeconds: config.pollIntervalSeconds ?? 60,
        smtp: config.smtp,
      });

      if (this.messageHandler) {
        connector.onNewMessage(this.messageHandler);
      }

      await connector.startWatching();
      this.connectors.set(id, connector);
      console.log(`[EmailManager] IMAP started: ${config.user}@${config.host}`);
    } catch (err) {
      // F2: if start fails after stopOne already removed old connector,
      // the id would be orphaned — log and re-throw so caller can report
      console.error(`[EmailManager] startIMAP failed for ${id}:`, (err as Error).message);
      throw err;
    } finally {
      this._starting.delete(id);
    }
  }

  /** Stop a single connector */
  async stopOne(id: string): Promise<void> {
    const connector = this.connectors.get(id);
    if (connector) {
      try {
        await connector.stopWatching();
      } finally {
        // Always remove from map even if stopWatching throws,
        // so stale connectors don't block future reconnects
        this.connectors.delete(id);
      }
    }
  }

  /** Stop all connectors */
  async stopAll(): Promise<void> {
    for (const [id, connector] of this.connectors) {
      try { await connector.stopWatching(); } catch (err) {
        console.error(`[EmailManager] Failed to stop ${id}:`, (err as Error).message);
      }
    }
    this.connectors.clear();
  }

  isActive(): boolean {
    return this.connectors.size > 0;
  }

  getConnector(id: string): EmailConnector | undefined {
    return this.connectors.get(id);
  }

  getStatus(): Record<string, { connected: boolean; messagesProcessed: number }> {
    const status: Record<string, any> = {};
    for (const [id, connector] of this.connectors) {
      status[id] = connector.getStatus();
    }
    return status;
  }
}

export const emailManager = new EmailManager();
