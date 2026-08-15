# TomiLite: Remove SetupWizard + Separate Email from Tasks

> **Status**: ✅ DONE (as of v2.0.3). Both features are implemented. Deviations from the original plan are marked inline.

## Context

Two UX improvements for TomiLite:

1. **SetupWizard blocks new users** — the full-screen wizard prevents using the app at all until setup is complete. New users should immediately enter the chat interface with an inline guide containing **actionable buttons** (click → opens relevant Settings tab), and configure LLM/email/git/language/theme at their own pace.

2. **Email is embedded in Tasks panel** — the Email filter, AI reply drafts, email cards, and notification bar are all inside the Tasks panel. This conflates two distinct concerns. Email should have its own dedicated panel with category tabs, reply workflow, "Convert to Task" bridge, and notification badge.

---

## Feature 1: Remove SetupWizard → Actionable Inline User Guide

### Step 1.1 — Delete SetupWizard component — ✅ DONE

- `apps/web/src/components/SetupWizard.tsx` is **deleted** (no trace in the codebase)
- `App.tsx` no longer imports it; loading is gated on `sessionsLoaded` via `<LoadingScreen />` (in `components/LoadingScreen.tsx`)
- Morning/evening standup effects are gated on `sessionsLoaded` (passed into `useNotifications`)

### Step 1.2 — Soft Gate: LLM API Key missing banner — ✅ DONE

**Risk**: New user sends message without configuring LLM API Key → backend agent throws AuthenticationError.

**Implemented** as `components/chat/LlmBanner.tsx`:

1. `useSetupChecks` queries `api.llm.getConfig()` for `activeProvider?.hasKey` (plus email/git/apikey/standup/MCP checks)
2. If `llmConfigured === false` and not dismissed, a **prominent banner renders above the chat input**:
   > ⚠️ LLM API Key not configured. **[Configure →]** (click dispatches `tl-navigate` → Settings → LLM tab)
3. Banner is dismissible (`llmBannerDismissed`) and reappears on next launch while the key is missing
4. The banner is also reflected in the welcome guide (Step 1.4)

### Step 1.3 — Expand language options — ⚠️ NOT DONE as specified (deviation)

The UI was **not** expanded to 6 languages. As built:

- `LANGS = ['en', 'zh', 'ja']` and `LANGS_FULL` cover only en/zh/ja (`apps/web/src/lib/constants.ts`); the top-bar dropdown offers 3 languages
- The centralized i18n dictionary (`apps/web/src/lib/i18n.ts`) **reserves** th/mi/ru keys for future use — many keys already carry th/mi/ru strings, and `t()` falls back to `en` when a language entry is missing
- `ContentPanel`'s `MENU_TEXTS` also carries th/mi/ru labels, but the active language set remains en/zh/ja

### Step 1.4 — Actionable Welcome Guide (replaces SetupWizard)

Replace the passive welcome text with an **interactive setup checklist**. Each item has:

- An **action button** that directly opens the relevant Settings tab or UI
- A **feature description** explaining what the user gains after configuring

```
┌─────────────────────────────────────────────┐
│  Welcome to TomiLite!                  │
│  Your AI dev companion. Quick setup below.  │
├─────────────────────────────────────────────┤
│                                             │
│  1. 🤖 LLM API Key            [Configure →] │
│     → AI chat, task creation, smart replies │
│                                             │
│  2. 📧 Email (Optional)       [Configure →] │
│     → AI inbox triage, smart reply drafts,  │
│       email→task auto-conversion            │
│                                             │
│  3. 📂 Git Workspaces (Opt)   [Configure →] │
│     → Auto-scan repos, commit tracking,     │
│       daily report with code activity       │
│                                             │
│  4. 🌐 Language               [English ▼]   │
│     → UI + AI output language               │
│                                             │
│  5. 🎨 Theme                  [●●●○]        │
│     → pipeline / hub / canvas / quantum     │
│                                             │
├─────────────────────────────────────────────┤
│  💬 Try these:                              │
│  [Create a task] [Search notes] [Daily rpt] │
│                                             │
│  [Dismiss guide →]                          │
└─────────────────────────────────────────────┘
```

**Behavior (as built)**:

- Each `[Configure →]` button sets `window.__tl_settingsTab` and dispatches `tl-navigate` to `'settings'`
- Language dropdown + theme dots work instantly in-place
- Guide shows when `localStorage['tl-welcome-dismissed'] !== '1'` (checked by `useSetupChecks`); if ALL configs (LLM + email + git + apikey + standup + MCP servers) are already set, it auto-dismisses
- **Deviation**: an extra `mcpConfigured` checklist item was added ("MCP Servers" → "Connect to Tomihub, GitHub, Jira..."), and suggestion chips are passed through `onSuggestion` → `sendMessage`

