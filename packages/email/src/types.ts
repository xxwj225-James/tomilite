/** Parsed attachment from inbound email */
export interface MessageAttachment {
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
}

/** Normalized email message from any connector (IMAP/Gmail) */
export interface NormalizedMessage {
  externalId: string;
  uid?: number;
  source: 'IMAP_EMAIL' | 'GMAIL_EMAIL';
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  attachments?: MessageAttachment[];
  rawData?: any;
  receivedAt: Date;
}

/** AI classification result */
export interface ClassificationResult {
  category: number; // 1=urgent reply, 2=reply today, 3=FYI only, 4=other
  summary: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  replyDraft?: string;
}

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken?: string;
  accessToken?: string;
  watchEmail: string;
  labelIds?: string[];
  historyDays?: number;
}

export interface EmailConnector {
  startWatching(): Promise<void>;
  stopWatching(): Promise<void>;
  fetchMessage(messageId: string | number): Promise<NormalizedMessage>;
  fetchFullMessage?(uid: number): Promise<{ html: string; text: string }>;
  sendEmail(params: SendEmailParams): Promise<string>;
  onNewMessage(handler: (message: NormalizedMessage) => Promise<void>): void;
  getStatus(): EmailConnectorStatus;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
}

export interface EmailConnectorStatus {
  connected: boolean;
  polling?: boolean;
  watchExpiration?: Date;
  lastCheckAt?: Date;
  lastError?: string;
  messagesProcessed: number;
}
