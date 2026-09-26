// ═══ Search result fusion — pure, no I/O ═══
//
// This module is deliberately database-free so scripts/test-search.mts can exercise
// every ranking rule directly. The I/O half lives in lib/searchCore.ts; the tRPC
// router is a shell over that. The split is what makes the two invariants below
// assertable without a server, a corpus, or an embedding model.
//
// ─── Invariant 1: OR, never AND ───
//
// Inherited from lib/fts.ts: every list here is an OR set sorted by rank. Anything
// that intersects lists would silently tighten every search in the app.
//
// ─── Invariant 2: the keyword block strictly precedes the semantic block ───
//
// Rank fusion is `score = Σ w_list / (RRF_K + rank_in_list)`, with the keyword list
// at weight 1 and the semantic lists at SEMANTIC_WEIGHT. Equal weights would make
// keyword#1 and semantic#1 both score 1/61 — a tie — and the result would be a strict
// ALTERNATION: every other row a semantic near-neighbour of a query the user may be
// looking at verbatim. That is wrong for a search box.
//
// At SEMANTIC_WEIGHT = 0.5 the separation is exact: semantic#1 = 0.5/61 = 0.008197,
// while keyword#60 (the last row we ever return) = 1/120 = 0.008333. So every
// keyword hit outranks every semantic hit.
//
// The threshold is SEMANTIC_WEIGHT < PER_LIST_KEYWORD / (2 * PER_LIST_KEYWORD) = 0.5,
// so this constant is BOUND to the keyword list length. Change one, change the other
// — the assertion in scripts/test-search.mts encodes the proof and will fail loudly
// rather than quietly interleaving the lists.

export type SearchKind = 'chat' | 'note' | 'task' | 'meeting' | 'email' | 'report';

/** How a row earned its place. `both` is the opposite of a caveat — two lists found it. */
export type MatchSource = 'keyword' | 'semantic' | 'both';

export interface SearchHit {
  kind: SearchKind;
  /** Row id: ChatMessage.id for chat, Issue.id for task, and so on. */
  id: string;
  /** Display title. Chat → the session title; task → "TL-181: <title>"; else the indexed title. */
  title: string;
  /** Windowed around the first matched term; the head of the body when nothing matched. */
  snippet: string;
  /** Fused score. Never rendered — kept for tests and log lines. */
  score: number;
  match: MatchSource;
  /** The query terms that actually matched. Empty for a semantic-only row, by construction. */
  highlights: string[];
  keywordRank?: number;
  semanticRank?: number;
  /** chat only — what the caller needs to switch session and scroll. */
  sessionId?: string;
  messageRole?: 'user' | 'assistant';
  /** meeting only — seeds the panel's in-transcript search when the match was in the body. */
  segmentQuery?: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  /**
   * Why the semantic list is empty. Surfaced so the UI can say so honestly rather than
   * presenting keyword-only results as if they were everything there is.
   */
  semantic: 'ready' | 'warming' | 'unavailable';
  /** Keyword rows before fusion — 0 is what makes the "no keyword match" banner honest. */
  keywordHits: number;
  /** 'like' when a sub-3-character term forced the substring path. Diagnostics only. */
  degraded: 'none' | 'like';
}

export const RRF_K = 60;
/** See invariant 2 above: bound to PER_LIST_KEYWORD. */
export const SEMANTIC_WEIGHT = 0.5;
export const PER_LIST_KEYWORD = 60;
export const PER_LIST_SEMANTIC = 60;
/** Soft per-kind cap so a chat-heavy corpus cannot monopolise the list. */
export const MAX_PER_KIND = 8;

export interface FusedEntry {
  id: string;
  score: number;
  match: MatchSource;
  keywordRank?: number;
  semanticRank?: number;
}

/**
 * Fuse a keyword list with N semantic lists into one ranked list of ids.
 *
 * `semanticLists` are kept separate rather than concatenated because notes and reports
 * are different corpora: a row can only appear in one of them, so a note is never
 * double-counted for being "in two semantic lists" it was never in one of.
 */
export function fuseRrf(keywordIds: string[], semanticLists: string[][]): FusedEntry[] {
  const acc = new Map<string, FusedEntry>();

  const touch = (id: string): FusedEntry => {
    let e = acc.get(id);
    if (!e) {
      e = { id, score: 0, match: 'keyword' };
      acc.set(id, e);
    }
    return e;
  };

  keywordIds.slice(0, PER_LIST_KEYWORD).forEach((id, i) => {
    const e = touch(id);
    e.score += 1 / (RRF_K + i + 1);
    e.keywordRank = i + 1;
  });

  for (const list of semanticLists) {
    list.slice(0, PER_LIST_SEMANTIC).forEach((id, i) => {
      const e = touch(id);
      // A semantic list has no weight of its own beyond SEMANTIC_WEIGHT: notes and
      // reports are not in competition, they are two halves of one recall path.
      e.score += SEMANTIC_WEIGHT / (RRF_K + i + 1);
      if (e.semanticRank === undefined) e.semanticRank = i + 1;
    });
  }

  for (const e of acc.values()) {
    e.match = e.keywordRank !== undefined ? (e.semanticRank !== undefined ? 'both' : 'keyword') : 'semantic';
  }

  return [...acc.values()].sort(compareEntries);
}

