# Meetings — Record, Transcribe, Summarize, Send, Create Tasks

> Status: IMPLEMENTED (MVP-0 / internal-test build)

## Context

The chain is `record → speech-to-text → AI summary → decisions → action items → minutes email → create task`.

The product claim is not "help me tidy up my meeting notes" — the note-taker apps already do that. It is **"turn a meeting into work"**. TomiLite already had Tasks, Notes, Email and Reports; this adds a meeting input so those stop being separate silos. The endpoint of the other apps is a summary. The endpoint here is a task that exists in the Issues table.

Two constraints shaped the implementation more than anything else:

1. **Speech-to-text runs locally.** Audio never leaves the machine. A bundled `whisper.cpp` binary does the transcription. Everything downstream (summary, decisions, action items) is text, and _that_ is what reaches an LLM.
2. **No diarization is performed.** The transcript shows `Speaker 1` / `Speaker 2`, never a name. See §5.

## What Was Shipped

### 1. Audio capture — mic + system loopback, mixed in the renderer

`electron/main.js` installs the capture plumbing (the repo previously had **no** permission handlers at all, so `getUserMedia` was simply denied):

- `session.setPermissionRequestHandler` + `setPermissionCheckHandler` — allow `media` / `display-capture` / `audioCapture` / `videoCapture`, but only when the requesting origin is `localhost` / `127.0.0.1`. Everything else is denied and logged.
- `session.setDisplayMediaRequestHandler(..., { useSystemPicker: false })` → `callback({ video: src, audio: 'loopback' })`. **`useSystemPicker: false` is load-bearing**: with it `true` the handler is never called and the `audio: 'loopback'` grant is silently dropped.
- The screen source is chosen by matching `screen.getPrimaryDisplay().id` against `source.display_id`, not `sources[0]` — on a multi-monitor setup the first entry is not guaranteed to be the primary display.
- The old `chromeMediaSource: 'desktop'` hack is **not** used; it terminates the renderer on Windows 11 (`bad_message.cc reason 263`).
- `shell:openExternal` IPC handler added — the existing `main.js` destructured `shell` without importing it in the main scope while still calling `shell.openExternal`. The mic-denied dialog uses this to open `ms-settings:privacy-microphone`.

`apps/web/src/lib/recorder.ts` builds the graph:

- `new AudioContext({ sampleRate: 16000 })` — Chromium resamples every input to 16 kHz mono for us. **This is why no ffmpeg is bundled** (whisper.cpp only accepts 16 kHz mono WAV).
- mic and loopback each go through their own gain, are **summed** (not averaged — averaging halves each source), then through a `DynamicsCompressor` (threshold −12 dB) to stop local clipping.
- The worklet's output goes through a zero gain into `ctx.destination`. Connecting to `destination` is required to pull the graph; doing so at unity would feed the app's own audio back into the recording.
- The `AudioWorklet` lives in `apps/web/public/meeting-worklet.js` on purpose: the CSP is `script-src 'self' 'unsafe-eval'` with **no `blob:`**, so a Blob-URL worklet is blocked.
- PCM is batched: the worklet posts every ~250 ms (transferring the buffer rather than copying it), the renderer POSTs every 5 s to `POST /api/meeting/audio-chunk` with `x-tl-meeting-id` and a monotonic `x-tl-seq`. A sequence gap returns `{ok:false, expectedSeq:N}` and the chunk is retried up to 3 times; past that the recording **pauses and reports loudly** rather than dropping audio silently.
- **Uploads are single-flight.** The size trigger and the 5 s timer both call `flush()`; without a guard two flushes race on the shared `seq`, the loser is answered as a duplicate, and the gap-retry path then feeds the server the _same_ PCM under the corrected number, which it appends. It also double-counts `uploadedBytes`, which is what `stop()` reports as the meeting's duration.
- **Starting a recording is guarded by a ref, not state.** Two clicks in the same tick both read the pre-render value of a state flag, so the guard has to be a ref. Setup takes seconds (permission check → display-media grant → audio graph → worklet load), and the panel used to show nothing at all until it finished — a button that looked dead, which is exactly what invites the second click. While `starting` the button is disabled and reads "Starting…".
- **A failed start cleans up after itself.** `meeting.create` runs before capture begins, so a start that then fails would otherwise leave an empty meeting in the library. The row is deleted on the way out.

