# Agent External Capabilities — Technical Design

> Version: v3.1 | Date: 2026-09-22
> v3.1 changes: **standard MCP transport layer** — stdio + local StreamableHTTP, dual-era protocol (2026-07-28 / legacy), revised HITL-under-stdio contract (§6)
> v3.0 changes: align with the shipped MCP Client implementation (auto-negotiating transport, tool registry with lazy discovery, HITL shipped)
> v2.0 changes: security model redesign / deadlock prevention / token masking / MCP Client first

## 1. Background

TomiLite already implements an MCP Server (called by external Agents), but lacks the reverse capability — the TomiLite Agent cannot call external Agents or services.

**Goal: let Tomi operate external tools while remaining secure.**

Since v3.1 the server side speaks the real protocol rather than only resembling it: `POST /api/mcp` is a StreamableHTTP endpoint and `mcp-stdio.cjs` is a stdio entry point, both over one dispatcher (§6.1). Before that, the only entry point was `POST /api/mcp.execute` — a tRPC mutation with MCP-shaped fields but no JSON-RPC, no `initialize`, and no transport, so no stock MCP client could connect to it. That endpoint still exists and is unchanged for callers already using it.

## 2. Core Decision: Skip a Custom http_call, Go Straight to MCP Client

### Why Not Reinvent the Wheel

|                      | Custom http_call                                 | MCP Client                                                    |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| Create Issue in Jira | Agent hand-crafts JSON → high hallucination risk | Calls `jira_create_issue` → tool definition already validated |
| GitHub PR            | Agent must memorize API formats                  | `github_create_pr` — community-maintained                     |
| Security             | Agent touches plaintext tokens                   | Tokens live server-side only, invisible to Agent              |
| Ecosystem            | Hand-write every service                         | Inherits open-source MCP Servers directly                     |

**Decision: integrate the MCP Client protocol from Phase 1.** Mature MCP Servers already exist (github, jira, filesystem, postgres, etc.); TomiLite only needs a solid MCP Client connection layer.

## 3. Architecture

```
┌──────────────────────────────────────────────────┐
│                Tomi Agent                         │
│                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │ shell_exec   │  │  mcp_call   │  │ existing  │ │
│  │ (read-only) │  │  (any MCP)  │  │ DB tools  │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┘ │
└─────────┼────────────────┼───────────────────────┘
          ▼                ▼
    ┌──────────┐    ┌──────────────────────┐
    │ spawn()  │    │ MCP client + registry│
    │ stdin off│    │ (lazy per-request    │
    │ cwd bound│    │  discovery, 30s TTL) │
    │ kill     │    │ auto-negotiate       │
    └────┬─────┘    │ legacy/plain/jsonrpc │
         ▼          │ per baseUrl          │
    git / npm       └──────────────────────┘
```

> **Note:** the original "MCP Client pool with persistent connections per server" design was replaced by a lazy per-request registry (no long-lived connections, no reconnect/backoff) — see §7. shell_exec does not spawn the Claude Code CLI; it spawns the whitelisted command directly with stdin closed.

## 4. Tool Design

### 4.1 `shell_exec` — Restricted Shell (Read-Only Whitelist)

```typescript
{
  name: 'shell_exec',
  description: 'Execute a READ-ONLY shell command. Only whitelisted commands allowed. For git log, ls, cat, grep, find, wc, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string', description: 'Must be within workspace' }
    },
    required: ['command']
  }
}
```

**Security constraints (shipped in `apps/api/src/agent/utils/shell.ts`):**

```typescript
// read-only whitelist — everything else is rejected
const READ_ONLY_WHITELIST = [
  /^git\s+(log|status|diff|show|branch|tag|rev-parse|config\s+--get|remote\s+-v)(\s|$)/,
  /^ls(\s|$)/,
  /^dir(\s|$)/,
  /^cat\s/,
  /^head\s/,
  /^tail\s/,
  /^wc\s/,
  /^grep\s/,
  /^find\s/,
  /^which\s/,
  /^pwd$/,
  /^echo\s/,
  /^type\s/,
  /^node\s+-e\s/,
  /^npx\s+claude\s/,
];

// blocked programs (privilege escalation, file modification, network, encoding bypass)
const BLOCKED_PROGRAMS = [
  /^(bash|sh|zsh|exec|eval|sudo|su|chmod|chown|rm|mv|cp|mkdir|touch|curl|wget)(\s|$)/,
  /^(base64|xxd|openssl)(\s|$)/,
];

// pipes, redirection, command substitution, chaining
const DANGEROUS_METACHARS = /[;&|`$(){}<>]/;

