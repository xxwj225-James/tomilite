# Agent External Capabilities — Technical Design

> Version: v2.0 | Date: 2026-06-29
> v2.0 changes: security model redesign / deadlock prevention / token masking / MCP Client first

## 1. Background

TomiLite already implements an MCP Server (called by external Agents), but lacks the reverse capability — the TomiLite Agent cannot call external Agents or services.

**Goal: let Tomi operate external tools while remaining secure.**

## 2. Core Decision: Skip a Custom http_call, Go Straight to MCP Client

### Why Not Reinvent the Wheel

| | Custom http_call | MCP Client |
|---|---|---|
| Create Issue in Jira | Agent hand-crafts JSON → high hallucination risk | Calls `jira_create_issue` → tool definition already validated |
| GitHub PR | Agent must memorize API formats | `github_create_pr` — community-maintained |
| Security | Agent touches plaintext tokens | Tokens live server-side only, invisible to Agent |
| Ecosystem | Hand-write every service | Inherits open-source MCP Servers directly |

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
    ┌──────────┐    ┌──────────────────┐
    │ spawn()  │    │ MCP Client pool  │
    │ stdin off│    │ ┌──────────────┐ │
    │ cwd bound│    │ │ github MCP   │ │
    │ kill pg  │    │ │ jira MCP     │ │
    └────┬─────┘    │ │ filesystem   │ │
         ▼          │ │ postgres     │ │
    Claude Code CLI │ └──────────────┘ │
    git / npm       └──────────────────┘
```

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

**Security constraints (Phase 1):**

```typescript
// read-only whitelist — everything else is rejected
const READ_ONLY_WHITELIST = [
  /^git\s+(log|status|diff|show|branch|tag|rev-parse|config\s+--get)/,
  /^ls(\s|$)/, /^cat\s/, /^head\s/, /^tail\s/, /^wc\s/,
  /^grep\s/, /^find\s/, /^which\s/, /^pwd$/, /^echo\s/,
  /^node\s+-e\s/, /^npx\s+claude\s/,
];

