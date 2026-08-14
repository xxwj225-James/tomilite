import { prisma } from '@tomatolite/database';
import { executeEmailTool } from '../../routers/emailTools.js';

/** List unprocessed emails (smart inbox) */
export async function listEmails(args: Record<string, any>): Promise<any> {
  const where: any = { isProcessed: false };
  if (args.category) where.category = args.category;
  return prisma.smartEmail.findMany({ where, take: args.limit || 10, orderBy: { createdAt: 'desc' }, select: { id: true, subject: true, fromAddr: true, category: true, summary: true, replyDraft: true, date: true } });
}

/** Edit reply draft for an email */
export async function editEmailReply(args: Record<string, any>): Promise<any> {
  const updated = await prisma.smartEmail.update({ where: { id: args.emailId }, data: { replyDraft: args.replyText } });
  return { ok: true, emailId: args.emailId, staged: true, type: 'email_reply', original: updated.replyDraft };
}

/** Send email reply via SMTP */
export async function sendEmailReply(args: Record<string, any>): Promise<any> {
  const email = await prisma.smartEmail.findUnique({ where: { id: args.emailId } });
  if (!email) return { ok: false, error: 'Email not found' };
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await prisma.smartEmail.update({ where: { id: args.emailId }, data: { isProcessed: true, isReplied: true, processedAt: now } });
  const smtp = await executeEmailTool('send_email', { to: email.fromAddr, subject: 'Re: ' + email.subject, body: args.body || email.replyDraft });
  return smtp;
}

/** Read original email body (full text from IMAP when available) */
export async function readEmailOriginal(args: Record<string, any>): Promise<any> {
  const email = await prisma.smartEmail.findUnique({ where: { id: args.emailId }, select: { id: true, subject: true, bodySnapshot: true, uid: true } });
  if (!email) return { error: 'Email not found' };
  // Try fetching full body from IMAP
  try {
    const integration = await prisma.integration.findFirst({ where: { type: 'imap', enabled: true } });
    if (integration) {
      const { emailManager } = await import('@tomatolite/email');
      const connector = emailManager.getConnector?.(integration.id);
      if (connector?.fetchFullMessage) {
        try {
          const full = await connector.fetchFullMessage(email.uid);
          return { subject: email.subject, body: full.text || full.html || email.bodySnapshot || '' };
        } catch { /* fallback to bodySnapshot */ }
      }
    }
  } catch { /* fallback */ }
  return { subject: email.subject, body: email.bodySnapshot || '(No body stored)' };
}

/** Dismiss email (mark processed, no reply) */
export async function dismissEmail(args: Record<string, any>): Promise<any> {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await prisma.smartEmail.update({ where: { id: args.emailId }, data: { isProcessed: true, processedAt: now } });
  const email = await prisma.smartEmail.findUnique({ where: { id: args.emailId }, select: { issueId: true } });
  if (email?.issueId) await prisma.issue.update({ where: { id: email.issueId }, data: { status: 'done', updatedAt: now } });
  return { ok: true, dismissed: true };
}

/** Delete email from local DB only */
export async function deleteEmail(args: Record<string, any>): Promise<any> {
  await prisma.smartEmail.delete({ where: { id: args.emailId } });
  return { ok: true, deleted: true, warning: 'Deleted from local DB only. Original email on server is untouched.' };
}
