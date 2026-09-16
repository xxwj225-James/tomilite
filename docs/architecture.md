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
| Search       | FTS5 full-text search (trigram + `LIKE` fallback for short terms) + local ONNX embeddings            | Replaces pgvector, zero dependencies |
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

## 4. API Routes (20 routers)

| Router      | Endpoint                                                                                                                                                                                                                                                                                                   | Function                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `issue`     | list, create, update, delete, updateRank                                                                                                                                                                                                                                                                   | Issue CRUD + drag-sort                      |
| `board`     | getBoard, moveCard                                                                                                                                                                                                                                                                                         | Kanban + drag & drop                        |
| `wiki`      | list, create, update, delete                                                                                                                                                                                                                                                                               | Wiki CRUD                                   |
| `git`       | listWorkDirs, addWorkDir, removeWorkDir, listRepos, addRepo, removeRepo, handleHook, recentRefs                                                                                                                                                                                                            | Git repos + commit linkage                  |
| `focus`     | heartbeat, status, endSession                                                                                                                                                                                                                                                                              | IDE focus tracking                          |
| `system`    | currentVersion, getHomeDir, notifyCount, clearNotifications, mcpPendingCount, getMotto, generateMotto, saveMotto, getConfig, setConfig, saveLanguage, embedStatus, reembed (isSetupCompleted/markSetupCompleted kept as legacy dead code)                                                                  | System config + notifications               |
| `llm`       | getConfig, saveConfig, saveProvider, testConnection                                                                                                                                                                                                                                                        | LLM configuration                           |
| `email`     | listSmartEmails, fetchFullEmail, getBody, markRead, markProcessed, cleanup, getConfig, sendReport, saveIMAP, getDraft, saveDraft, generateDraft, imapStatus, connectIMAP, disconnectIMAP, saveConfig, sendEmail, testSmtp, testIMAP, stats, createLinkedTask, unlinkTask, subGroupByCategory, groupByTopic | Email integration (SmartEmail triage)       |
| `agent`     | /api/agent/stream (SSE), chat, getBoardStatus, getProjectStats, status, classifyIntent                                                                                                                                                                                                                     | AI Agent + tools                            |
| `mcp`       | listTools, execute, confirm, confirmById, deny, getTaskResult, listPending, listAuditLogs, auditStats, pendingCount                                                                                                                                                                                        | MCP + HITL                                  |
| `mcpServer` | list, create, update, delete, test, refreshTools, connect, disconnect, listTools                                                                                                                                                                                                                           | MCP server CRUD (per-server config)         |
| `apikey`    | list, generate, revoke, delete, verify                                                                                                                                                                                                                                                                     | Inbound API Key management (SHA-256 hashed) |
| `health`    | personalHealth, healthHistory                                                                                                                                                                                                                                                                              | 5-dimension health score                    |
| `search`    | search, reviewIssue, knowledgeMap                                                                                                                                                                                                                                                                          | FTS5 search + AI Review                     |
| `learn`     | capture, reflect, getContext, stats                                                                                                                                                                                                                                                                        | Self-learning                               |
| `knowledge` | generate, getLatest                                                                                                                                                                                                                                                                                        | Knowledge Map                               |
| `report`    | list, getLatest, save, delete, markSent                                                                                                                                                                                                                                                                    | Reports CRUD                                |
| `feedback`  | list, create, updateStatus, delete                                                                                                                                                                                                                                                                         | Feedback CRUD                               |
| `chat`      | listSessions, createSession, renameSession, deleteSession, getMessages, addMessage, listThreads, updateMessage, clearMessages                                                                                                                                                                              | Chat sessions + messages (per-session)      |
| `standup`   | getMorningStatus, getMorningBrief, getEveningStatus, getEveningReport, getSettings, saveSettings                                                                                                                                                                                                           | Morning check-in + evening auto-report      |

---

## 5. Database (SQLite via Prisma)

33 models; key tables:

| Model                                                              | Purpose                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `Issue`                                                            | Task management (type, status, priority, storyPoints, sortOrder...) |
| `Board` / `BoardColumn` / `BoardCard`                              | Kanban                                                              |
| `Sprint` / `Comment` / `IssueChangelog`                            | Sprint planning, comments, change history                           |
| `KnowledgePage`                                                    | Wiki/notes                                                          |
| `PersonalNote`                                                     | Notes                                                               |
| `FocusSession`                                                     | Focus sessions                                                      |
| `GitWorkDir` / `GitRepo` / `GitCommitRef` / `GitCommit`            | Git integration                                                     |
| `SmartEmail`                                                       | Email triage (AI summary, reply draft, linked issue)                |
| `ApiKey`                                                           | Inbound API Key (stored as SHA-256 hash)                            |
| `McpServer` / `McpAuditLog`                                        | MCP server config + audit                                           |
| `AiDecisionFeedback`                                               | Self-learning feedback                                              |
| `UserHealthSnapshot`                                               | Health history                                                      |
| `DailyMotto`                                                       | Daily motto cache                                                   |
| `Report`                                                           | Reports (daily/weekly)                                              |
| `ChatSession` / `ChatMessage`                                      | Chat sessions + messages                                            |
| `LlmProviderMaster` / `LlmProvider` / `LlmConfig`                  | LLM configuration                                                   |
| `SystemConfig` / `KnowledgeCache` / `Integration` / `FeedbackItem` | Misc                                                                |

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
- **SSE streaming output** — renders token by token, typewriter effect
- **Session sidebar** — session list with rename/delete + token usage meter (`SessionSidebar`)

