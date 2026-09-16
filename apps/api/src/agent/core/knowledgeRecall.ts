import { prisma } from '@tomilite/database';
import { cosineSimilarity, decodeVector, embedQuery, isEmbedLoaded } from '../../lib/embed/index.js';

const MAX_TERMS = 12;
const MAX_HITS = 3;
const MAX_CHARS = 500;
const SNIPPET_CHARS = 200;
const CANDIDATES = 20;
/** Below this much remaining budget another note is not worth starting. */
const MIN_TAIL = 80;

/** Latin term matches count double: a proper noun / identifier is far more
 *  discriminative than a CJK bigram, and it is what carries a cross-language
 *  question ("TomatoHub 的支付方案…" against an English-titled note). */
const LATIN_WEIGHT = 2;

/** Frequent English words that would otherwise match almost every note. */
const LATIN_STOP = new Set([
  'the','and','for','with','that','this','you','your','are','was','were','have','has','had','not','but','can',
  'will','would','from','they','them','their','what','when','where','which','how','why','who','all','any','our',
  'out','use','used','new','get','got','set','add','run','make','also','into','than','then','some','more','most',
  'only','over','just','its','does','did','about','there','here','been','being','should','could','need','want',
  'please','help','tell','show','give','make','like','well','good','bad','one','two','see','look','find',
]);

/** Renderer context markers prepended to the user message (agentStream.ts:39-46). */
function stripContextMarkers(message: string): string {
  let m = message.trim();
  while (m.startsWith('[')) {
    const end = m.indexOf(']');
    if (end < 0) break;
    m = m.slice(end + 1).trim();
  }
  return m;
}

/**
 * Candidate terms for the LIKE lookup.
 *
 * Deliberately NOT global_fts, even now that the index is tokenized with `trigram`
 * (lib/ftsIndex.ts). Trigram matches any substring of 3 or more characters, but the
 * term set below is dominated by CHARACTER BIGRAMS — 2 characters, which a trigram
 * index structurally cannot match. Delegating this function to FTS would silently
 * regress it. Latin terms (3+ characters) would work either way, which is the other
 * reason both kinds are produced here rather than left to the index.
 *
 * Under the previous `porter unicode61` tokenizer this was the only option for any CJK
 * query at all: it treated a whole run of Han/Kana as ONE token, so "迁移决定" hit
 * while "迁移" / "决定" / "数据库" all returned 0.
 */
function extractTerms(message: string): string[] {
  const text = stripContextMarkers(message);
  const latin = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9][a-z0-9_]{2,}/g) || []) {
    if (!LATIN_STOP.has(w)) latin.add(w);
  }
  const cjk = new Set<string>();
  const runs = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || [];
  for (const run of runs) {
    if (run.length < 2) continue;
    if (run.length === 2) {
      cjk.add(run);
      continue;
    }
    // Character bigrams: "把数据库迁移到" → 把数/数据/据库/库迁/迁移/移到
    for (let i = 0; i + 2 <= run.length; i++) cjk.add(run.slice(i, i + 2));
  }
  // Latin terms are the higher-signal ones — keep them all before CJK noise.
  return [...latin, ...cjk].slice(0, MAX_TERMS);
}

/** Shorter messages than this never reach the semantic fallback. Not a relevance test —
 *  see the measurement below — only a floor that keeps one-word greetings from pulling
 *  three arbitrary notes into the prompt. */
const SEMANTIC_MIN_CHARS = 6;

/**
 * Semantic fallback: the notes closest in meaning to the message, used only when the
 * keyword pass matched nothing at all.
 *
 * **Gated on `isEmbedLoaded()`, which is the whole point of this being a fallback.** This
 * function's output is injected into EVERY agent turn, so it may never stall one. Loading
 * the model costs 11 s the first time in a process; `isEmbedLoaded()` is synchronous and
 * answers "already resident", so a cold process skips this entirely and the warm-up timer
 * in server.ts pays that cost later, off the request path. A turn that arrives after the
 * warm-up gets the fallback; one that arrives before it just gets the old behaviour.
 *
 * **There is deliberately no similarity threshold, and that is a measured decision rather
 * than an omission.** On a real 35-note corpus (2026-09-12), e5 vectors are anisotropic
 * enough that the score distribution does not tell a good query from a bad one:
 *
 *   query             top      top−mean   top−2nd   z
 *   数据库迁移 (real)   0.8391   0.0379     0.0029    1.41
 *   如何种植番茄 (absent) 0.8606   0.0659     0.0129    1.80
 *   zzzzzzzz (gibberish) 0.8486  0.0348     0.0076    2.84
 *
 * Gibberish scores *higher* than the real query by every statistic, and the absent-topic
 * query beats both. Any cut-off here would be fitted noise. The ordering is still useful —
 * the correct note ranked #1 for every real probe — so this returns the top of it and
 * accepts that a no-hit query gets the closest available notes. Fusing with FTS (see
 * searchNotesSemantic) is what supplies the missing signal, not a threshold.
 *
 * Returns [] on any failure — this is best-effort, like everything else here.
 */