function compareEntries(a: FusedEntry, b: FusedEntry): number {
  if (b.score !== a.score) return b.score - a.score;
  const ak = a.keywordRank ?? Number.POSITIVE_INFINITY;
  const bk = b.keywordRank ?? Number.POSITIVE_INFINITY;
  if (ak !== bk) return ak - bk;
  const as = a.semanticRank ?? Number.POSITIVE_INFINITY;
  const bs = b.semanticRank ?? Number.POSITIVE_INFINITY;
  if (as !== bs) return as - bs;
  // A stable final tiebreak keeps the order deterministic for tests. Without it the
  // sort would fall back to Map insertion order, which is a property of the queries.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Take up to `limit` entries, allowing at most `maxPerKind` of any one kind on the
 * first pass. A second uncapped pass fills any shortfall.
 *
 * The cap is a PROMOTION mechanism, not a quota — read the second pass as the point
 * rather than as an escape hatch. Its job is to stop a chat-heavy corpus from pushing
 * every rare kind past the cut: with 20 chat rows ahead of 5 note rows and a limit of
 * 20, the uncapped list contains no notes at all, and the first pass lifts them to
 * positions 9-13 where they are actually visible.
 *
 * What it deliberately does NOT do is truncate. If 30 of one kind and 3 of another
 * match, the result is 25 rows with the rare ones promoted, not 11 rows. Returning 11
 * would report a smaller corpus than exists, and this design has no per-kind filter
 * for the user to recover the rest with — the rows would simply be lost.
 */
export function applyKindCap<T extends { id: string }>(
  entries: T[],
  kindOf: (e: T) => string,
  limit: number,
  maxPerKind = MAX_PER_KIND,
): T[] {
  const counts = new Map<string, number>();
  const taken = new Set<string>();
  const out: T[] = [];

  for (const e of entries) {
    if (out.length >= limit) return out;
    const k = kindOf(e);
    const n = counts.get(k) ?? 0;
    if (n >= maxPerKind) continue;
    counts.set(k, n + 1);
    taken.add(e.id);
    out.push(e);
  }
  if (out.length >= limit) return out;

  for (const e of entries) {
    if (out.length >= limit) break;
    if (taken.has(e.id)) continue;
    taken.add(e.id);
    out.push(e);
  }
  return out;
}

// ─── Snippets ───

export const SNIPPET_WIDTH = 180;
export const SNIPPET_LEAD = 60;

/**
 * The index of the earliest occurrence of any term, or -1.
 *
 * Case-insensitive for ASCII, exact for everything else. The lowercased haystack is
 * only trusted when lowercasing did not change its length — a few Unicode characters
 * ('İ' → 'i̇') expand, which would shift every index after them and silently window
 * the snippet in the wrong place.
 */
export function firstIndexOfAny(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  const usable = lower.length === text.length;
  let best = -1;
  for (const t of terms) {
    if (!t) continue;
    if (usable) {
      const i = lower.indexOf(t.toLowerCase());
      if (i >= 0 && (best < 0 || i < best)) best = i;
    } else {
      const i = text.indexOf(t);
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
  }
  return best;
}

/**
 * A window of `body` around the first matched term, or the head of the body when
 * nothing matched (a semantic-only hit has no terms, and an FTS hit can match in a
 * column the caller did not pass).
 *
 * This replaces the `body.substring(0, 150)` the old router used, which showed the
 * first line of a long note rather than the line that matched. It is also the only
 * thing that produces a non-empty snippet for chat, whose text sits in `body` while
 * its `title` is empty.
 */
export function windowSnippet(body: string, terms: string[]): string {
  const idx = firstIndexOfAny(body, terms);
  if (idx < 0) {
    const head = body.slice(0, SNIPPET_WIDTH).trim();
    return body.trim().length > SNIPPET_WIDTH ? `${head}…` : head;
  }
  const start = Math.max(0, idx - SNIPPET_LEAD);
  const end = Math.min(body.length, start + SNIPPET_WIDTH);
  return `${start > 0 ? '…' : ''}${body.slice(start, end).trim()}${end < body.length ? '…' : ''}`;
}
