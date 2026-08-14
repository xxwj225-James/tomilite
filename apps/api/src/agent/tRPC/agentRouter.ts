import { router, publicProcedure, z } from '../../trpc.js';
import { prisma } from '@tomatolite/database';
import { decrypt } from '../../lib/crypto.js';
import { DEFAULT_PROJECT_ID } from '../utils/constants.js';

/** Non-streaming chat, board stats, project stats, LLM config status, intent classification */
export const agentRouter = router({
  /**
   * Simple non-streaming chat (used by compress/learn, not the main UI).
   * No tools, no Guard — just sends history to LLM and returns the response.
   */
  chat: publicProcedure
    .input(z.object({
      message: z.string(),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string(), reasoning_content: z.string().optional(), tool_calls: z.any().optional() })).default([]),
    }))
    .mutation(async ({ input }) => {
      const cfg = await prisma.llmConfig.findFirst({ include: { flashProvider: true, proProvider: true } });

      let baseUrl = '';
      let apiKey = '';
      let model = '';

      if (cfg) {
        const activeProvider = cfg.proProvider || cfg.flashProvider;
        if (activeProvider) {
          const master = await prisma.llmProviderMaster.findUnique({ where: { id: activeProvider.providerId } });
          if (master) baseUrl = master.apiBaseUrl;
          apiKey = activeProvider.apiKey || '';
        }
        model = cfg.proModel || cfg.flashModel;
      }

      if (!apiKey) {
        const standaloneProvider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
        if (standaloneProvider) {
          apiKey = standaloneProvider.apiKey || '';
          const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: standaloneProvider.id } } } });
          baseUrl = master?.apiBaseUrl || baseUrl;
        }
      }

      if (!apiKey) {
        return { content: '⚠️ No API key configured. Go to Settings → 🤖 LLM to set up your DeepSeek API key.', tool: null };
      }

      const systemPrompt = `You are Tomi, the AI inside TomiLite. Never say you are Kimi, Moonshot, or any other AI — you are Tomi. Be encouraging, use emojis naturally. End every response with one short suggestion. Current project: My Project (key: TL). Use tools when asked. Keep 2-4 sentences + suggestion.`;

      const messages: any[] = [
        { role: 'system', content: systemPrompt },
        ...input.history.map(h => {
          const entry: any = { role: h.role, content: h.content };
          if (h.reasoning_content && h.tool_calls && h.tool_calls.length > 0) entry.reasoning_content = h.reasoning_content;
          return entry;
        }),
        { role: 'user', content: input.message },
      ];

      try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages, max_tokens: 2000 }),
          signal: AbortSignal.timeout(60000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          if (resp.status === 401) return { content: '❌ Invalid API key. Check your DeepSeek API key in Settings → 🤖 LLM.', tool: null };
          return { content: `❌ API error (${resp.status}). ${errText.substring(0, 200)}`, tool: null };
        }

        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) return { content: '(no response from model)', tool: null };

        return { content, tool: null };
      } catch (e: any) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') {
          return { content: '⏱ Request timed out. The model may be busy. Try again.', tool: null };
        }
        return { content: `⚠️ Cannot reach ${baseUrl}. Check your network and API endpoint in Settings.`, tool: null };
      }
    }),

  getBoardStatus: publicProcedure.query(async () => {
    const board = await prisma.board.findFirst({
      where: { projectId: DEFAULT_PROJECT_ID },
      include: { columns: { orderBy: { sortOrder: 'asc' }, include: { cards: { include: { issue: true } } } } },
    });
    if (!board) return { columns: [] };
    return {
      columns: board.columns.map(col => ({
        name: col.name,
        count: col.cards.length,
        issues: col.cards.map(c => ({
          key: `TL-${c.issue?.issueNumber || '?'}`,
          title: c.issue?.title || '',
          priority: c.issue?.priority || 'medium',
          description: c.issue?.description || '',
          status: c.issue?.status || 'todo',
          type: c.issue?.type || 'task',
          storyPoints: c.issue?.storyPoints || 0,
        })),
      })),
    };
  }),

  getProjectStats: publicProcedure.query(async () => {
    const issues = await prisma.issue.findMany({ where: { projectId: DEFAULT_PROJECT_ID } });
    return {
      total: issues.length,
      todo: issues.filter(i => i.status === 'todo').length,
      inProgress: issues.filter(i => ['in_progress', 'in_review'].includes(i.status)).length,
      done: issues.filter(i => i.status === 'done').length,
      issues: issues.slice(0, 10).map(i => ({ key: `TL-${i.issueNumber}`, title: i.title, status: i.status, priority: i.priority })),
    };
  }),

  status: publicProcedure.query(async () => {
    const standaloneProvider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
    const cfg = await prisma.llmConfig.findFirst();
    const hasCloudKey = !!(standaloneProvider?.apiKey);
    const hasOllama = cfg?.ollamaEnabled && cfg?.ollamaUrl;
    let displayName = 'DeepSeek';
    if (standaloneProvider?.providerId) {
      const master = await prisma.llmProviderMaster.findUnique({ where: { id: standaloneProvider.providerId } });
      if (master?.displayName) displayName = master.displayName;
    }
    return {
      configured: hasCloudKey || hasOllama,
      provider: displayName,
      model: cfg?.proModel || cfg?.flashModel,
    };
  }),

  classifyIntent: publicProcedure
    .input(z.object({ message: z.string(), cardType: z.string(), blockedTitle: z.string() }))
    .mutation(async ({ input }) => {
      const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
      if (!provider?.apiKey) return { intent: 'other' };
      const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
      const cfg = await prisma.llmConfig.findFirst();
      const baseUrl = master?.apiBaseUrl;
      const model = cfg?.flashModel;
      const apiKey = await decrypt(provider.apiKey);

      const prompt = `CONTEXT: The user asked to create a ${input.cardType} titled "${input.blockedTitle}". The system blocked it as a duplicate and showed a card with buttons: [强行创建 / Force Create] and [取消 / Cancel]. The user is now responding to this blocked card.

Classify their intent as JSON: {"intent":"<label>"}

Labels:
- "force" — user wants to bypass the warning and create anyway. Includes: explicit confirmations (yes, ok, 建吧, 强制, 行, 继续, go ahead, 好的, 可以), repeating the same request, or any affirmative response.
- "cancel" — user wants to abort and NOT create. Includes: refusals (no, stop, 算了, 不要, 取消, 放弃, 别建了, 不需要), "不创建了", going back, changing their mind, or any negative/withdrawing response.
- "other" — user is talking about something completely unrelated, not addressing the card at all.

User message: "${input.message.substring(0, 300)}"
JSON:`;

      try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 50, temperature: 0, response_format: { type: 'json_object' }, thinking: { type: 'disabled' } }),
          signal: AbortSignal.timeout(4000),
        });
        if (resp.ok) {
          const d = await resp.json();
          try {
            const parsed = JSON.parse(d.choices?.[0]?.message?.content || '{}');
            const intent = parsed.intent || '';
            if (intent.includes('force') || intent.includes('proceed')) return { intent: 'confirm' };
            if (intent.includes('stop') || intent.includes('cancel')) return { intent: 'cancel' };
          } catch { /* malformed JSON, fall through */ }
        }
      } catch (_) { /* timeout or network error */ }
      return { intent: 'other' };
    }),
});