### 2. Level meters and the dead-stream detector

Two `AnalyserNode`s tap mic and loopback separately, one more taps the mix. The UI shows all three plus a clipping indicator, at ~10 fps into React state (the analyser runs faster; re-rendering the panel at that rate for a cosmetic meter is pure churn).

The one that matters: if **loopback sits below −55 dBFS for 30 uninterrupted seconds while the mic has signal**, a non-blocking red banner appears —

> No system sound detected. Participants on a call may be playing through an output device TomiLite can't capture.

Windows loopback returning a **valid but dead stream** is far more common than an outright error, and the failure mode is nasty: the user believes the meeting is being recorded and only finds out afterwards that the remote side is missing. This detector was treated as P0 for exactly that reason.

### 3. Local speech-to-text

`packages/whisper-bin/` vendors the prebuilt `whisper.cpp` binary (pinned release, `whisper-bin-x64.zip`) plus the 4 MSVC runtime DLLs the upstream zip omits — `vcomp140.dll`, `msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll`. Without them the exe fails on a clean machine with `STATUS_DLL_NOT_FOUND` (`0xC0000135`). Total: 17 files, ~10 MB. It ships as a workspace package rather than being downloaded at runtime — downloading and executing an unsigned binary is a Defender/SmartScreen magnet.

`apps/api/src/lib/meeting/whisperJob.ts` spawns it directly (not via `ELECTRON_RUN_AS_NODE` — that is for Node scripts, this is a native exe):

```
whisper-cli.exe -m <model> -f <wav> -oj -of <outBase> -np -pp -t <threads> -l <lang>
```

- **Only one job at a time** — whisper.cpp saturates every core. A second request returns `{ok:false, error:'busy'}`.
- Threads: `min(8, max(1, cpus - 1))`.
- Progress is parsed from `whisper_print_progress_callback: progress =   6%` on stderr (`/progress\s*=\s*(\d+)%/`). If no progress line arrives for 20 s the UI switches from a determinate bar to an elapsed-time estimate clamped at 95%, and forces 100% when the process exits.
- **Success is judged by "the output JSON exists and parses with a `transcription` array", never by exit code.** whisper.cpp exits 0 on unreadable audio while writing no JSON at all.
- Cancelling kills the process, deletes the partial `.json`, sets `transcribeStatus='cancelled'` and **keeps the WAV** so the user can retry without re-recording.

