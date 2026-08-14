import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';

// ═══ Agent Self-Learning — lightweight, no MQ/Celery ═══
// Captures implicit feedback (reopen, reassign), reflects on startup,
// builds simple pattern memory. Fits in a single Node.js process.

export const learnRouter = router({
  // ─── Capture feedback ───
  capture: publicProcedure
    .input(z.object({
      featureType: z.string(),   // ISSUE_REOPEN, ISSUE_ASSIGN, STATUS_REVERT, etc.
      aiOutput: z.string(),      // what the AI suggested (e.g. status=done, assignee=X)
      humanAction: z.string(),   // REJECT / CORRECT
      humanCorrected: z.string().optional(),
      issueKey: z.string().optional(),
      context: z.string().optional(),  // JSON snapshot
    }))
    .mutation(async ({ input }) => {
      await prisma.aiDecisionFeedback.create({ data: { ...input } });
      return { captured: true };
    }),

  // ─── Reflect on recent feedback (called on startup or manually) ───
  reflect: publicProcedure.mutation(async () => {
    const recent = await prisma.aiDecisionFeedback.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86400000).toISOString() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (recent.length === 0) return { insights: [], patterns: 'No recent feedback to reflect on.' };

    // Simple pattern detection: group by feature type
    const byType: Record<string, { total: number; rejects: number }> = {};
    for (const f of recent) {
      if (!byType[f.featureType]) byType[f.featureType] = { total: 0, rejects: 0 };
      byType[f.featureType].total++;
      if (f.humanAction === 'REJECT') byType[f.featureType].rejects++;
    }

    const patterns = Object.entries(byType)
      .filter(([, v]) => v.rejects > 0)
      .map(([type, v]) => `${type}: ${v.rejects}/${v.total} rejected (${Math.round(v.rejects / v.total * 100)}%)`);

    // Try LLM reflection
    let insights: string[] = [];
    try {
      const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
      if (provider?.apiKey) {
        const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
        const cfg = await prisma.llmConfig.findFirst();
        const feedbackSummary = recent.slice(0, 10).map(f =>
          `${f.featureType}: AI said "${f.aiOutput}" → Human ${f.humanAction} → corrected to "${f.humanCorrected || 'N/A'}"`
        ).join('\n');

        const resp = await fetch(`${master?.apiBaseUrl }/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` },
          body: JSON.stringify({
            model: cfg?.flashModel , max_tokens: 300,
            messages: [{ role: 'user', content: `Analyze these AI mistakes and give 2-3 actionable lessons (one sentence each):\n${feedbackSummary}` }],
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (resp.ok) {
          const data = await resp.json();
          const content = data.choices?.[0]?.message?.content || '';
          insights = content.split('\n').filter((l: string) => l.trim().length > 10);
        }
      }
    } catch {}

    return {
      insights: insights.length > 0 ? insights : ['No LLM available for reflection.'],
      patterns: patterns.join('; ') || 'No clear patterns yet.',
      feedbackCount: recent.length,
    };
  }),

  // ─── Get learnings for agent prompt injection ───
  getContext: publicProcedure.query(async () => {
    const recent = await prisma.aiDecisionFeedback.findMany({
      where: { humanAction: 'REJECT', createdAt: { gte: new Date(Date.now() - 30 * 86400000).toISOString() } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    if (recent.length === 0) return { lessons: 'No past mistakes to learn from.' };

    const lessons = recent.map(f =>
      `Avoid: ${f.featureType} → "${f.aiOutput}" (user corrected to "${f.humanCorrected || 'something else'}")`
    ).join(' | ');

    return { lessons, count: recent.length };
  }),

  // ─── Stats ───
  stats: publicProcedure.query(async () => {
    const [total, rejects] = await Promise.all([
      prisma.aiDecisionFeedback.count(),
      prisma.aiDecisionFeedback.count({ where: { humanAction: 'REJECT' } }),
    ]);
    const acceptanceRate = total > 0 ? Math.round((1 - rejects / total) * 100) : 100;
    return { total, rejects, acceptanceRate };
  }),
});
