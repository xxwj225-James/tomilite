// ═══ `[[Wiki links]]` between notes ═══
//
// A note's body is the only place a link lives. There is no link table and no
// relation column: `[[Title]]` is parsed out of the content on every read, and the
// reverse direction is that same set of edges inverted. That choice is what makes a
// link something the user can type, edit, export and carry away, instead of state
// that only this app can see.
//
// Three properties this file exists to guarantee:
//
//   **A title is not a unique key.** In the live corpus 3 groups of notes share a
//     title (`AI Panorama Complexity Badge` ×3, `Untitled Note` ×2, `AI reply` ×2) —
//     7 of 39 notes. So resolution never pretends to be exact: it reports how many
//     notes carry the title (`matches`) and picks the most recently updated one only
//     as a default for the caller that cannot ask. A back-link that silently lands on
//     the wrong one of two identically-titled notes is a bug the user will never
//     diagnose, which is why the count travels with the edge rather than being
//     swallowed here.
//
//   **Code blocks are not links.** A note ABOUT this syntax (or about any bracket
//     syntax) would otherwise sprout phantom edges, so fenced regions are skipped —
//     the same fence-tracking rule the notes panel's outline uses.
//
//   **Rewriting the link section must be idempotent and must not touch prose.** The
//     section is delimited by an HTML-comment sentinel rather than by its heading, so
//     "does this note already have links?" is an exact test rather than a guess about
//     text the user may have edited. Everything above the sentinel is structurally
//     out of reach: `replaceLinkSection` rebuilds from the sentinel down and returns
//     the bytes above it untouched. That is the whole difference between a safe
//     rewrite and a corrupting one, and it is why re-running the backfill cannot
//     double-append.
//
// Nothing here touches the database or the network.

/** Marks the region this file owns. Never localized, never rewritten, never shown. */
export const LINK_SENTINEL = '<!-- tl-links:v1 -->';

/** Longest `[[…]]` inner text considered a link. Beyond this it is prose with brackets. */
const MAX_TITLE_CHARS = 200;

/** Only used when a note has no `updatedAt` to compare — keeps the pick deterministic. */
function newestFirst(a: { id: string; updatedAt?: string | null }, b: { id: string; updatedAt?: string | null }): number {
  const at = a.updatedAt ?? '';
  const bt = b.updatedAt ?? '';
  if (at !== bt) return at < bt ? 1 : -1;
  // Same (or missing) stamp: fall back to id so the result cannot depend on row order.
  return a.id < b.id ? -1 : 1;
}

export interface NoteRef {
  id: string;
  title: string;
  updatedAt?: string | null;
  /** Where the out-links are read from. Absent means the note has no out-links. */
  content?: string | null;
}

export interface ParsedLink {
  /** The full `[[…]]` text, so a caller can render it verbatim when it does not resolve. */
  raw: string;
  title: string;
}

export interface ResolvedLink {
  /** Note the link was written in. */
  from: string;
  raw: string;
  title: string;
  /** Note it resolves to, or null when no note carries that title. */
  to: string | null;
  /** How many notes carry this title. 0 = unresolved, 1 = exact, >1 = ambiguous. */
  matches: number;
}

export interface LinkGraph {
  out: Map<string, ResolvedLink[]>;
  /** Inverted `out`: links pointing AT a note. Built once, here, so every caller
   *  agrees on what a back-link is. */
  back: Map<string, ResolvedLink[]>;
  /** Titles carried by more than one note, with their ids sorted newest-first. */
  collisions: Array<{ title: string; ids: string[] }>;
}

/**
 * Every `[[Title]]` in a body, in document order, with duplicates removed by title.
 *
 * Code is skipped, in both of its forms, because a note *about* this syntax is the note
 * most likely to contain the literal text `[[Title]]`, and turning that into an edge
 * would make the one note explaining links the one note with wrong ones.
 *
 *   Fenced blocks follow the CommonMark rule the notes outline uses: a fence opened by a
 *   run of ``` or ~~~ closes only on a bare run of the same character at least as long,
 *   so a ``` inside a ```` block does not end it.
 *
 *   Inline spans are a run of N backticks closed by a run of N backticks. Handled by
 *   blanking them out of the line before scanning, so a link that straddles a span
 *   boundary cannot be half-matched.
 */
