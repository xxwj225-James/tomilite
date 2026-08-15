# Task-Creation Dedup Flow v2 — Interactive Button Design

> **Status: IMPLEMENTED** (2026-07-09 onward). All sections of this design are live:
>
> - Dedup intercept: `apps/api/src/agent/core/agentEngine.ts` → `checkDedup()`
> - `__FORCE_CREATE__` shortcut: `apps/api/src/agent/agentStream.ts`
> - Blocked card UI (Force Create / Cancel): `apps/web/src/components/chat/Msg.tsx`
> - Card actions: `apps/web/src/hooks/useChatCardActions.ts`
> - Text-input confirm/cancel classification: `apps/web/src/hooks/useSendMessage.ts` + `agent.classifyIntent` (`apps/api/src/agent/tRPC/agentRouter.ts`)
>
> Dedup itself is an **exact title match** in the DB (`findMany({ title })`, take 5) — no LLM call, no fuzzy matching.

## 1. Current State

### 1.1 Correctly Implemented

| Module                                                                      | File                                                    | Status     |
| --------------------------------------------------------------------------- | ------------------------------------------------------- | ---------- |
| `executeAgentTool` — create_issue/force_create_issue pure creation          | `apps/api/src/agent/tools/issueTools.ts` (+ dispatcher) | ✅ Correct |
| Agent Loop — intercepts create_issue/create_note/create_report for DB dedup | `apps/api/src/agent/core/agentEngine.ts`                | ✅ Correct |
| Server SSE event sending (tool_call/tool_result)                            | `apps/api/src/agent/utils/sse.ts`                       | ✅ Correct |
| `scripts/test-sse-debug.js` — standalone test of frontend handling          | Test script                                             | ✅ Passing |

### 1.2 Known Issues (both RESOLVED)

