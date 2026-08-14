import { create } from 'zustand';

export interface UICommand {
  id: string;
  type: 'navigate' | 'open_task' | 'create_task' | 'open_note' | 'create_note' | 'apply_task_edit' | 'apply_email_edit';
  payload: any;
  timestamp: number;
}

interface UICommandState {
  queue: UICommand[];
  enqueue: (cmd: Omit<UICommand, 'id' | 'timestamp'>) => void;
  dequeue: (type?: string) => UICommand | undefined;
  clearType: (type: string) => void;
  clear: () => void;
}

export const useUICommandStore = create<UICommandState>((set, get) => ({
  queue: [],
  enqueue: (cmd) => set(s => ({
    queue: [...s.queue, { ...cmd, id: crypto.randomUUID(), timestamp: Date.now() }]
  })),
  dequeue: (type) => {
    const queue = get().queue;
    const idx = type ? queue.findIndex(c => c.type === type) : 0;
    if (idx === -1) return undefined;
    const cmd = queue[idx];
    set(s => ({ queue: s.queue.filter((_, i) => i !== idx) }));
    return cmd;
  },
  clearType: (type) => set(s => ({ queue: s.queue.filter(c => c.type !== type) })),
  clear: () => set({ queue: [] }),
}));

// Helper: dispatch UI commands from SSE tool results
export function dispatchUICommand(tool: string, result: any) {
  const { enqueue } = useUICommandStore.getState();
  switch (tool) {
    case 'navigate_to':
      enqueue({ type: 'navigate', payload: { panel: result.panel } });
      break;
    case 'open_task':
      enqueue({ type: 'open_task', payload: { id: result.id, data: result } });
      break;
    case 'create_task_ui':
      enqueue({ type: 'create_task', payload: {} });
      break;
    case 'open_note':
      enqueue({ type: 'open_note', payload: { id: result.id, data: result } });
      break;
    case 'create_note_ui':
      enqueue({ type: 'create_note', payload: {} });
      break;
    case 'suggest_issue_edit':
      if (result?.staged) {
        enqueue({ type: 'apply_task_edit', payload: result });
      }
      break;
    case 'edit_email_reply':
      if (result?.staged) {
        enqueue({ type: 'apply_email_edit', payload: { ...result, id: result.emailId } });
      }
      break;
  }
}