export function parseLinks(content: string | null | undefined): ParsedLink[] {
  if (!content) return [];
  const lines = content.split('\n');
  const found: ParsedLink[] = [];
  const seen = new Set<string>();
  let fence: { ch: string; len: number } | null = null;

  for (const line of lines) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const ch = run[0];
      if (!fence) fence = { ch, len: run.length };
      else if (fence.ch === ch && run.length >= fence.len) fence = null;
      continue;
    }
    if (fence) continue;

    const scannable = line.replace(/`+[^`]*`+/g, ' ');
    const re = /\[\[([^\]\n]{1,200})\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(scannable)) !== null) {
      const title = m[1].trim();
      if (!title || title.length > MAX_TITLE_CHARS) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ raw: m[0], title });
    }
  }
  return found;
}

/** Titles are matched case-insensitively and trimmed; that is the whole index. */
function titleKey(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Resolve every note's out-links and invert them into back-links.
 *
 * `notes` must be the complete set — an index built from a filtered page of rows would
 * silently turn real links into "unresolved", which reads to the user as a broken link
 * rather than as a missing row.
 */
export function resolveLinks(notes: NoteRef[]): LinkGraph {
  const byTitle = new Map<string, NoteRef[]>();
  for (const n of notes) {
    const key = titleKey(n.title);
    if (!key) continue;
    const bucket = byTitle.get(key);
    if (bucket) bucket.push(n);
    else byTitle.set(key, [n]);
  }

  const collisions: LinkGraph['collisions'] = [];
  for (const [key, bucket] of byTitle) {
    if (bucket.length > 1) {
      collisions.push({ title: bucket[0].title, ids: [...bucket].sort(newestFirst).map((n) => n.id) });
    }
    // Sorted once here so `to` below is deterministic even when stamps tie.
    bucket.sort(newestFirst);
    void key;
  }

  const out = new Map<string, ResolvedLink[]>();
  const back = new Map<string, ResolvedLink[]>();

  for (const note of notes) {
    const edges: ResolvedLink[] = [];
    for (const parsed of parseLinks(note.content)) {
      const bucket = byTitle.get(titleKey(parsed.title)) || [];
      const edge: ResolvedLink = {
        from: note.id,
        raw: parsed.raw,
        title: parsed.title,
        to: bucket.length ? bucket[0].id : null,
        matches: bucket.length,
      };
      edges.push(edge);
      if (edge.to && edge.to !== note.id) {
        const bucketBack = back.get(edge.to);
        if (bucketBack) bucketBack.push(edge);
        else back.set(edge.to, [edge]);
      }
    }
    out.set(note.id, edges);
  }

  return { out, back, collisions };
}

/** The exact text this file is responsible for, or null when the note has no section. */
export interface LinkSectionSplit {
  /** Everything above the sentinel, with trailing whitespace removed for a stable re-append. */
  body: string;
  /** The sentinel and everything after it, or null. */
  section: string | null;
}

export function splitLinkSection(content: string | null | undefined): LinkSectionSplit {
  const text = content ?? '';
  const at = text.indexOf(LINK_SENTINEL);
  if (at === -1) return { body: text.trimEnd(), section: null };
  return { body: text.slice(0, at).trimEnd(), section: text.slice(at) };
}

export function hasLinkSection(content: string | null | undefined): boolean {
  return (content ?? '').includes(LINK_SENTINEL);
}

/** Titles already listed in the note's own section, lowercased. */
export function existingLinkTitles(content: string | null | undefined): Set<string> {
  const { section } = splitLinkSection(content);
  if (!section) return new Set();
  return new Set(parseLinks(section).map((l) => titleKey(l.title)));
}

/**
 * Replace the link section with exactly `titles`, leaving every byte above the sentinel
 * alone. An empty list removes the section entirely.
 *
 * Idempotent by construction: the new section is always rebuilt from `body`, so calling
 * this twice with the same titles produces byte-identical output. That is what makes the
 * backfill safe to re-run, and it is the reason the section is found by sentinel rather
 * than by heading text.
 */
export function replaceLinkSection(
  content: string | null | undefined,
  titles: string[],
  heading: string,
): string {
  const { body } = splitLinkSection(content);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const t of titles) {
    const trimmed = t.trim();
    const key = titleKey(trimmed);
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }

  if (unique.length === 0) return body;

  const block = [LINK_SENTINEL, heading, ...unique.map((t) => `- [[${t}]]`)].join('\n');
  return body ? `${body}\n\n${block}\n` : `${block}\n`;
}
