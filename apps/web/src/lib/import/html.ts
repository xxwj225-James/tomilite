// ═══ The web-page export — the half that needs no DOM ═══
//
// Free of `DOMParser` and `FileReader` on purpose: these are questions about *text and
// paths*, and a question about text can be answered directly under Node
// (`scripts/test-import-mime.mts`), while the same question asked through a DOM can only
// be answered by opening the app and looking at a note.
//
// ## One HTML file is one note — and what that costs
//
// Nothing escapes the markup inside an exported note body, so a body may contain anything
// a web page may contain — including whatever the exporter uses as a divider. The marker
// this format uses is worse than it looks:
//
//   <a name="506"/>          ← the note divider, read off a real export (2026-09-22)
//
// It is **self-closing**, and in `text/html` an `<a>` cannot be self-closed — the HTML
// parser leaves it open and hands its content to the next `<a>` tag. So the divider that
// looks like an empty marker is, in the DOM, an element wrapping the entire rest of the
// file: a splitter walking `body.children` would find one note, not N. Splitting would have
// to happen on the string, before parsing.
//
// It is not done here, and that is a decision rather than an omission. The delimiter is
// distinguishable from an in-page anchor only by *also* requiring that the anchor is
// empty — and a note clipped from a web page is full of `<a name="section3">` anchors that
// are. Getting that test wrong does not degrade the import, it **shreds every note into
// fragments**, each with an invented title and an invented id. The cost is asymmetric, so
// the file is imported as one note and `countNoteContainers` reports how many dividers
// were in it — a sentence in the summary, not a guess in the data.
//
// The user was offered both and chose the sentence. If a ≥2-note export ever lands, the
// split belongs here (string-level, before parsing) and `htmlSourceId` grows the per-note
// key; nothing else in the importer would move.

import { BUCKET_EXTS } from './buckets';
import { basenameOf, dirOf, localRef, refCandidates, resolveRelative } from './refs';
import { markdownSourceId } from './sourceId';

/** What kind of file the picker handed over. `.html` and `.htm` are both written by the
 *  exporter depending on version, and both are notes; everything else in a folder is a
 *  resource, which is why this is a *new* predicate rather than a widening of
 *  `markdown.ts`'s: a `.html` sent to the Markdown reader would be imported as its own
 *  source text.
 *
 *  The extensions come from `buckets.ts`, which is what fills the bucket this filters —
 *  see the note on `isNoteFile`. */
export function isHtmlNoteFile(name: string): boolean {
  const lower = name.toLowerCase();
  return BUCKET_EXTS.html.some((ext) => lower.endsWith(ext));
}

/** `<a …>`, capturing the attribute text. */
const ANCHOR = /<a\b([^>]*)>/gi;
/** A `name` attribute on that tag, quoted or bare. Anchored to whitespace rather than to
 *  `\b`, because a `\b` also matches after the hyphen in `data-name="…"` — an attribute
 *  that has nothing to do with a note divider. */
const NAME_ATTR = /(?:^|\s)name\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;

/**
 * How many note dividers the file contains — the "looks like more than one note" detector.
 *
 * Counts only anchors that are **empty**: self-closing (`<a name="506"/>`, what the
 * exporter writes) or an immediately-closed pair (`<a name="506"></a>`). An anchor with
 * text between its tags is an in-page anchor and is not counted, which is the one
 * concession this can make towards telling a clipped web page's table of contents apart
 * from a note boundary.
 *
 * It is a pure string count and deliberately not a DOM query: the `<a>` elements in a
 * parsed document are nested inside each other (see the header), so counting them through
 * the DOM would count one per file no matter what the file holds.
 */
export function countNoteContainers(html: string): number {
  let count = 0;
  ANCHOR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANCHOR.exec(html)) !== null) {
    const attrs = m[1];
    if (!NAME_ATTR.test(attrs)) continue;
    if (/\/\s*$/.test(attrs)) {
      count++;
      continue;
    }
    if (/^\s*<\/a\s*>/i.test(html.slice(m.index + m[0].length))) count++;
  }
  return count;
}

/**
 * Titles that belong to the export rather than to the note.
 *
 * Every HTML export writes the same `<title>Evernote Export</title>` — verified across
 * both the `.html` and the `.mht` of one real export, and it is the format's title, not
 * the note's. Without this list every note in the library would be called "Evernote
 * Export", which is a worse outcome than a filename: it is confidently wrong, and the
 * user cannot tell it apart from a note that really is about Evernote's export format.
 *
 * Compared case-insensitively and ignoring surrounding whitespace, because the exporter's
 * capitalisation is not something to depend on.
 */
