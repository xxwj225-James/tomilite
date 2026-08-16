# Agent External Capabilities — Technical Design

> Version: v3.0 | Date: 2026-08-15
> v3.0 changes: align with the shipped MCP Client implementation (auto-negotiating transport, tool registry with lazy discovery, HITL shipped) — see §9 status notes
> v2.0 changes: security model redesign / deadlock prevention / token masking / MCP Client first

## 1. Background

TomiLite already implements an MCP Server (called by external Agents), but lacks the reverse capability — the TomiLite Agent cannot call external Agents or services.

**Goal: let Tomi operate external tools while remaining secure.**

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
| TomiLite MCP server (external agents → TomiLite) | HITL shipped — risk-gated, manual/auto modes, audit log (§6)                                  |
| Tool injection                                   | `mcp__<server>__<tool>` tools discovered per request, capped at 25                            |

## 6. HITL Confirmation Flow — IMPLEMENTED

HITL is a real, shipped feature (not a plan). Two sides:

**1. TomiLite as MCP server (external agents call TomiLite)** — `apps/api/src/routers/mcp.ts`:

```
External agent calls POST /api/mcp.execute (tool + args + api_key)
  ↓
Backend assesses risk from TOOL_RISK table (read_only/low/medium/high)
  ↓
read_only → execute directly (auto-approve, status 'executed')
hitlMode 'auto' → execute directly (status 'completed', mode 'auto')
else → HITL task created (status 'pending', idempotency key, expiry 5-10 min)
  ↓
Pending task persisted to mcpAuditLog (audit trail) + OS notification sent
  ↓
Human approves/denies in the TomiLite UI → MCP Approve panel (McpPanel.tsx)
  [Approve] → mcp.confirmById → execute → audit log 'approved'
  [Deny]    → mcp.deny → audit log 'denied'
  ↓
Long-poll (max 5 min) returns the result to the external agent
```

- Task statuses: `pending / approved / denied / expired / executed`, all written to the `mcpAuditLog` DB table.
- `hitlMode` is per API key: `manual` (default — human must approve in UI; external `confirm` endpoint is rejected in manual mode) or `auto` (everything executes directly).
- UI: `apps/web/src/panels/mcp/McpPanel.tsx` (audit list with Approve/Deny), pending count badge in the sidebar. `hitlMode` selector lives in `apps/web/src/panels/settings/McpServerTab.tsx` (for server connections).

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
| `apps/api/src/routers/mcp.ts`                   | TomiLite MCP server — tools/list + execute with HITL gating, risk levels, manual/auto hitlMode, confirmById/deny, long-poll, audit log, pending count                                                 |
| `apps/api/src/routers/mcpServer.ts`             | McpServer CRUD (create/update/list) for the Settings UI                                                                                                                                               |
| `apps/web/src/panels/mcp/McpPanel.tsx`          | HITL audit panel — pending/approved/denied/executed/expired list with Approve/Deny                                                                                                                    |
| `apps/web/src/panels/settings/McpServerTab.tsx` | MCP server config form — URL, API key, headers, transport, hitlMode selector                                                                                                                          |
