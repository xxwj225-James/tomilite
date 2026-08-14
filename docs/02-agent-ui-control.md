# Agent → UI Control 技术方案

> 版本: v1.0 | 日期: 2026-06-29

## 1. 目标

让 Agent 可以通过 function call 直接控制前端 UI，实现：

- 用户在聊天中说"打开 task 一览" → Agent 打开 Tasks 面板
- "打开 TL-3" → Agent 打开 TL-3 详情
- "帮我创建新笔记" → Agent 打开 Notes 编辑器

## 2. 核心架构

```
┌─────────────────────────────────────────────────────────┐
│                      用户输入                            │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Agent (agent.ts)                                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │ UI Tools (不写 DB，只返回 UI 指令)                │   │
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
                         ▼ React state 更新
┌─────────────────────────────────────────────────────────┐
│  ContentPanel → TasksPanel / NotesPanel                 │
│  响应 newTaskMode / selectedTaskId / newNoteMode 等     │
│  → UI 自动切换面板、打开对应视图                          │
└─────────────────────────────────────────────────────────┘
```

### 双向闭环

```
Agent ──(UI tool)──▶ 前端 ──(setState)──▶ UI 变化
                        │
                        ▼
                   Monitor (🔔) ──▶ 通知 Agent
```

## 3. 新增 Agent Tools

### 3.1 `navigate_to` — 切换面板

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

执行：直接返回 `{ panel }`，不操作 DB。

### 3.2 `open_task` — 打开 Task 详情

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

执行：查询 DB → 返回 task 完整数据。

### 3.3 `create_task_ui` — 打开 Task 新建表单

```typescript
{
  name: 'create_task_ui',
  description: 'Open the task creation form in the UI.',
  parameters: { type: 'object', properties: {} }
}
```

执行：直接返回 `{}`，不操作 DB。

### 3.4 `open_note` — 打开笔记

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

执行：搜索 DB → 返回匹配的 note 数据。

### 3.5 `create_note_ui` — 打开笔记编辑器

```typescript
{
  name: 'create_note_ui',
  description: 'Open a blank note editor in the UI.',
  parameters: { type: 'object', properties: {} }
}
```

执行：直接返回 `{}`，不操作 DB。

## 4. 前端实现

### 4.1 UI 指令队列（Zustand Store）⚠️ 防竞态

使用 Zustand 维护指令队列，避免多个 Agent 指令连续到达时状态互相覆盖：

```typescript
// stores/uiCommandStore.ts
import { create } from 'zustand';

interface UICommand {
  id: string;                    // uuid，去重用
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

### 4.2 Command Dispatcher（App.tsx SSE handler 内）

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

### 4.3 面板消费指令（TasksPanel / NotesPanel）

每个面板在自己的 `useEffect` 中从队列拉取属于自己的指令：

```typescript
// TasksPanel
const { queue, dequeue } = useUICommandStore();
useEffect(() => {
  const cmd = queue.find(c => c.type === 'open_task' || c.type === 'create_task');
  if (!cmd) return;
  dequeue(); // 消费掉
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

### 4.4 为什么用队列而不是 `useState + useEffect`？

| | useState + useEffect | Zustand 队列 |
|---|---|---|
| 连续 3 个指令 | 后一个覆盖前一个（竞态） | 按序消费，不丢失 |
| 跨组件通信 | 需要层层 props | 直接 subscribe |
| 调试 | 难追踪 | DevTools 可查看队列 |
| 去重 | 无 | 可按 id 去重 |

## 5. 使用场景

### 场景 A：打开面板
```
用户: "打开 task 一览"
Agent: navigate_to({ panel: 'tasks' })
UI: 右侧 Tasks 面板打开
```

### 场景 B：查看特定 Task
```
用户: "打开 TL-3 看看"
Agent: open_task({ issueNumber: 3 })
后端: 查 DB → 返回 { id, title, status, ... }
UI: Tasks 面板打开，TL-3 详情自动显示
```

### 场景 C：帮用户准备新笔记
```
用户: "帮我创建一个笔记，我来填内容"
Agent: create_note_ui()
UI: Notes 面板打开，空编辑器就位
Agent: "编辑器已打开，你可以开始写了 📝"
```

## 6. 安全性

- UI Tools 只能导航和打开已有数据
- 不能绕过用户直接 Save / Delete
- 不能修改 DB 数据
- 所有写操作仍需用户手动确认

## 7. 改动清单

| 文件 | 改动 | 影响范围 |
|------|------|----------|
| `agent.ts` | +5 个 UI tool，+5 个 executeAgentTool case | 工具数量 8→13 |
| `App.tsx` | +4 个状态，+1 个 dispatchUICommand，SSE handler 调用 | 中等 |
| `ContentPanel.tsx` | TasksPanel +4 props，NotesPanel +2 props，useEffect 响应 | 中等 |

## 8. 与 Claude Code MCP 的对比

| | Claude Code | TomiLite Agent |
|---|---|---|
| 控制目标 | IDE（打开文件、跳转行号） | 右侧面板（切换、打开、新建） |
| 通信协议 | MCP (Model Context Protocol) | Function Call → SSE → React State |
| 安全性 | 需用户授权 MCP tool | UI tool 不操作 DB，无需授权 |

核心思路一致：**把 UI 操作抽象为 Agent tool，通过标准 function call 机制控制前端**。
