// ═══ MCP Protocol Client — auto-negotiating transport ═══
// Supports: legacy (POST /tools/call), plain (TomiHub-style method envelope), JSON-RPC (standard MCP)

import type { McpToolInfo, McpCallResult, TransportMode } from './types.js';

const READ_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_MS = 320000; // ~5 min for HITL
const READ_TOOL_PREFIXES = ['get_', 'list_', 'search_', 'find_', 'read_', 'fetch_', 'query_', 'count_', 'stats'];

function looksLikeRead(toolName: string): boolean {
  return READ_TOOL_PREFIXES.some(p => toolName.startsWith(p));
}

function validateUrl(rawUrl: string): URL {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('Invalid URL: ' + rawUrl); }
  const host = url.hostname;
  if (url.protocol !== 'https:' && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('MCP server must use HTTPS or localhost. Got: ' + url.protocol + '//' + host);
  }
  return url;
}

function buildHeaders(apiKey: string | undefined, extraHeaders?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  // TomiHub convention first, Bearer fallback
  if (apiKey) {
    h['X-Api-Key'] = apiKey;
    // Also send as Authorization for servers that expect Bearer
    if (!extraHeaders?.['Authorization']) {
      h['Authorization'] = 'Bearer ' + apiKey;
    }
  }
  if (extraHeaders) Object.assign(h, extraHeaders);
  return h;
}

// ─── Response normalization across protocol variants ───

function normalizeResult(data: any): McpCallResult {
  if (!data || typeof data !== 'object') return { ok: true, result: data };

  // TomiHub-style: { status: 'approved'|'denied'|'expired', result?, task_id? }
  if (data.status === 'approved') return { ok: true, status: data.status, result: data.result ?? data };
  if (data.status === 'denied') return { ok: false, status: 'denied', error: 'Request denied by approver' };
  if (data.status === 'expired') return { ok: false, status: 'expired', error: 'Approval request expired' };
  if (data.status === 'pending' || data.status === 'pending_confirmation') {
    return {
      ok: false,
      status: data.status,
      pending: {
        taskId: data.task_id || data.taskId || '',
        preview: data.preview,
        pollUrl: data.poll_url || data.pollUrl,
      },
      error: 'Waiting for human approval on the remote server.',
    };
  }

  // JSON-RPC: { jsonrpc, id, result: { content: [{ type: 'text'|'json', text }] }, error? }
  if (data.jsonrpc === '2.0') {
    if (data.error) return { ok: false, error: data.error.message || JSON.stringify(data.error) };
    const content = data.result?.content;
    if (Array.isArray(content)) {
      const textParts = content.filter((c: any) => c.type === 'text').map((c: any) => c.text);
      const jsonParts = content.filter((c: any) => c.type === 'json').map((c: any) => c.text ? JSON.parse(c.text) : c);
      if (jsonParts.length > 0) return { ok: true, result: jsonParts.length === 1 ? jsonParts[0] : jsonParts };
      return { ok: true, result: textParts.join('\n') || data.result };
    }
    return { ok: true, result: data.result };
  }

  // Plain JSON
  if (data.error) return { ok: false, error: data.error };
  if (data.ok === false) return { ok: false, error: data.error || 'Unknown error' };
  return { ok: true, result: data.result ?? data };
}

// ─── SSE stream parser — accumulates JSON-RPC chunks until matching id ───

async function parseSSEResponse(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    // Plain JSON response
    return response.json();
  }

  // SSE streaming response
  const reader = response.body?.getReader();
  if (!reader) return response.json();

  const decoder = new TextDecoder();
  let buffer = '', currentEvent = '';
  let accumulated: any = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) { currentEvent = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;

      try {
        const data = JSON.parse(raw);
        if (data.jsonrpc === '2.0') {
          accumulated = data; // replace — JSON-RPC sends one complete message
        } else if (data.status && (data.status === 'approved' || data.status === 'denied')) {
          accumulated = data; // TomiHub HITL terminal
        } else {
          accumulated = data;
        }
      } catch { /* skip unparseable chunks */ }
    }
  }

  return accumulated;
}

