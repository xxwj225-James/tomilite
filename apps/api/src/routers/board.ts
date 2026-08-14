import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';

export const boardRouter = router({
  getBoard: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return prisma.board.findFirst({
        where: { projectId: input.projectId },
        include: {
          columns: {
            orderBy: { sortOrder: 'asc' },
            include: {
              cards: {
                orderBy: { position: 'asc' },
                include: { issue: true },
              },
            },
          },
        },
      });
    }),

  moveCard: publicProcedure
    .input(z.object({
      cardId: z.string(),
      columnId: z.string(),
      position: z.number(),
    }))
    .mutation(async ({ input }) => {
      return prisma.boardCard.update({
        where: { id: input.cardId },
        data: { columnId: input.columnId, position: input.position },
      });
    }),
});
