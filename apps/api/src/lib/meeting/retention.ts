import { prisma } from '@tomilite/database';
import { deleteAudio } from './audioFile.js';

// ═══ Meeting audio retention ═══
//
// The panel has shown "audio will be deleted in N days" (`audioExpiresAt` in
// routers/meeting.ts) since the field existed, but nothing ever deleted
// anything — the promise was display-only. This is the job that acts on it.
//
// Only the audio goes. The transcript, summary, decisions, minutes and action
// items stay: they are what the meeting is worth afterwards, they are small,
// and removing them is what the explicit delete button is for. Audio is the
// part that is large and the part that is sensitive — a room full of people
// talking — so it is the part with a deadline.

/** Rows per sweep. Deleting a WAV is a couple of milliseconds; the bound is
 *  there so a first run on years of history cannot stall the event loop. */
const MAX_PER_SWEEP = 25;

/** Local-time stamp, matching how `createdAt` and `audioDeletedAt` are stored
 *  (SQLite `datetime('now','localtime')`). Same shape as reminders.ts. */
function localDateTime(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day} ${h}:${min}:${sec}`;
}

/**
 * Delete audio for every meeting past its retention window.
 *
 * The cutoff is computed as a local-time string so it can be compared directly
 * against `createdAt`, and by the same day arithmetic the UI uses to display
 * `audioExpiresAt` — otherwise the panel would promise a date the sweep does
 * not keep.
 *
 * Never throws: this runs from a background timer, and a rejecting interval
 * takes the process down.
 */
export async function sweepMeetingAudioRetention(): Promise<number> {
  try {
    const now = Date.now();

    const expired = await prisma.meeting.findMany({
      where: {
        // 0 means keep the audio forever — an explicit choice the user makes in
        // Settings, so it must not be swept by a `gt: 0` off-by-one.
        retentionDays: { gt: 0 },
        // Idempotent: a swept row keeps its stamp, so it never comes back.
        audioDeletedAt: null,
        // A recording in progress is still writing this file, and a queued or
        // running transcription is still reading it. Both are short-lived; the
        // next sweep catches them.
        status: { not: 'recording' },
        transcribeStatus: { notIn: ['queued', 'running'] },
      },
      select: { id: true, title: true, createdAt: true, retentionDays: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_PER_SWEEP * 4,
    });
    if (!expired.length) return 0;

    let deleted = 0;
    for (const m of expired) {
      if (deleted >= MAX_PER_SWEEP) break;
      const cutoff = localDateTime(new Date(now - m.retentionDays * 86_400_000));
      // `createdAt` is 'YYYY-MM-DD HH:MM:SS', so string `<` is chronological.
      if (!(m.createdAt < cutoff)) continue;

      deleteAudio(m.id);
      await prisma.meeting.update({ where: { id: m.id }, data: { audioDeletedAt: localDateTime(new Date()) } });
      deleted++;
    }

    if (deleted) console.warn(`[Meeting] Retention: deleted audio for ${deleted} meeting(s) past their window`);
    return deleted;
  } catch (e: unknown) {
    console.error('[Meeting] Retention sweep failed:', e instanceof Error ? e.message : e);
    return 0;
  }
}
