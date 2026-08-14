import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';

// ═══ FTS5 Full-Text Search ═══
// global_fts virtual table created by initFTS5() in server.ts
// Covers: Issue, KnowledgePage, SmartEmail, GitCommit, Report

async function fallbackSearch(q: string, limit: number) {
  const results: Array<{ type: string; id: string; title: string; snippet: string; score: number }> = [];
  const issues = await prisma.issue.findMany({ where: { OR: [{ title: { contains: q } }, { description: { contains: q } }] }, take: limit });
  for (const i of issues) results.push({ type: 'issue', id: i.id, title: `TL-${i.issueNumber}: ${i.title}`, snippet: (i.description || '').substring(0, 150), score: 50 });
  const pages = await prisma.knowledgePage.findMany({ where: { OR: [{ title: { contains: q } }, { content: { contains: q } }] }, take: limit });
  for (const p of pages) results.push({ type: 'note', id: p.id, title: p.title, snippet: (p.content || '').substring(0, 150), score: 40 });
  return results.slice(0, limit);
}

export const searchRouter = router({
  knowledgeMap: publicProcedure.query(async () => {
    const issues = await prisma.issue.findMany({ where: { projectId: 'proj-default' }, orderBy: { createdAt: 'desc' } });
    const pages = await prisma.knowledgePage.findMany({ where: { projectId: 'proj-default' }, orderBy: { updatedAt: 'desc' } });
    const recentDone = issues.filter(i => i.status === 'done').slice(0, 10);
    const context = { project: { name: 'My Project', key: 'TL', totalIssues: issues.length }, issues: { todo: issues.filter(i => i.status === 'todo').length, inProgress: issues.filter(i => ['in_progress', 'in_review'].includes(i.status)).length, done: issues.filter(i => i.status === 'done').length }, recentDone: recentDone.map(i => ({ key: `TL-${i.issueNumber}`, title: i.title })), wiki: pages.slice(0, 5).map(p => ({ title: p.title, category: p.category })) };
    const total = context.issues.todo + context.issues.inProgress + context.issues.done;
    let summary = `${context.project.name}: ${context.issues.done}/${total} done. ${pages.length} wiki pages.`;
    try {
      const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
      if (provider?.apiKey) {
        const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
        const cfg = await prisma.llmConfig.findFirst();
        const resp = await fetch(`${master?.apiBaseUrl }/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` }, body: JSON.stringify({ model: cfg?.proModel || cfg?.flashModel , max_tokens: 300, messages: [{ role: 'user', content: `Write a 3-sentence project overview:\n${JSON.stringify(context)}` }] }), signal: AbortSignal.timeout(15000) });
        if (resp.ok) { const d = await resp.json(); const c = d.choices?.[0]?.message?.content; if (c) summary = c; }
      }
    } catch {}
    return { summary, stats: context.issues, recentDone: context.recentDone, wikiPages: context.wiki };
  }),

  search: publicProcedure
    .input(z.object({ query: z.string(), limit: z.number().default(20) }))
    .query(async ({ input }) => {
      const q = input.query.trim();
      if (!q) return [];

      // FTS5 full-text search with BM25 rank-based relevance
      const ftsQuery = q.split(/\s+/).filter(w => w.length > 0).join(' OR ');
      try {
        const rows: any[] = await prisma.$queryRawUnsafe(
          `SELECT type, title, body, ref_id, rank FROM global_fts WHERE global_fts MATCH ? ORDER BY rank LIMIT ?`,
          ftsQuery, input.limit
        );
        return rows.map((r: any) => ({
          type: r.type,
          id: r.ref_id,
          title: r.title?.substring(0, 120) || '',
          snippet: (r.body || '').substring(0, 150),
          score: Math.max(1, 100 - Math.abs(r.rank || 0)),
        }));
      } catch (e: any) {
        console.error('[Search] FTS5 failed:', e.message);
        return fallbackSearch(q, input.limit);
      }
    }),

  // ═══ Web Search (LLM-powered) ═══
  webSearch: publicProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      try {
        const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
        if (!provider?.apiKey) return { results: [], source: 'no_api_key' };
        const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
        const cfg = await prisma.llmConfig.findFirst();
        const resp = await fetch(`${master?.apiBaseUrl }/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` },
          body: JSON.stringify({ model: cfg?.flashModel , max_tokens: 500, messages: [{ role: 'user', content: `Search query: "${input.query}". Provide a concise answer with key facts.` }] }),
          signal: AbortSignal.timeout(20000),
        });
        if (!resp.ok) return { results: [], source: 'error' };
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content;
        return { results: content ? [{ title: input.query, snippet: content }] : [], source: 'llm' };
      } catch { return { results: [], source: 'unavailable' }; }
    }),

  // ═══ AI Issue Review ═══
  reviewIssue: publicProcedure
    .input(z.object({ title: z.string(), description: z.string().optional(), type: z.string().default('task'), priority: z.string().default('medium'), storyPoints: z.number().optional() }))
    .mutation(async ({ input }) => {
      const { title, description, type, priority, storyPoints } = input;
      const notes: Array<{ level: string; msg: string }> = [];
      const suggestions: string[] = [];
      let score = 50;
      let duplicateRisk: string | null = null;
      const keywords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      let similarIssues: any[] = [];
      if (keywords.length > 0) {
        const orClauses = keywords.flatMap(k => [{ title: { contains: k } }, { description: { contains: k } }]);
        const allMatches = await prisma.issue.findMany({ where: { projectId: 'proj-default', OR: orClauses }, take: 10 });
        similarIssues = allMatches.filter(i => { const matchCount = keywords.filter(k => (i.title + (i.description || '')).toLowerCase().includes(k)).length; return matchCount >= 2; }).map(i => ({ key: `TL-${i.issueNumber}`, title: i.title, status: i.status, matchScore: Math.min(100, keywords.filter(k => (i.title + (i.description || '')).toLowerCase().includes(k)).length * 25) }));
      }
      if (similarIssues.length > 0) {
        const highestMatch = similarIssues[0];
        if (highestMatch.matchScore >= 70) { duplicateRisk = `high — ${highestMatch.key}: ${highestMatch.title}`; notes.push({ level: 'danger', msg: `Possible duplicate of ${highestMatch.key} (${highestMatch.matchScore}% match).` }); score -= 30; }
        else { notes.push({ level: 'warning', msg: `Similar issue found: ${highestMatch.key}: ${highestMatch.title}` }); }
      }
      if (!title || title.length < 10) { notes.push({ level: 'warning', msg: 'Title is too short.' }); suggestions.push('Add more detail to the title'); score -= 10; } else { score += 15; }
      if (!description || description.length < 20) { notes.push({ level: 'warning', msg: 'No description.' }); suggestions.push('Add a description with steps to reproduce.'); score -= 10; } else { score += 10; }
      if (storyPoints && storyPoints > 13) { notes.push({ level: 'warning', msg: `Large story (${storyPoints}sp). Consider splitting.` }); suggestions.push('Break this into 2-3 smaller issues.'); }
      if (!storyPoints) { suggestions.push('Add story points for sprint planning visibility.'); }
      const verdict = score >= 70 ? 'Ready ✅' : score >= 50 ? 'Needs minor improvements ⚠️' : 'Needs more detail ❌';
      let aiSummary = '';
      try {
        const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
        if (provider?.apiKey) {
          const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
          const cfg = await prisma.llmConfig.findFirst();
          const resp = await fetch(`${master?.apiBaseUrl }/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` }, body: JSON.stringify({ model: cfg?.flashModel , max_tokens: 200, messages: [{ role: 'user', content: `Review this issue briefly (1-2 sentences): title="${title}", type=${type}, priority=${priority}. Give one actionable improvement suggestion.` }] }), signal: AbortSignal.timeout(15000) });
          if (resp.ok) { const data = await resp.json(); aiSummary = data.choices?.[0]?.message?.content || ''; }
        }
      } catch {}
      return { score, maxScore: 85, verdict, notes, suggestions, similarIssues, duplicateRisk, aiSummary };
    }),
});