const GENERIC_TITLES = new Set(['evernote export', 'evernote 导出', '印象笔记导出', 'untitled']);

export function isGenericTitle(title: string): boolean {
  return GENERIC_TITLES.has(title.trim().toLowerCase());
}

// ─── Finding the files a note's images refer to ───

export type RefLookup =
  /** The reference names a file that was picked. */
  | { kind: 'found'; file: File }
  /** The reference does not name a local file at all — a remote image in a clipped note,
   *  a `data:` URL already inline. **Not** a failure: leave the element alone. */
  | { kind: 'external' }
  /** Local, and nothing in the batch answers to it. */
  | { kind: 'missing' }
  /** Local, and more than one file answers to it. Refused rather than guessed. */
  | { kind: 'ambiguous' };

/** Every `/`-suffix of a path, longest first: `a/b/c` → `a/b/c`, `b/c`, `c`. */
function suffixesOf(path: string): string[] {
  const out = [path];
  for (let i = path.indexOf('/'); i >= 0; i = path.indexOf('/', i + 1)) out.push(path.slice(i + 1));
  return out;
}

function claim(map: Map<string, File | null>, key: string, file: File): void {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, file);
    return;
  }
  if (map.get(key) !== file) map.set(key, null); // two different files claim one name
}

/**
 * An index of everything the picker handed over, and a function that asks it for a
 * reference.
 *
 * ## Three levels of lookup, in one walk
 *
 * The lookup is by **suffix, longest first**, and that single mechanism is the three
 * levels it is worth describing as three:
 *
 *   1. the reference resolved against the note's own directory — `Shop.notes_files/a.png`
 *      from a note in `Shop` finds `Shop/Shop.notes_files/a.png`. This is the level that
 *      works for the real export, whose references are relative and carry a `?t=` query.
 *   2. a shorter suffix, for a note that was moved out of its folder or a reference
 *      written against the picked folder rather than the note's own.
 *   3. the bare file name, for a reference with no directory at all.
 *
 * The **first** level that exists decides. That is the whole of the ambiguity rule: a
 * name that two files claim is stored as `null`, and the lookup returns `ambiguous`
 * rather than falling through to a shorter — and even less specific — level. Guessing
 * would put the wrong picture in the note, which the user cannot see is wrong; a
 * placeholder line is visible and says which file was wanted.
 *
 * `_files` folders are where this earns its keep: `image001.png` is a name that repeats in
 * every one of them, so files picked as a folder produce many claims on it and none of
 * them win — while `Shop.notes_files/image001.png`, if unique, does.
 */
export function makeResourceIndex(files: File[]): (ref: string, notePath: string) => RefLookup {
  const byKey = new Map<string, File | null>();
  for (const file of files) {
    // `webkitRelativePath` for a folder pick, the bare name for a multi-file pick — the
    // same value `markdownSourceId` exists to normalise, reused so a batch imported from
    // two machines does not index differently.
    const rel = markdownSourceId(file.webkitRelativePath || file.name);
    for (const key of suffixesOf(rel)) claim(byKey, key, file);
  }

  return (ref: string, notePath: string): RefLookup => {
    if (localRef(ref) === null) return { kind: 'external' };
    const resolved = resolveRelative(dirOf(notePath), ref);
    if (!resolved) return { kind: 'missing' };

    // Both forms of the reference are tried: the exporter writes it raw (with a space in
    // a file name), while reading `img.src` as a *property* hands back a percent-encoded
    // path. `refCandidates` returns the raw form first, which is the one that matches.
    for (const candidate of refCandidates(resolved)) {
      for (const key of suffixesOf(candidate)) {
        if (!byKey.has(key)) continue;
        const hit = byKey.get(key);
        return hit ? { kind: 'found', file: hit } : { kind: 'ambiguous' };
      }
    }
    return { kind: 'missing' };
  };
}

/** The file name to show for a reference that could not be resolved — the last segment,
 *  because a summary line reading `Shop.notes_files/a.png` in a note about `a.png` is
 *  showing the reader a path they did not write. */
export function refDisplayName(ref: string): string {
  return basenameOf(ref) || ref;
}
