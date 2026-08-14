# TomiLite: Remove SetupWizard + Separate Email from Tasks

## Context

Two UX improvements for TomiLite:

1. **SetupWizard blocks new users** — the full-screen wizard prevents using the app at all until setup is complete. New users should immediately enter the chat interface with an inline guide containing **actionable buttons** (click → opens relevant Settings tab), and configure LLM/email/git/language/theme at their own pace.

2. **Email is embedded in Tasks panel** — the Email filter, AI reply drafts, email cards, and notification bar are all inside the Tasks panel. This conflates two distinct concerns. Email should have its own dedicated panel with category tabs, reply workflow, "Convert to Task" bridge, and notification badge.

---

## Feature 1: Remove SetupWizard → Actionable Inline User Guide

### Step 1.1 — Delete SetupWizard component

- **Delete**: `apps/web/src/components/SetupWizard.tsx`
- **Edit** `apps/web/src/App.tsx`:
  - Remove `import { SetupWizard } from '@/components/SetupWizard';`
  - Remove `showSetup` state and setup check logic
  - Remove `{showSetup && <SetupWizard onDone={...}/>}` JSX
  - Remove the `setupChecked` loading screen — replace with simple spinner gated on `sessionsLoaded`
  - Morning/evening standup effects: change `if (!setupChecked) return;` → `if (!sessionsLoaded) return;`

### Step 1.2 — Soft Gate: LLM API Key missing banner

**Risk**: New user sends message without configuring LLM API Key → backend agent throws AuthenticationError.

**Solution** — Add a `SetupChecklist` component that:
1. On mount, queries `api.llm.getConfig()` to check `activeProvider?.hasKey`
2. If `llmConfigured === false`, renders a **prominent banner above the chat input**:
   > ⚠️ LLM API Key not configured. **[Configure now →]** (click opens Settings → LLM tab)
3. If user presses Enter with empty API key, frontend intercepts and shows the banner (no wasted API call)
4. Banner is dismissible but reappears on next message attempt until key is set

**Also add to welcome guide** (see Step 1.4).

### Step 1.3 — Expand language options

Currently `LANGS = ['en', 'zh']` in App.tsx. SetupWizard was the only place users could pick ja/th/mi/ru.

- Expand `LANGS` to `['en', 'zh', 'ja', 'th', 'mi', 'ru']`
- Expand `LANG_LABELS` and `LANGS_FULL` accordingly
- Falls back to English strings where translations are missing (existing pattern)

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

**Behavior**:
- Each `[Configure →]` button dispatches `tl-navigate` to `'settings'` with a tab hint
- Language dropdown + theme dots work instantly in-place
- Guide only shows when DB has zero chat sessions (existing `showWelcome` logic)

**Dismiss logic** (guide stops showing when either condition is met):
1. **All setup completed** → auto-hide, set `localStorage['tl-welcome-dismissed'] = '1'`. "All setup completed" = LLM key configured (required) + user has interacted with at least one optional item or explicitly clicked "Skip for now"
2. **User explicitly dismisses** → clicks `[Don't show again]` → set `localStorage['tl-welcome-dismissed'] = '1'`
3. On subsequent launches, if `localStorage['tl-welcome-dismissed'] === '1'`, guide never shows again
4. The checklist re-evaluates live: as user configures items, completed items show ✅; when LLM is done (required), a "Start using →" button appears to dismiss and begin chatting

### Step 1.5 — Remove backend setup check

- Remove `isSetupCompleted` and `markSetupCompleted` from `apps/api/src/routers/system.ts`
- Remove corresponding API client methods from `apps/web/src/lib/api.ts`

---

## Feature 2: Separate Email from Tasks

### Step 2.0 — Backend: draft endpoints accept SmartEmail ID

**File**: `apps/api/src/routers/email.ts`
- `saveDraft`: add optional `smartEmailId` param; if provided, update `SmartEmail.replyDraft` directly
- `generateDraft`: add optional `smartEmailId` param; save draft to SmartEmail row

### Step 2.1 — Create Email panel (`apps/web/src/panels/email/`)

#### `useEmailState.ts` — standalone hook (independent polling)
- **Independent polling** with debounce — does NOT share fetch cycle with Tasks
- State: `emails`, `activeCategory`, `selected`, `replyText`, `draftGenerating`, `sending`, `sendError`, `emailFullBody`, `emailLoading`, `connected`, `configLoaded`
- `fetchEmails()` via `/api/email.listSmartEmails` (debounced, 500ms)
- `handleConvertToTask()` — creates Issue from email, links via `issueId`

#### `EmailList.tsx` — category tabs + email cards
- Category tabs with **i18n labels** (not hardcoded): `email.tab.urgent`, `email.tab.today`, `email.tab.fyi`, `email.tab.all`
- Email cards: subject, sender, date, one-line summary, linked task badge
- "No email account" → shows link to Settings → Email tab

#### `EmailDetail.tsx` — reply workflow + "Convert to Task" bridge
- AI summary block (direct from `SmartEmail.summary` field)
- AI reply draft in `MarkdownEditor`
- **`[Convert to Task →]` button**: creates Issue with `title=subject, description=summary, source_email_id=email.id`, switches to Tasks panel
- Send / Dismiss / Mark Done actions
- All strings via i18n; all colors via CSS variables

