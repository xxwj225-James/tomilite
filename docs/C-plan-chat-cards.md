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
│ Decoupled via event bus + state machine... │  ← description excerpt (120 chars)
│                                      │
│ [👁 View] [✏️ Edit] [▶ Start] [🗑 Delete] │
└──────────────────────────────────────┘

[View] → panel opens, item selected (read-only)
[Edit] → panel opens, item selected + edit mode
[Start] → task moves to in_progress directly
[Delete] → deletes the DB record after confirmation
```

## Technical Implementation

### Frontend (App.tsx)

1. **ChatCard interface** — defines the card data structure (type, id, title, key, status, ...)
2. **Msg component** — renders the card JSX with status badge + action buttons
3. **SSE handling** — builds cards from `create_*` events, caches to `cardRef`, persists with the message
4. **Card events** — `tl-open-card`, `tl-edit-card`, `tl-delete-card`, `tl-move-card` CustomEvents

### Frontend (ContentPanel.tsx)

5. **Panel linkage** — listens for `tl-select-task/note/report` events and selects the corresponding item

### Backend (agent.ts)

6. **Minimal change** — `create_issue` return value gains `id: issue.id` (UUID) for card deletion

### Frontend (Other)

7. **preFlight** — removed creation-type regexes; no longer auto-navigates to panels
8. **create_* SSE** — removed `setPanel()`; pure chat never jumps panels

## Current Status

### ✅ Done

| Feature | Status | Notes |
|------|------|------|
| ChatCard interface | ✅ | |
| Msg card rendering | ✅ | Status badge + 4 action buttons |
| Card event listeners | ✅ | open / edit / delete / move |
| Panel linkage (task) | ✅ | tl-select-task → TasksPanel |
| Panel linkage (note) | ✅ | tl-select-note → NotesPanel |
| Panel linkage (report) | ✅ | tl-select-report → ReportsPanel |
| lastToolArgsRef cache | ✅ | Fixes tool_result missing args |
| finalMsg saves card | ✅ | Persisted to the final message via cardRef |
| agent.ts minimal change | ✅ | create_issue returns id + priority, full args |
| Card DB persistence | ✅ | ChatMessage.card column + saveMsg/load |
| DB migration | ✅ | Raw SQL ALTER TABLE + prisma db push fallback |
| DeepSeek JSON cleanup | ✅ | Non-greedy regex aligned with backend |

### 🔧 Fixed

1. **cardRef being overwritten** → `if (msgCard) cardRef.current = msgCard`
2. **args truncated at 200 chars** → now passed in full; JSON.parse no longer fails
3. **create_issue missing priority** → return value gains `priority: issue.priority`
4. **Cards not persisted** → Prisma schema + chat router + saveMsg
5. **DB migration race** → raw SQL runs first; server.listen after migration completes
6. **DeepSeek raw JSON leaking** → cleaned with a non-greedy regex

### 🔄 To Restore (agent.ts)

- `streamLLMWithRetry` — exponential-backoff retry
- `suggest_*` guard moved into the agent loop
- Prompt optimization — multi-step execution / smart defaults / dedup / stop signals
- Error recovery — inject fix hints when a tool returns an error
- Tool-result truncation — LLM only sees a summary

## Version History

| Version | Date | Content |
|------|------|------|
| v0.1.0-beta | 2026-07-09 | Plan C cards fully functional |
| - | 2026-07-09 | Fixed cardRef overwrite, args truncation, missing priority |
| - | 2026-07-09 | Added card DB persistence + raw SQL migration |