**Dismiss logic (as built)**:

1. **All setup completed** → auto-hide, set `localStorage['tl-welcome-dismissed'] = '1'`
2. **User explicitly dismisses** → `[Don't show again]` sets `localStorage['tl-welcome-dismissed'] = '1'`; `[Skip for now]` hides for the session
3. On subsequent launches, if `localStorage['tl-welcome-dismissed'] === '1'`, guide never shows again
4. The checklist re-evaluates live (`useSetupChecks` polls while the guide is visible): as user configures items, completed items show ✅; when LLM is done, a "Start Using →" button appears

### Step 1.5 — Remove backend setup check — ⚠️ NOT DONE (dead code remains)

- `isSetupCompleted` and `markSetupCompleted` **still exist** in `apps/api/src/routers/system.ts` (backed by `SystemConfig` key `setupCompleted`)
- The API client methods `api.system.isSetupCompleted` / `markSetupCompleted` **still exist** in `apps/web/src/lib/api.ts`
- They are no longer called by the frontend (the setup gate lives in `useSetupChecks`), so they are effectively dead code; removing them was deferred

---

## Feature 2: Separate Email from Tasks — ✅ DONE

### Step 2.0 — Backend: draft endpoints accept SmartEmail ID — ✅ DONE

**File**: `apps/api/src/routers/email.ts`

- `saveDraft` accepts optional `smartEmailId`; if provided it updates `SmartEmail.replyDraft` directly
- `generateDraft` accepts optional `smartEmailId`; it saves the generated draft to the `SmartEmail` row

### Step 2.1 — Create Email panel (`apps/web/src/panels/email/`) — ✅ DONE

All four planned files exist: `useEmailState.ts`, `EmailList.tsx`, `EmailDetail.tsx`, `EmailPanel.tsx`.

- `useEmailState.ts` — standalone hook with independent polling (does NOT share fetch cycle with Tasks); fetches via `/api/email.listSmartEmails`; `handleConvertToTask()` creates an Issue and links it
- `EmailList.tsx` — category tabs with i18n labels + email cards (subject, sender, time, one-line summary, linked task badge); "No email account" shows a link to Settings → Email tab
- `EmailDetail.tsx` — AI summary block (from `SmartEmail.summary`), AI reply draft in `MarkdownEditor`, **`[Convert to Task →]`** button (creates Issue + switches to Tasks panel), Send / Dismiss / Mark Done actions
- `EmailPanel.tsx` — thin shell (list | detail)

### Step 2.2 — Wire into ContentPanel + App.tsx — ✅ DONE

- `email` is in the menu (`MENU`/`MENU_LABEL` in `lib/constants.ts`) with icon (`components/icons.tsx`) and mounted by `ContentPanel`
- **Notification badge** moved from the Tasks button to the Email button (`MenuNav` renders `notif-badge` on the email item from `notifyCount`)
- `enteredEmail` / `exitedEmail` context signals exist (`useEditorMonitors` + i18n keys `agent.enteredEmail`/`agent.exitedEmail`)
- `emailRefresh` state exists (`useEditorMonitors` `bumpEmail`); email tools bump it

### Step 2.3 — Remove email from Tasks panel — ✅ DONE

- `TasksList.tsx` filters out `type === 'email'` entries (no email cards/grouping in the task list)
- `TasksEditor.tsx` / `TasksPanel.tsx` / `useTaskState.ts` no longer host the email detail panel or email state
- **Note**: some email-task i18n keys (`tasks.emailDetail`, `tasks.markDone`, `tasks.type.email`, ...) remain in `lib/i18n.ts` but are unused

### Step 2.4 — Agent Context Bridge (cross-panel coordination) — ✅ DONE (tool names differ)

**Mitigations (as built)**:

1. **Email Agent Tools remain registered** in `apps/api/src/agent/tools/emailTools.ts` (via `routers/emailTools.ts`): `list_emails`, `edit_email_reply`, `send_email_reply`, `read_email_original`, `dismiss_email`, `delete_email`. (Planned names `reply_email`/`fetch_emails` were not used.)
2. **Context signal**: opening the Email panel notifies the agent (`agent.enteredEmail`), same pattern as Tasks/Notes/Reports
3. **"Convert to Task" bridge**: `EmailDetail.tsx` has an explicit button that calls the `email.createLinkedTask` API endpoint, creates the Issue, and switches to the Tasks panel
4. **Agent-initiated conversion**: there is no dedicated `convert_email_to_task` tool; the bridge is the `createLinkedTask` endpoint + `emailRefresh`/`taskRefresh` counters that update both panels

