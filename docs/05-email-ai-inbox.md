# AI-Native Zero Inbox — Implementation Plan

## Context

Replace the current "download & dump" email approach (full body stored in SQLite InboundMessage) with an AI pipeline: IMAP fetches headers → Flash model classifies → creates Issues (not Task model) in existing Task panel → 12h auto-cleanup. No standalone EmailInbox page — everything shown in TasksPanel or as notification badges.

## What Changes

### 1. Database — Add SmartEmail model, modify InboundMessage

Add `SmartEmail` to Prisma schema (`packages/database/prisma/schema.prisma`):
- Lightweight: only AI analysis metadata + partial header (no full body)
- Fields: id, messageId (@unique), **uid Int** (IMAP UID for fast on-demand fetch), from, to, subject, date, summary, category (1-4), replyDraft, isRead, isReplied, isProcessed, processedAt, issueId (FK to Issue, **onDelete: SetNull** — never cascade)
- Leverage existing `Issue` model (what TasksPanel already uses) — create Issue for cat 1/2 emails
- **⚠️ 12h cleanup only deletes SmartEmail row, never cascades to Issue** — developer's DONE history is preserved
- Remove `InboundMessage` model (replaced by SmartEmail)

### 2. IMAP Connector — Two-phase fetch

Modify `packages/email/src/imap.ts`:
- **Phase 1 (auto-poll)**: Fetch only `HEADER.FIELDS (FROM TO SUBJECT DATE)` + `BODY[]<0.500>` (first 500 bytes). Store `uid` from IMAP response into SmartEmail.uid.
- **Phase 2 (on-demand)**: `fetchFullMessage(uid: number)` — uses numeric IMAP UID to directly FETCH full source. Fast O(1) lookup, no string-based message-id search.
- Reduce default poll interval to 300s (5 min).

### 3. AI Classification Pipeline — New module

Create `packages/email/src/classifier.ts`:
- Function `classifyEmail(msg: NormalizedMessage): Promise<ClassificationResult>`
- Calls DeepSeek Flash model (reuse pattern from `agent.ts` guard: `temperature:0`, `response_format:json_object`, `max_tokens:300`)
- Prompt instructs: extract summary (150 chars with key points for cat 3), classify into 4 categories, generate reply draft for cat 1/2
- Returns structured JSON: `{ category: 1|2|3|4, summary: string, priority: string, replyDraft?: string }`

### 4. Server Handler — Rewrite onMessage

Modify `apps/api/src/server.ts` email handler:
- On incoming message: run classifier → get AI result
- Store only to `SmartEmail` (not old InboundMessage)
- If cat 1 or 2: auto-create `Issue` record (project: 'proj-default', title: "[邮件待办] subject", description with AI summary, priority mapped, status 'todo')
- If cat 3: just store SmartEmail — shown as notification
- If cat 4: skip entirely (don't store)
- After classification, emit notification to frontend (via taskRefresh)

### 5. API Router — New endpoints

Add to `apps/api/src/routers/email.ts`:
- `fetchFullEmail` — on-demand IMAP fetch (takes IMAP **uid**, returns full body HTML/text)
- `markProcessed` — marks SmartEmail as processed, sets processedAt
- `listSmartEmails` — returns unprocessed SmartEmails (for notification badge)
- `cleanup` — manual trigger for 12h cleanup
- Auto-cleanup: `setInterval` every hour, deletes SmartEmails where `isProcessed && processedAt < 12h ago`

### 6. Remove EmailInbox, Add Email Notifications to TasksPanel

Modify `apps/web/src/components/ContentPanel.tsx`:
- **Remove**: `EmailInbox` component entirely, `panel === 'email'` route
- **Add to TasksPanel**: 
  - Small notification bar at top for cat 3 emails (just count + "N notifications"). Clicking opens a quick-dismiss card.
  - Email-source Issues shown normally in list — add `📥` icon prefix to title
  - Detail view for email tasks: show AI summary + reply draft (read-only) + action buttons
- **Action buttons for email tasks**:
  - [阅读原文] — fetch full email via API, show in detail panel
  - [已阅知晓] (cat 3) — mark processed, dismiss
  - [✍️ 回复] (cat 1/2) — open reply draft editor, send via SMTP
- **Remove**: Email tab from panel menu (mail icon in sidebar)

### 7. Settings — Simplify EmailTab

Keep EmailTab in Settings for IMAP/SMTP config only. Remove email Inbox references.

### 8. Auto-cleanup — Piggyback on IMAP Poll (no timers)

- **No `setInterval`** — avoids laptop sleep/wake timer drift issues
- Trigger cleanup at the end of each IMAP poll cycle (`checkNewMessages` in `imap.ts`, or in `manager.ts` after handler finishes)
- Delete SmartEmails where `isProcessed && processedAt < 12h ago`
- **Never cascade to Issue** — `onDelete: SetNull` ensures DONE history preserved
- Also delete associated DraftReply if any (separate query, not cascade)

## Files to Modify

| File | Change |
|------|--------|
| `packages/database/prisma/schema.prisma` | Add SmartEmail model, update/remove InboundMessage |
| `packages/email/src/imap.ts` | Two-phase fetch (headers only poll, full body on demand) |
| `packages/email/src/classifier.ts` | **New file** — AI classification pipeline |
| `packages/email/src/types.ts` | Add ClassificationResult type |
| `packages/email/src/index.ts` | Export classifier |
| `apps/api/src/server.ts` | Rewrite onMessage, add cleanup job |
| `apps/api/src/routers/email.ts` | Add fetchFullEmail, markProcessed, listSmartEmails, cleanup |
| `apps/web/src/components/ContentPanel.tsx` | Remove EmailInbox, add email notifications to TasksPanel, email task detail actions |

## Verification

1. Save IMAP config → Connect → wait for poll → check SmartEmails created in DB
2. Check TasksPanel: cat 1/2 emails appear as Issues with 📥 prefix
3. Click [阅读原文] → fetches full email from IMAP and displays
4. Click [已阅] → marks processed, 12h countdown starts
5. Wait 12h (or trigger cleanup manually) → verify SmartEmail deleted, Issue persists
