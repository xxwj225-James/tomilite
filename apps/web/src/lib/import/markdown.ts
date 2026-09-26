// ═══ Markdown files → ImportedNote ═══
//
// The simplest of the three importers: a Markdown file is already the format notes are
// stored in, so there is nothing to convert — no DOM, no resource resolution, no
// attachment budget. What is left is decoding, the title rule and the identity.
//
// The byte-decoding chain this file used to own now lives in `text.ts`, because the HTML
// and MHTML importers needed it too — including the GBK fallback, whose reasoning is
// recorded there rather than here.

import { BUCKET_EXTS } from './buckets';
import { markdownNotebook, markdownSourceId, markdownTitle } from './sourceId';
import { readText, utcStampOf } from './text';
import { MAX_TEXT_CHARS, type ImportedNote } from './types';

/** What counts as a note in a Markdown import — Markdown, plus `.txt` because that is
 *  what a notes directory usually accumulates alongside it.
 *
 *  The extensions come from `buckets.ts` rather than being written out again here: this
 *  predicate filters the Markdown bucket, so a second list could only ever disagree with
 *  the list that filled it, and the disagreement would drop a file with nothing counted.
 */
export function isNoteFile(name: string): boolean {
  const lower = name.toLowerCase();
  return BUCKET_EXTS.markdown.some((ext) => lower.endsWith(ext));
}

export type MarkdownRead = { note: ImportedNote } | { skip: 'empty' } | { skip: 'too-big' } | { skip: 'error' };

/**
 * The path a Markdown file is identified by.
 *
 * `webkitRelativePath` is the file's path inside the folder the user picked. A `File`
 * carries it only when it came from a `webkitdirectory` input: a multi-file pick hands
 * over the bare `name` and nothing about where the file lives, so a batch chosen that way
 * is identified by file names alone.
 *
 * It lives here, exported, rather than inline at its call site because
 * `importMarkdownFiles` has to group a batch by this same value to catch two files that
 * would collapse into one note. A second expression answering "which file is this" is
 * exactly the mistake `sourceId.ts` opens by warning about.
 */
export function markdownKey(file: File): string {
  return markdownSourceId(file.webkitRelativePath || file.name);
}

/** Read one file. A file that cannot be read costs one file, never the batch. */
export async function readMarkdownFile(file: File): Promise<MarkdownRead> {
  let text: string;
  try {
    text = await readText(file);
  } catch {
    return { skip: 'error' };
  }

  if (text.length > MAX_TEXT_CHARS) return { skip: 'too-big' };
  if (!text.trim()) return { skip: 'empty' };

  // What makes re-importing the same files a no-op instead of a duplicate: the same file
  // picked twice lands on the same key. For a multi-file pick that key is the file's own
  // name — see `markdownKey` — so the *category* can no longer come from the path either,
  // and the dialog asks the user for it instead.
  const rel = markdownKey(file);

  return {
    note: {
      title: markdownTitle(rel, text),
      content: text,
      category: markdownNotebook(rel),
      sourceId: markdownSourceId(rel),
      // The file's own modified time, so an imported library sorts by when the notes
      // were written rather than by when they were imported — files imported today
      // does not become the "most recent" thing the user has ever worked on.
      //
      // It is the *modified* time and not a creation time, which is what the file
      // offering actually exposes: `File` has `lastModified` and nothing else, and
      // Windows does not track a meaningful creation time for a file that has been
      // copied or synced anyway.
      createdAt: utcStampOf(file.lastModified),
    },
  };
}
