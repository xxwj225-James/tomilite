import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';

export const chatRouter = router({
  // ─── Sessions ───
  listSessions: publicProcedure.query(async () => {
    return prisma.chatSession.findMany({ orderBy: { updatedAt: 'desc' } });
  }),

  createSession: publicProcedure
    .input(z.object({ title: z.string().default('New Chat') }))
    .mutation(async ({ input }) => {
      return prisma.chatSession.create({ data: { title: input.title } });
    }),

  renameSession: publicProcedure
    .input(z.object({ id: z.string(), title: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return prisma.chatSession.update({
        where: { id: input.id },
        data: { title: input.title, updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 19) },
      });
    }),

  deleteSession: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.chatMessage.deleteMany({ where: { sessionId: input.id } });
      return prisma.chatSession.delete({ where: { id: input.id } });
    }),

  // ─── Messages ───
  getMessages: publicProcedure
    .input(z.object({ sessionId: z.string(), threadId: z.string().nullable().optional() }))
    .query(async ({ input }) => {
      const where: any = { sessionId: input.sessionId };
      if (input.threadId !== undefined) where.threadId = input.threadId ?? null;
      return prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'asc' },
      });
    }),

  addMessage: publicProcedure
    .input(z.object({
      id: z.string().optional(),
      sessionId: z.string(),
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      tool: z.string().optional(),
      staged: z.string().optional(),
      card: z.string().optional(),
      reasoningContent: z.string().optional(),
      pinnable: z.boolean().optional(),
      threadId: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      await prisma.chatSession.update({
        where: { id: input.sessionId },
        data: { updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 19) },
      });
      return prisma.chatMessage.create({ data: input });
    }),

  listThreads: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const rows = await prisma.$queryRawUnsafe<Array<{ threadId: string | null; cnt: number; firstAt: string }>>(
        `SELECT threadId, CAST(COUNT(*) AS INTEGER) as cnt, MIN(createdAt) as firstAt FROM ChatMessage WHERE sessionId = ? AND role = 'user' GROUP BY threadId ORDER BY firstAt ASC`,
        input.sessionId,
      );
      return rows.map((r: any) => ({ threadId: r.threadId || null, messageCount: r.cnt }));
    }),

  updateMessage: publicProcedure
    .input(z.object({ id: z.string(), card: z.string().optional(), staged: z.string().optional(), text: z.string().optional() }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return prisma.chatMessage.update({ where: { id }, data });
    }),

  clearMessages: publicProcedure
    .input(z.object({ sessionId: z.string(), threadId: z.string().nullable().optional() }))
    .mutation(async ({ input }) => {
      return prisma.chatMessage.deleteMany({
        where: { sessionId: input.sessionId, ...(input.threadId !== undefined ? { threadId: input.threadId ?? null } : {}) },
      });
    }),
});
