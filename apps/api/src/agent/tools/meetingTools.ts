import { prisma } from '@tomilite/database';
import { DEFAULT_PROJECT_ID } from '../utils/constants.js';

/**
 * Read-only views over the Meeting panel's data, so the agent can answer questions
 * about meetings at all — before this there was no meeting tool of any kind, and the
 * agent's only route to "what does the meeting feature do" was reading source files.
 *
 * Nothing here writes, sends or deletes: the panel owns the recording lifecycle, and
 * a follow-up draft stays a draft until the user sends it (lib/meeting/pipeline.ts).
 */

/** Transcript is the one field big enough to blow up a turn's context, so it is opt-in. */
const TRANSCRIPT_LIMIT = 6000;
/** Minutes are a full markdown document; the model rarely needs all of it verbatim. */
const MINUTES_LIMIT = 4000;
/** Enough of the follow-up draft to judge it, not enough to crowd out the rest. */
const FOLLOWUP_LIMIT = 1500;
const SUMMARY_SNIPPET = 240;

/**
 * `durationMs` is the only duration on the row. Minutes alone rounds a 4-second
 * test recording to `0`, which reads as "no data" — so seconds come too, and
 * minutes keep one decimal instead of rounding four minutes down to nothing.
 */
const durations = (ms: number) => ({
  durationSeconds: Math.round(ms / 1000),
  durationMinutes: Number((ms / 60_000).toFixed(1)),
});

/**
 * What the panel shows, and therefore what the model sees. Deliberately excludes
 * `chunkSummaries`, `speakers`, `stageLog` and the legacy `decisions` JSON column:
 * they are pipeline internals, and context is the scarce resource in a turn.
 *
 * `whisperModel` and `transcribeModel` are excluded for the same reason: neither is
 * shown to the user. The first is always `base`, the second is a diagnostic record.
 */
const MEETING_FIELDS = {
  id: true,
  title: true,
  status: true,
  createdAt: true,
  durationMs: true,
  lang: true,
  transcribeStatus: true,
  aiStatus: true,
  minutesStatus: true,
  followUpStatus: true,
  retentionDays: true,
  audioDeletedAt: true,
} as const;

const DETAIL_FIELDS = {
  ...MEETING_FIELDS,
  summary: true,
  minutes: true,
  transcript: true,
  audioFile: true,
  consentAcknowledgedAt: true,
  followUpSubject: true,
  followUpBody: true,
} as const;

/** List meetings, newest first. Summary snippet and counts only — use get_meeting for detail. */
export async function listMeetings(args: Record<string, any>): Promise<unknown> {
  const where: any = { projectId: DEFAULT_PROJECT_ID };
  if (args.includeArchived !== true) where.archived = false;
  if (args.status) where.status = String(args.status);
  if (args.query) where.title = { contains: String(args.query) };

  const take = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
  const rows = await prisma.meeting.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      ...MEETING_FIELDS,
      summary: true,
      actionItems: { select: { status: true } },
      _count: { select: { segments: true, decisionItems: true } },
    },
  });

  return {
    count: rows.length,
    meetings: rows.map((m) => ({
      ...m,
      ...durations(m.durationMs),
      summarySnippet: (m.summary || '').substring(0, SUMMARY_SNIPPET),
      segmentCount: m._count.segments,
      decisionCount: m._count.decisionItems,
      openActionItems: m.actionItems.filter((a) => a.status === 'open').length,
      _count: undefined,
      actionItems: undefined,
    })),
  };
}

/** Read one meeting: decisions with their rationale, action items, minutes, follow-up draft. */
export async function getMeeting(args: Record<string, any>): Promise<unknown> {
  const id = String(args.id || '').trim();
  const title = String(args.title || args.query || '').trim();
  if (!id && !title) return { error: 'Pass an id (from list_meetings) or a title fragment.' };

  const meeting = id
    ? await prisma.meeting.findUnique({ where: { id }, select: DETAIL_FIELDS })
    : await prisma.meeting.findFirst({
        where: { projectId: DEFAULT_PROJECT_ID, title: { contains: title } },
        orderBy: { createdAt: 'desc' },
        select: DETAIL_FIELDS,
      });
  if (!meeting) return { error: id ? `Meeting not found: ${id}` : `No meeting matching "${title}"` };

  const [decisions, actionItems, segmentCount] = await Promise.all([
    prisma.meetingDecision.findMany({ where: { meetingId: meeting.id }, orderBy: { idx: 'asc' } }),
    prisma.meetingActionItem.findMany({ where: { meetingId: meeting.id }, orderBy: { idx: 'asc' } }),
    prisma.meetingSegment.count({ where: { meetingId: meeting.id } }),
  ]);

  // The long fields are returned at the top level; `meta` is the rest of the row.
  const { summary, minutes: minutesMd, transcript, audioFile, followUpSubject, followUpBody, ...meta } = meeting;

  return {
    meeting: {
      ...meta,
      id: meeting.id,
      title: meeting.title,
      ...durations(meeting.durationMs),
      segmentCount,
      hasAudio: !!audioFile && !meeting.audioDeletedAt,
    },
    summary: summary || '',
    // Dismissed rows are kept (a regenerate must not resurrect what the user threw
    // away), so they carry their status here instead of being filtered out.
    decisions: decisions.map((d) => ({
      text: d.text,
      rationale: d.rationale,
      decidedAt: d.decidedAt,
      status: d.status,
    })),
    actionItems: actionItems.map((a) => ({
      text: a.text,
      owner: a.owner,
      dueDate: a.dueDate,
      priority: a.priority,
      status: a.status,
      linkedTask: a.issueId || null,
    })),
    minutes: (minutesMd || '').substring(0, MINUTES_LIMIT),
    minutesTruncated: (minutesMd || '').length > MINUTES_LIMIT,
    // A draft the user reviews and sends — nothing in TomiLite ever sends it for them.
    followUp: followUpSubject
      ? {
          subject: followUpSubject,
          body: (followUpBody || '').substring(0, FOLLOWUP_LIMIT),
          status: meeting.followUpStatus,
        }
      : null,
    transcript: args.includeTranscript === true ? (transcript || '').substring(0, TRANSCRIPT_LIMIT) : undefined,
    transcriptTruncated: args.includeTranscript === true && (transcript || '').length > TRANSCRIPT_LIMIT,
  };
}
