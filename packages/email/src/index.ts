export { IMAPConnector, createIMAPConnector } from './imap.js';
export type { IMAPConfig } from './imap.js';
export { sendSMTP } from './smtp.js';
export type { SMTPOptions } from './smtp.js';
export { EmailManager, emailManager } from './manager.js';
export { classifyEmail, heuristicClassify } from './classifier.js';
export type { EmailConnector, EmailConnectorStatus, SendEmailParams, NormalizedMessage, MessageAttachment, GmailConfig, ClassificationResult } from './types.js';
