# Agent Smoothness Optimization — Benchmarking Claude Code

> Version: v2.0 | Date: 2026-08-15
> v2.0 changes: aligned with the shipped implementation — pre-flight, sandbox declaration and tool pruning are DONE; JIT injection, optimistic UI and self-healing were NOT implemented (real alternatives documented in §3/§4)
> Based on Claude Code architecture analysis — 4 dimensions of optimization for the TomiLite Agent

## Current State Assessment

| Dimension              | Current State                                                           | Gap                                                            |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| Intent routing         | Guard Flash model (keyword pre-filter + Flash LLM)                      | 🟢 Shipped                                                     |
| Context management     | System prompt + sandbox declaration + tool pruning (`getActiveTools()`) | 🟢 Sandbox + pruning shipped; 🟡 JIT injection not implemented |
| Interaction experience | SSE streaming + frontend pre-flight (`preFlightPanel`)                  | 🟢 Pre-flight shipped (open commands only)                     |
| Error handling         | try-catch + ReAct-loop error-recovery hints                             | 🟡 No auto-heal; model self-corrects within the loop           |

---

## 1. Two-Stage Dual-Model Architecture

### Current Problem

The Guard and Pro models currently run serially — Pro only starts after Guard outputs its instruction. Users wait for the Guard HTTP round-trip plus Pro's streaming output. If Guard takes 1s and Pro takes 3s, the perceived latency is 4s.

### Optimization (actual implementation)

Phase 0 (frontend pre-flight) is shipped; Phases 1-2 are the existing Guard → Pro agent loop (`agentStream.ts`).

```
User message
  ↓
┌─ Phase 0: Frontend pre-flight (< 50ms) — SHIPPED ─┐
│ preFlightPanel() in useSendMessage.ts             │
│ Pure JS keyword detection, no network              │
│ OPEN commands → panel opens instantly              │
│ CREATE commands → deliberately NO panel open       │
└──────────────────────────────────────────────────┘
  ↓
┌─ Phase 1: Guard routing ─────────────────────────┐
│ Flash model → JSON intent + parameters            │
│ (classifyGuard: keyword pre-filter + Flash LLM)   │
└──────────────────────────────────────────────────┘
  ↓
┌─ Phase 2: Pro execution ─────────────────────────┐
│ Full context + tool calls + ReAct loop            │
│ Result streams back via SSE; cards appear in chat │
└──────────────────────────────────────────────────┘
```

### Key Implementation Points

**Frontend pre-flight (shipped in `apps/web/src/hooks/useSendMessage.ts`):**

```typescript
// Pre-flight: instant panel navigation for explicit OPEN commands only.
// Does NOT open panel for create commands — agent handles creation, C Plan cards show results.
export function preFlightPanel(msg: string): string | null {
  const m = msg.trim();
  if (/^(打开|open)\s*(task|任务).*一[览栏]/.test(m)) return 'tasks';
  if (/^(打开|open)\s*(note|笔记).*一[览栏]/.test(m)) return 'notes';
  if (/^(打开|open)\s*TL-(\d+)/i.test(m)) return 'tasks';
  if (/^(打开|open)\s*(report|报告)/i.test(m)) return 'reports';
  if (/^(打开|open)\s*(email|邮件|邮箱|メール)/i.test(m)) return 'email';
  return null;
}
// in sendMessage():
const targetPanel = preFlightPanel(q);
if (targetPanel) setPanel(targetPanel);
```

The original `PRE_FLIGHT_RULES` design (regex table with `navigateTo`/`openTask`/`openNewTaskForm` actions) was simplified: it handles open commands only, and create commands intentionally do NOT open panels (the Agent creates the item and shows a result card in chat).

**Before/after comparison:**

| Scenario                | Before         | After                                                          |
| ----------------------- | -------------- | -------------------------------------------------------------- |
| "open the task list"    | 4s (Guard+Pro) | <50ms (frontend pre-flight)                                    |
| "create a new note"     | 4s             | No panel pre-flight (by design); card in chat after Agent runs |
| "add content to a note" | 4s             | 1-2s (Guard routing + Pro execution)                           |

---

## 2. Context Sandbox & JIT Injection

### Current Problem (fixed where marked)

