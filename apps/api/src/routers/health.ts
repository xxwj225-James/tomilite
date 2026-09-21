import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { t } from '../lib/i18n.js';
import { isTask } from '../lib/taskScope.js';
import { localDayKey, parseUtc, parseUtcMs, utcStamp } from '../lib/dbTime.js';
import { resolveLLM, isDeepseekEndpoint } from '../lib/gateway.js';

// ═══ AI Health Scorer — rule-based engine + optional LLM polish ═══

function scoreCompletion(total: number, done: number): number {
  if (total === 0) return 50; // neutral
  const rate = done / total;
  return Math.round(rate * 100);
}

function scoreVelocity(recentDone: number, totalDone: number): number {
  if (totalDone === 0 && recentDone === 0) return 50;
  if (totalDone === 0) return 40;
  const recentRatio = recentDone / Math.max(totalDone, 1);
  return Math.round(Math.min(100, recentRatio * 100));
}

function scoreGit(gitRefs: number): number {
  if (gitRefs === 0) return 30;
  return Math.min(100, 40 + gitRefs * 10);
}

function scoreStaleness(staleCount: number, total: number): number {
  if (total === 0) return 50;
  const ratio = staleCount / total;
  return Math.round(Math.max(0, 100 - ratio * 200)); // penalize staleness
}

