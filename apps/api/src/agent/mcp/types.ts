// ═══ MCP Client Types ═══

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema?: Record<string, any>;
  risk?: string; // read_only | low | medium | high
}

export interface McpCallResult {
  ok: boolean;
  status?: string;          // approved | denied | expired | pending_confirmation
  result?: any;
  error?: string;
  pending?: {
    taskId: string;
    preview?: string;
    pollUrl?: string;
  };
}

export type TransportMode = 'legacy' | 'plain' | 'jsonrpc' | 'stdio';

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  apiKey?: string;         // already decrypted
  transport: TransportMode;
  headers?: Record<string, string>; // extra headers
  enabled: boolean;
}