- ~~`shell_exec` doesn't explicitly declare workspace restrictions~~ — **FIXED**: sandbox declaration shipped (§2.1)
- The system prompt includes all 10 tool definitions (~2000 tokens) even when the current scenario needs only 3 — **FIXED**: tool pruning shipped (§2.3)
- No scenario-based dynamic injection of minimal context — **NOT implemented** (§2.2)

### Optimization

**1. Sandbox declaration — SHIPPED** (`apps/api/src/agent/prompts/systemPrompt.ts`):

```
SANDBOX: Workspace roots = ${workspaceRoots.join(', ')}. All file operations are restricted to these directories. Use shell_exec with cwd set to one of these paths for git operations.
```

Workspace roots come from `gitWorkDir` DB rows (+ process cwd), refreshed every 5 minutes (`apps/api/src/agent/utils/shell.ts`). `shell_exec` enforces the constraint in code: `validateCommand()` rejects any requested `cwd` outside the roots.

**2. JIT context injection — NOT implemented**

The design below was never built. The real alternatives that shipped instead:

- SSE **thinking-panel streaming**: `thinking` / `reasoning` / `tool_call` / `progress` events stream the Agent's thought process to the UI in real time, so the user sees activity during the round-trip (see §3).
- Editor-context injection at message-build time: `useSendMessage.ts` prepends the open editor state (`[Task editor OPEN: TL-3 ...]`, `[Note editor OPEN: ...]`, `[Tasks panel OPEN]`) to the message — context is injected when the message is sent, not at tool-execution time.

```typescript
// NOT IMPLEMENTED — original design kept for reference
async function executeAgentTool(tool: string, args: any) {
  switch (tool) {
    case 'shell_exec':
      const gitCtx = await getGitContext(args.cwd);
      args._context = gitCtx; // { branch: 'main', recentCommits: [...], dirty: false }
      break;
    case 'create_issue':
      const stats = await getProjectStats();
      args._context = stats; // { total: 12, todo: 5, inProgress: 4 }
      break;
    case 'create_note':
      const cats = await getExistingCategories();
      args._context = cats; // ['general', 'architecture', 'api_docs']
      break;
  }
  // ... execute
}
```

**3. Tool-list trimming by scenario — SHIPPED** (`apps/api/src/agent/tools/registry.ts`)

`getActiveTools(tools, context)` is called per request in `agentStream.ts` and prunes the `suggest_*_edit` form-filling tools based on which editor is open:

```typescript
export const CORE_TOOLS = [
  'get_stats',
  'list_issues',
  'get_issue',
  'brave_search',
  'web_search',
  'shell_exec',
  'mcp_call',
  'list_workspaces',
  'search_local_data',
];

export function getActiveTools(tools: any[], context: PruningContext): any[] {
  let active = tools;
  if (context.noteEditorOpen) {
    active = active.filter(
      (t) => t.function.name !== 'suggest_issue_edit' && t.function.name !== 'suggest_report_edit',
    );
  } else if (context.taskEditorOpen || context.newTaskFormOpen) {
    active = active.filter((t) => t.function.name !== 'suggest_note_edit' && t.function.name !== 'suggest_report_edit');
  } else if (context.reportEditorOpen) {
    active = active.filter((t) => t.function.name !== 'suggest_note_edit' && t.function.name !== 'suggest_issue_edit');
  }
  if (context.isQwen) {
    active = active.filter((t) => t.function.name !== 'web_search'); // Qwen uses native enable_search
  }
  return active;
}
```

| Scenario                    | Pruned tools                            | Core always kept                             |
| --------------------------- | --------------------------------------- | -------------------------------------------- |
| Note editor open            | suggest_issue_edit, suggest_report_edit | Core + suggest_note_edit + everything else   |
| Task editor / new task form | suggest_note_edit, suggest_report_edit  | Core + suggest_issue_edit + everything else  |
| Report editor open          | suggest_note_edit, suggest_issue_edit   | Core + suggest_report_edit + everything else |
| Pure chat                   | none                                    | All tools                                    |

**Effect:** unused tool definitions no longer consume context; the model's attention stays focused. Pruning never removes CORE_TOOLS, protecting the LLM context cache (see Appendix Fix 3).

---

## 3. Optimistic UI Updates — NOT IMPLEMENTED

### Current Problem

When the user says "open TL-3", the Agent streams tool_call JSON → the frontend waits for the full `tool_result` before updating the UI. Users see a typewriter effect with 2-4s latency.

