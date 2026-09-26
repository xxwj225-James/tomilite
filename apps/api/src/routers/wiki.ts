import { TRPCError } from '@trpc/server';
import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { utcStamp } from '../lib/dbTime.js';
import { exportToExcel, exportToDoc, exportToHtml, exportToPptx } from '../agent/tools/reportTools.js';

// ─── Reusable schemas ───
const wikiIdSchema = z.object({ id: z.string().min(1, 'Wiki ID cannot be empty') });

// ─── Import batching ───

type ImportedNote = {
  title: string;
  content: string;
  category: string;
  sourceId: string;
  createdAt?: string;
};
/**
 * The importers that can write a note, named once.
 *
 * One list rather than two literals, because the two would be a drift waiting to happen
 * and drifting here is expensive in a specific way: the renderer sends one row per note
 * with this value, and a source the schema below does not know **fails the whole batch**.
 * Adding an importer and forgetting the schema means an import that parses three hundred
 * notes and writes none of them.
 *
 * One value per importer, naming the **importer** rather than an application: this column
 * is what says which one wrote the row, and two importers that read the same format will
 * still derive their `sourceId`s differently (see `sourceId.ts` on the renderer side).
 *
 * This list is only ever read as an input check (line 291) and never as a filter on rows
 * already in the table, which is what makes retiring an importer cheap: deleting its value
 * from here stops new rows being written with it and does nothing at all to the rows that
 * already carry it. `'import:enex'` was removed that way, and the notes it wrote are
 * untouched by it.
 */
const IMPORT_SOURCES = ['import:markdown', 'import:html', 'import:mht'] as const;

type ImportInput = {
  projectId: string;
  source: (typeof IMPORT_SOURCES)[number];
  overwrite: boolean;
  notes: ImportedNote[];
};

/**
 * One import at a time.
 *
 * Two overlapping batches would both miss the same row in the existence check below and
 * insert it twice: `KnowledgePage` has no unique constraint on `(source, sourceId)` to
 * stop them, and it should not have one — both columns are nullable, so SQLite treats
 * every `NULL` pair as distinct and the constraint would guard exactly the rows that
 * already have a working merge key, while turning chatDistill's deliberate
 * find-then-update into a P2002. The renderer is sequential by design; this makes the
 * API true regardless of who is calling it.
 */
let importChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = importChain.then(fn, fn);
  importChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function runImport(input: ImportInput) {
  // Dedupe inside the batch, last wins. The existence check cannot see rows this same
  // call is about to write — a retried batch, or the same file listed twice in one
  // folder selection, would otherwise double-insert.
  const byKey = new Map<string, ImportedNote>();
  for (const n of input.notes) byKey.set(n.sourceId, n);
  const rows = [...byKey.values()].slice(0, 100);

  const existing = await prisma.knowledgePage.findMany({
    where: { source: input.source, sourceId: { in: rows.map((r) => r.sourceId) } },
    select: { id: true, sourceId: true },
  });
  const have = new Map(existing.map((e) => [e.sourceId as string, e.id]));

  const now = utcStamp();
  const out: Array<{ sourceId: string; id: string; action: 'created' | 'updated' | 'skipped' }> = [];
  const ops: any[] = [];

  for (const r of rows) {
    const id = have.get(r.sourceId);
    if (!id) {
      ops.push(
        prisma.knowledgePage.create({
          data: {
            projectId: input.projectId,
            title: r.title,
            content: r.content,
            category: r.category,
            status: 'active',
            source: input.source,
            sourceId: r.sourceId,
            // Written explicitly: `createdAt` is a String column whose default is
            // `datetime('now','localtime')`, and the app's clock is UTC — see
            // lib/dbTime.ts. The date is the source file's own, so an imported library
            // sorts by when it was written rather than by when it was imported.
            createdAt: r.createdAt ?? now,
            updatedAt: now,
          },
        }),
      );
      out.push({ sourceId: r.sourceId, id: '', action: 'created' });
    } else if (input.overwrite) {
      ops.push(
        prisma.knowledgePage.update({
          where: { id },
          data: { title: r.title, content: r.content, category: r.category, updatedAt: now },
        }),
      );
      out.push({ sourceId: r.sourceId, id, action: 'updated' });
    } else {
      out.push({ sourceId: r.sourceId, id, action: 'skipped' });
    }
  }

  // One transaction, so a batch is all-or-nothing and the caller's retry is "resend
  // the same batch". The FTS and embed_queue triggers fire per row inside it; the
  // notes' embedding drain runs off the request path (lib/embed/queue.ts).
  const written: any[] = ops.length ? await prisma.$transaction(ops) : [];
  let w = 0;
  for (const o of out)
    if (o.action !== 'skipped') {
      o.id = written[w]?.id ?? '';
      w++;
    }

  return {
    created: out.filter((o) => o.action === 'created').length,
    updated: out.filter((o) => o.action === 'updated').length,
    skipped: out.filter((o) => o.action === 'skipped').length,
    results: out,
  };
}

