// ═══ Chat message types — shared by Msg component and App ═══

export interface StagedEdit {
  title?: string;
  content?: string;
  category?: string;
  description?: string;
  status?: string;
  priority?: string;
  storyPoints?: number;
  type?: 'note' | 'task' | 'report' | 'email_reply';
  original?: Record<string, any>;
}

export interface ChatCard {
  type: 'task' | 'note' | 'report' | 'export_xlsx' | 'export_doc' | 'export_pdf';
  id?: string;
  title: string;
  key?: string;
  status?: string;
  priority?: string;
  issueType?: string;
  description?: string;
  content?: string;
  html?: string;
  storyPoints?: number;
  category?: string;
  reportType?: string;
  blocked?: boolean;
  disabled?: boolean;
  resolved?: boolean;
  duplicates?: Array<{ key: string; title: string; status: string }>;
  pendingArgs?: Record<string, any>;
}