Models are downloaded on demand from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<name>.bin` into `~/.tomilite/models/` (tiny 78 MB / base 148 MB / small 488 MB / medium 1.53 GB; **base** is the default and the one Settings recommends). Download progress streams over the SSE channel `model-download`. The MVP download has no resume, no checksum and no free-disk precheck.

Which model runs is resolved by `pickModel()`: the meeting's stored model first, then the default, then — if neither is on disk — the smallest installed model. That last step avoids the worst first-run outcome, where a user who deliberately downloaded `small` is told "no speech model installed" by a meeting created back when the default was `base`. The substituted name is written back to the meeting row. The smallest model wins the fallback rather than the largest, because silently running a 1.5 GB `medium` turns an hour-long meeting into an hour-long wait.

**A recording that never finalized is repaired, not written off.** The WAV header is written as 44 zero bytes and back-filled on stop, so a recording that ends without `finalize()` — the app was killed, the machine slept, the renderer never sent the stop — has no `RIFF` magic. Every byte of its audio is fine, but it reads as empty from both ends: `readWavInfo` bails on the missing magic, and whisper.cpp rejects the file outright. `repairWavHeader()` rewrites those 44 bytes from the file size and the `<id>.meta.json` sidecar, and runs before the reader on both the retry path and the startup recovery sweep. Without it a meeting recorded that way reports `no_audio` forever, with the audio sitting on disk.

Measured on an 8-core machine: tiny, 8 threads, 660 s of audio → 77.7 s with beam search, **39 s (RTF 0.059) with `-bs 1 -bo 1` and byte-identical output**. Transcription is a minutes-long job for a real meeting, which is why progress is streamed and the UI says so up front.

### 4. Data model

Three models in `packages/database/prisma/schema.prisma`:

- **`Meeting`** — title, duration, source, audio filename, sample rate, whisper model; a status axis per stage (`transcribeStatus`, `aiStatus`, `minutesStatus`); `transcript`, `chunkSummaries`, `summary`, `decisions`, `speakers`, `minutes`, `minutesSubject`, attendees/`sendTo`/`sendCc`/`sentAt`; `stageLog`; consent and retention fields; `archived`.
- **`MeetingSegment`** — `meetingId / idx / startMs / endMs / speaker / text`.
- **`MeetingActionItem`** — `meetingId / idx / text / owner / dueDate / priority / status / issueId @unique`.

`Issue` gains the reverse relation. `audioFile` stores a **filename only**, so moving `~/.tomilite` doesn't break the rows and a path-traversal attempt cannot escape the meetings directory.

Statuses are plain `String` columns rather than enums or a JSON blob specifically so startup recovery can run `findMany({ where: { transcribeStatus: 'running' } })` and pick up orphaned jobs.

> **SQLite foreign keys are not enabled in this codebase**, so `onDelete: Cascade` is documentation only. `meeting.delete` cascades manually inside a `$transaction`.

Migration: `SCHEMA_VERSION` 20 → **21** in `apps/api/src/server.ts`, plus the matching idempotent entry in the `migrations` array (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`).

### 5. Speaker labelling is deliberately honest

No diarization was performed, so the UI **never** renders a name. Segments show `Speaker 1` / `Speaker 2` / `Speaker 3`, with a disclaimer at the top of the transcript tab stating that these are not voice-print identifications.

The LLM may suggest a _role_ from context ("probably the project owner / a developer / the client"), but it is rendered as secondary italic grey text, labelled as a guess, and it never replaces the `Speaker N` label. Real speaker separation (sherpa-onnx) is a later phase; only then does `Speaker N` become something bindable to a person.

### 6. AI analysis — map-reduce

A naive implementation sends the whole transcript (8–15k input tokens for an hour) to the expensive model **three times** — once each for summary, decisions and action items. Instead:

```
MAP   (flash model, cacheable) : chunk by tokens (~2500, 10% overlap, split at the
                                 largest silence gap within ±15% rather than
                                 mid-segment) → per-chunk summary → PERSIST each
                                 chunk summary to `chunkSummaries`   ◄── idempotency boundary
SYNTH (pro model)              : digest = concatenated chunk summaries (~600–1500
                                 tokens regardless of meeting length)
                                 → one call returning strict JSON
                                   { summary, decisions[], actionItems[], speakers[] }
```

The expensive model never sees raw transcript; its input grows with _chunk count × summary length_, so a 3-hour meeting costs roughly what a 20-minute one does at the synth stage.

Idempotency is a double persistence boundary, so a retry never pays twice:

1. If `chunkSummaries` is non-empty and `force` is not set, the whole MAP stage is skipped.
2. Products are written only after the response parses completely; a truncated response is discarded.
3. `force: true` (the "Regenerate" button) is the _only_ path that re-runs completed stages, and it goes through the same confirmation.
4. `stageLog` records `{stage, model, inTokens, outTokens, costCny, ms, at}` per stage. Cost comes from the gateway's `X-LLM-Cost-Cny` response header and tokens from the `include_usage` frame; with a BYOK key both are absent and are recorded as `null`, not `0`.

