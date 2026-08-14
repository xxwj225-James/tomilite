# TomiLite — Claude Code Instructions

> **All code must follow these rules. Violating any of them = non-conforming code.**

- **Tech stack**: Node.js 20+ / TypeScript 5.4+ / tRPC 11 / Prisma 5 / React 19 / Vite 6 / Tailwind 3
- **Monorepo**: npm workspaces + Turborepo — `packages/` (shared) + `apps/` (api, web)
- **Target**: Personal edition, single user, local SQLite, zero Docker dependency

---

## Commit Rules

- Git author must remain consistent — NEVER change it per-repo
- NEVER add `Co-Authored-By` or any Claude/AI signature to commit messages
- Commit messages in English, format: `type: description`
  - `feat:` new feature, `fix:` bugfix, `docs:` documentation, `chore:` build/config
- **NEVER commit `node_modules/`, `.turbo/`, `dist/`, `*.db`, `*.log`**

### After Each Change — Summary Required

After every code modification, output a brief summary:

```
**Reason**: <why this change was needed>
**Changes**: <what was changed, file:line>
**Impact**: <what features/behaviors are affected>
```

### Build & Pack — On Request Only

- **NEVER run `npm run pack` or `npm run build` automatically after changes**
- Only build/pack when user explicitly asks (`build` / `pack`)

---

## First-Time Setup

```bash
# 1. Clone + install
git clone <repo-url> && cd tomilite
npm install            # Install all workspace dependencies

# 2. Git hooks (native, no husky needed)
git config core.hooksPath .githooks
# After this, every git commit runs .githooks/pre-commit
```

## Build & Dev Commands

```bash
# Development
npm install            # Install all workspace dependencies
npm run dev            # Start all services (Turborepo parallel)
npm run db:migrate     # Push Prisma schema to SQLite (DO NOT use this in prod)
npm run db:seed        # Seed default data (project, board, LLM config)

# Production Build
npm run build          # TypeScript compile all packages
npm run build:prod     # Production build

# Single service
cd apps/api && npx tsx src/server.ts       # Start API server on :3001
cd apps/web && npx vite --port 3002        # Start web frontend on :3002

```

---

## Part 0 — Design Docs Maintenance (Highest Priority)

> `docs/` is the design source of truth. **Code must stay consistent with the docs.**

Before modifying code, check whether the following modules are involved. If so, **the corresponding design doc must be updated in the same commit**.

| Change involves | Doc to keep in sync |
|-----------------|---------------------|
| Architecture / module split / tech choice | `docs/SECURITY.md` |
| Database schema / Prisma model | `packages/database/prisma/schema.prisma` (single source of truth) |
| UI pages / routing / components | `mockup/index.html` (design mockup) |
| API routes / tRPC procedures | `apps/api/src/routers/*.ts` + `apps/web/src/lib/api.ts` |
| i18n | All `I18N` objects in `apps/web/src/*` |
| Security | `docs/SECURITY.md` |

---

## Part 1 — Frontend UI (React + TypeScript)

### 1.1 No Hardcoded Colors — Zero Hardcoded Colors

- NEVER hex (`#xxx`), rgb/rgba, hsl, or Tailwind color names (`gray-900`, `blue-500`)
- ONLY semantic CSS variables: `var(--brand)`, `var(--bg)`, `var(--ink)`, `var(--muted)`, `var(--edge)`, `var(--surface)`, `var(--surface2)`
- Status colors: `var(--green)`, `var(--amber)`, `var(--purple)`, `var(--blue)`

### 1.2 Use `cn()` for Dynamic Class Names

```ts
import { cn } from '@/lib/cn';
<div className={cn('card', isActive && 'bg-brand-soft')}>
```

### 1.3 All User-Visible Text via i18n — 3 Languages Required

NEVER hardcode English/Chinese/Japanese strings in JSX. ALL strings go through `t()`:
```ts
const t = useT();  // or: import { t } from '@/lib/i18n';
<button>{t('menuHome')}</button>
```
New strings MUST be added to ALL 3 languages (`en`, `zh`, `ja`) in the I18N object.

### 1.4 AI Output Language = UI Language

AI output language follows the UI language automatically.
- User sets UI to Chinese → AI responds in Chinese
- User sets UI to Japanese → AI responds in Japanese
- No separate "AI language" setting needed

### 1.5 Themes

- `pipeline` (default dark), `hub` (light), `canvas` (white), `quantum` (dark green)
- Apply via `data-theme` attribute on `<html>`
- ALL colors through CSS variables — theme switch changes variable values only

### 1.6 File Organization

```
apps/web/src/
├── components/         — ContentPanel, MarkdownEditor, settings forms, ui primitives
├── panels/             — Feature panels (tasks, notes, email, reports, mcp, feedback, settings)
├── stores/             — Zustand stores (appStore, languageStore, uiCommandStore)
├── hooks/              — React hooks (useChatSessions, …)
├── lib/                — cn.ts, api.ts, i18n.ts
└── styles/             — index.css (Tailwind + semantic variables)
```

