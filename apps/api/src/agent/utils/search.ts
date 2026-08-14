import { prisma } from '@tomatolite/database';
import { decrypt } from '../../lib/crypto.js';
import { agentLog } from './logger.js';

// ─── Search term extraction (Chinese-friendly) ───

const STOP_CHARS = /[的了吗呢吧啊呀着过是和在或者与及 to the a an in on at for with and or of is are was were be been 0-9\s，,、.\-_:：；;（）()【】\[\]{}""''''""！!？?…·]+/g;

/** Extract clean search terms from a title, filtering stop words and short tokens.
 *  For CJK text (Chinese/Japanese), generates character bigrams so the dedup
 *  rough-filter has enough terms for the ≥2 match threshold. */
export function getSearchTerms(title: string): string[] {
  const clean = title.replace(STOP_CHARS, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(/\s+/).filter((w: string) => w.length >= 2);

  // Generate CJK character bigrams for better matching (Chinese/Japanese has no spaces)
  const bigrams: string[] = [];
  for (const w of words) {
    if (/[一-鿿぀-ゟ゠-ヿ㐀-䶿]/.test(w)) {
      for (let i = 0; i < w.length - 1; i++) bigrams.push(w.substring(i, i + 2));
    }
  }

  const all = [...new Set([...words, ...bigrams])];
  return all.slice(0, 30);
}

// ─── Embedding ───

/** Call LLM embedding API to get a float vector. Returns null if provider doesn't support it. */
export async function embedText(text: string): Promise<number[] | null> {
  try {
    const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
    if (!provider?.apiKey) return null;
    const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
    const baseUrl = master?.apiBaseUrl;
    if (!baseUrl || baseUrl.includes('deepseek') || baseUrl.includes('anthropic')) return null;
    const apiKey = await decrypt(provider.apiKey);
    const model = baseUrl.includes('dashscope') ? 'text-embedding-v3' : 'text-embedding-3-small';
    const input = text.substring(0, 8000);
    const resp = await fetch(baseUrl + '/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const d = await resp.json();
    return d.data?.[0]?.embedding || null;
  } catch { return null; }
}

// ─── Similarity ───

/** Cosine similarity between two equal-length float vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Semantic ranking ───

/** Rank candidates by embedding similarity. Falls back to keyword matching. */
export async function semanticRank(query: string, candidates: Array<{ id: string; title: string; snippet?: string | null; vector?: string | null }>): Promise<Array<{ id: string; title: string; snippet?: string | null; score: number }>> {
  if (candidates.length === 0) return [];
  const qv = await embedText(query);
  if (qv) {
    const scored = candidates.map(c => ({ ...c, score: c.vector ? cosineSimilarity(qv, JSON.parse(c.vector)) : 0 }));
    scored.sort((a, b) => b.score - a.score);
    if (scored[0].score > 0.5) return scored.slice(0, 10);
  }
  // Fallback: keyword contains-based scoring
  const terms = [query];
  const parts = query.split(/[\s,，、。.\s]+/).filter(t => t.length > 0);
  for (const part of parts) {
    const sub = part.replace(/[个的了是在那把這要什麼怎麼]/g, ' ').split(/\s+/).filter(t => t.length > 0);
    for (const s of sub) terms.push(s);
  }
  const unique = [...new Set(terms)];
  const scored = candidates.map(c => {
    let score = 0;
    for (const t of unique) { if (c.title.includes(t)) score += t.length; if (c.snippet?.includes(t)) score += t.length / 2; }
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10);
}

// ─── Semantic note search ───

export async function searchNotesSemantic(query: string, limit = 5) {
  const pages = await prisma.knowledgePage.findMany({
    where: { projectId: 'proj-default' }, take: 100,
    select: { id: true, title: true, content: true, vector: true },
  });
  if (!query) return pages.slice(0, limit).map(p => ({ title: p.title, snippet: (p.content || '').substring(0, 200) }));
  const ranked = await semanticRank(query, pages.map(p => ({ id: p.id, title: p.title, snippet: p.content?.substring(0, 200), vector: p.vector })));
  return ranked.slice(0, limit).map(r => ({ title: r.title, snippet: r.snippet?.substring(0, 200) || '' }));
}