// ─── Auto-negotiation: detect which protocol the server speaks ───

const protocolCache = new Map<string, TransportMode>();

async function negotiateTransport(baseUrl: string, headers: Record<string, string>): Promise<TransportMode> {
  const key = baseUrl;
  if (protocolCache.has(key)) return protocolCache.get(key)!;

  // If URL already ends with /tools/call → legacy mode
  if (baseUrl.endsWith('/tools/call')) {
    protocolCache.set(key, 'legacy');
    return 'legacy';
  }

  // Try plain (TomiHub-style) first — most common for our use case
  try {
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method: 'tools/list' }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data?.tools) || Array.isArray(data)) {
        protocolCache.set(key, 'plain');
        return 'plain';
      }
      // TomiHub returns error for unknown methods but still indicates plain protocol
      if (data?.error && !data.jsonrpc) {
        protocolCache.set(key, 'plain');
        return 'plain';
      }
    }
  } catch { /* fall through */ }

  // Try JSON-RPC initialize
  try {
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { ...headers, 'Accept': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tomilite', version: '2.0.2' } },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.jsonrpc === '2.0') {
        // Send initialized notification
        fetch(baseUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
        protocolCache.set(key, 'jsonrpc');
        return 'jsonrpc';
      }
    }
  } catch { /* fall through */ }

  // Default to plain (most servers handle this)
  protocolCache.set(key, 'plain');
  return 'plain';
}

// ─── Public API ───

export interface MCPClient {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, any>): Promise<McpCallResult>;
  getTransport(): TransportMode;
}

export function createMCPClient(config: {
  name: string;
  url: string;
  apiKey?: string;
  headers?: Record<string, string>;
  transport?: TransportMode;
}): MCPClient {
  const validatedUrl = validateUrl(config.url);
  const baseUrl = validatedUrl.href.replace(/\/$/, '');
  const defaultHeaders = buildHeaders(config.apiKey, config.headers);
  let transportMode: TransportMode = config.transport || 'plain';

  const ensureTransport = async (): Promise<TransportMode> => {
    if (transportMode !== 'plain') return transportMode;
    transportMode = await negotiateTransport(baseUrl, defaultHeaders);
    return transportMode;
  };

  return {
    getTransport: () => transportMode,

    async listTools(): Promise<McpToolInfo[]> {
      await ensureTransport();

      if (transportMode === 'legacy') {
        // Legacy servers don't support tools/list — return empty
        return [];
      }

      let body: string;
      if (transportMode === 'jsonrpc') {
        body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      } else {
        body = JSON.stringify({ method: 'tools/list' });
      }

      const resp = await fetch(baseUrl, {
        method: 'POST',
        headers: defaultHeaders,
        body,
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });

      if (!resp.ok) throw new Error(`tools/list failed: HTTP ${resp.status}`);

      const data = await resp.json();

      // Normalize: TomiHub returns { tools: [...] }, JSON-RPC returns { result: { tools: [...] } }
      let tools: any[];
      if (Array.isArray(data?.tools)) tools = data.tools;
      else if (Array.isArray(data?.result?.tools)) tools = data.result.tools;
      else if (Array.isArray(data)) tools = data;
      else tools = [];

      return tools.map((t: any) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || t.input_schema || t.parameters || { type: 'object', properties: {} },
        risk: t.risk,
      }));
    },

    async callTool(name: string, args: Record<string, any>): Promise<McpCallResult> {
      await ensureTransport();

      const isRead = looksLikeRead(name);
      const timeoutMs = isRead ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;

      let body: string;
      if (transportMode === 'legacy') {
        body = JSON.stringify({ name, arguments: args });
      } else if (transportMode === 'jsonrpc') {
        body = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });
      } else {
        // plain / TomiHub-style
        body = JSON.stringify({ method: 'tools/call', params: { name, arguments: args } });
      }

      const resp = await fetch(baseUrl, {
        method: 'POST',
        headers: defaultHeaders,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!resp.ok) {
        return { ok: false, error: `MCP server returned HTTP ${resp.status}` };
      }

      const data = await parseSSEResponse(resp);
      return normalizeResult(data);
    },
  };
}
