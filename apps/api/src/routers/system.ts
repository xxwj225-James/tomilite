import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { onConsentChanged } from '../lib/telemetry.js';
import { homedir } from 'node:os';
import { resolveLLM, isDeepseekEndpoint } from '../lib/gateway.js';

const CURRENT_VERSION = '1.0.0';

export const systemRouter = router({
  currentVersion: publicProcedure.query(() => ({ version: CURRENT_VERSION })),

  getHomeDir: publicProcedure.query(() => {
    return { path: homedir() };
  }),

  notifyCount: publicProcedure.query(async () => {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'notifyCount' } });
    return { count: cfg ? parseInt(cfg.value) || 0 : 0 };
  }),

  clearNotifications: publicProcedure.mutation(async () => {
    return prisma.systemConfig.upsert({
      where: { key: 'notifyCount' },
      create: { key: 'notifyCount', value: '0' },
      update: { value: '0' },
    });
  }),

  mcpPendingCount: publicProcedure.query(async () => {
    const count = await prisma.mcpAuditLog.count({ where: { status: 'pending' } });
    return { count };
  }),
  // ─── Daily Motto ───
  getMotto: publicProcedure.input(z.object({ lang: z.string().default('en') })).query(async ({ input }) => {
    try {
      const today = new Date().toISOString().substring(0, 10);
      const cached = await prisma.dailyMotto.findUnique({ where: { date_lang: { date: today, lang: input.lang } } });
      return cached?.text || null;
    } catch {
      return null;
    }
  }),

  generateMotto: publicProcedure.input(z.object({ lang: z.string().default('en') })).mutation(async ({ input }) => {
    const llm = await resolveLLM();
    if (!llm?.baseUrl) {
      console.error('[Motto] No active LLM configured (BYOK or hosted)');
      return { text: '' };
    }
    const baseUrl = llm.baseUrl;
    const model = llm.flashModel || llm.proModel || 'deepseek-chat';
    const apiKey = llm.apiKey;
    const langLabel = input.lang === 'zh' ? 'Chinese' : input.lang === 'ja' ? 'Japanese' : 'English';

    try {
      // Gather user context for personalized motto
      const [issues, notes, commits, yesterdayMotto] = await Promise.all([
        prisma.issue.findMany({
          where: { projectId: 'proj-default' },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: { title: true, status: true },
        }),
        prisma.knowledgePage.findMany({
          where: { projectId: 'proj-default' },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: { title: true },
        }),
        prisma.gitCommit.findMany({ orderBy: { timestamp: 'desc' }, take: 5, select: { message: true } }),
        (async () => {
          try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const d = yesterday.toISOString().substring(0, 10);
            const row = await prisma.dailyMotto.findUnique({ where: { date_lang: { date: d, lang: input.lang } } });
            return row?.text || '';
          } catch {
            return '';
          } // table might not exist yet — non-fatal
        })(),
      ]);
      const context = [
        issues.length > 0 ? `Tasks: ${issues.map((i) => `[${i.status}] ${i.title}`).join('; ')}` : '',
        notes.length > 0 ? `Notes: ${notes.map((n) => n.title).join('; ')}` : '',
        commits.length > 0 ? `Git: ${commits.map((c) => c.message).join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      // Vary the style each time for diversity
      const STYLES = [
        'focus on persistence and effort',
        'focus on creativity and innovation',
        'focus on teamwork and collaboration',
        'focus on learning and growth',
        'focus on craftsmanship and quality',
        'focus on impact and helping others',
        'focus on overcoming challenges',
        'focus on the joy of building',
      ];
      const style = STYLES[Math.floor(Math.random() * STYLES.length)];

      const isKimi = baseUrl?.includes('moonshot');
      const yesterdayHint = yesterdayMotto
        ? `\nYesterday's motto was: "${yesterdayMotto}". Do NOT repeat or rephrase it. Write something completely different.`
        : '';
      const body: any = {
        model,
        messages: [
          {
            role: 'user',
            content: `Based on the user's recent work below, output ONLY one short motivational sentence (max 20 words, no quotes, no emojis). The sentence MUST be POSITIVE and UPLIFTING — a personalized encouragement that references what the user is working on. This time, ${style}. Write in ${langLabel}.${yesterdayHint}
${context ? `User's recent work:\n${context}` : ''}
Just the sentence. Nothing else.`,
          },
        ],
        max_tokens: 60,
        temperature: isKimi ? 0.6 : 1.2,
      };
      if (isDeepseekEndpoint(baseUrl) || isKimi) body.thinking = { type: 'disabled' };
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        const d = await resp.json();
        const text = (d.choices?.[0]?.message?.content || '')
          .replace(/[？?].*$/, '')
          .replace(/\n.*$/s, '')
          .trim();
        if (text) {
          const today = new Date().toISOString().substring(0, 10);
          try {
            await prisma.dailyMotto.upsert({
              where: { date_lang: { date: today, lang: input.lang } },
              create: { date: today, lang: input.lang, text },
              update: { text },
            });
          } catch {
            /* table may not exist yet */
          }
          return { text };
        }
        console.error('[Motto] LLM returned empty content, body:', JSON.stringify(d).substring(0, 200));
      } else {
        const errText = await resp.text().catch(() => '');
        const errSummary = `[Motto] API ${resp.status}: ${errText.substring(0, 100)}`;
        console.error(errSummary);
        return { text: '', error: errSummary };
      }
    } catch (e: any) {
      const errSummary = `[Motto] ${e?.message || e}`;
      console.error(errSummary);
      return { text: '', error: errSummary };
    }
    return { text: '', error: 'LLM returned empty content' };
  }),

  saveMotto: publicProcedure
    .input(z.object({ text: z.string(), lang: z.string().optional() }))
    .mutation(async ({ input }) => {
      const today = new Date().toISOString().substring(0, 10);
      return prisma.dailyMotto.upsert({
        where: { date_lang: { date: today, lang: input.lang || 'en' } },
        create: { date: today, lang: input.lang || 'en', text: input.text },
        update: { text: input.text },
      });
    }),

  getConfig: publicProcedure.input(z.object({ key: z.string() })).query(async ({ input }) => {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: input.key } });
    return cfg?.value || null;
  }),

  setConfig: publicProcedure.input(z.object({ key: z.string(), value: z.string() })).mutation(async ({ input }) => {
    const res = await prisma.systemConfig.upsert({
      where: { key: input.key },
      create: { key: input.key, value: input.value },
      update: { value: input.value },
    });
    // Telemetry consent switch: revoking consent drops the local buffer and
    // stops capture immediately; opting in records the launch event.
    if (input.key === 'telemetry.consent') {
      onConsentChanged(input.value).catch(() => {});
    }
    return res;
  }),

  isSetupCompleted: publicProcedure.query(async () => {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'setupCompleted' } });
    return cfg?.value === 'true';
  }),

  markSetupCompleted: publicProcedure.mutation(async () => {
    return prisma.systemConfig.upsert({
      where: { key: 'setupCompleted' },
      create: { key: 'setupCompleted', value: 'true' },
      update: { value: 'true' },
    });
  }),

  saveLanguage: publicProcedure.input(z.object({ lang: z.string() })).mutation(async ({ input }) => {
    await prisma.systemConfig.upsert({
      where: { key: 'uiLanguage' },
      create: { key: 'uiLanguage', value: input.lang },
      update: { value: input.lang },
    });
    return { ok: true };
  }),
});
