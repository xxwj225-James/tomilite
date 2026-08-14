import { prisma } from '@tomatolite/database';
import { embedText } from './search.js';

/** Generate and save embedding vector for a report (fire-and-forget) */
export async function generateReportVector(reportId: string): Promise<void> {
  try {
    const report = await prisma.report.findUnique({ where: { id: reportId }, select: { title: true, content: true } });
    if (!report?.content) return;
    const v = await embedText(report.title + '\n' + report.content);
    if (v) await prisma.report.update({ where: { id: reportId }, data: { vector: JSON.stringify(v) } });
  } catch (_) { /* non-critical */ }
}

/** Generate and save embedding vector for a note (fire-and-forget) */
export async function generateNoteVector(noteId: string): Promise<void> {
  try {
    const note = await prisma.knowledgePage.findUnique({ where: { id: noteId }, select: { title: true, content: true } });
    if (!note?.content) return;
    const v = await embedText(note.title + '\n' + note.content);
    if (v) await prisma.knowledgePage.update({ where: { id: noteId }, data: { vector: JSON.stringify(v) } });
  } catch (_) { /* non-critical */ }
}