export function validateCommand(cmd: string, requestedCwd?: string): string | null {
  if (
    DANGEROUS_METACHARS.test(
      cmd
        .replace(/^node\s+-e\s.*/, '')
        .replace(/^npx\s+claude\s.*/, '')
        .replace(/^echo\s.*/, '')
        .replace(/^git\s+log\s.*/, '')
        .replace(/^grep\s.*/, ''),
    )
  )
    return 'Command contains forbidden shell metacharacters.';
  if (!READ_ONLY_WHITELIST.some((r) => r.test(cmd))) return 'Command not in read-only whitelist.';
  if (BLOCKED_PROGRAMS.some((r) => r.test(cmd))) return 'Program not allowed.';
  if (requestedCwd && !WORKSPACE_ROOTS.some((r) => requestedCwd.startsWith(r))) {
    return 'cwd must be within workspace. Allowed roots: ' + WORKSPACE_ROOTS.join(', ');
  }
  return null;
}
```

Workspace roots are loaded from the `GitWorkDir` DB table (refreshed every 5 min), plus the process cwd.

**Deadlock-proof execution (actual `shellExec`):**

```typescript
import { spawn } from 'node:child_process';

export async function shellExec(
  command: string,
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const error = validateCommand(command, cwd);
  if (error) return { code: -1, stdout: '', stderr: '❌ ' + error };

  const targetCwd = cwd || WORKSPACE_ROOTS[0];
  if (!existsSync(targetCwd)) return { code: -1, stdout: '', stderr: '❌ Directory not found: ' + targetCwd };

  const { program, args } = parseCommand(command);

  return new Promise((resolve) => {
    const proc = spawn(program, args, {
      cwd: targetCwd,
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin closed → interactive commands fail immediately
    });

    let stdout = '',
      stderr = '';
    proc.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* best-effort */
      }
      resolve({ code: -1, stdout: stdout.slice(0, 8000), stderr: '⏱ Timeout (30s)' });
    }, 30000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 2000) });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: err.message });
    });
  });
}
```

### 4.2 `mcp_call` — MCP Protocol Call (replaces http_call)

```typescript
{
  name: 'mcp_call',
  description: 'Call a tool from a connected MCP server. Token is injected server-side — Agent never sees credentials.',
  parameters: {
    type: 'object',
    properties: {
      server: { type: 'string', description: 'MCP server name (e.g. github, jira)' },
      tool: { type: 'string', description: 'Tool name as defined by the MCP server' },
      args: { type: 'string', description: 'JSON string of tool arguments' }
    },
    required: ['server', 'tool', 'args']
  }
}
```

**Token-masked execution (shipped in `apps/api/src/agent/utils/mcp.ts`):**

`mcp_call` was retained as the legacy path for simple server names. Actual lookup order: **McpServer table by name → Integration table by type (legacy fallback)**. Tokens are decrypted server-side — the LLM never sees them.

```typescript
export async function mcpCall(server: string, tool: string, args: string) {
  // ─── Primary: McpServer table ───
  const srv = await prisma.mcpServer.findFirst({ where: { name: server, enabled: true } });
  if (srv) {
    url = srv.url;
    apiKey = srv.apiKey ? await decrypt(srv.apiKey) : undefined;
    headers = srv.headers ? JSON.parse(await decrypt(srv.headers)) : {};
    transport = srv.transport;
  } else {
    // ─── Fallback: Integration table (legacy) ───
    const integration = await prisma.integration.findFirst({ where: { type: server, enabled: true } });
    if (!integration) {
      return { error: 'No MCP server configured for "' + server + '". Add it in Settings → MCP Servers.' };
    }
    const config = JSON.parse(integration.config);
    url = config.baseUrl || config.url;
    let token = config.apiKey || config.token;
    if (token) {
      if (token.includes(':')) token = await decrypt(token);
      apiKey = token;
    }
    transport = 'legacy';
  }

  const client = createMCPClient({ name: server, url, apiKey, headers, transport });
  const result = await client.callTool(tool, JSON.parse(args));
  if (!result.ok) return { error: result.error || 'MCP call failed', server, tool };
  return { server, tool, result: result.result };
}
```

In addition, modern `mcp__<server>__<tool>` tools are dispatched dynamically in `apps/api/src/agent/tools/dispatcher.ts` (McpServer lookup first, `mcpCall` fallback).

The Agent's system prompt only sees:

```
Connected services: github, jira
Use mcp_call(server, tool, args) to interact with them.
```

The Agent never sees any Token, API Key, or Authorization header. All credentials are read from the encrypted DB and injected by the backend.

## 5. Security Model

### 5.1 Three Layers of Defense

```
Layer 1: Whitelist + Blacklist (shipped)
  ├─ Read-only commands → executed directly
  ├─ shell_exec write commands → rejected (no Phase 2 HITL dialog for local shell yet)
  └─ mcp_call → read/write risk handled by the remote server's own HITL
     (remote "pending" status is surfaced to the Agent); TomiLite's own
     MCP server exposes a HITL gate for external agents calling TomiLite

