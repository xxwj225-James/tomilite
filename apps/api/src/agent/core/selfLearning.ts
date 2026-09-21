import { prisma } from '@tomilite/database';
import { utcStamp } from '../../lib/dbTime.js';

// The cutoffs here are UTC stamps, matching how the column is stored. `toISOString()`
// yields `2026-09-20T05:34:23.123Z` — a different shape from the column's
// `2026-09-20 05:34:23`, so the text compare read the separator at index 10 (space
// against `T`) and sorted every same-day row to the wrong side of the cutoff. See
// lib/dbTime.ts.
const DAY_MS = 86400000;

/** Retrieve past mistakes to avoid (REJECT feedback from last 7 days, top 3) */
export async function getLearnHint(): Promise<string> {
  try {
    const lessons = await prisma.aiDecisionFeedback.findMany({
      where: { humanAction: 'REJECT', createdAt: { gte: utcStamp(new Date(Date.now() - 7 * DAY_MS)) } },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    if (lessons.length > 0) {
      return `\n📚 PAST MISTAKES TO AVOID:\n${lessons.map((l) => `- ${l.featureType}: you said "${l.aiOutput?.substring(0, 80)}" → user REJECTED`).join('\n')}`;
    }
  } catch {
    /* best-effort */
  }
  return '';
}

/** Retrieve learned user preferences from ACCEPT feedback (last 30 days, top 20) */
export async function getPreferenceHint(): Promise<string> {
  try {
    const recent = await prisma.aiDecisionFeedback.findMany({
      where: { humanAction: 'ACCEPT', createdAt: { gte: utcStamp(new Date(Date.now() - 30 * DAY_MS)) } },
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
  } catch {
    /* best-effort */
  }
  return '';
}
