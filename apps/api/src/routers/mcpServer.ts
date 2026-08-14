import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';
import { encrypt, decrypt } from '../lib/crypto.js';
import { mcpRegistry } from '../agent/mcp/registry.js';

function maskKey(raw: string): string {
  if (!raw || raw.length <= 8) return '****';
  return raw.substring(0, 8) + '****' + raw.substring(raw.length - 4);
}

// ═══ MCP Server Management — CRUD for connected MCP servers ═══

export const mcpServerRouter = router({
  // ─── List all servers (apiKey masked) ───
  list: publicProcedure.query(async () => {
    const servers = await prisma.mcpServer.findMany({ orderBy: { createdAt: 'asc' } });
    const result = [];
    for (const s of servers) {
      let keyMasked: string | null = null;
      if (s.apiKey) {
        try { keyMasked = maskKey(await decrypt(s.apiKey)); } catch { keyMasked = '****'; }
      }
      result.push({
        id: s.id,
        name: s.name,
        url: s.url,
        hasApiKey: !!s.apiKey,
        keyMasked,
        enabled: s.enabled,
        transport: s.transport || 'http',
        hasHeaders: !!s.headers,
        status: mcpRegistry.getServerStatus(s.id) || s.status || 'unknown',
        lastError: s.lastError,
        lastConnectedAt: s.lastConnectedAt,
        toolCount: s.toolCount || 0,
        hitlMode: s.hitlMode || 'none',
        hitlConfirmUrl: s.hitlConfirmUrl,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    }
    return result;
  }),

  // ─── Create ───
  create: publicProcedure
    .input(z.object({
      name: z.string().min(1).max(50),
      url: z.string().min(1),
      apiKey: z.string().optional(),
      transport: z.enum(['http', 'jsonrpc', 'legacy', 'auto']).default('http'),
      headers: z.string().optional(),       // JSON string
      hitlMode: z.enum(['none', 'poll', 'confirm']).default('none'),
      hitlConfirmUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Validate URL format
      try { new URL(input.url); } catch { throw new Error('Invalid URL format'); }

      // Check duplicate name
      const existing = await prisma.mcpServer.findFirst({ where: { name: input.name } });
      if (existing) throw new Error(`Server "${input.name}" already exists`);

      // Encrypt sensitive fields
      const apiKey = input.apiKey ? await encrypt(input.apiKey) : null;
      const headers = input.headers ? await encrypt(input.headers) : null;

      const srv = await prisma.mcpServer.create({
        data: {
          name: input.name,
          url: input.url,
          apiKey,
          transport: input.transport,
          headers,
          hitlMode: input.hitlMode,
          hitlConfirmUrl: input.hitlConfirmUrl || null,
        },
      });

      return { id: srv.id, name: srv.name };
    }),

  // ─── Update ───
  update: publicProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(50).optional(),
      url: z.string().optional(),
      apiKey: z.string().optional(),        // empty = keep existing
      transport: z.enum(['http', 'jsonrpc', 'legacy', 'auto']).optional(),
      headers: z.string().optional(),
      hitlMode: z.enum(['none', 'poll', 'confirm']).optional(),
      hitlConfirmUrl: z.string().optional(),
      enabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, apiKey, headers, ...rest } = input;

      const data: any = { ...rest };

      // Only update key/headers if new value provided
      if (apiKey !== undefined) {
        data.apiKey = apiKey ? await encrypt(apiKey) : null;
      }
      if (headers !== undefined) {
        data.headers = headers ? await encrypt(headers) : null;
      }

      data.updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

      // Clear status on config change
      if (rest.url || rest.transport) {
        data.status = 'unknown';
        data.lastError = null;
      }

      await prisma.mcpServer.update({ where: { id }, data });
      // Invalidate cache so next request re-discovers
      mcpRegistry.invalidate(id);
      return { ok: true };
    }),

  // ─── Delete ───
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await mcpRegistry.disconnect(input.id);
      await prisma.mcpServer.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // ─── Test connection + discover tools ───
  test: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const result = await mcpRegistry.connect(input.id);
      return {
        ok: result.ok,
        toolCount: result.tools.length,
        tools: result.tools.map(t => ({ name: t.name, description: t.description?.substring(0, 100), risk: t.risk })),
        error: result.error,
        latencyMs: result.latencyMs,
      };
    }),

  // ─── Refresh tools for a server ───
  refreshTools: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const tools = await mcpRegistry.refresh(input.id);
      return { ok: true, toolCount: tools.length };
    }),

  // ─── Connect ───
  connect: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const result = await mcpRegistry.connect(input.id);
      return { ok: result.ok, error: result.error };
    }),

  // ─── Disconnect ───
  disconnect: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await mcpRegistry.disconnect(input.id);
      return { ok: true };
    }),

  // ─── Preview tools for a server (cached) ───
  listTools: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const tools = mcpRegistry.getServerTools(input.id);
      return tools.map(t => ({
        name: t.name,
        description: t.description?.substring(0, 200),
        risk: t.risk,
        hasSchema: !!(t.inputSchema && Object.keys(t.inputSchema.properties || {}).length > 0),
      }));
    }),
});
