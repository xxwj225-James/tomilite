import { TRPCError } from '@trpc/server';
import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { utcStamp } from '../lib/dbTime.js';
import { exportToExcel, exportToDoc, exportToHtml, exportToPptx } from '../agent/tools/reportTools.js';

// ─── Reusable schemas ───
const wikiIdSchema = z.object({ id: z.string().min(1, 'Wiki ID cannot be empty') });

export const wikiRouter = router({
  /**
   * List all wiki pages for a project, optionally filtered by category.
   */
  list: publicProcedure
    .input(z.object({ projectId: z.string().min(1), category: z.string().optional() }))
    .query(async ({ input }) => {
      return prisma.knowledgePage.findMany({
        where: {
          projectId: input.projectId,
          ...(input.category ? { category: input.category } : {}),
        },
        orderBy: { updatedAt: 'desc' },
      });
    }),

  /**
   * Get a single wiki page by ID. Throws NOT_FOUND if the ID does not exist.
   */
  byId: publicProcedure.input(wikiIdSchema).query(async ({ input }) => {
    const page = await prisma.knowledgePage.findUnique({ where: { id: input.id } });
    if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: `Wiki page ${input.id} not found` });
    return page;
  }),

  /**
   * Create a new wiki page.
   */
  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        title: z.string().min(1, 'Title is required'),
        content: z.string().optional(),
        category: z.string().default('general'),
      }),
    )
    .mutation(async ({ input }) => {
      // Stamps are written explicitly: these are String columns with a `localtime`
      // default, not Prisma `DateTime` fields, so `@updatedAt` does not exist here and
      // a row born from the default would be on the other clock — see lib/dbTime.ts.
      const now = utcStamp();
      return prisma.knowledgePage.create({ data: { ...input, createdAt: now, updatedAt: now } });
    }),

  /**
   * Update an existing wiki page. Only provided fields are updated.
   *
   * `updatedAt` is NOT automatic — these are plain String columns, so it has to be set
   * here, and (as elsewhere in the codebase) an update that forgets it leaves the row
   * looking older than it is.
   */
  update: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1).optional(),
        content: z.string().optional(),
        category: z.string().optional(),
        status: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      if (Object.keys(data).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update' });
      }
      try {
        return await prisma.knowledgePage.update({ where: { id }, data: { ...data, updatedAt: utcStamp() } });
      } catch (error: any) {
        if (error?.code === 'P2025')
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Wiki page not found or already deleted' });
        throw error;
      }
    }),

  /**
   * Delete a wiki page by ID.
   */
  delete: publicProcedure.input(wikiIdSchema).mutation(async ({ input }) => {
    try {
      return await prisma.knowledgePage.delete({ where: { id: input.id } });
    } catch (error: any) {
      if (error?.code === 'P2025')
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Wiki page not found or already deleted' });
      throw error;
    }
  }),

  exportNote: publicProcedure
    .input(z.object({ noteId: z.string(), format: z.enum(['xlsx', 'docx', 'html', 'pptx']) }))
    .query(async ({ input }) => {
      const note = await prisma.knowledgePage.findUnique({ where: { id: input.noteId } });
      if (!note) return { ok: false, error: 'Note not found' };
      const content = `# ${note.title || 'Untitled'}\n\n${note.content || ''}\n`;
      const fn = (note.title || 'note').replace(/[<>:"/\\|?*]/g, '_');
      const exporter =
        input.format === 'xlsx'
          ? exportToExcel
          : input.format === 'docx'
            ? exportToDoc
            : input.format === 'pptx'
              ? exportToPptx
              : exportToHtml;
      const result = await exporter({ content, filename: fn });
      return result.error
        ? result
        : { ok: true, filePath: result.filePath, filename: result.filename, html: result.html };
    }),
});
