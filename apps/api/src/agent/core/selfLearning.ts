import { prisma } from '@tomatolite/database';

/** Retrieve past mistakes to avoid (REJECT feedback from last 7 days, top 3) */
export async function getLearnHint(): Promise<string> {
  try {
    const lessons = await prisma.aiDecisionFeedback.findMany({
      where: { humanAction: 'REJECT', createdAt: { gte: new Date(Date.now() - 7 * 86400000).toISOString() } },
      orderBy: { createdAt: 'desc' }, take: 3,
    });
    if (lessons.length > 0) {
      return `\n📚 PAST MISTAKES TO AVOID:\n${lessons.map(l => `- ${l.featureType}: you said "${l.aiOutput?.substring(0, 80)}" → user REJECTED`).join('\n')}`;
    }
  } catch (_) { /* best-effort */ }
  return '';
}

/** Retrieve learned user preferences from ACCEPT feedback (last 30 days, top 20) */
export async function getPreferenceHint(): Promise<string> {
  try {
    const recent = await prisma.aiDecisionFeedback.findMany({
      where: { humanAction: 'ACCEPT', createdAt: { gte: new Date(Date.now() - 30 * 86400000).toISOString() } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    if (recent.length > 0) {
      const byType: Record<string, string[]> = {};
      for (const f of recent) {
        const t = f.featureType?.replace('suggest_', '') || 'general';
        if (!byType[t]) byType[t] = [];
        byType[t].push(f.aiOutput?.substring(0, 60) || '');
      }
      const hints = Object.entries(byType).map(([t, outputs]) => {
        const unique = [...new Set(outputs)].slice(0, 3);
        return `${t}: ${unique.join(' | ')}`;
      });
      if (hints.length > 0) return `\n📚 Learned preferences (user has accepted these):\n${hints.join('\n')}\n`;
    }
  } catch (_) { /* best-effort */ }
  return '';
}