### 6.2 AI Agent

- **~30 built-in tools** (`apps/api/src/agent/tools/registry.ts` + `emailTools.ts`): issues (`create_issue`, `force_create_issue`, `get_issue`, `list_issues`, `update_issue`, `suggest_issue_edit`), notes (`create_note`, `update_note`, `list_notes`, `search_notes`, `suggest_note_edit`, `force_create_note`), reports (`create_report`, `update_report`, `get_report`, `list_reports`, `delete_report`, `suggest_report_edit`, `polish_report`, `summarize_report`, `expand_report`, `translate_report`, `force_create_report`), email (`list_emails`, `edit_email_reply`, `send_email_reply`, `read_email_original`, `dismiss_email`, `delete_email`), search (`search_local_data`, `web_search`, plus `brave_search` when a Brave key is present), git (`list_git_commits`, `list_workspaces`), stats/exec (`get_stats`, `shell_exec`), export (`export_to_excel`, `export_to_doc`), plus MCP-injected tools as `mcp__<server>__<tool>` (capped at 25)
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
`ensureSearchIndexes()`, which runs on every boot *before* the server listens:

- `global_fts` is a regular (non-contentless) fts5 table over five source tables —
  `Issue`, `KnowledgePage`, `SmartEmail`, `GitCommit`, `Report` — with `type` and `ref_id`
  marked `UNINDEXED`. `UNINDEXED` matters: previously `type` was searchable, so a query
  for `note` matched every note through the type column rather than through content
- **Tokenizer is `trigram`** (SQLite ≥3.34): any substring of ≥3 characters matches,
  which is what makes Chinese search work at all. The previous `porter unicode61`
  tokenizer treated a whole run of Han/Kana as ONE token, so a CJK query matched only when
  it equalled an *entire* run in the row — `数据库迁移` matched a row whose text was
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
  that drops all 21 triggers *before* the table, recreates the table unconditionally, and
  repopulates without `OR IGNORE`. The trigger ordering is load-bearing — a surviving
  `fts_*` trigger makes every `INSERT`/`UPDATE`/`DELETE` on its source table throw
  `no such table: main.global_fts`. Dropping the *source* table cleans its triggers;
  dropping the *fts* table does not
- **Populating once**: the old boot path ran five unconditional `INSERT OR IGNORE ... SELECT`
  statements. FTS5 tables have no unique constraint, so `OR IGNORE` never fired and every
  launch copied the whole corpus again — one real database had 498,107 index rows for
  1,596 source rows (1.43 GB, 95% of the file). The rebuild now runs only when the
  tokenizer, the `ftsVersion` stamp, or a row-count drift check says it must, and a
  one-time `VACUUM` (deferred 120 s past `listen()`) reclaims the freed pages

> **Why the rebuild is not a versioned migration:** `ensureSchema()`'s migration loop
> treats a failure as non-fatal and then stamps `schemaVersion` on **both** the success and
> the failure branch (`server.ts:781-793`), so a failed migration is never retried, and
> there is no pre-migration DB backup. A rebuild that half-applied there would leave the
> index broken permanently. `ensureSearchIndexes()` instead stamps its own `ftsVersion`
> only after the indexed row count reconciles with the source tables, so any failure is
> re-evaluated and retried on the next boot. It does not touch `SCHEMA_VERSION` at all.

> **`db push` and the index:** Prisma does not know about `global_fts` or its five shadow
> tables, so a `db push` proposes dropping all six and — because `server.ts:761` passes no
> `--accept-data-loss` — is *refused*. A refused push changes nothing, so the index is
> never at risk; `ensureSearchIndexes()` runs after `ensureSchema()` and self-heals
> regardless. The consequence that does matter is on the schema side: `db push` only runs
> when `SCHEMA_VERSION` is bumped, and it is refused whenever the index exists, so the
> additive `migrations[]` array (`server.ts:554`) is what actually delivers schema changes
> to existing installs. A `schema.prisma` change with no matching entry there never
> reaches them

### 6.4.1 Semantic search (local embeddings)