---

## Part 3 — API Server (tRPC + Prisma + SQLite)

### 3.1 Router Structure
```
apps/api/src/
├── server.ts          — tRPC HTTP server entry (port 3001)
├── trpc.ts            — tRPC init (router, publicProcedure, middleware)
└── routers/
    ├── issue.ts       — Issue CRUD + children + rank
    ├── board.ts       — Board queries + moveCard
    ├── wiki.ts        — Knowledge pages CRUD
    ├── git.ts         — Git repo CRUD + hook handler
    ├── focus.ts       — IDE heartbeat + status
    └── system.ts      — OTA update check + version
```

### 3.2 Procedure Rules
- ALL procedures use `publicProcedure` (no auth middleware — single user)
- Input validation via Zod: `z.object({ ... })`
- Return types: raw data (no `ApiResponse` wrapper — tRPC handles serialization)
- Queries: `.query(async ({ input }) => ...)`
- Mutations: `.mutation(async ({ input }) => ...)`

### 3.3 Prisma Rules
- Single PrismaClient instance exported from `packages/database/src/index.ts`
- NEVER create new PrismaClient() in routers
- All queries use the shared `prisma` instance
- `schema.prisma` is the single source of truth for database schema
- After schema changes: `npx prisma generate` then `npx prisma db push`

### 3.4 No-Go List (API)
```
❌ Direct SQL queries                 → Prisma client only
❌ New PrismaClient() in routers      → import from @tomilite/database
❌ Hardcoded user/tenant IDs          → single user 'local-dev'
❌ Bearer token / auth checks         → no auth layer
❌ console.log in production          → use proper logger
❌ Synchronous file I/O               → async/await
```

---

## Part 4 — Database (SQLite via Prisma)

### 4.1 Schema Rules
- ALL tables use `String @id @default(uuid())` for primary keys
- Timestamps: `String @default("datetime('now')")` — ISO 8601 strings
- NO tenant_id column — single user, personal edition
- NO RLS, NO pgvector, NO PostgreSQL-specific types
- JSON data: `String` type (stored as JSON text)
- Boolean: `Boolean @default(false)` — Prisma maps to SQLite INTEGER 0/1

### 4.2 Migration Rules
- Development: `npx prisma db push` (fast, no migration files)
- Production: `npx prisma migrate dev --name <name>` (generates migration SQL)
- Seed data: `packages/database/src/seed.ts` — idempotent (upsert)
- NEVER manually edit SQLite file

---

## Part 5 — Multi-Language (i18n)

### 5.1 Three Languages Required
ALL user-visible strings MUST have `en`, `zh`, `ja` entries. No exceptions.

```ts
const I18N = {
  en: { menuHome: 'Home', ... },
  zh: { menuHome: '首页', ... },
  ja: { menuHome: 'ホーム', ... },
};
```

### 5.2 Language Switch Behavior
- Switching language instantly updates ALL UI text
- AI agent responses change language to match
- Stored in `localStorage` key `tomilite-lang`
- Default: `en`

---

## Part 6 — Security

### 6.1 No Secrets in Code
```
❌ Hardcoded API keys or secrets
❌ Encryption keys in source files
❌ Cloud API keys in git
✅ All secrets from environment variables or encrypted DB storage (AES-256-GCM)
```

---

## Part 7 — Cross-Cutting Rules

### 7.1 TypeScript
```
❌ any type                           → explicit types
❌ as Type assertions                 → type guards
❌ @ts-ignore                         → fix the error
❌ console.log in production code     → remove before commit
❌ unused imports                     → eslint auto-fix
```

### 7.2 State Management
```
Component-local state    → useState
Global app state         → Zustand (appStore)
Server data              → tRPC useQuery (react-query)
Theme/Language           → localStorage + document.documentElement
```

### 7.3 File Naming
```
Components:   PascalCase.tsx   (BoardPage, AppLayout)
Hooks:        useCamelCase.ts  (useUpdateCheck)
Stores:       camelCase.ts     (appStore)
Utilities:    camelCase.ts     (cn, api)
Routers:      camelCase.ts     (issue, board)
Types:        PascalCase.ts    (IssueData)
```

---

## Part 8 — Pre-Commit Checklist

Before ANY commit, verify:

```
[ ] No hardcoded hex/rgb/Tailwind color classes
[ ] No hardcoded English/Chinese/Japanese strings (use t() i18n)
[ ] All dynamic classNames use cn()
[ ] npx tsc --noEmit passes (root + each app)
[ ] No unused imports
[ ] No any type
[ ] No console.log
[ ] No hardcoded API keys or secrets
[ ] New i18n strings exist in ALL 3 languages (en/zh/ja)
[ ] Prisma schema matches actual DB (npx prisma validate)
[ ] No auth/tenant logic introduced (personal edition, single user)
```