Layer 2: Execution Sandbox (shipped)
  ├─ stdin closed → interactive commands fail immediately
  ├─ cwd restricted to workspace roots (from GitWorkDir DB table)
  ├─ 30s timeout + SIGKILL
  └─ output truncated to 8000 chars

Layer 3: Token Isolation (shipped)
  ├─ Agent only passes the server name
  ├─ backend reads + decrypts credentials from encrypted DB
  └─ Agent never touches plaintext tokens
```

### 5.2 Phase Evolution (actual)

| Area                                             | Status                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| shell_exec                                       | Read-only whitelist shipped; no write commands, no local HITL dialog yet                      |
| mcp_call                                         | Shipped as legacy path (McpServer → Integration lookup); remote servers handle their own HITL |
| TomiLite MCP server (external agents → TomiLite) | Standard transports shipped — stdio + local StreamableHTTP, dual-era protocol; HITL risk-gated with manual/auto modes and an audit log (§6)                    |
| Tool injection                                   | `mcp__<server>__<tool>` tools discovered per request, capped at 25                            |

## 6. The MCP Server — Transports and HITL

### 6.1 Two transports, one dispatcher

```
apps/api/src/mcp/catalogue.ts   the 17 tools: name, title, description, inputSchema, risk
        │
        ├── riskOf / requiredOf / validateArgs        (schema is the only source of truth)
        ▼
apps/api/src/mcp/dispatch.ts    pure JSON-RPC: era detection, routing, success/failure mapping
        │                       knows nothing about transport; takes callTool by injection
        ├──────────────────────────────┬──────────────────────────────────┐
        ▼                              ▼                                  ▼
apps/api/src/mcp/http.ts      apps/api/src/mcp/stdio.ts        (tests / future callers)
POST /api/mcp                 mcp-stdio.cjs, newline JSON
        │                              │
        └──────────────┬───────────────┘
                       ▼
             POST /api/mcp.execute  (tRPC, unchanged)
                       ▼
        apps/api/src/routers/mcp.ts — risk, scopes, HITL, audit
```

The stdio shim deliberately **does not touch the database or the tool implementations**. The HITL queue (`hitlTasks`) and the audit log live in the API process's memory; a second copy of the tool logic in the shim would take a call, file an approval, and then wait forever for a human whose answer is delivered to a queue that process cannot see. Every call goes over localhost HTTP to the running app instead.

| Transport | Entry point | Auth | Notes |
| --- | --- | --- | --- |
| stdio | `mcp-stdio.cjs`, started by the client | `TL_MCP_API_KEY` env | Runs under `TomiLite.exe` with `ELECTRON_RUN_AS_NODE=1` — the installer ships no `node.exe`. Paths are reported by `mcp.transportInfo` and rendered in Settings → API Keys. The shim's own port default is `3192` (the packaged app's port) while `server.ts` defaults to `3091`, so the generated config passes `API_PORT` explicitly; both agree in the packaged app, and the difference only shows up when running the API directly. |
| StreamableHTTP | `POST http://127.0.0.1:<port>/api/mcp` | `X-Api-Key` header | Local-origin only. No session, no SSE stream, single `application/json` response. |

