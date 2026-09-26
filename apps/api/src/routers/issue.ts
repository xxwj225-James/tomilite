import { TRPCError } from '@trpc/server';
import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { utcStamp } from '../lib/dbTime.js';
import { TASK_WHERE, isImported } from '../lib/taskScope.js';
import { taskCounts } from '../lib/taskCounts.js';

export const issueRouter = router({
  /**
   * Rows for the task board, capped.
   *
   * The cap is the reason `taskCounts` below exists: the board's tab badges must
   * never be counted over this page. The rule the board draws by is applied here,
   * in SQL, rather than left to the caller — so `take: 200` means two hundred
   * *tasks*. It used to mean two hundred rows and the board would then drop the
   * emails, which are 34 of them and grow on every mail sync; every one of those
   * was a slot stolen from the task list.
   */
  list: publicProcedure.input(z.object({ projectId: z.string() })).query(async ({ input }) => {
    return prisma.issue.findMany({
      where: { projectId: input.projectId, ...TASK_WHERE },
      // `source` first, and it is load-bearing rather than cosmetic. SQLite sorts NULL
      // before any non-null value in ASC, and NULL source is exactly "this app wrote
      // it", so the user's own rows always win the 200 slots below and mirrored rows
      // take whatever is left. Without it, syncing 400 issues (whose `updatedAt` is
      // fresh enough to sort first) would fill this page entirely and a tab could
      // render zero rows while its badge — counted in SQL over the whole set — said 37.
      // The user's own tasks would not be truncated, they would be absent.
      orderBy: [{ source: 'asc' }, { updatedAt: 'desc' }],
      take: 200,
    });
  }),

  /**
   * The board's tab badges, counted over the whole set in SQL.
   *
   * `total` is the sum of the four statuses, so it is the same number as the Home
   * card's 总计 — both go through lib/taskScope.ts. Counting the loaded page
   * instead would silently under-report the moment the table outgrew `take`, which
   * is exactly the Home-card-versus-board disagreement taskScope.ts was written to
   * end.
   *
   * The counting itself moved to `lib/taskCounts.ts` when a second screen needed the same
   * four numbers: a second copy here is how that disagreement started. Identical
   * arithmetic, same query shape — four bounded COUNTs over `(projectId, status)`.
   */
  taskCounts: publicProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => taskCounts(input.projectId)),

  byId: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    return prisma.issue.findUnique({
      where: { id: input.id },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
  }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        type: z.string().default('task'),
        priority: z.string().default('medium'),
        parentId: z.string().optional(),
        storyPoints: z.number().optional(),
        dueDate: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const now = utcStamp();
      // The `max` read and the insert share one transaction, and that is not tidiness.
      // `issueNumber` has no unique constraint (the only index here is
      // `(projectId, status)`), while three code paths already treat
      // `(projectId, issueNumber)` as an identity — so a collision is not a rejected
      // insert, it is two rows sharing a number with `findFirst` picking one arbitrarily.
      // Reading the max outside the transaction left a window exactly as wide as a
      // Redmine sync inserting several hundred rows: this call reads the pre-sync max,
      // the sync commits past it, and both insert the same number.
      return prisma.$transaction(async (tx) => {
        const maxNum = await tx.issue.aggregate({
          where: { projectId: input.projectId },
          _max: { issueNumber: true },
        });
        return tx.issue.create({
          data: {
            ...input,
            issueNumber: (maxNum._max.issueNumber ?? 0) + 1,
            status: 'todo',
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
        });
      });
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().optional(),
        issueNumber: z.number().optional(),
        projectId: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        type: z.string().optional(),
        assignee: z.string().optional(),
        storyPoints: z.number().optional(),
        remainingPoints: z.number().optional(),
        labels: z.string().optional(),
        sprintId: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, issueNumber, projectId, ...data } = input;
      let issue;
      if (id) {
        issue = await prisma.issue.findUnique({ where: { id } });
      } else if (issueNumber) {
        issue = await prisma.issue.findFirst({ where: { projectId: projectId || 'proj-default', issueNumber } });
      }
      if (!issue) throw new Error('Issue not found');
      // A mirrored row is a copy of someone else's tracker, and this is one of four
      // write paths that could desynchronise it (the agent's updateIssue, the MCP
      // server's separate update_issue, and the git commit scanner's auto-close are
      // the others). Editing it here would be silently undone by the next sync, so
      // it is refused with the reason instead of accepted and reverted.
      if (isImported(issue)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Mirrored from an external tracker — read-only here' });
      }

      // Auto-set remainingPoints to 0 when status → done
      if (data.status && (data.status === 'done' || data.status === 'cancelled')) {
        data.remainingPoints = 0;
      }
      // Always bump updatedAt on any update
      (data as any).updatedAt = utcStamp();
      return prisma.issue.update({ where: { id: issue.id }, data });
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const issue = await prisma.issue.findUnique({ where: { id: input.id } });
    if (!issue) return { ok: false, error: 'not-found' } as const;
    // Deleting it would not stick: the next sync sees the ticket is still inside the
    // cursor window and re-creates it. `detach` below is the honest way out.
    if (isImported(issue)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Mirrored from an external tracker — detach it instead' });
    }
    // Schema cascade: onDelete Cascade (boardCard, comment, changelog) + SetNull (gitRef, smartEmail, child issues)
    await prisma.issue.delete({ where: { id: input.id } });
    return { ok: true } as const;
  }),

  /**
   * Turn a mirrored row into an ordinary local task, so it can be edited and deleted
   * like anything else. This is the only escape hatch from the read-only rule, and
   * without it a user who wants 50 noisy mirrored tickets gone has no move at all —
   * they come back on every sync, forever.
   *
   * Both columns are cleared, which means a later sync WILL re-create the row if the
   * ticket is still inside the cursor window. That is deliberate: keeping `sourceId`
   * would make detach permanent, but at the cost of a row that is half-attached —
   * still carrying a tracker's identity while the sync no longer recognises it. The
   * UI says it can come back rather than leaving the user to discover it.
   */
  detach: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const issue = await prisma.issue.findUnique({ where: { id: input.id } });
    if (!issue) return { ok: false, error: 'not-found' } as const;
    if (!isImported(issue)) return { ok: true } as const; // already local — nothing to do
    await prisma.issue.update({
      where: { id: input.id },
      data: { source: null, sourceId: null, updatedAt: utcStamp() },
    });
    return { ok: true } as const;
  }),

  children: publicProcedure.input(z.object({ parentId: z.string() })).query(async ({ input }) => {
    return prisma.issue.findMany({
      where: { parentId: input.parentId },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }),

  updateRank: publicProcedure
    .input(
      z.object({
        id: z.string(),
        beforeId: z.string().optional(),
        afterId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const issue = await prisma.issue.findUnique({ where: { id: input.id } });
      if (!issue) throw new Error('Issue not found');

      let newRank: number;
      if (input.beforeId && input.afterId) {
        const before = await prisma.issue.findUnique({ where: { id: input.beforeId } });
        const after = await prisma.issue.findUnique({ where: { id: input.afterId } });
        newRank = ((before?.sortOrder ?? 0) + (after?.sortOrder ?? 0)) / 2;
      } else if (input.beforeId) {
        const before = await prisma.issue.findUnique({ where: { id: input.beforeId } });
        newRank = (before?.sortOrder ?? 0) - 1.0;
      } else if (input.afterId) {
        const after = await prisma.issue.findUnique({ where: { id: input.afterId } });
        newRank = (after?.sortOrder ?? 0) + 1.0;
      } else {
        throw new Error('beforeId or afterId required');
      }

      return prisma.issue.update({ where: { id: input.id }, data: { sortOrder: newRank } });
    }),
});
