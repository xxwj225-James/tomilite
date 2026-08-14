// ═══ MCP Tool Injection — convert discovered tools → OpenAI function schemas ═══

import { mcpRegistry } from './registry.js';
import type { McpToolInfo } from './types.js';

const MAX_INJECTED_TOOLS = 25;

/** Sanitize a name component for OpenAI function naming: [a-zA-Z0-9_-]{1,64} */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')    // collapse multiple underscores
    .replace(/^_|_$/g, '')      // trim leading/trailing underscores
    .substring(0, 64);
}

/** Build OpenAI function schema from an MCP tool */
export function mcpToolToFunction(serverName: string, _serverId: string, tool: McpToolInfo): any {
  const safeServer = sanitizeName(serverName);
  const safeTool = sanitizeName(tool.name);
  const fullName = `mcp__${safeServer}__${safeTool}`;
  // Truncate if needed — keep prefix, trim tool part
  const finalName = fullName.length > 64
    ? `mcp__${safeServer.substring(0, 20)}__${safeTool.substring(0, 64 - 24 - safeServer.length)}`
    : fullName;

  const riskBadge = tool.risk ? ` [${tool.risk}]` : '';
  const description = `[MCP: ${serverName}]${riskBadge} ${tool.description || ''}`.substring(0, 400);

  return {
    type: 'function',
    function: {
      name: finalName,
      description,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  };
}

/** Parse a tool name back to server + original tool components */
export function parseMcpToolName(functionName: string): { serverName: string; toolName: string } | null {
  const match = functionName.match(/^mcp__([a-z0-9_-]+?)__([a-z0-9_-]+)$/i);
  if (!match) return null;
  return { serverName: match[1], toolName: match[2] };
}

/**
 * Get all injected MCP tools for the current request.
 * Call this per request — it triggers lazy discovery in the registry.
 * Never throws — returns empty array on failure.
 */
export async function getInjectedTools(): Promise<any[]> {
  try {
    await mcpRegistry.ensureFresh();
    const allTools = mcpRegistry.getAllEnabledTools();

    // Cap injected tools to prevent prompt bloat
    const capped = allTools.slice(0, MAX_INJECTED_TOOLS);

    return capped.map(({ serverName, serverId, tool }) =>
      mcpToolToFunction(serverName, serverId, tool),
    );
  } catch (e: any) {
    // Never break chat because of MCP issues
    console.error('[MCP Inject] Failed to get injected tools:', e.message);
    return [];
  }
}