If the JSON fails to parse, the code falls back to three separate pro-model calls — more expensive, but it produces a result, and `stageLog` records which path ran. DeepSeek / Moonshot get `thinking: { type: 'disabled' }` (mirroring `email.ts`), including the MAP stage, which is extraction work where thinking is wasted tokens.

`meeting.estimate` returns `{ chars, estInputTokens, mapCalls, mapModel, synthModel, hostedTrial }` where **`estInputTokens ≈ CJK chars / 1.5 + latin words / 4`** — a single chars/N divisor under-counts Chinese by roughly 2.5×, and this app is Chinese-first. Every number in the UI is prefixed "approx." and never presented as a quota.

On a hosted trial the summarize call must carry `confirmHosted: true`; without it the server returns `{ok:false, error:'confirm_required'}` so a programmatic call cannot silently spend money. BYOK skips the dialog and shows the estimate as small grey text.

The gateway needed **zero changes** — meeting AI stages are ordinary `resolveLLM()` chat completions, so metering and the `quota_exhausted` code apply automatically. When quota runs out the audio, transcript and `chunkSummaries` are all already on disk, so after upgrading, "Generate" skips MAP and pays only for SYNTH; the UI says the transcript is saved and can be continued at any time.

### 7. Minutes email and task creation

`apps/api/src/lib/smtpSend.ts` was extracted from `email.ts` (`sendWithStoredSmtp({to, cc, subject, html, attachments})`) and `email.sendReport` now uses it too, so the "look up SMTP config and decrypt the password" logic exists once.

`meeting.sendMinutes` assembles the minutes-specific HTML (the same `marked.parse` + HTML wrapper + base64 attachment shape `useReportsState.handleSendEmail` uses). If SMTP is not configured it returns `{ok:false, error:'smtp_not_configured'}` and the panel renders a "Go configure" button that routes to Settings → Email via `__tl_settingsTab = 'email'` + `tl-navigate`. The Settings SMTP UI itself was not touched.

`meeting.createTaskFromActionItem` is structurally cloned from the already-verified `email.createLinkedTask`:

- already linked → `already_linked`, no-op
- otherwise best-effort `resolveLLM()` with the flash model produces `{type, title, description}`, wrapped in try/catch with a hardcoded default so a task is still created when the gateway is down
- `Issue` takes `max(issueNumber) + 1` with `status: 'todo'`
- `issueId` is written back to the action item and its status set to `created`
- the row updates in place, then `tl-navigate` → `tasks` with `tl-select-task`

### 8. Frontend

`apps/web/src/panels/meeting/` — `MeetingPanel.tsx` (thin shell), `useMeetingState.ts` (all state and business logic, same flat-`useState` + single return-bag shape as `useReportsState.ts`), `MeetingList.tsx`, `MeetingEditor.tsx`, `RecorderBar.tsx`.

Recording state lives in a **global zustand store** (`apps/web/src/stores/meetingStore.ts`) rather than inside the panel, so `MeetingIndicator` — rendered by the app shell — can show a non-dismissible red banner with the elapsed timer on _every_ panel, including Tasks and Notes. An app that quietly records system audio with no visible indicator is indistinguishable from spyware, and a banner the user can close is not there at minute 40.

Two dialogs are hand-rolled portals rather than `ConfirmDialog`, because `ConfirmDialog`'s `message` is typed as a string: the **consent gate** (a checkbox the user must actually tick) and the **send-minutes form** (recipients + editable body). Everything else — hosted-AI confirmation, notices, delete — uses the shared `ConfirmDialog`.

The panel stays usable with no speech model installed: recording and emailing do not depend on transcription, so the model warning is a non-blocking amber note rather than a disabled feature.

Registration changes: `ContentPanel.tsx` (import, all-language `MENU_TEXTS`, `mounted.has('meeting')` block, `tl-navigate` whitelist entry), `lib/constants.ts` (`MENU` + `MENU_LABEL`), `components/icons.tsx` (mic + stand glyph), `App.tsx` (`meetingRefresh` from `useEditorMonitors`), `hooks/useSendMessage.ts` (`open meeting` intent + panel context for the agent), `panels/settings/SettingsPanel.tsx` (`ALL_TABS`).

