import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { utcStamp } from '../lib/dbTime.js';

export const focusRouter = router({
  // Receives heartbeat from IDE or web
  heartbeat: publicProcedure
    .input(
      z.object({
        ts: z.number(),
        idleSec: z.number(),
        state: z.enum(['active', 'idle', 'away']),
        source: z.enum(['ide', 'web']).default('web'),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const focusState =
          input.source === 'ide'
            ? input.idleSec < 120
              ? 'deep_flow'
              : input.idleSec < 600
                ? 'focused'
                : 'available'
            : input.idleSec < 300
              ? 'focused'
              : 'available';
        // DB write is best-effort — table may not exist, heartbeat is non-critical
        try {
          await prisma.user.updateMany({
            data: { focusState, focusScore: input.idleSec < 120 ? 100 : input.idleSec < 600 ? 60 : 20 },
          });
          const user = await prisma.user.findFirst();
          // `startTime` is stamped explicitly rather than left to the column default,
          // which is localtime — see lib/dbTime.ts. A local stamp here is 8h ahead of
          // the UTC cutoff `status` below filters with.
          if (user)
            await prisma.focusSession.create({
              data: { userId: user.id, focusState, source: input.source, startTime: utcStamp() },
            });
        } catch {
          /* table may not exist */
        }
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
        // `todayStart` is local midnight; the column stores UTC, so it goes through
        // `utcStamp` rather than `toISOString()` — the latter is a `Z`-shaped string,
        // which compared against a naive stamp sorts on the separator at index 10.
        startTime: { gte: utcStamp(todayStart) },
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
  endSession: publicProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ input }) => {
    // Same shape as `startTime`, so the two stamps of one session are comparable.
    // This wrote a `Z`-shaped ISO into a naive-UTC column, which is a third shape in
    // a column that already had two.
    return prisma.focusSession.update({
      where: { id: input.sessionId },
      data: { endTime: utcStamp() },
    });
  }),
});
