import { prisma } from '@tomilite/database';
import { DEFAULT_PROJECT_ID } from '../utils/constants.js';
import { agentLog } from '../utils/logger.js';
import { fetchWithProxyFallback } from '../utils/proxy.js';
import { ftsTerms, toFtsMatch, unsearchableTerms } from '../../lib/fts.js';
import { issueKey } from '../../lib/taskScope.js';

/**
 * A failed `fetch` reports only `TypeError: fetch failed`; the reason that matters is on
 * `cause`. Losing it is what made the proxy bug above read as an unexplained empty search
 * — "fetch failed" alone names neither the host nor the port that refused the connection.
 */
function describeFetchError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { cause?: { code?: string } })?.cause?.code;
  return code ? `${msg} (${code})` : msg;
}

/**
 * Brave Search API. Requires BRAVE_API_KEY in the environment — there is no UI or
 * DB field for it, so this is only reachable for someone running the API from
 * source. `getActiveTools` withholds the tool entirely when the key is absent, so
 * the model is never offered a call that can only fail.
 */
export async function braveSearch(
  args: Record<string, unknown>,
): Promise<{ results: Array<{ title: string; url: string; snippet: string }>; source: string; message?: string }> {
  const query = String(args.query ?? '');
  agentLog('[brave_search] query:', query);
  const q = encodeURIComponent(query);
  const braveKey = process.env.BRAVE_API_KEY || '';
  if (!braveKey)
    return { results: [], source: 'brave', message: 'Brave API key not configured. Set BRAVE_API_KEY env var.' };

  try {
    const resp = await fetchWithProxyFallback(
      'https://api.search.brave.com/res/v1/web/search?q=' + q + '&count=10',
      8000,
      { headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey } },
    );
    agentLog('[brave_search] status:', resp.status);
    if (!resp.ok) return { results: [], source: 'brave', message: 'HTTP ' + resp.status };
    const data = await resp.json();
    const webResults = (data.web?.results || []).slice(0, 10).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
    }));
    agentLog('[brave_search] results:', webResults.length);
    return { results: webResults, source: 'brave' };
  } catch (e: any) {
    return { results: [], source: 'brave', message: describeFetchError(e) };
  }
}

/**
 * Search the web via Bing RSS. This is the app's own HTTP fetch — it needs no API
 * key and no LLM with native search, which is what makes it work identically on
 * every provider including the hosted DeepSeek gateway.
 *
 * The DuckDuckGo fallback below is best-effort only: it was verified returning an
 * empty response from this network, so it is NOT a dependable second source. It is
 * kept short (3s) because a Bing query that parses to zero results pays that
 * timeout on the way out.
 */
export async function webSearch(
  args: Record<string, unknown>,
): Promise<{ results: Array<{ title: string; url: string; snippet: string }>; source?: string; message?: string }> {
  try {
    const query = String(args.query ?? '');
    agentLog('[web_search] query:', query);
    const q = encodeURIComponent(query);
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Both sources go through `fetchWithProxyFallback`: the system proxy when one
    // applies to the host, and a direct retry when it turns out nothing was listening.
    // A proxy that has been switched off must not be able to turn a search into zero
    // results — see the header of `utils/proxy.ts`.

    // ── Primary: Bing RSS (structured XML, no JS rendering needed) ──
    const resp = await fetchWithProxyFallback('https://www.bing.com/search?format=rss&q=' + q, 10_000, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    agentLog('[web_search] bing rss status:', resp.status);

    if (resp.ok) {
      const xml = await resp.text();
      agentLog('[web_search] bing rss length:', xml.length);
      // Parse RSS <item> entries: <title>, <link>, <description>
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let itemMatch;
      const seen = new Set<string>();
      while ((itemMatch = itemRe.exec(xml)) !== null) {
        const block = itemMatch[1];
        const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
        const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
        const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
        if (!titleMatch || !linkMatch) continue;
        const url = linkMatch[1].trim();
        if (seen.has(url) || url.includes('bing.com') || url.includes('microsoft.com/bing')) continue;
        seen.add(url);
        const title = titleMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();
        const snippet = descMatch
          ? descMatch[1]
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/\s+/g, ' ')
              .trim()
          : '';
        results.push({ title, url, snippet });
        if (results.length >= 15) break;
      }
      if (results.length > 0) {
        agentLog('[web_search] bing rss results:', results.length);
        return { results, source: 'bing-rss' };
      }
    }

    // ── Best-effort fallback: DuckDuckGo Lite HTML ──
    agentLog('[web_search] bing rss empty, trying ddg');
    const ddg = await fetchWithProxyFallback('https://lite.duckduckgo.com/lite/?q=' + q, 3000, {
      headers: { 'User-Agent': 'TomiLite/1.0' },
    });
    agentLog('[web_search] ddg status:', ddg.status);
    if (!ddg.ok) return { results: [], source: 'error', message: 'HTTP ' + ddg.status };
    const html = await ddg.text();
    agentLog('[web_search] ddg html length:', html.length);
    const links: Array<{ title: string; url: string }> = [];
    const seen = new Set<string>();
    const linkRe = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]{10,120})<\/a>/g;
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const url = m[1],
        title = m[2]
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();
      if (seen.has(url) || url.includes('bing.com') || url.includes('microsoft.com/bing')) continue;
      seen.add(url);
      links.push({ title, url });
      if (links.length >= 15) break;
    }
    for (const link of links) {
      const idx = html.indexOf(link.url);
      if (idx < 0) {
        results.push({ title: link.title, url: link.url, snippet: '' });
        continue;
      }
      const after = html.substring(idx, idx + 500);
      const textMatch = after.match(/>([^<]{30,200})</);
      results.push({
        title: link.title,
        url: link.url,
        snippet: textMatch ? textMatch[1].replace(/\s+/g, ' ').trim() : '',
      });
    }
    agentLog('[web_search] ddg results:', results.length);
    if (results.length === 0) return { results: [], source: 'empty', message: 'No results parsed' };
    return { results, source: 'ddg-fallback' };
  } catch (e: unknown) {
    const msg = describeFetchError(e);
    agentLog('[web_search] error:', msg);
    return { results: [], source: 'error', message: msg };
  }
}

