import { prisma } from '@tomilite/database';
import { sendNotification } from '../notify';

// ═══ Meeting reminders ═══
//
// Two nudges, both driven by the same idea: a meeting is only worth recording if
// something happens afterwards, and the thing most likely to be forgotten is the
// thing nobody was assigned to remember.
//
//   1. an action item falls due tomorrow
//   2. a meeting ended N days ago and its action items are still open
//
// Both are delivered through the existing Windows toast channel (lib/notify.ts).
// Neither sends email — a reminder to send a follow-up is a reminder, not a send.
//
// Dedupe is stored on the row that triggered it (`remindedAt` / `followUpAt`)
// rather than in memory, so restarting the app never re-notifies something the
// user already saw.

/** Same SystemConfig blob the Settings → Meetings tab writes. */
const CONFIG_KEY = 'meeting.defaults';
/** How many first-run notifications to emit per sweep, so an install upgrading
 *  with months of history gets a trickle rather than a wall. */
const MAX_PER_SWEEP = 3;

interface MeetingDefaults {
  remindersEnabled?: boolean;
  followUpReminderDays?: number;
}

interface ReminderText {
  dueTitle: string;
  dueBody: (n: number, meeting: string) => string;
  reviewTitle: string;
  reviewBody: (n: number, meeting: string) => string;
}

const TEXT: Record<string, ReminderText> = {
  en: {
    dueTitle: 'Action item due tomorrow',
    dueBody: (n, meeting) =>
      `${n} action item${n > 1 ? 's' : ''} from "${meeting}" ${n > 1 ? 'are' : 'is'} due tomorrow.`,
    reviewTitle: 'Meeting follow-up',
    reviewBody: (n, meeting) =>
      `"${meeting}" still has ${n} open action item${n > 1 ? 's' : ''}. Review and send the follow-up.`,
  },
  zh: {
    dueTitle: '行动项明天到期',
    dueBody: (n, meeting) => `「${meeting}」有 ${n} 个行动项明天到期。`,
    reviewTitle: '会议跟进',
    reviewBody: (n, meeting) => `「${meeting}」还有 ${n} 个未处理的行动项，去确认并发一下跟进邮件。`,
  },
  ja: {
    dueTitle: 'アクションアイテムの期限は明日です',
    dueBody: (n, meeting) => `「${meeting}」のアクションアイテム ${n} 件が明日締め切られます。`,
    reviewTitle: '会議のフォローアップ',
    reviewBody: (n, meeting) =>
      `「${meeting}」に未対応のアクションアイテムが ${n} 件あります。確認してフォローアップを送りましょう。`,
  },
};

/**
 * Local-time date helpers.
 *
 * `dueDate` and `createdAt` are stored as local-time strings ('YYYY-MM-DD' and
 * 'YYYY-MM-DD HH:MM:SS'), so everything here compares those strings directly.
 * Going through `new Date()` would reintroduce a timezone offset that the
 * storage format deliberately does not have — and "tomorrow" is exactly the
 * comparison where being one day off is the whole bug.
 */
function localDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function localDateTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${localDate(d)} ${h}:${min}:${s}`;
}

/** Action items whose dueDate is tomorrow and that nobody has been told about. */
async function remindDueTomorrow(t: ReminderText): Promise<number> {
  const tomorrow = localDate(new Date(Date.now() + 86_400_000));

  const items = await prisma.meetingActionItem.findMany({
    where: {
      status: 'open',
      remindedAt: null,
      dueDate: tomorrow,
      meeting: { archived: false },
    },
    select: { id: true, meeting: { select: { title: true } } },
  });
  if (!items.length) return 0;

  // One notification per meeting rather than per item: three items due tomorrow
  // from the same meeting is one thing to know, not three.
  const byMeeting = new Map<string, { title: string; ids: string[] }>();
  for (const it of items) {
    const entry = byMeeting.get(it.meeting.title) || { title: it.meeting.title, ids: [] };
    entry.ids.push(it.id);
    byMeeting.set(it.meeting.title, entry);
  }

  let sent = 0;
  for (const { title, ids } of byMeeting.values()) {
    if (sent >= MAX_PER_SWEEP) break;
    await sendNotification(t.dueTitle, t.dueBody(ids.length, title));
    // Mark after a successful send — a notification host that is not running
    // (headless API) swallows the error, and re-trying next sweep is the correct
    // behaviour in that case anyway.
    await prisma.meetingActionItem.updateMany({
      where: { id: { in: ids } },
      data: { remindedAt: localDateTime(new Date()) },
    });
    sent++;
  }
  return sent;
}

/** Meetings old enough to review, still carrying open action items. */
async function remindPostMeeting(t: ReminderText, days: number): Promise<number> {
  const cutoff = localDateTime(new Date(Date.now() - Math.max(1, days) * 86_400_000));

  const meetings = await prisma.meeting.findMany({
    where: {
      aiStatus: 'done',
      archived: false,
      followUpAt: null,
      createdAt: { lt: cutoff },
      // A dismissed draft is an explicit "stop asking me about this one".
      followUpStatus: { not: 'dismissed' },
      actionItems: { some: { status: 'open' } },
    },
    select: { id: true, title: true },
    orderBy: { createdAt: 'asc' },
    take: MAX_PER_SWEEP,
  });

  let sent = 0;
  for (const m of meetings) {
    const open = await prisma.meetingActionItem.count({ where: { meetingId: m.id, status: 'open' } });
    if (!open) continue;
    await sendNotification(t.reviewTitle, t.reviewBody(open, m.title));
    await prisma.meeting.update({ where: { id: m.id }, data: { followUpAt: localDateTime(new Date()) } });
    sent++;
  }
  return sent;
}

/**
 * One sweep. Called every 60s from startBackgroundTasks(), same cadence as the
 * standup checks — cheap enough that the exact interval does not matter, and
 * frequent enough that a reminder is not perceptibly late.
 *
 * Never throws: a background interval that rejects takes down the process.
 */
export async function checkMeetingReminders(): Promise<void> {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    let defaults: MeetingDefaults = {};
    try {
      defaults = JSON.parse(cfg?.value || '{}');
    } catch {
      /* unreadable config falls back to the defaults below */
    }
    // Opt-out, and default-on: the reminder is the feature the user asked for by
    // recording a meeting with action items.
    if (defaults.remindersEnabled === false) return;

    const langCfg = await prisma.systemConfig.findUnique({ where: { key: 'uiLanguage' } });
    const t = TEXT[langCfg?.value || 'en'] || TEXT.en;

    const due = await remindDueTomorrow(t);
    const review = await remindPostMeeting(t, defaults.followUpReminderDays ?? 3);
    if (due || review) console.warn(`[Meeting] Reminders sent: ${due} due-date, ${review} follow-up`);
  } catch (e: unknown) {
    console.error('[Meeting] Reminder sweep failed:', e instanceof Error ? e.message : e);
  }
}
