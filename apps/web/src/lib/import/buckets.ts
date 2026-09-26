// ═══ Which importer a picked file belongs to ═══
//
// One pick, one button, any supported format. `wiki.importNotes` takes **one `source` per
// batch** and its schema rejects a source it does not know, failing the whole batch — so a
// pick that spans formats has to be split by extension and written one format at a time.
// This module is that split, and it is the only place the question is answered.
//
// ## Why extensions, and not the per-module predicates
//
// `markdown.ts` and `html.ts` already answer "is this a note file of my kind", and those
// answers are still used to filter, downstream. But "which of the three owns this file" is
// a **partition** question — an answer of "not mine" from one predicate says nothing about
// whether another claims it — and the `<input accept>` attribute needs the same partition
// in string form. Deriving all three from one list is what keeps them from disagreeing:
// the two predicates below now ask this module rather than carrying their own extension
// lists.
//
// The disagreement that matters is silent rather than loud. A file the picker offers and
// the bucketer accepts, but the importer's own filter then rejects, is dropped without
// being counted anywhere — the dispatcher has already decided the file belonged to a
// bucket, so it is not in its "not a format this imports" count either. One list makes
// that state unrepresentable. `scripts/test-import-pick.mts` asserts it, and asserts that
// the three sets stay disjoint: an extension in two buckets would make the order of
// `IMPORT_ORDER` decide the owner, which is not a decision anyone should inherit by
// accident.
//
// ## Case
//
// Compared case-insensitively, because the picker's filter is: `accept` is matched against
// the extension without regard to case on every platform this ships to, so `.MD` is
// offered to the user and has to land somewhere. It lands here.
//
// ## Zero imports
//
// Like `text.ts` and `mht.ts`, this module pulls in nothing, so `npx tsx` can run it
// directly (see `scripts/test-import-pick.mts`) and the generic below takes `{ name }`
// rather than `File` — a test does not need a DOM to ask what happens to `a.md`.

/** The three importers, named by format rather than by any application that writes it. */
export type ImportBucket = 'markdown' | 'html' | 'mht';

/**
 * The extensions each importer takes.
 *
 * The order the buckets are listed here is also the order the dispatcher runs them in
 * (`IMPORT_ORDER`), and it is fixed so that the same pick reports the same way twice.
 *
 * `.txt` is in with Markdown because that is what a notes directory accumulates alongside
 * `.md`, and a `.txt` holds the same thing a `.md` holds — prose, stored as prose.
 */
export const BUCKET_EXTS: Record<ImportBucket, readonly string[]> = {
  markdown: ['.md', '.markdown', '.txt'],
  html: ['.html', '.htm'],
  mht: ['.mht', '.mhtml'],
};

/** The order the formats are imported in. Fixed, not derived: see the doc on the type. */
export const IMPORT_ORDER: readonly ImportBucket[] = ['markdown', 'html', 'mht'];

/** For `<input accept>`. Built from `BUCKET_EXTS` so the picker's filter and the bucketer
 *  cannot come apart — a file the user can pick is a file that has an owner. */
export const IMPORT_ACCEPT: string = IMPORT_ORDER.flatMap((b) => BUCKET_EXTS[b]).join(',');

/** A pick, split. `unknown` is the caller's to report: files the picker offered that no
 *  importer claims, which happens as soon as the user switches the filter to "all files". */
export type Bucketed<T> = { markdown: T[]; html: T[]; mht: T[]; unknown: T[] };

/** Which importer owns this file name, or `null` when none does. */
export function bucketOf(name: string): ImportBucket | null {
  const lower = name.toLowerCase();
  for (const bucket of IMPORT_ORDER) {
    for (const ext of BUCKET_EXTS[bucket]) if (lower.endsWith(ext)) return bucket;
  }
  return null;
}

/**
 * Split one pick into the files each importer takes.
 *
 * Keeps the pick's own order inside each bucket, and does not touch the input — the caller
 * still holds the selection it was handed.
 *
 * Note what is **not** here: images and other resources a note points at. A single file
 * pick cannot see the folder a file sat in, so a `.html` export's `_files` companions are
 * not in `files` at all and every image reference resolves as missing. That is the accepted
 * cost of one button instead of two — see `importHtmlFiles`.
 */
export function bucketPickedFiles<T extends { name: string }>(files: T[]): Bucketed<T> {
  const out: Bucketed<T> = { markdown: [], html: [], mht: [], unknown: [] };
  for (const file of files) {
    const bucket = bucketOf(file.name);
    if (bucket) out[bucket].push(file);
    else out.unknown.push(file);
  }
  return out;
}