async function semanticFallback(message: string): Promise<Array<{ title: string | null; content: string | null }>> {
  if (!isEmbedLoaded()) return [];
  const text = stripContextMarkers(message);
  if (text.length < SEMANTIC_MIN_CHARS) return [];
  const qv = await embedQuery(text);
  if (!qv) return [];
  const rows = await prisma.knowledgePage.findMany({
    where: { status: 'active' },
    orderBy: { updatedAt: 'desc' },
    take: 500,
    select: { title: true, content: true, vector: true },
  });
  return rows
    .map((r) => ({ title: r.title, content: r.content, score: cosineSimilarity(qv, decodeVector(r.vector)) }))
    .filter((r) => r.score > 0) // 0 = no usable vector, not "unrelated"
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_HITS);
}

/**
 * Notes worth putting in front of the model for THIS message.
 *
 * Best-effort: any failure returns '' so the caller injects nothing. Returns ''
 * whenever nothing scores high enough — the common case must cost no tokens.
 */
export async function getKnowledgeHint(userMessage: string): Promise<string> {
  try {
    if (!userMessage || userMessage.startsWith('__FORCE_CREATE__')) return '';
    const terms = extractTerms(userMessage);
    if (terms.length === 0) return '';
    const rows = await prisma.knowledgePage.findMany({
      where: {
        status: 'active',
        OR: terms.flatMap((term) => [{ title: { contains: term } }, { content: { contains: term } }]),
      },
      orderBy: { updatedAt: 'desc' },
      take: CANDIDATES,
      select: { id: true, title: true, content: true },
    });
    // "High score" is judged here, not in SQL: LIKE has no notion of relevance,
    // and DISTINCT matched terms is a stable proxy across data sizes (BM25 rank
    // would not be). One term in → one term must match; otherwise two, so a
    // single incidental bigram cannot pull a note into every prompt.
    const minScore = terms.length > 1 ? 2 : 1;
    let scored: Array<{ title: string | null; content: string | null }> = rows
      .map((r) => {
        const hay = `${r.title || ''} ${r.content || ''}`.toLowerCase();
        let score = 0;
        let latinHits = 0;
        let hits = 0;
        for (const term of terms) {
          if (!hay.includes(term)) continue;
          hits++;
          const isLatin = /^[a-z0-9_]/.test(term);
          if (isLatin) latinHits++;
          score += isLatin ? LATIN_WEIGHT : 1;
        }
        return { ...r, score, latinHits, hits };
      })
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score || b.latinHits - a.latinHits || b.hits - a.hits)
      .slice(0, MAX_HITS);
    // Zero keyword hits is exactly the case worth buying semantic recall for, and the
    // only case — on the common path this costs one synchronous boolean.
    if (scored.length === 0) {
      scored = await semanticFallback(userMessage);
      if (scored.length === 0) return '';
    }
    // MAX_CHARS budgets the NOTES, not the fixed instruction line — otherwise
    // the header alone would eat a third of the allowance before any note fits.
    const header = '\n\n📚 RELEVANT NOTES FROM THE KNOWLEDGE BASE (retrieved automatically — use only if relevant; do not cite unless asked):';
    let used = 0;
    let body = '';
    for (const r of scored) {
      const snippet = (r.content || '').replace(/\s+/g, ' ').trim().substring(0, SNIPPET_CHARS);
      const line = `\n- ${r.title}${snippet ? ': ' + snippet : ''}`;
      const room = MAX_CHARS - used;
      if (room < MIN_TAIL) break; // no meaningful space left for another note
      // A note that overshoots the budget by a few chars is truncated rather
      // than dropped — a clipped snippet still beats losing the hit entirely.
      const fitted = line.length <= room ? line : line.substring(0, room - 1) + '…';
      used += fitted.length;
      body += fitted;
    }
    return body ? header + body : '';
  } catch {
    return '';
  }
}
