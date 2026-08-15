# App.tsx Optimization — Plan & Completion Record

> **Status**: ✅ COMPLETE (as of v2.0.3). All phases were executed; this document records the original plan and how the final structure differs from it.

## Original Current State

`apps/web/src/App.tsx` — **2116 lines**, single default-exported component. It was the "god component" of TomiLite, handling chat streaming, session management, panel navigation, setup guide, notifications, updates, theme/language, file attachments, and card actions.

### Why This Mattered

- **Maintainability**: making a small change required scrolling through 2000+ lines
- **Testability**: impossible to unit-test any single concern
- **Readability**: new contributors couldn't grasp the structure quickly
- **Risk**: high coupling means changes in one area easily break another

---

## Actual Final Structure (as built)

```
apps/web/src/
├── App.tsx                    (~292 lines)  — slim shell: composes hooks + layout JSX
├── components/
│   ├── chat/
│   │   ├── Msg.tsx            — message bubble (staged edit + card + pin + thinking)
│   │   ├── MsgList.tsx        — message list wrapper + thinking indicator (NEW vs plan)
│   │   ├── ChatInput.tsx      — textarea + send/stop + attached-file chips
│   │   ├── ChatToolbar.tsx    — language dropdown + theme dots + compress/clear
│   │   │                       (planned name was ChatTopBar.tsx)
│   │   ├── SessionSidebar.tsx — session list + new/rename/delete + token meter
│   │   ├── MenuNav.tsx        — always-visible bottom menu bar + notification bubbles (NEW vs plan)
│   │   ├── LlmBanner.tsx      — soft-gate banner: LLM API key missing (NEW vs plan)
│   │   ├── WelcomeGuide.tsx   — onboarding checklist (lives in chat/, planned welcome/)
│   │   ├── UpdateBar.tsx      — OTA notification bar (lives in chat/, planned update/)
│   │   └── ConfirmDialogs.tsx — delete/compress/leave/stop-download dialogs
│   │                           (planned name was overlays/AppDialogs.tsx)
│   ├── ContentPanel.tsx       — keep-alive panel router (lazy-mount, hide/show)
│   ├── PanelResizeHandle.tsx  — right slide-in panel drag handle
│   ├── RobotFace.tsx          — robot face (Phase 4, done)
│   ├── MarkdownEditor.tsx, UpdateDialog.tsx, LoadingScreen.tsx, icons.tsx
├── hooks/
│   ├── useSendMessage.ts      — sendMessage + stopStream + SSE loop (planned useChatStream)
│   ├── useChatTasks.ts        — concurrent task pool, each task owns its SSE stream,
│   │                           MAX_CONCURRENT = 4 (Phase 3, done)
│   ├── useChatThreads.ts      — per-session message store (planned useSessions part 1)
│   ├── useSessionManager.ts   — session CRUD + bootstrap + saveMsg + compress (planned useSessions part 2)
│   ├── useSetupChecks.ts      — welcome config checks + dismiss (planned useSetupGuide)
│   ├── useNotifications.ts    — email/MCP/standup polling + morning/evening bubbles
│   ├── useUpdates.ts          — electron-updater events (planned useAutoUpdate)
│   ├── useChatCardActions.ts  — card event listeners + executeDelete (planned useCardActions)
│   ├── useEditorMonitors.ts   — editor monitors + refresh counters + panel lifecycle (planned useAgentContext)
│   ├── useTokenUsage.ts       — estimateTokens + context window (planned useTokenEstimation)
│   └── useFileAttach.ts       — handleFiles (xlsx/docx/pdf/text) + drag/paste (NEW vs plan;
│                               planned lib/fileParser.ts was not created — parsing lives in this hook)
├── lib/
│   ├── i18n.ts                — canonical keyed dictionary t(key, lang); legacy inline
│   │                           tr(lang, zh, ja, en) helper retained for a few App.tsx strings
│   ├── constants.ts           — MENU / MENU_LABEL / THEMES / THEME_COLORS / LANGS / LANGS_FULL
│   │                           (Phase 4: planned constants.ts, done here)
│   └── cn.ts, api.ts, sanitize.ts, renderMarkdown.ts, tokenEstimate.ts, llmProviders.ts
└── types/chat.ts              — StagedEdit + ChatCard (Phase 4: planned types.ts, done as types/chat.ts)
```

