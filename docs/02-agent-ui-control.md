# Agent → UI Control Technical Design

> Version: v1.0 | Date: 2026-06-29

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
│  App.tsx — dispatchUICommand(tool, result)              │
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
│  └──────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────┘
                         ▼ React state updates
┌─────────────────────────────────────────────────────────┐
│  ContentPanel → TasksPanel / NotesPanel                 │
│  Reacts to newTaskMode / selectedTaskId / newNoteMode   │
│  → UI auto-switches panel, opens the matching view      │
└─────────────────────────────────────────────────────────┘
```

### Two-Way Closed Loop

```
Agent ──(UI tool)──▶ Frontend ──(setState)──▶ UI change
                        │
                        ▼
                   Monitor (🔔) ──▶ notifies Agent
```

## 3. New Agent Tools

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
// stores/uiCommandStore.ts
import { create } from 'zustand';

interface UICommand {
  id: string;                    // uuid, for deduplication
  type: 'navigate' | 'open_task' | 'create_task' | 'open_note' | 'create_note';
  payload: any;
  timestamp: number;
}

interface UICommandState {
  queue: UICommand[];
  enqueue: (cmd: Omit<UICommand, 'id' | 'timestamp'>) => void;
  dequeue: () => UICommand | undefined;
  clear: () => void;
}

export const useUICommandStore = create<UICommandState>((set, get) => ({
  queue: [],
  enqueue: (cmd) => set(s => ({
    queue: [...s.queue, { ...cmd, id: crypto.randomUUID(), timestamp: Date.now() }]
  })),
  dequeue: () => {
    const [first, ...rest] = get().queue;
    if (first) set({ queue: rest });
    return first;
  },
  clear: () => set({ queue: [] }),
}));
```

### 4.2 Command Dispatcher (inside App.tsx SSE handler)

```typescript
function dispatchUICommand(tool: string, result: any) {
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
  }
}
```

### 4.3 Panels Consume Commands (TasksPanel / NotesPanel)

Each panel pulls its own commands from the queue in its own `useEffect`:

```typescript
// TasksPanel
const { queue, dequeue } = useUICommandStore();
useEffect(() => {
  const cmd = queue.find(c => c.type === 'open_task' || c.type === 'create_task');
  if (!cmd) return;
  dequeue(); // consume it
  if (cmd.type === 'open_task') {
    setPanel('tasks');
    setSelected({ id: cmd.payload.id, ...cmd.payload.data });
  } else if (cmd.type === 'create_task') {
    setPanel('tasks');
    setSelected({});
    setEditing(true);
  }
}, [queue]);
```

### 4.4 Why a Queue Instead of `useState + useEffect`?

| | useState + useEffect | Zustand queue |
|---|---|---|
| 3 commands in a row | Each overwrites the previous (race) | Consumed in order, none lost |
| Cross-component communication | Requires props drilling | Direct subscribe |
| Debugging | Hard to trace | DevTools can inspect the queue |
| Deduplication | None | Can dedupe by id |

## 5. Use Cases

### Scenario A: Open a Panel
```
User: "open the task list"
Agent: navigate_to({ panel: 'tasks' })
UI: Tasks panel opens on the right
```

### Scenario B: View a Specific Task
```
User: "open TL-3"
Agent: open_task({ issueNumber: 3 })
Backend: queries DB → returns { id, title, status, ... }
UI: Tasks panel opens, TL-3 details shown automatically
```

### Scenario C: Prepare a New Note for the User
```
User: "create a note for me, I'll fill in the content"
Agent: create_note_ui()
UI: Notes panel opens, blank editor ready
Agent: "The editor is open — you can start writing 📝"
```

## 6. Security

- UI tools can only navigate and open existing data
- Cannot Save/Delete directly, bypassing the user
- Cannot modify DB data
- All write operations still require manual user confirmation

## 7. Change List

| File | Change | Impact |
|------|------|----------|
| `agent.ts` | +5 UI tools, +5 executeAgentTool cases | Tool count 8→13 |
| `App.tsx` | +4 states, +1 dispatchUICommand, called from SSE handler | Medium |
| `ContentPanel.tsx` | TasksPanel +4 props, NotesPanel +2 props, useEffect response | Medium |

## 8. Comparison with Claude Code MCP

| | Claude Code | TomiLite Agent |
|---|---|---|
| Control target | IDE (open files, jump to line numbers) | Right-side panel (switch, open, create) |
| Communication protocol | MCP (Model Context Protocol) | Function Call → SSE → React State |
| Security | Requires user authorization for MCP tools | UI tools don't touch DB, no authorization needed |

The core idea is the same: **abstract UI operations into Agent tools and control the frontend through the standard function-call mechanism**.