Keyword search cannot answer a Chinese question against an English-titled note, and it
cannot answer a 2-character Chinese query at all (trigram's structural limit, above).
Embeddings cover both. The vector machinery already existed in the codebase — a `vector`
column, `cosineSimilarity`, `semanticRank`, `searchNotesSemantic` — but had never produced
a vector: `embedText` called the LLM's `/embeddings` endpoint behind
`!isDeepseekEndpoint(baseUrl)`, which matches DeepSeek *and* the hosted gateway and sat
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
  the *order* each list produced. Either list being empty degrades RRF to the other's order.
- **No similarity threshold anywhere, and that is measured rather than omitted.** On a real
  35-note corpus, e5 vectors are anisotropic enough that the score distribution cannot
  distinguish a good query from a bad one:

  | query                  | top    | top−mean | top−2nd | z    |
  | ---------------------- | ------ | -------- | ------- | ---- |
  | `数据库迁移` (real)     | 0.8391 | 0.0379   | 0.0029  | 1.41 |
  | `如何种植番茄` (absent) | 0.8606 | 0.0659   | 0.0129  | 1.80 |
  | `zzzzzzzz…` (gibberish) | 0.8486 | 0.0348   | 0.0076  | 2.84 |

  Gibberish outscores the real query on every statistic and the absent-topic query beats
  both, so a cut-off would be fitted noise. The ordering is still useful — the correct note
  ranked #1 for every real probe — but it means a no-hit query returns the closest available
  notes instead of none, which is the accepted cost of the same property that makes
  cross-lingual and 2-character queries work. (The old `semanticRank` gated on
  `score > 0.5`, a value calibrated for OpenAI embeddings that e5 satisfies for every
  query; it now gates on whether the *candidates* have usable vectors at all.)
- **Degradation is total and quiet**: no model installed → `embedQuery` returns `null` →
  the embedding list is empty → RRF reduces to BM25 order → keyword search and every other
  feature is unaffected, with no error shown. `TL_EMBED_DISABLE=1` switches the whole
  subsystem off; `TL_EMBED_MODEL` and `TL_EMBED_MODEL_MIRROR` override the model and hosts.
  `system.embedStatus` reports state, queue depth, embedded count and the last error;
  `system.reembed` re-queues everything (and is the only path that resets `attempts`).
- **Packaging**: `@huggingface/transformers` is `external` in `scripts/bundle-api.js` and
  `onnxruntime-web` plus the non-`win32/x64` ONNX runtimes are excluded in `build.files`.
  `sharp` is a *production* dependency at `^0.34.5` — `transformers.node.cjs` requires it
  unconditionally at top level, electron-builder installs only the production tree, and the
  range has to match the version transformers declares or npm keeps a second nested copy.
  Net cost: **+20–35 MiB** on the installer (ORT runtime only; the model is never bundled).

### 6.5 Knowledge Map

Project-wide overview; the LLM synthesizes a 3-sentence summary + recommended reading.

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

- **Protocol client** (`apps/api/src/agent/mcp/client.ts`): auto-negotiating transport supporting legacy (POST `/tools/call`), plain method-envelope, and standard JSON-RPC responses; HTTPS or localhost only for remote servers
- **Tool injection** (`apps/api/src/agent/mcp/inject.ts`): discovered tools are injected as `mcp__<server>__<tool>` function schemas (capped at 25); credentials are attached server-side and never sent to the LLM
- **Registry** (`registry.ts`): in-memory cache with 30s TTL + lazy discovery, decrypts per-server API keys on demand
- **Risk gate**: `read_only` executes directly; `low`/`medium`/`high` are queued for human approval (HITL), auto-approved only when the API key's `hitlMode` is `auto`
- Inbound MCP server CRUD via the `mcpServer` router (per-server URL, transport, headers, API key, enable flag); every call audited in `McpAuditLog`
- API Key management (`apikey` router) + audit log

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
| pgvector Search   | FTS5 (trigram, CJK-capable) + local ONNX embeddings fused with RRF — see 6.4.1                                                                                                          |
| AI Issue Review   | `/api/search.reviewIssue`                                                                                                                                                              |
| Knowledge Map     | `/api/search.knowledgeMap`                                                                                                                                                             |
| AI Evolution      | `/api/learn.*`                                                                                                                                                                         |
| MCP Server + HITL | `/api/mcp.*` + `/api/apikey.*` + `/api/mcpServer.*`                                                                                                                                    |
| i18n              | Keyed `t(key, lang)` dictionary in `apps/web/src/lib/i18n.ts` (en/zh/ja; th/mi/ru reserved, fallback to en); legacy inline `tr(lang, zh, ja, en)` still used for a few App.tsx strings |
| OTA               | `electron-updater` with `github` provider (owner `xxwj225-James`, repo `tomilite`), not a website provider                                                                             |
| Celery Batch Jobs | `setInterval` background tasks started at startup (`startBackgroundTasks` in `server.ts`)                                                                                              |
| RabbitMQ Events   | Direct function calls                                                                                                                                                                  |
| Redis Debounce    | In-memory Map + setTimeout                                                                                                                                                             |
