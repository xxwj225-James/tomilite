import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';
import { exportToExcel, exportToDoc, exportToHtml } from '../agent/tools/reportTools.js';

// Archive sent reports older than 90 days (hide from UI, never delete)
export function startReportArchiver() {
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().replace('T', ' ').substring(0, 19);
      const archived = await prisma.report.updateMany({
        where: { status: 'sent', generatedAt: { lt: cutoff }, archived: false },
        data: { archived: true },
      });
      if (archived.count > 0) console.log(`[Report Archive] Archived ${archived.count} old sent reports`);
    } catch {}
  }, 60 * 60 * 1000);
}

export const reportRouter = router({
  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return prisma.report.findUnique({ where: { id: input.id } });
    }),

  list: publicProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ input }) => {
      return prisma.report.findMany({ where: { archived: false }, orderBy: { createdAt: 'desc' }, take: input.limit });
    }),

  getLatest: publicProcedure
    .input(z.object({ reportType: z.string().optional() }))
    .query(async ({ input }) => {
      const where: any = { archived: false };
      if (input.reportType) where.reportType = input.reportType;
      return prisma.report.findFirst({ where, orderBy: { createdAt: 'desc' } });
    }),

  save: publicProcedure
    .input(z.object({ reportType: z.string(), title: z.string(), content: z.string(), id: z.string().optional() }))
    .mutation(async ({ input }) => {
      if (input.id) {
        return prisma.report.update({ where: { id: input.id }, data: { reportType: input.reportType, title: input.title, content: input.content, status: 'draft' } });
      }
      const existing = await prisma.report.findFirst({ where: { reportType: input.reportType, title: input.title, status: 'draft' } });
      if (existing) {
        return prisma.report.update({ where: { id: existing.id }, data: { reportType: input.reportType, title: input.title, content: input.content, status: 'draft' } });
      }
      return prisma.report.create({
        data: { projectId: 'proj-default', reportType: input.reportType, title: input.title, content: input.content, status: 'draft' },
      });
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await prisma.report.delete({ where: { id: input.id } });
      } catch {
        // Already deleted or never existed — idempotent
        return { id: input.id, deleted: false };
      }
    }),

  markSent: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return prisma.report.update({ where: { id: input.id }, data: { status: 'sent' } });
    }),

  exportExcel: publicProcedure
    .input(z.object({ reportId: z.string() }))
    .query(async ({ input }) => {
      const result = await exportToExcel(input);
      return result.error ? result : { ok: true, filePath: result.filePath, filename: result.filename };
    }),

  exportWord: publicProcedure
    .input(z.object({ reportId: z.string() }))
    .query(async ({ input }) => {
      const result = await exportToDoc(input);
      return result.error ? result : { ok: true, filePath: result.filePath, filename: result.filename };
    }),

  exportHtml: publicProcedure
    .input(z.object({ reportId: z.string() }))
    .query(async ({ input }) => {
      const result = await exportToHtml(input);
      return result.error ? result : { ok: true, filePath: result.filePath, filename: result.filename };
    }),

});