All UI text goes through the centralized `meeting.*` block in `apps/web/src/lib/i18n.ts` (en/zh/ja complete — `LANGS` is `['en','zh','ja']`). Styling uses CSS variables and inline `style={{}}` like the other panels; hex literals are an ESLint warning and `lint-staged --max-warnings 0` makes them fatal. The elapsed timer is `aria-live="polite"`; the level meters are `aria-hidden` (they update far too often to announce).

### 9. Consent, privacy disclosure and retention

Before the first recording, a blocking dialog explains that both the microphone **and** system audio are captured to a local file, and that recording may require the consent of **every** participant depending on jurisdiction (all-party-consent jurisdictions such as Germany and California/Illinois/Washington are named, alongside one-party-consent ones). The user must tick "I will obtain any consent required where I am" to continue. The acknowledgement is stored in `Meeting.consentAcknowledgedAt` and can be reviewed or reset in Settings → Meetings.

**This is not legal advice and TomiLite does not claim to determine legality for the user.**

The privacy disclosure in Settings is deliberately three separate lines rather than one "local-first" slogan, because a single sentence gets read as "nothing leaves my machine" while the transcript _does_ go to an LLM:

```
🔒 Privacy
  Audio        ✓  Processed and stored locally, never uploaded
  Transcript   ✓  Stored locally in TomiLite's database
  AI summary   ⚠  Transcript text is sent to the LLM provider you configured
                  (through the TomiVector gateway on a hosted trial)
```

Retention defaults to 30 days (`0` = keep forever). The field is written in this phase; the automatic cleanup job that acts on it is not.

## Files Shipped

