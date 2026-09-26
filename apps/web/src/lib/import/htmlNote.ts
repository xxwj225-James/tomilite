// ═══ An HTML (or MHTML) body → ImportedNote ═══
//
// The DOM half of the two new importers, shared between them because after the container
// is out of the way there is nothing left to tell apart: an `.html` export and the HTML
// part of an `.mht` are the same document, and both go through the same rewrite and the
// same `htmlToMarkdown`.
//
// ## One file is one note, and the title has to come from somewhere
//
// No splitting: see the header of `html.ts` for why the divider marker cannot be trusted.
//
// The title is the awkward part. A real export (2026-09-22) contains **no per-note title
// anywhere** — not in `<title>`, which is the format's own `Evernote Export` on every
// file; not in an `<h1>`, which the welcome note does not have; not in a comment or a
// meta tag. So the ladder below ends at the file name, and each rung above it is a guess
// the document has to earn by actually carrying something.
//
// ## What an HTML note does *not* carry, and is not faked
//
// A date. The export has no per-note timestamp, and the only time it does record is when
// the export ran — the file's mtime and, on an `.mht`, its `Date:` header. Stamping that
// on every note would give a whole imported library a single shared timestamp and present
// it as the date the notes were written. `createdAt` is therefore left absent, which the
// API reads as "the source did not say" and fills with the import time — a value that is
// at least labelled as what it is.
//
// ## The rewrite runs before turndown, and turndown needs no `<img>` rule
//
// By the time the converter sees the tree, every image that could be resolved is a plain
// `<img>` with an inline data URL — the same shape `MarkdownEditor` writes for a pasted
// image — and every one that could not is a `data-tl-ph` span the converter's one rule
// turns into a placeholder line. That is why the two formats that had to resolve resources
// needed no converter change between them.

import { htmlToMarkdown } from './htmlToMarkdown';
import { htmlTitle } from './sourceId';
import { isGenericTitle, refDisplayName, type RefLookup } from './html';
import { placeholder, inlineImage } from './dom';
import {
  MAX_TEXT_CHARS,
  attachmentPlaceholder,
  newBudget,
  reserveImage,
  type ImportedNote,
  type ResolvedResource,
} from './types';

export type HtmlParseResult =
  | {
      ok: true;
      note: ImportedNote;
      images: number;
      dropped: number;
      attachments: number;
      /** References that named a local file the import does not have, by the name the
       *  note used. Deduplicated, and reported by the caller as one line per file. */
      missing: string[];
    }
  | { ok: false; reason: 'empty' | 'too-big' };

export type HtmlNoteArgs = {
  html: string;
  /** Relative path within the pick. Identity for an `.html`; only the fallback title for
   *  an `.mht`, which has no path worth speaking of. */
  notePath: string;
  notebook: string;
  /** The merge key's second half, derived by the caller from the same identity rules as
   *  every other importer — see `sourceId.ts`, which is the only place one is made. */
  sourceId: (title: string) => string;
  resolve: (ref: string) => ResolvedResource;
  /** The container's own title, when it has one: `Subject:` on an `.mht`. The observed
   *  export has none, so this is a rung that is usually absent rather than a load-bearing
   *  one. */
  subject?: string;
};

/** Extensions `File.type` can be blank for — a folder picked on a machine with no MIME
 *  mapping for the extension. Enough to cover what an image folder holds. */
const IMAGE_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
};

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXT[ext] ?? '';
}

/**
 * The title, from the most specific thing the file actually carries down to its name.
 *
 * The two middle rungs are guarded by `isGenericTitle`: without it every note in the
 * library would be called `Evernote Export`, which is worse than the file name — it is
 * confidently wrong, and indistinguishable from a note that really is about the export
 * format.
 */
function pickTitle(doc: Document, notePath: string, subject?: string): string {
  for (const candidate of [subject ?? '', doc.title || '', doc.querySelector('h1')?.textContent ?? '']) {
    const t = candidate.trim();
    if (t && !isGenericTitle(t)) return t.slice(0, 300);
  }
  return htmlTitle(notePath);
}