/** Search all local data (issues, notes, reports) via FTS with Prisma fallback */
export async function searchLocalData(
  args: Record<string, unknown>,
): Promise<Array<{ type: string; id?: string; title: string; snippet: string }>> {
  const q: string = args.query ? String(args.query).trim() : '';
  if (!q) return [];
  const unique = ftsTerms(q);
  if (unique.length === 0) return [];

  /** LIKE path — for queries the index structurally cannot serve. */
  const containsSearch = async () => {
    const results: Array<{ type: string; title: string; snippet: string }> = [];
    const termOr = unique.flatMap((t: string) => [{ title: { contains: t } }, { description: { contains: t } }]);
    const issues = await prisma.issue.findMany({ where: { projectId: DEFAULT_PROJECT_ID, OR: termOr }, take: 10 });
    for (const i of issues) {
      results.push({
        type: 'issue',
        title: issueKey(i) + ': ' + i.title,
        snippet: (i.description || '').substring(0, 200),
      });
    }
    const noteOr = unique.flatMap((t: string) => [{ title: { contains: t } }, { content: { contains: t } }]);
    const pages = await prisma.knowledgePage.findMany({
      where: { projectId: DEFAULT_PROJECT_ID, OR: noteOr },
      take: 10,
    });
    for (const p of pages) {
      results.push({ type: 'note', title: p.title, snippet: (p.content || '').substring(0, 200) });
    }
    const reportOr = unique.flatMap((t: string) => [{ title: { contains: t } }, { content: { contains: t } }]);
    const reports = await prisma.report.findMany({ where: { archived: false, OR: reportOr }, take: 10 });
    for (const r of reports) {
      results.push({ type: 'report', title: r.title, snippet: (r.content || '').substring(0, 200) });
    }
    return results.slice(0, 15);
  };

  // toFtsMatch quotes every term — raw input containing `-` or a lone `"` would
  // otherwise be parsed as fts5 syntax and throw.
  const match = toFtsMatch(q);
  let rows: Array<{ type: string; title: string; body: string; ref_id: string }> = [];
  let ftsFailed = false;
  if (match) {
    try {
      rows = (await prisma.$queryRawUnsafe(
        'SELECT type, title, body, ref_id, rank FROM global_fts WHERE global_fts MATCH ? ORDER BY rank LIMIT 15',
        match,
      )) as typeof rows;
    } catch (e) {
      ftsFailed = true;
      agentLog('[search_local_data] FTS failed:', e instanceof Error ? e.message : String(e));
    }
  }
  // An empty result does not necessarily mean "nothing there": a term shorter than 3
  // characters can never match the trigram index, so fall back to LIKE.
  if (rows.length === 0 && (ftsFailed || unsearchableTerms(q).length > 0)) return containsSearch();

  return rows.map((r) => ({
    type: r.type,
    id: r.ref_id,
    title: (r.title || '').substring(0, 120),
    snippet: (r.body || '').substring(0, 200),
  }));
}
