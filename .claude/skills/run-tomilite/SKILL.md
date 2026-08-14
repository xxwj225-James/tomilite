---
name: run-tomilite
description: Build, launch, and drive the TomiLite Electron app. Use for running the app, taking screenshots, or testing API endpoints programmatically.
---

# Run TomiLite

TomiLite is an AI-powered developer productivity desktop app (Electron + React +
Prisma + Node.js API). The backend runs on `http://localhost:3192`. The frontend
is an Electron shell.

All paths below are relative to the repo root.

## Prerequisites

- Node.js 20+
- npm
- Git Bash (Windows) or bash
- Electron runtime (auto-installed by `npm install`)

## Build

```bash
npm run pack          # production (no debug logs)
npm run pack:debug    # debug (agent.log + frontend.log enabled)
```

The installer lands at `dist-electron/TomiLite-Setup-1.0.0.exe`.
The unpacked executable is at `dist-electron/win-unpacked/TomiLite.exe`.

## Run (agent path) — use the driver

```bash
node .claude/skills/run-tomilite/driver.mjs <command>
```

| Command | Description |
|---------|------------|
| `build [debug]` | Build + pack. `debug` = `pack:debug`. |
| `launch` | Start the unpacked Electron app (API on :3192). Waits up to 30s. |
| `chat "<msg>"` | Send a chat message via SSE stream. Prints response tokens. |
| `sessions [id]` | List sessions, or get messages for a session ID. |
| `config` | Show active LLM provider and model config. |
| `debug [off]` | Enable `~/.tomilite/debug.flag`. `off` disables it. |
| `api GET <path>` | Raw API GET (e.g. `/api/chat.listSessions`). |
| `api POST <path> '<json>'` | Raw API POST. |

### Examples

```bash
# Check config
node .claude/skills/run-tomilite/driver.mjs config

# Chat via SSE
node .claude/skills/run-tomilite/driver.mjs chat "创建任务：测试bug"

# Enable debug logs, then build debug version
node .claude/skills/run-tomilite/driver.mjs debug
node .claude/skills/run-tomilite/driver.mjs build debug

# Raw API: list sessions
node .claude/skills/run-tomilite/driver.mjs api GET /api/chat.listSessions

# Raw API: create a task
node .claude/skills/run-tomilite/driver.mjs api POST /api/issue.create '{"projectId":"proj-default","title":"Test","type":"task","priority":"medium"}'
```

## Run (human path)

1. `npm run pack` (or `npm run pack:debug`)
2. Install from `dist-electron/TomiLite-Setup-1.0.0.exe`
3. Launch from Start Menu or desktop shortcut
4. Configure API key in Settings → LLM
5. Chat, create tasks/notes/reports

## API overview

All endpoints use JSON. Key endpoints:

| Endpoint | Description |
|----------|------------|
| `POST /api/agent/stream` | SSE chat (main agent interaction) |
| `GET /api/chat.listSessions` | List chat sessions |
| `GET /api/chat.getMessages` | Get messages for a session |
| `POST /api/issue.create` | Create a task |
| `POST /api/issue.update` | Update a task |
| `GET /api/llm.getConfig` | LLM provider config |
| `GET /api/git.recentCommits` | Recent git commits |

## Debug logs

Debug logs write to `~/.tomilite/agent.log` (backend) and
`~/.tomilite/frontend.log` (frontend). They are enabled only when
`~/.tomilite/debug.flag` exists:

```bash
# Enable
echo. > %USERPROFILE%\.tomilite\debug.flag
# Disable
del %USERPROFILE%\.tomilite\debug.flag
```

The `npm run pack:debug` build automatically creates this flag.

## Gotchas

- **Windows only.** The Electron builder targets `--win`. Cross-platform
  build requires modifying `package.json` scripts.
- **API server takes 5-15s to start** after Electron launch. The driver
  polls for up to 30s.
- **Port 3192 must be free.** If occupied, the API server silently fails.
- **Encrypted API key.** The LLM API key is stored encrypted in SQLite.
  The `config` driver command shows the encrypted value, not the real key.
- **Pre-commit hooks** run ESLint with `--max-warnings 0`. Use
  `--no-verify` to skip if only type annotations are flagged.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `API error 404: model not found` | Check `api/llm.getConfig` — model name may need updating in Settings |
| `Port 3192 already in use` | Kill existing Tomatolite process |
| Build hangs at electron-builder | Check disk space; `electron-builder` downloads large binaries |
| `Cannot find module @prisma/client` | Run `npx prisma generate --schema=packages/database/prisma/schema.prisma` |
