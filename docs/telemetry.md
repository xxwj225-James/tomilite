# Telemetry & Privacy

TomiLite is local-first: your tasks, notes, emails, reports, chats, API keys and
git data live in your own SQLite database under `~/.tomilite/` and are **never**
uploaded anywhere.

This page describes the **optional, opt-in** anonymous usage statistics the app
can share — what they contain, where they go, and how to turn them off.

## Policy summary

|               |                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Participation | **Opt-in**. Nothing is collected or sent until you agree on first run. You can also decline, or change your mind any time in **About → Privacy & Usage Statistics**. |
| Scope         | Aggregates and counts only. **No content, ever.**                                                                                                                    |
| Destination   | `https://tomatovector.com/api/telemetry/batch` (the author's own server). Not sold, not shared, not used for ads.                                                    |
| Local buffer  | While you use the app, events are staged in `~/.tomilite/telemetry.ndjson` and flushed in batches.                                                                   |
| Revocation    | Turning the feature off stops capture **and clears the locally staged buffer**.                                                                                      |

## What is collected

Only when you have opted in:

- **Panels opened** — e.g. you opened the Tasks / Notes / Email / Reports panel (`view.*`)
- **Item counts per day** — tasks created & done, notes, reports, emails processed, chat sessions & user messages, focus sessions & minutes, git commits, MCP tool executions
- **AI tools used** — the name of a built-in agent tool that actually ran (`tool.*`), e.g. `create_task`, `web_search`
- **Manual exports** — which export format you saved (`export.pdf`, `export.xlsx`, …)
- **Environment** — app version, OS + arch, interface language, and an **anonymous random install ID** (a UUID generated locally, with no link to you)

## What is NEVER collected

- Chat messages, prompts, or agent replies
- Note / report / email / file **content or titles**
- File names, email addresses, usernames
- Source code, git history contents, shell output
- API keys, model keys, credentials — in any form
- Anything that can identify a person

A red line in the code enforces this: telemetry payloads are limited to
feature names and aggregate counters. If you are ever unsure, the full
implementation is open source — see [`apps/api/src/lib/telemetry.ts`](../apps/api/src/lib/telemetry.ts)
and [`apps/web/src/lib/telemetry.ts`](../apps/web/src/lib/telemetry.ts).

## How it works

1. The renderer records events (panel views, exports) as they happen and posts
   them to the local API server (`POST /api/telemetry/event`).
2. The API server appends events to a local NDJSON buffer
   (`~/.tomilite/telemetry.ndjson`, capped at 2000 lines).
3. The server also derives per-day aggregate counts from the local database.
4. On boot + every 6 hours, the server flushes one batch envelope to the
   endpoint above and clears the buffer on success. Failed sends are kept and
   retried on the next flush.

## Turning it off

**About → Privacy & Usage Statistics** shows the current state:

- **Uncheck** → stops capture immediately and deletes the locally staged
  `telemetry.ndjson` buffer. No further data is recorded or sent.
- **Re-check** → resumes; an `app_launch` marker is recorded from that point.

You can also delete the buffer manually:

```bash
# Stop telemetry (no further events recorded)
# then remove the staged buffer if any exists:
rm "$HOME/.tomilite/telemetry.ndjson"   # Windows Git Bash
del "%USERPROFILE%\.tomilite\telemetry.ndjson"
```

## Self-hosting / overriding the endpoint

The destination can be overridden for testing or self-hosting:

```bash
TL_TELEMETRY_URL=https://your-server.example/api/telemetry/batch TomiLite.exe
```

The API server reads `TL_TELEMETRY_URL` at startup. Anything that implements
the contract below can receive batches:

```
POST /api/telemetry/batch
Content-Type: application/json

{
  "schema": 1,
  "installId": "<anonymous uuid>",
  "appVersion": "2.0.9",
  "platform": "win32",
  "arch": "x64",
  "lang": "zh",
  "ts": "2026-09-04T00:00:00.000Z",
  "events": [                        // ≤ 300 events
    { "id": "<uuid>", "name": "view.tasks", "ts": "...", "p": {} }
  ],
  "daily": { "date": "2026-09-04", "counts": { "tasksCreated": 3 } }
}
```

Respond `200 { ok: true }` to acknowledge. Anything else leaves the buffer
intact for the next retry.

## Privacy caveats

- Because participation is opt-in, the numbers reflect **users who chose to
  share**, not total installs. They are a representative sample of active,
  consenting users — not a census.
- Per-day counts are derived from your local database timestamps, which are
  stored in local time. On machines in different timezones a "day" boundary may
  shift by a few hours; aggregate trends are unaffected.
