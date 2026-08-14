# TomiLite — Architecture & Feature Design

> **Version**: v1.0  
> **Date**: 2026-06-29  
> **Positioning**: Single-user local AI productivity tool

---

## 1. Product Positioning

TomiLite is an AI productivity tool for indie developers. Minimalist design, zero-dependency deployment, AI-native interaction, local-first.

**Core strategy**: Local-first — all data stays on the user's machine.

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|----|------|------|
| Frontend | React 19 + Vite + Tailwind CSS | Modern and fast |
| Backend API | Node.js + tRPC | Lightweight, no Java dependency |
| Database | SQLite (Prisma ORM) | Single file, zero config |
| AI | DeepSeek Cloud API (SSE streaming) | Low cost, good results |
| Search | FTS5 full-text search | Replaces pgvector, zero dependencies |
| Desktop | Electron | Cross-platform installer |
| Code sharing | npm workspaces (`@tomilite/shared-ui`) | Shared UI components |

---

## 3. Architecture

```
tomilite/
├── apps/
│   ├── api/          # tRPC API Server (:3091)
│   │   └── src/routers/   # 13 routers
│   └── web/          # React SPA (:3002)
│       ├── src/App.tsx    # Chat-first UI
│       ├── src/components/ # UI components
├── packages/
│   ├── database/     # Prisma Schema + SQLite
│   └── shared-ui/    # Shared UI components (npm workspace, not Symlink)
├── electron/         # Electron wrapper
├── scripts/          # CLI tools (tomat focus, tomat init, uninstall)
└── mockup/           # Design mockup (HTML)
```

**Data flow**:
```
Browser ↔ Vite Dev Server (:3002) ↔ tRPC API (:3091) ↔ SQLite
                                            ↕
                                    DeepSeek Cloud API
                                            ↕
                                    GitHub Releases (OTA)
```

---

## 4. API Routes (13 routers)

| Router | Endpoint | Function |
|--------|------|------|
| `issue` | list, create, update, delete, children, updateRank | Issue CRUD + drag-sort |
| `board` | getBoard, moveCard | Kanban + drag & drop |
| `wiki` | list, create, update, delete | Wiki CRUD |
| `git` | listRepos, addRepo, removeRepo, handleHook, recentRefs | Git repos + commit linkage |
| `focus` | heartbeat, status, endSession | IDE focus tracking |
| `system` | checkUpdate, currentVersion | OTA update check |
| `llm` | getConfig, saveConfig, saveProvider, testConnection | LLM configuration |
| `email` | listInbox, listDrafts, saveDraft, getConfig, saveConfig, stats | Email integration |
| `agent` | /stream (SSE), chat, generateReport, getBoardStatus, getProjectStats | AI Agent + tools |
| `mcp` | listTools, execute, confirm, deny, confirmById, listPending, listAuditLogs, auditStats | MCP + HITL |
| `apikey` | list, generate, revoke, delete, verify | API Key management |
| `health` | personalHealth, healthHistory | 5-dimension health score |
| `search` | search, reviewIssue, knowledgeMap | FTS5 search + AI Review |
| `learn` | capture, reflect, getContext, stats | Self-learning |

---

## 5. Database (SQLite via Prisma)

25 models; key tables:

| Model | Purpose |
|-------|------|
| `Issue` | Task management (type, status, priority, storyPoints, sortOrder...) |
| `Board` / `BoardColumn` / `BoardCard` | Kanban |
| `KnowledgePage` | Wiki/notes |
| `FocusSession` | Focus sessions |
| `GitRepo` / `GitCommitRef` | Git integration |
| `ApiKey` | API Key (stored as SHA-256 hash) |
| `McpAuditLog` | MCP audit |
| `AiDecisionFeedback` | Self-learning feedback |
| `UserHealthSnapshot` | Health history |
| `InboundMessage` / `DraftReply` | Email |
| `LlmProviderMaster` / `LlmProvider` / `LlmConfig` | LLM configuration |

---

## 6. Feature List

### 6.1 Core Interaction — Chat-First UI

```
┌────────────────────────────────────┐
│ top-left: 🔒 Deep Flow 🎯 Focused 💤│
│ top-right: EN | ZH | JA  ●●●●      │
├──────────┬─────────────────────────┤
│ Sessions │  🤖 RobotFace            │
│ + New    │  TomiLite AI Agent     │
│ Chat 1   │  [6 suggestion chips]    │
│ Chat 2   │                          │
│          │  User: create a bug...   │
│ 0/100k   │  Agent: ✅ Created TL-3  │
├──────────┴─────────────────────────┤
│  [+]  [Ask me anything...]      [↑] │
│  Enter to send · Shift+Enter new line│
└────────────────────────────────────┘
```

- **Conversation is the main UI** — no sidebar, no menu bar
- **+ menu** — 8 function panels (Home/Board/Backlog/Issue/Notes/Email/MCP Audit/Reports/Feedback/Settings)
- **Right slide-in panel** — chat area shrinks but stays usable
- **SSE streaming output** — renders token by token, typewriter effect

### 6.2 AI Agent

- **5 tools**: `create_issue`, `get_stats`, `list_issues`, `search_notes`, `update_issue`
- **LLM Function Calling**: natively supported by DeepSeek, streaming + tool calls
- **Fallback strategy**: no API Key → error message + mock reply

### 6.3 Personal Health Score (AI Health)

5-dimension rules engine:
- `completion` — Issue completion rate
- `velocity` — recent completion velocity
- `focus` — deep-flow duration
- `git_activity` — Git commit frequency
- `staleness` — Issue staleness

LLM-polished summary (optional); snapshots stored in `user_health_snapshots`.

### 6.4 FTS5 Search + AI Issue Review

- **Full-text search**: five sources — Issue + Notes + Email + Comments + Project — plus LLM Web Search
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

- 3-level risk gate: read_only (direct) / low (automatic) / medium+ (requires confirmation)
- API Key management + audit log

### 6.10 OTA Updates

- Checks GitHub Releases every 2h → top banner notification

### 6.11 Setup Wizard

6-step guide: Welcome → Language → Email → LLM → Git → Done

### 6.12 Electron Desktop App

- NSIS installer (Windows), DMG (macOS), AppImage (Linux)
- System tray + hide on close

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

| Requirement | Implementation |
|---------------|----------------|
| AI chat entry | App.tsx Chat-First UI |
| SSE Streaming | `/api/agent/stream` |
| AI Health Scorer | `/api/health.personalHealth` |
| pgvector Search | FTS5 full-text search |
| AI Issue Review | `/api/search.reviewIssue` |
| Knowledge Map | `/api/search.knowledgeMap` |
| AI Evolution | `/api/learn.*` |
| MCP Server + HITL | `/api/mcp.*` + `/api/apikey.*` |
| Celery Batch Jobs | node-cron + runs at startup |
| RabbitMQ Events | Direct function calls |
| Redis Debounce | In-memory Map + setTimeout |