### Status

The skeleton-screen approach below was **never implemented** — no `optimisticUI()`, no skeleton panels. The shipped alternative is:

**SSE thinking-panel streaming** — `useSendMessage.ts` renders the Agent's activity in real time as it happens:

- `thinking` event → "Thinking round N" status label
- `reasoning` event → streams the model's reasoning content into the message's thinking block
- `tool_call` event → "🔧 toolName: args-preview" line appended to the thinking block
- `tool_result` event → "🔧 toolName → ✅ result-brief" line

So the user watches the Agent think, call tools and get results as a live transcript — perceived latency is masked by visible progress. Instant panel opens are covered by the §1 pre-flight instead.

### Original design (kept for reference, NOT implemented)

```typescript
// App.tsx SSE handler — NOT IMPLEMENTED
if (delta?.tool_calls) {
  const tc = delta.tool_calls[0];
  if (tc.function?.name && !toolCallStarted) {
    toolCallStarted = true;
    optimisticUI(tc.function.name, tc.function.arguments || '{}');
  }
}

function optimisticUI(toolName: string, partialArgs: string) {
  switch (toolName) {
    case 'open_task':
      setPanel('tasks');
      showSkeleton('task-detail');
      break;
    case 'open_note':
      setPanel('notes');
      showSkeleton('note-editor');
      break;
    case 'navigate_to':
      const m = partialArgs.match(/"panel"\s*:\s*"(\w+)"/);
      if (m) setPanel(m[1]);
      break;
  }
}
```

**Effect (if implemented):** the panel slides out **immediately** (with skeleton screen); data fills in after 0.5s.

---

## 4. Self-Healing Loop — NOT IMPLEMENTED

### Current Problem

When `shell_exec` returns `code !== 0`, the user is simply told "command failed" — they must analyze the error, fix it manually, and resend.

### Status

No `aiFixCommand` / auto-heal was built — `shellExec` in `apps/api/src/agent/utils/shell.ts` returns the error verbatim. The shipped alternative is the **ReAct-loop error-recovery hints** in `apps/api/src/agent/core/agentEngine.ts`:

- Every tool result is checked for an `error` field; the error message is appended back into the conversation as a system hint, so the model can self-correct and retry **within the same ReAct loop** (e.g. "list_reports found nothing. Instead of retrying, use search_local_data... Do NOT output tool names as text — actually CALL the tool.").
- The loop runs up to MAX_ITERATIONS rounds; the user sees each attempt in the thinking panel, so the Agent visibly recovers from failed commands instead of hard-stopping.

The original `aiFixCommand` design (below) was never implemented.

### Original design (kept for reference, NOT implemented)

```typescript
async function shellExec(command: string, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const error = validateCommand(command, cwd);
  if (error) return { code: -1, stdout: '', stderr: `❌ ${error}` };

  let result = await nativeExec(command, cwd);

  // Auto-heal: auto-fix common errors
  if (result.code !== 0 && isRecoverable(result.stderr)) {
    const fixedCmd = await aiFixCommand(command, cwd, result.stderr);
    if (fixedCmd && fixedCmd !== command) {
      send('progress', { text: 'Auto-fixing command...' });
      result = await nativeExec(fixedCmd, cwd);
      if (result.code === 0) {
        result.stdout = `(auto-fixed: ${fixedCmd})\n${result.stdout}`;
      }
    }
  }

  return result;
}

// recoverable error patterns
const RECOVERABLE_PATTERNS = [
  /No such file or directory/, // wrong path
  /command not found/, // misspelled command
  /Permission denied/, // permission issue
  /fatal: not a git repository/, // wrong directory
];

async function aiFixCommand(cmd: string, cwd: string, error: string): Promise<string | null> {
  // quickly fix with the Flash model
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: flashModel,
      messages: [
        {
          role: 'user',
          content: `Command failed: "${cmd}"\nError: ${error}\nCWD: ${cwd}\nOutput ONLY the fixed command (one line, no explanation):`,
        },
      ],
      max_tokens: 100,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(3000),
  });
  if (!resp.ok) return null;
  const d = await resp.json();
  return d.choices?.[0]?.message?.content?.trim() || null;
}
```

**Effect (if implemented):** when the user types `git lig` (typo), the Agent auto-corrects it to `git log` and runs it — the user sees the correct result and never notices the fix in between.

