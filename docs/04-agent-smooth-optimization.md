# Agent Smoothness Optimization — Benchmarking Claude Code

> Version: v1.0 | Date: 2026-06-29
> Based on Claude Code architecture analysis — 4 dimensions of optimization for the TomiLite Agent

## Current State Assessment

| Dimension | Current State | Gap |
|------|----------|------|
| Intent routing | Guard Flash model (single stage) | 🟡 Partially implemented, needs strengthening |
| Context management | System prompt + noteContext | 🔴 No sandbox constraints, no JIT injection |
| Interaction experience | SSE → token → setState | 🟡 Standard flow, no "pre-flight" |
| Error handling | try-catch + returns error | 🔴 No self-healing |

---

## 1. Two-Stage Dual-Model Architecture

### Current Problem
The Guard and Pro models currently run serially — Pro only starts after Guard outputs its instruction. Users wait for the Guard HTTP round-trip plus Pro's streaming output. If Guard takes 1s and Pro takes 3s, the perceived latency is 4s.

### Optimization

```
User message
  ↓
┌─ Phase 0: Frontend pre-flight (< 50ms) ─────────┐
│ Frontend keyword detection (pure JS, no network)  │
│ "open task" → immediately dispatch open_task skeleton │
│ "create note" → immediately open Notes editor skeleton │
└──────────────────────────────────────────────────┘
  ↓
┌─ Phase 1: Guard routing (< 500ms) ──────────────┐
│ Flash model → outputs JSON intent + parameters    │
│ If frontend already pre-flighted → just validate/fix, no repeated UI │
│ If not pre-flighted → trigger the matching UI action │
└──────────────────────────────────────────────────┘
  ↓
┌─ Phase 2: Pro execution (1-5s) ─────────────────┐
│ Full context + tool calls + Agentic Loop          │
│ Frontend skeleton filled with real data           │
└──────────────────────────────────────────────────┘
```

### Key Implementation Points

**Frontend pre-flight rules (zero network latency):**

```typescript
const PRE_FLIGHT_RULES = [
  { pattern: /open\s+(task|issue).*(list|board)/, action: () => navigateTo('tasks') },
  { pattern: /open\s+(note|document).*(list|board)/, action: () => navigateTo('notes') },
  { pattern: /open\s*TL-(\d+)/, action: (m) => openTask(parseInt(m[1])) },
  { pattern: /create.*(task|issue|bug)/, action: () => openNewTaskForm() },
  { pattern: /create.*(note|document)/, action: () => openNewNoteForm() },
];

function preFlightCheck(message: string): UICommand | null {
  for (const rule of PRE_FLIGHT_RULES) {
    const match = message.match(rule.pattern);
    if (match) return rule.action(match);
  }
  return null;
}
```

**Before/after comparison:**

| Scenario | Before | After |
|------|--------|--------|
| "open the task list" | 4s (Guard+Pro) | <50ms (frontend pre-flight) |
| "create a new note" | 4s | <50ms (frontend pre-flight) |
| "add content to a note" | 4s | 1-2s (Guard routing + Pro execution) |

---

## 2. Context Sandbox & JIT Injection

### Current Problem
- `shell_exec` doesn't explicitly declare workspace restrictions
- The system prompt includes all 10 tool definitions (~2000 tokens) even when the current scenario needs only 3
- No scenario-based dynamic injection of minimal context

### Optimization

**1. Sandbox declaration (system-prompt level)**

```
SANDBOX: Your workspace is ${WORKSPACE}. 
- You CAN read/write within this directory.
- You CANNOT access anything outside this directory.
- shell_exec cwd is locked to workspace.
- Any attempt to escape the sandbox will be blocked.
```

**2. JIT context injection (injected only at tool execution time)**

```typescript
async function executeAgentTool(tool: string, args: any) {
  // JIT: inject minimal context before execution
  switch (tool) {
    case 'shell_exec':
      // inject current git state (only 50 tokens)
      const gitCtx = await getGitContext(args.cwd);
      args._context = gitCtx; // { branch: 'main', recentCommits: [...], dirty: false }
      break;
    case 'create_issue':
      // inject current project stats (only 30 tokens)
      const stats = await getProjectStats();
      args._context = stats; // { total: 12, todo: 5, inProgress: 4 }
      break;
    case 'create_note':
      // inject existing note category list (only 20 tokens)
      const cats = await getExistingCategories();
      args._context = cats; // ['general', 'architecture', 'api_docs']
      break;
  }
  // ... execute
}
```

