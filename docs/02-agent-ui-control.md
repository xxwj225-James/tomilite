# Agent → UI Control Technical Design

> Version: v1.1 | Date: 2026-08-15
> Status: **PARTIAL** — the UI command store and dispatcher are shipped, but the 5 UI tools in §3 are NOT registered in `apps/api/src/agent/tools/registry.ts` (the Agent cannot invoke them). The real instant-navigation path is the frontend pre-flight `preFlightPanel()` in `apps/web/src/hooks/useSendMessage.ts`, which handles explicit **open** commands only (tasks / notes / reports / email).

## 1. Goal

Let the Agent directly control the frontend UI through function calls:

- User says "open the task list" in chat → Agent opens the Tasks panel
- "Open TL-3" → Agent opens TL-3 details
- "Create a new note for me" → Agent opens the Notes editor

## 2. Core Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        User Input                       │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Agent (agent.ts)                                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │ UI Tools (no DB writes, only UI instructions)   │   │
│  │  navigate_to     → { panel: 'tasks' }            │   │
│  │  open_task       → { id, title, status, ... }    │   │
│  │  create_task_ui  → { }                           │   │
│  │  open_note       → { id, title, content, ... }   │   │
│  │  create_note_ui  → { }                           │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────┘
                         ▼ SSE tool_result
┌─────────────────────────────────────────────────────────┐
│  App.tsx / useSendMessage.ts — dispatchUICommand(tool, result)│
│  ┌──────────────────────────────────────────────────┐   │
│  │ navigate_to    → setPanel(result.panel)          │   │
│  │ open_task      → setPanel('tasks')               │   │
│  │                  + setSelectedTaskId(result.id)   │   │
│  │ create_task_ui → setPanel('tasks')               │   │
│  │                  + setNewTaskMode(true)           │   │
│  │ open_note      → setPanel('notes')               │   │
│  │                  + setSelectedNoteId(result.id)   │   │
│  │ create_note_ui → setPanel('notes')               │   │
│  │                  + setNewNoteMode(true)           │   │
│  │ suggest_issue_edit → apply_task_edit (staged)    │   │
│  │ edit_email_reply  → apply_email_edit (staged)    │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────┘
                         ▼ queue consumption
┌─────────────────────────────────────────────────────────┐
│  ContentPanel — consumes 'navigate' commands only        │
│  → dispatches window CustomEvent 'tl-navigate'           │
│  Task selection via 'tl-select-task' event               │
│  (handled by useTaskState.ts → TasksEditor pre-filled)   │
└─────────────────────────────────────────────────────────┘
```

> **Note:** The UI tools shown above (navigate_to / open_task / create_task_ui / open_note / create_note_ui) are NOT registered in `apps/api/src/agent/tools/registry.ts` — the Agent can never call them. The shipped instant-navigation path is the frontend pre-flight in §5; the store still dispatches the command types for future registration.

### Two-Way Closed Loop

```
Agent ──(UI tool)──▶ Frontend ──(setState)──▶ UI change
                        │
                        ▼
                   Monitor (🔔) ──▶ notifies Agent
