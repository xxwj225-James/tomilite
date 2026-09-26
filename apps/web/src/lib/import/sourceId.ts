// ═══ What makes two notes "the same note" across two imports ═══
//
// `sourceId` is the merge key. Every decision in this file is really about one
// question: if the user imports the same library twice — or re-exports it and imports
// again — which rows must be recognised as the ones already in the database?
//
// Get it wrong in the "too weak" direction and re-importing doubles every note. Get it
// wrong in the "too strong" direction and two genuinely different notes collapse into
// one. There is no undoing either: the first import has already written the rows.
//
// The values are derived here and nowhere else. Anything that computed a `sourceId` a
// second way would be a second answer to this question, and the two would drift.

/**
 * A file's path, relative to the folder the user picked — or, when the user picked files
 * instead of a folder, simply the file's own name.
 *
 * A multi-file pick is the normal case now: the browser hands over bare `name`s with no
 * directory attached, so for those files this is the name and nothing more. The folder
 * case is what the path-shape handling below exists for, and it stays correct whether or
 * not the picker that produced it comes back.
 *
 * Separators are normalised because `webkitRelativePath` inherits the platform's:
 * `a/b.md` in Chromium on some setups and `a\b.md` on others. The same folder imported
 * from two machines has to produce the same id, or the second import duplicates the
 * first — which is exactly what a user moving a notes folder between computers does.
 */
