import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';

export const feedbackRouter = router({
  list: publicProcedure.query(async () => {
    return prisma.feedbackItem.findMany({ orderBy: { createdAt: 'desc' } });
  }),

  create: publicProcedure
    .input(z.object({
      type: z.enum(['bug', 'feature', 'general']),
      title: z.string().min(1),
      body: z.string().min(1),
      email: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return prisma.feedbackItem.create({ data: input });
    }),

  updateStatus: publicProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(['open', 'acknowledged', 'closed']),
    }))
    .mutation(async ({ input }) => {
      return prisma.feedbackItem.update({ where: { id: input.id }, data: { status: input.status } });
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return prisma.feedbackItem.delete({ where: { id: input.id } });
    }),
});
