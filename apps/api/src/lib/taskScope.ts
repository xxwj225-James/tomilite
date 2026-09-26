// ═══ What counts as a task ═══
//
// Every "how many tasks" number in the app has to answer this the same way — the
// Home cards, the task board's tab badges, the MCP stat tool the agent calls, the
// context handed to the knowledge-map prompt. It used to be answered six different
// ways, in six files, and the user-visible symptom was the Home card and the board
// disagreeing about how many tasks exist.
//
// Two kinds of Issue row are not tasks, and each was counted by some callers and
// not others:
//
//   `type: 'email'` — Emails the Email panel mirrors into the Issue table so that
//     triage can link a message to a task. The subject becomes the title and is
//     prefixed with an inbox emoji. They are mailbox items, not work. Counting them
//     made the Home card report newsletters as open tasks, and made the AI health
//     summary tell the user "you have completed 63 tasks" over that same set.
//
//   `status: 'cancelled'` — A terminal status the board has no column for and the
//     task editor does not offer; only the agent sets it. One caller folded every
//     status it did not recognise into "in progress", so a cancelled task was
//     counted in the board's In Progress badge and then filtered out of the list
//     underneath it.
//
// A task is therefore: not an email, and in one of the four statuses that have a
// place to live. Callers that need a count should come through here rather than
// re-deriving it — the divergence is what caused the bug, not any one filter.

export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The four statuses that have somewhere to be shown, keyed for bucketing. */
export function statusBucket(status: string | null | undefined): TaskStatus | null {
  return (TASK_STATUSES as readonly string[]).includes(status ?? '') ? (status as TaskStatus) : null;
}

export function isTask(issue: { type?: string | null; status?: string | null }): boolean {
  return issue.type !== 'email' && statusBucket(issue.status) !== null;
}

/**
 * The same rule, as a Prisma `where`, for callers that must count in SQL rather
 * than in JS — a badge must not be counted over a truncated page of rows.
 *
 * This exists so the rule still lives in exactly one file. Spreading `type: { not:
 * 'email' }` and the four statuses by hand is how the divergence happened the
 * first time.
 */
export const TASK_WHERE = {
  type: { not: 'email' },
  status: { in: [...TASK_STATUSES] },
};

// ═══ Where a task came from — a second, separate question ═══
//
// `isTask` answers "is this a task". This answers "may this app write to it", and the
// two are deliberately not folded together: a mirrored Redmine issue IS a task and is
// counted by every counter above (nothing here excludes it), but it is a copy of a
// row someone else owns, so the next sync overwrites any local edit. Every counter
// that means "the user's work" therefore counts it — that is the intended behaviour,
// not an oversight — while every *writer* has to refuse it.
//
// `source` is NULL for every row this app writes. That is not a convention invented
// here: it is what the v26 migration left on every existing row, and what the hourly
// archiver's `source: null` predicate depends on.

/** A row mirrored from an external system. Read-only locally. */
export function isImported(issue: { source?: string | null }): boolean {
  return !!issue.source;
}

/**
 * The number a person reads. A mirrored row shows its own tracker's number (`#1234`),
 * because that is the number its commits, its emails and its colleagues use — showing
 * `TL-437` for Redmine #1234 would leave the real number only in the body's
 * provenance line. Local rows keep `TL-n`.
 *
 * Deliberately NOT solved by setting `issueNumber` to the tracker's id: `issueNumber`
 * has no unique constraint, three code paths already treat `(projectId, issueNumber)`
 * as an identity, and the local `max + 1` sequence would eventually reach an imported
 * id — from which point two rows share a number and `findFirst` picks arbitrarily.
 *
 * Duplicated in apps/web/src/lib/issueKey.ts; the web bundle cannot import from here.
 * Same arrangement as lib/dbTime.ts.
 */
export function issueKey(i: { issueNumber: number; source?: string | null; sourceId?: string | null }): string {
  return i.source === 'redmine' && i.sourceId ? '#' + i.sourceId : 'TL-' + i.issueNumber;
}
