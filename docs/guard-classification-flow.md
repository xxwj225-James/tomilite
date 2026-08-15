# Guard Classification Flow

A three-stage pipeline for Agent intent classification that decides whether a user message should trigger a creation action or be answered directly.

> **Note**: Order changed on 2026-07-23 — the keyword pre-check (Step 1) moved before the editor bypass (Step 2) so "why X"-type questions aren't misclassified as task creation due to editor-panel state.

## Architecture Overview

```
User message
  │
  ├─ Step 1: Keyword pre-check ── no creation keyword → needsWebSearch=true, web_search routing hint (end)
  │                                creation keyword found → continue
  │
  ├─ Step 2: Note Editor button bypass ── note editor + [Note editor action:] → suggest_note_edit
  │
  └─ Step 3: Guard LLM classification ── flashModel fine-classifies 5 intents
     │                                  returns JSON → injected into the main-model system prompt
     ├─ Success → intentHint = instruction from Guard
     └─ Failure → fallback instruction
```

> **Status**: IMPLEMENTED — `classifyGuard` in `apps/api/src/agent/core/guard.ts`, `intentHint` injection in `apps/api/src/agent/prompts/systemPrompt.ts`, hallucination validation in `apps/api/src/agent/core/agentEngine.ts`.

## Step 1: Keyword Pre-Check

**Location**: `classifyGuard` in `apps/api/src/agent/core/guard.ts` (Phase 1, lines 36-44)

**Logic**: strip the context prefix from the message and check for an explicit creation intent.

**Regexes matching "creation intent"**:

- `isExplicitCreate` — at the start: `create`, `new`, `new task/bug/issue/feature/story/note` (incl. Chinese `创建|新建`, `帮.*创建|写|加`); within the first 30 chars: `创建|新建|create_`
- `wantsCreateNote` — note patterns like `总结|写|做|记 …笔记|note` (either direction)
- `wantsCreateTask` — task patterns like `加|添|新建|创建 …任务|task|bug|issue` (either direction)

**If no match** → set `needsWebSearch = true` and inject a `web_search` routing hint: for factual questions / recent events / anything requiring current information, the main model MUST call `web_search` FIRST, then answer. No creation hint is set; this is the chat/Q&A path, not "answer directly".

**If matched** → continue to Steps 2/3.

## Step 2: Note Editor Button Bypass

**Location**: `apps/api/src/agent/core/guard.ts` (lines 46-49)

**Trigger**: Step 1 didn't set intentHint **and** `noteEditorOpen` **and** the message contains `[Note editor action:]`

**Scenario**: the user clicked a polish/translate/summarize/expand button in the note editor.

**Effect**: set intentHint to `suggest_note_edit` directly, telling the main model to reply with a BRIEF change summary (1-2 lines), then call `suggest_note_edit` with content = ONLY the final note text.

## Step 3: Guard LLM Classification

**Location**: `apps/api/src/agent/core/guard.ts` (Phase 2, lines 51-70)

**Trigger**: neither Step 1 nor Step 2 set intentHint (the message is judged to "contain creation intent")

**Flow**:

1. Build the prompt (`buildGuardPrompt` in `apps/api/src/agent/prompts/guardPrompt.ts`), requiring flashModel to output JSON:
   - `intent`: `create_task | create_note | edit_note | task_action | general_chat`
   - `instruction`: specific tool-call instruction
   - `webSearch`: optional boolean — `true` → sets `needsWebSearch` (web_search routing)
2. Call the `flashModel` API (`max_tokens: 200`, `temperature: 0`, `response_format: json_object`, 6s timeout; thinking disabled for moonshot/deepseek base URLs, `enable_thinking: false` for dashscope)
3. Parse the JSON → `intentHint = instruction`; `guardIntent = intent`
4. Fallback on failure/timeout: a generic "use the most appropriate tool" instruction

**Valid create_issue types**: `task`, `bug`, `story` (no `feature`/`epic`)
**Mapping rule**: user says "Feature" → type `story`; uncertain → type `task`

## Main-Model Injection

**Location**: end of `buildSystemPrompt` in `apps/api/src/agent/prompts/systemPrompt.ts`

`intentHint` is appended to the end of the main model's system prompt:

```
Pick one that fits the conversation context.${intentHint}
```

The main model decides which tool to call based on the system prompt + intentHint + tools.

## Hallucination Detection

**Location**: `apps/api/src/agent/core/agentEngine.ts` (post-execution validation block, lines 154-248)

After the main model replies with **zero tool calls**, a 6-stage validation chain fires (`[Hallucination]` warning → inject `⚠️ SYSTEM CHECK` message → force re-run). Each guard fires at most once per response (`llmResponded` flag):

| Stage                   | Trigger                                                                                                                                                        | Required Tool Call                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| #1 Editor bypass        | Editor form open (`unsavedNote`/`noteEditorOpen` → `suggest_note_edit`; `taskEditorOpen`/`newTaskFormOpen` → `suggest_issue_edit`) + user asked to edit/update | `suggest_*_edit`                       |
| #2 Guard `create_task`  | `lastGuardRaw.intent === 'create_task'`                                                                                                                        | `create_issue` or `force_create_issue` |
| #3 Guard `create_note`  | `lastGuardRaw.intent === 'create_note'`                                                                                                                        | `create_note` or `force_create_note`   |
| #4 Guard `edit_note`    | `lastGuardRaw.intent === 'edit_note'`                                                                                                                          | `suggest_note_edit`                    |
| #5 Report/export        | Message contains `报告                                                                                                                                         | report                                 | 日报                                 | 周报`(report) or`导出                                       | export` (export) | `create_report` (report) / `export_to_excel` or `export_to_doc` (export; also fires if export was requested but never returned `ok:true`) |
| #6 Web search           | `needsWebSearch` (from Step 1 or Step 3 `webSearch`) and not Qwen                                                                                              | `web_search`                           |
| #7 Generic mismatch     | Guard intent is `create_task                                                                                                                                   | create_note                            | edit_note` but NO tool called at all | mapped `create_issue` / `create_note` / `suggest_note_edit` |
| #7b Text claims success | Reply contains ✅/📄/📋/📊 + `TL-                                                                                                                              | 创建                                   | created                              | 作成` but no tool called                                    | any create tool  |

If Guard said to create but the main model didn't call a tool → `[Hallucination]` warning → force re-run.

## Known Issues

1. **Qwen flashModel classification is inaccurate**: misjudges more easily than DeepSeek, classifying questions as `create_task`
2. **Limited keyword coverage**: phrases like "help me write a..." aren't matched by Step 1's regexes and may be misjudged in Step 3
3. **Guard timeout doesn't trigger intent-specific Hallucination checks**: on timeout a generic fallback intentHint is set, but `lastGuardRaw` stays empty so the Guard-intent checks (#2-4, #7) can't fire — only the generic checks (editor, report/export, web search) remain

## Related Files

| File                                         | Content                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/api/src/agent/core/guard.ts`           | Guard classification core logic (`classifyGuard`: keyword pre-filter + editor bypass + Guard LLM) |
| `apps/api/src/agent/prompts/guardPrompt.ts`  | Guard LLM prompt builder                                                                          |
| `apps/api/src/agent/core/agentEngine.ts`     | Hallucination detection (post-execution validation)                                               |
| `apps/api/src/agent/prompts/systemPrompt.ts` | intentHint injection into the main model                                                          |
| `apps/web/src/hooks/useSendMessage.ts`       | reasoningContent persistence                                                                      |
