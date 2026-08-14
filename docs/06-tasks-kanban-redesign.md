# Tasks Panel Kanban Redesign

## Context

The standalone EmailInbox page was removed. All email tasks now appear in TasksPanel through the AI pipeline. The current flat list view can't efficiently show the mixed regular Issues + email SmartEmails. Need a Kanban view with notification bar, mixed cards, and multi-state detail panel.

## Changes

### 1. Layout: Three-Column Kanban + Notification Bar

Replace the current flat table (column headers + sorted rows) with three Kanban columns:

```
[Notification Bar — cat 3 emails, compact horizontal]
[ TODO ]           [ IN_PROGRESS ]     [ DONE ]
```

- **Notification Bar**: Category 3 emails as compact chips. Each shows one-line summary. Click dismiss → mark processed.
- **Kanban Columns**: TODO / IN_PROGRESS / DONE. Cards are a mix of regular Issues and email SmartEmails.
- Keep existing filters (type/priority/status) as column filters.
- Keep search bar.

### 2. Task Cards — Two Types

**Regular Issue Card**: Same as now — title, priority badge, SP, date.

**Email Card (📥)**: Shows subject + from + AI summary excerpt + category badge (⚡ urgent / 📝 reply today). Click opens email detail panel.

### 3. Detail Panel — Multi-State

When user clicks a card, right-side detail panel opens:
- **Regular Issue**: Existing edit form with title/description/status/priority/etc.
- **Email Task**: Shows AI summary, reply draft editor, action buttons:
  - [✍️ 修改并发送] — edit draft + send via SMTP
  - [🌐 阅读邮件原文] — fetch full email from IMAP by UID
  - [✅ 标记完成] — mark processed, move to DONE

### 4. Keyboard Shortcuts

- `J`/`K` — navigate cards
- `Enter` — open detail panel
- `N` — new Issue
- `Space` (on email) — mark read/dismiss
- `Escape` — close detail panel

### 5. Keep Existing Functionality

- Column picker (show/hide columns → show/hide Kanban lanes)
- Sort within columns
- Batch select + delete
- New Issue creation

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/components/ContentPanel.tsx` | Complete TasksPanel redesign — replace flat list with Kanban, add email cards, multi-state detail panel, keyboard shortcuts |

## Verification

1. Open Tasks panel → see three Kanban columns
2. Notification bar shows cat 3 emails at top
3. Mix of regular Issues and 📥 email cards
4. Click email card → detail panel shows AI summary + reply draft
5. J/K navigate cards, Enter opens detail, N creates new task
