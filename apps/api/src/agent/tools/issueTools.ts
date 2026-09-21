import { prisma } from '@tomilite/database';
import { utcStamp } from '../../lib/dbTime.js';
import { TASK_STATUSES, TASK_WHERE } from '../../lib/taskScope.js';
import { DEFAULT_PROJECT_ID } from '../utils/constants.js';

/**
 * Get project statistics — todo/in-progress/done counts.
 *
 * Counted over the task set, not over the table: `type: 'email'` rows are the
 * mailbox items the Email panel mirrors into `Issue`, and `cancelled` has no
 * column on the board. Counting the raw table made the agent answer "144 tasks,
 * 63 done" to a user whose Home card said 109 and 54 — the same set, two numbers.
 * `in_review` folds into `inProgress` as it does everywhere else. See
 * lib/taskScope.ts.
 */
export async function getStats(): Promise<{ total: number; todo: number; inProgress: number; done: number }> {
  const base = { projectId: DEFAULT_PROJECT_ID, ...TASK_WHERE };
  const counts = await Promise.all(TASK_STATUSES.map((s) => prisma.issue.count({ where: { ...base, status: s } })));
  const [todo, inProgress, inReview, done] = counts;
  return { total: counts.reduce((a, b) => a + b, 0), todo, inProgress: inProgress + inReview, done };
}

/**
 * List issues, optionally filtered by status.
 *
 * Narrowed to the task set. `getStats` above always was, and this was the one caller
 * left counting the raw table: asked to list what is on the user's plate it returned
 * the `type: 'email'` rows the Email panel mirrors into `Issue`, so incoming mail was
 * reported as work. Email is its own thing now, with its own tools reading
 * `SmartEmail` — nothing needs those rows here.
 *
 * `TASK_WHERE` is spread first so the explicit status can override its four-status
 * union: a caller asking for `in_review` means those rows, not the union plus a filter.
 * The type clause has no such override and always applies.
 */
export async function listIssues(
  args: Record<string, any>,
): Promise<Array<{ key: string; title: string; status: string; priority: string }>> {
  const issues = await prisma.issue.findMany({
    where: { projectId: DEFAULT_PROJECT_ID, ...TASK_WHERE, ...(args.status ? { status: args.status } : {}) },
    orderBy: { issueNumber: 'desc' },
    take: args.limit || 10,
  });
  return issues.map((i) => ({ key: `TL-${i.issueNumber}`, title: i.title, status: i.status, priority: i.priority }));
}

/** Create a task/bug/story. Handles both create_issue (goes through dedup) and force_create_issue (skips dedup). */
export async function createIssue(
  args: Record<string, any>,
): Promise<
  | { id: string; key: string; title: string; type: string; priority: string; status: string; description: string }
  | { error: string }
> {
  if (!args.title) return { error: 'Missing title.' };
  if (!args.description || args.description.trim().length < 10)
    return {
      error:
        'Missing or too short description. Provide a detailed description — what the task is about, why it matters, any context needed.',
    };
  const VALID_TYPES = ['task', 'bug', 'story'];
  const issueType = VALID_TYPES.includes(args.type) ? args.type : 'task';
  const maxNum = await prisma.issue.aggregate({
    where: { projectId: DEFAULT_PROJECT_ID },
    _max: { issueNumber: true },
  });
  const now = utcStamp();
  const issue = await prisma.issue.create({
    data: {
      projectId: DEFAULT_PROJECT_ID,
      issueNumber: (maxNum._max.issueNumber ?? 0) + 1,
      title: args.title,
      type: issueType,
      priority: args.priority || 'medium',
      description: args.description || null,
      storyPoints: args.storyPoints || null,
      status: 'todo',
      createdAt: now,
      updatedAt: now,
    },
  });
  return {
    id: issue.id,
    key: `TL-${issue.issueNumber}`,
    title: issue.title,
    type: issue.type,
    priority: issue.priority,
    status: 'todo',
    description: issue.description || '',
  };
}

/** Get issue by number (e.g. 3 for TL-3) or search by title keyword */
export async function getIssue(args: Record<string, any>): Promise<any> {
  if (args.issueNumber) {
    const issue = await prisma.issue.findFirst({
      where: { projectId: DEFAULT_PROJECT_ID, issueNumber: args.issueNumber },
    });
    if (!issue) return { error: `Issue TL-${args.issueNumber} not found` };
    return {
      key: `TL-${issue.issueNumber}`,
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      type: issue.type,
      description: (issue.description || '').substring(0, 500),
      storyPoints: issue.storyPoints,
      dueDate: issue.dueDate,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
  }
  if (args.query) {
    const issues = await prisma.issue.findMany({
      where: { projectId: DEFAULT_PROJECT_ID, title: { contains: args.query } },
      orderBy: { createdAt: 'desc' },
      take: args.limit || 5,
    });
    return issues.map((i) => ({
      key: `TL-${i.issueNumber}`,
      title: i.title,
      status: i.status,
      priority: i.priority,
      type: i.type,
      dueDate: i.dueDate,
    }));
  }
  return { error: 'Provide issueNumber or query' };
}

/** Update an issue by issue number */
export async function updateIssue(
  args: Record<string, any>,
): Promise<{ key: string; updated: boolean } | { error: string }> {
  const issue = await prisma.issue.findFirst({
    where: { projectId: DEFAULT_PROJECT_ID, issueNumber: args.issueNumber },
  });
  if (!issue) return { error: `Issue TL-${args.issueNumber} not found` };
  const data: any = {};
  if (args.title) data.title = args.title;
  if (args.status) data.status = args.status;
  if (args.priority) data.priority = args.priority;
  if (args.description !== undefined) {
    const existing = issue.description || '';
    const append = args.append !== false; // default true
    if (append && existing) {
      const now = utcStamp();
      data.description = existing + '\n\n---\n📝 **Updated ' + now + '**\n' + args.description;
    } else {
      data.description = args.description;
    }
  }
  data.updatedAt = utcStamp();
  await prisma.issue.update({ where: { id: issue.id }, data });
  return { key: `TL-${issue.issueNumber}`, updated: true };
}

/** Fill the task editor form. Does NOT save to DB. */
export function suggestIssueEdit(args: Record<string, any>): any {
  return {
    staged: true,
    title: args.title?.substring(0, 80),
    description: args.description?.substring(0, 2000),
    status: args.status,
    priority: args.priority,
    storyPoints: args.storyPoints,
    type: 'task',
    _full: {
      title: args.title || '',
      description: args.description || '',
      status: args.status || 'todo',
      priority: args.priority || 'medium',
      storyPoints: args.storyPoints ?? 0,
    },
  };
}
