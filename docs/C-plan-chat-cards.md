# Plan C: Actionable Cards Embedded in Chat

## Design Goals

Content created by the Agent (tasks/notes/reports) appears in chat as actionable cards, so users can view, edit, and delete without switching panels. Panels act as the "advanced view".

## Core Principles

```
Panel open → Agent fills the form, user fine-tunes then Saves
Panel closed → Agent writes to DB directly, card appears in chat
```

**One tool, one job**:

- `create_issue` / `create_note` / `create_report` → writes to DB directly
- `suggest_issue_edit` / `suggest_note_edit` / `suggest_report_edit` → only fills the form (when the editor is open)

## Card Interactions

```
┌──────────────────────────────────────┐
│ 🎫 TL-50   todo   high               │
│ Plan C for Debug UI-agent interaction│
│ Decoupled via event bus + state machine... │  ← description excerpt
│                                      │
│ [👁 View] [✏️ Edit] [🗑 Delete]           │
└──────────────────────────────────────┘
(Blocked duplicate cards instead show: [💥 Force Create] [Cancel])

[View] → panel opens, item selected (read-only)
[Edit] → panel opens, item selected + edit mode
[Delete] → deletes the DB record after confirmation
```

## Technical Implementation (current file layout)

### Frontend — types & rendering

1. **ChatCard interface** — `apps/web/src/types/chat.ts` (also defines `StagedEdit`); card fields: `type`, `id`, `title`, `key`, `status`, `priority`, `issueType`, `description`, `content`, `reportType`, `blocked`, `disabled`, `resolved`, `duplicates`, `pendingArgs`
2. **Msg component** — `apps/web/src/components/chat/Msg.tsx` renders the card JSX (status/type badges + action buttons; blocked cards render Force Create / Cancel; disabled cards render a deleted placeholder)
3. **SSE handling** — `apps/web/src/hooks/useSendMessage.ts` builds cards from `create_*` / `force_create_*` / export `tool_result` events, caches to `cardRef`, persists with the message via `saveMsg`
4. **Card events** — `apps/web/src/hooks/useChatCardActions.ts` listens for `tl-open-card`, `tl-edit-card`, `tl-delete-card`, `tl-move-card`, plus `tl-force-create`, `tl-cancel-dedup`, `tl-save-result`

### Frontend — panel linkage

5. **Panel linkage** — dispatched as `tl-select-task` / `tl-select-note` / `tl-select-report`; listened by `apps/web/src/panels/tasks/useTaskState.ts`, `panels/notes/useNotesState.ts`, `panels/reports/useReportsState.ts`

### Backend (agent loop)

6. **Minimal change** — `apps/api/src/agent/tools/issueTools.ts` `createIssue` returns `{ id, key, title, type, priority, status, description }` (UUID + priority); dedup intercept lives in `apps/api/src/agent/core/agentEngine.ts` (`checkDedup`)

### Frontend (Other)

7. **preFlight** — `preFlightPanel()` in `useSendMessage.ts` only auto-opens panels for explicit `open` commands; creation-type regexes removed
8. _*create_* SSE_* — no `setPanel()` on creation events; pure chat never jumps panels

## Current Status

### ✅ Done

| Feature                     | Status | Notes                                                                                               |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| ChatCard interface          | ✅     | `types/chat.ts` (ChatCard + StagedEdit)                                                             |
| Msg card rendering          | ✅     | Status/type badges; buttons: View (task/report), Edit (task/note), Delete; Save As for export cards |
| Blocked-card rendering      | ✅     | Force Create / Cancel buttons, resolved → grayed out + disabled                                     |
| Card event listeners        | ✅     | open / edit / delete / move + force-create / cancel-dedup / save-result                             |
| Text-input confirm/cancel   | ✅     | `classifyIntent` (flash model) + regex fallback in `useSendMessage.ts`                              |
| Panel linkage (task)        | ✅     | tl-select-task → useTaskState (TasksPanel)                                                          |
| Panel linkage (note)        | ✅     | tl-select-note → useNotesState (NotesPanel)                                                         |
| Panel linkage (report)      | ✅     | tl-select-report → useReportsState (ReportsPanel)                                                   |
| lastToolArgsRef cache       | ✅     | Fixes tool_result missing args                                                                      |
| finalMsg saves card         | ✅     | Persisted to the final message via cardRef                                                          |
| create_issue minimal change | ✅     | returns id + priority + full args (issueTools.ts)                                                   |
| Card DB persistence         | ✅     | ChatMessage.card column + saveMsg/updateMessage                                                     |
| DB migration                | ✅     | Raw SQL ALTER TABLE + prisma db push fallback                                                       |
| DeepSeek JSON cleanup       | ✅     | Non-greedy regex aligned with backend                                                               |

### 🔧 Fixed

1. **cardRef being overwritten** → `if (msgCard) cardRef.current = msgCard`
2. **args truncated at 200 chars** → now passed in full; JSON.parse no longer fails
3. **create_issue missing priority** → return value gains `priority: issue.priority`
4. **Cards not persisted** → Prisma schema + chat router + saveMsg
5. **DB migration race** → raw SQL runs first; server.listen after migration completes
6. **DeepSeek raw JSON leaking** → cleaned with a non-greedy regex

### ✅ Restored (agent loop)

- `streamLLMWithRetry` — exponential-backoff retry (3 attempts) — `apps/api/src/agent/llm/client.ts`
- `suggest_*` guard moved into the agent loop — editor-form guard in `apps/api/src/agent/core/agentEngine.ts`
- Prompt optimization — one-call rule / smart defaults / dedup rules / stop signals — `apps/api/src/agent/prompts/systemPrompt.ts`
- Error recovery — inject fix hints when a tool returns an error — `apps/api/src/agent/core/agentEngine.ts`

### ⏳ Not implemented

- Tool-result truncation — LLM only sees a summary (full tool results are still pushed into the message history)

## Version History

| Version     | Date       | Content                                                    |
| ----------- | ---------- | ---------------------------------------------------------- |
| v0.1.0-beta | 2026-07-09 | Plan C cards fully functional                              |
| -           | 2026-07-09 | Fixed cardRef overwrite, args truncation, missing priority |
| -           | 2026-07-09 | Added card DB persistence + raw SQL migration              |