| Issue                                                                           | Resolution                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.tool && data.args` never true — frontend never ran the tool_call handling | SSE parsing made tolerant in `useSendMessage.ts`: `line.slice(line.indexOf(':') + 1).trim()` instead of hard-coded `slice(6)`, and `raw.startsWith('{')` guard around `JSON.parse` (was: silent `catch {}`)                               |
| LLM behavior after user confirms "force create" was unpredictable               | Replaced with explicit intent classification: `agent.classifyIntent` (flash model, 4s timeout) classifies the user's typed reply as `force` / `cancel` / `other` with a regex fallback; confirm/cancel no longer depend on the main agent |

## 2. Target Flow

```
User: "create task: Debug UI interaction"
│
▼
LLM calls create_issue("Debug UI interaction", desc, priority...)
│
▼
Agent Loop intercepts → DB dedup → duplicates found → returns blocked
│
▼
Frontend receives { blocked: true, duplicates: [...], pendingArgs: {...} }
│
▼
┌─────────────────────────────────────────────┐
│  Interactive card rendered in chat:         │
│                                             │
│  ⚠️ 9 similar tasks found                   │
│  TL-40 Debug UI...     todo                 │
│  TL-41 debug UI...     todo                 │
│  ...                                        │
│                                             │
│  [💥 Force Create]   [Cancel]               │
└─────────────────────────────────────────────┘
│                    │
▼                    ▼
User clicks "Force Create"   User clicks "Cancel"
│                    │
▼                    ▼
Frontend calls        Appends "Canceled" message
force_create_issue    no creation happens
(writes DB → card)
```

## 3. Required Changes — all implemented

### 3.1 Server: `pendingArgs` in the blocked response — ✅ DONE

`apps/api/src/agent/core/agentEngine.ts` — `checkDedup()` sends the blocked `tool_result`:

```typescript
sendToolResult(send, toolName, {
  blocked: true,
  duplicates: dups.map((d: any) => ({
    key: target.resultKey(d),
    title: d.title,
    status: d.status || d.category || d.reportType || '',
    priority: d.priority || '',
    description: (d.description || d.content || '').substring(0, 200),
  })),
  pendingArgs: args,
});
```

### 3.2 Frontend: render interactive buttons on blocked — ✅ DONE

`apps/web/src/hooks/useSendMessage.ts` — the `data.tool && data.result` handling block builds a blocked card:

```typescript
if ((data.tool === 'create_issue' || data.tool === 'create_note' || data.tool === 'create_report') && r.blocked) {
  const blockedType = data.tool === 'create_note' ? 'note' : data.tool === 'create_report' ? 'report' : 'task';
  const forceTool =
    data.tool === 'create_note'
      ? 'force_create_note'
      : data.tool === 'create_report'
        ? 'force_create_report'
        : 'force_create_issue';
  msgCard = {
    type: blockedType,
    title: r.pendingArgs?.title || '',
    blocked: true,
    duplicates: r.duplicates,
    pendingArgs: { ...r.pendingArgs, _tool: forceTool },
  };
}
```

The `Msg` component (`apps/web/src/components/chat/Msg.tsx`) shows Force Create / Cancel buttons for blocked cards; once `resolved` they gray out and become unclickable.

### 3.3 Frontend: button callbacks — ✅ DONE

`apps/web/src/hooks/useChatCardActions.ts` dispatches `tl-force-create` / `tl-cancel-dedup`:

```typescript
const onForceCreate = (e: Event) => {
  const args = { ...detail.pendingArgs, _type: detail.type || 'task' };
  forceCreateRef.current = args;
  sendMessageRef.current?.('__FORCE_CREATE__ ' + JSON.stringify(args));
};
```

`onCancelDedup` marks the blocked card `resolved: true` (persisted via `chat.updateMessage`) and appends a "creation cancelled" message. (Approach A from the original design was chosen.)

### 3.4 Server: `__FORCE_CREATE__` prefix — ✅ DONE

`apps/api/src/agent/agentStream.ts` — handled before the normal agent flow; reads `_type` from the args to select `force_create_issue` / `force_create_note` / `force_create_report`, then streams `tool_call` / `tool_result` / `done` directly. No Guard or self-learning involved.

### 3.5 Tool layering: `create_*` vs `force_create_*` — ✅ DONE

The LLM can call two kinds of tools directly (tool registry `apps/api/src/agent/tools/registry.ts` + system prompt `apps/api/src/agent/prompts/systemPrompt.ts`):

| Tool                                                               | Dedup            | Purpose                                    |
| ------------------------------------------------------------------ | ---------------- | ------------------------------------------ |
| `create_issue` / `create_note` / `create_report`                   | ✅ Dedup applied | Normal creation. Duplicates → blocked card |
| `force_create_issue` / `force_create_note` / `force_create_report` | ❌ Skipped       | Used when the user confirms force creation |

**Call paths:**

```
create_* → Agent Loop dedup → no duplicates → creation-success card
                           → duplicates → blocked card → user confirms → force_create_* → creates directly
