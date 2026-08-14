# App.tsx Optimization Plan

## Current State

`apps/web/src/App.tsx` — **2116 lines**, single default-exported component. It is the "god component" of TomiLite, handling chat streaming, session management, panel navigation, setup guide, notifications, updates, theme/language, file attachments, and card actions.

### Why This Matters

- **Maintainability**: making a small change requires scrolling through 2000+ lines
- **Testability**: impossible to unit-test any single concern
- **Readability**: new contributors can't grasp the structure quickly
- **Risk**: high coupling means changes in one area easily break another

---

## Target Architecture

```
apps/web/src/
├── App.tsx                    (~400 lines)  — shell: layout + routing + top-level state
├── components/
│   ├── chat/
│   │   ├── Msg.tsx            (~170 lines)  — message bubble (extracted from App.tsx:124-295)
│   │   ├── ChatInput.tsx      (~60 lines)   — textarea + send/stop + file chips
│   │   ├── SessionSidebar.tsx (~80 lines)   — session list + new/rename/delete
│   │   └── ChatTopBar.tsx     (~50 lines)   — language + theme + compress/clear
│   ├── welcome/
│   │   └── WelcomeGuide.tsx   (~120 lines)  — onboarding checklist (extracted from 1776-1882)
│   ├── update/
│   │   └── UpdateBar.tsx      (~60 lines)   — OTA notification bar
│   ├── panels/
│   │   └── PanelResizeHandle.tsx (~60 lines) — existing, keep
│   └── overlays/
│       └── AppDialogs.tsx     (~80 lines)   — 7 ConfirmDialogs extracted from 2043-2113
├── hooks/
│   ├── useChatStream.ts       (~200 lines)  — sendMessage + stopStream + SSE loop
│   ├── useSessions.ts         (~100 lines)  — session CRUD + compress
│   ├── useSetupGuide.ts       (~60 lines)   — welcome config checks + dismiss logic
│   ├── useNotifications.ts    (~50 lines)   — email/MCP/standup polling
│   ├── useAutoUpdate.ts       (~60 lines)   — electron-updater events
│   ├── useCardActions.ts      (~80 lines)   — card event listeners + executeDelete
│   ├── useAgentContext.ts     (~80 lines)   — editor monitors + focus heartbeat + notifyAgent
│   ├── useTokenEstimation.ts  (~30 lines)   — estimateTokens + auto-compress trigger
│   └── useThemeLanguage.ts    (~30 lines)   — theme/lang state + persistence
└── lib/
    └── fileParser.ts          (~50 lines)   — handleFiles (xlsx/docx/pdf/text)
```

---

## Phase 1: Extract Components (low risk)

Extract presentational components first — no logic changes, pure copy-paste.

### 1.1 Msg.tsx — Message Bubble
- **Source**: `App.tsx` L124–295 (~170 lines)
- **Props**: `{ role, text, tool, staged, card, onApply, onUndo, thinking, pinnable, onPin, isPinned, reasoningContent }`
- **Internal state**: `thinkingOpen`, `thinkingRef`
- **Dependencies**: `useLang`, `sanitizeHtml`, `marked`, `cn`, `ConfirmDialog`
- **Estimated effort**: 30 min

### 1.2 WelcomeGuide.tsx — Onboarding Checklist
- **Source**: `App.tsx` L1776–1882 (~100 lines)
- **Props**: `{ llmConfigured, emailConfigured, gitConfigured, apikeyConfigured, standupConfigured, onDismiss, onSkip, onStart, query, setQuery, sendMessage, t, tr, lang }`
- **Estimated effort**: 20 min

### 1.3 SessionSidebar.tsx
- **Source**: `App.tsx` L1648–1685 (~40 lines)
- **Props**: `{ sessions, currentSessionId, onSwitch, onNew, onRename, onDelete, maxTokens, tokenPercent }`
- **Estimated effort**: 15 min

### 1.4 UpdateBar.tsx
- **Source**: `App.tsx` L1738–1768 (~30 lines)
- **Props**: `{ updateAvailable, updateProgress, updateTimedOut, updateError, updateFilePath, updateSeen, onDismiss, onDownload, onInstall, onStopDownload }`
- **Estimated effort**: 15 min

### 1.5 ChatTopBar.tsx
- **Source**: `App.tsx` L1703–1737 (~35 lines)
- **Props**: `{ theme, onThemeChange, lang, onLangChange, onCompress, compressing, onClear }`
- **Estimated effort**: 15 min

### 1.6 ChatInput.tsx
- **Source**: `App.tsx` L1985–2022 (~40 lines) + L309–354 (handleFiles)
- **Props**: `{ query, onChange, onSend, onStop, thinking, attachedFiles, onFilesChange }`
- **Estimated effort**: 20 min

### 1.7 AppDialogs.tsx
- **Source**: `App.tsx` L2043–2113 (~70 lines)
- **Props**: various dialog open/close/message handlers
- **Estimated effort**: 25 min

---

## Phase 2: Extract Hooks (medium risk)

Extract logic into custom hooks. Each hook owns its state + effects.

### 2.1 useChatStream
- **Extract**: `sendMessage`, `stopStream`, `handleApplyEdit`, `handleUndoEdit`
- **State**: `thinking`, `agentStatus`, `messages`, `appliedEdit`, `appliedReport`, `appliedTaskEdit`, `abortRef`
- **Lines**: ~470 → ~200
- **Estimated effort**: 2 hours

