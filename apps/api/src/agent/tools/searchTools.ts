import { prisma } from '@tomatolite/database';
import { DEFAULT_PROJECT_ID } from '../utils/constants.js';
import { agentLog } from '../utils/logger.js';
import { getProxyUrl } from '../utils/proxy.js';

/** Brave Search API (free tier: 2000 req/month). LLM can call this first, fall back to web_search if unsatisfied. */
export async function braveSearch(
  args: Record<string, unknown>,
): Promise<{ results: Array<{ title: string; url: string; snippet: string }>; source: string; message?: string }> {
  const query = String(args.query ?? '');
  agentLog('[brave_search] query:', query);
  const q = encodeURIComponent(query);
  const braveKey = process.env.BRAVE_API_KEY || '';
  if (!braveKey) return { results: [], source: 'brave', message: 'Brave API key not configured. Set BRAVE_API_KEY env var.' };

  const proxy = getProxyUrl();
  const fetchOpts: any = {};
  if (proxy) { try { const { ProxyAgent } = require('undici'); fetchOpts.dispatcher = new ProxyAgent(proxy); } catch {} }

  try {
    const resp = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + q + '&count=10', {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey },
      signal: AbortSignal.timeout(8000),
      ...fetchOpts,
    });
    agentLog('[brave_search] status:', resp.status);
    if (!resp.ok) return { results: [], source: 'brave', message: 'HTTP ' + resp.status };
    const data = await resp.json();
    const webResults = (data.web?.results || []).slice(0, 10).map((r: any) => ({
      title: r.title || '', url: r.url || '', snippet: r.description || '',
    }));
    agentLog('[brave_search] results:', webResults.length);
    return { results: webResults, source: 'brave' };
  } catch (e: any) {
    return { results: [], source: 'brave', message: e.message };
  }
}

/** Search the web via Bing RSS → DuckDuckGo fallback. Uses system proxy when configured. */
export async function webSearch(
  args: Record<string, unknown>,
): Promise<{ results: Array<{ title: string; url: string; snippet: string }>; source?: string; message?: string }> {
  try {
    const query = String(args.query ?? '');
    agentLog('[web_search] query:', query);
    const q = encodeURIComponent(query);
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Proxy support for web search (same mechanism as LLM client)
    const proxy = getProxyUrl();
    const fetchOpts: any = {};
    if (proxy) {
      try {
        const { ProxyAgent } = require('undici');
        fetchOpts.dispatcher = new ProxyAgent(proxy);
        agentLog('[web_search] using proxy:', proxy);
      } catch { /* undici not available */ }
    }

    // ── Primary: Bing RSS (structured XML, no JS rendering needed) ──
    let resp = await fetch('https://www.bing.com/search?format=rss&q=' + q, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
      ...fetchOpts,
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

    // ── Fallback: DuckDuckGo Lite HTML ──
    agentLog('[web_search] bing rss empty, trying ddg');
    resp = await fetch('https://lite.duckduckgo.com/lite/?q=' + q, {
      headers: { 'User-Agent': 'TomiLite/1.0' },
      signal: AbortSignal.timeout(8000),
      ...fetchOpts,
    });
    agentLog('[web_search] ddg status:', resp.status);
    if (!resp.ok) return { results: [], source: 'error', message: 'HTTP ' + resp.status };
    const html = await resp.text();
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
    const msg = e instanceof Error ? e.message : String(e);
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
  const unique = [...new Set(q.split(/\s+/).filter((w: string) => w.length > 0))];
  if (unique.length === 0) return [];
  try {
    const ftsQuery = unique.join(' OR ');
    const rows = (await prisma.$queryRawUnsafe(
      'SELECT type, title, body, ref_id, rank FROM global_fts WHERE global_fts MATCH ? ORDER BY rank LIMIT 15',
      ftsQuery,
    )) as Array<{ type: string; title: string; body: string; ref_id: string }>;
    return rows.map((r) => ({
      type: r.type,
      id: r.ref_id,
      title: (r.title || '').substring(0, 120),
      snippet: (r.body || '').substring(0, 200),
    }));
  } catch {
    const results: Array<{ type: string; title: string; snippet: string }> = [];
    const termOr = unique.flatMap((t: string) => [{ title: { contains: t } }, { description: { contains: t } }]);
    const issues = await prisma.issue.findMany({ where: { projectId: DEFAULT_PROJECT_ID, OR: termOr }, take: 10 });
    for (const i of issues) {
      results.push({
        type: 'issue',
        title: 'TL-' + i.issueNumber + ': ' + i.title,
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
  }
}
