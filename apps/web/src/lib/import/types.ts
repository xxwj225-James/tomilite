// ═══ The vocabulary the three importers share ═══
//
// Kept in its own module so `markdown.ts`, `htmlNote.ts` and `mht.ts` can all speak it
// without importing each other — and so `runImport.ts`, which drives all three, is not
// also the place the types are declared (that arrangement is a cycle waiting to happen).

/** One note, parsed and ready to be written. Mirrors `wiki.importNotes`' input row. */
export type ImportedNote = {
  title: string;
  content: string;
  /** The notebook. Chosen in the dialog for a Markdown import; the file name for a
   *  `.html` or `.mht` export, which names its own. */
  category: string;
  /** The merge key's other half. See `sourceId.ts` for how each is derived. */
  sourceId: string;
  /** The note's own date, as a naive-UTC stamp (`YYYY-MM-DD HH:MM:SS`). Absent means
   *  "the source did not say", and the API stamps the import time instead. */
  createdAt?: string;
};

/**
 * Why the importer did not keep something. Counted, never fatal: an import of a real
 * library always hits a few of these, and a single unreadable note must not lose the
 * other 499.
 */
export type ImportTally = {
  /** Notes in the batch the API wrote. */
  created: number;
  updated: number;
  skipped: number;
  /** Resources inlined as data URLs. */
  images: number;
  /** Resources replaced by a placeholder line: too big, the note's budget was full, not
   *  present in what was picked, or claimed by more than one file. The four are one
   *  number because the user's action is the same — the note needs a look — and because
   *  the *reason* belongs in the warning text, not in a fourth counter nobody reads. */
  dropped: number;
  /** Non-image resources (PDFs, audio) — a placeholder line each, by design. */
  attachments: number;
  /** Files that could not be parsed. */
  unreadable: number;
  /** Files with no content to import — a 0-byte `.md`, a `.html` with no body. */
  empty: number;
};

export function emptyTally(): ImportTally {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
    images: 0,
    dropped: 0,
    attachments: 0,
    unreadable: 0,
    empty: 0,
  };
}

// ─── Size limits ───
//
// These are the load-bearing part of the "inline the images" decision, not a detail of
// it. Every inlined byte is written to `KnowledgePage.content`, copied in full into
// `global_fts` by the notes trigger, and then re-embedded for semantic search — so the
// database grows by roughly twice the base64, and one imported library can be hundreds
// of megabytes of screenshots.
//
// The numbers are chosen against `embedTextFor`'s 512-token window and the panel's
// payload, not against what a file "should" be.

/** Per image, measured on the base64 payload. A screenshot that fits in a chat message
 *  is under this; a 4 MB phone photo is not, and should not become FTS rows. */
export const MAX_IMAGE_BYTES = 256 * 1024;

/** Per note, base64 payload, summed across its images. Past this the images after the
 *  budget are placeholders and the prose is untouched. */
export const MAX_NOTE_BYTES = 1024 * 1024;

/** One `.html` note file, below the single-file formats by 3× because the two are not the
 *  same measurement: a `.mht` this size holds one note with its resources, while an HTML
 *  file this size is a whole notebook exported as one page — which the importer cannot
 *  split (see `html.ts`). The ceiling is what keeps that mistake from becoming a 32 MB
 *  note row, while staying far above a real note with a few screenshots base64'd into it.
 */
export const MAX_HTML_BYTES = 32 * 1024 * 1024;

/** One `.mht` file: "one file, one note, resources included", so a file this size means
 *  a note this size. Read whole into memory and parsed, which is why there is a ceiling
 *  at all rather than a streaming reader. */
export const MAX_MHT_BYTES = 100 * 1024 * 1024;

/** Characters of a single Markdown file. Below `wiki.importNotes`' own 4,000,000 limit
 *  on purpose: that limit rejects the *whole batch*, so one oversized file would take
 *  24 unrelated notes down with it. A note this large is not a note. */
export const MAX_TEXT_CHARS = 3_000_000;

/** Notes per `wiki.importNotes` call — the API caps a batch at 100, and a smaller
 *  batch keeps one failure from discarding a whole import's progress. */
export const IMPORT_BATCH = 25;

/** Placeholder left where an <img> or a non-image resource used to be. One line so it
 *  reads as a note the user can annotate, not as a parse failure. */
export function attachmentPlaceholder(name: string): string {
  return `> [${name}]`;
}

/**
 * A resource a note's markup pointed at, resolved — or a statement about why it cannot be.
 *
 * Both new importers rewrite `<img>` elements before turndown sees them, and both have to
 * say the same four things about a reference that neither can know on its own: an HTML
 * import is told by a folder of picked `File`s, an `.mht` import by the container's own
 * parts. The vocabulary is shared for the same reason `Budget` is — "does this image keep
 * its pixels" must have exactly one answer, and `htmlNote.ts`, which does the rewriting,
 * must not have to know which of the two it is working for.
 *
 * `read` is a function and not a string because the two differ exactly there: a `File` is
 * turned into a data URL by the browser's own encoder (`FileReader`), while an MHTML part
 * is already bytes in hand and goes through `bytesToB64`. Making the caller start
 * encoding before it knows whether the budget allows it would also mean a 40 MB image
 * becomes a 53 MB string before being thrown away.
 */
export type ResolvedResource =
  | { kind: 'found'; name: string; mime: string; size: number; read: () => Promise<string> }
  /** Not a local file at all — a remote image in a clipped note, a `data:` URL already
   *  inline. Left exactly as it is, and counted as nothing. */
  | { kind: 'external' }
  /** Local, and nothing in the import answers to it. */
  | { kind: 'missing' }
  /** Local, and more than one file answers to it. */
  | { kind: 'ambiguous' };

/**
 * The image budget, consumed in document order.
 *
 * Order matters and is the point: the first images in a note are the ones the user sees
 * first, so they are the ones that keep their pixels when a note turns out to be 40
 * screenshots long.
 *
 * Shared rather than declared per importer because "does this image keep its pixels" must
 * have exactly one answer. An import that inlined one image too many because two copies
 * of the condition disagreed is not a bug anyone finds by reading a note.
 */
export type Budget = { used: number; images: number; dropped: number; attachments: number };

export function newBudget(): Budget {
  return { used: 0, images: 0, dropped: 0, attachments: 0 };
}

/**
 * Take the budget for one image, or refuse it. True means "inline it".
 *
 * `b64Length` is the length of the **base64 payload**, which is the unit both caps are
 * defined in. Measuring a resource's decoded bytes instead would let an image a third
 * larger than `MAX_IMAGE_BYTES` through, silently, for every image.
 */
export function reserveImage(budget: Budget, b64Length: number): boolean {
  if (b64Length > MAX_IMAGE_BYTES) return false;
  if (budget.used + b64Length > MAX_NOTE_BYTES) return false;
  budget.used += b64Length;
  budget.images++;
  return true;
}