**3. Tool-list trimming by scenario (exists today, needs strengthening)**

| Scenario | Available Tools | Token Savings |
|------|-----------|-----------|
| Note editor open | suggest_note_edit | ~1500 |
| Tasks panel | create_issue, suggest_issue_edit, list_issues, get_stats | ~800 |
| Pure chat | All 10 | 0 |
| During shell execution | shell_exec + mcp_call only | ~1200 |

**Effect:** unused tool definitions no longer consume context; the model's attention stays focused.

---

## 3. Optimistic UI Updates

### Current Problem
When the user says "open TL-3", the Agent streams tool_call JSON → the frontend waits for the full `tool_result` before updating the UI. Users see a typewriter effect with 2-4s latency.

### Optimization

**Detect the tool_call prefix in the SSE stream → trigger the skeleton screen immediately**

```typescript
// App.tsx SSE handler
if (delta?.tool_calls) {
  const tc = delta.tool_calls[0];
  if (tc.function?.name && !toolCallStarted) {
    toolCallStarted = true;
    // pre-flight: don't wait for full arguments, trigger UI action immediately
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
      // try to extract the panel from the partial args
      const m = partialArgs.match(/"panel"\s*:\s*"(\w+)"/);
      if (m) setPanel(m[1]);
      break;
  }
}
```

**Effect:** the panel slides out **immediately** (with skeleton screen); data fills in after 0.5s.

---

## 4. Self-Healing Loop

### Current Problem
When `shell_exec` returns `code !== 0`, the user is simply told "command failed" — they must analyze the error, fix it manually, and resend.

### Optimization

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
  /No such file or directory/,  // wrong path
  /command not found/,          // misspelled command
  /Permission denied/,          // permission issue
  /fatal: not a git repository/,// wrong directory
];

function isRecoverable(stderr: string): boolean {
  return RECOVERABLE_PATTERNS.some(p => p.test(stderr));
}

async function aiFixCommand(cmd: string, cwd: string, error: string): Promise<string | null> {
  // quickly fix with the Flash model
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: flashModel,
      messages: [{
        role: 'user',
        content: `Command failed: "${cmd}"\nError: ${error}\nCWD: ${cwd}\nOutput ONLY the fixed command (one line, no explanation):`,
      }],
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

**Effect:** when the user types `git lig` (typo), the Agent auto-corrects it to `git log` and runs it — the user sees the correct result and never notices the fix in between.

---

## Implementation Priorities

| Priority | Optimization | Difficulty | Perceived Improvement |
|--------|--------|------|-------------|
| P0 | Frontend pre-flight (Pre-flight Rules) | Low | 🔥🔥🔥🔥🔥 |
| P0 | Aggressive tool-list trimming per scenario | Low | 🔥🔥🔥 |
| P1 | JIT context injection (git context) | Medium | 🔥🔥🔥🔥 |
| P1 | Stronger sandbox declaration | Low | 🔥🔥 |
| P2 | Optimistic UI (SSE skeleton screens) | Medium | 🔥🔥🔥🔥 |
| P2 | Self-healing loop | Medium | 🔥🔥🔥🔥 |

---

## Change List (P0 implementation)

| File | Change |
|------|------|
| `App.tsx` | `preFlightCheck()` — detects keywords before sending a message, triggers UI in <50ms |
| `agent.ts` | Inject sandbox declaration into system prompt |
| `agent.ts` | JIT context injection (inject git state before shell_exec) |
| `agent.ts` | Stronger tool trimming — only 1 tool kept while editing a note |

---

## Appendix: Review Corrections (v1.1)

### Fix 1: Optimistic-UI JSON truncation ➔ accumulated matching

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

### Fix 2: Self-healing ➔ at most 1 retry

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

**Fix**: define `CORE_TOOLS = ['get_stats', 'list_issues', 'web_search', 'shell_exec', 'mcp_call']` always available; only trim scenario-specific tools. Editing a note = Core + `suggest_note_edit`; viewing a task = Core + `suggest_issue_edit`.