### Step 2.5 — i18n + Theme compliance — ✅ DONE

- Zero hardcoded strings — all labels go through `t()` with en/zh/ja entries (th/mi/ru reserved with en fallback)
- Zero hardcoded colors — all colors via CSS variables; dynamic classNames via `cn()`

**i18n keys as built** (in `apps/web/src/lib/i18n.ts` — NOT in `apps/web/src/i18n/translations.ts`, which is vendor-legacy only):

```
emailDetail.tabAll, emailDetail.tabUrgent, emailDetail.tabAction, emailDetail.tabNotify, emailDetail.tabLow
emailDetail.empty, emailDetail.noConfig, emailDetail.goToSettings
emailDetail.summary, emailDetail.draft, emailDetail.send, emailDetail.readOrig
emailDetail.dismiss, emailDetail.dismissConfirm, emailDetail.convertToTask
emailDetail.from, emailDetail.received, emailDetail.connected, emailDetail.disconnected
emailDetail.markDone, emailDetail.genDraft, emailDetail.genDrafting, emailDetail.original
emailList.*, emailPanel.* (sendError variants, unlink/delete dialogs, unsaved-changes, ...)
```

---

## Files Changed Summary (actual)

| Action       | File                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **DELETE**   | `apps/web/src/components/SetupWizard.tsx` (done)                                                                                 |
| **CREATE**   | `apps/web/src/panels/email/EmailPanel.tsx`, `EmailList.tsx`, `EmailDetail.tsx`, `useEmailState.ts` (done)                        |
| **CREATE**   | `apps/web/src/components/chat/WelcomeGuide.tsx`, `LlmBanner.tsx` (welcome guide + soft gate)                                     |
| **CREATE**   | `apps/web/src/hooks/useSetupChecks.ts` (setup config flags + dismiss logic)                                                      |
| **EDIT**     | `apps/web/src/App.tsx` (wizard removal, banner, welcome guide mount, menu, badge, emailRefresh, context signals)                 |
| **EDIT**     | `apps/web/src/components/ContentPanel.tsx` (email panel mount)                                                                   |
| **EDIT**     | `apps/web/src/panels/tasks/TasksList.tsx` (filter out email type)                                                                |
| **EDIT**     | `apps/web/src/panels/tasks/TasksEditor.tsx` (remove email)                                                                       |
| **EDIT**     | `apps/web/src/panels/tasks/useTaskState.ts` (remove email state)                                                                 |
| **EDIT**     | `apps/web/src/panels/tasks/TasksPanel.tsx` (remove email dialogs)                                                                |
| **EDIT**     | `apps/web/src/lib/i18n.ts` (emailDetail/emailList/emailPanel + agent.enteredEmail/exitedEmail keys) — not `i18n/translations.ts` |
| **EDIT**     | `apps/web/src/lib/constants.ts` (MENU/MENU_LABEL incl. email)                                                                    |
| **EDIT**     | `apps/web/src/components/icons.tsx` (email icon)                                                                                 |
| **EDIT**     | `apps/api/src/routers/email.ts` (smartEmailId param on saveDraft/generateDraft, createLinkedTask)                                |
| **NOT DONE** | `apps/web/src/lib/api.ts` / `apps/api/src/routers/system.ts` (setup methods/endpoints still present as dead code)                |

## Verification (as built)

1. **Fresh install**: Launch → chat with actionable welcome guide → click "Configure LLM" → Settings opens → configure key → banner disappears → chat works
2. **Soft gate**: No API key → `LlmBanner` shows above the input; sending is blocked until configured
3. **Email panel**: Open → category tabs with i18n labels → click email → AI summary + reply draft → Convert to Task → Tasks panel opens with new issue
4. **Tasks regression**: Tasks panel has no email elements, kanban works, CRUD works
5. **Agent tools**: `list_emails`, `edit_email_reply`, `send_email_reply`, `read_email_original`, `dismiss_email`, `delete_email` all work from chat
6. **i18n**: Switch zh/ja → all email labels, category tabs, welcome guide update (th/mi/ru reserved with en fallback, not selectable in the dropdown)
7. **Theme**: Switch themes → email panel colors follow CSS variables, no hardcoded colors
8. **Language**: 3 languages (en/zh/ja) in the top-bar dropdown + welcome guide
