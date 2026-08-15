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
| Search       | FTS5 full-text search                                                                               | Replaces pgvector, zero dependencies |
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
| `system`    | currentVersion, getHomeDir, notifyCount, clearNotifications, mcpPendingCount, getMotto, generateMotto, saveMotto, getConfig, setConfig, saveLanguage (isSetupCompleted/markSetupCompleted kept as legacy dead code)                                                                                        | System config + notifications               |
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

- **~30 built-in tools** (`apps/api/src/agent/tools/registry.ts` + `emailTools.ts`): issues (`create_issue`, `force_create_issue`, `get_issue`, `list_issues`, `update_issue`, `suggest_issue_edit`), notes (`create_note`, `update_note`, `list_notes`, `search_notes`, `suggest_note_edit`, `force_create_note`), reports (`create_report`, `update_report`, `get_report`, `list_reports`, `delete_report`, `suggest_report_edit`, `polish_report`, `summarize_report`, `expand_report`, `translate_report`, `force_create_report`), email (`list_emails`, `edit_email_reply`, `send_email_reply`, `read_email_original`, `dismiss_email`, `delete_email`), search (`search_local_data`, `brave_search`, `web_search`), git (`list_git_commits`, `list_workspaces`), stats/exec (`get_stats`, `shell_exec`), export (`export_to_excel`, `export_to_doc`), plus MCP-injected tools as `mcp__<server>__<tool>` (capped at 25)
- **LLM Function Calling**: streaming + tool calls; tools are pruned based on open editors
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

- **Full-text search**: local sources — issues, notes, reports, emails, git commits (`search_local_data`) — plus LLM Web Search (`brave_search` / `web_search`)
- **AI Review**: duplicate detection (≥70% match flagged high-risk), title quality, description completeness, story-point reasonableness
- **LLM polish**: optional DeepSeek analysis

### 6.5 Knowledge Map

Project-wide overview; the LLM synthesizes a 3-sentence summary + recommended reading.

### 6.6 Agent Self-Learning

- **Implicit feedback capture**: ISSUE_REOPEN, ASSIGN_REJECT, STATUS_REVERT
- **Incremental reflection**: triggered at startup or manually, detects recent rejection patterns
- **Context injection**: `learn.getContext` injects lessons into the Agent prompt

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
| pgvector Search   | FTS5 full-text search                                                                                                                                                                  |
| AI Issue Review   | `/api/search.reviewIssue`                                                                                                                                                              |
| Knowledge Map     | `/api/search.knowledgeMap`                                                                                                                                                             |
| AI Evolution      | `/api/learn.*`                                                                                                                                                                         |
| MCP Server + HITL | `/api/mcp.*` + `/api/apikey.*` + `/api/mcpServer.*`                                                                                                                                    |
| i18n              | Keyed `t(key, lang)` dictionary in `apps/web/src/lib/i18n.ts` (en/zh/ja; th/mi/ru reserved, fallback to en); legacy inline `tr(lang, zh, ja, en)` still used for a few App.tsx strings |
| OTA               | `electron-updater` with `github` provider (owner `xxwj225-James`, repo `tomilite`), not a website provider                                                                             |
| Celery Batch Jobs | `setInterval` background tasks started at startup (`startBackgroundTasks` in `server.ts`)                                                                                              |
| RabbitMQ Events   | Direct function calls                                                                                                                                                                  |
| Redis Debounce    | In-memory Map + setTimeout                                                                                                                                                             |
