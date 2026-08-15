import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';

export const focusRouter = router({
  // Receives heartbeat from IDE or web
  heartbeat: publicProcedure
    .input(z.object({
      ts: z.number(),
      idleSec: z.number(),
      state: z.enum(['active', 'idle', 'away']),
      source: z.enum(['ide', 'web']).default('web'),
    }))
    .mutation(async ({ input }) => {
      try {
        const focusState = input.source === 'ide'
          ? (input.idleSec < 120 ? 'deep_flow' : input.idleSec < 600 ? 'focused' : 'available')
          : (input.idleSec < 300 ? 'focused' : 'available');
        // DB write is best-effort — table may not exist, heartbeat is non-critical
        try {
          await prisma.user.updateMany({ data: { focusState, focusScore: input.idleSec < 120 ? 100 : input.idleSec < 600 ? 60 : 20 } });
          const user = await prisma.user.findFirst();
          if (user) await prisma.focusSession.create({ data: { userId: user.id, focusState, source: input.source } });
        } catch { /* table may not exist */ }
        return { focusState, received: true };
      } catch (e: any) {
        console.error('[Focus] heartbeat error:', e?.message || e);
        return { focusState: 'available', received: false };
      }
    }),

  // Get current focus state + today's sessions
  status: publicProcedure.query(async () => {
    const user = await prisma.user.findFirst();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const sessions = await prisma.focusSession.findMany({
      where: {
        startTime: { gte: todayStart.toISOString() },
      },
      orderBy: { startTime: 'desc' },
      take: 50,
    });

    return {
      focusState: user?.focusState || 'available',
      focusScore: user?.focusScore || 0,
      sessions,
    };
  }),

  // End a session (called when IDE closes or user goes away)
  endSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      return prisma.focusSession.update({
        where: { id: input.sessionId },
        data: { endTime: new Date().toISOString() },
      });
    }),
});
