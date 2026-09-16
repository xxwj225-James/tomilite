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

export type ChatCardType =
  | 'task'
  | 'note'
  | 'report'
  | 'export_xlsx'
  | 'export_doc'
  | 'export_pdf'
  | 'export_ppt'
  | 'task_batch';

export interface ChatCard {
  type: ChatCardType;
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
  /**
   * Per-row cards for type 'task_batch'. Each entry is a normal single 'task'
   * card, so the per-row buttons can hand it straight to the existing
   * tl-open-card / tl-edit-card / tl-delete-card events.
   *
   * Cards persisted before this feature never carry it — readers must treat
   * `undefined` as "a plain single card".
   */
  items?: ChatCard[];
}
