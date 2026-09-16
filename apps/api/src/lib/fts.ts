// ═══ FTS5 query helpers ═══
//
// global_fts is tokenized with `trigram` (see lib/ftsIndex.ts). That is what makes
// Chinese substring search work at all, but it imposes two rules on every caller:
//
//   1. Every term must be quoted. A bare `TL-181` makes fts5 parse `-` as an
//      operator ("no such column: 181") and a bare `a"b` throws "unterminated
//      string" — both are reachable from ordinary user input, so the raw string
//      must never reach MATCH. Quoting fixes both (inner quotes are doubled).
//
//   2. A term shorter than 3 characters can never match: the trigram tokenizer
//      indexes overlapping 3-character sequences. Chinese 2-character words
//      ("迁移", "周报", "向量") are exactly that case, which is not a corner case
//      here but the common one — unsearchableTerms() is how a caller learns it
//      needs the LIKE path instead.
//
// Keep OR, never AND. All three readers sort an OR set by `rank`; switching to AND
// would silently tighten every search in the app.

/**
 * Bumped whenever the global_fts DDL, its triggers, or the embed_queue DDL
 * changes. Stamped into SystemConfig.ftsVersion by lib/ftsIndex.ts, which
 * re-evaluates it on every boot — a mismatch triggers a rebuild.
 */
export const INDEX_VERSION = 2;

/** Whitespace-split terms, empties dropped, exact duplicates removed. */
export function ftsTerms(raw: string): string[] {
  const seen = new Set<string>();
  for (const t of raw.split(/\s+/)) {
    if (t) seen.add(t);
  }
  return [...seen];
}

/**
 * Can the trigram tokenizer serve this term? Counts code points, not UTF-16
 * units, so astral-plane CJK (𠀀 …) counts as one character rather than two.
 */
export function isTrigramSearchable(term: string): boolean {
  return Array.from(term).length >= 3;
}

/**
 * FTS5 MATCH expression for `raw`, or null when nothing in it is searchable —
 * callers return [] rather than passing null to MATCH, which is a syntax error.
 */
export function toFtsMatch(raw: string): string | null {
  const terms = ftsTerms(raw).filter(isTrigramSearchable);
  if (terms.length === 0) return null;
  return terms.map(quoteTerm).join(' OR ');
}

/** The terms trigram structurally cannot serve — the caller's cue to use LIKE. */
export function unsearchableTerms(raw: string): string[] {
  return ftsTerms(raw).filter((t) => !isTrigramSearchable(t));
}

/** `"` is fts5's string delimiter, so an inner quote must be doubled. */
function quoteTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}
