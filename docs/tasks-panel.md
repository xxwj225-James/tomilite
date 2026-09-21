# Tasks Panel Redesign — Implementation Status

> Status: IMPLEMENTED (the 3-column Kanban plan was NOT built — the shipped design is a tabbed table; see below)

## Context

The original plan proposed a three-column Kanban with email cards and a notification bar. What actually shipped is a **tabbed table**: TODO / IN_PROGRESS / DONE tabs (with counts) over the existing flat table, plus drag-to-status. Emails were NOT merged into this panel — they live in the standalone Email panel (see [email-ai.md](email-ai.md)), and email-derived rows are filtered out of the task list entirely.

## Shipped Behavior

### 1. Layout: Tabbed Table (NOT 3-column Kanban)

`apps/web/src/panels/tasks/TasksList.tsx`:

- Three tabs: **TODO** / **IN_PROGRESS** / **DONE**, each showing a count in the tab header.
- The **IN_PROGRESS tab includes `in_review`** issues (`!['in_progress', 'in_review'].includes(status)` filter).
- Tabs filter the existing flat, sortable table (sort by #/Title/Priority/Type/Created/Due/Updated) — no Kanban columns.
- **No notification bar.** Unprocessed-email count appears as a badge on the sidebar Email menu instead (`MenuNav.tsx` `notif-badge`).
- **The tab badges are counted by the server over the whole set, not over the page of rows on screen.** `issue.list` returns at most 200 rows, so a badge derived from the fetched array silently under-reports the moment the table grows past that — the numbers would still look plausible. `issue.taskCounts` counts in SQL and returns `{ total, todo, inProgress, done }`; `TasksList` renders that and shows nothing (not a zero) until it arrives.

### 1a. One definition of "a task"

`apps/api/src/lib/taskScope.ts` is the single source of that rule:

```ts
type !== 'email' && status ∈ ['todo', 'in_progress', 'in_review', 'done']
```

It is expressed twice on purpose — `isTask(row)` for callers working in JS, and `TASK_WHERE` for callers that must filter or count in SQL. They are adjacent in one file so a future change to the rule has one obvious place to land. The `in_review` → `inProgress` folding is part of the same definition, so every counter that reports a four-way split reports the same four numbers as the board.

The callers: `issue.list`, `issue.taskCounts`, `health.personalHealth`, `health.taskStats`, `mcp.get_project_stats`, `agentRouter.getProjectStats`, `search.knowledgeMap` (the count injected into the prompt), `standup.gatherEveningData`, `standup.getMorningBrief`, and the agent's own `issueTools.getStats` and `issueTools.listIssues`.

The agent's `listIssues` was the last caller filtering on something else (`args.status` alone), which made `list_issues` with no status return `type: 'email'` rows — and because its projection carries no `type` field, the model could not tell a newsletter from a task even in principle. It now spreads `TASK_WHERE` and lets an explicit `status` override the four-status union only; the type clause always applies. `list_issues`'s `status` is an enum of the four statuses, so nothing legitimate was cut by narrowing it.

> `cancelled` is deliberately **not** a task status. A cancelled row is excluded from every count; it is not "todo" and it is not "done".

> `get_issue` is deliberately **left open** on both branches. By number it is an identity lookup — `TL-57` either exists or does not, and answering "not found" for a row that is there would be worse than returning it. By `query` it returns `type`, so the model can see what it found.

### 2. No Email Cards in the Task List

- Rows with `type === 'email'` are filtered out of both the list (`if (i.type === 'email') return false;`) and the tab counts.

### 3. Open Task → TasksEditor Pre-filled

- Clicking `#` (TL-N) or the Title opens `TasksEditor` pre-filled with the issue (title, description, status, priority, type, story points, due date, editing mode on).
- The same entry point is used by `tl-select-task` events (chat card actions, email "Link Task"), handled in `useTaskState.ts`.

### 4. Drag-to-Status (custom mouse drag)

- Drag from the **Priority / Type / Created / Due / Updated** cells of a row onto a status strip.
- While dragging, three **`data-drop-zone`** strips (TODO / IN_PROGRESS / DONE) are shown; the drop target is read via `el.closest('[data-drop-zone]')`.
- **DB-first**: `api.issue.update({ id, status })` — on success the list refreshes and a toast shows `tasks.toast.statusChanged` ("Status → {status}"); on failure a toast shows `tasks.toast.statusChangeFailed` and the UI stays unchanged.
- Ghost element is a single ref + **direct DOM style mutation on mousemove** (no React re-render per mousemove — important for the large list).
- **Drag is disabled on the DONE tab** (`if (activeTab === 'done') return;`).
- No HTML5 drag-and-drop — plain mouse events (avoids obfuscator issues).

### 5. Dismissible Drag Hint

- A hint banner ("Click # or Title to view details. Drag Priority/Type/Created/Due/Updated columns to change status.") shows until dismissed; dismissal persisted to localStorage key **`tl-task-drag-hint`**.

### 6. Keyboard Shortcuts — NOT implemented

The planned `J`/`K`/`Enter`/`N`/`Space`/`Escape` shortcuts were not built.

### 7. Resizable Columns + Pagination

- Column widths are resizable (drag the column header edge) and persisted to localStorage key **`tl-task-cols`**.
- Pagination at **20 items per page** (`PAGE_SIZE = 20`), with page controls and a total count.

### 8. Kept Functionality

- Search box, type filter, priority filter (persisted to DB via `systemConfig` `taskSort` / `taskFilter`), sortable columns.
- New Issue creation (toolbar button → blank TasksEditor form), edit/delete, batch select + batch delete.

### 9. Batch Task Creation from Chat — per-row actions

When the agent creates **several** tasks in one turn, the chat no longer shows a pile
of prose with only the last task actionable. They render as one `task_batch` card —
a table (key / title / priority / status / actions) where each row's 👁 查看 ·
✏️ 编辑 · 🗑 删除 dispatches the existing `tl-open-card` / `tl-edit-card` /
`tl-delete-card` events with **that row** as the payload. Every button therefore
reaches `TasksEditor` for the right task, and deleting a row greys that row out.
No backend or database change was involved.

- `apps/web/src/components/chat/TaskBatchCard.tsx` — the table (horizontally
  scrollable, since the chat column is narrow)
- `apps/web/src/hooks/useSendMessage.ts` — accumulates `create_issue` /
  `force_create_issue` results for the turn and emits the batch card from the 2nd task on
- One turn can only carry one card: export > dedup-blocked > batch > single

## Files Shipped

| File                                        | Change                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/panels/tasks/TasksList.tsx`   | Tabbed table, drag-to-status with ghost element, drag hint, resizable columns, pagination, email-type filtering |
| `apps/web/src/panels/tasks/TasksPanel.tsx`  | Thin shell — list ↔ editor switching, unsaved-changes / delete / batch-delete confirm dialogs                   |
| `apps/web/src/panels/tasks/useTaskState.ts` | State + handlers; listens for `tl-select-task` / `tl-close-task-editor`; persists sort/filter                   |
| `apps/web/src/panels/tasks/TasksEditor.tsx` | Pre-filled editor form (title/description/status/priority/type/SP/due date), save/delete                        |

## Verification

1. Open Tasks panel → see three tabs with counts; IN_PROGRESS tab includes in_review issues
2. Click # or Title → TasksEditor opens pre-filled
3. Drag a row's Priority/Type/Created/Due/Updated cells onto a status strip → status changes with toast; drag does nothing on the DONE tab
4. Dismiss the drag hint → banner stays gone after reload (tl-task-drag-hint)
5. Resize columns → widths persist after reload (tl-task-cols)
6. No email rows appear in the list or counts (badge is on the sidebar Email menu)
7. Ask the agent to "create 3 tasks" → **one table with 3 rows** in the chat; row 2's
   编辑 opens the 2nd task in `TasksEditor`, and row 1's 删除 removes only the 1st
   (re-check `SELECT issueNumber, title FROM Issue ORDER BY issueNumber DESC LIMIT 5`)