export function markdownSourceId(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** The segments of a relative path, with the file name last. `''` for a bare name. */
function segments(relativePath: string): string[] {
  return markdownSourceId(relativePath).split('/').filter(Boolean);
}

/**
 * The notebook a folder-imported note belongs to — which becomes its `category`.
 *
 * This is the **first path segment after the folder the user selected**, not the
 * selected folder's own name. `webkitRelativePath` always begins with the selected
 * folder, so the naive reading ("top-level folder name") would label every note in the
 * import with that one name — a single notebook holding the whole library, which is the
 * feature doing nothing.
 *
 * It lands right in both of the layouts people actually have:
 *
 *   select `notes/` holding `notes/Work/a.md`      → `Work`      (Obsidian, plain md)
 *   select `export/` holding `export/Work/a.md`    → `Work`      (Evernote's md export)
 *   select `notes/` holding `notes/a.md`           → `notes`     (loose files at the root)
 *
 * Deeper nesting collapses to that first segment: `notes/Work/2024/a.md` is `Work`.
 * One level is what a notebook is; fanning a library out by full path would produce
 * hundreds of categories the notes panel cannot usefully show.
 *
 * **A multi-file pick has no path at all**, so `dirs` is empty for every file in it and
 * this returns `'imported'`. That is the fallback, not a decision: in that mode the
 * category is whatever the import dialog's own field says, and an empty field is what
 * lands here.
 */
export function markdownNotebook(relativePath: string): string {
  const segs = segments(relativePath);
  const dirs = segs.slice(0, -1); // the folder path, without the file name
  if (dirs.length === 0) return 'imported';
  // `dirs[0]` is always the folder the user selected, which is a notebook only when the
  // file sits directly inside it. One level down is where the notebooks are — and one
  // level down is all of it: `notes/Work/2024/a.md` belongs to `Work`, not `2024`.
  return dirs.length === 1 ? dirs[0] : dirs[1];
}

/**
 * The title to store for a Markdown file.
 *
 * A leading `# Heading` wins, because in every Markdown-based notes app the heading is
 * the title and the file name is often a slug (`2024-03-11-meeting-notes.md`). The
 * heading is **left in the body as well**: removing it would be a lossy edit to a note
 * the user wrote by hand, made by a tool that was only supposed to copy it.
 */
export function markdownTitle(relativePath: string, content: string): string {
  const h = /^[ \t]*#{1,2}[ \t]+(\S.*?)[ \t]*#*[ \t]*$/m.exec(content);
  if (h) return h[1].slice(0, 300);
  const base = markdownSourceId(relativePath).split('/').pop() || '';
  return base.replace(/\.(md|markdown|txt)$/i, '').trim() || 'Untitled';
}

// ─── The HTML export, and the MHTML one ───

/**
 * Drop the `.notes` infix an 印象笔记 export puts between the notebook name and the
 * extension: `YinXiangBiJi.notes.html` is the notebook `YinXiangBiJi`.
 *
 * **This is inferred, not documented.** It is read off one export (2026-09-22) plus the
 * naming the format is known to use: the `.notes.html` / `.notes_files` pair is the
 * *single-page* shape, where one file holds a whole notebook, as against the multi-page
 * shape where each note is its own file and an `index.html` links them. One sample cannot
 * prove which shape is the common case, so the rule is written to be harmless when wrong:
 * stripping an infix that is not there is a no-op, and a notebook genuinely named
 * `X.notes` loses a suffix from the label it was going to be shown under anyway.
 */
export function stripNotesInfix(base: string): string {
  return base.replace(/\.notes$/i, '');
}

/** The file's base name, without its directory and without the extension. */
function baseName(relativePath: string): string {
  return markdownSourceId(relativePath).split('/').pop() || '';
}

/**
 * `sourceId` for an HTML export — the file's path, and nothing else.
 *
 * Deliberately **identical to `markdownSourceId`**, and wrapped in a named function so
 * that stays a decision rather than a coincidence. The path is already unique within an
 * import, and a user who renames a note in TomiLite will re-import from the same file
 * path, which must land on the same row.
 *
 * The title is deliberately **not** part of the key. An earlier draft of the HTML
 * importer took the title from the first heading, and a heading is exactly what a user
 * edits — putting it in the key would turn "I fixed a typo in the title" into "the note
 * I have been taking for a month is now a second note".
 *
 * When the single-page export is eventually split (see `htmlNote.ts`), the splitter will
 * need a key per note inside the file, and that is a change **here** — one place, which
 * is the reason this wrapper exists at all rather than `markdownSourceId` being called
 * directly at the call site.
 */
export function htmlSourceId(relativePath: string): string {
  return markdownSourceId(relativePath);
}

/**
 * The notebook an HTML export's note belongs to.
 *
 * Two shapes, told apart by whether the file name carries the `.notes` infix:
 *
 *   `Shop.notes.html`        → `Shop`    (single-page: the file *is* the notebook)
 *   `export/Work/a.html`     → `Work`    (multi-page: the folder is, as for Markdown)
 *   `a.html` (no folder)     → `imported`
 *
 * The distinction matters because the folder a user picks is not a notebook: they pick
 * `Desktop/notes`, and every note in the import would be filed under `notes`. When the
 * file name says which notebook it is, that answer wins.
 */
export function htmlNotebook(relativePath: string): string {
  const base = baseName(relativePath);
  if (/\.notes\.html?$/i.test(base)) {
    return stripNotesInfix(base.replace(/\.html?$/i, '')).trim() || 'imported';
  }
  return markdownNotebook(relativePath);
}

/** The title to store for an HTML export, from its file name. Only a fallback: the
 *  observed export has no per-note title anywhere, so `htmlNote.ts` looks at the
 *  document first and lands here when the document has nothing to say. */
export function htmlTitle(relativePath: string): string {
  const base = stripNotesInfix(baseName(relativePath).replace(/\.html?$/i, ''));
  return base.trim() || 'Untitled';
}

/**
 * The notebook an `.mht` belongs to: the container's own file name.
 *
 * `.mht` is the one-file-carrying-everything format, so the file name is the only thing
 * that names the notebook. The `.notes` infix is stripped for the same reason as in
 * `htmlNotebook`, and the observed export has it: `YinXiangBiJi.notes.mht`.
 *
 * `.mhtml` is the same container under the name the rest of the world uses for it, and it
 * is accepted by the picker: the parser reads it unchanged, so refusing it would be a
 * refusal to import a file we can already read.
 */
export function mhtNotebook(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() || fileName;
  return stripNotesInfix(base.replace(/\.(mht|mhtml)$/i, '')).trim() || 'imported';
}

/**
 * `sourceId` for an `.mht`'s note — the notebook plus the title, and nothing else.
 *
 * The container's own date is **not** part of the key. The `Date:` header records when the
 * export ran, so copying the file, or re-exporting the same note next week, would change
 * it — and a key that changes on copy is a key that duplicates the library. The notebook is
 * in the key instead, because a multi-file pick hands over bare names with no directory and
 * two notebooks can hold same-titled notes.
 *
 * **Why not the note's position in the list.** That is the tempting one — it is free,
 * unique within a pick, and looks like an id. It is correct only until one file is removed
 * from the folder and the pick is redone, at which point every later file shifts up by one
 * and the next import rewrites the library onto the wrong rows: 300 notes quietly replaced
 * by their 300 neighbours' content. A stable key cannot depend on a neighbour, which is why
 * every key in this file is derived from what the note itself carries.
 *
 * The `\u0000` separator is not decoration: a title may contain `/`, and without a
 * separator that cannot occur in a title, `("a/b", "c")` and `("a", "b/c")` would be the
 * same key. Every other byte a title could hold is already spoken for by the format except
 * NUL.
 *
 * Changing this function's output invalidates every note already imported — they all miss
 * the existence check and come back as duplicates — so it is written to be the only place
 * that decides.
 */
export function mhtSourceId(notebook: string, title: string): string {
  return `${notebook}\u0000${title}`;
}
