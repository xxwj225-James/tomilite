// ═══ The StreamableHTTP transport ═══
//
// Wraps `dispatchMessage` in HTTP. Everything protocol-shaped lives in dispatch.ts; this
// file only knows status codes, headers and body limits.
//
// Deliberately NOT implemented, because the server is stateless and streams nothing:
//
//   Mcp-Session-Id   no session is allocated, so none is returned or required. The era
//                    is read off each request's `_meta` envelope instead of remembered.
//   GET              no SSE stream to attach to. 405 + Allow: POST.
//   DELETE           nothing to terminate. 405 + Allow: POST.
//   Batch arrays     dropped from the protocol; rejected as an invalid request.
//
// The one response that can take a while is a `tools/call` waiting on human approval,
// and that is a single response with a single body — no streaming needed.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatchMessage, type McpDeps } from './dispatch.js';
import { ERR, SUPPORTED_VERSIONS, fail, headerMismatch, oneShotSse } from './protocol.js';

/** Small enough to read in one breath, large enough for any real tool call. */
const MAX_BODY_BYTES = 1024 * 1024;

export interface McpHttpDeps extends McpDeps {
  /** `serverInfo.version` — the app version, threaded in from the caller. */
  serverVersion: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.writeHead(status);
  res.end(payload);
}

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

/** Reads the body with a hard cap, so a runaway client cannot exhaust memory. */
async function readBody(req: IncomingMessage): Promise<{ ok: true; text: string } | { ok: false; tooLarge: boolean }> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) return { ok: false, tooLarge: true };
    chunks.push(buf);
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Handles a request to `/api/mcp`. Returns true when it wrote a response, so the caller
 * knows not to fall through to the tRPC handler.
 *
 * Never throws: a transport-level surprise becomes a JSON-RPC error, because a client
 * that receives an HTML error page reports "invalid JSON" and the user learns nothing.
 */
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: McpHttpDeps,
): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method !== 'POST') {
    // No SSE stream and no session to delete. Saying so plainly is friendlier than 404.
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, fail(null, ERR.INVALID_REQUEST, 'Method not allowed. This endpoint accepts POST only.'));
    return true;
  }

  // A browser page on some other site must not be able to drive this endpoint. The
  // localhost-only binding already blocks the network case; this blocks the browser case.
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin && !isLocalOrigin(origin)) {
    sendJson(res, 403, fail(null, ERR.INVALID_REQUEST, 'Forbidden: cross-origin requests are not accepted'));
    return true;
  }

  const contentType = String(req.headers['content-type'] || '');
  if (contentType && !contentType.includes('application/json')) {
    sendJson(res, 415, fail(null, ERR.INVALID_REQUEST, 'Unsupported Media Type: expected application/json'));
    return true;
  }

  const body = await readBody(req);
  if (!body.ok) {
    sendJson(res, 413, fail(null, ERR.INVALID_REQUEST, 'Request body too large (limit 1 MiB)'));
    return true;
  }

  let msg: unknown;
  try {
    msg = JSON.parse(body.text);
  } catch {
    // -32700 with a null id: there is no id to echo, the JSON never parsed.
    sendJson(res, 400, fail(null, ERR.PARSE, 'Parse error: body is not valid JSON'));
    return true;
  }

  if (Array.isArray(msg)) {
    sendJson(res, 400, fail(null, ERR.INVALID_REQUEST, 'Batch requests are not supported'));
    return true;
  }

  // ─── The mirrored headers ───
  //
  // The spec makes `Mcp-Method` (and `Mcp-Name` on tools/call) REQUIRED and says a
  // mismatch is a -32020 error, because an intermediary is supposed to route on the
  // header without reading the body. We validate them only when they ARE present: this
  // endpoint is bound to localhost with no intermediary in front of it, so the rule's
  // security rationale does not apply here, while rejecting a client that omits them
  // would cost us exactly the client this transport was built to reach. Adding
  // `if (!mcpMethod)` above the comparison turns on the strict reading.
  const mcpMethod = req.headers['mcp-method'];
  const mcpName = req.headers['mcp-name'];
  const bodyMethod = (msg as { method?: unknown }).method;
  if (typeof mcpMethod === 'string' && mcpMethod && mcpMethod !== bodyMethod) {
    sendJson(res, 400, headerMismatch((msg as { id?: string | number }).id ?? null, `Mcp-Method "${mcpMethod}" does not match body method "${String(bodyMethod)}"`));
    return true;
  }
  if (typeof mcpName === 'string' && mcpName) {
    const bodyName = (msg as { params?: { name?: unknown } }).params?.name;
    if (bodyName !== undefined && mcpName !== bodyName) {
      sendJson(res, 400, headerMismatch((msg as { id?: string | number }).id ?? null, `Mcp-Name "${mcpName}" does not match params.name "${String(bodyName)}"`));
      return true;
    }
  }

  // A legacy client tells us its revision in this header after `initialize`. There is no
  // session to remember it in, so it is read per request — which is the point.
  const headerVersion = req.headers['mcp-protocol-version'];
  const version =
    typeof headerVersion === 'string' && (SUPPORTED_VERSIONS as readonly string[]).includes(headerVersion)
      ? headerVersion
      : undefined;

  let response;
  try {
    response = await dispatchMessage(msg, deps, { version });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sendJson(res, 500, fail((msg as { id?: string | number }).id ?? null, ERR.INTERNAL, `Internal error: ${message}`));
    return true;
  }

  // A notification has no reply. 202 says "received, nothing to see" without inventing
  // a response the protocol forbids.
  if (response === null) {
    res.writeHead(202);
    res.end();
    return true;
  }

  // -32601 is the one error the transport is expected to surface as a 404, so a client's
  // probe can tell "wrong URL" from "wrong request".
  const status = response.error ? (response.error.code === ERR.METHOD_NOT_FOUND ? 404 : 400) : 200;

  const accept = String(req.headers.accept || '');
  if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
    const frame = oneShotSse(response);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Length', Buffer.byteLength(frame));
    res.writeHead(status);
    res.end(frame);
    return true;
  }

  sendJson(res, status, response);
  return true;
}