---

## Implementation Status

| Priority | Optimization                         | Status             | Notes                                                                                 |
| -------- | ------------------------------------ | ------------------ | ------------------------------------------------------------------------------------- |
| P0       | Frontend pre-flight                  | ✅ SHIPPED         | `preFlightPanel()` in `apps/web/src/hooks/useSendMessage.ts` — open commands only     |
| P0       | Tool-list trimming per scenario      | ✅ SHIPPED         | `getActiveTools()` in `apps/api/src/agent/tools/registry.ts`, called per request      |
| P1       | JIT context injection (git context)  | ❌ NOT implemented | Alternative: editor-context injection at message-build time in `useSendMessage.ts`    |
| P1       | Sandbox declaration                  | ✅ SHIPPED         | `systemPrompt.ts` SANDBOX block + `shell.ts` cwd validation against workspace roots   |
| P2       | Optimistic UI (SSE skeleton screens) | ❌ NOT implemented | Alternative: SSE thinking-panel streaming (`thinking`/`reasoning`/`tool_call` events) |
| P2       | Self-healing loop                    | ❌ NOT implemented | Alternative: ReAct-loop error-recovery hints in `agentEngine.ts`                      |

---

## Change List (actual shipped)

| File                                         | Change                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/web/src/hooks/useSendMessage.ts`       | `preFlightPanel()` — detects open commands before sending a message, opens the panel in <50ms |
| `apps/api/src/agent/prompts/systemPrompt.ts` | SANDBOX declaration — workspace roots injected into the system prompt                         |
| `apps/api/src/agent/utils/shell.ts`          | cwd validation — shell_exec rejects paths outside workspace roots                             |
| `apps/api/src/agent/tools/registry.ts`       | `getActiveTools()` + `CORE_TOOLS` — scenario-based tool pruning                               |
| `apps/api/src/agent/agentStream.ts`          | Per-request `getActiveTools()` call + MCP tool injection merge                                |

---

## Appendix: Review Corrections (v1.1)

### Fix 1: Optimistic-UI JSON truncation ➔ accumulated matching (superseded — optimistic UI was NOT implemented; kept for reference)

**Problem**: SSE delta chunks can cut off mid-JSON, so the `partialArgs.match()` regex fails.

**Fix**: maintain an `accumulatedArgs` string and match against it after accumulating each chunk:

```typescript
let accumulatedArgs = '';
// SSE loop:
if (delta?.tool_calls) {
  accumulatedArgs += delta.tool_calls[0].function?.arguments || '';
  // Match against accumulated, not individual chunk
  const m = accumulatedArgs.match(/"panel"\s*:\s*"(\w+)"/);
  if (m) optimisticNavigate(m[1]);
}
```

### Fix 2: Self-healing ➔ at most 1 retry (superseded — self-healing was NOT implemented; kept for reference)

**Problem**: if the fixed command errors again, it could loop forever.

**Fix**: hard-code `maxRetries = 1`; if it still fails after one fix, return the original error:

```typescript
let retries = 0;
const MAX_RETRIES = 1;
while (result.code !== 0 && isRecoverable(result.stderr) && retries < MAX_RETRIES) {
  retries++;
  const fixedCmd = await aiFixCommand(command, cwd, result.stderr);
  if (!fixedCmd || fixedCmd === command) break;
  result = await nativeExec(fixedCmd, cwd);
}
```

### Fix 3: Tool trimming ➔ keep core tools to avoid cache invalidation

**Problem**: frequently switching the tool list invalidates the LLM context cache. If the user suddenly asks about "board status" while editing a note, the model stalls for lack of tools.

**Fix (shipped)**: `CORE_TOOLS` in `apps/api/src/agent/tools/registry.ts`:

```typescript
export const CORE_TOOLS = [
  'get_stats',
  'list_issues',
  'get_issue',
  'brave_search',
  'web_search',
  'shell_exec',
  'mcp_call',
  'list_workspaces',
  'search_local_data',
];
```

Core tools are always available; only scenario-specific `suggest_*_edit` tools are trimmed. Editing a note = Core + `suggest_note_edit`; viewing a task = Core + `suggest_issue_edit`. (The earlier draft's smaller CORE_TOOLS list was superseded — `get_issue`, `list_workspaces` and `search_local_data` are core in the shipped version.)
