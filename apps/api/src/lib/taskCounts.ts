// ═══ How many tasks, in each status that has a place to live ═══
//
// `lib/taskScope.ts` decides *which* rows are tasks; this counts the ones it accepts, in
// the four buckets the board has tabs for. It lives here rather than in the procedure
// that first needed it because a second caller re-deriving it is exactly how the Home
// card and the board came to disagree about how many tasks exist — the bug taskScope.ts
// was written to end. Today `issue.taskCounts` is the only caller, so the board's tab
// badges and anything else that asks are the same number by construction. (The knowledge
// map's project pulse was the second caller and has been removed; it printed whole-project
// statistics under a tree of notes, which is not what that card is for.)
//
// Four bounded COUNTs rather than a `groupBy`, for the reason the procedure gave before
// this moved: `inProgress` is two statuses folded into one bucket, and a group-by would
// hand that fold back to every caller to perform again. SQLite answers each of these from
// the `(projectId, status)` index.
//
// Not used by `health.taskStats`, which loads the rows anyway for its byPriority and
// byType breakdowns and counts them in the same pass.

import { prisma } from '@tomilite/database';
import { TASK_STATUSES, TASK_WHERE } from './taskScope.js';

export interface TaskCounts {
  /** The sum of the four statuses — the same number the board's badges add up to. */
  total: number;
  todo: number;
  /** `in_progress` and `in_review` together: one column on the board, one number here. */
  inProgress: number;
  done: number;
}

export async function taskCounts(projectId: string): Promise<TaskCounts> {
  const base = { projectId, ...TASK_WHERE };
  const counts = await Promise.all(TASK_STATUSES.map((s) => prisma.issue.count({ where: { ...base, status: s } })));
  const [todo, inProgress, inReview, done] = counts;
  return { total: counts.reduce((a, b) => a + b, 0), todo, inProgress: inProgress + inReview, done };
}