```

LLM decision rule: use `create_*` for first-time creation; use `force_create_*` when the user insists/confirms.

## 4. Handling User Text Input Without Clicking Buttons

### 4.1 Scenario

The blocked card shows `[💥 Force Create] [Cancel]` buttons, but the user **doesn't click them** and types instead:

| User Input                                                                        | Expected Behavior                                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| "go ahead" / "yes" / "force create" / "fine, just create it" / "create it anyway" | LLM classifies as confirm → equivalent to clicking "Force Create"     |
| "forget it" / "cancel" / "don't create it" / "never mind" / "no"                  | LLM classifies as cancel → equivalent to clicking "Cancel"            |
| "change it to Debug UI v2" / "check TL-40 for me"                                 | LLM classifies as other → passed to the Agent normally, card retained |

### 4.2 Implementation

Use `agent.classifyIntent` (flash model, ~1s) for semantic classification instead of regex keyword matching.

**Why LLM instead of regex?** Regex is too rigid — natural language like "fine, just build it" / "actually, never mind, I don't want it" can't be covered by patterns. The LLM understands semantic intent.

```typescript
const lastCard = messages[messages.length - 1]?.card;
if (lastCard?.blocked && lastCard?.pendingArgs) {
  // LLM semantic classification: confirm / cancel / other
  const { intent } = await api.agent.classifyIntent({ message: q, cardType: lastCard.type });
  if (intent === 'confirm') {
    // equivalent to clicking the "Force Create" button → call __FORCE_CREATE__ directly, bypassing the Agent LLM
    forceCreateRef.current = lastCard.pendingArgs;
    sendMessage('__FORCE_CREATE__ ' + JSON.stringify(lastCard.pendingArgs));
    return;
  }
  if (intent === 'cancel') {
    // equivalent to clicking "Cancel" → mark the card resolved + append a "Canceled" message
    ...
    return;
  }
  // intent === 'other' → send to the Agent normally; card retained as context
}
```

### 4.3 Decision Tree

```
User types text
│
├─ Does the last message have a blocked card?
│   │
│   ├─ YES → LLM semantic classification
│   │   ├─ "confirm" → auto-route to __FORCE_CREATE__ (same as clicking the button)
│   │   ├─ "cancel"  → mark card resolved + "Canceled"
│   │   └─ "other"   → send to Agent normally; card retained as context
│   │
│   └─ NO  → normal flow
```

### 4.4 Summary Comparison

| Aspect           | Implementation                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------- |
| State marker     | Reads `card.blocked` + `card.pendingArgs` directly; no extra fields                      |
| Intent detection | LLM `classifyIntent` semantic classification (confirm/cancel/other), no regex dependency |
| confirm path     | Frontend calls `__FORCE_CREATE__` directly, never passes through the Agent LLM           |
| cancel path      | Frontend marks the card `resolved` + grays out the buttons + appends "Canceled"          |
| other path       | Sent to the Agent LLM normally; the blocked card stays in chat as context                |
| Button disabling | Once the card is `resolved`, buttons auto-gray and become unclickable; no manual cleanup |

## 5. SSE Parsing Bug Investigation (Separate Issue)

The issue where `data.tool && data.args` never triggers must be investigated **before changing business logic**.

### Investigation Steps

1. Install the current package (already contains `[KEYS:]` debug output), create a task
2. Check whether the chat content contains `[KEYS:tool_call tool,args t=true a=true]`
3. If yes → parsing is fine; the problem is in the later `if` logic
4. If no → `JSON.parse` failed silently

### If JSON.parse Fails

The current code hard-cuts the `data: ` prefix with `line.slice(6)`. If the SSE data format isn't a strict `data: {...}` (e.g. extra spaces, embedded newlines, or packet coalescing), `JSON.parse` throws and `catch {}` swallows it.

**Fix**: make parsing more tolerant —

```typescript
const raw = line.slice(line.indexOf(':') + 1).trim(); // don't hard-code the 6
if (raw.startsWith('{')) {
  try {
    data = JSON.parse(raw);
  } catch {
    continue;
  }
}
```

## 6. Implementation Order

| Priority | Step                                       | Description                                                          |
| -------- | ------------------------------------------ | -------------------------------------------------------------------- |
| P0       | Investigate the SSE parsing bug            | `[KEYS:]` debug output to confirm the problem layer                  |
| P1       | Fix SSE parsing (if needed)                | Tolerant JSON.parse                                                  |
| P2       | Add pendingArgs to blocked response        | One-line server change                                               |
| P3       | Frontend renders interactive buttons       | Blocked card + two buttons                                           |
| P4       | Frontend button callback → force_create    | `__FORCE_CREATE__` prefix                                            |
| P5       | Handle text input without clicking buttons | Check last message's card.blocked; confirm words auto-route to force |
| P6       | Verify the full loop                       | create → intercept → button/text → created → card                    |
