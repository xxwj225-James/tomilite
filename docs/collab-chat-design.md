# Project Collaboration Chat — Design

> **Status**: Design proposal (not implemented)
> **Date**: 2026-08-20
> **Architecture decision**: TomiHub serves as the collaboration backend; TomiLite stays a single-user local app acting as a collaboration client.

## 1. Goal

Let TomiLite users collaborate on project work without leaving the app:

- Create or join a **project group**, chat with members in the group
- Or chat directly with project members without a group (1:1)
- Discuss a specific **issue** inside the chat
- **@ a member** to hand the issue over to them (assign)
- The assignee then **analyzes and processes** the issue directly in TomiLite

TomiLite remains personal-flow; the collaboration data (members, messages, shared issues) lives in TomiHub. This is also the commercial funnel: personal use free → team collaboration needs TomiHub.

## 2. Architecture

```
┌───────────────────────────────┐        HTTPS + JWT/API-token
│ TomiLite (Electron)           │ ──────────────────────────────▶ ┌──────────────────────┐
│                               │                                 │ TomiHub (self-hosted)│
│  ┌─ CollaborationPanel ────┐  │                                 │                      │
│  │ group list │ chat stream│  │  ◀── SSE (or 5s poll) ──────── │  projects/members    │
│  │ @mentions  │ issue cards│  │                                 │  messages            │
│  └──────────────────────────┘  │                                 │  issues (assign)     │
│  ┌─ TasksPanel (collab mode) ┐ │ ──────────────────────────────▶ │  realtime channel    │
│  │ TomiHub issues, analyze  │  │                                 └──────────────────────┘
│  └───────────────────────────┘ │
└───────────────────────────────┘
```

- TomiLite adds a **Collaboration** menu item (new panel)
- All collaboration data flows through TomiHub's API; nothing collaboration-related is stored in the local SQLite except connection settings + a small read cache
- Realtime: prefer TomiHub SSE/WebSocket if available; fall back to 5-second polling (TomiLite already uses polling for email)

## 3. Connection & Auth

**Settings → Collaboration** tab (new):

| Field             | Notes                                                            |
| ----------------- | ---------------------------------------------------------------- |
| TomiHub URL       | e.g. `https://hub.example.com`                                   |
| Login method      | username + password → JWT (refreshable), or long-lived API token |
| Connection status | test-connection button, per-project sync state                   |

- Token stored locally with the existing AES-256-GCM `crypto.ts` (same as LLM/MCP keys)
- Never sent to any LLM; agent tools receive an opaque `hubToken` at runtime only
- Offline behavior: panel shows "TomiHub unreachable" state, last-synced messages remain readable from cache

## 4. Data Model

TomiHub side (existing multi-tenant schema, referenced — not owned by TomiLite):

| Entity          | Key fields                                              | Purpose                             |
| --------------- | ------------------------------------------------------- | ----------------------------------- |
| `Project`       | id, name, members[]                                     | the project group                   |
| `ProjectMember` | projectId, userId, role                                 | membership                          |
| `Message`       | id, projectId, senderId, body, mentions[], issueRef, ts | chat message (group or 1:1 channel) |
| `Issue`         | id, number, title, status, assigneeId                   | shared project issue                |

TomiLite side (SQLite additions):

| Entity            | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `HubConnection`   | url, encrypted token, active project id             |
| `HubMessageCache` | last-N messages per project for offline reading     |
| `HubIssueCache`   | lightweight issue snapshot for quick card rendering |

## 5. UI Design

### 5.1 Collaboration Panel

```
┌────────────┬───────────────────────────────────────────────┐
│ PROJECTS   │  # Web Portal                    5 members ⚪ │
│ ▸ Web Port…│ ───────────────────────────────────────────── │
│ ▸ API Tea… │  Alice  10:32                              ▸ │
│            │  登录页的样式崩了 @Bob 能看一下吗            │
│ 📥 Inbox   │  ┌─ Issue #234 ──────────────────────────┐   │
│  (1:1 DMs) │  │ 🟡 in_progress · 登录页样式崩坏         │   │
│            │  │ Assignee: Alice → 转派                 │   │
│            │  └────────────────────────────────────────┘   │
│            │  Bob   10:35 ✓ 收到，我来处理                  │
│            │ ───────────────────────────────────────────── │
│            │  [ @mention… ] [ #issue… ] [Send]           │
└────────────┴───────────────────────────────────────────────┘
```

