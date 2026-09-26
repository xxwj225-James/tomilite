// ═══ The JSON-RPC dispatcher ═══
//
// One implementation of the protocol, shared by both transports:
//
//   stdio shim      → dispatchMessage(msg, { callTool: httpBridge })   … spawns as a child process
//   POST /api/mcp   → dispatchMessage(msg, { callTool: inProcess })    … tRPC caller, no HTTP hop
//
// It knows nothing about sockets, stdin, headers or sessions. `callTool` is injected,
// which is what makes the protocol testable without a network — see the 13 assertions
// this file was written against. If a decision here needs to know which transport is
// asking, the decision belongs with the transport instead.
//
// Zero imports beyond its two sibling modules, both of which are also dependency-free:
// this file is bundled into the stdio shim, which must not drag Prisma in.

import { SERVER_INSTRUCTIONS, toMcpTools, toolByName } from './catalogue.js';
import {
  ERR,
  LEGACY_VERSIONS,
  MODERN_VERSION,
  META,
  SUPPORTED_VERSIONS,
  detectEra,
  fail,
  ok,
  serverCapabilities,
  serverInfo,
  textBlock,
  unsupportedVersion,
  versionAtLeast,
  versionFromMeta,
  type Era,
  type JsonRpcResponse,
} from './protocol.js';

export interface McpDeps {
  /**
   * Runs a tool. Implementations return a plain value, not a JSON-RPC envelope —
   * locating the caller's API key, applying the risk policy, waiting on approval and
   * writing the audit row all happen behind this call, and none of it is the
   * protocol's business. `idempotency_key`, when the caller wants one, rides inside
   * `args`: it is a TomiLite field, not a protocol field, and `mcp.execute` already
   * reads it from there.
   */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** The app version, reported as `serverInfo.version`. */
  serverVersion: string;
}

export interface DispatchOptions {
  /**
   * The negotiated revision, when the caller remembers one. Only the legacy era has
   * anything to negotiate: a client picks a revision in `initialize`, and later
   * requests must be shaped for it (`structuredContent` is 2025-06-18+). The stdio
   * shim keeps that answer; the HTTP endpoint is stateless and leaves this unset,
   * which yields the newest legacy revision — correct, because the field it decides
   * is additive and older clients ignore unknown keys.
   */
  version?: string;
  /** Overrides the era instead of reading it off `_meta`. Tests only. */
  era?: Era;
}

/** `tools/list` and `server/discover` are cacheable; both hints are REQUIRED by 2026-07-28. */
const TOOLS_TTL_MS = 300_000;
const DISCOVER_TTL_MS = 3_600_000;
/**
 * `private`, not `public`: the catalogue is served the same to everyone today, but the
 * moment `scopes` narrows what a key may call, a shared cache would hand one caller
 * another's view. The safe value costs nothing here.
 */
const CACHE_SCOPE = 'private';

/** `structuredContent` arrived in 2025-06-18; older revisions would not validate it. */
const STRUCTURED_CONTENT_MIN = '2025-06-18';

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Which legacy revision to answer with when the client named one we support, and the
 * newest legacy revision otherwise. Exported so the stdio shim can record the answer
 * from its `initialize` reply and pass it back in `DispatchOptions.version`.
 */
