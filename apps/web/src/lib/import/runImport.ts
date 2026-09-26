// ═══ Driving an import: batching, progress, cancellation ═══
//
// ## Why this runs in the renderer and not in the API
//
// Every other long job in this app lives on the API side — meeting transcription keeps
// a status column and a stuck-row sweeper, the chat stream is SSE. Notes import is the
// exception, and the reason is that the files are already here. Files picked through an
// `<input type="file">` — one file or two hundred — arrive as `File` handles the renderer
// can read directly; sending them to the API would mean streaming the bytes over IPC, and
// the API would then need somewhere to keep "which file am I on" across a request that
// may be retried.
//
// Progress and cancel are the payoff: the loop below *is* the job, so a progress
// callback is just a function call and pressing stop is an abort check. The API-side
// equivalent is a status column, a poll and a cleaner for rows that died mid-run.
//
// The cost of the choice is that this is the one place where a failure is the user's to
// see, so nothing here throws: every path returns what it managed to do.

import { api } from '@/lib/api';
import { IMPORT_ORDER, bucketPickedFiles, type ImportBucket } from './buckets';
import { htmlNotebook, htmlSourceId, markdownSourceId, mhtNotebook, mhtSourceId } from './sourceId';
import { countNoteContainers, isHtmlNoteFile, makeResourceIndex } from './html';
import { fileResolver, parseHtmlNote, type HtmlParseResult } from './htmlNote';
import { readMht, resolveMhtResource } from './mht';
import { decodeBytes, readText } from './text';
import { isNoteFile, markdownKey, readMarkdownFile } from './markdown';
import {
  IMPORT_BATCH,
  MAX_HTML_BYTES,
  MAX_MHT_BYTES,
  emptyTally,
  type ImportTally,
  type ImportedNote,
} from './types';

export type ImportSource = 'import:markdown' | 'import:html' | 'import:mht';

export type ImportPhase = 'reading' | 'writing' | 'done';

export type ImportProgress = {
  phase: ImportPhase;
  /** Files finished. */
  files: number;
  fileTotal: number;
  /** Notes parsed so far — the only meaningful number for a single large file. */
  notes: number;
  label: string;
};

export type ImportOutcome = {
  tally: ImportTally;
  cancelled: boolean;
  /** Capped, human-readable notes about what did not make it. */
  warnings: string[];
  /** A batch failed. `tally` is what got through before it. */
  error?: string;
};

export type ImportOptions = {
  /** Overwrite notes that already exist. Off by default: the second import of the same
   *  files must not silently replace the user's edits to a note that came from them. */
  overwrite?: boolean;
  /**
   * The notebook to file the imported notes under. Honoured by the Markdown path only.
   *
   * A file pick carries no directory, so a Markdown note cannot take its category from
   * where the file sat and the dialog asks for it instead. The other two formats name
   * their own notebook in their file name and would not be overridden by this even if it
   * were passed — a single-page export *is* the notebook it holds.
   *
   * Empty means "whatever the path gave us", which for a file pick is `imported`.
   */
  category?: string;
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
};

const WARN_CAP = 25;

type Writer = { add(note: ImportedNote): Promise<void>; flush(): Promise<void> };

