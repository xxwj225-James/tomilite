import { prisma } from '@tomatolite/database';

export const emailToolDefs = [
  {
    type: 'function',
    function: {
      name: 'list_emails',
      description: 'List unprocessed emails. Returns id, subject, from, category, summary.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'number', description: 'Filter: 1=urgent, 2=reply today, 3=FYI' },
          limit: { type: 'number', description: 'Max results' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_email_reply',
      description: 'Edit reply draft for an email. Changes appear in UI immediately. User can undo.',
      parameters: {
        type: 'object',
        properties: {
          emailId: { type: 'string', description: 'SmartEmail ID' },
          replyText: { type: 'string', description: 'Complete reply text' },
        },
        required: ['emailId', 'replyText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email_reply',
      description: 'Send the reply for an email via SMTP. Email moves to DONE after sending.',
      parameters: {
        type: 'object',
        properties: {
          emailId: { type: 'string', description: 'SmartEmail ID' },
        },
        required: ['emailId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_email_original',
      description: 'Get the original body of an email for the user to read.',
      parameters: {
        type: 'object',
        properties: {
          emailId: { type: 'string', description: 'SmartEmail ID' },
        },
        required: ['emailId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dismiss_email',
      description: 'Mark an email as processed/done. For FYI emails this dismisses them.',
      parameters: {
        type: 'object',
        properties: {
          emailId: { type: 'string', description: 'SmartEmail ID' },
        },
        required: ['emailId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_email',
      description: 'Delete email from local DB only. Does NOT delete from real email server.',
      parameters: {
        type: 'object',
        properties: {
          emailId: { type: 'string', description: 'SmartEmail ID' },
        },
        required: ['emailId'],
      },
    },
  },
];

export async function executeEmailTool(tool: string, args: Record<string, any>) {
  switch (tool) {
    case 'list_emails': {
      const where: any = { isProcessed: false };
      if (args.category) where.category = args.category;
      return prisma.smartEmail.findMany({
        where,
        take: args.limit || 10,
        orderBy: { createdAt: 'desc' },
        select: { id: true, subject: true, fromAddr: true, category: true, summary: true, replyDraft: true, date: true },
      });
    }
    case 'edit_email_reply': {
      const updated = await prisma.smartEmail.update({
        where: { id: args.emailId },
        data: { replyDraft: args.replyText },
      });
      return { ok: true, emailId: args.emailId, staged: true, type: 'email_reply', replyText: args.replyText };
    }
    case 'send_email_reply': {
      const email = await prisma.smartEmail.findUnique({ where: { id: args.emailId } });
      if (!email) return { ok: false, error: 'Email not found' };
      return { ok: true, emailId: args.emailId, subject: email.subject, replyDraft: email.replyDraft, readyToSend: true };
    }
    case 'read_email_original': {
      const email = await prisma.smartEmail.findUnique({
        where: { id: args.emailId },
        select: { bodySnapshot: true, subject: true },
      });
      return { subject: email?.subject, body: email?.bodySnapshot || '(No body stored)' };
    }
    case 'dismiss_email': {
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      await prisma.smartEmail.update({
        where: { id: args.emailId },
        data: { isProcessed: true, processedAt: now },
      });
      const email = await prisma.smartEmail.findUnique({ where: { id: args.emailId }, select: { issueId: true } });
      if (email?.issueId) await prisma.issue.update({ where: { id: email.issueId }, data: { status: 'done' } });
      return { ok: true, dismissed: true };
    }
    case 'delete_email': {
      await prisma.smartEmail.delete({ where: { id: args.emailId } });
      return { ok: true, deleted: true, warning: 'Deleted from local DB only. Original email on server is untouched.' };
    }
    default:
      return { error: `Unknown email tool: ${tool}` };
  }
}