/** `File` → data URL through the browser's own encoder.
 *
 *  Not `bytesToB64`: `FileReader` already knows how to do this, correctly, for a file of
 *  any size, without the caller holding a second copy of the bytes as a binary string. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('unreadable'));
    reader.readAsDataURL(file);
  });
}

/**
 * Turn the picked-files index from `html.ts` into the `ResolvedResource` vocabulary the
 * note parser speaks.
 *
 * The three failure kinds pass straight through: the index already decided whether a
 * reference is external, absent, or claimed twice, and re-deciding here is how the two
 * answers drift.
 */
export function fileResolver(index: (ref: string, notePath: string) => RefLookup, notePath: string) {
  return (ref: string): ResolvedResource => {
    const hit = index(ref, notePath);
    if (hit.kind !== 'found') return hit;
    const file = hit.file;
    return {
      kind: 'found',
      name: file.name,
      mime: file.type || guessMime(file.name),
      size: file.size,
      read: () => readAsDataUrl(file),
    };
  };
}

/**
 * Parse one HTML document into one note.
 *
 * Never throws: an import is a batch job over a folder of exports, some of which will be
 * damaged, and one bad file must cost exactly one file.
 */
export async function parseHtmlNote(args: HtmlNoteArgs): Promise<HtmlParseResult> {
  const doc = new DOMParser().parseFromString(args.html, 'text/html');
  const body = doc.body;
  if (!body) return { ok: false, reason: 'empty' };

  const title = pickTitle(doc, args.notePath, args.subject);
  const budget = newBudget();
  const missing = new Set<string>();

  // Collected before any replacement. This is a live `NodeList` off the document, and
  // mutating the tree while walking it is how half a note gets rewritten.
  for (const img of Array.from(body.querySelectorAll('img'))) {
    const ref = img.getAttribute('src') ?? '';
    const res = args.resolve(ref);

    if (res.kind === 'external') continue; // leave it as it is, and count nothing

    if (res.kind === 'missing' || res.kind === 'ambiguous') {
      const name = refDisplayName(ref);
      missing.add(res.kind === 'ambiguous' ? `${name} (two files match)` : name);
      budget.dropped++;
      placeholder(doc, img, attachmentPlaceholder(name));
      continue;
    }

    if (!/^image\//i.test(res.mime)) {
      // A PDF or a spreadsheet the note embedded as an image, or a file whose kind the
      // export did not record. Named, so the user can go and find it.
      budget.attachments++;
      placeholder(doc, img, attachmentPlaceholder(res.name));
      continue;
    }

    // The budget is checked **before** any encoding happens, and on the same unit the
    // caps are defined in: `4 * ceil(n / 3)` is the base64 length of `n` bytes, which is
    // what `MAX_IMAGE_BYTES` measures. Otherwise a 40 MB photo becomes a 53 MB string
    // first and is thrown away second.
    if (!reserveImage(budget, 4 * Math.ceil(res.size / 3))) {
      budget.dropped++;
      placeholder(doc, img, attachmentPlaceholder(res.name));
      continue;
    }

    try {
      inlineImage(doc, img, await res.read(), res.name);
    } catch {
      // The budget was already taken and stays taken: the bytes were going to be there,
      // and giving the slot back would let a later image in the same note be inlined on
      // the strength of a file that never arrived.
      budget.images--;
      budget.dropped++;
      placeholder(doc, img, attachmentPlaceholder(res.name));
    }
  }

  const content = await htmlToMarkdown(body);
  if (!content.trim()) return { ok: false, reason: 'empty' };
  // Past `wiki.importNotes`' own 4,000,000-character limit, and checked here for the
  // reason `MAX_TEXT_CHARS` exists: that limit rejects the **whole batch**, so one page
  // this large would take two dozen unrelated notes down with it. Reachable in practice —
  // a single-page notebook export, or a note with several screenshots inlined.
  if (content.length > MAX_TEXT_CHARS) return { ok: false, reason: 'too-big' };

  return {
    ok: true,
    note: {
      title,
      content,
      category: args.notebook,
      sourceId: args.sourceId(title),
      // No `createdAt`: see the header. The export records when it ran, not when the
      // note was written.
    },
    images: budget.images,
    dropped: budget.dropped,
    attachments: budget.attachments,
    missing: [...missing],
  };
}