#### `EmailPanel.tsx` — thin shell (list | detail)

### Step 2.2 — Wire into ContentPanel + App.tsx

- Add `email` to ContentPanel `MENU_TEXTS` (all 6 languages)
- Add `email` to App.tsx `MENU` array with icon
- **Move notification badge** from Tasks button → Email button
- Add `enteredEmail` / `exitedEmail` context signals for AI agent
- Add `emailRefresh` state; agent email tools (`send_email_reply`, `dismiss_email`) bump `emailRefresh`

### Step 2.3 — Remove email from Tasks panel

- `TasksList.tsx`: remove Cat-3 notification bar, email filter option, emailCards logic, email kanban cards, email type grouping
- `TasksEditor.tsx`: remove email detail panel (both active and done states), email option from type dropdown
- `useTaskState.ts`: remove all email state/handlers/dirty-tracking; remove `fetchNotifications` and its call sites
- `TasksPanel.tsx`: remove `_email` branches in ConfirmDialogs

### Step 2.4 — Agent Context Bridge (跨面板联动)

**Risk**: After extracting email from Tasks, AI agent loses visibility into email state.

**Mitigations**:
1. **Keep all email Agent Tools intact**: `reply_email`, `fetch_emails`, `dismiss_email`, `read_email_original`, `send_email_reply` remain registered in `apps/api/src/agent/tools/emailTools.ts` — no pruning
2. **Context signal**: When Email panel is open, `sendMessage` prepends `[Email panel OPEN — viewing ${subject}]` to the message context (same pattern as Tasks/Notes panels)
3. **"Convert to Task" bridge**: `EmailDetail.tsx` has explicit button that creates Issue + switches to Tasks panel + dispatches `tl-select-task`
4. **Agent-initiated conversion**: Agent tool `convert_email_to_task` (already exists) continues working — its result triggers `setTaskRefresh` to update Tasks panel

### Step 2.5 — i18n + Theme compliance

**ALL new components MUST**:
- Zero hardcoded strings → every label through `tr()` or `t()` with en/zh/ja/th/mi/ru entries
- Zero hardcoded colors → all colors via CSS variables (`var(--bg)`, `var(--surface)`, `var(--edge)`, `var(--brand)`, `var(--green)`, `var(--amber)`, `var(--muted)`, `var(--ink)`)
- Category tab colors use existing semantic vars: urgent=`var(--brand)`, today=`var(--amber)`, fyi=`var(--blue)`
- Dynamic classNames via `cn()`

**New i18n keys needed** (in `apps/web/src/i18n/translations.ts` or App.tsx T object):
```
email.tab.all, email.tab.urgent, email.tab.today, email.tab.fyi
email.empty, email.noConfig, email.goToSettings
email.summary, email.draft, email.send, email.readOriginal
email.dismiss, email.dismissConfirm, email.convertToTask
email.from, email.received, email.connected, email.disconnected
email.markDone, email.genDraft, email.genDrafting, email.original
```

---
## Files Changed Summary

| Action | File |
|--------|------|
| **DELETE** | `apps/web/src/components/SetupWizard.tsx` |
| **CREATE** | `apps/web/src/panels/email/EmailPanel.tsx` |
| **CREATE** | `apps/web/src/panels/email/EmailList.tsx` |
| **CREATE** | `apps/web/src/panels/email/EmailDetail.tsx` |
| **CREATE** | `apps/web/src/panels/email/useEmailState.ts` |
| **EDIT** | `apps/web/src/App.tsx` (wizard removal, soft-gate banner, welcome guide, menu, badge, lang expansion, emailRefresh, context signals) |
| **EDIT** | `apps/web/src/components/ContentPanel.tsx` (email panel mount) |
| **EDIT** | `apps/web/src/panels/tasks/TasksList.tsx` (remove email) |
| **EDIT** | `apps/web/src/panels/tasks/TasksEditor.tsx` (remove email) |
| **EDIT** | `apps/web/src/panels/tasks/useTaskState.ts` (remove email state) |
| **EDIT** | `apps/web/src/panels/tasks/TasksPanel.tsx` (remove email dialogs) |
| **EDIT** | `apps/web/src/i18n/translations.ts` (new email i18n keys) |
| **EDIT** | `apps/web/src/lib/api.ts` (remove setup API methods) |
| **EDIT** | `apps/api/src/routers/system.ts` (remove setup endpoints) |
| **EDIT** | `apps/api/src/routers/email.ts` (smartEmailId param) |

## Verification

1. **Fresh install**: Launch → chat with actionable welcome guide → click "Configure LLM" → Settings opens → configure key → banner disappears → chat works
2. **Soft gate**: No API key → send message → banner shows, message blocked
3. **Email panel**: Open → category tabs with i18n labels → click email → AI summary + reply draft → Convert to Task → Tasks panel opens with new issue
4. **Tasks regression**: Tasks panel has zero email elements, kanban works, CRUD works
5. **Agent tools**: `reply_email`, `dismiss_email`, `send_email_reply` all work from chat
6. **i18n**: Switch zh/ja/th/mi/ru → all email labels, category tabs, welcome guide update
7. **Theme**: Switch themes → email panel colors follow CSS variables, no hardcoded colors
8. **Language**: All 6 languages available in top-bar dropdown + welcome guide