// no nested shells
const BLOCKED_PATTERNS = [
  /\|/, /`/, /\$\(/, /&&/, /\|\|/, /;/,        // pipes, command substitution, chaining
  /bash/, /sh\s/, /zsh/, /exec/, /eval/,       // subshells
  /sudo/, /su\s/, /chmod/, /chown/,            // privilege escalation
  /rm\s/, /mv\s/, /cp\s/, /mkdir/, /touch/,    // file modification
  />/, />>/, /<\s*\//,                          // redirection
  /base64/, /xxd/, /openssl\s+enc/,            // encoding bypass
  /curl/, /wget/,                               // network requests (go through mcp_call)
];

function validateCommand(cmd: string, workspace: string, requestedCwd?: string): boolean {
  // 1. whitelist check
  if (!READ_ONLY_WHITELIST.some(r => r.test(cmd))) return false;
  // 2. blacklist check
  if (BLOCKED_PATTERNS.some(r => r.test(cmd))) return false;
  // 3. cwd must be inside workspace
  if (requestedCwd && !requestedCwd.startsWith(workspace)) return false;
  return true;
}
```

**Deadlock-proof execution:**

```typescript
import { spawn } from 'child_process';

async function shellExec(command: string, cwd: string, timeout = 30000) {
  if (!validateCommand(command, WORKSPACE_ROOT, cwd)) {
    return { code: -1, stdout: '', stderr: '❌ Blocked: command not in read-only whitelist or contains unsafe patterns.' };
  }

  return new Promise(resolve => {
    const proc = spawn(command, {
      cwd: cwd || WORKSPACE_ROOT,
      shell: true,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],  // stdin closed → interactive commands fail immediately
    });

    let stdout = '', stderr = '';
    proc.stdout?.on('data', d => stdout += d);
    proc.stderr?.on('data', d => stderr += d);

    const timer = setTimeout(() => {
      // kill the entire process group, no zombies
      try { process.kill(-proc.pid!, 'SIGKILL'); } catch {}
      resolve({ code: -1, stdout: stdout.slice(0, 8000), stderr: '⏱ Timeout' });
    }, timeout);

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 2000) });
    });

    proc.on('error', err => {
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

**Token-masked execution:**

```typescript
async function mcpCall(server: string, tool: string, args: string) {
  // Agent only passes the server name; it never sees the token
  const integration = await prisma.integration.findFirst({
    where: { type: server, enabled: true }
  });
  if (!integration) return { error: `No integration configured for "${server}". Set it up in Settings.` };

  const config = JSON.parse(integration.config);
  const client = getMCPClient(server, config); // get from the connection pool

  // backend injects the token; invisible to the Agent throughout
  const result = await client.callTool(tool, JSON.parse(args));
  return { server, tool, result };
}
```

The Agent's system prompt only sees:
```
Connected services: github, jira
Use mcp_call(server, tool, args) to interact with them.
```

The Agent never sees any Token, API Key, or Authorization header. All credentials are read from the encrypted DB and injected by the backend.

## 5. Security Model

### 5.1 Three Layers of Defense

```
Layer 1: Whitelist + Blacklist (Phase 1)
  ├─ Read-only commands → executed directly
  ├─ shell_exec write commands → rejected (opened in Phase 2 + HITL)
  └─ mcp_call → always requires HITL (external operations are irreversible)

Layer 2: Execution Sandbox (Phase 1)
  ├─ stdin closed → interactive commands fail immediately
  ├─ cwd restricted to workspace
  ├─ process-group timeout kill(-SIGKILL)
  └─ output truncated to 8000 chars

Layer 3: Token Isolation (Phase 1)
  ├─ Agent only passes the server name
  ├─ backend reads credentials from encrypted DB
  └─ Agent never touches plaintext tokens
```

### 5.2 Phase Evolution

| Phase | shell_exec | mcp_call |
|-------|-----------|----------|
| Phase 1 (this round) | Read-only whitelist, no HITL | Reads execute directly; writes require HITL |
| Phase 2 (later) | Write commands open with HITL dialog | Everything with HITL dialog |

## 6. HITL Confirmation Flow

Write operations (Phase 2) call chain:

```
Agent calls mcp_call({ server:'jira', tool:'create_issue', args:... })
  ↓
Backend parses → assesses risk → medium/high
  ↓
Generates HITL Task → pushed to frontend
  ↓
Frontend dialog: "Agent wants to create Issue「Login crash」in Jira — allow?"
  [Approve] [Deny]
  ↓
Approve → execute → return result
Deny → return rejection
```

Reuses the existing MCP HITL mechanism (`apps/api/src/routers/mcp.ts`); no new implementation needed.

## 7. MCP Client Connection Management

```
On service startup:
  1. Read all enabled services from the Integration table
  2. Establish an MCP Client connection for each service
  3. Call tools/list to discover available tools
  4. Inject the tool list into the Agent system prompt

At runtime:
  Agent calls mcp_call → get client from pool → call tool → return result
  
Connection pool:
  - One persistent connection per MCP Server
  - Auto-reconnect on disconnect (exponential backoff)
  - No response within 30s → connection marked as degraded
```

## 8. Change List (Phase 1)

| File | Change |
|------|------|
| `agent.ts` | +1 tool (shell_exec read-only whitelist) +1 tool (mcp_call) |
| `agent.ts` | executeAgentTool adds shellExec + mcpCall |
| `agent.ts` | Security checks: whitelist/blacklist/cwd restriction/stdin closed/process-group kill |
| `mcp-client.ts` (new) | MCP Client connection pool + tool discovery + token injection |
| Settings UI (new) | Integration config page (MCP Server URL + Token) |
| No frontend HITL | Phase 1 read-only ops show results directly; Phase 2 adds dialogs |
