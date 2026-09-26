# TomiLite — Architecture & Feature Design

> **Version**: v2.0.3 (see `package.json`)  
> **Date**: 2026-08-15  
> **Positioning**: Single-user local AI productivity tool

---

## 1. Product Positioning

TomiLite is an AI productivity tool for indie developers. Minimalist design, zero-dependency deployment, AI-native interaction, local-first.

**Core strategy**: Local-first — all data stays on the user's machine.

---

## 2. Technology Stack

| Layer        | Technology                                                                                          | Rationale                            |
| ------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Frontend     | React 19 + Vite + Tailwind CSS                                                                      | Modern and fast                      |
| Backend API  | Node.js + tRPC                                                                                      | Lightweight, no Java dependency      |
| Database     | SQLite (Prisma ORM)                                                                                 | Single file, zero config             |
| AI           | DeepSeek Cloud API (SSE streaming)                                                                  | Low cost, good results               |
| Search       | FTS5 full-text search (trigram + `LIKE` fallback for short terms) + local ONNX embeddings           | Replaces pgvector, zero dependencies |
| Desktop      | Electron                                                                                            | Cross-platform installer             |
| Code sharing | npm workspaces (`@tomilite/database`, `@tomilite/email`, `@tomilite/shared`, `@tomilite/shared-ui`) | Shared packages                      |

---

## 3. Architecture

```
tomilite/
├── apps/
│   ├── api/          # tRPC API Server (dev :3091; bundled to apps/api/dist/server.cjs for production)
│   │   ├── src/routers/   # 20 routers
│   │   └── src/agent/     # AI agent: SSE streaming, tools, MCP client (legacy/plain/JSON-RPC)
│   └── web/          # React SPA (Vite dev :3002)
│       ├── src/App.tsx    # Slim shell (~292 lines) — composes hooks + layout
│       ├── src/hooks/     # useSendMessage, useChatThreads, useSessionManager, useUpdates,
│       │                  # useEditorMonitors, useChatCardActions, useFileAttach, useSetupChecks,
│       │                  # useNotifications, useTokenUsage, useChatTasks
│       ├── src/components/chat/  # Msg, MsgList, ChatInput, ChatToolbar, SessionSidebar,
│       │                  # MenuNav, LlmBanner, WelcomeGuide, UpdateBar, ConfirmDialogs
│       ├── src/components/       # ContentPanel, PanelResizeHandle, RobotFace, MarkdownEditor,
│       │                  # UpdateDialog, LoadingScreen, icons
│       ├── src/panels/   # home, tasks, notes, email, reports, mcp, feedback, settings, about
│       ├── src/lib/      # i18n (keyed t() dictionary), constants (MENU/THEMES/LANGS), api, cn...
│       └── src/types/chat.ts     # StagedEdit + ChatCard types
├── packages/
│   ├── database/     # Prisma Schema + SQLite (33 models)
│   ├── email/        # Email client helpers
│   ├── shared/       # Shared code
│   └── shared-ui/    # Shared UI components (npm workspace, not Symlink)
├── electron/         # Electron wrapper (main.js, preload.js)
├── scripts/          # bundle-api, clean-engines, generate-icons, tomat-init, tomat-focus, uninstall
└── mockup/           # Design mockup (HTML)
```

**Data flow (dev)**:

```
Browser ↔ Vite Dev Server (:3002) ↔ tRPC API (:3091) ↔ SQLite
                                            ↕
                                    DeepSeek Cloud API
                                            ↕
                                    GitHub Releases (OTA via electron-updater)
```

**Data flow (production)**: the Electron shell spawns the bundled API (`apps/api/dist/server.cjs`) as a child process on port `API_PORT` (3192 in `electron/main.js`), serves the built SPA statically, and runs a small notification server on :3191 for Cat-1 email alerts.

---

## 4. API Routes (21 routers)

| Router      | Endpoint                                                                                                                                                                                                                                                                                                   | Function                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `issue`     | list, taskCounts, byId, create, update, delete, detach, children, updateRank                                                                                                                                                                                                                               | Issue CRUD + drag-sort + mirror detach      |
| `board`     | getBoard, moveCard                                                                                                                                                                                                                                                                                         | Kanban + drag & drop                        |
| `wiki`      | list, count, byId, create, update, delete, exportNote, importNotes                                                                                                                                                                                                                                         | Wiki CRUD + note import                     |
| `git`       | listWorkDirs, addWorkDir, removeWorkDir, listRepos, addRepo, removeRepo, handleHook, recentRefs                                                                                                                                                                                                            | Git repos + commit linkage                  |
| `focus`     | heartbeat, status, endSession                                                                                                                                                                                                                                                                              | IDE focus tracking                          |
| `system`    | currentVersion, getHomeDir, notifyCount, clearNotifications, mcpPendingCount, getMotto, generateMotto, saveMotto, getConfig, setConfig, saveLanguage, embedStatus, reembed (isSetupCompleted/markSetupCompleted kept as legacy dead code)                                                                  | System config + notifications               |
| `llm`       | getConfig, saveConfig, saveProvider, testConnection                                                                                                                                                                                                                                                        | LLM configuration                           |
| `email`     | listSmartEmails, fetchFullEmail, getBody, markRead, markProcessed, cleanup, getConfig, sendReport, saveIMAP, getDraft, saveDraft, generateDraft, imapStatus, connectIMAP, disconnectIMAP, saveConfig, sendEmail, testSmtp, testIMAP, stats, createLinkedTask, unlinkTask, subGroupByCategory, groupByTopic | Email integration (SmartEmail triage)       |
| `agent`     | /api/agent/stream (SSE), chat, getBoardStatus, getProjectStats, status, classifyIntent                                                                                                                                                                                                                     | AI Agent + tools                            |
| `mcp`       | listTools, execute, confirm, confirmById, deny, getTaskResult, listPending, listAuditLogs, auditStats, pendingCount, transportInfo                                                                                                                                                                          | MCP + HITL                                  |
| `mcpServer` | list, create, update, delete, test, refreshTools, connect, disconnect, listTools                                                                                                                                                                                                                           | MCP server CRUD (per-server config)         |
| `apikey`    | list, generate, revoke, delete, verify                                                                                                                                                                                                                                                                     | Inbound API Key management (SHA-256 hashed) |
| `health`    | personalHealth, healthHistory                                                                                                                                                                                                                                                                              | 5-dimension health score                    |
| `search`    | search, reviewIssue, knowledgeMap                                                                                                                                                                                                                                                                          | FTS5 search + AI Review                     |
| `learn`     | capture, reflect, getContext, stats                                                                                                                                                                                                                                                                        | Self-learning                               |
| `knowledge` | map, organize, neighbors, suggestLinks, applyLinks, distillCandidates, suggestDistill, applyDistill                                                                                                                                                                                                                                                         | Knowledge Map (tree + backlinks) — §6.5     |
| `report`    | list, getLatest, save, delete, markSent                                                                                                                                                                                                                                                                    | Reports CRUD                                |
| `feedback`  | list, create, updateStatus, delete                                                                                                                                                                                                                                                                         | Feedback CRUD                               |
| `chat`      | listSessions, createSession, renameSession, deleteSession, getMessages, addMessage, listThreads, updateMessage, clearMessages                                                                                                                                                                              | Chat sessions + messages (per-session)      |
| `redmine`   | getConfig, saveConfig, testConnection, vocabularies, preview, sync, status, disconnect                                                                                                                                                                                                                     | Read-only ticket mirror (§6.15)             |
| `standup`   | getMorningStatus, getMorningBrief, getEveningStatus, getEveningReport, getSettings, saveSettings                                                                                                                                                                                                           | Morning check-in + evening auto-report      |

**One route is not tRPC**: `POST /api/mcp` (`apps/api/src/mcp/http.ts`) is the
StreamableHTTP MCP endpoint. It is mounted before the tRPC handler in `server.ts`, speaks
JSON-RPC rather than the tRPC envelope, and is dispatched by the same code the stdio
transport uses. It shares no procedure with the table above — but it reaches the same tool
implementations through `/api/mcp.execute`, so there is exactly one place where risk, HITL
and auditing are decided. See §6.9 and [mcp-client.md](mcp-client.md) §6.

---

## 5. Database (SQLite via Prisma)