### 2.2 useSessions
- **Extract**: `switchSession`, `renameSession`, `clearSession`, `deleteSession`, `executeCompress`, `saveMsg`, `sessionCreatingRef`
- **State**: `sessions`, `currentSessionId`, `sessionsLoaded`, `editingSessionId`, `editTitle`, `compressConfirm`, `compressMsg`, `compressing`, `deleteTarget`, `deleting`
- **Lines**: ~200 → ~100
- **Estimated effort**: 1.5 hours

### 2.3 useSetupGuide
- **Extract**: welcome config fetching + dismiss logic
- **State**: `showWelcome`, `llmConfigured`, `emailConfigured`, `gitConfigured`, `apikeyConfigured`, `standupConfigured`
- **Lines**: ~80 → ~50
- **Estimated effort**: 30 min

### 2.4 useNotifications
- **Extract**: email/MCP/standup polling intervals
- **State**: `notifyCount`, `mcpPending`, `morningNotify`, `eveningNotify`, `notifyLoading`
- **Lines**: ~70 → ~50
- **Estimated effort**: 30 min

### 2.5 useAutoUpdate
- **Extract**: electron-updater IPC listeners + state
- **State**: `updateAvailable`, `updateProgress`, `updateSeen`, `updateTimedOut`, `updateError`, `updateFilePath`, `stopDownloadConfirm`
- **Lines**: ~80 → ~50
- **Estimated effort**: 30 min

### 2.6 useCardActions
- **Extract**: card event listeners (`tl-open-card/edit/delete/move-card`, `tl-force-create`, `tl-cancel-dedup`) + `executeDelete`
- **State**: `saveResult`
- **Lines**: ~100 → ~60
- **Estimated effort**: 1 hour

### 2.7 useAgentContext
- **Extract**: editor monitors (note/task/report) + focus heartbeat + panel lifecycle + `notifyAgent`/`notifyI18n` + `preFlight`
- **State**: `focusState`, `focusManual`, `editingNote`, `editingTask`, `editingReport`, `panel`, `noteRefresh`, `taskRefresh`, `reportRefresh`
- **Lines**: ~150 → ~80
- **Estimated effort**: 1.5 hours

### 2.8 useTokenEstimation
- **Extract**: `estimateTokens`, `refreshContextWindow`, auto-compress effect
- **State**: `maxTokens`
- **Lines**: ~50 → ~30
- **Estimated effort**: 20 min

### 2.9 useThemeLanguage
- **Extract**: theme/lang state + persistence + apply
- **State**: `theme`, `langMenuOpen`, `panelMenuOpen`
- **Lines**: ~40 → ~20
- **Estimated effort**: 15 min

---

## Phase 3: Multi-Tasking Support (new feature)

### 3.1 Frontend: Task Queue

Replace single `abortRef` + `thinking` with a queue:

```typescript
// useChatStream.ts
type PendingTask = {
  id: string;
  payload: string;
  status: 'queued' | 'running' | 'done' | 'aborted';
};

const [taskQueue, setTaskQueue] = useState<PendingTask[]>([]);
const [currentTask, setCurrentTask] = useState<string | null>(null);
```

**Changes**:
- `sendMessage()`: if agent is busy → push to queue instead of aborting
- When current task completes → dequeue next
- Stop button behavior: stop current OR remove from queue
- UI: show "N tasks queued" indicator

### 3.2 Backend: Session Lock (optional, for safety)

Add lightweight in-memory lock per chat session:

```typescript
// agentStream.ts
const sessionLocks = new Map<string, Promise<void>>();

async function acquireLock(sessionId: string): Promise<void> {
  while (sessionLocks.has(sessionId)) {
    await sessionLocks.get(sessionId);
  }
  // ...
}
```

Prevents two concurrent agent loops from modifying the same chat session simultaneously.

### 3.3 Estimated Effort

- Frontend queue: 3–4 hours
- Backend lock: 1 hour
- Testing: 1 hour

---

## Phase 4: Polish (low priority)

- **RobotFace** → separate file (L4–19)
- **ICONS/MENU/THEMES/LANGS** → `constants.ts`
- **StagedEdit/ChatCard** → `types.ts`
- **Remove unused state**: `debugTokenOverride`, `debugForceShow`, `llmBannerDismissed`, `dragOver`
- **panel state**: replace string with typed enum

---

## Timeline Summary

| Phase | Items | Est. Effort | Risk |
|-------|-------|-------------|------|
| 1. Extract Components | 7 files | 2–3 hours | Low |
| 2. Extract Hooks | 9 hooks | 6–8 hours | Medium |
| 3. Multi-Tasking | queue + lock | 4–6 hours | Medium |
| 4. Polish | constants + types | 1 hour | Low |

**Total**: ~15–20 hours across phases.

---

## Migration Strategy

1. **Phase 1 first** — pure extraction, no logic changes. Ship after each component to verify nothing breaks.
2. **Phase 2 incrementally** — extract one hook, test, commit. Start with `useThemeLanguage` (simplest), end with `useChatStream` (hardest).
3. **Phase 3 after Phase 1+2 stable** — new feature on clean architecture.
4. **Never break the build** — each commit must pass `npm run pack`.