export const wikiRouter = router({
  /**
   * Rows for the notes panel, optionally filtered by category.
   *
   * **No `content`, no `vector`** — the projection is the point of this procedure, not a
   * detail of it. The panel paginates client-side at 20 rows, so it needs the whole
   * library, and it used to fetch the whole library's *bodies* to show one page of
   * titles. That was survivable while every note was prose. An imported note carries its
   * images inline as base64 data URLs (the same shape `MarkdownEditor` writes for a
   * pasted or local-file image), so a 500-note import made every refresh a
   * hundred-megabyte response that then sat in renderer memory forever.
   *
   * The body is fetched per note by `byId` when one is actually opened — which is what
   * useNotesState's refresh path already did.
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
        select: {
          id: true,
          title: true,
          category: true,
          status: true,
          source: true,
          sourceId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),

  /**
   * How many notes exist. A count rather than a list, because the import panel needs
   * the answer *before* the user has decided to import anything — it is what drives the
   * warning that crossing MAX_NOTES_FOR_AI (routers/knowledge.ts) will drop the
   * knowledge map to a category tree.
   */
  count: publicProcedure.input(z.object({ projectId: z.string().min(1) })).query(async ({ input }) => {
    return { total: await prisma.knowledgePage.count({ where: { projectId: input.projectId } }) };
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

  /**
   * Write a batch of notes a renderer-side importer has already parsed.
   *
   * One batch is one `source`, which is why a pick spanning several formats arrives as
   * several calls rather than one — the renderer splits it by extension (`lib/import/`).
   *
   * Deliberately not `create`'s shape. An import carries provenance, a derived
   * `sourceId` that is the merge key, and the source file's own date — none of which
   * `create` accepts, and all of which would be wrong if the caller had to fake them.
   *
   * The renderer parses and batches; this procedure never touches the filesystem and
   * has no job state to get stuck. Progress and cancellation therefore live in the
   * caller, which is where they are free.
   */
  importNotes: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        source: z.enum(IMPORT_SOURCES),
        /**
         * Off by default. A second import of the same folder must not silently replace
         * the user's edits to a note that came from it — the note is theirs now.
         */
        overwrite: z.boolean().default(false),
        notes: z
          .array(
            z.object({
              title: z.string().min(1).max(1000),
              // ~4 MB. The renderer enforces a much smaller per-image and per-note cap;
              // this is the backstop against a malformed or hand-rolled client.
              content: z.string().max(4_000_000),
              category: z.string().min(1).max(200),
              sourceId: z.string().min(1).max(1000),
              /** When the source says the note was written, as a naive-UTC stamp — absent
               *  when it does not say, in which case this procedure fills in the import
               *  time. A file's mtime is the only date a Markdown import has. */
              createdAt: z.string().max(30).optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
    )
    .mutation(({ input }) => serialize(() => runImport(input))),
});
