// ═══ Splitting text on search terms, for rendering <mark> ═══
//
// Deliberately not a regex. A search term is user input, so a regex would have to be
// escaped first — and escaping is exactly where this goes wrong: `数据库（迁移` or a
// stray `\` turns into a pattern that either throws or silently matches nothing. A
// plain indexOf scan needs no escaping and is correct for CJK by construction, because
// there is no case folding or word boundary to get wrong.
//
// The caller renders the pieces as React elements. Nothing here returns HTML, and no
// caller may put the result through dangerouslySetInnerHTML: snippets come from user
// content (chat messages, email bodies) and would otherwise be an injection point.

export interface TextPiece {
  text: string;
  /** True when this piece is one of the terms — the caller wraps it in <mark>. */
  hit: boolean;
}

/**
 * Split `text` into alternating non-matching and matching pieces.
 *
 * Overlapping terms are handled by taking the earliest match and then continuing after
 * it, so a term swallowed by an earlier one is not matched twice — "数据库" and "数据"
 * against "数据库迁移" yields one hit, not two overlapping ones.
 *
 * Case-insensitive for ASCII only in the sense that the matched slice is returned as it
 * appears in the original text: the comparison folds case, the output does not. That
 * keeps a snippet rendered from this readable, which matters more here than marking the
 * exact bytes the index matched.
 */
export function splitOnTerms(text: string, terms: string[]): TextPiece[] {
  const needles = terms.map((t) => t.trim()).filter((t) => t.length > 0);
  if (!text) return [];
  if (needles.length === 0) return [{ text, hit: false }];

  const pieces: TextPiece[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let bestAt = -1;
    let bestLen = 0;
    for (const needle of needles) {
      const at = text.toLowerCase().indexOf(needle.toLowerCase(), cursor);
      // `at < bestAt` rather than a plain minimum: on a tie the longer term wins, which
      // is what keeps "数据库迁移" from being marked as "数据库" + a stray "迁移".
      if (at >= 0 && (bestAt < 0 || at < bestAt || (at === bestAt && needle.length > bestLen))) {
        bestAt = at;
        bestLen = needle.length;
      }
    }
    if (bestAt < 0) break;
    if (bestAt > cursor) pieces.push({ text: text.slice(cursor, bestAt), hit: false });
    pieces.push({ text: text.slice(bestAt, bestAt + bestLen), hit: true });
    cursor = bestAt + bestLen;
  }

  if (cursor < text.length) pieces.push({ text: text.slice(cursor), hit: false });
  return pieces.length > 0 ? pieces : [{ text, hit: false }];
}