`get_task_result` is exposed as a real tool so a client can collect the outcome of an approval that landed after its own call had returned.

### 6.2 Protocol eras

The server implements both, and the era is decided per request — **not** by a session or a handshake:

| Request | Era | Behaviour |
| --- | --- | --- |
| has `_meta["io.modelcontextprotocol/protocolVersion"]` | modern (2026-07-28) | version validated; `resultType: "complete"` added to each result |
| no `_meta` | legacy (2025-11-25 and earlier) | `initialize` handshake; results carry no `resultType` |

That is what makes the endpoint stateless: no `Mcp-Session-Id`, no `initialize` requirement on the modern path, no server-side state to lose across a restart. It also means legacy and modern clients are both served by the same code path.

| Method | Era | Response |
| --- | --- | --- |
| `initialize` | legacy only | modern callers get `-32601` |
| `notifications/initialized` | legacy only | notifications never get a response |
| `ping` | legacy only | **removed in 2026-07-28**; answering it there is a spec violation, so modern callers get `-32601` |
| `server/discover` | modern only | legacy callers get `-32602` (not `-32022`) — that is the answer that makes a probing client fall back to `initialize` |
| `tools/list` | both | modern results add `ttlMs` + `cacheScope` (both required by the 2026-07-28 schema) |
| `tools/call` | both | §6.4 |
| unknown method | — | `-32601`, HTTP 404 on the HTTP transport |
| unsupported `_meta` version | modern | `-32022` with `data.supported` + `data.requested` |

Versions advertised: `2026-07-28` plus legacy `2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07`.

`structuredContent` only exists from 2025-06-18 onward, so it is sent only when the negotiated version is at least that — older clients get the JSON in the text block, which every client can read.

### 6.3 StreamableHTTP requirements

| Requirement | Behaviour |
| --- | --- |
| `Mcp-Method` / `Mcp-Name` | Validated **only when present**. The spec says REQUIRED, but refusing a client that omits them would break exactly the clients this transport exists to serve, and the rule's security rationale — an intermediary trusting the header over the body — does not apply to a local-only port. One line flips it to strict. |
| `Origin` | Present and not localhost → **403** |
| `GET` / `DELETE` | **405** + `Allow: POST` (no SSE stream, no session) |
| Unknown method | HTTP **404** + `-32601` |
| Unparseable body | HTTP **400** + `-32700` |
| Non-JSON content type | HTTP **415** |
| Body over 1 MiB | HTTP **413** |
| `Accept: text/event-stream` | Answered with a single SSE frame, then closed |
| Batch (array body) | Rejected — not implemented, and rejected loudly rather than silently mis-answered |

### 6.4 `tools/call` — success and failure

`mcp.execute` reports failures as **data** (`{error: '…'}`) — the convention throughout this codebase, see `lib/hosted.ts`. MCP splits them in two, so the dispatcher maps them:

| Tool result | JSON-RPC response |
| --- | --- |
| executed / completed | `result: {content, isError: false}` |
| pending / denied / expired | `result: {isError: true}` — the text says plainly that **nothing has been executed** |
| `{error: '…'}` from the tool | `result: {isError: true}`, text is that error |
| invalid or missing API key, insufficient scope | also `isError: true` — deliberately **not** a protocol error, so the model can read it and tell the user to regenerate the key instead of the client showing an opaque protocol fault |
| **unknown tool name** | JSON-RPC **`-32602`**, rejected *before* any approval task is created |
| `params.name` missing / not a string | JSON-RPC **`-32602`** |

Putting unknown tools in the protocol-error class also fixes an old behaviour: an unknown name used to create a pending task, wait for a human to approve it, and only then answer `Unknown tool`.

### 6.5 HITL confirmation flow

