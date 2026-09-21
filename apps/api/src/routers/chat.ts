import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { utcStamp } from '../lib/dbTime.js';

export const chatRouter = router({
  // ─── Sessions ───
  listSessions: publicProcedure.query(async () => {
    return prisma.chatSession.findMany({ orderBy: { updatedAt: 'desc' } });
  }),

  createSession: publicProcedure
    .input(z.object({ title: z.string().default('New Chat') }))
    .mutation(async ({ input }) => {
      // Both stamps explicit. This used to pass only `title`, so the session took the
      // column default `datetime('now','localtime')` while every other write to
      // `updatedAt` (addMessage, renameSession) is UTC — one column, two clocks, and
      // SessionSidebar had to document the mismatch as a known exception. See
      // lib/dbTime.ts.
      const now = utcStamp();
      return prisma.chatSession.create({ data: { title: input.title, createdAt: now, updatedAt: now } });
    }),

  renameSession: publicProcedure
    .input(z.object({ id: z.string(), title: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return prisma.chatSession.update({
        where: { id: input.id },
        data: { title: input.title, updatedAt: utcStamp() },
      });
    }),

  deleteSession: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
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
    .input(
      z.object({
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
      }),
    )
    .mutation(async ({ input }) => {
      await prisma.chatSession.update({
        where: { id: input.sessionId },
        data: { updatedAt: utcStamp() },
      });
      // ChatMessage has only `createdAt` — there is no `updatedAt` column on the model.
      // Writing one makes Prisma reject the entire call ("Unknown argument `updatedAt`"),
      // and because callers swallow save errors the message simply never reaches the
      // database: a sent message stays on screen until the next reload, and a compress
      // that deletes a session's rows before re-saving the kept ones leaves the session
      // empty. Only `createdAt` is set here, away from the localtime column default; see
      // lib/dbTime.ts, and note `getMessages` orders by it.
      const now = utcStamp();
      return prisma.chatMessage.create({ data: { ...input, createdAt: now } });
    }),

  listThreads: publicProcedure.input(z.object({ sessionId: z.string() })).query(async ({ input }) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ threadId: string | null; cnt: number; firstAt: string }>>(
      `SELECT threadId, CAST(COUNT(*) AS INTEGER) as cnt, MIN(createdAt) as firstAt FROM ChatMessage WHERE sessionId = ? AND role = 'user' GROUP BY threadId ORDER BY firstAt ASC`,
      input.sessionId,
    );
    return rows.map((r: any) => ({ threadId: r.threadId || null, messageCount: r.cnt }));
  }),

  updateMessage: publicProcedure
    .input(
      z.object({
        id: z.string(),
        card: z.string().optional(),
        staged: z.string().optional(),
        text: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return prisma.chatMessage.update({ where: { id }, data });
    }),

  clearMessages: publicProcedure
    .input(z.object({ sessionId: z.string(), threadId: z.string().nullable().optional() }))
    .mutation(async ({ input }) => {
      return prisma.chatMessage.deleteMany({
        where: {
          sessionId: input.sessionId,
          ...(input.threadId !== undefined ? { threadId: input.threadId ?? null } : {}),
        },
      });
    }),
});