```

## 3. New Agent Tools

### 3.0 Implementation Status

The five tool definitions below are the original design, kept as reference. As of v1.1 they are **NOT registered** in `apps/api/src/agent/tools/registry.ts`, so the Agent cannot invoke them. What shipped instead:

- `preFlightPanel()` in `apps/web/src/hooks/useSendMessage.ts` — instant frontend panel navigation for explicit **open** commands (`open tasks/notes/TL-N/reports/email`), no network round-trip. Create commands deliberately do NOT open panels — the Agent creates the item and the result card appears in chat.
- `dispatchUICommand()` in `apps/web/src/stores/uiCommandStore.ts` — maps `tool_result` events to queued UI commands (including `suggest_issue_edit` → `apply_task_edit` and `edit_email_reply` → `apply_email_edit`).
- `ContentPanel.tsx` — consumes the `navigate` command and emits a `tl-navigate` window event; `useTaskState.ts` listens for `tl-select-task`.

### 3.1 `navigate_to` — Switch Panel

```typescript
{
  name: 'navigate_to',
  description: 'Open a panel on the right side of the UI.',
  parameters: {
    type: 'object',
    properties: {
      panel: { type: 'string', enum: ['tasks', 'notes', 'reports', 'settings'] }
    },
    required: ['panel']
  }
}
```

Execution: returns `{ panel }` directly; no DB operations.

### 3.2 `open_task` — Open Task Details

```typescript
{
  name: 'open_task',
  description: 'Open a specific task by its issue number (e.g., 3 for TL-3).',
  parameters: {
    type: 'object',
    properties: {
      issueNumber: { type: 'number', description: 'Issue number without TL- prefix' }
    },
    required: ['issueNumber']
  }
}
```

Execution: queries DB → returns full task data.

### 3.3 `create_task_ui` — Open New Task Form

```typescript
{
  name: 'create_task_ui',
  description: 'Open the task creation form in the UI.',
  parameters: { type: 'object', properties: {} }
}
```

Execution: returns `{}` directly; no DB operations.

### 3.4 `open_note` — Open a Note

```typescript
{
  name: 'open_note',
  description: 'Search for a note by title and open it in the editor.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query for note title' }
    },
    required: ['query']
  }
}
```

Execution: searches DB → returns matching note data.

### 3.5 `create_note_ui` — Open Note Editor

```typescript
{
  name: 'create_note_ui',
  description: 'Open a blank note editor in the UI.',
  parameters: { type: 'object', properties: {} }
}
```

Execution: returns `{}` directly; no DB operations.

## 4. Frontend Implementation

### 4.1 UI Command Queue (Zustand Store) ⚠️ Race-condition protection

A Zustand command queue avoids state overwrites when multiple Agent commands arrive in rapid succession:

```typescript
// stores/uiCommandStore.ts — actual implementation
import { create } from 'zustand';