**Files that did NOT end up as planned**:

- `useThemeLanguage.ts` — not extracted; theme/lang state still lives in `App.tsx` (constants moved to `lib/constants.ts` instead)
- `lib/fileParser.ts` — not created; file parsing lives in `hooks/useFileAttach.ts`
- `useT.ts` — never existed; the canonical i18n dictionary is `lib/i18n.ts`
- `apps/web/src/i18n/translations.ts` — still exists but is **vendor-legacy only**: its own header states it serves exclusively the 5 `vendor/pages/*` pages (Board, Backlog, IssueDetail, WikiList, WikiEditor); the main app UI uses `@/lib/i18n`

---

## Phase 1: Extract Components (low risk) — ✅ DONE

Extracted presentational components first — no logic changes, pure copy-paste.

| Planned                                 | Actual                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1.1 `Msg.tsx` — message bubble          | ✅ `components/chat/Msg.tsx`                                                                    |
| 1.2 `welcome/WelcomeGuide.tsx`          | ✅ `components/chat/WelcomeGuide.tsx` (chat/ not welcome/)                                      |
| 1.3 `SessionSidebar.tsx`                | ✅ `components/chat/SessionSidebar.tsx`                                                         |
| 1.4 `update/UpdateBar.tsx`              | ✅ `components/chat/UpdateBar.tsx` (chat/ not update/)                                          |
| 1.5 `ChatTopBar.tsx`                    | ✅ `components/chat/ChatToolbar.tsx` (renamed; language + theme + compress/clear)               |
| 1.6 `ChatInput.tsx` (incl. handleFiles) | ✅ `components/chat/ChatInput.tsx`; handleFiles moved to `hooks/useFileAttach.ts`               |
| 1.7 `overlays/AppDialogs.tsx`           | ✅ `components/chat/ConfirmDialogs.tsx` (renamed, chat/ not overlays/)                          |
| —                                       | ➕ extra: `MsgList.tsx`, `MenuNav.tsx`, `LlmBanner.tsx` (soft-gate banner), `LoadingScreen.tsx` |

---

## Phase 2: Extract Hooks (medium risk) — ✅ DONE

Each hook owns its state + effects. Final names differ from the plan:

| Planned hook                                            | Actual hook                                  | Notes                                                                                         |
| ------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 2.1 `useChatStream` (sendMessage, stopStream, SSE loop) | `useSendMessage.ts`                          | `thinking`/`agentStatus` now derived in App from `messages.some(m => m.status === 'running')` |
| 2.2 `useSessions` (session CRUD + compress)             | `useChatThreads.ts` + `useSessionManager.ts` | split: per-session message store vs session list/bootstrap/saveMsg                            |
| 2.3 `useSetupGuide`                                     | `useSetupChecks.ts`                          | adds `mcpConfigured` check + auto-dismiss when all configured                                 |
| 2.4 `useNotifications`                                  | `useNotifications.ts`                        | gated on `sessionsLoaded`                                                                     |
| 2.5 `useAutoUpdate`                                     | `useUpdates.ts`                              | electron-updater IPC + progress + timeout watchdog                                            |
| 2.6 `useCardActions`                                    | `useChatCardActions.ts`                      | card listeners + `executeDelete` + save-result                                                |
| 2.7 `useAgentContext`                                   | `useEditorMonitors.ts`                       | editor monitors + `note/task/report/emailRefresh` counters + panel lifecycle                  |
| 2.8 `useTokenEstimation`                                | `useTokenUsage.ts`                           | `maxTokens` from provider, `estimateTokens`, debug overrides                                  |
| 2.9 `useThemeLanguage`                                  | — (not extracted)                            | theme/lang state stayed in App.tsx; `MENU/THEMES/LANGS` went to `lib/constants.ts`            |
| —                                                       | ➕ `useFileAttach.ts`                        | file attach state + drag/drop/paste + parsing (planned as `lib/fileParser.ts`)                |

