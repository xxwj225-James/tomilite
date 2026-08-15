# AI-Native Zero Inbox — Implementation Status

> Status: IMPLEMENTED (divergences from the original plan marked inline)

## Context

The original plan ("download & dump" → AI pipeline, emails rendered inside TasksPanel, no standalone email panel) was implemented with three deliberate divergences:

1. **No auto-issue creation** — emails are never auto-converted into Issues. The user links them manually ("Link Task" → `createLinkedTask` router, which AI-generates the task title/description and writes `issueId` back to the SmartEmail row).
2. **Category 4 emails ARE stored** — all four categories are persisted to `SmartEmail` (cat 4 is stored without a notification).
3. **Email has its own standalone panel again** — `apps/web/src/panels/email/EmailPanel.tsx` at panel `'email'`, NOT a TasksPanel integration. Unprocessed-email count shows as a badge on the sidebar Email menu (`MenuNav.tsx`, `notifyCount`).

## What Was Shipped

### 1. Database — SmartEmail model added, InboundMessage removed

`SmartEmail` in `packages/database/prisma/schema.prisma` (actual fields):

- id, **messageId (@unique)** for dedup, **uid Int** (IMAP UID for fast on-demand fetch), fromAddr, toAddr, cc, subject, date
- category (1-4), summary (AI-extracted), replyDraft (nullable), **bodySnapshot** (first 2000 chars of the body, stored at ingest for "Read Original")
- **issueId (String @unique, FK to Issue, onDelete: SetNull)** — never cascades; developer's DONE history is preserved
- isRead, isReplied, isProcessed, processedAt, **topicGroup** (AI topic grouping, persisted by `groupByTopic`), **archived** (default false; `listSmartEmails` filters archived out)

`InboundMessage` model was removed from the schema.

### 2. IMAP Connector — on-demand full fetch

`packages/email/src/imap.ts`:

- Default poll interval **60s** (`pollIntervalSeconds ?? 60`), not 300s.
- Polling does NOT do a 500-byte partial fetch — new messages are detected by UID range + UNSEEN search, then each new message's full source is parsed once.
- `fetchFullMessage(uid: number)` uses `client.fetch({ uid: `${uid}` }, { source: true, uid: true })` — numeric IMAP UID lookup via the `uid` fetch option, not `fetchOne` (which uses seq by default).

### 3. AI Classification Pipeline — shipped module

`packages/email/src/classifier.ts`:

- Signature: `classifyEmail(msg: NormalizedMessage, apiKey: string, baseUrl: string, flashModel: string): Promise<ClassificationResult>`
- Calls the Flash model with `temperature: 0`, `response_format: json_object`, **max_tokens: 350**, `thinking` disabled for moonshot/deepseek/dashscope; 10s timeout.
- Output: `{ category: 1|2|3|4, summary: string, priority: string, replyDraft: undefined }` — **`replyDraft` is always `undefined`; reply drafts are generated on demand** when the user opens a cat 1/2 email (`generateDraft` endpoint) or clicks "Generate Draft".
- **`heuristicClassify(msg)` fallback** — language-independent heuristic (sender/subject/body signals) used when the LLM is unavailable or the call throws.

### 4. Server Handler — `onMessage` pipeline

`apps/api/src/server.ts`:

- Dedup by messageId, run classifier (LLM → heuristic fallback), **store ALL categories** to `SmartEmail` (cat 4 included, no notification), `bodySnapshot: msg.body?.substring(0, 2000)`.
- `sendNotification()` fired for cat 1 (📥 紧急邮件 / Urgent), cat 2 (📥 新邮件), cat 3 (📥 新通知) — increments `notifyCount` for the sidebar badge.
- **No auto-issue creation** (code comment: "no auto-issue creation — user creates tasks manually").
- Piggyback cleanup after each new email: `cleanupOldEmails()`.

### 5. API Router — actual endpoints (`apps/api/src/routers/email.ts`)

By SmartEmail **id** (not IMAP uid):