export interface UICommand {
  id: string; // uuid, for deduplication
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
  enqueue: (cmd) =>
    set((s) => ({
      queue: [...s.queue, { ...cmd, id: crypto.randomUUID(), timestamp: Date.now() }],
    })),
  dequeue: (type) => {
    const queue = get().queue;
    const idx = type ? queue.findIndex((c) => c.type === type) : 0;
    if (idx === -1) return undefined;
    const cmd = queue[idx];
    set((s) => ({ queue: s.queue.filter((_, i) => i !== idx) }));
    return cmd;
  },
  clearType: (type) => set((s) => ({ queue: s.queue.filter((c) => c.type !== type) })),
  clear: () => set({ queue: [] }),
}));
```

Note the type union includes two extra commands beyond the original design — `apply_task_edit` and `apply_email_edit` — used for staged edits (see §4.2).

### 4.2 Command Dispatcher (in `uiCommandStore.ts`, invoked from the SSE handler)

The dispatcher lives in the store file (not App.tsx) and is invoked from `useSendMessage.ts` for every SSE `tool_result` event (`dispatchUICommand(data.tool, data.result)`). Actual implementation:

```typescript
// stores/uiCommandStore.ts
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
```

The `apply_task_edit` / `apply_email_edit` mappings feed the Accept/Undo staged-edit flow in chat (user confirms with "ok / accept / apply" or "undo / revert").

### 4.3 Commands Are Consumed in ContentPanel (single consumer, via window events)

Only `ContentPanel.tsx` consumes the queue, and only the `navigate` type. It converts the command into a `tl-navigate` window event that App.tsx listens for:

```typescript
// components/ContentPanel.tsx — actual implementation
const { queue, clearType } = useUICommandStore();
useEffect(() => {
  const cmd = queue.find((c) => c.type === 'navigate');
  if (cmd) {
    clearType('navigate');
    const targetPanel = cmd.payload.panel;
    if (targetPanel === 'notes' || targetPanel === 'tasks' || targetPanel === 'reports' || targetPanel === 'email') {
      window.dispatchEvent(new CustomEvent('tl-navigate', { detail: targetPanel }));
    }
  }
}, [queue, clearType]);
```

Task selection is handled separately via the `tl-select-task` window event, listened for in `apps/web/src/panels/tasks/useTaskState.ts` (opens the TasksEditor pre-filled). The `open_task` / `create_task` / `open_note` / `create_note` command types have no active consumer yet — only `navigate` does.

### 4.4 Why a Queue Instead of `useState + useEffect`?

|                               | useState + useEffect                | Zustand queue                  |
| ----------------------------- | ----------------------------------- | ------------------------------ |
| 3 commands in a row           | Each overwrites the previous (race) | Consumed in order, none lost   |
| Cross-component communication | Requires props drilling             | Direct subscribe               |
| Debugging                     | Hard to trace                       | DevTools can inspect the queue |
| Deduplication                 | None                                | Can dedupe by id               |

## 5. Use Cases (shipped behavior)

### Scenario A: Open a Panel (instant, pre-flight)

```
User: "open the task list"
Frontend: preFlightPanel("open the task list") → 'tasks'
UI: Tasks panel opens immediately (<50ms, no network)
Agent: still processes the message and answers normally
```

### Scenario B: View a Specific Task

```
User: "open TL-3"
Frontend: preFlightPanel("open TL-3") → 'tasks'
UI: Tasks panel opens instantly
Agent: calls get_issue({ issueNumber: 3 }) → answer shown in chat
(No automatic detail selection — the tl-select-task event is
dispatched only by card actions / email "Link Task", not by chat)
```

### Scenario C: Create a Note for the User

```
User: "create a note for me, I'll fill in the content"
Frontend: preFlightPanel → null (create commands deliberately do NOT open panels)
Agent: calls create_note → result card appears in chat
User: opens the note later from the card or Notes panel
```

## 6. Security

- UI tools can only navigate and open existing data
- Cannot Save/Delete directly, bypassing the user
- Cannot modify DB data
- All write operations still require manual user confirmation

## 7. Change List (actual shipped)

| File                                          | Change                                                                                                                                                                                                                             | Impact |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `apps/web/src/stores/uiCommandStore.ts` (new) | UI command queue store + `dispatchUICommand()` — maps `navigate_to`/`open_task`/`create_task_ui`/`open_note`/`create_note_ui` tool results, plus `suggest_issue_edit` → `apply_task_edit`, `edit_email_reply` → `apply_email_edit` | Medium |
| `apps/web/src/hooks/useSendMessage.ts`        | `preFlightPanel()` — instant panel navigation for open commands; calls `dispatchUICommand(data.tool, data.result)` on every SSE `tool_result`                                                                                      | Medium |
| `apps/web/src/components/ContentPanel.tsx`    | Consumes `navigate` commands → dispatches `tl-navigate` window event                                                                                                                                                               | Medium |
| `apps/web/src/panels/tasks/useTaskState.ts`   | Listens for `tl-select-task` → opens TasksEditor pre-filled                                                                                                                                                                        | Low    |
| `apps/api/src/agent/tools/registry.ts`        | Unchanged — the 5 UI tools are NOT registered (Agent cannot call them)                                                                                                                                                             | —      |

## 8. Comparison with Claude Code MCP

|                        | Claude Code                               | TomiLite Agent                                   |
| ---------------------- | ----------------------------------------- | ------------------------------------------------ |
| Control target         | IDE (open files, jump to line numbers)    | Right-side panel (switch, open, create)          |
| Communication protocol | MCP (Model Context Protocol)              | Function Call → SSE → React State                |
| Security               | Requires user authorization for MCP tools | UI tools don't touch DB, no authorization needed |

The core idea is the same: **abstract UI operations into Agent tools and control the frontend through the standard function-call mechanism**.
