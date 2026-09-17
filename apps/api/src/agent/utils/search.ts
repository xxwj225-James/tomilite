import { prisma } from '@tomilite/database';
import { DEFAULT_PROJECT_ID } from './constants.js';
import { toFtsMatch } from '../../lib/fts.js';
import { cosineSimilarity, decodeVector, embedQuery } from '../../lib/embed/index.js';

// `cosineSimilarity` now lives with the rest of the vector code in lib/embed; re-exported
// so existing importers of this module keep working.
export { cosineSimilarity };

// ─── Embedding ───

/**
 * Embed a query. Thin alias for `embedQuery` in lib/embed.
 *
 * This function used to call the LLM's /embeddings endpoint. Of the five providers this
 * app ships, that path was dead for DeepSeek, Anthropic and the hosted gateway — the
 * guard was `!isDeepseekEndpoint(baseUrl)`, which matches DeepSeek *and* the gateway —
 * and quietly corrupting for OpenAI and Qwen, which passed it and stored a 1536- or
 * 1024-dim vector in the same column the local 384-dim model reads. A width mismatch
 * makes cosineSimilarity return 0, so those rows would have ranked last forever with
 * nothing logged. One model, one space, one stored format.
 */
export async function embedText(text: string): Promise<number[] | null> {
  return embedQuery(text);
}

// ─── Semantic ranking ───

/** Rank candidates by embedding similarity. Falls back to keyword matching. */
export async function semanticRank(
  query: string,
  candidates: Array<{ id: string; title: string; snippet?: string | null; vector?: string | null }>,
): Promise<Array<{ id: string; title: string; snippet?: string | null; score: number }>> {
  if (candidates.length === 0) return [];
  const qv = await embedQuery(query);
  if (qv) {
    // Gate on the CANDIDATES being embedded, not on the top score.
    //
    // This used to require `scored[0].score > 0.5`. That number was calibrated for
    // OpenAI embeddings; e5 puts unrelated texts around 0.75-0.85, so the threshold was
    // true for every query and told us nothing. Whether a cosine ordering is meaningful
    // depends on whether the candidates have usable vectors at all — if none do, every
    // score is 0 and the "ranking" is just the input order.
    const usable = candidates.some((c) => decodeVector(c.vector) !== null);
    if (usable) {
      const scored = candidates.map((c) => ({ ...c, score: cosineSimilarity(qv, decodeVector(c.vector)) }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 10);
    }
  }
  // Fallback: keyword contains-based scoring
  const terms = [query];
  const parts = query.split(/[\s,，、。.\s]+/).filter((t) => t.length > 0);
  for (const part of parts) {
    const sub = part
      .replace(/[个的了是在那把這要什麼怎麼]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);
    for (const s of sub) terms.push(s);
  }
  const unique = [...new Set(terms)];
  const scored = candidates.map((c) => {
    let score = 0;
    for (const t of unique) {
      if (c.title.includes(t)) score += t.length;
      if (c.snippet?.includes(t)) score += t.length / 2;
    }
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10);
}

// ─── Hybrid note search ───

/** Candidates pulled from each retrieval list before fusion. */
const CANDIDATES = 500;
/** Items taken from each individual ranking. */
const PER_LIST = 50;
/** Reciprocal-rank-fusion constant. 60 is the value from the original RRF paper and the
 *  one every implementation converges on; it only sets how fast rank discounting decays. */
const RRF_K = 60;

/**
 * Find notes by meaning as well as by wording.
 *
 * Two independent rankings are fused with reciprocal rank fusion rather than by combining
 * scores: BM25 rank and cosine similarity have no common scale, and normalizing them
 * against each other would need per-corpus tuning that silently stops working when the
 * corpus changes shape. RRF only uses the *order* each list produced, so it needs no
 * weights and no calibration — an item ranked well by either method surfaces.
 *
 * Degradation is graceful in both directions: no model → the embedding list is empty and
 * RRF reduces to BM25 order; no FTS index → same in reverse. A query that is a single
 * 2-character Chinese word produces no MATCH expression at all (trigram cannot serve it),
 * which is the case the embedding list exists to cover.
 */
export async function searchNotesSemantic(query: string, limit = 5) {
  const pages = await prisma.knowledgePage.findMany({
    where: { projectId: DEFAULT_PROJECT_ID, status: 'active' },
    // Was an unordered `take: 100` with no status filter, which meant "the 100 notes the
    // planner happened to return" — archived notes included, and recent ones possibly not.
    orderBy: { updatedAt: 'desc' },
    take: CANDIDATES,
    select: { id: true, title: true, content: true, vector: true },
  });
  if (!query)
    return pages.slice(0, limit).map((p) => ({
      id: p.id,
      title: p.title,
      snippet: (p.content || '').substring(0, 200),
    }));

  const byId = new Map(pages.map((p) => [p.id, p]));
  const lists: string[][] = [];

  // ── List 1: BM25 over the trigram index ──
  const match = toFtsMatch(query);
  if (match) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ ref_id: string }>>(
        `SELECT ref_id FROM global_fts WHERE type = 'note' AND global_fts MATCH ? ORDER BY rank LIMIT ?`,
        match,
        PER_LIST,
      );
      const ids = rows.map((r) => r.ref_id).filter((id) => byId.has(id));
      if (ids.length > 0) lists.push(ids);
    } catch {
      /* index missing or MATCH rejected — the other list still works */
    }
  }

  // ── List 2: cosine over stored vectors ──
  //
  // This list always fills to PER_LIST when any vector exists, including for a query with
  // no relevant note anywhere — see the measurement in knowledgeRecall.ts. So a nonsense
  // query now returns `limit` arbitrary notes where it used to return none. That is the
  // accepted cost of the same property that makes cross-lingual and 2-character CJK
  // queries work at all; there is no score cut-off that separates the two cases.
  const qv = await embedQuery(query);
  if (qv) {
    const scored = pages
      .map((p) => ({ id: p.id, score: cosineSimilarity(qv, decodeVector(p.vector)) }))
      .filter((s) => s.score > 0) // 0 means "no usable vector", not "unrelated"
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_LIST);
    if (scored.length > 0) lists.push(scored.map((s) => s.id));
  }

  if (lists.length === 0) return [];

  // ── Fusion ──
  const fused = new Map<string, number>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank];
      fused.set(id, (fused.get(id) || 0) + 1 / (RRF_K + rank + 1));
    }
  }

  const ranked: Array<{ id: string; title: string; snippet: string; score: number }> = [];
  for (const [id, score] of [...fused.entries()].sort((a, b) => b[1] - a[1])) {
    if (ranked.length >= limit) break;
    // Every fused id came from byId — list 1 filters on byId.has() and list 2 is built from
    // pages — so this never fires. It stands where a non-null assertion used to, and unlike
    // the assertion it cannot turn an unexpected id into a crash.
    const p = byId.get(id);
    if (!p) continue;
    ranked.push({
      // The id used to be dropped here, which left the agent unable to open a note it
      // had just found and reported.
      id: p.id,
      title: p.title,
      snippet: (p.content || '').substring(0, 200),
      score: Number(score.toFixed(6)),
    });
  }
  return ranked;
}