- `listSmartEmails` (limit, unprocessedOnly; archived excluded)
- `fetchFullEmail` (by smartEmailId → `fetchFullMessage(uid)` via IMAP connector)
- `getBody` (by id → bodySnapshot, for "Read Original")
- `markRead`, `markProcessed` (by id)
- `cleanup` (manual 12h cleanup)
- `generateDraft` (on-demand AI reply draft, saved to replyDraft), `saveDraft`, `getDraft` (by issueId)
- `createLinkedTask` (by smartEmailId — AI generates title/description/type, creates Issue, writes `issueId` back), `unlinkTask` (deletes the Issue, sets issueId null)
- `sendEmail`, `sendReport` (SMTP), `testSmtp`, `testIMAP`
- `imapStatus`, `connectIMAP`, `disconnectIMAP`, `saveIMAP` (pollIntervalSeconds default 60), `saveConfig`, `stats`
- `subGroupByCategory`, `groupByTopic` (AI sub-grouping; `groupByTopic` persists `topicGroup` back to SmartEmail rows)

### 6. Email UI — standalone EmailPanel (supersedes the TasksPanel plan)

`apps/web/src/panels/email/EmailPanel.tsx` (+ `EmailList.tsx`, `EmailDetail.tsx`, `useEmailState.ts`):

- Standalone panel mounted by `ContentPanel` at `panel === 'email'`; 60s polling when the panel is active.
- Category tabs (All / Urgent / Action Required / Notifications / Other) with counts; per-category AI sub-groups; batch dismiss; AI topic grouping.
- Detail actions: **Read Original** (fetch full body via `getBody`), **Mark Read** (marks read/processed, dismisses), **Reply** (AI draft on demand or manual reply, send via SMTP; sending marks the linked Issue done if one exists), **Link Task** (createLinkedTask) / **Unlink Task**.
- Task selection from an email opens the Tasks panel via `tl-navigate` + `tl-select-task` events.
- Unprocessed-email badge on the sidebar Email menu (`MenuNav.tsx` — `notifyCount > 0` → `.notif-badge`), not a TasksPanel notification bar.

### 7. Settings — EmailTab kept

`EmailTab` stays in Settings for IMAP/SMTP config only (as planned). No email-inbox references remain there.

### 8. Auto-cleanup — BOTH mechanisms shipped

- **Piggyback** on each incoming message (`cleanupOldEmails()` after every `onMessage`).
- **Hourly `setInterval(cleanupOldEmails, 60 * 60 * 1000)`** in `startBackgroundTasks()`.
- Deletes SmartEmails where `isProcessed && processedAt < 12h ago`, **skipping any whose linked Issue is not done** (preserves DONE history; `onDelete: SetNull` never cascades).

## Files Shipped

| File                                                                               | Change                                                                                        |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`                                           | SmartEmail model added, InboundMessage removed                                                |
| `packages/email/src/imap.ts`                                                       | UID-based on-demand full fetch (`fetch({uid})`), 60s default poll                             |
| `packages/email/src/classifier.ts`                                                 | **New** — `classifyEmail(msg, apiKey, baseUrl, flashModel)` + `heuristicClassify`             |
| `packages/email/src/types.ts`                                                      | ClassificationResult type                                                                     |
| `apps/api/src/server.ts`                                                           | `onMessage` pipeline — classify, store all cats, notify cat 1/2/3, piggyback + hourly cleanup |
| `apps/api/src/routers/email.ts`                                                    | Endpoints listed in §5                                                                        |
| `apps/web/src/panels/email/EmailPanel.tsx` (+ EmailList/EmailDetail/useEmailState) | Standalone email panel                                                                        |
| `apps/web/src/components/ContentPanel.tsx`                                         | `'email'` panel route                                                                         |
| `apps/web/src/components/chat/MenuNav.tsx`                                         | Unprocessed-email badge on the sidebar Email menu                                             |

## Verification

1. Save IMAP config → Connect → wait for poll → check SmartEmails created in DB (all 4 categories stored)
2. Email panel shows categorized list with AI summaries
3. Click Read Original → fetches full email from IMAP by UID
4. Click Link Task → Issue created, `issueId` written back; click Mark Read → processed, 12h countdown starts
5. Wait 12h (or trigger cleanup manually) → verify SmartEmail deleted, linked Issue persists if not done
