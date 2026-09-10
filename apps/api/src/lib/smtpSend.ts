// ═══ Shared "send through the stored SMTP integration" ═══
//
// Extracted from email.sendReport so meeting minutes and reports go out through
// exactly the same path — a second copy of this would drift the moment either
// side learns something new about SMTP config.
//
// The saved Integration row holds the credentials (encrypted); the caller only
// supplies the message.
import { prisma } from '@tomilite/database';
import { sendSMTP } from '@tomilite/email';
import { decrypt } from './crypto';

export interface StoredSmtpMessage {
  to: string;
  cc?: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
}

export type StoredSmtpResult =
  { ok: true } | { ok: false; error: string; code?: 'smtp_not_configured' | 'smtp_incomplete' | 'send_failed' };

export async function sendWithStoredSmtp(msg: StoredSmtpMessage): Promise<StoredSmtpResult> {
  const smtp = await prisma.integration.findFirst({ where: { type: 'smtp', enabled: true } });
  // Distinct code so the UI can offer "go configure SMTP" instead of showing a
  // dead-end error.
  if (!smtp) return { ok: false, error: 'No SMTP config found', code: 'smtp_not_configured' };

  const cfg = JSON.parse(smtp.config);
  if (!cfg.host || !cfg.port || !cfg.user) {
    return {
      ok: false,
      error: `SMTP config incomplete: host=${cfg.host}, port=${cfg.port}, user=${cfg.user}`,
      code: 'smtp_incomplete',
    };
  }

  if (cfg.pass) cfg.pass = await decrypt(cfg.pass);
  if (cfg.password) cfg.password = await decrypt(cfg.password);
  const pass = cfg.pass || cfg.password || '';
  if (!pass) return { ok: false, error: 'SMTP password not configured', code: 'smtp_incomplete' };

  // The settings form stores the TLS choice as `starttls`; port 587 implies it.
  const tls = cfg.starttls !== undefined ? cfg.starttls : cfg.port === 587;
  const fromName = cfg.fromName || '';
  const from = fromName ? `${fromName} <${cfg.user}>` : cfg.user;

  try {
    await sendSMTP({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: pass,
      tls,
      from,
      to: msg.to + (msg.cc ? ', ' + msg.cc : ''),
      subject: msg.subject,
      html: msg.html,
      attachments: msg.attachments || [],
      rejectUnauthorized: false,
    });
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), code: 'send_failed' };
  }
}

/** Whether an outbound SMTP account is configured at all (for UI affordances). */
export async function smtpConfigured(): Promise<boolean> {
  try {
    const smtp = await prisma.integration.findFirst({ where: { type: 'smtp', enabled: true } });
    if (!smtp) return false;
    const cfg = JSON.parse(smtp.config);
    return !!(cfg.host && cfg.port && cfg.user);
  } catch {
    return false;
  }
}
