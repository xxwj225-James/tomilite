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
- New Issue creation (toolbar button → blank TasksEditor form), edit/delete.

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

### 10. Mirrored Tasks (imported from Redmine)

The panel can now contain rows this app did not write. `Issue.source` is `'redmine'` on
them, `Issue.sourceId` is the tracker's own issue number as a string, and together they
are the merge key the sync upserts on. `source` is `NULL` on everything this app writes.

**They are counted by everything.** The user chose this explicitly: the task board's tab
badges, the Home totals, `health.personalHealth`, the morning brief's overdue list and the
agent's `list_issues` all include mirrored rows. Nothing here filters on `source`, and
nothing should start to. The defence for the choice is that the sync pulls
`assigned_to_id=me` — these are tickets assigned to *this* user, not an arbitrary
project's throughput — so the statistics describe the user's real workload. The visible
consequence is that the staleness score can fall, because a ticket assigned three years
ago and never closed is genuinely stale.

`isTask` and `isImported` are two separate questions and stay separate:

| Question | Function | Answer |
| --- | --- | --- |
| Is this counted as a task? | `isTask(row)` | Yes — mirrored rows are tasks |
| May this app write to it? | `isImported(row)` | No — read-only |

**The read-only contract.** Five places could write to an `Issue`, and every one refuses
a mirrored row:

| Writer | Behaviour |
| --- | --- |
| `issue.update` (`routers/issue.ts`) | `FORBIDDEN` — "Mirrored from an external tracker — read-only here" |
| `issue.delete` (`routers/issue.ts`) | `FORBIDDEN` — points at detach instead |
| `issueTools.updateIssue` (agent) | Returns `{ error: '#1234 is mirrored from Redmine and is read-only here' }` |
| `mcp.ts` `update_issue` (MCP server) | Same — a **second, independent implementation**, easy to miss |
| `git.ts` commit scanner | Skips the auto-close branch; the `gitCommitRef` link is still created |

The git one is the least obvious and the most surprising if it fires: the scanner matches
`/\b(fix|close|resolve)\s+#(\d+)/` in any commit message and sets that issue to `done`.
Without the guard, **somebody else's commit message could close a mirrored ticket**, and
the next sync would quietly reopen it.

**Detach is the escape hatch.** `issue.detach` clears both `source` and `sourceId`,
turning the row into an ordinary local task that can be edited and deleted. It is
reachable from the task editor, and it is the only way out of the read-only rule —
without it, a user who wants 50 noisy mirrored tickets gone has no move at all, because
deleting is refused and the next sync re-creates what it does not recognise.

> **Detach is not permanent.** The row keeps its place in the database but loses its
> merge key, so the next sync sees a ticket it has never mirrored and creates a second
> copy. Both columns could not be cleared *and* detachment be permanent; keeping
> `sourceId` would leave a row that still carries a tracker's identity while the sync no
> longer recognises it — a half-attached state that is worse than either. The UI says the
> ticket can come back.

`redmine.disconnect` offers the same three dispositions for *all* mirrored rows at once
(`keep` / `detach` / `delete`), and requires the caller to choose. There is no safe
default: `keep` strands several hundred rows that are read-only *and* no longer
refreshable, which is exactly the dead end detach exists to prevent.

**The row is labelled.** A mirrored row shows an `Imported` badge next to its title
(`tasks.mirrored`), its editor hides Edit and Delete and shows Detach plus a banner
explaining why, and it cannot be dragged between columns — a drag would be a local write
that the next sync reverts, so the drag appears to work and then undoes itself.

**`issueKey`.** The number a user reads comes from `lib/issueKey.ts` on the web side and
`lib/taskScope.ts` on the API side (duplicated, because the web bundle cannot import from
the API package; same arrangement as `lib/dbTime.ts`):

```ts
i.source === 'redmine' && i.sourceId ? '#' + i.sourceId : 'TL-' + i.issueNumber
```

So a mirrored row shows Redmine's own `#1234`, which is the number its colleagues, its
commits and its email threads all use. `issueNumber` keeps its local-sequence meaning and
is **not** set to the tracker's id — see the comment on `issueKey` for the collision that
would eventually cause.

### Known limitation: `take: 200`

`issue.list` returns at most 200 rows, and the board's tabs filter that page client-side.
The badges are counted in SQL over the whole set, so a badge can legitimately say 300
while the tab shows fewer rows. This predates mirroring, but mirroring makes it reachable:
with more than 200 mirrored tickets the tail of the list is not on screen.