type Ctx = {
  tally: ImportTally;
  warnings: string[];
  /** Notes handed to the writer, which is what progress reports. */
  notes: number;
  warn(msg: string): void;
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Batch buffer.
 *
 * The renderer batches rather than sending note by note because `wiki.importNotes`
 * writes a batch in one transaction, and because a 5000-note import is 5000 round trips
 * otherwise. A batch that fails fails whole; the caller gets the tally of everything
 * before it.
 */
function makeWriter(projectId: string, source: ImportSource, overwrite: boolean, ctx: Ctx): Writer {
  let buf: ImportedNote[] = [];
  const flush = async (): Promise<void> => {
    if (!buf.length) return;
    const notes = buf;
    buf = [];
    const r = await api.wiki.importNotes({ projectId, source, overwrite, notes });
    ctx.tally.created += r?.created ?? 0;
    ctx.tally.updated += r?.updated ?? 0;
    ctx.tally.skipped += r?.skipped ?? 0;
  };
  return {
    flush,
    async add(note) {
      buf.push(note);
      if (buf.length >= IMPORT_BATCH) await flush();
    },
  };
}

/**
 * The loop every importer shares.
 *
 * `handle` is called once per file, and cancellation is checked between files — which is
 * only enough when one file is one note. That used to be false of one format: a whole
 * notebook in a single file is cancellable per *note*, so its handler threw a sentinel to
 * unwind out of the file it was part-way through. No surviving importer is built that way,
 * so the sentinel is gone with it; a future format of that shape needs it back, and this
 * paragraph is where it was.
 */
async function importFiles(
  projectId: string,
  source: ImportSource,
  files: File[],
  opts: ImportOptions,
  handle: (file: File, writer: Writer, ctx: Ctx, report: () => void) => Promise<void>,
): Promise<ImportOutcome> {
  const tally = emptyTally();
  const warnings: string[] = [];
  const ctx: Ctx = {
    tally,
    warnings,
    notes: 0,
    warn(msg) {
      if (warnings.length < WARN_CAP) warnings.push(msg);
      else if (warnings.length === WARN_CAP) warnings.push('…');
    },
  };
  const writer = makeWriter(projectId, source, !!opts.overwrite, ctx);

  let done = 0;
  let label = '';
  let phase: ImportPhase = 'reading';
  const report = (next?: ImportPhase) => {
    if (next) phase = next;
    opts.onProgress?.({ phase, files: done, fileTotal: files.length, notes: ctx.notes, label });
  };

  let cancelled = false;
  try {
    for (const file of files) {
      if (opts.signal?.aborted) {
        cancelled = true;
        break;
      }
      label = file.name;
      report();
      await handle(file, writer, ctx, report);
      done++;
    }
    // Runs on cancel too. The alternative is discarding up to a batch of notes that the
    // progress bar has already counted as read, so the summary would disagree with what
    // the user just watched happen.
    phase = 'writing';
    report();
    await writer.flush();
  } catch (e) {
    return { tally, cancelled: false, warnings, error: message(e) };
  }

  report('done');
  return { tally, cancelled, warnings };
}

// ─── One pick, any of the formats ───

/** The three importers, by bucket. A table rather than a chain of ternaries because the
 *  only thing that varies is which function runs, which is what a lookup says. Typed by
 *  `ImportBucket`, so adding a format is one line here and it cannot be added half-wired. */
const IMPORTERS: Record<
  ImportBucket,
  (projectId: string, files: File[], opts?: ImportOptions) => Promise<ImportOutcome>
> = {
  markdown: importMarkdownFiles,
  html: importHtmlFiles,
  mht: importMhtFiles,
};

/** Sum one tally into another, over the keys that exist — so a field added later cannot
 *  be forgotten at this call site. */
function mergeTally(into: ImportTally, add: ImportTally): void {
  for (const key of Object.keys(into) as Array<keyof ImportTally>) into[key] += add[key];
}

/**
 * Import one pick, whatever formats it contains.
 *
 * `wiki.importNotes` takes **one `source` per batch** and its schema rejects a `source` it
 * does not know, failing the whole batch — so a pick that spans formats is split by
 * extension (`buckets.ts`) and each bucket is written with its own. The user did one
 * thing, so the run, the progress bar and the summary are one thing too.
 *
 * ## One bar, not one per format
 *
 * Each importer counts its own files from zero, so running three of them in sequence would
 * restart the bar twice. `onProgress` is wrapped here to add back what the earlier buckets
 * finished, and `notes` is offset the same way from their tallies — `created`, `updated`
 * and `skipped` are the only places a handed-over note can end up, so their sum is what
 * the earlier buckets counted as they went.
 *
 * ## Stopping
 *
 * A bucket that fails hard stops the pick: the remaining ones would be the same API
 * refusing the same write, and the summary says what got through before it — which is what
 * an `ImportOutcome` carrying an `error` already means.
 */
export async function importPickedFiles(
  projectId: string,
  files: File[],
  opts: ImportOptions = {},
): Promise<ImportOutcome> {
  const picked = bucketPickedFiles(files);
  const buckets = IMPORT_ORDER.filter((bucket) => picked[bucket].length > 0);

  const tally = emptyTally();
  const warnings: string[] = [];
  // Not `files.length`: an unclaimed file is never counted as done, and a total that
  // includes it is a bar that stops short of 100%.
  const total = files.length - picked.unknown.length;

  // First, because the line that explains what did not happen belongs before the detail of
  // what did. Reachable by accident — a file picker's filter can be switched to "all
  // files" — and a file that lands here is one the user deliberately chose, which is
  // exactly the kind of thing that must not disappear quietly.
  if (picked.unknown.length) {
    warnings.push(`${picked.unknown.length} file(s) are not a format this imports and were left out`);
  }

  let cancelled = false;
  let error: string | undefined;
  let filesDone = 0;
  let notesDone = 0;

  for (const bucket of buckets) {
    if (opts.signal?.aborted) {
      cancelled = true;
      break;
    }
    // Captured before the call so the closure below sees this bucket's starting point.
    const done = filesDone;
    const notes = notesDone;
    // What the importer itself counted, which is not always the number of files it was
    // handed: the Markdown path drops same-named files before it starts. Offsetting by the
    // bucket's length instead would leave the bar short of 100% by that difference.
    let counted = 0;
    const out = await IMPORTERS[bucket](projectId, picked[bucket], {
      ...opts,
      // Only the Markdown path reads this, and only it can honour it — see `ImportOptions`.
      category: bucket === 'markdown' ? opts.category : undefined,
      onProgress: (p) => {
        counted = p.files;
        opts.onProgress?.({ ...p, files: done + p.files, fileTotal: total, notes: notes + p.notes });
      },
    });
    mergeTally(tally, out.tally);
    warnings.push(...out.warnings);
    cancelled = cancelled || out.cancelled;
    filesDone += counted;
    notesDone += out.tally.created + out.tally.updated + out.tally.skipped;
    if (out.error) {
      error = out.error;
      break;
    }
  }

  // Each bucket caps its own list at `WARN_CAP`, so three of them would hand the summary
  // three times the cap. Re-capped here, the same way and for the same reason.
  if (warnings.length > WARN_CAP) warnings.splice(WARN_CAP, warnings.length - WARN_CAP, '…');

  return { tally, cancelled, warnings, error };
}

/**
 * Import Markdown files.
 *
 * **Two files with the same name are one note**, because a name is all a file pick hands
 * over (see `markdownKey`) and the name is the merge key. The batch is de-duplicated
 * before anything is written and the losers are reported. Left to the API's existence
 * check instead, the second file would come back as `skipped` and the user would never
 * learn that a file they deliberately picked was not imported.
 *
 * The filter below is defensive: the dispatcher hands this only the Markdown bucket, so in
 * practice it never drops anything — and the count of files that are *not* notes lives up
 * there, where the bucketing decision is made.
 */
export async function importMarkdownFiles(
  projectId: string,
  files: File[],
  opts: ImportOptions = {},
): Promise<ImportOutcome> {
  const notes = files.filter((f) => isNoteFile(f.name));

  const seen = new Set<string>();
  const unique: File[] = [];
  let duplicates = 0;
  for (const file of notes) {
    const key = markdownKey(file);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(file);
  }

  const out = await importFiles(projectId, 'import:markdown', unique, opts, async (file, writer, ctx) => {
    const r = await readMarkdownFile(file);
    if ('note' in r) {
      // A file pick cannot say which notebook this came from, so the dialog asks. Only
      // when it was answered: an empty field leaves what the path gave us, which for a
      // file pick is `imported`.
      if (opts.category) r.note.category = opts.category;
      await writer.add(r.note);
      ctx.notes++;
    } else if (r.skip === 'empty') {
      ctx.tally.empty++;
    } else {
      ctx.tally.unreadable++;
      ctx.warn(`${file.name}: ${r.skip === 'too-big' ? 'too large to import' : 'could not be read'}`);
    }
  });

  if (duplicates) {
    out.warnings.unshift(
      `${duplicates} file(s) had the same name as another file in this import and were left out — one note per file name`,
    );
  }
  return out;
}

// ─── The web-page export formats: `.html` and `.mht` ───
//
// Both funnel into `parseHtmlNote`, so only two things differ between them: where the
// document comes from, and how a resource reference is resolved — a picked file on one
// side, a MIME part on the other. Identity differs too, and that lives where every
// identity rule lives (`sourceId.ts`), reached through the same two calls.

/**
 * Carry one parsed note into the tally, or report why it did not make it. Returns the
 * note for the caller to write, or `null` when there is nothing to write.
 *
 * Shared by both entry points because the accounting is the same accounting — and because
 * a second copy of it is how the two formats would come to disagree about what `dropped`
 * means.
 */
function takeHtmlNote(ctx: Ctx, fileName: string, r: HtmlParseResult): ImportedNote | null {
  if (!r.ok) {
    if (r.reason === 'empty') {
      ctx.tally.empty++;
    } else {
      ctx.tally.unreadable++;
      ctx.warn(
        `${fileName}: ${r.reason === 'too-big' ? 'the note is too large to import' : 'no readable content'}`,
      );
    }
    return null;
  }
  ctx.tally.images += r.images;
  ctx.tally.dropped += r.dropped;
  ctx.tally.attachments += r.attachments;
  if (r.missing.length) {
    // One line per file, not one per image: a folder imported without its `_files`
    // companion has hundreds, and the warning list is capped at 25 for exactly that
    // reason. Naming the first is what makes the line actionable.
    ctx.warn(`${fileName}: ${r.missing.length} image(s) not found — first: ${r.missing[0]}`);
  }
  return r.note;
}

/**
 * The single-page export detector. A warning, never a split.
 *
 * `countNoteContainers` counts the export's own note dividers, and the HTML importer does
 * not divide on them — see the header of `html.ts` for why a wrong divider test shreds a
 * note rather than degrading it. So when a file holds more than one, the file is imported
 * as one note and this says so. It is the honest version of a decision the user was
 * offered and made.
 */
function warnIfWholeNotebook(html: string, fileName: string, ctx: Ctx): void {
  const containers = countNoteContainers(html);
  if (containers >= 2) {
    ctx.warn(
      `${fileName}: ${containers} notes in one file — a whole-notebook export is imported as a single note`,
    );
  }
}

/**
 * Import a web-page export's `.html` files.
 *
 * `files` is expected to be **the `.html` files from the pick**, which is what the
 * dispatcher hands over. The images an export writes sit beside the notes in a
 * `<name>_files` folder, and a multi-file pick cannot reach into a folder — so in the
 * dialog's single-button form the index below is built from the notes alone and every
 * image reference resolves as missing. That is reported rather than hidden: `takeHtmlNote`
 * counts the placeholder images, and names the first missing one per file in the summary.
 * `makeResourceIndex` still takes a list of files rather than reaching for a folder
 * itself, so this is a limit of the picker and not of the importer — the folder form would
 * work again unchanged if a folder could ever be handed over.
 *
 * The notebook comes from the file, never from `opts.category`: a single-page export
 * names its notebook in its own file name, and letting the dialog override that would
 * file `Shop.notes.html` under whatever was typed.
 */
export async function importHtmlFiles(
  projectId: string,
  files: File[],
  opts: ImportOptions = {},
): Promise<ImportOutcome> {
  const notes = files.filter((f) => isHtmlNoteFile(f.name));
  const index = makeResourceIndex(files);

  const out = await importFiles(projectId, 'import:html', notes, opts, async (file, writer, ctx) => {
    const rel = markdownSourceId(file.webkitRelativePath || file.name);

    if (file.size > MAX_HTML_BYTES) {
      ctx.tally.unreadable++;
      ctx.warn(`${file.name}: larger than 32 MB — export the notebook per note instead`);
      return;
    }

    let html: string;
    try {
      html = await readText(file);
    } catch {
      ctx.tally.unreadable++;
      ctx.warn(`${file.name}: could not be read`);
      return;
    }

    warnIfWholeNotebook(html, file.name, ctx);

    const r = await parseHtmlNote({
      html,
      notePath: rel,
      notebook: htmlNotebook(rel),
      sourceId: () => htmlSourceId(rel),
      resolve: fileResolver(index, rel),
    });
    const note = takeHtmlNote(ctx, file.name, r);
    if (!note) return;
    await writer.add(note);
    ctx.notes++;
  });

  if (!notes.length) out.warnings.unshift('no .html files were found');
  return out;
}

/**
 * Import one or more `.mht` exports.
 *
 * The format that needs nothing else: the HTML, the images and the attachments are all in
 * the one file, so a multi-file pick is complete on its own in a way the HTML import's is
 * not. That is also why its size limit is the single-file one rather than the HTML one —
 * both are "one file, one note, resources included".
 */
export async function importMhtFiles(
  projectId: string,
  files: File[],
  opts: ImportOptions = {},
): Promise<ImportOutcome> {
  return importFiles(projectId, 'import:mht', files, opts, async (file, writer, ctx) => {
    if (file.size > MAX_MHT_BYTES) {
      ctx.tally.unreadable++;
      ctx.warn(`${file.name}: larger than 100 MB — too large to import`);
      return;
    }

    // Only the read can fail; `readMht` never throws (that is its contract), so it stays
    // outside the `try` — which also keeps `container` a `const`, and a narrowed `const`
    // is the only kind whose narrowing survives into the closure below.
    let raw: Uint8Array | null = null;
    try {
      raw = new Uint8Array(await file.arrayBuffer());
    } catch {
      raw = null;
    }
    if (!raw) {
      ctx.tally.unreadable++;
      ctx.warn(`${file.name}: could not be read`);
      return;
    }

    const container = readMht(raw);
    if (!container) {
      ctx.tally.unreadable++;
      ctx.warn(`${file.name}: not an MHTML file — a saved web page without its images is not one`);
      return;
    }
    if (container.truncated) ctx.warn(`${file.name}: the file looks truncated — its last part may be incomplete`);
    if (container.undecoded) {
      ctx.warn(`${file.name}: ${container.undecoded} part(s) used an encoding this importer does not handle`);
    }

    const html = decodeBytes(container.htmlBytes, container.htmlCharset);
    warnIfWholeNotebook(html, file.name, ctx);

    const notebook = mhtNotebook(file.name);
    const r = await parseHtmlNote({
      html,
      // Not a path: a multi-file pick gives no directory. It only feeds the fallback
      // title, and the container's `Subject` is tried before that.
      notePath: file.name,
      notebook,
      sourceId: (title) => mhtSourceId(notebook, title),
      subject: container.subject,
      resolve: (ref) => resolveMhtResource(container, ref),
    });
    const note = takeHtmlNote(ctx, file.name, r);
    if (!note) return;
    await writer.add(note);
    ctx.notes++;
  });
}