33 models; key tables:

| Model                                                              | Purpose                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `Issue`                                                            | Task management (type, status, priority, storyPoints, sortOrder...)                                                 |
| `Board` / `BoardColumn` / `BoardCard`                              | Kanban                                                                                                              |
| `Sprint` / `Comment` / `IssueChangelog`                            | Sprint planning, comments, change history                                                                           |
| `KnowledgePage`                                                    | Wiki/notes; `source`/`sourceId` mark machine-written rows (chat distillation) vs. user-authored                     |
| `PersonalNote`                                                     | Notes                                                                                                               |
| `FocusSession`                                                     | Focus sessions                                                                                                      |
| `GitWorkDir` / `GitRepo` / `GitCommitRef` / `GitCommit`            | Git integration                                                                                                     |
| `SmartEmail`                                                       | Email triage (AI summary, reply draft, linked issue)                                                                |
| `ApiKey`                                                           | Inbound API Key (stored as SHA-256 hash)                                                                            |
| `McpServer` / `McpAuditLog`                                        | MCP server config + audit                                                                                           |
| `AiDecisionFeedback`                                               | Self-learning feedback                                                                                              |
| `UserHealthSnapshot`                                               | Health history                                                                                                      |
| `DailyMotto`                                                       | Daily motto cache                                                                                                   |
| `Report`                                                           | Reports (daily/weekly)                                                                                              |
| `ChatSession` / `ChatMessage`                                      | Chat sessions + messages; `distillCursor`/`distillAt`/`distillMeta` are the distillation watermark + run accounting |
| `LlmProviderMaster` / `LlmProvider` / `LlmConfig`                  | LLM configuration                                                                                                   |
| `SystemConfig` / `KnowledgeCache` / `Integration` / `FeedbackItem` | Misc                                                                                                                |

### 5.1 Timestamps — which clock a stored stamp is on

Every timestamp is a `String` shaped `YYYY-MM-DD HH:MM:SS`, and on the normalised tables
that text is **UTC**. The helpers that do the reading and writing live in
`apps/api/src/lib/dbTime.ts` (API) and `apps/web/src/lib/dbTime.ts` (renderer); the
invariant is:

> **Every write goes through `utcStamp()`. No row is born from a column default.**

The second half is the load-bearing one. `schema.prisma` still declares
`@default(dbgenerated("(datetime('now','localtime'))"))` on most models, because changing a
column default in SQLite requires a full table rebuild — so a `create()` that forgets its
timestamps silently reintroduces a second clock, and the stored text cannot tell you which
one wrote it.

**What the bug looked like.** Two clocks fed the same columns: the localtime default and
~26 inline `new Date().toISOString()` call sites. Nothing in the stored text says which
one wrote a given row, so the conversion rests on two discriminators:

- `updatedAt = createdAt` ⇒ no update ever ran ⇒ the default wrote both ⇒ localtime. Its
  converse is equally firm: a real update is never earlier than its creation, so
  `updatedAt < createdAt` ⇒ that stamp is already UTC.
- `updatedAt > datetime('now', '+1 minute')` ⇒ a future stamp cannot have come from a UTC
  writer on this machine ⇒ localtime. This is the case the first discriminator misses: an
  update path that also wrote local time bumps the stamp _past_ its created value, so
  equality alone reads it as untouched-and-already-UTC and leaves it 8h in the future. It
  was found by asserting on every timestamp column in rehearsal, not by reading the code.

What neither covers is a second stamp whose distance from creation is positive but smaller
than the UTC offset — a localtime edit minutes later and a UTC edit hours later are the
same text. Those rows are left as-is and counted in the log rather than guessed at (4 rows
in the dev database).

Note what the _obvious_ test would have missed: `WHERE stamp > datetime('now')` only finds
a localtime row while the row is younger than the UTC offset, so it sees recent bad writes
and no old ones. It is a probe, never a proof.

**Scope, measured.** Thirteen tables were converted. `Issue`, `ChatSession`,
`KnowledgePage` and `McpServer` carry a mixed `createdAt`/`updatedAt` pair; `Report` is the
same shape with the second stamp named `generatedAt`. Seven more have a `createdAt` only
the default ever wrote, so converting all of it is the whole fix: `SmartEmail` 959,
`GitCommit` 407, `ChatMessage` 172, `KnowledgeCache` 99, `UserHealthSnapshot` 67,
`McpAuditLog` 14, `AiDecisionFeedback` 1. `FocusSession.startTime` (17430 rows) and
`ChatSession.distillCursor` (7, a message stamp copied verbatim) are the remaining singles.

Four of those are not display nuances — they drive a cache or a window compared against a
UTC cutoff, so the 8h skew had silently widened each one: the health-snapshot cache TTL
(`routers/health.ts`), the knowledge cache TTL (`routers/knowledge.ts`), the self-learning
feedback window (`agent/core/selfLearning.ts`) and the MCP pending-approval staleness
filter (`routers/mcp.ts`). The same skew also held the report archiver 8h late
(`server.ts`) and put the git day-boundary filter on the wrong window (`routers/git.ts`,
`agent/tools/gitTools.ts`).

Two _display_ defects came out of the same sweep, both from slicing stored text instead of
parsing it. `SmartEmail.date` holds the email's own `Date:` header normalised to UTC, and
both the list and the detail view printed `substring(5, 16)` of it — every arrival time read
8 hours early at UTC+8. `ApiKey.createdAt` (local, from the default) and `ApiKey.expiresAt`
(an ISO `Z` instant) shared one line, each sliced the same way, so one of them was always
the wrong day.

`GitCommit.timestamp` is a _shape_ fix rather than a clock fix: every value was already an
ISO string carrying its own `+08:00`, so it named a correct instant, but string comparisons
against it could not line up with the naive-UTC columns. It is normalised under a `LIKE`
guard that only matches offset-bearing text, which makes it idempotent by construction and
keeps a naive value from being shifted the wrong way. All 407 rows still resolve to the
identical instant.

**Why the migration is not a versioned one.** `lib/clockUtc.ts` follows
`lib/ftsIndex.ts`: its own `SystemConfig` stamp (`clockVersion`, `issueDefaultVersion`),
written **inside** the transaction that did the work, re-evaluated on every boot if it is
absent, and it never touches `SCHEMA_VERSION`. The conversion is not idempotent — nothing
in the text says whether it already ran — so the stamp is written before `COMMIT`;
a process that died in between would otherwise shift every stamp a second time, twice.