```
External agent calls a write tool (over stdio or POST /api/mcp)
  ↓
Risk comes from the tool's own definition in catalogue.ts (read_only / low / medium / high)
  ↓
read_only → execute directly (status 'executed'), no task created
hitlMode 'auto' → execute directly (status 'completed', mode 'auto')
else → HITL task created (status 'pending', idempotency key, expiry 5-10 min)
  ↓
Pending task persisted to mcpAuditLog (audit trail) + OS notification sent
  ↓
Human approves/denies in the TomiLite UI → MCP panel (McpPanel.tsx)
  [Approve] → mcp.confirmById → executes the tool itself, stores task.result → audit 'approved'
  [Deny]    → mcp.deny → audit log 'denied'
  ↓
The waiting call returns, or the caller polls with get_task_result
```

- Task statuses: `pending / approved / denied / expired / executed`, all written to the `mcpAuditLog` DB table.
- `hitlMode` is per API key: `manual` (default) or `auto`. `scopes` is also enforced per key: a key without `write` is refused any tool whose risk is not `read_only`.
- **The wait is bounded and short.** MCP clients abandon a tool call somewhere near a minute and then show the model a transport error it cannot explain. So the stdio shim asks the API to wait **20 s** by default (`TL_MCP_WAIT_MS`, `0`–`300000`) and its own HTTP budget is that plus 15 s, so a slow answer is never misreported as "server unreachable". On timeout the call returns `isError: true` with a message saying nothing was executed, to approve in the MCP panel, and to retry with the same arguments — or to collect it with `get_task_result`. `wait_ms` is an optional parameter of `mcp.execute`; a caller that omits it keeps the old 300 s behaviour.
- **Approving late is not wasted.** `confirmById` — the UI's Approve button — executes the tool itself and stores the result on the task, so an approval that lands after the client gave up still performs the action and is still retrievable.
- UI: `apps/web/src/panels/mcp/McpPanel.tsx` (audit list with Approve/Deny), pending count badge in the sidebar, key management in `apps/web/src/panels/settings/ApiKeyTab.tsx`.

### 6.6 Known limitation: pending approvals do not survive a restart

`hitlTasks` is an in-process `Map`. Restarting TomiLite discards every pending task. `mcp.getTaskResult` has a database fallback that looks for the task id inside `mcpAuditLog.arguments`, but the id is never written there, so that fallback never matches. Approve before quitting, or re-issue the call. Fixing this properly needs a `taskId` column on `McpAuditLog` — a storage change, deliberately not part of this release.

`ApiKey.expiresAt` is likewise stored and displayed but not enforced; see `docs/SECURITY.md`.

**2. TomiLite as MCP client (Tomi Agent calls external servers)** — `apps/api/src/agent/mcp/client.ts`:

When the remote server returns a `pending`/`pending_confirmation` status, the client maps it to a "Waiting for human approval on the remote server." error with the task ID, which is surfaced to the LLM so the Agent knows to wait rather than retry. Write tools get a 320s (~5 min) timeout to accommodate remote approval round-trips; read tools get 15s.

## 7. MCP Client Connection Management (actual)

The original "persistent connection pool with exponential backoff" design was **not** implemented. The shipped flow is a lazy, per-request registry (`apps/api/src/agent/mcp/registry.ts`):

```
On every chat request:
  1. getInjectedTools() → mcpRegistry.ensureFresh()
  2. Cache entries older than 30s (TTL) → refresh; new/removed servers detected by diffing McpServer DB ids
  3. refreshAll() discovers tools for each enabled server in parallel,
     with a per-server 10s discovery timeout
  4. Discovered tools → injected into the Agent's tool list
     (capped at 25, named mcp__<server>__<tool>, described as "[MCP: <server>] ...")

Transport per server:
  - protocolCache (Map<baseUrl, mode>) remembers the negotiated mode
  - Auto-negotiation order: legacy (URL ends in /tools/call) → plain
    (method-envelope {method:'tools/list'}) → JSON-RPC (initialize handshake) → default plain

Failure handling:
  - Unreachable server → cached tools kept (graceful degradation), status marked offline
  - status / toolCount / toolsJson / lastConnectedAt / lastError persisted back to the McpServer row
  - connect()/disconnect()/refresh() exposed for the Settings UI (Test / Connect buttons)

No long-lived connections, no reconnect, no backoff — a fresh HTTP client is created per call.
```

