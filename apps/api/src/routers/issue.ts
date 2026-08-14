import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';

export const issueRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return prisma.issue.findMany({
        where: { projectId: input.projectId },
        orderBy: [{ updatedAt: 'desc' }],
        take: 200,
      });
    }),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return prisma.issue.findUnique({
        where: { id: input.id },
        include: { comments: { orderBy: { createdAt: 'asc' } } },
      });
    }),

  create: publicProcedure
    .input(z.object({
      projectId: z.string(),
      title: z.string().min(1),
      description: z.string().optional(),
      type: z.string().default('task'),
      priority: z.string().default('medium'),
      parentId: z.string().optional(),
      storyPoints: z.number().optional(),
      dueDate: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const maxNum = await prisma.issue.aggregate({
        where: { projectId: input.projectId },
        _max: { issueNumber: true },
      });
      return prisma.issue.create({
        data: {
          ...input,
          issueNumber: (maxNum._max.issueNumber ?? 0) + 1,
          status: 'todo',
          sortOrder: 0,
        },
      });
    }),

  update: publicProcedure
    .input(z.object({
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
    }))
    .mutation(async ({ input }) => {
      const { id, issueNumber, projectId, ...data } = input;
      let issue;
      if (id) {
        issue = await prisma.issue.findUnique({ where: { id } });
      } else if (issueNumber) {
        issue = await prisma.issue.findFirst({ where: { projectId: projectId || 'proj-default', issueNumber } });
      }
      if (!issue) throw new Error('Issue not found');

      // Auto-set remainingPoints to 0 when status → done
      if (data.status && (data.status === 'done' || data.status === 'cancelled')) {
        data.remainingPoints = 0;
      }
      // Always bump updatedAt on any update
      (data as any).updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
      return prisma.issue.update({ where: { id: issue.id }, data });
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      // Schema cascade: onDelete Cascade (boardCard, comment, changelog) + SetNull (gitRef, smartEmail, child issues)
      return prisma.issue.delete({ where: { id: input.id } });
    }),

  children: publicProcedure
    .input(z.object({ parentId: z.string() }))
    .query(async ({ input }) => {
      return prisma.issue.findMany({
        where: { parentId: input.parentId },
        orderBy: [{ updatedAt: 'desc' }],
      });
    }),

  updateRank: publicProcedure
    .input(z.object({
      id: z.string(),
      beforeId: z.string().optional(),
      afterId: z.string().optional(),
    }))
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