It also refuses to run at all unless the database still shows the old default
(`Issue`'s DDL containing `localtime`). A fresh install is already UTC by construction —
`ensureSchema()` pushes the schema into the empty file _before_ `ensureSearchIndexes()`
creates `global_fts`, so it gets the UTC defaults and its rows are all explicit — and
running the conversion there would be the bug it exists to fix.

**`Issue` gets UTC column defaults** (the one table this project changed): its stamps drive
the dates the task board renders, so a mixed column there is a visibly wrong day. SQLite
cannot `ALTER` a default, so `ensureIssueClock()` rebuilds the table from the **live** DDL
in `sqlite_master` with the two defaults swapped — never from a literal copy of the
schema's 30 columns, which would rot. Two things a naive rebuild gets wrong and this one
handles: the seven inbound foreign keys (values saved, nulled, and restored around the
swap, so the result does not depend on `PRAGMA foreign_keys` having taken effect — a pragma
set inside a transaction is silently ignored) and the `fts_issue_i/u/d` triggers, which
`DROP TABLE` takes with it and only a full index rebuild would restore.

**Leaving a table on localtime.** Every remaining timestamp column was measured as
_uniformly_ local — writer, default and reader all agree, so the column is self-consistent
and nothing renders it wrongly. `Meeting` is the clearest case: its stamps come from
`nowStr()` (local), its audio-retention cutoff is computed in local time to match
(`lib/meeting/retention.ts`), and its list prints `.slice(0, 16)` of the raw text. Same for
`ApiKey.createdAt`. Converting one of these without flipping every writer is what _creates_
a mixed column, so they are left alone deliberately.

The defect was never "a column is not UTC" — it was **two clocks in one column**, or a
reader that assumes the wrong one. That is the test to apply before touching any of these.

**One external timestamp, two different treatments — do not unify them.** The Redmine
connector (§6.15) reads a field called `updated_on` and uses it for two purposes that look
like the same thing and must not be handled the same way:

| Used as | Treatment | Why |
| --- | --- | --- |
| `Issue.updatedAt` | `utcStamp(new Date(updated_on))` → naive UTC | It is a stored stamp; the invariant above applies to every `*At` column without exception. Storing Redmine's raw string would put a `T`-bearing ISO value in a column compared as text — and `'2026-01-07T…'` sorts after **every** `'2026-01-07 …'`, so a mirrored row would win every `ORDER BY updatedAt DESC` tie and the task board would float stale tickets to the top. |
| the incremental sync cursor | stored **verbatim**, in `SystemConfig['redmine.cursor']` | It is never compared to a column. It is sent straight back as the `updated_since` query parameter, and Redmine requires `YYYY-MM-DDTHH:MM:SSZ` — the exact shape it handed out. Converting it means reconstructing a format the server already specified, from a value the server already gave us. |

Both live in the same file, a few lines apart, and reading either one alone makes the other
look wrong. `ChatSession.distillCursor` is the precedent for the second row: a watermark
copied verbatim from a foreign writer, deliberately not normalised. Normalising the cursor
is a no-op today at UTC+0 and a silent one-hour data skip in a DST zone; normalising in the
other direction (storing the ISO into the column) passes every test written on a machine
whose clock is UTC and breaks on the user's.

### 5.2 The task set — what counts as a task

`apps/api/src/lib/taskScope.ts` is the single definition:

```ts
type !== 'email' && status ∈ ['todo', 'in_progress', 'done', 'in_review']
```

Two shapes of the same rule live in that one file: `isTask(row)` for callers filtering in
JS, and `TASK_WHERE` for callers filtering or counting in SQL. Eleven call sites use it —
the board, the Home stat card, the health score, `mcp.get_project_stats`,
`agentRouter.getProjectStats`, the search prompt, standup, and the agent's `get_stats` and
`list_issues` tools. The `in_review` → `inProgress` folding is part of the definition
rather than something each caller re-decides.

Two failure modes this prevents, both of which produce plausible-looking wrong numbers
rather than an error:

- **Counting the table instead of the task set.** `Issue` rows with `type: 'email'` are
  mailbox items the Email panel mirrors, and `cancelled` has no column on the board. The
  raw table was 144 where the board's total was 109 — the agent answered "144 tasks,
  63 done" to a user looking at a card that said 109 and 54.
- **Counting a page instead of the set.** `issue.list` is capped at 200 rows. Any badge
  derived from the fetched array silently under-reports once the table passes that, so the
  Home panel and the task board would disagree again the moment they fetched differently.
  `issue.taskCounts` counts in SQL over the whole set and is what the tab badges render.

**`isImported` answers a different question, and that is why it is a second function.**
Rows mirrored from an external tracker (`source !== null`, see [Redmine import](#615-redmine-import--read-only-mirror))
are tasks — they are counted by every caller above, deliberately and with no scope switch.
They are also the only rows this app may not write to. `isTask` answers "does this count
as work"; `isImported` answers "may this app modify it". Folding them into one predicate
would force a choice between under-counting the user's workload and letting a local edit
be silently reverted by the next sync. The four writers that guard on `isImported` are
listed in [tasks-panel.md](tasks-panel.md).

---

## 6. Feature List

### 6.1 Core Interaction — Chat-First UI

```
┌────────────────────────────────────┐
│ Sessions │  lang ▼  ●●●●  Compress Clear│
│ + New    │                          │
│ Chat 1   │  🤖 WelcomeGuide         │
│ Chat 2   │  [6 suggestion chips]    │
│          │  User: create a bug...   │
│ 0/100k   │  Agent: ✅ Created TL-3  │
├──────────┴─────────────────────────┤
│  [+]  [Ask me anything...]      [↑] │
│  [Tasks] [Notes] [Home] [Email] ... │  ← MenuNav (always visible)
│  Enter to send · Shift+Enter new line│
└────────────────────────────────────┘
```

- **Conversation is the main UI** — chat with a session sidebar and an always-visible bottom menu bar (`MenuNav`)
- **Menu** — 9 panels: Tasks / Notes / Home / Email / Reports / MCP Approve / Feedback / Settings / About
- **Right slide-in panel** — chat area shrinks but stays usable; panels lazy-mount in `ContentPanel`
  - **A panel mounts once and is then hidden, never unmounted** — so `useEffect(…, [])` inside a panel is "once per app run", not "once per visit". A panel that must show fresh data keys off the `active` prop (`panel === '<id>'`), which goes false→true on every return and is the only remount-shaped signal the keep-alive route gives. `EmailPanel` polls on it, `MeetingPanel` holds its SSE stream open only while it is true, and `HomePanel` re-reads `health.taskStats` on it — before that, the Home task card was fetched in a `[lang]` effect and showed whatever the numbers were when the app started.
- **SSE streaming output** — renders token by token, typewriter effect
- **Session sidebar** — session list with rename/delete + token usage meter (`SessionSidebar`)
- **Rich result cards** — a tool result renders as a card (`apps/web/src/types/chat.ts`), e.g. a task with 👁/✏️/🗑 actions. When one turn creates **several** tasks, they collapse into a single `task_batch` card: one table, one row per task, each row's buttons acting on that row only (`TaskBatchCard.tsx`). Rows carry the card object itself into the existing `tl-open-card` / `tl-edit-card` / `tl-delete-card` events, so the action layer needed no change. A batch card is only emitted for ≥2 tasks — a single task keeps the old single-card rendering, and old persisted rows parse unchanged

### 6.2 AI Agent

- **~35 built-in tools** (`apps/api/src/agent/tools/registry.ts` + `emailTools.ts`): issues (`create_issue`, `force_create_issue`, `get_issue`, `list_issues`, `update_issue`, `suggest_issue_edit`), notes (`create_note`, `update_note`, `list_notes`, `search_notes`, `suggest_note_edit`, `force_create_note`), reports (`create_report`, `update_report`, `get_report`, `list_reports`, `delete_report`, `suggest_report_edit`, `polish_report`, `summarize_report`, `expand_report`, `translate_report`, `force_create_report`), email (`list_emails`, `edit_email_reply`, `send_email_reply`, `read_email_original`, `dismiss_email`, `delete_email`), search (`search_local_data`, `web_search`, `fetch_url`, plus `brave_search` when a Brave key is present), meetings (`list_meetings`, `get_meeting`), git (`list_git_commits`, `list_workspaces`), stats/exec (`get_stats`, `shell_exec`), export (`export_to_excel`, `export_to_doc`), plus MCP-injected tools as `mcp__<server>__<tool>` (capped at 25)
- **`fetch_url`** (`agent/tools/fetchTools.ts`) is the only tool that opens a page: `web_search` queries Bing and returns `{title, url, snippet}` without ever fetching a result, so before this, "read what this link says" had no answer at all. It is http/https only, refuses local and private addresses **on every redirect hop** (the API exempts localhost from its token check, so a fetched page must not be able to reach this app's own tRPC surface), enforces a 15 s deadline plus download and returned-text caps, and strips markup to readable text. GitHub repo/blob/tree URLs are rewritten to the raw and contents endpoints, because github.com renders those pages client-side and their HTML contains neither the README nor the file listing; relative markdown links in a README are made absolute so the one link that answers the question can actually be followed

- **LLM Function Calling**: streaming + tool calls; tools are pruned based on open editors, and any tool that cannot work in the current environment is withheld rather than offered and failed (e.g. `brave_search` without a key)
- **Fallback strategy**: no API Key → `LlmBanner` soft-gate banner blocks sending until configured (no wasted API call)

### 6.3 Personal Health Score (AI Health)

5-dimension rules engine:

- `completion` — Issue completion rate
- `velocity` — recent completion velocity
- `focus` — deep-flow duration
- `git_activity` — Git commit frequency
- `staleness` — Issue staleness

LLM-polished summary (optional); snapshots stored in `user_health_snapshots`.

### 6.4 FTS5 Search + AI Issue Review

- **Full-text search**: local sources — issues, notes, reports, emails, git commits (`search_local_data`) — plus real web search via the app's own HTTP fetch (`web_search`, Bing RSS). It needs no API key and no LLM with native search, so it behaves the same on every provider including the hosted gateway; `brave_search` (Brave Search API) is offered only when a Brave key is configured
- **AI Review**: duplicate detection (≥70% match flagged high-risk), title quality, description completeness, story-point reasonableness
- **LLM polish**: optional DeepSeek analysis

**The index** (`apps/api/src/lib/ftsIndex.ts`) is built and repaired by
`ensureSearchIndexes()`, which runs on every boot _before_ the server listens:

- `global_fts` is a regular (non-contentless) fts5 table over seven source tables —
  `Issue`, `KnowledgePage`, `SmartEmail`, `GitCommit`, `Report`, `ChatMessage`, `Meeting` —
  with `type` and `ref_id` marked `UNINDEXED`. `UNINDEXED` matters: previously `type` was
  searchable, so a query for `note` matched every note through the type column rather than
  through content
- **A chat message is indexed with an empty `title` and its text in `body`**, and a meeting
  as one row (title + minutes + summary + transcript) rather than one row per transcript
  segment. The empty title is deliberate: a message has no short title to index, and
  storing the session title there instead would mean rewriting every one of the session's
  messages on each rename. The palette shows the session title, which `searchCore` joins at
  read time. The meeting choice keeps the index proportional to the library rather than to
  how much was said in it — a meeting's segments are its transcript, and the panel already
  searches inside them with `meeting.searchSegments`. Both `ChatMessage` and `Meeting`
  declare `updateOf`, so their triggers are `AFTER UPDATE OF <the indexed columns>` rather
  than `AFTER UPDATE`: transcription writes `transcribeStatus`/`aiStatus`/`jobStage`
  repeatedly, and a bare trigger would copy the whole transcript into the index each time
- **`git` is indexed but is not a search result.** `GitCommit` stays in the index because
  the agent's `search_local_data` reads it; the palette's endpoint filters it out with an
  explicit `type IN (...)` list, since the six kinds it shows do not include commits
- **Tokenizer is `trigram`** (SQLite ≥3.34): any substring of ≥3 characters matches,
  which is what makes Chinese search work at all. The previous `porter unicode61`
  tokenizer treated a whole run of Han/Kana as ONE token, so a CJK query matched only when
  it equalled an _entire_ run in the row — `数据库迁移` matched a row whose text was
  exactly that, but never a row where the phrase appeared inside prose. Every substring
  query missed, which for a Chinese-speaking user meant search silently returned nothing
- **A term shorter than 3 characters is structurally unsearchable.** 2-character Chinese
  words (`迁移`, `沉淀`) are the common case in Chinese input. `lib/fts.ts` classifies
  them (`unsearchableTerms`) and each reader falls back to a `LIKE` scan when its FTS
  result is empty. This limit is asserted in `scripts/test-fts.mts` so it cannot later be
  mistaken for a regression
- **Quoting is mandatory** on every MATCH: raw input can contain `-` (which fts5 parses as
  an operator) or a lone `"` (unterminated string), and both throw. `toFtsMatch()` quotes
  each term and doubles embedded quotes; it returns `null` when nothing is searchable.
  The three readers keep **OR** between terms, never AND, because all three sort by `rank`
- **Rebuild, not migrate**: the DDL is swapped inside one `BEGIN IMMEDIATE` transaction
  that drops all 21 triggers _before_ the table, recreates the table unconditionally, and
  repopulates without `OR IGNORE`. The trigger ordering is load-bearing — a surviving
  `fts_*` trigger makes every `INSERT`/`UPDATE`/`DELETE` on its source table throw
  `no such table: main.global_fts`. Dropping the _source_ table cleans its triggers;
  dropping the _fts_ table does not
- **Populating once**: the old boot path ran five unconditional `INSERT OR IGNORE ... SELECT`
  statements. FTS5 tables have no unique constraint, so `OR IGNORE` never fired and every
  launch copied the whole corpus again — one real database had 498,107 index rows for
  1,596 source rows (1.43 GB, 95% of the file). The rebuild now runs only when the
  tokenizer, the `ftsVersion` stamp, or a row-count drift check says it must, and a
  one-time `VACUUM` (deferred 120 s past `listen()`) reclaims the freed pages

> **Why the rebuild is not a versioned migration:** `ensureSchema()`'s migration loop
> treats a failure as non-fatal and — until v24 — stamped `schemaVersion` on **both** the
> success and the failure branch, so a failed migration was never retried, and there is no
> pre-migration DB backup. A rebuild that half-applied there would leave the index broken
> permanently. `ensureSearchIndexes()` instead stamps its own `ftsVersion` only after the
> indexed row count reconciles with the source tables, so any failure is re-evaluated and
> retried on the next boot. It does not touch `SCHEMA_VERSION` at all. `lib/clockUtc.ts`
> (§5.1) is the second user of this pattern, for the same reason.

> **`db push` and the index:** Prisma does not know about `global_fts` or its five shadow
> tables, so a `db push` proposes dropping all six and — because `server.ts:837` passes no
> `--accept-data-loss` — is _refused_. A refused push changes nothing, so the index is
> never at risk; `ensureSearchIndexes()` runs after `ensureSchema()` and self-heals
> regardless. The consequence that does matter is on the schema side: `db push` only runs
> when `SCHEMA_VERSION` is bumped, and it is refused whenever the index exists, so the
> additive `migrations[]` array (`server.ts:602`) is what actually delivers schema changes
> to existing installs. A `schema.prisma` change with no matching entry there never
> reaches them.
>
> **Since v24 this is explicit rather than accidental.** `ensureSchema()` checks for
> `global_fts` first (`server.ts:799`) and skips `db push` outright on a database that has
> it, logging that the migration array and the self-healing functions are the delivery
> path. Previously it ran the doomed push on every launch of every existing install and
> then stamped `schemaVersion` anyway — 60 wasted seconds and a permanent silent no-op that
> looked exactly like success. A failed push now leaves the version **unstamped** and
> records `SystemConfig.schemaPushError`, so it is retried and visible instead of being
> swallowed (`server.ts:859-870`)

### 6.4.1 Semantic search (local embeddings)

Keyword search cannot answer a Chinese question against an English-titled note, and it
cannot answer a 2-character Chinese query at all (trigram's structural limit, above).
Embeddings cover both. The vector machinery already existed in the codebase — a `vector`
column, `cosineSimilarity`, `semanticRank`, `searchNotesSemantic` — but had never produced
a vector: `embedText` called the LLM's `/embeddings` endpoint behind
`!isDeepseekEndpoint(baseUrl)`, which matches DeepSeek _and_ the hosted gateway and sat
alongside an explicit `anthropic` exclusion. That guard killed two of the five providers
the app configures (DeepSeek, Anthropic) — DeepSeek being the default — and also killed the
hosted gateway, which is not a provider but the trial/Pro path, so those users got `null`
on every call. It admitted the other three (OpenAI, Kimi, Qwen), and OpenAI and Qwen users
therefore stored a 1536- or 1024-dim vector in the same column a 384-dim query reads. A
length mismatch makes `cosineSimilarity` return 0, so those rows ranked last forever with
nothing logged. The first outcome is a missing feature; the second is a corrupting one,
which is why the remote branch was deleted rather than re-guarded and why the `{v,m}`
envelope ships with it — a foreign vector has to be a miss that forces a recompute, not a
zero.

- **Model**: `Xenova/multilingual-e5-small`, quantized (`q8` → `onnx/model_quantized.onnx`),
  384 dimensions, run in-process by `onnxruntime-node` via `@huggingface/transformers`.
  Chosen for cross-lingual retrieval: a Chinese query ranks an English passage first
  (`scripts/test-embed.mts` §3). It is multilingual, so it also covers ja/en without a
  second model.
- **Delivered on first use, not bundled.** Four files, 135,441,016 bytes total, fetched
  into `<DATA_DIR>/models/embed/<modelId>/` by `lib/embed/modelFiles.ts`, which reuses
  whisper's `downloadOnce` (stall watchdog, `.part` + rename, content-length check) and adds
  a pinned SHA-256 per file. transformers.js' own downloader validates nothing, and a
  truncated weight file does not fail loudly — it loads and produces quietly wrong vectors,
  the worst possible failure for a retrieval feature. Host order is **hf-mirror first**,
  the reverse of whisper's, because `huggingface.co` is unreachable from some networks
  (measured: connection failure, while the mirror returned 200).
- **`query: ` / `passage: ` prefixes are welded into `embedQuery` / `embedPassage`**, never
  left to callers. e5 was trained with that asymmetry; omitting it yields a model that runs
  fine and retrieves badly. `pooling: 'mean'` + `normalize: true` + `truncation` +
  `max_length: 512` are equally mandatory — without pooling, `feature-extraction` returns a
  `[tokens, 384]` tensor and cosine yields `NaN` rather than an error.
- **Stored as a `{v,m}` envelope**, `{"v":[…],"m":"Xenova/multilingual-e5-small@q8"}`, 5
  decimal places. `decodeVector` returns `null` for anything else — a bare array (the shape
  the removed remote path would have written), a different model or quantization, a wrong
  length, or unparseable JSON — which forces a recompute instead of a silent zero. A
  dedicated `vectorMeta` column was rejected: it means `SCHEMA_VERSION` 24, a raw migration
  entry, and a `db push` against the user's database on the path that never retries a
  failure and takes no backup. The envelope gets the same invalidation semantics for zero
  migration surface.
- **Queued by triggers, not by writers.** `embed_queue` plus six triggers
  (`embed_{note,report}_{i,u,d}`) are created in the same versioned rebuild as the FTS index,
  so there is one self-healing path rather than two. There are ~24 places that write a note
  or a report; a trigger covers all of them, including ones written next quarter, with no
  edits to any of them. `AFTER UPDATE OF title, content` means a status-only update does not
  re-embed, and because the queue is durable an interrupted backfill resumes.
- **`drainEmbedQueue` refuses to run unless the model is usable** (`embedModelStatus() ===
'ready'`). Without that guard an unavailable model fails every row, and five drains later
  the `MAX_ATTEMPTS = 5` ceiling would have deleted the entire queue — permanently, since
  the backfill stamp is already set. Nothing is consumed while the model is missing; the
  backlog waits.
- **Nothing on the request path waits for the model.** Building the ONNX session costs
  **12–13 s** (measured, identical on a warm filesystem cache — this is not cache noise;
  per-inference cost is 12–17 ms afterwards). Three non-blocking timers in
  `startBackgroundTasks()`: 45 s to build the session, 90 s for the backfill/download/drain
  sweep, then 60 rows per minute. `knowledgeRecall`'s fallback is gated on the synchronous
  `isEmbedLoaded()` for exactly this reason — a cold process skips it rather than stalling a
  turn for 13 s.
- **Fusion is RRF, not score blending.** `searchNotesSemantic` runs two lists — BM25 over
  `global_fts` and cosine over stored vectors — and fuses them with reciprocal rank fusion,
  `k = 60`. BM25 rank and cosine have no common scale, and normalizing them would need
  per-corpus tuning that silently stops working as the corpus changes shape; RRF uses only
  the _order_ each list produced. Either list being empty degrades RRF to the other's order.
- **No similarity threshold anywhere, and that is measured rather than omitted.** On a real
  35-note corpus, e5 vectors are anisotropic enough that the score distribution cannot
  distinguish a good query from a bad one:

  | query                   | top    | top−mean | top−2nd | z    |
  | ----------------------- | ------ | -------- | ------- | ---- |
  | `数据库迁移` (real)     | 0.8391 | 0.0379   | 0.0029  | 1.41 |
  | `如何种植番茄` (absent) | 0.8606 | 0.0659   | 0.0129  | 1.80 |
  | `zzzzzzzz…` (gibberish) | 0.8486 | 0.0348   | 0.0076  | 2.84 |

  Gibberish outscores the real query on every statistic and the absent-topic query beats
  both, so a cut-off would be fitted noise. The ordering is still useful — the correct note
  ranked #1 for every real probe — but it means a no-hit query returns the closest available
  notes instead of none, which is the accepted cost of the same property that makes
  cross-lingual and 2-character queries work. (The old `semanticRank` gated on
  `score > 0.5`, a value calibrated for OpenAI embeddings that e5 satisfies for every
  query; it now gates on whether the _candidates_ have usable vectors at all.)
- **The second reader of `decodeVector` is `knowledge.neighbors`** (§6.5), which returns the
  top-N stored vectors by cosine for one note. It is a separate procedure because `map` must
  never carry ~3 KB of vector per row on a call made at every panel activation. It returns
  the score and the UI deliberately does not render it — same measurement as above. Whether
  a neighbour list is possible at all is decided by `decodeVector(x) !== null`, never by the
  score, since `cosineSimilarity` returns `0` for both orthogonal and missing vectors; the
  failure is reported as `no-vector` / `no-peers` / `note-missing` rather than as an empty
  list.

- **The global search palette (`lib/searchCore.ts`) takes the no-threshold property as a
  design constraint rather than fighting it.** Its keyword list and its cosine list are
  fused the same way, but with `w_semantic = 0.5` against `w_keyword = 1.0`. Equal weights
  would make keyword #1 and semantic #1 tie exactly at `1/(k+1)`, so fusion would degenerate
  into strict alternation: a query that matches a message verbatim would come back with an
  unrelated note between every hit. At 0.5, semantic #1 (`0.5/61 = 0.008197`) still ranks
  below keyword #60 (`1/120 = 0.008333`), so every keyword hit outranks every semantic one —
  a property the UI depends on, and one `scripts/test-search.mts` asserts. The constant is
  tied to the keyword list's length; changing one requires changing the other, and the test
  is what notices.
- **Rows found only by meaning are labelled in the UI**, and the panel says when the
  semantic list is unavailable or still warming. This follows directly from the table above:
  since no threshold can filter a bad query's nearest neighbours, the user is the only thing
  that can tell a lucky semantic hit from a wrong one, and an unlabelled row gives them
  nothing to judge with. For the same reason a deep link carries its provenance — a chat hit
  knows its session, a meeting hit knows whether the term came from its transcript.

- **Degradation is total and quiet**: no model installed → `embedQuery` returns `null` →
  the embedding list is empty → RRF reduces to BM25 order → keyword search and every other
  feature is unaffected, with no error shown. `TL_EMBED_DISABLE=1` switches the whole
  subsystem off; `TL_EMBED_MODEL` and `TL_EMBED_MODEL_MIRROR` override the model and hosts.
  `system.embedStatus` reports state, queue depth, embedded count and the last error;
  `system.reembed` re-queues everything (and is the only path that resets `attempts`).
- **Packaging**: `@huggingface/transformers` is `external` in `scripts/bundle-api.js` and
  `onnxruntime-web` plus the non-`win32/x64` ONNX runtimes are excluded in `build.files`.
  `sharp` is a _production_ dependency at `^0.34.5` — `transformers.node.cjs` requires it
  unconditionally at top level, electron-builder installs only the production tree, and the
  range has to match the version transformers declares or npm keeps a second nested copy.
  Net cost: **+20–35 MiB** on the installer (ORT runtime only; the model is never bundled).

### 6.5 Knowledge Map

A tree of AI-named topics whose **leaves are real notes**, plus a per-note card carrying
outgoing links, backlinks and semantic neighbours. Nothing in it is prose the user cannot
open, and generating it is a button — never a side effect of opening the home panel.

The tree is stored as note **ids only** in `SystemConfig['knowledge.map.v1']` (no schema
change); titles and counts are joined from live rows at read time, so a deleted note cannot
leave a dangling entry. Its invalidation key is the sorted note-id set plus the language,
not a content hash — a tree that reshuffles on every save is worse than no tree. Every
structural safeguard exists because the alternative silently corrupts more than one note:

- notes go in **numbered**, the model answers with **numbers only**, so a hallucinated title
  is not a failure mode that has to be caught;
- `minIndex === 1 && maxIndex === n` is asserted first — a 0-based answer offsets **every**
  leaf by one while coverage checks still pass;
- depth ≤ 3, ≤ 12 children, ≥ 2 children per internal node, root topics in `[2, ceil(n/4)]`
  (coverage alone is satisfied by one bucket holding all 39 notes);
- pruning **promotes** survivors to the grandparent rather than cascading, re-asserts
  coverage afterwards, and rejects the whole tree if a leaf would be lost;
- `finish_reason === 'length'` is failure — a truncated tree is never stored;
- anything that fails falls back to a category-derived tree marked `degraded`, so the user
  never sees an error, and **no note can leave the map**.

Links are explicit `[[Title]]` (parse, resolve, inverse for backlinks — `lib/noteLinks.ts`)
plus the stored vectors. A title is **not** a unique key: on the reference corpus 7 of 39
notes shared a title across 3 groups, so an ambiguous link renders with its candidate count
and expands rather than silently picking one, and an ambiguous title is never proposed as a
backfill target. Backfill writes an append-only section behind a `<!-- tl-links:v1 -->`
sentinel, which makes the operation idempotent — an existing section is rewritten from the
sentinel to EOF and **nothing above it is touched**. `suggestLinks` (model, read-only) and
`applyLinks` (no model, writes the ticked set verbatim) are separate calls on purpose: at
any temperature, re-deriving on apply means the set reviewed and the set written can differ.

On the card there is exactly **one** header button, labelled `Organize notes` / `Organize new
notes` / `Re-organize`, and the two reasons the stored tree no longer matches the request are
rendered as banners above it: `stale` (loose notes exist) and `lang` (the tree was generated
in another language, whose topic names are baked in and change only on the next run). Both
fields had been in the response since the map was first written and neither was ever shown,
which made a language switch look like nothing had happened. A failed re-read keeps the
previous tree, so that case carries its own banner and inline retry.

Tasks, report months and meetings reach this map too — but as **notes**, through the harvest
dialog, not as a second kind of leaf. A leaf is a note id, and everything the map does with one
(open the note, resolve `[[links]]`, score semantic neighbours) needs that id, so a task row
would be a row the rest of the feature cannot walk. Folding a finished task, a month of reports
or a meeting's decisions into a note means it inherits the FTS index, the embedding queue, the
link graph and a place in the tree without any of that being written twice — the same mechanism
`chatDistill.ts` (§6.14) has used since v2.6, applied to three more sources. No schema change:
the three new `KnowledgePage.source` values (`task_distill` / `report_distill` /
`meeting_distill`) ride the existing `@@index([source, sourceId])`.

The harvest is **three procedures, because the first one must be free**:
`distillCandidates` (no model) lists what is eligible and why the rest is not, so the user sees
a count before a bill — the router's standing rule is that reading is free and generating costs
money. `suggestDistill` spends, one call per candidate, and writes nothing; a failure costs
that candidate only. `applyDistill` writes the reviewed text verbatim and never calls a model,
because re-deriving on apply would let the set reviewed and the set written differ. Eligibility,
watermarks and the per-run ceilings live in the pure `lib/distillCandidates.ts`. A stale-note
guard (`note-changed`) refuses a body that moved between review and write — stricter than
`applyLinks`, which merges into a section, because this replaces the whole body. Quota
exhaustion shares `distill.pausedUntil` with the background chat distillation: the brake is a
fact about the account, not about a feature.

A strip of task counts used to sit under the tree (the **project pulse**). It is gone: it
described a project rather than any knowledge in it, which is what the notes are for. Its
counts came from `lib/taskCounts.ts`, which remains the implementation of `issue.taskCounts`
(the board's badges) — only this second caller was removed. The one gap its removal left is
filled in the card's empty state, which now carries the harvest button: that is the screen a
user with an empty library lands on, and a map needs notes to draw.

See `docs/knowledge-map.md` for the full invariants, the backfill flow, the harvest rules and
the known limits (`[[Title]]` is a chip only inside this card; renaming a note breaks inbound
links).

### 6.6 Agent Self-Learning

- **Implicit feedback capture**: ISSUE_REOPEN, ASSIGN_REJECT, STATUS_REVERT
- **Incremental reflection**: triggered at startup or manually, detects recent rejection patterns
- **Context injection**: `learn.getContext` injects lessons into the Agent prompt (alongside `preferenceHint` and the knowledge-base hint — see 6.13)

### 6.7 Git Integration

- `tomat init` — installs a post-commit hook
- commit `fix #3` → auto-closes TL-3

### 6.8 Universal IDE Focus Tracking

- `tomat focus` — lightweight IDE extension as primary, filesystem monitoring as fallback
- Works with any IDE/editor
- **Performance protection**: built-in ignore rules (`.git`, `node_modules`, `dist`, `target`, `build`, `*.log`)
- **Debounce**: file changes within 2s are merged into one heartbeat, preventing 100% CPU

### 6.9 MCP + HITL

**Outbound (TomiLite is the client):**

- **Protocol client** (`apps/api/src/agent/mcp/client.ts`): auto-negotiating transport supporting legacy (POST `/tools/call`), plain method-envelope, and standard JSON-RPC responses; HTTPS or localhost only for remote servers
- **Tool injection** (`apps/api/src/agent/mcp/inject.ts`): discovered tools are injected as `mcp__<server>__<tool>` function schemas (capped at 25); credentials are attached server-side and never sent to the LLM
- **Registry** (`registry.ts`): in-memory cache with 30s TTL + lazy discovery, decrypts per-server API keys on demand
- Inbound MCP server CRUD via the `mcpServer` router (per-server URL, transport, headers, API key, enable flag); every call audited in `McpAuditLog`

**Inbound (TomiLite is the server):**

- **Transports**: stdio (`apps/api/src/mcp/stdio.ts` → `apps/api/dist/mcp-stdio.cjs`, run by `TomiLite.exe` under `ELECTRON_RUN_AS_NODE=1`) and StreamableHTTP (`POST /api/mcp`, `apps/api/src/mcp/http.ts`). Both are front ends over one pure dispatcher (`dispatch.ts`) and one tool catalogue (`catalogue.ts`)
- **Dual-era protocol**: 2026-07-28 is stateless — no `initialize`, no session; every request carries a `_meta` envelope and `server/discover` is a MUST. The era is decided per request by the presence of `_meta`, which is what makes the HTTP endpoint stateless. Legacy clients (`initialize`-based) are served by the same code path
- **Risk gate**: `read_only` executes directly; `low`/`medium`/`high` are queued for human approval (HITL), auto-approved only when the API key's `hitlMode` is `auto`. Risk now comes from each tool's own definition in the catalogue, so it cannot disagree with the advertised schema
- **Scopes**: an API key without `write` is refused any non-`read_only` tool
- API Key management (`apikey` router) + audit log

The full protocol contract — era table, `tools/call` success/failure mapping, the bounded
approval wait, and the known limitations — is in [mcp-client.md](mcp-client.md) §6.

### 6.10 OTA Updates

- `electron-updater` with the **github** provider (owner `xxwj225-James`, repo `tomilite`, per `package.json` → `build.publish`) — not a generic/website provider
- Checks for updates shortly after startup (5s) and via manual IPC (`check-update`); `autoDownload = false` — user decides; top banner notification via `UpdateBar`
- Store (AppX) builds skip the updater — updates come from the Microsoft Store

### 6.11 First-Run Experience (replaces the old SetupWizard)

- The full-screen **SetupWizard was removed**; new users land directly in chat
- Actionable `WelcomeGuide` checklist (LLM key required + optional email/git/API keys/standup/MCP servers) with `[Configure →]` buttons that navigate to the Settings tab; checklist re-evaluates live via `useSetupChecks` and auto-dismisses when everything is configured or the user skips/dismisses (`localStorage['tl-welcome-dismissed']`)
- `LlmBanner` soft gate: prominent banner above the chat input when no LLM API key is configured

### 6.12 Electron Desktop App

- NSIS + AppX (Windows), DMG (macOS), AppImage (Linux)
- System tray (Show/Quit, double-click restores); closing the window quits the app (no hide-on-close)
- Spawns the bundled API server on :3192, notification server on :3191; F12 toggles DevTools

### 6.13 Knowledge recall (prompt injection)

**Read path** (`apps/api/src/agent/core/knowledgeRecall.ts`) — hybrid, cheap by default:

- On each turn, terms are extracted from the user's message (**never** global FTS —
  see the note below) and matched against note title/body; only notes scoring above
  threshold are injected, capped at 3 notes / ~500 chars
- **No hits → nothing is injected**, so the common turn costs zero extra tokens
- The `search_notes` tool is unchanged — the hint is an increment, not a replacement

> **Why not FTS5 for the read path:** the term set this function builds is dominated by
> **character bigrams** — 2 characters, which a trigram index structurally cannot match
> (§6.4). Now that `global_fts` is trigram-tokenized, the Latin terms a user message
> contains would be servable, but the CJK ones would not, so delegating this function to
> FTS would silently regress it. The `contains` scan here is deliberate. Under the old
> `porter unicode61` tokenizer this was also the only option for CJK input: it treated a
> whole run of Han/Kana as ONE token, so `迁移决定` matched while `迁移` and `决定` both
> returned 0.

### 6.14 Chat → Knowledge Distillation

Conversations are folded into the knowledge base automatically, so an agent
working on the same project across many sessions does not start from zero.

**Write path** (`apps/api/src/lib/chatDistill.ts`) — a background sweep, not a queue:

- A session becomes a candidate once it has been idle ≥3 min **and** has ≥6 new
  messages past its watermark; at most 3 sessions are processed per sweep, serially
- The window (≤40 messages) plus the session's existing note go to the LLM, which
  returns `{"worthSaving":false}` or a merged `{title, content}`; the prompt is told
  to drop chit-chat, restatements, and anything already in the note
- **One rolling note per session** (`KnowledgePage` where `source='chat_distill'`,
  `sourceId=<ChatSession.id>`, `category='chat'`), rewritten on each run
- **The link section is spliced out and back** — because "rewritten on each run" means the
  `title` and `content` are overwritten whole, so a `[[Title]]` backfill (§6.5) added to a
  chat summary would be wiped by the next distillation. The section behind
  `<!-- tl-links:v1 -->` is removed before the prompt and restored onto the result verbatim
- The watermark (`ChatSession.distillCursor`) advances **only after a successful
  write** — a crash or a bad response replays that window instead of losing it.
  `worthSaving:false` also advances it, or the same window would be re-billed forever
- Runs through `resolveLLM()` + `chat()`, so hosted-gateway spend is metered exactly
  like any other call; tokens and ¥ are recorded in `distillMeta` and reported to
  telemetry as aggregate counters only (see `docs/telemetry.md`)
- **Spend brakes**: 30-min per-session backoff, and a `quota_exhausted` /
  `feature_closed` / `account_disabled` reply from the gateway parks the whole job for
  6 h (`SystemConfig['distill.pausedUntil']`) — background work must never burn a
  metered trial's last quota. `SystemConfig['distill.enabled'] = '0'` disables it

### 6.15 Redmine Import — Read-Only Mirror

The user's real workload lives in a company Redmine; the task board, the health score, the
morning brief and the agent's `list_issues` saw none of it. This connector copies the
tickets **assigned to the configured user** into `Issue` as read-only mirrors, so those
four pipelines see the work without the app ever becoming a second source of truth.

**One direction only.** Nothing is written back to Redmine, and there is no code path that
could — which is what makes the read-only contract in `docs/tasks-panel.md` hold. A ticket
changed locally would be overwritten by the next sync, so every local write entry point
refuses a mirrored row; detach is the documented escape hatch.

**Sync** (`apps/api/src/routers/redmine.ts`, `lib/redmineClient.ts`):

- GETs only: `/users/current.json` (key check), `/projects.json`, `/trackers.json`,
  `/issue_statuses.json`, `/enumerations/issue_priorities.json`, `/issues.json`
- `assigned_to_id=me` and **`status_id=*`** — without the latter Redmine returns only open
  issues, and the mirror would silently shrink every time a ticket was closed
- `sort=updated_on:desc`, which is a correctness choice rather than a preference: paging an
  **ascending** sort while someone else edits issues permanently skips rows (a row edited
  during the walk moves to the end, past the cursor), whereas a descending sort can only
  produce **duplicates**, which the `(source, sourceId)` upsert absorbs
- `limit=100` per page, `maxPages` 50, and the response always reports `hasMore` — a
  truncated run deliberately does **not** advance the cursor, so the next run resumes
  instead of losing the tail
- Cursor: verbatim `updated_on`, sent back shifted one second earlier. Redmine's
  `updated_since` may be `>` or `>=` depending on version, and a one-second re-read is free
  while a one-second skip is unrecoverable
- Config is enabled/disabled per server; the 4-minute-after-boot + 30-minute interval in
  `startBackgroundTasks()` no-ops without a config, and concurrent runs share one in-flight
  promise rather than racing

**Vocabulary is read from the server, never hardcoded.** Tracker / status / priority names
and ids are per-install and usually localised, so any id baked in here is one server's
accident. Closed-ness is decided **only** by the status's own `is_closed` flag — never by
its name — because it is the one rule that survives an administrator renaming "Closed" to
"完了". Names are only used as a hint for the four local statuses; unknown names fall to
`todo`, unknown types to `task` (never `email`, which `TASK_WHERE` excludes — a ticket
that mapped to `email` would vanish from every counter while still sitting in the table).
The maps are three pure tables in `lib/redmineMap.ts` with zero runtime imports, so they
can be exercised directly with `node --experimental-strip-types`.

**Two credential decisions**, both recorded in [SECURITY.md](SECURITY.md): the API key is
AES-256-GCM encrypted at rest and never returned to the renderer, and plain `http://` is
allowed because an intranet Redmine is the normal case — the UI warns that the key travels
in clear text.

### 6.16 Note Import (Markdown, saved web pages, web archives)

Existing notes become TomiLite notes, so the knowledge map has something to organise.
`KnowledgePage` already carried `source` / `sourceId` / `@@index([source, sourceId])` from
§6.14; this is its second consumer, and **no schema change has been needed for any of the
three formats** — each one is a value in `IMPORT_SOURCES` and nothing else.
`'import:enex'` was a fourth until it was retired (below); the rows it wrote are untouched.

The two entry points are the notes panel's import dialog (notes) and the tasks panel's
import dialog (`RedmineSection`, for mirrored issues). They used to share a Settings tab;
neither produces anything a settings page can show.

- **Parsing runs in the renderer, not the API.** Every existing file read in this repo goes
  through the browser File API, and doing it here buys progress reporting and a cancel
  button for free — the API alternative needs SSE or a status column plus an orphan
  sweeper.
- **One button, three formats, one run.** The dialog used to carry a section per format,
  each with its own hidden input and its own four sentences — buttons the user had to tell
  apart before starting, when the file's own name already says what it is. There is now one
  `<input type="file" multiple>` and its `accept` is built from the same table the bucketing
  uses (`apps/web/src/lib/import/buckets.ts`), so a file the picker offers and a file an
  importer claims cannot come apart — a disagreement there is silent: the note simply never
  arrives and no count mentions it. The pick is split by extension because
  `wiki.importNotes` takes **one `source` per batch** and its schema rejects an unknown one
  *for the whole batch*, so the renderer calls it once per format, in a fixed order, and
  merges the tallies, warnings and cancellation into one outcome. The progress bar is
  offset by the dispatcher rather than by `importFiles`, which counts every call from zero.
  Bucketing across sources is safe because the existence check, the in-batch dedup and
  `overwrite` are all keyed by the composite `(source, sourceId)`.
- **Picking stages, the button runs.** The pick used to start the run as soon as the file
  dialog closed, which left the selection — the only moment a wrong pick can still be
  caught — with nothing on screen. The files now sit in `files` state, listed with the
  bucket `bucketOf` answers for each (the same call the dispatcher makes, so a file let
  through by "All files" is named as skipped before the run rather than counted after it),
  and 「确认导入」 starts it. A cancelled file dialog leaves the previous selection alone
  instead of clearing it, and the list survives a failed or stopped run — a file dialog
  cannot be reopened onto a previous selection, so throwing the list away there would mean
  re-picking by hand; re-running is idempotent, which makes that a resume.
- **A file pick cannot see folders, so a saved web page loses its images.** An `.html`
  export keeps its images in a `<name>_files` folder beside it and a picker hands over only
  the files selected, so every image reference resolves as *missing* and becomes a
  placeholder line — counted per note, with the first missing name reported, and stated in
  the dialog before the run rather than discovered after it. `.mht` is unaffected: it
  carries its resources inside the file, which makes it the format to prefer when images
  matter. `makeResourceIndex` and `parseHtmlNote`'s `resolve` still take a file list and
  would work unchanged if a folder could be handed over, so this is a limit of the picker
  and not of the parser — but it is unreachable from the UI, and only
  `scripts/test-import-mime.mts` still exercises it.
- **Markdown arrives as a multi-file pick, so the dialog asks for the notebook.** A file
  picker hands over bare names with no directory, which removes both things the old folder
  pick derived from the path: the category (it was the subfolder) and the uniqueness of the
  merge key. The category is an optional field — empty means `imported` — and it applies to
  Markdown only, because the other two formats name their own notebook in their file name.
  Two files with the same name in one batch are de-duplicated before writing and reported,
  since the name is all that identifies them.
- **`.enex` support has been removed.** The parser is gone (`enex.ts`, `enml.ts`, the
  `md5` helper only it used), the picker no longer offers the extension, and `'import:enex'`
  is no longer a value `wiki.importNotes` accepts. Three reasons, in the order they carry
  weight. It was the one part of this feature with **no test, no fixture and no sample
  export** in the repo — the two web formats have all three — so its behaviour on a real
  file was a claim rather than an observation, and this is the shape of parser that fails
  into a *plausible* note. It was reachable only through a section named after the one
  application that writes it, which is what made the dialog look like it had four things to
  explain instead of one. And 7.x does not write `.enex` at all, so the section addressed an
  upgrade path whose file the source application's current menu no longer produces.
  **Notes already imported from `.enex` are not affected**: `source` is a stored column, not
  a parser, and those rows still open, search and edit, with the generic `import:*` badge.
  What is gone is the ability to import *more* of them.
- **Formats are named by extension, never after the application that writes them** — in the
  UI and in the code. An application name in the copy goes stale the moment its export menu
  changes, it tells a user of that application nothing about the file they actually have,
  and it invites a section per vendor. The 印象笔记 and `YinXiangBiJi` strings that remain in
  `lib/import/` are provenance, not UI: they name the real 2026-09-22 export a parser was
  built against, and `scripts/test-import-mime.mts` asserts the behaviour read off it.
- **`.notes` is not supported, and deliberately not explained in the UI.** It is the other
  thing that application's current client exports: an encrypted private format with no
  published spec and no third-party parser. The only honest advice would be a procedure the
  user cannot follow from inside the app.
- **MIME is parsed in the renderer, like everything else — and byte-wise.** `mailparser` is
  already bundled into the API, but everything downstream of it is DOM- and turndown-shaped
  (note bounds, `src` resolution, the image budget, the `data-tl-ph` placeholder path,
  `htmlToMarkdown`), and turndown is not an API dependency at all. The alternative is a
  `Uint8Array` → JSON round trip that inflates both ends by 33% for a container full of
  inlined images, over an `api.ts` whose only bare-bytes precedent is capped at 16 MB — for
  no gain, and at the cost of the per-note progress the renderer gets for free. `mht.ts`
  walks the container as **bytes**, not as text: the WHATWG encoding standard aliases
  `iso-8859-1` to windows-1252, so the renderer has no byte-preserving `TextDecoder` and
  decoding before splitting would corrupt every byte in `0x80`–`0x9F`.
- **One HTML file is one note; a whole-notebook export is reported, not split.** The
  export's note divider is `<a name="506"/>` — self-closing, which `text/html` does not
  allow, so the parser leaves the anchor open and it ends up wrapping the rest of the file;
  the DOM therefore shows one note no matter how many are in the file, and splitting would
  have to happen at the string level. The predicate that tells a divider apart from the
  empty in-page anchors a clipped web page is full of is unproven on one sample, and getting
  it wrong does not degrade the import: it shreds a notebook into fragments each with an
  invented title and id. So the importer counts the dividers and says so in the summary.
  See the header of `lib/import/html.ts` for the argument and for where a splitter would go.
- **`sourceId` is derived, never positional.** None of these formats carries a note id, and
  numbering by import order would shift every id the moment a note was deleted and
  re-exported, re-importing the whole notebook. Each format uses what it actually carries:
  Markdown and HTML use the file's own path — which is why renaming the note *in TomiLite*
  or editing its heading does not mint a second copy — and `.mht` uses notebook + title
  because it has no path worth speaking of. None of them uses the export's own timestamp,
  which records when the export ran rather than when the note was written. The rules live in
  one place (`lib/import/sourceId.ts`), which is also the only place a key is made.
- **The import sources are one list, not two.** `wiki.ts` declares `IMPORT_SOURCES` and
  derives both the input type and the `z.enum` from it. The renderer sends one row per note,
  and a source the schema does not know rejects the **whole batch** — so "added the importer,
  forgot the enum" would be an import that parses three hundred notes and writes none. That
  list is only ever read as a check on incoming input and never as a filter on stored rows,
  which is what makes retiring an importer a one-line deletion rather than a migration.
- **Idempotent by lookup, not by constraint.** No `@@unique` — both columns are nullable, so
  SQLite treats every `NULL` pair as distinct and the constraint would protect exactly none
  of the rows that need it, while turning the rolling-note rewrite in §6.14 into a `P2002`.
  Dedup is a batched `findMany` on the composite index plus in-batch dedup and a
  module-level serialiser; the default is **skip**, and `overwrite: true` is the opt-in.
- Attachments: images inline as data URLs under a small size cap, everything else a
  placeholder line. The cap is what keeps it safe — FTS copies `content` into `global_fts`,
  so the database grows at roughly twice the base64 size and an image-heavy note becomes
  unmatchable text.
- **Encrypted passages are no longer detected or counted.** The per-note `<en-crypt>` /
  `base64:aes` check belonged to the `.enex` importer and went with it, so a summary can no
  longer say "N encrypted notes skipped, and why". An encrypted passage that somehow
  reaches one of the remaining formats arrives as whatever bytes the export left in the
  file, is imported as ordinary body text, and is counted as nothing in particular. This is
  the one piece of *user-visible* reporting that the retirement costs, and it is in the
  release notes for that reason.

---

## 7. Coding Standards

See `CLAUDE.md` (8 parts):

- No hardcoded colors → semantic CSS variables
- No `any` types, no `console.log`
- `cn()` for dynamic classes
- Full i18n coverage in 3 languages
- Pre-commit hook: ESLint + Prettier + TypeScript

---

## 8. Technology Decision Records

| Requirement       | Implementation                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI chat entry     | App.tsx Chat-First UI                                                                                                                                                                  |
| SSE Streaming     | `/api/agent/stream`                                                                                                                                                                    |
| AI Health Scorer  | `/api/health.personalHealth`                                                                                                                                                           |
| pgvector Search   | FTS5 (trigram, CJK-capable) + local ONNX embeddings fused with RRF — see 6.4.1                                                                                                         |
| AI Issue Review   | `/api/search.reviewIssue`                                                                                                                                                              |
| Knowledge Map     | `/api/knowledge.map` (`organize` / `neighbors` / `suggestLinks` / `applyLinks` / `distillCandidates` / `suggestDistill` / `applyDistill`) — see 6.5; `search.knowledgeMap` is a retired predecessor                                                                              |
| AI Evolution      | `/api/learn.*`                                                                                                                                                                         |
| Ticket Import     | `/api/redmine.*` — one-way incremental mirror, read-only locally — see 6.15                                                                                                            |
| Note Import       | `/api/wiki.importNotes` + renderer-side parsers (`apps/web/src/lib/import/`) — see 6.16                                                                                                 |
| MCP Server + HITL | `/api/mcp` (StreamableHTTP) + `/api/mcp.*` + `/api/apikey.*` + `/api/mcpServer.*` + the stdio shim `apps/api/dist/mcp-stdio.cjs`                                                                                                                                    |
| i18n              | Keyed `t(key, lang)` dictionary in `apps/web/src/lib/i18n.ts` (en/zh/ja; th/mi/ru reserved, fallback to en); legacy inline `tr(lang, zh, ja, en)` still used for a few App.tsx strings |
| OTA               | `electron-updater` with `github` provider (owner `xxwj225-James`, repo `tomilite`), not a website provider                                                                             |
| Celery Batch Jobs | `setInterval` background tasks started at startup (`startBackgroundTasks` in `server.ts`)                                                                                              |
| RabbitMQ Events   | Direct function calls                                                                                                                                                                  |
| Redis Debounce    | In-memory Map + setTimeout                                                                                                                                                             |
