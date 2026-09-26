// ═══ The stdio MCP transport ═══
//
// MCP over a pipe: one JSON-RPC message per line in, one per line out. No
// `Content-Length` framing — that is the deprecated LSP-style framing, not MCP's.
//
// This runs as a child process of whatever MCP client the user configured, started by
// the packaged TomiLite.exe acting as Node:
//
//   { "command": "<...>/TomiLite.exe",
//     "args": ["<...>/resources/app/apps/api/dist/mcp-stdio.cjs"],
//     "env": { "ELECTRON_RUN_AS_NODE": "1", "TL_MCP_API_KEY": "tl_…" } }
//
// With ELECTRON_RUN_AS_NODE set, Electron never loads electron/main.js: no window, no
// single-instance lock, just this file. The installer ships no node.exe and no tsx,
// which is why it is bundled to a .cjs and run this way.
//
// It does NOT touch the database, on purpose. The HITL queue and the audit log live in
// the API process's memory, so a copy of the tool logic in this process would take a
// tool call, file its approval, and then never see the human answer — the wait would
// deadlock against a queue nothing else can reach. Every call goes over localhost HTTP
// to the running app instead.
//
// stdout carries JSON-RPC and nothing else. Diagnostics go to stderr.

import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { dispatchMessage, type McpDeps } from './dispatch.js';
import { ERR, fail } from './protocol.js';

const SERVER_VERSION = process.env.TL_APP_VERSION || '0.0.0-dev';
const API_PORT = process.env.API_PORT || '3192';
const API_KEY = process.env.TL_MCP_API_KEY || '';

/**
 * How long this process is willing to let a tool call sit waiting for a human. Short by
 * design: MCP clients give up on a tool call somewhere near a minute and show the model
 * a transport error it cannot explain, so we hand back "waiting for approval" while
 * there is still time to say so. Override with TL_MCP_WAIT_MS.
 */
function readWaitMs(): number {
  const raw = Number(process.env.TL_MCP_WAIT_MS);
  if (!Number.isFinite(raw) || raw < 0) return 20000;
  return Math.min(raw, 300000);
}
const WAIT_MS = readWaitMs();

/**
 * The HTTP budget, deliberately longer than the wait we asked the server for. If the two
 * were equal, a slow answer — an approval landing at the last moment, a large board —
 * would surface as a client-side abort and be reported as "TomiLite is unreachable",
 * which is a lie about a server that is answering.
 */
const HTTP_TIMEOUT_MS = WAIT_MS + 15000;

const ENDPOINT = `http://127.0.0.1:${API_PORT}/api/mcp.execute`;

function write(msg: unknown): void {
  // One write per message, so two concurrent calls cannot interleave mid-line.
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.name === 'TimeoutError' ? 'timed out' : e.message;
  return String(e);
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!API_KEY) {
    return {
      error:
        'No API key configured for this MCP server. Put a TomiLite API key (Settings → API Keys) ' +
        'in the server\'s env as TL_MCP_API_KEY and restart the client.',
    };
  }

  let res: Response;
  let text: string;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: name, arguments: args, api_key: API_KEY, wait_ms: WAIT_MS }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    text = await res.text();
  } catch (e) {
    // Two very different failures that a caller must not confuse. One means "start the
    // app"; the other means "the app is working, ask again in a moment".
    if (e instanceof Error && e.name === 'TimeoutError') {
      return {
        error:
          `TomiLite did not answer within ${Math.round(HTTP_TIMEOUT_MS / 1000)}s. It is probably still ` +
          'running the call; check the MCP panel for a pending approval.',
      };
    }
    return {
      error:
        `Cannot reach TomiLite at ${ENDPOINT} (${describe(e)}). The desktop app does not appear to be ` +
        'running — start TomiLite and try again.',
    };
  }

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: `TomiLite returned a non-JSON response (HTTP ${res.status}).` };
  }
  // tRPC's error envelope.
  if (body?.error) {
    return { error: `TomiLite rejected the call: ${body.error.message || JSON.stringify(body.error)}` };
  }
  // tRPC wraps successful values as {result:{data:…}}; accept a bare body too, so a
  // future transport change does not silently turn every result into undefined.
  return body?.result?.data ?? body;
}

const deps: McpDeps = { callTool, serverVersion: SERVER_VERSION };

async function handleLine(line: string): Promise<void> {
  const text = line.trim();
  if (!text) return;
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    write(fail(null, ERR.PARSE, 'Parse error: line is not valid JSON'));
    return;
  }
  const response = await dispatchMessage(msg, deps);
  // null means it was a notification: the protocol forbids replying to one.
  if (response !== null) write(response);
}

async function main(): Promise<void> {
  console.error(`[tomilite-mcp] stdio transport ready → ${ENDPOINT} (wait ${WAIT_MS}ms)`);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Not serialized: a tool call waiting on a human must not block an unrelated
  // tools/list. `write` keeps each message on its own line.
  const inflight = new Set<Promise<void>>();
  rl.on('line', (line) => {
    const p = handleLine(line).finally(() => inflight.delete(p));
    inflight.add(p);
  });
  await once(rl, 'close');
  // The client closed the pipe. Let anything already in flight finish writing, so a
  // response is not truncated by our own exit.
  await Promise.allSettled([...inflight]);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('[tomilite-mcp] fatal:', describe(e));
    process.exit(1);
  },
);
