// ═══ MCP Tool Registry — in-memory cache with lazy discovery ═══

import { prisma } from '@tomilite/database';
import { decrypt } from '../../lib/crypto.js';
import { createMCPClient } from './client.js';
import { agentLog } from '../utils/logger.js';
import type { McpToolInfo, TransportMode } from './types.js';

interface ServerCacheEntry {
  serverId: string;
  serverName: string;
  tools: McpToolInfo[];
  status: 'online' | 'offline' | 'error' | 'unknown';
  lastError?: string;
  cachedAt: number;
}

const TTL_MS = 30_000; // 30 seconds — refresh on next request
const DISCOVERY_TIMEOUT_MS = 10_000;

class MCPRegistry {
  private cache = new Map<string, ServerCacheEntry>();
  private refreshing = false;

  /** Ensure cache is fresh for all enabled servers. Called before every chat request. */
  async ensureFresh(): Promise<void> {
    const now = Date.now();

    // Check if any cached entry is stale
    let needsRefresh = false;
    for (const [, entry] of this.cache) {
      if (now - entry.cachedAt > TTL_MS) { needsRefresh = true; break; }
    }

    // Also check for new/removed servers by loading from DB
    if (!needsRefresh) {
      try {
        const servers = await prisma.mcpServer.findMany({ where: { enabled: true }, select: { id: true } });
        const dbIds = new Set(servers.map(s => s.id));
        const cacheIds = new Set(this.cache.keys());
        if (dbIds.size !== cacheIds.size || [...dbIds].some(id => !cacheIds.has(id))) {
          needsRefresh = true;
        }
      } catch { /* DB error — keep cache */ }
    }

    if (needsRefresh && !this.refreshing) {
      this.refreshing = true;
      try {
        await this.refreshAll();
      } finally {
        this.refreshing = false;
      }
    }
  }

  /** Get all enabled tools across all connected servers. Skips offline/unreachable servers. */
  getAllEnabledTools(): Array<{ serverName: string; serverId: string; tool: McpToolInfo }> {
    const result: Array<{ serverName: string; serverId: string; tool: McpToolInfo }> = [];
    for (const [, entry] of this.cache) {
      if (entry.status === 'offline' || entry.status === 'error') continue;
      for (const tool of entry.tools) {
        result.push({ serverName: entry.serverName, serverId: entry.serverId, tool });
      }
    }
    return result;
  }

  /** Get tools for a specific server (for UI preview) */
  getServerTools(serverId: string): McpToolInfo[] {
    return this.cache.get(serverId)?.tools || [];
  }

  /** Get server status */
  getServerStatus(serverId: string): string {
    return this.cache.get(serverId)?.status || 'unknown';
  }

