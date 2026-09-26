// ═══ Redmine's words → this app's words ═══
//
// ## Nothing here is keyed by an id
//
// Redmine lets every installation define its own trackers, statuses and priorities, and
// a real one usually has: the ids are per-server and the names are usually translated —
// a Chinese Redmine has 缺陷 / 功能 / 支持 and 新建 / 进行中 / 已解决 / 已关闭. An
// `id === 5 ? 'bug' : 'task'` table would be wrong on every server but the one it was
// written against, and silently so.
//
// So the sync reads the server's own vocabulary from `/trackers.json`,
// `/issue_statuses.json` and `/enumerations/issue_priorities.json` — that is where an id
// comes from when one is genuinely needed. These tables only have to recognise a *name*,
// which is the one thing that means the same thing on two different servers, and they
// are keyed by the lowercased, trimmed display name.
//
// ## Every table ends in a fallback, and the fallbacks are chosen to be visible
//
// The design rule: an unrecognised value must degrade into a row the user can still see.
// A ticket in the wrong column is an annoyance; a ticket that lands in *no* column is
// work the user has lost without being told. That is why the fallbacks are `todo` and
// `task` and `medium` — the neutral, visible members of each vocabulary — and not
// `cancelled` or `email`, both of which this app filters out of every count, badge and
// list (see `taskScope.ts`).
//
// Zero runtime imports on purpose: these are pure functions over strings, and the only
// way to check a mapping table is to feed it values. Node cannot resolve the API's
// `./x.js` specifiers against `./x.ts` files, so an ordinary import here would make the
// file untestable in isolation — the type-only import below is erased at runtime and
// costs nothing.

import type { TaskStatus } from './taskScope.js';

/** The same normalisation for all three tables. Chinese and Japanese names are
 *  unaffected by `toLowerCase`; it is here for English ones and for safety. */
function key(name: string): string {
  return name.trim().toLowerCase();
}

const STATUS_BY_NAME: Record<string, TaskStatus> = {
  // Not yet started. `new` is Redmine's own default first status.
  new: 'todo',
  todo: 'todo',
  'to do': 'todo',
  open: 'todo',
  backlog: 'todo',
  新建: 'todo',
  新規: 'todo',
  未着手: 'todo',

  // Being worked on.
  'in progress': 'in_progress',
  'in-progress': 'in_progress',
  doing: 'in_progress',
  progress: 'in_progress',
  started: 'in_progress',
  进行中: 'in_progress',
  進行中: 'in_progress',
  対応中: 'in_progress',
  着手中: 'in_progress',

  // Finished by the assignee but not yet closed by the server. Redmine's stock
  // `Resolved` and `Feedback` both live here: in neither case is the ticket open work
  // in front of the user, and in neither case has the server said it is done.
  resolved: 'in_review',
  feedback: 'in_review',
  review: 'in_review',
  'in review': 'in_review',
  qa: 'in_review',
  testing: 'in_review',
  verified: 'in_review',
  已解决: 'in_review',
  反馈: 'in_review',
  审核: 'in_review',
  待审核: 'in_review',
  测试: 'in_review',
  テスト: 'in_review',
  解決済み: 'in_review',
  フィードバック: 'in_review',
  レビュー: 'in_review',
};

/**
 * A Redmine status → one of this app's four. Closure comes from the server, never from
 * the name.
 *
 * `is_closed` is checked **first and on its own**, and that ordering is the entire point
 * of this function. It is the only signal that survives an administrator renaming
 * "Closed" to "完了", translating the interface, or adding a status this table has never
 * seen. A name-based test for "closed" would put every closed ticket on a
 * non-English server back on the board as open work — and the ticket would look
 * perfectly normal while it did.
 *
 * **Rejected tickets map to `done`.** Redmine's stock `Rejected`/`却下` is a closed
 * status, so a ticket the team decided not to fix counts as a completed one and lifts
 * the completion rate. That is the consequence of the rule above, and it is deliberate:
 * the alternative is a fifth status this app has no column for, which is what made
 * cancelled tickets invisible in the first place (see `taskScope.ts`). If a user wants
 * rejected tickets gone, the place to do it is the fetch — a `status_id` filter that
 * reports how many it left out — not here, where the row would vanish from every count
 * and list while still occupying a row in the database.
 */
export function mapStatus(name: string, isClosed: boolean): TaskStatus {
  if (isClosed) return 'done';
  return STATUS_BY_NAME[key(name)] ?? 'todo';
}

const TYPE_BY_NAME: Record<string, string> = {
  bug: 'bug',
  defect: 'bug',
  error: 'bug',
  fault: 'bug',
  缺陷: 'bug',
  故障: 'bug',
  バグ: 'bug',

  story: 'story',
  feature: 'story',
  'user story': 'story',
  enhancement: 'story',
  需求: 'story',
  功能: 'story',
  故事: 'story',
  ストーリー: 'story',
  機能: 'story',
};

/**
 * A Redmine tracker → `task` / `bug` / `story`.
 *
 * The fallback is `task` and must never be `email`. `Issue.type === 'email'` marks a
 * message the Email panel mirrored in so that triage can link it to work;
 * `TASK_WHERE` excludes those from every task count and every list. A fallback of
 * `email` — the tempting one, since a Redmine tracker could plausibly be called
 * something like "Email" — would make every unrecognised ticket invisible in the task
 * board while still being present in the database, which is the failure mode
 * `taskScope.ts` exists to prevent.
 */
export function mapType(name: string): string {
  return TYPE_BY_NAME[key(name)] ?? 'task';
}

const PRIORITY_BY_NAME: Record<string, string> = {
  immediate: 'critical',
  urgent: 'critical',
  critical: 'critical',
  blocker: 'critical',
  立刻: 'critical',
  紧急: 'critical',
  緊急: 'critical',
  急いで: 'critical',

  high: 'high',
  major: 'high',
  高: 'high',
  高优先级: 'high',
  高優先: 'high',

  normal: 'medium',
  medium: 'medium',
  普通: 'medium',
  通常: 'medium',
  中: 'medium',

  low: 'low',
  minor: 'low',
  trivial: 'low',
  低: 'low',
  低优先级: 'low',
  低優先: 'low',
};

/**
 * A Redmine priority → `critical` / `high` / `medium` / `low`.
 *
 * The fallback is `medium`, which is what Redmine itself calls an unset priority
 * ("Normal"), so an unrecognised value lands where the server would have put it.
 */
export function mapPriority(name: string): string {
  return PRIORITY_BY_NAME[key(name)] ?? 'medium';
}