## 8. Change List (actual shipped)

| File                                            | Change                                                                                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/agent/mcp/client.ts` (new)        | MCP protocol client — auto-negotiating legacy/plain/jsonrpc per baseUrl, SSE response parsing, result normalization, 15s read / 320s write timeouts, remote HITL `pending` status surfaced to the LLM |
| `apps/api/src/agent/mcp/inject.ts` (new)        | Tool naming `mcp__<server>__<tool>` (sanitized), `[MCP: <server>]` description prefix, 25-tool injection cap, `parseMcpToolName`                                                                      |
| `apps/api/src/agent/mcp/registry.ts` (new)      | Lazy tool discovery registry — 30s TTL, per-server 10s timeout, graceful fallback to cached tools, state persisted to McpServer DB                                                                    |
| `apps/api/src/agent/mcp/types.ts` (new)         | Shared types (TransportMode, McpToolInfo, McpCallResult)                                                                                                                                              |
| `apps/api/src/agent/utils/shell.ts`             | `shell_exec` — read-only whitelist, blocked programs, forbidden metacharacters, cwd bound to workspace roots, stdin closed, 30s timeout                                                               |
| `apps/api/src/agent/utils/mcp.ts`               | `mcp_call` — McpServer → Integration lookup order, decrypted tokens                                                                                                                                   |
| `apps/api/src/agent/tools/dispatcher.ts`        | Dynamic dispatch of `mcp__<server>__<tool>` tools + `mcp_call`/`shell_exec` cases                                                                                                                     |
| `apps/api/src/mcp/catalogue.ts` (new)           | The single source of truth for the 17 tools — name, title, description, `inputSchema`, `risk`. `riskOf`/`requiredOf`/`validateArgs` all derive from it, so the risk table, the validator, and the advertised schema cannot drift apart again                                     |
| `apps/api/src/mcp/protocol.ts` (new)            | Wire constants: versions, `_meta` keys, error codes, `detectEra`, `serverInfo`, result helpers. Zero imports — bundled into the stdio shim                                                                                                                              |
| `apps/api/src/mcp/dispatch.ts` (new)            | Pure JSON-RPC dispatcher shared by both transports — era detection, method routing, `tools/call` success/failure mapping                                                                                                                                                 |
| `apps/api/src/mcp/http.ts` (new)                | StreamableHTTP handler for `POST /api/mcp` — origin check, body cap, header validation, HTTP status mapping, one-shot SSE                                                                                                                                                |
| `apps/api/src/mcp/stdio.ts` (new)               | stdio entry point, bundled to `apps/api/dist/mcp-stdio.cjs` — newline-delimited JSON on stdin/stdout, diagnostics on stderr, every call bridged to localhost HTTP                                                                                                         |
| `scripts/mcp-stdio-smoke.js` (new)              | End-to-end check driving the real shim over real pipes against a temp copy of the database, plus the same messages over `POST /api/mcp`                                                                                                                                  |
| `apps/api/src/routers/mcp.ts`                   | TomiLite MCP server — tools/list + execute with HITL gating, risk levels from the catalogue, enforced `scopes`, manual/auto hitlMode, confirmById/deny, bounded wait, audit log, pending count, `get_task_result`, `get_board_status`, `transportInfo`                      |
| `scripts/bundle-api.js`                         | Two `esbuild.build()` calls — `server.cjs` (unchanged output path) and `mcp-stdio.cjs`                                                                                                                                                                                  |
| `apps/api/src/routers/mcpServer.ts`             | McpServer CRUD (create/update/list) for the Settings UI                                                                                                                                               |
| `apps/web/src/panels/mcp/McpPanel.tsx`          | HITL audit panel — pending/approved/denied/executed/expired list with Approve/Deny                                                                                                                    |
| `apps/web/src/panels/settings/McpServerTab.tsx` | MCP server config form — URL, API key, headers, transport, hitlMode selector                                                                                                                          |
