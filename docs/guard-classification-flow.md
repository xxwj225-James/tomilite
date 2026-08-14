# Guard Classification Flow

A three-stage pipeline for Agent intent classification that decides whether a user message should trigger a creation action or be answered directly.

> **Note**: Order changed on 2026-07-23 — the keyword pre-check (Step 1) moved before the editor bypass (Step 2) so "why X"-type questions aren't misclassified as task creation due to editor-panel state.

## Architecture Overview

```
User message
  │
  ├─ Step 1: Keyword pre-check ── no creation keyword → general_chat (end)
  │                                creation keyword found → continue
  │
  ├─ Step 2: Note Editor button bypass ── note editor + [Note editor action:] → suggest_note_edit
  │
  └─ Step 3: Guard LLM classification ── flashModel fine-classifies 5 intents
     │                                  returns JSON → injected into the main-model system prompt
     ├─ Success → intentHint = instruction from Guard
     └─ Failure → fallback instruction
```

## Step 1: Keyword Pre-Check

**Location**: lines 88-95 of `apps/api/src/routers/agent.ts`

**Logic**: strip the context prefix from the message and check for an explicit creation intent.

**Regexes matching "creation intent"**:
- At the start: `create`, `new`, `new task/bug/issue/feature/story/note`
- Within the first 30 chars: `create`, `new`, `create_`

**If no match** → set `intentHint = "answer directly, do not create anything"` directly and skip all subsequent steps.

**If matched** → continue to Steps 2/3.

## Step 2: Note Editor Button Bypass

**Location**: lines 97-100

**Trigger**: Step 1 didn't set intentHint **and** `noteEditorOpen` **and** the message contains `[Note editor action:]`

**Scenario**: the user clicked a polish/translate/summarize/expand button in the note editor.

**Effect**: set intentHint to `suggest_note_edit` directly, telling the main model to output the change description first, then call the tool.

## Step 3: Guard LLM Classification

**Location**: lines 102-142

**Trigger**: neither Step 1 nor Step 2 set intentHint (the message is judged to "contain creation intent")

**Flow**:
1. Build the prompt, requiring flashModel to output JSON:
   - `intent`: `create_task | create_note | edit_note | task_action | general_chat`
   - `instruction`: specific tool-call instruction
2. Call the `flashModel` API (`temperature: 0`, `response_format: json_object`, 6s timeout)
3. Parse the JSON → `intentHint = instruction`
4. Fallback on failure: a generic instruction

**Valid create_issue types**: `task`, `bug`, `story` (no `feature`/`epic`)
**Mapping rule**: user says "Feature" → type `story`; uncertain → type `task`

## Main-Model Injection

**Location**: line 223

`intentHint` is appended to the end of the main model's system prompt:
```
Pick one that fits the conversation context.${intentHint}
```

The main model decides which tool to call based on the system prompt + intentHint + tools.

## Hallucination Detection

**Location**: lines 470-510

After the main model replies, verify that it actually called the tool:

| Guard intent | Required Tool Call |
|-------------|---------------|
| `create_task` | `create_issue` or `force_create_issue` |
| `create_note` | `create_note` or `force_create_note` |
| `edit_note` | `suggest_note_edit` |

If Guard said to create but the main model didn't call a tool → `[Hallucination]` warning → force re-run.

## Known Issues

1. **Qwen flashModel classification is inaccurate**: misjudges more easily than DeepSeek, classifying questions as `create_task`
2. **Limited keyword coverage**: phrases like "help me write a..." aren't matched by Step 1's regexes and may be misjudged in Step 3
3. **Guard timeout doesn't trigger Hallucination check**: on timeout intentHint is empty and the main model improvises

## Related Files

| File | Content |
|------|------|
| `apps/api/src/routers/agent.ts:84-142` | Guard classification core logic |
| `apps/api/src/routers/agent.ts:470-510` | Hallucination detection |
| `apps/api/src/routers/agent.ts:223` | intentHint injection into the main model |
| `apps/web/src/App.tsx:1467` | reasoningContent persistence |
