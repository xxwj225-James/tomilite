// ═══ MCP wire constants and envelope builders ═══
//
// TomiLite serves TWO protocol revisions at once, and that is not an accident of
// history — it is the only thing that works today.
//
//   2026-07-28  "modern": stateless. `initialize` is REMOVED and replaced by a
//               `server/discover` method; every request carries a `_meta` envelope
//               naming its protocol revision; every result carries `resultType`.
//   2025-11-25  "legacy": the `initialize` handshake, and everything before it.
//   and older
//
// A legacy client cannot talk to a modern-only server — it sends `initialize` and
// gets nothing it understands. A modern client probes `server/discover` first and
// falls back to `initialize` when the probe fails. So a modern-only server breaks
// legacy clients, and a legacy-only server costs us the modern path. Both, or lose
// somebody.
//
// This was verified against the locally installed Claude Code 2.1.278 native binary,
// not taken on faith: it advertises ["2025-11-25","2025-06-18","2025-03-26",
// "2024-11-05","2024-10-07"] as its supported set AND contains 2026-07-28 machinery
// with a `server/discover` probe that degrades to `{kind:"legacy"}` when the reply
// fails to validate. One machine, both eras.
//
// Zero imports. Bundled into the stdio shim.

export const MODERN_VERSION = '2026-07-28';

/**
 * Newest first. `initialize` echoes the client's requested version when it appears
 * here, otherwise the first entry — the newest legacy revision, which is the honest
 * answer to "what do you speak" for a client too old to say what it speaks.
 */
export const LEGACY_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
] as const;

export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS];

/** Keys of the `_meta` envelope. The prefix is the protocol's own namespace. */
export const META = {
  version: 'io.modelcontextprotocol/protocolVersion',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  clientCaps: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
} as const;

/**
 * JSON-RPC 2.0 codes plus MCP's additions. The `-32020..-32022` block is MCP's own;
 * `-32000..-32019` is the range the older spec reserved for implementations and has
 * since closed to new codes, which is why nothing here uses it. Auth failures in
 * particular are deliberately NOT protocol errors — see `dispatch.ts`.
 */
export const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  HEADER_MISMATCH: -32020,
  MISSING_CAPABILITY: -32021,
  UNSUPPORTED_VERSION: -32022,
} as const;

export const SERVER_NAME = 'tomilite';
export const SERVER_TITLE = 'TomiLite';

export type Era = 'modern' | 'legacy';

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function fail(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

/**
 * The `-32022` reply. `data.supported` is what a client needs in order to decide
 * whether to fall back to a legacy handshake, so it is always populated — a bare
 * code would leave the client with nothing to do.
 */
export function unsupportedVersion(id: string | number | null, requested: unknown): JsonRpcResponse {
  return fail(id, ERR.UNSUPPORTED_VERSION, 'Unsupported protocol version', {
    supported: SUPPORTED_VERSIONS,
    requested,
  });
}

/**
 * The `-32020` reply, for when the mirrored headers and those same values in the
 * body disagree. `detail` should name which one, because the two callers that can
 * trigger this are wildly different bugs.
 */
export function headerMismatch(id: string | number | null, detail: string): JsonRpcResponse {
  return fail(id, ERR.HEADER_MISMATCH, 'Header mismatch', { detail });
}

/**
 * ISO-8601 dates compare correctly as strings — that is the only reason this is a
 * one-liner. Used to decide whether a result may carry `structuredContent`, which
 * 2025-06-18 introduced.
 */
export function versionAtLeast(version: string, min: string): boolean {
  return version >= min;
}

export function textBlock(text: string): { type: 'text'; text: string } {
  return { type: 'text', text };
}

/**
 * A single SSE frame wrapping one complete JSON-RPC response. We never stream — the
 * long approval wait is one response, not a sequence — but a client that sends
 * `Accept: text/event-stream` and nothing else will not parse a bare JSON body, so
 * this exists purely to answer those clients. Six lines to remove a whole class of
 * incompatibility.
 */
export function oneShotSse(body: unknown): string {
  return `event: message\ndata: ${JSON.stringify(body)}\n\n`;
}

/** Reads the protocol revision out of a request's `_meta` envelope, if it has one. */
export function versionFromMeta(msg: unknown): string | undefined {
  const params = (msg as { params?: { _meta?: Record<string, unknown> } } | null)?.params;
  const v = params?._meta?.[META.version];
  return typeof v === 'string' ? v : undefined;
}

/**
 * The era decision, and the entire reason this server needs no session state.
 *
 * The presence of the `_meta` envelope IS the era. A modern client sends it on every
 * request because the spec requires it to be self-describing; a legacy client has
 * never heard of it. Nothing is remembered between requests, so a client that
 * reconnects mid-conversation, or two clients on different revisions hitting the
 * same port, both behave correctly with no bookkeeping.
 *
 * Leniency, deliberate: a message with no `_meta` and no `initialize` — a bare
 * `tools/list`, say — is treated as legacy rather than rejected. The spec's own stdio
 * probe rules assume a client may open with an ordinary call, and refusing one costs
 * us a client to gain nothing.
 */
export function detectEra(msg: unknown): Era {
  return versionFromMeta(msg) === undefined ? 'legacy' : 'modern';
}

/**
 * The `serverInfo` block. Legacy `initialize` carries it inline; modern results carry
 * it inside the result's `_meta` under `META.serverInfo`. Same data, two addresses.
 */
export function serverInfo(version: string): Record<string, unknown> {
  return { name: SERVER_NAME, title: SERVER_TITLE, version };
}

/**
 * Capabilities are deliberately minimal and truthful: this server has tools and
 * nothing else. Advertising `resources` or `prompts` would make a client ask for them
 * and get `-32601`. `tools.listChanged` is false because the catalogue is compiled in
 * and cannot change while the process runs.
 */
export function serverCapabilities(): Record<string, unknown> {
  return { tools: { listChanged: false } };
}
