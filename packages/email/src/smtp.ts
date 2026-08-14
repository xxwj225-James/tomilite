export interface SMTPOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  html: string;
  inReplyTo?: string;
  rejectUnauthorized?: boolean;
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
}

export async function sendSMTP(opts: SMTPOptions): Promise<void> {
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.port === 465,
    auth: { user: opts.user, pass: opts.password },
    ...(opts.tls && opts.port !== 465 ? { requireTLS: true } : {}),
    tls: { rejectUnauthorized: opts.rejectUnauthorized !== false },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });

  await transporter.sendMail({
    from: opts.from,
    to: opts.to,
    ...(opts.cc ? { cc: opts.cc } : {}),
    subject: opts.subject,
    html: opts.html,
    ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo, references: opts.inReplyTo } : {}),
    ...(opts.attachments?.length ? {
      attachments: opts.attachments.map(a => ({
        filename: a.filename,
        content: Buffer.from(a.content, 'base64'),
        contentType: a.contentType || 'application/octet-stream',
      })),
    } : {}),
  });
}
