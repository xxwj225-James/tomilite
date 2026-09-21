import { prisma } from '@tomilite/database';
import { utcStamp } from '../../lib/dbTime.js';
import { DEFAULT_PROJECT_ID } from '../utils/constants.js';
import { searchNotesSemantic } from '../utils/search.js';

/** Create a knowledge base note/wiki page */
export async function createNote(
  args: Record<string, any>,
): Promise<{ id: string; title: string; category: string } | { error: string }> {
  if (!args.title) return { error: 'Missing title.' };
  const now = utcStamp();
  const page = await prisma.knowledgePage.create({
    data: {
      projectId: DEFAULT_PROJECT_ID,
      title: args.title,
      content: args.content || null,
      category: args.category || 'general',
      createdAt: now,
      updatedAt: now,
    },
  });
  // No embedding call here. The `embed_note_i` trigger queues this row, and the drain
  // loop embeds it within a minute. The fire-and-forget helper that used to live on this
  // line was both narrower (it covered 2 of ~24 writers) and worse (it swallowed every
  // error, and an update never recomputed the vector).
  return { id: page.id, title: page.title, category: page.category };
}

/** Update an existing note by ID */
export async function updateNote(
  args: Record<string, any>,
): Promise<{ id: string; title: string; category: string } | { error: string }> {
  const existing = await prisma.knowledgePage.findUnique({ where: { id: args.id } });
  if (!existing) return { error: `Note not found: ${args.id}` };
  const data: any = {};
  if (args.title !== undefined) data.title = args.title;
  if (args.content !== undefined) data.content = args.content;
  if (args.category !== undefined) data.category = args.category;
  const updated = await prisma.knowledgePage.update({ where: { id: args.id }, data });
  return { id: updated.id, title: updated.title, category: updated.category };
}

/** Fill the note editor form. Does NOT save to DB. */
export function suggestNoteEdit(args: Record<string, any>): any {
  return {
    staged: true,
    title: args.title?.substring(0, 80),
    content: args.content?.substring(0, 2000),
    category: args.category || null,
    type: 'note',
    _full: { title: args.title || '', content: args.content || '', category: args.category || 'general' },
  };
}

/** List all knowledge base notes (with optional search) */
export async function listNotes(
  args: Record<string, any>,
): Promise<Array<{ id: string; title: string; category: string; snippet: string }>> {
  const where: any = { projectId: DEFAULT_PROJECT_ID };
  if (args.query) where.title = { contains: args.query };
  const pages = await prisma.knowledgePage.findMany({ where, orderBy: { updatedAt: 'desc' }, take: args.limit || 20 });
  return pages.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category,
    snippet: (p.content || '').substring(0, 200),
  }));
}

// Re-export for dispatcher
export { searchNotesSemantic };
