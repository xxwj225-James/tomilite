import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { encrypt, decrypt } from '../lib/crypto';
import { getProxyUrl } from '../agent/utils/proxy.js';

export const llmRouter = router({
  getConfig: publicProcedure.query(async () => {
    const cfg = await prisma.llmConfig.findFirst({ include: { flashProvider: true, proProvider: true } });
    const providers = await prisma.llmProviderMaster.findMany({ where: { name: { notIn: ['openai', 'anthropic'] } } });
    const activeProvider = await prisma.llmProvider.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } });
    // Return decrypted key (for Test Connection) + masked version (for UI display)
    let apiKeyDecrypted: string | null = null;
	let keyMasked: string | null = null;
    if (activeProvider?.apiKey) {
      try {
        apiKeyDecrypted = await decrypt(activeProvider.apiKey);
        keyMasked = apiKeyDecrypted && apiKeyDecrypted.length > 8
          ? apiKeyDecrypted.substring(0, 8) + '****' + apiKeyDecrypted.substring(apiKeyDecrypted.length - 4)
          : '****';
      } catch { keyMasked = '****'; }
    }
    return {
      config: cfg,
      providers,
      activeProvider: activeProvider ? {
        id: activeProvider.id,
        providerId: activeProvider.providerId,
        isActive: activeProvider.isActive,
        hasKey: !!activeProvider.apiKey,
        apiKey: apiKeyDecrypted,
        keyMasked,
      } : null,
    };
  }),

  saveConfig: publicProcedure
    .input(z.object({
      flashModel: z.string().optional(),
      proModel: z.string().optional(),
      ollamaUrl: z.string().optional(),
      ollamaEnabled: z.boolean().optional(),
      contextWindow: z.number().optional(),
      maxOutputTokens: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      return prisma.llmConfig.upsert({
        where: { id: 'llm-default' },
        create: { id: 'llm-default', ...input },
        update: input,
      });
    }),

  saveProvider: publicProcedure
    .input(z.object({
      providerId: z.string(),
      apiKey: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      // Deactivate all other providers first (ensure only one active)
      if (input.isActive !== false) {
        await prisma.llmProvider.updateMany({ where: { isActive: true }, data: { isActive: false } });
      }
      const encryptedKey = input.apiKey ? await encrypt(input.apiKey) : null;
      return prisma.llmProvider.upsert({
        where: { providerId: input.providerId },
        create: { providerId: input.providerId, apiKey: encryptedKey, isActive: input.isActive ?? true },
        update: { apiKey: encryptedKey, isActive: input.isActive ?? true },
      });
    }),

  testConnection: publicProcedure
    .input(z.object({ baseUrl: z.string(), apiKey: z.string().optional(), model: z.string() }))
    .mutation(async ({ input }) => {
      let code = 0, errMsg = '';
      const fetchOpts: any = {};
      const proxy = getProxyUrl();
      if (proxy && (input.baseUrl?.includes('openai') || input.baseUrl?.includes('anthropic'))) {
        try { // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional dep loaded lazily
          const { ProxyAgent } = require('undici'); fetchOpts.dispatcher = new ProxyAgent(proxy); } catch { /* undici not available */ }
      }
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (input.apiKey) headers['Authorization'] = `Bearer ${input.apiKey}`;
        const resp = await fetch(`${input.baseUrl}/chat/completions`, {
          method: 'POST', headers,
          body: JSON.stringify({ model: input.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(10000),
          ...fetchOpts,
        });
        code = resp.status;
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          errMsg = body.substring(0, 200);
        }
      } catch (e: any) {
        errMsg = e.message || 'Network error';
      }
      return { ok: code >= 200 && code < 300, status: code, message: errMsg };
    }),
});