export function negotiateLegacyVersion(requested: unknown): string {
  return typeof requested === 'string' && (LEGACY_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LEGACY_VERSIONS[0];
}

/**
 * The `tools/call` success/failure mapping, and the single place this file is easy to
 * get wrong.
 *
 * MCP splits what tRPC does not: a *tool* that fails returns `isError: true` inside a
 * normal `result`, so the model reads the message and can act on it; a JSON-RPC `error`
 * is reserved for the protocol itself. Auth failures stay tool errors on purpose — the
 * model needs to be able to say "your key is invalid, regenerate it in TomiLite", and a
 * client-side protocol fault shows the user a stack trace instead.
 */
function toCallResult(data: unknown, version: string): Record<string, unknown> {
  const status = isPlainObject(data) ? data.status : undefined;

  // A successful run carries the tool's payload under `result`; everything else is the
  // envelope itself. Read_only tools short-circuit straight to `{status:'executed'}`.
  //
  // The payload — not the envelope — is what both the text block and `structuredContent`
  // carry, so a model reading prose and a client reading JSON are told the same thing.
  // (A tool like `get_task_result` answers with an envelope of its own, and without this
  // the model would see `{"status":"executed","result":{"status":"pending"}}`.)
  const succeeded = status === 'executed' || status === 'completed' || status === 'approved';
  const payload = succeeded && isPlainObject(data) && data.result !== undefined ? data.result : data;

  let isError = false;
  let text: string;
  // `structuredContent` is for a client that wants to branch on data rather than parse
  // prose, so it is attached only where there IS such data: a successful payload, or a
  // pending approval (whose taskId the caller may need to poll). An error envelope
  // would otherwise travel as structured data looking like a result.
  let structured: unknown;

  if (status === 'pending') {
    // The write was NOT performed. Saying so loudly is the whole point: a model handed
    // a cheerful success string here will tell the user the task was created.
    const taskId = isPlainObject(data) ? data.taskId : undefined;
    const tool = isPlainObject(data) ? data.tool : undefined;
    const risk = isPlainObject(data) ? data.risk : undefined;
    text =
      'Waiting for human approval — NOTHING HAS BEEN EXECUTED YET.\n' +
      `  approval id: ${String(taskId)}\n` +
      `  tool: ${String(tool)}${risk ? ` (${String(risk)} risk)` : ''}\n` +
      'Approve or reject it in the TomiLite window (MCP panel). Approval performs the action\n' +
      `even if you stop waiting, so it is never wasted. Then collect the result by calling\n` +
      `get_task_result with taskId "${String(taskId)}", or by calling the same tool again with\n` +
      'exactly the same arguments.';
    isError = true;
    structured = data;
  } else if (status === 'denied') {
    text =
      'The human REJECTED this call — nothing was executed. Do not retry it unchanged; ask the ' +
      'user what they want done differently first.';
    isError = true;
  } else if (status === 'expired') {
    const detail = isPlainObject(data) && typeof data.error === 'string' ? data.error : 'Approval timed out';
    text =
      `${detail} — nothing was executed. The request may still be waiting in the TomiLite MCP panel; ` +
      'check there before retrying, or call get_task_result with the same taskId.';
    isError = true;
  } else if (status === 'error') {
    text = isPlainObject(data) && typeof data.error === 'string' ? data.error : 'The tool reported an error.';
    isError = true;
  } else if (isPlainObject(data) && typeof data.error === 'string') {
    // The house style throughout apps/api: failures are data, never throws.
    text = data.error;
    isError = true;
  } else {
    text = JSON.stringify(payload ?? null, null, 2);
    structured = payload;
  }

  const result: Record<string, unknown> = { content: [textBlock(text)], isError };
  // Only when it is actually an object: the spec types this field as an object, so an
  // array or a bare string would be a schema violation rather than a richer answer.
  if (versionAtLeast(version, STRUCTURED_CONTENT_MIN) && isPlainObject(structured)) {
    result.structuredContent = structured;
  }
  return result;
}

function modernOnly(result: Record<string, unknown>, era: Era): Record<string, unknown> {
  return era === 'modern' ? { ...result, resultType: 'complete' } : result;
}

/**
 * Handles one JSON-RPC message. Returns `null` when the message is a notification and
 * therefore has no reply — the caller must write nothing at all in that case, since a
 * response to a notification is itself a protocol violation.
 *
 * Never throws and never rejects: a tool that explodes becomes `isError: true`, not a
 * broken stream.
 */
export async function dispatchMessage(
  msg: unknown,
  deps: McpDeps,
  options: DispatchOptions = {},
): Promise<JsonRpcResponse | null> {
  if (!isPlainObject(msg)) {
    return fail(null, ERR.INVALID_REQUEST, 'Invalid Request: expected a JSON-RPC object');
  }
  const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;
  const method = msg.method;
  if (typeof method !== 'string' || !method) {
    return fail(id, ERR.INVALID_REQUEST, 'Invalid Request: missing method');
  }
  // A notification is anything without an id. Answering one desynchronises the client.
  if (msg.id === undefined || method.startsWith('notifications/')) return null;

  const params = msg.params;
  if (params !== undefined && !isPlainObject(params)) {
    return fail(id, ERR.INVALID_PARAMS, 'Invalid params: expected an object');
  }
  const p = params ?? {};

  const era: Era = options.era ?? detectEra(msg);
  let version: string;
  if (era === 'modern') {
    const requested = versionFromMeta(msg);
    if (requested !== undefined && !(SUPPORTED_VERSIONS as readonly string[]).includes(requested)) {
      // -32022, carrying the list the client needs in order to decide whether to fall
      // back to a legacy handshake. A bare code would leave it with nothing to do.
      return unsupportedVersion(id, requested);
    }
    version = requested ?? MODERN_VERSION;
  } else {
    version = options.version ?? LEGACY_VERSIONS[0];
  }

  switch (method) {
    case 'initialize': {
      // Removed in 2026-07-28. A modern client that sends it anyway has already been
      // told the revision list and chosen wrong; -32601 is the honest answer.
      if (era === 'modern') return fail(id, ERR.METHOD_NOT_FOUND, 'Method not found: initialize');
      return ok(id, {
        protocolVersion: negotiateLegacyVersion(p.protocolVersion),
        capabilities: serverCapabilities(),
        serverInfo: serverInfo(deps.serverVersion),
        instructions: SERVER_INSTRUCTIONS,
      });
    }

    case 'ping': {
      // Removed in 2026-07-28 alongside `logging/setLevel` and
      // `notifications/roots_list_changed`. Do not "helpfully" serve it in both eras —
      // answering a method the revision deleted is itself a violation. Verified against
      // the Claude Code binary: no JSON-RPC ping survives in its modern method table.
      if (era === 'modern') return fail(id, ERR.METHOD_NOT_FOUND, 'Method not found: ping');
      return ok(id, {});
    }

    case 'server/discover': {
      // Modern-only. A caller with no `_meta` is asking in the legacy dialect, where
      // this method does not exist — and it must be told so in a way its probe rejects,
      // so the client falls back to `initialize` instead of giving up.
      if (era === 'legacy') {
        return fail(
          id,
          ERR.INVALID_PARAMS,
          'server/discover requires the _meta envelope (protocol 2026-07-28). ' +
            'This client appears to speak an earlier revision; use initialize.',
        );
      }
      return ok(id, modernOnly({
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: serverCapabilities(),
        serverInfo: serverInfo(deps.serverVersion),
        ttlMs: DISCOVER_TTL_MS,
        cacheScope: CACHE_SCOPE,
        _meta: { [META.serverInfo]: serverInfo(deps.serverVersion) },
      }, era));
    }

    case 'tools/list': {
      // `ttlMs` and `cacheScope` are non-optional in 2026-07-28's result schema — not
      // cache hints a server may omit. Verified in the client binary.
      const payload: Record<string, unknown> = { tools: toMcpTools() };
      if (era === 'modern') {
        payload.ttlMs = TOOLS_TTL_MS;
        payload.cacheScope = CACHE_SCOPE;
      }
      return ok(id, modernOnly(payload, era));
    }

    case 'tools/call': {
      const name = p.name;
      if (typeof name !== 'string' || !name) {
        return fail(id, ERR.INVALID_PARAMS, 'Invalid params: "name" must be a non-empty string');
      }
      // Unknown tools are a PROTOCOL error, and rejecting here — before any approval
      // task is created — also fixes the old behaviour where calling a tool that does
      // not exist queued a real approval, waited for a human, and only then answered
      // "Unknown tool".
      if (!toolByName(name)) {
        return fail(id, ERR.INVALID_PARAMS, `Unknown tool: ${name}`);
      }
      const args = p.arguments;
      if (args !== undefined && !isPlainObject(args)) {
        return fail(id, ERR.INVALID_PARAMS, 'Invalid params: "arguments" must be an object');
      }
      // Required-argument checking is deliberately NOT done here. Missing a required
      // field is reported as `isError: true` with the field name, so the model can fix
      // its own call — see the mapping table. `validateArgs` in the catalogue is what
      // the tool layer uses, and both sides read the same schema.
      let data: unknown;
      try {
        data = await deps.callTool(name, (args ?? {}) as Record<string, unknown>);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        data = { error: `Tool "${name}" crashed: ${message}` };
      }
      return ok(id, modernOnly(toCallResult(data, version), era));
    }

    default:
      return fail(id, ERR.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}