export const healthRouter = router({
  personalHealth: publicProcedure
    .input(z.object({ lang: z.string().default('en'), force: z.boolean().default(false) }))
    .query(async ({ input }) => {
      // Return cached snapshot if within 2 hours and same language (unless forced).
      // The cutoff is a UTC stamp because the column is UTC — see lib/dbTime.ts. A UTC
      // stamp compared against the localtime this column used to hold never matched, so
      // the cache below was simply never used and every call paid for a fresh LLM pass.
      if (!input.force) {
        const twoHoursAgo = utcStamp(new Date(Date.now() - 2 * 3600000));
        const cached = await prisma.userHealthSnapshot.findFirst({
          where: { createdAt: { gte: twoHoursAgo }, lang: input.lang },
          orderBy: { createdAt: 'desc' },
        });
        if (cached) {
          return {
            score: cached.healthScore,
            level: cached.healthLevel,
            dimensions: JSON.parse(cached.dimensions || '{}'),
            summary: cached.summary,
            recommendations: [],
            gitToday: 0,
            total: cached.total,
            done: 0,
            inProgress: 0,
            todo: 0,
            cached: true,
            generatedAt: cached.createdAt,
          };
        }
      }

      const now = Date.now();
      const dayMs = 86400000;
      const weekMs = 7 * dayMs;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Issues — emails mirrored into the Issue table are not tasks, and neither is
      // anything in a status the board cannot show. See lib/taskScope.ts for why
      // this matters: it is the same set the task board and the Home stat card use.
      const allIssues = (await prisma.issue.findMany({ where: { projectId: 'proj-default' } })).filter(isTask);
      const total = allIssues.length;
      const done = allIssues.filter((i) => i.status === 'done').length;
      const inProgress = allIssues.filter((i) => ['in_progress', 'in_review'].includes(i.status)).length;
      const todo = allIssues.filter((i) => i.status === 'todo').length;
      // Stamps are read as UTC — see lib/dbTime.ts. `new Date(stamp)` would parse them as
      // local, which is off by the UTC offset and can move a row across the week/day
      // boundary. An unreadable stamp is treated as "not recent", never as epoch 0.
      const ageMs = (s: string | null) => {
        const ms = parseUtcMs(s);
        return ms === null ? null : now - ms;
      };
      const recentlyDone = allIssues.filter((i) => {
        const age = ageMs(i.updatedAt);
        return i.status === 'done' && age !== null && age < weekMs;
      });
      const stale = allIssues.filter((i) => {
        const age = ageMs(i.createdAt);
        return i.status !== 'done' && age !== null && age > 14 * dayMs;
      });

      // Git — use gitCommit (all commits), not gitCommitRef (only issue-linked).
      //
      // `GitCommit.timestamp` is the one column that stores an ISO string carrying its
      // own offset (`2026-09-03T08:34:04+08:00`), so it cannot be filtered with the
      // naive-UTC shape the other tables use. A `Z`-shaped cutoff compared against it is
      // a text compare that reads the separator at index 10 and then a *date* — and the
      // cutoff's date is the UTC one, which at UTC+8 is still yesterday until 08:00
      // local. That pulled in the previous evening. The date prefix of this column *is*
      // local, so it works as a deliberately loose lower bound; the real comparison is
      // then done on instants.
      const looseFrom = localDayKey(new Date(today.getTime() - dayMs));
      const gitCandidates = await prisma.gitCommit.findMany({
        where: { timestamp: { gte: looseFrom }, archived: false },
      });
      const gitCommits = gitCandidates.filter((c) => {
        const ms = parseUtcMs(c.timestamp);
        return ms !== null && ms >= today.getTime();
      });

      // Scores
      const dimensions = {
        completion: scoreCompletion(total, done),
        velocity: scoreVelocity(recentlyDone.length, done),
        git_activity: scoreGit(gitCommits.length),
        staleness: scoreStaleness(stale.length, total),
      };

      const overall = Math.round(Object.values(dimensions).reduce((a, b) => a + b, 0) / Object.keys(dimensions).length);

      const level = overall >= 80 ? 'excellent' : overall >= 60 ? 'good' : overall >= 40 ? 'fair' : 'needs_attention';
      const recommendations: string[] = [];
      if (dimensions.staleness < 50) recommendations.push(t('health.recStaleness', input.lang));
      if (dimensions.git_activity < 50) recommendations.push(t('health.recGit', input.lang));
      if (dimensions.completion < 40) recommendations.push(t('health.recCompletion', input.lang));

      // Try LLM polish
      const fallbackSummary = t('health.fallbackSummary', input.lang, {
        score: String(overall),
        level,
        done: String(done),
        inProgress: String(inProgress),
        todo: String(todo),
      });
      const langLabel = input.lang === 'zh' ? 'Chinese' : input.lang === 'ja' ? 'Japanese' : 'English';
      let summary = fallbackSummary;
      try {
        const llm = await resolveLLM();
        if (llm) {
          const baseUrl = llm.baseUrl || '';
          const body: any = {
            model: llm.flashModel || llm.proModel,
            max_tokens: 500,
            messages: [
              {
                role: 'user',
                content: `You are a thoughtful developer coach. Write a detailed health analysis (3-4 paragraphs, 150-200 words total) based on these metrics:

Score: ${overall}/100 (level: ${level})
Tasks: ${done} done, ${inProgress} in progress, ${todo} todo, ${stale.length} stale
Git Activity: ${gitCommits.length} commits tracked

Structure your analysis as:
1. Overall assessment (1 sentence)
2. What's going well (1-2 specific points based on strengths)
3. What needs attention (1-2 specific points based on weaknesses)
4. One actionable tip for tomorrow

Be warm, encouraging, and specific. Reference the actual numbers. Write in ${langLabel}. Do NOT add any greeting, preamble, or closing — start directly with the analysis.`,
              },
            ],
          };
          if (baseUrl.includes('moonshot') || isDeepseekEndpoint(baseUrl)) body.thinking = { type: 'disabled' };
          else if (baseUrl.includes('dashscope')) body.enable_thinking = false;
          const resp = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
          });
          if (resp.ok) {
            const data = await resp.json();
            let content = data.choices?.[0]?.message?.content;
            if (content) {
              // Strip common preamble patterns
              content = content
                .replace(
                  /^(好的[，,]?|OK[，,]?\s*|Based on the (data|metrics)[，,]?\s*|Here'?s?\s*(is|are)\s*(my|the)\s*(analysis|assessment)[，,:]?\s*)/i,
                  '',
                )
                .trim();
              summary = content;
            }
          }
        }
      } catch {}

      // Trend: one snapshot per day (last 6 days), then append today's score
      const raw = await prisma.userHealthSnapshot.findMany({
        where: { lang: input.lang },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { healthScore: true, createdAt: true },
      });
      // Dedupe: keep only the first (most recent) snapshot per day.
      //
      // "Day" is the local calendar day, so the stamp is parsed as the UTC it is and
      // then rendered in the host's zone. Slicing the stored text gave the UTC day
      // instead, which for anything logged after midnight local (16:00 UTC) is the
      // previous one — two snapshots a day apart could collapse into one bucket and a
      // day could be skipped entirely.
      const seen = new Set<string>();
      const dailyScores: number[] = [];
      for (const s of raw) {
        const at = parseUtc(s.createdAt);
        const day = at ? localDayKey(at) : s.createdAt.substring(0, 10);
        if (!seen.has(day)) {
          seen.add(day);
          dailyScores.unshift(s.healthScore);
        }
        if (dailyScores.length >= 6) break;
      }
      const history = [...dailyScores, overall];
      const prevAvg = dailyScores.length > 0 ? dailyScores.reduce((s, v) => s + v, 0) / dailyScores.length : overall;
      const direction = overall > prevAvg + 3 ? 'up' : overall < prevAvg - 3 ? 'down' : 'steady';

      // Save snapshot. `utcStamp`, not `toLocaleString('sv-SE')` — the column default is
      // localtime and this writer was matching it, which put every snapshot 8h ahead of
      // the UTC cutoff the cache check above compares it against. See lib/dbTime.ts.
      const now2 = utcStamp();
      await prisma.userHealthSnapshot.create({
        data: {
          healthScore: overall,
          healthLevel: level,
          dimensions: JSON.stringify(dimensions),
          summary,
          total,
          lang: input.lang,
          createdAt: now2,
        },
      });

      return {
        score: overall,
        level,
        dimensions,
        summary,
        recommendations,
        gitToday: gitCommits.length,
        total,
        done,
        inProgress,
        todo,
        generatedAt: now2,
        trend: { direction, history, prevAvg: Math.round(prevAvg) },
      };
    }),

  healthHistory: publicProcedure.input(z.object({ limit: z.number().default(7) })).query(async ({ input }) => {
    return prisma.userHealthSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      select: { healthScore: true, healthLevel: true, summary: true, createdAt: true },
    });
  }),

  taskStats: publicProcedure.query(async () => {
    // The same set the task board's three tabs count, so the two views agree. This
    // used to load every row — including the emails the Email panel mirrors into
    // the Issue table and the `cancelled` ones no tab shows — so the card reported
    // a total the board could not reach and a completion rate computed over
    // newsletters. lib/taskScope.ts has the details.
    const issues = (await prisma.issue.findMany({ where: { projectId: 'proj-default' } })).filter(isTask);
    const total = issues.length;
    // No early return for `total === 0`. It used to exist and handed back `{}` for the
    // three breakdown maps, while the path below hands back zero-filled ones — one
    // payload with two shapes. The Home card renders its priority rows by walking
    // `byPriority`, so an empty task board produced a card header with no rows under
    // it. Over an empty list every loop below is a no-op, so the shortcut bought
    // nothing but the inconsistency.

    const byStatus: Record<string, number> = {};
    for (const i of issues) {
      byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    }

    const PRIO_ORDER = ['critical', 'high', 'medium', 'low'];
    const byPriority: Record<string, number> = {};
    for (const p of PRIO_ORDER) byPriority[p] = 0;
    for (const i of issues) {
      byPriority[i.priority] = (byPriority[i.priority] || 0) + 1;
    }

    const TYPES = ['task', 'bug', 'story'];
    const byType: Record<string, number> = {};
    for (const t of TYPES) byType[t] = 0;
    for (const i of issues) {
      const t = TYPES.includes(i.type) ? i.type : 'task';
      byType[t] = (byType[t] || 0) + 1;
    }

    const done = byStatus['done'] || 0;
    // Compared as timestamps, not as strings. `updatedAt` is written as
    // `YYYY-MM-DD HH:MM:SS` and an ISO cutoff is `YYYY-MM-DDTHH:MM:SS.sssZ`, so a
    // string compare reads the separator at index 10 — a space against a `T` — and
    // silently sorts same-day rows to the wrong side of the cutoff. Read as UTC, per
    // lib/dbTime.ts.
    const weekAgo = Date.now() - 7 * 86400000;
    const recentlyDone = issues.filter((i) => {
      const ms = parseUtcMs(i.updatedAt);
      return i.status === 'done' && ms !== null && ms >= weekAgo;
    }).length;

    return {
      total,
      byStatus,
      byPriority,
      byType,
      // Guarded rather than left to the old early return: `done / 0` is `NaN`, and
      // `NaN` leaves the API as `null`.
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
      done,
      recentlyDone,
    };
  }),
});