---

## Phase 3: Multi-Tasking Support — ✅ DONE (design differs from plan)

### 3.1 Frontend: Task Queue → `useChatTasks.ts`

The planned single serial queue was replaced by a **concurrent task pool**:

```typescript
// useChatTasks.ts
export interface ChatTask {
  id: string;
  threadId: string;
  status: 'streaming' | 'done' | 'error' | 'aborted';
  content: string;
  reasoningContent: string;
  iteration: number;
  agentStatus: string;
  controller: AbortController;
  assistantIdx: number;
  card?: any;
  staged?: any;
}
const MAX_CONCURRENT = 4; // soft cap: browser ~6 connections per origin
```

- Each `sendMessage()` creates an independent task with its own SSE stream (instead of queuing behind a busy agent)
- Stop stops the running task of the active session/thread (`stopStream` / `stopThreadTasks`)
- Status messages via i18n keys `chat.queued` / `chat.working` / `chat.tooMany` ("Max 3 concurrent tasks" copy predates the 4-task cap)
- "N tasks queued" indicator was not added

### 3.2 Backend: Session Lock — ❌ NOT implemented (was optional)

No per-session in-memory lock was added; concurrency safety is handled by per-thread task isolation (`streamingThreadRef` in `useSendMessage`) instead.

### 3.3 Estimated Effort — actual effort covered by Phases 1–3 together

---

## Phase 4: Polish — ⚠️ PARTIALLY DONE

| Planned                                                                                       | Status                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RobotFace** → separate file                                                                 | ✅ `components/RobotFace.tsx`                                                                                                                                                                |
| **ICONS/MENU/THEMES/LANGS** → `constants.ts`                                                  | ✅ split: `components/icons.tsx` (ICONS) + `lib/constants.ts` (MENU/THEMES/LANGS)                                                                                                            |
| **StagedEdit/ChatCard** → `types.ts`                                                          | ✅ `types/chat.ts`                                                                                                                                                                           |
| Remove unused state: `debugTokenOverride`, `debugForceShow`, `llmBannerDismissed`, `dragOver` | ⚠️ kept — `debugTokenOverride`/`debugForceShow` remain as console debug helpers (`window.__tl_debug__`), `llmBannerDismissed` powers the soft-gate banner, `dragOver` styles the drop target |
| **panel state**: string → typed enum                                                          | ❌ still `string \| null` (`MenuKey` exists in `lib/constants.ts` but panel state is not typed to it)                                                                                        |

---

## Timeline Summary (planned vs actual)

| Phase                 | Items             | Est. Effort | Risk   | Status                                    |
| --------------------- | ----------------- | ----------- | ------ | ----------------------------------------- |
| 1. Extract Components | 7 files           | 2–3 hours   | Low    | ✅ DONE                                   |
| 2. Extract Hooks      | 9 hooks           | 6–8 hours   | Medium | ✅ DONE (renamed/split)                   |
| 3. Multi-Tasking      | queue + lock      | 4–6 hours   | Medium | ✅ DONE (task pool; backend lock skipped) |
| 4. Polish             | constants + types | 1 hour      | Low    | ⚠️ PARTIAL                                |

**Total**: ~15–20 hours across phases.

---

## Migration Strategy — ✅ EXECUTED

1. **Phase 1 first** — pure extraction, no logic changes; shipped after each component.
2. **Phase 2 incrementally** — one hook at a time; simplest first, `useChatStream` (now `useSendMessage`) last.
3. **Phase 3 after Phase 1+2 stable** — implemented as the `useChatTasks` task pool.
4. **Never break the build** — `npm run pack` remained the release gate throughout.
