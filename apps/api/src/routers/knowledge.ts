import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';
import { t } from '../lib/i18n.js';
import { decrypt } from '../lib/crypto.js';

export const knowledgeRouter = router({
  generate: publicProcedure.input(z.object({ lang: z.string().default('en'), force: z.boolean().default(false) })).mutation(async ({ input }) => {
    // Gather task + note + report data
    const [issues, notes, reports] = await Promise.all([
      prisma.issue.findMany({ where: { projectId: 'proj-default' }, orderBy: { updatedAt: 'desc' }, take: 20, select: { title: true, status: true, priority: true } }),
      prisma.knowledgePage.findMany({ where: { projectId: 'proj-default' }, orderBy: { updatedAt: 'desc' }, take: 10, select: { title: true, category: true } }),
      prisma.report.findMany({ orderBy: { generatedAt: 'desc' }, take: 5, select: { title: true, reportType: true } }),
    ]);

    const taskList = issues.map(i => `[${i.status}] ${i.priority ? `(${i.priority}) ` : ''}${i.title}`).join('\n');
    const noteList = notes.map(n => `[${n.category || 'note'}] ${n.title}`).join('\n');
    const reportList = reports.map(r => `[${r.reportType || 'report'}] ${r.title}`).join('\n');

    if (!taskList && !noteList && !reportList) {
      return { content: t('knowledge.empty', input.lang), cached: false};
    }

    // Cache key = content hash (detects data changes). Language is a separate column (like Health).
    const hash = Buffer.from(taskList + noteList + reportList).toString('base64').substring(0, 32);

    // Return cached if same data + same lang + within 2 hours (matching Health pattern)
    if (!input.force) {
      try {
        const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString().replace('T', ' ').substring(0, 19);
        const cached = await prisma.knowledgeCache.findFirst({
          where: { createdAt: { gte: twoHoursAgo }, lang: input.lang, tasksHash: hash },
          orderBy: { createdAt: 'desc' },
        });
        if (cached) return { content: cached.content, cached: true, generatedAt: cached.createdAt};
      } catch {} // Column might not exist yet — fall through to generation
    }

    // Generate via LLM
    let content = '';
    let genError = '';
    try {
      const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
      if (!provider?.apiKey) { genError = t('knowledge.noLlm', input.lang); }
      else {
        const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
        const cfg = await prisma.llmConfig.findFirst();
        if (!cfg?.flashModel && !cfg?.proModel) { genError = t('knowledge.noModel', input.lang); }
        else {
          const model = cfg?.flashModel || cfg?.proModel;
          const langLabel = input.lang === 'zh' ? 'Chinese' : input.lang === 'ja' ? 'Japanese' : 'English';
          const prompt = `You are a knowledge analyst. Analyze the data below and output ONLY a knowledge map in Markdown. Write in ${langLabel}. Follow the format EXACTLY — replace ALL <placeholders> with real content, do NOT keep placeholder text like "Domain Name" verbatim. Do NOT add any introduction, preamble, greeting, or closing remarks — start directly with "# Knowledge Map".

# Knowledge Map

## Core Domains
- **<topic name>**: <one sentence, 3-5 items>

## Strengths
- **<strength name>**: <one sentence, 2-3 items>

## Learning Path
- **<path name>**: <one sentence, 2-3 items>

Data:
Tasks:
${taskList}

Notes:
${noteList}

Reports:
${reportList}`;

          const baseUrl = master?.apiBaseUrl || '';
          const body: any = { model: cfg?.flashModel || cfg?.proModel, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] };
          // Disable thinking for simple generation tasks — Kimi k2.6 has it on by default
          if (baseUrl.includes('moonshot') || baseUrl.includes('deepseek')) body.thinking = { type: 'disabled' };
          else if (baseUrl.includes('dashscope')) body.enable_thinking = false;
          const resp = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await decrypt(provider.apiKey)}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            genError = `API error ${resp.status}: ${errText.substring(0, 200)}`;
          } else {
            const d = await resp.json();
            const msg = d.choices?.[0]?.message;
            content = msg?.content || '';
            if (content) {
              // Strip preamble — only keep from "# Knowledge Map" or first "#" heading
              const idx = content.indexOf('#');
              if (idx > 0) content = content.substring(idx);
            } else {
              genError = `LLM returned empty response. model=${cfg?.flashModel || cfg?.proModel}, finish_reason=${d.choices?.[0]?.finish_reason || 'none'}`;
            }
          }
        }
      }
    } catch (e: any) { genError = e?.message || String(e); }

    if (!content) {
      const title = t('knowledge.fallbackTitle', input.lang);
      const domains = t('knowledge.fallbackDomains', input.lang);
      const tasksText = t('knowledge.fallbackTasks', input.lang, { n: String(issues.length) });
      const notesText = t('knowledge.fallbackNotes', input.lang, { n: String(notes.length) });
      const reportsText = t('knowledge.fallbackReports', input.lang, { n: String(reports.length) });
      const hint = t('knowledge.fallbackHint', input.lang);
      const errLabel = t('knowledge.fallbackError', input.lang);
      content = `## ${title}
${genError ? `> ⚠️ ${errLabel}: ${genError}\n\n` : ''}### ${domains}
- ${tasksText}
- ${notesText}
- ${reportsText}

${hint}`;
    }

    // Cache result (like Health: store lang column)
    const now2 = new Date().toLocaleString('sv-SE').replace('T', ' ').substring(0, 19);
    try { await prisma.knowledgeCache.create({ data: { content, tasksHash: hash, lang: input.lang, createdAt: now2 } }); } catch {}

    return { content, cached: false, generatedAt: now2};
  }),

  getLatest: publicProcedure.input(z.object({ lang: z.string().default('en') })).query(async ({ input }) => {
    try {
      const cached = await prisma.knowledgeCache.findFirst({
        where: { lang: input.lang },
        orderBy: { createdAt: 'desc' },
      });
      return cached ? { content: cached.content, generatedAt: cached.createdAt } : null;
    } catch { return null; }
  }),
});