- Left: project groups + 1:1 DM list (unread badges)
- Center: chat stream — plain messages, **issue cards** (embedded, clickable), @mentions highlighted
- Composer: `@` opens a member picker, `#` opens an issue picker (searches TomiHub issues); typed mentions render as chips

### 5.2 @-Handover (the core flow)

1. Alice composes: `@Bob 请处理` + attaches `#234` (issue card)
2. Send → TomiHub API `issue.assign(issueId=234, assignee=Bob)` is called **with the message transaction**
3. Message renders with the issue card showing `Assignee: Alice → Bob`
4. Bob gets an in-app notification (and TomiHub-side notification)
5. Bob clicks the card → **TasksPanel opens in collaboration mode** showing issue #234 → he uses the existing editor + agent tools to analyze and process it

### 5.3 Collaboration-mode TasksPanel

- A toggle in TasksPanel: `Local` / `Hub: Web Portal`
- Hub mode lists TomiHub issues through the API (with local cache); drag-to-status and editing call `issue.update` on TomiHub instead of the local router
- The existing AI tools (`analyze issue`, `create subtasks`, `generate fix notes`) work unchanged — they read whatever issue is open

## 6. Agent Integration

New agent tools (TomiLite side), enabled only while a TomiHub connection is active:

| Tool                   | Behavior                                                                  |
| ---------------------- | ------------------------------------------------------------------------- |
| `collab_list_messages` | Summarize recent group chat (unread first)                                |
| `collab_send_message`  | Draft/send a reply on the user's behalf (send requires user confirmation) |
| `collab_assign_issue`  | Re-assign an issue (used when the user says "把这个转给 @X")              |
| `collab_get_issue`     | Pull a Hub issue into context for analysis                                |

Scenario: user is @-mentioned → TomiLite notification → "Tomi, 看看 @我的消息" → agent reads the thread, summarizes, proposes a reply or directly processes the issue.

## 7. TomiHub API Contract (required)

Assumed available in TomiHub; gaps to be implemented on TomiHub side:

```
POST /api/auth.login               { username, password } → { token, user }
GET  /api/project.list             → [{ id, name, memberCount }]
GET  /api/project.members          { projectId } → [{ id, name, avatar }]
GET  /api/message.list             { projectId, cursor } → { messages, nextCursor }
POST /api/message.send             { projectId, body, mentions[], issueRef? }
POST /api/issue.assign             { issueId, assigneeId, message? }
GET  /api/issue.get                { issueId } → { number, title, status, assignee, ... }
GET  /api/issue.list               { projectId, status? }
POST /api/issue.update             { issueId, ... }   (collab-mode TasksPanel)
GET  /api/realtime/stream          SSE: new messages, mentions, assignments
```

All calls carry `Authorization: Bearer <token>`; TomiLite client id/UA identifies the desktop client.

## 8. Security & Privacy

- TomiHub token encrypted at rest (AES-256-GCM, existing `crypto.ts`)
- HTTPS enforced for non-localhost TomiHub URLs (same policy as MCP remote servers)
- LLM calls never include the token; agent tools pass it at request time only
- Local cache contains message text only — cleared on disconnect
- Single-user assumption preserved: the local DB still has no user table

## 9. i18n & Theme

- All UI text through the keyed `t()` dictionary (`collab.*` keys, en/zh/ja)
- Colors via CSS variables only (panel follows the active theme)

## 10. Phased Plan

| Phase                   | Scope                                                                             | Estimate  |
| ----------------------- | --------------------------------------------------------------------------------- | --------- |
| **P1 — Connect & Chat** | Settings tab, auth, project/DM list, send/receive messages, @mention picker       | 1–2 weeks |
| **P2 — Issue Handover** | `#issue` cards in messages, @-assign flow, collab-mode TasksPanel (read + update) | 1–2 weeks |
| **P3 — Agent Tools**    | 4 collab tools, unread-summary prompt, notification on mention/assign             | 1 week    |
| **P4 — Polish**         | SSE realtime, unread badges, offline cache UX, keyboard shortcuts                 | 1 week    |

## 11. Open Questions

1. Does TomiHub already expose the API contract in §7, or does it need to be built/extended first? (P1 depends on this)
2. 1:1 DM model — reuse the Message table with a `channel: 'group' | 'dm'` discriminator, or a separate DM table?
3. Issue numbering across Hub projects — TomiLite's local `TL-xxx` vs Hub's project-scoped numbers; how to disambiguate in cards?
4. Should agent-sent messages be marked (e.g. "sent by Tomi" badge) to satisfy team transparency norms?