| File                                                | Change                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/whisper-bin/`                             | **New** — vendored `whisper-cli.exe` + 12 whisper DLLs + 4 MSVC runtime DLLs               |
| `packages/database/prisma/schema.prisma`            | `Meeting`, `MeetingSegment`, `MeetingActionItem` + `Issue` reverse relation                |
| `apps/api/src/server.ts`                            | `SCHEMA_VERSION` → 21, migration entry, router + audio routes registered                   |
| `apps/api/src/routers/meeting.ts`                   | **New** — procedures, `handleMeetingStream`, `handleMeetingAudioChunk`, orphan recovery    |
| `apps/api/src/lib/meeting/paths.ts`                 | **New** — `~/.tomilite/meetings/`, `~/.tomilite/models/` resolution                        |
| `apps/api/src/lib/meeting/audioFile.ts`             | **New** — WAV header placeholder + append-only PCM writes + finalize                       |
| `apps/api/src/lib/meeting/whisperBin.ts`            | **New** — locate the vendored binary and validate its DLL set                              |
| `apps/api/src/lib/meeting/whisperJob.ts`            | **New** — single-flight spawn, progress parsing, cancel, JSON result parsing               |
| `apps/api/src/lib/meeting/models.ts`                | **New** — model catalog, `listModels()`, download / cancel / delete                        |
| `apps/api/src/lib/meeting/pipeline.ts`              | **New** — map-reduce summarize, estimate, minutes assembly, task creation                  |
| `apps/api/src/lib/meeting/events.ts`                | **New** — SSE job registry                                                                 |
| `apps/api/src/lib/smtpSend.ts`                      | **New** — `sendWithStoredSmtp()` extracted from `email.ts`                                 |
| `apps/api/src/routers/email.ts`                     | `sendReport` now routes through `sendWithStoredSmtp`                                       |
| `electron/main.js`                                  | Permission handlers, `setDisplayMediaRequestHandler` (loopback), `shell:openExternal` IPC  |
| `apps/web/public/meeting-worklet.js`                | **New** — AudioWorklet (must be same-origin; CSP blocks `blob:`)                           |
| `apps/web/src/lib/recorder.ts`                      | **New** — graph, mixer, resample fallback, batching, level + dead-stream detection         |
| `apps/web/src/stores/meetingStore.ts`               | **New** — global recording state for the shell-wide indicator                              |
| `apps/web/src/panels/meeting/MeetingPanel.tsx`      | **New** — shell, consent gate, send dialog                                                 |
| `apps/web/src/panels/meeting/useMeetingState.ts`    | **New** — all state + logic                                                                |
| `apps/web/src/panels/meeting/MeetingList.tsx`       | **New** — library, search, status chips, retention badges                                  |
| `apps/web/src/panels/meeting/MeetingEditor.tsx`     | **New** — progress, transcript / minutes / actions tabs                                    |
| `apps/web/src/panels/meeting/RecorderBar.tsx`       | **New** — timer, meters, dead-stream and degraded banners                                  |
| `apps/web/src/components/chat/MeetingIndicator.tsx` | **New** — shell-wide recording banner                                                      |
| `apps/web/src/panels/settings/MeetingTab.tsx`       | **New** — privacy block, engine status, models, defaults, consent record                   |
| `apps/web/src/lib/api.ts`                           | `meeting.*` client methods                                                                 |
| `apps/web/src/lib/i18n.ts`                          | `meeting.*` keys (en / zh / ja)                                                            |
| `apps/web/src/lib/constants.ts`                     | `MENU` + `MENU_LABEL`                                                                      |
| `apps/web/src/components/icons.tsx`                 | `meeting` icon                                                                             |
| `apps/web/src/components/ContentPanel.tsx`          | Panel route + `MENU_TEXTS` + navigate whitelist                                            |
| `apps/web/src/hooks/useEditorMonitors.ts`           | `meetingRefresh` / `bumpMeeting`                                                           |
| `apps/web/src/hooks/useSendMessage.ts`              | `open meeting` intent + meeting panel context                                              |
| `apps/web/src/panels/settings/SettingsPanel.tsx`    | `meeting` tab                                                                              |
| `apps/web/src/App.tsx`                              | `meetingRefresh` wiring + `<MeetingIndicator>`                                             |
| `README.md`                                         | Privacy section revised — meeting audio never uploaded, transcript is what reaches the LLM |

## Verification

1. `binStatus` reports 17 files / ~10 MB present. On a machine without the VC++ redistributable, `whisper-cli.exe` still starts.
2. Record a real call: confirm the mic meter, the loopback meter and the mix meter all move; the timer is `aria-live`; the shell-wide indicator survives switching to Tasks and back.
3. Mute the output device mid-recording → within 30 s the dead-stream banner appears. Unmute → it clears.
4. Stop → `<id>.wav` exists under `~/.tomilite/meetings/`, is playable, and its RIFF length matches the byte count. `transcribeStatus` goes `queued → running → done`, the progress bar advances, and `MeetingSegment` rows are written.
5. Force `source: 'mic'` → recording still works, degraded banner shown, `Meeting.source === 'mic'`.
6. With no model installed: recording and stopping still work, and the panel offers a deep link to Settings → Meetings.
7. Generate a summary → `chunkSummaries` populated, then `summary` / `decisions` / `actionItems` written. Re-run with the same input → **zero MAP calls**.
8. Kill the process mid-SYNTH and retry → still zero MAP calls.
9. Run out of quota → localized message with an upgrade deep link, transcript intact, and after topping up only SYNTH is paid for.
10. Send minutes with SMTP unconfigured → `smtp_not_configured` and a working "Go configure" link. With SMTP configured → mail arrives with the rendered HTML and optional transcript attachment.
11. Create a task from an action item → `Issue` created (`TL-N`), `issueId` written back, the row updates in place, and navigating to Tasks selects it. Click again → `already_linked`.
12. Click through the transcript while it says `Speaker 1` / `Speaker 2` — no names anywhere, disclaimer visible, role hints styled as guesses.
13. Delete a meeting → segments and action items are gone too, and the WAV is removed from disk.
