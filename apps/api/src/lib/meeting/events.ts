// ═══ Meeting progress bus ═══
//
// One in-process pub/sub keyed by meeting id, feeding the SSE route
// GET /api/meeting/stream. Three producers publish here — the model downloader,
// the whisper job and the AI pipeline — and the renderer subscribes once.
//
// The bus keeps the last few events per meeting so a subscriber that connects a
// moment late (React re-mount, tab switch, a reload mid-transcription) still
// learns the current state instead of staring at an empty bar.
//
// Channels are deliberately generic (a meeting id, or a synthetic id such as
// 'model-download') and event names are namespaced by stage — `transcribe:*`,
// `ai:*`, `model:*`. There is no terminal event: one stream can carry a model
// download and a transcription at once, so closing on either would cut the other
// off. The renderer opens one EventSource and closes it on unmount.

export interface MeetingEvent {
  event: string;
  data: unknown;
  at: number;
}

type Subscriber = (e: MeetingEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();
const replay = new Map<string, MeetingEvent[]>();

// Bounded so a long-running download that ticks every 200ms can't grow forever.
const REPLAY_LIMIT = 12;

export function publish(meetingId: string, event: string, data: unknown): void {
  const e: MeetingEvent = { event, data, at: Date.now() };
  const buf = replay.get(meetingId) || [];
  buf.push(e);
  if (buf.length > REPLAY_LIMIT) buf.splice(0, buf.length - REPLAY_LIMIT);
  replay.set(meetingId, buf);

  const subs = subscribers.get(meetingId);
  if (!subs) return;
  for (const fn of subs) {
    try {
      fn(e);
    } catch {
      /* a dead subscriber must not break the producer */
    }
  }
}

/** Subscribe and immediately replay the buffered tail. Returns an unsubscribe fn. */
export function subscribe(meetingId: string, fn: Subscriber): () => void {
  for (const e of replay.get(meetingId) || []) {
    try {
      fn(e);
    } catch {
      /* ignore */
    }
  }
  let subs = subscribers.get(meetingId);
  if (!subs) {
    subs = new Set();
    subscribers.set(meetingId, subs);
  }
  subs.add(fn);
  return () => {
    const s = subscribers.get(meetingId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) subscribers.delete(meetingId);
  };
}

/** Drop all buffered state for a meeting (called on delete / retention cleanup). */
export function forget(meetingId: string): void {
  replay.delete(meetingId);
  subscribers.delete(meetingId);
}