  /** Refresh all enabled servers */
  private async refreshAll(): Promise<void> {
    let servers: any[];
    try {
      servers = await prisma.mcpServer.findMany({ where: { enabled: true } });
    } catch (e: any) {
      agentLog('[MCPRegistry] Failed to load servers:', e.message);
      return;
    }

    const dbIds = new Set(servers.map(s => s.id));

    // Remove entries for servers that no longer exist or are disabled
    for (const [id] of this.cache) {
      if (!dbIds.has(id)) this.cache.delete(id);
    }

    // Discover tools for each server (parallel, per-server timeout)
    const results = await Promise.allSettled(
      servers.map(async (srv: any) => {
        const existing = this.cache.get(srv.id);
        // If fresh enough, skip
        if (existing && Date.now() - existing.cachedAt < TTL_MS) return;

        try {
          let apiKey: string | undefined;
          if (srv.apiKey) {
            try { apiKey = await decrypt(srv.apiKey); } catch { apiKey = srv.apiKey; }
          }

          let headers: Record<string, string> = {};
          if (srv.headers) {
            try {
              const decrypted = await decrypt(srv.headers);
              headers = JSON.parse(decrypted);
            } catch {
              try { headers = JSON.parse(srv.headers); } catch { /* not JSON */ }
            }
          }

          const client = createMCPClient({
            name: srv.name,
            url: srv.url,
            apiKey,
            headers,
            transport: (srv.transport || 'plain') as TransportMode,
          });

          const tools = await Promise.race([
            client.listTools(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Discovery timeout')), DISCOVERY_TIMEOUT_MS)),
          ]);

          this.cache.set(srv.id, {
            serverId: srv.id,
            serverName: srv.name,
            tools,
            status: 'online',
            cachedAt: Date.now(),
          });

          // Persist state back to DB (non-blocking)
          prisma.mcpServer.update({
            where: { id: srv.id },
            data: {
              status: 'online',
              toolCount: tools.length,
              toolsJson: JSON.stringify(tools),
              lastConnectedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
              lastError: null,
            },
          }).catch(() => {});

          agentLog('[MCPRegistry]', srv.name, `${tools.length} tools`);
        } catch (e: any) {
          const errorMsg = e.message || String(e);
          agentLog('[MCPRegistry]', srv.name, 'error:', errorMsg);

          // Use cached tools if available (graceful degradation)
          const fallbackTools: McpToolInfo[] = existing?.tools || [];
          if (srv.toolsJson && fallbackTools.length === 0) {
            try { fallbackTools.push(...JSON.parse(srv.toolsJson)); } catch { /* ignore */ }
          }

          this.cache.set(srv.id, {
            serverId: srv.id,
            serverName: srv.name,
            tools: fallbackTools,
            status: existing?.status === 'online' ? 'error' : 'offline',
            lastError: errorMsg,
            cachedAt: Date.now(),
          });

          prisma.mcpServer.update({
            where: { id: srv.id },
            data: { status: 'offline', lastError: errorMsg },
          }).catch(() => {});
        }
      }),
    );

    // Log failures
    for (const r of results) {
      if (r.status === 'rejected') {
        agentLog('[MCPRegistry] refresh failed:', r.reason?.message);
      }
    }
  }

  /** Force refresh a single server (used by UI Test/Connect buttons) */
  async connect(serverId: string): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const srv = await prisma.mcpServer.findUnique({ where: { id: serverId } });
      if (!srv) return { ok: false, tools: [], error: 'Server not found', latencyMs: 0 };

      let apiKey: string | undefined;
      if (srv.apiKey) {
        try { apiKey = await decrypt(srv.apiKey); } catch { apiKey = srv.apiKey; }
      }

      let headers: Record<string, string> = {};
      if (srv.headers) {
        try {
          const decrypted = await decrypt(srv.headers);
          headers = JSON.parse(decrypted);
        } catch { /* ignore */ }
      }

      const client = createMCPClient({
        name: srv.name,
        url: srv.url,
        apiKey,
        headers,
        transport: (srv.transport || 'plain') as TransportMode,
      });

      const tools = await client.listTools();
      const latencyMs = Date.now() - start;

      this.cache.set(serverId, {
        serverId,
        serverName: srv.name,
        tools,
        status: 'online',
        cachedAt: Date.now(),
      });

      await prisma.mcpServer.update({
        where: { id: serverId },
        data: {
          status: 'online',
          toolCount: tools.length,
          toolsJson: JSON.stringify(tools),
          lastConnectedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
          lastError: null,
        },
      });

      return { ok: true, tools, latencyMs };
    } catch (e: any) {
      return { ok: false, tools: [], error: e.message || String(e), latencyMs: Date.now() - start };
    }
  }

  /** Disconnect a server — evict cache, mark offline */
  async disconnect(serverId: string): Promise<void> {
    this.cache.delete(serverId);
    await prisma.mcpServer.update({
      where: { id: serverId },
      data: { status: 'offline' },
    }).catch(() => {});
  }

  /** Refresh tools for a single server */
  async refresh(serverId: string): Promise<McpToolInfo[]> {
    await this.connect(serverId);
    return this.getServerTools(serverId);
  }

  /** Invalidate cache for testing */
  invalidate(serverId?: string): void {
    if (serverId) this.cache.delete(serverId);
    else this.cache.clear();
  }
}

// Singleton
export const mcpRegistry = new MCPRegistry();
