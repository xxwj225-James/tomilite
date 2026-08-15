import { prisma } from '@tomilite/database';
import { decrypt } from '../../lib/crypto.js';
import { createMCPClient } from '../mcp/client.js';
import { agentLog } from './logger.js';

/**
 * Call a tool on a connected MCP server.
 * Lookup order: McpServer by name → Integration by type (legacy fallback).
 * Tokens are injected server-side — the LLM never sees credentials.
 */
export async function mcpCall(server: string, tool: string, args: string): Promise<{ error?: string; server?: string; tool?: string; result?: any }> {
  let url = '';
  let apiKey: string | undefined;
  let headers: Record<string, string> = {};
  let transport: string | undefined;

  try {
    // ─── Primary: McpServer table ───
    const srv = await prisma.mcpServer.findFirst({
      where: { name: server, enabled: true },
    });

    if (srv) {
      url = srv.url;
      if (srv.apiKey) {
        try { apiKey = await decrypt(srv.apiKey); } catch { apiKey = srv.apiKey; }
      }
      if (srv.headers) {
        try {
          const decrypted = await decrypt(srv.headers);
          headers = JSON.parse(decrypted);
        } catch {
          try { headers = JSON.parse(srv.headers); } catch { /* not JSON */ }
        }
      }
      transport = srv.transport;
    } else {
      // ─── Fallback: Integration table (legacy) ───
      const integration = await prisma.integration.findFirst({
        where: { type: server, enabled: true },
      });
      if (!integration) {
        return { error: 'No MCP server configured for "' + server + '". Add it in Settings → MCP Servers.' };
      }

      const config = JSON.parse(integration.config);
      url = config.baseUrl || config.url;
      let token = config.apiKey || config.token;
      if (token) {
        if (token.includes(':')) {
          try { token = await decrypt(token); } catch { /* best-effort */ }
        }
        apiKey = token;
      }
      transport = 'legacy';
    }

    if (!url) return { error: 'MCP server "' + server + '" missing URL.' };

    // ─── Execute via protocol client ───
    let parsedArgs: Record<string, any>;
    try {
      parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
    } catch {
      parsedArgs = {};
    }

    const client = createMCPClient({
      name: server,
      url,
      apiKey,
      headers,
      transport: transport as any,
    });

    const result = await client.callTool(tool, parsedArgs);

    if (!result.ok) {
      if (result.pending) {
        // HITL pending — surface as error so LLM knows to wait
        agentLog('[mcpCall] HITL pending', { server, tool, taskId: result.pending.taskId });
        return {
          error: `⏳ Waiting for approval on ${server}. Task: ${result.pending.taskId}. Please wait or check the remote service.`,
          server, tool,
        };
      }
      return { error: result.error || 'MCP call failed', server, tool };
    }

    agentLog('[mcpCall] success', { server, tool });
    return { server, tool, result: result.result };
  } catch (e: any) {
    agentLog('[mcpCall] error', { server, tool, error: e.message });
    return { error: 'MCP call failed: ' + (e.message || String(e)), server, tool };
  }
}