The list is ordered `[{ source: 'asc' }, { updatedAt: 'desc' }]`, which is load-bearing
rather than cosmetic — SQLite sorts `NULL` before any non-null value in `ASC`, and `NULL`
source is exactly "this app wrote it", so the user's own tasks always win the 200 slots
and mirrored rows take what is left. Without it, a sync of 400 tickets (whose `updatedAt`
is fresh enough to sort first) fills the page entirely and a tab can render zero rows
while its badge says 37. The user's own tasks would not be truncated — they would be
**absent**.

### Related: the hourly archiver deletes old `done` tasks

`startBackgroundTasks()` in `server.ts` runs an hourly sweep whose comment says "hide from
UI, never delete". That is true for `GitCommit` and `SmartEmail`, which set
`archived: true`, and **false for `Issue`**, which the sweep hard-deletes:

```ts
prisma.issue.deleteMany({ where: { status: 'done', updatedAt: { lt: cutoffIssue }, source: null } })
```

The `source: null` predicate is the whole safety of that line and it is not a filter of
convenience. A mirrored row is not stale work the user abandoned — it is a copy of someone
else's tracker, where `status: 'done'` means the *ticket was closed*, not that the user
finished it. Closed tickets are overwhelmingly the ones older than 90 days, and the sync
cursor has already moved past them, so without the predicate importing 400 tickets would
have become 87 within the hour, silently and permanently.

> **The sweep still hard-deletes the user's own finished tasks**, and this batch did not
> change that. It cascades to that task's comments, changelog, git-ref links and board
> cards, and clears `parentId` on its subtasks (`onDelete: SetNull`), leaving them on the
> board as orphans. It is pre-existing behaviour, unrelated to mirroring, and it is
> recorded here because the comment above it claimed otherwise and because it is the kind
> of thing that should be a deliberate decision rather than a surprise.

## Files Shipped

| File                                        | Change                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/panels/tasks/TasksList.tsx`   | Tabbed table, drag-to-status with ghost element, drag hint, resizable columns, pagination, email-type filtering |
| `apps/web/src/panels/tasks/TasksPanel.tsx`  | Thin shell — list ↔ editor switching, unsaved-changes / delete confirm dialogs                                 |
| `apps/web/src/panels/tasks/useTaskState.ts` | State + handlers; listens for `tl-select-task` / `tl-close-task-editor`; persists sort/filter                   |
| `apps/web/src/panels/tasks/TasksEditor.tsx` | Pre-filled editor form (title/description/status/priority/type/SP/due date), save/delete; mirrored rows: no Edit/Delete, Detach instead |
| `apps/web/src/lib/issueKey.ts`              | `issueKey()` — `#<sourceId>` for mirrored rows, `TL-<issueNumber>` otherwise                                   |
| `apps/web/src/panels/tasks/RedmineSection.tsx` | Connect / test / preview / sync / disconnect, with the three-way disconnect choice                        |
| `apps/web/src/panels/tasks/ImportTasksDialog.tsx` | The modal that wraps `RedmineSection`, opened from the task list; unmounts on close, which is what stops the status poll |
| `apps/api/src/lib/taskScope.ts`             | `isImported()` + the API-side `issueKey`                                                                       |
| `apps/api/src/routers/issue.ts`             | `list` `orderBy` (mirrored rows last), `taskCounts`, read-only guard in `update`/`delete`, `detach`            |
| `apps/api/src/routers/redmine.ts`           | The 8 procedures + cursor + sync algorithm — see [architecture.md](architecture.md) §6.15                      |
| `apps/api/src/lib/redmineClient.ts`         | HTTP layer: API-key header, 30s timeout, `fetchWithProxyFallback` (honours the bypass list), 403-with-HTML tolerance |
| `apps/api/src/lib/redmineMap.ts`            | The three name→status/type/priority tables; zero runtime imports so they can be exercised directly             |

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
8. After a Redmine sync: every mirrored row shows `#<id>` and an `Imported` badge; opening
   one shows the read-only banner with **no Edit and no Delete**; dragging one does nothing
9. `issue.update` / `issue.delete` on a mirrored id → `FORBIDDEN`, row unchanged; the
   agent's `update_issue` and the MCP `update_issue` tool → an error string, not a write
10. Detach a mirrored row → it becomes editable (`source`/`sourceId` both cleared) and the
    **next sync re-creates the ticket** as a second row, as the UI warns
11. Sync twice with no upstream change → second run reports `updated: 0, created: 0`
12. `redmine.disconnect` with `keep` → rows stay but are no longer refreshable; with
    `detach` → all of them become editable local tasks
