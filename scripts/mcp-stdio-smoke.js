/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script */
/*
 * Drives the MCP stdio shim as a real child process, over real pipes, against a real
 * API, using the real dispatcher and the real tool implementations.
 *
 *   node scripts/mcp-stdio-smoke.js
 *
 * It works on a COPY of the dev database and never touches the original, so it is safe
 * to run at any time. The API is started under `tsx` rather than from the packaged
 * `TomiLite.exe` — in production the shim is launched by the app binary acting as Node
 * (ELECTRON_RUN_AS_NODE=1), which is the same stdio arrangement with a different
 * interpreter in front of it.
 *
 * It deliberately asserts the things that only break end to end: that every advertised
 * tool can actually be called, that a write under a short budget comes back as
 * "pending" rather than half-done, and that approving it and retrying returns the result.
 */

const { spawn } = require('node:child_process');
const { copyFileSync, existsSync, rmSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir, homedir } = require('node:os');
const { createInterface } = require('node:readline');

const ROOT = join(__dirname, '..');
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const PORT = Number(process.env.SMOKE_PORT || 3292);
const BASE = `http://127.0.0.1:${PORT}/api`;

let assertCount = 0;
let failures = 0;
function ok(label) {
  assertCount++;
  console.log('  ok    ' + label);
}
function check(label, cond, detail) {
  assertCount++;
  if (cond) console.log('  ok    ' + label);
  else {
    failures++;
    console.log('  FAIL  ' + label + (detail === undefined ? '' : '   ' + JSON.stringify(detail)));
  }
}
function section(name) {
  console.log('\n── ' + name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`POST ${path} -> HTTP ${res.status}, non-JSON: ${text.slice(0, 200)}`);
  }
  if (json.error) throw new Error(`POST ${path} -> ${json.error.message || JSON.stringify(json.error)}`);
  return json.result ? json.result.data : json;
}

async function waitForApi(deadlineMs) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const res = await fetch(BASE + '/auth.token');
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

// ─── the shim, as a child process ───
function startShim(apiKey, waitMs) {
  const child = spawn(process.execPath, [TSX, join(ROOT, 'apps', 'api', 'src', 'mcp', 'stdio.ts')], {
    env: {
      ...process.env,
      API_PORT: String(PORT),
      TL_MCP_API_KEY: apiKey,
      TL_MCP_WAIT_MS: String(waitMs),
      TL_APP_VERSION: '0.0.0-smoke',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const queue = [];
  const waiters = [];
  const stderrLines = [];

  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      failures++;
      console.log('  FAIL  stdout carried a blank line (stdout must be JSON-RPC only)');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      failures++;
      console.log('  FAIL  stdout carried a non-JSON line: ' + trimmed.slice(0, 120));
      return;
    }
    if (waiters.length) waiters.shift()(parsed);
    else queue.push(parsed);
  });
  createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', (l) => stderrLines.push(l));

  const client = {
    send(msg) {
      child.stdin.write(JSON.stringify(msg) + '\n');
    },
    /** Returns the next response line, or rejects on timeout. */
    next(timeoutMs = 30000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = waiters.indexOf(handler);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error('no response within ' + timeoutMs + 'ms'));
        }, timeoutMs);
        const handler = (v) => {
          clearTimeout(timer);
          resolve(v);
        };
        waiters.push(handler);
      });
    },
    /** Sends and waits for the reply carrying the same id. */
    async call(id, method, params, timeoutMs) {
      client.send({ jsonrpc: '2.0', id, method, params });
      const msg = await client.next(timeoutMs);
      if (msg.id !== id) throw new Error(`expected reply id ${id}, got ${msg.id} (${method})`);
      return msg;
    },
    stderr: () => stderrLines.join('\n'),
    stop() {
      child.stdin.end();
      child.kill();
    },
  };
  return client;
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'tl-mcp-smoke-'));
  const dbPath = join(workDir, 'smoke.db');
  const sourceDb = join(homedir(), '.tomilite', 'dev.db');
  if (!existsSync(sourceDb)) {
    console.error('No dev database at ' + sourceDb + ' — run TomiLite once first.');
    process.exit(1);
  }
  copyFileSync(sourceDb, dbPath);

  let api;
  let shim;
  try {
    // ─── the API ───
    api = spawn(process.execPath, [TSX, join(ROOT, 'apps', 'api', 'src', 'server.ts')], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: 'file:' + dbPath.replace(/\\/g, '/'),
        API_PORT: String(PORT),
        TL_APP_VERSION: '0.0.0-smoke',
        // Keep the background sweeps quiet in a throwaway process.
        TL_USER_DATA: workDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    api.stdout.resume();
    api.stderr.resume();

    if (!(await waitForApi(90000))) {
      console.error('API did not come up on port ' + PORT + ' within 90s.');
      process.exit(1);
    }
    section('setup');
    ok('API is up on port ' + PORT + ' (db: ' + dbPath + ')');

    const key = await post('/apikey.generate', { name: 'mcp-smoke', scopes: 'read,write', hitlMode: 'manual' });
    ok('generated a manual-mode API key: ' + key.key.slice(0, 8) + '…');

    // ─── handshake ───
    shim = startShim(key.key, 3000);
    section('legacy era (initialize)');

    let r = await shim.call(1, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'smoke' } });
    check('initialize returns a protocolVersion', typeof r.result?.protocolVersion === 'string', r.result);
    check('initialize returns serverInfo', r.result?.serverInfo?.name === 'tomilite', r.result?.serverInfo);
    check('initialize returns instructions', typeof r.result?.instructions === 'string');
    check('initialize has NO resultType (legacy shape)', !('resultType' in (r.result || {})));
    check('initialize reports the app version', r.result?.serverInfo?.version === '0.0.0-smoke', r.result?.serverInfo);

    shim.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    r = await shim.call(2, 'ping', {});
    check('notifications/initialized produced NO reply (next line is ping\'s)', r.id === 2, r);
    ok('ping answered');

    // ─── the catalogue ───
    section('tools/list');
    r = await shim.call(3, 'tools/list', {});
    const tools = r.result?.tools || [];
    check('tools/list returns 17 tools', tools.length === 17, tools.length);
    check('no resultType on a legacy list', !('resultType' in (r.result || {})));
    check('every tool carries an inputSchema', tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));
    check('annotations survive the wire', tools.find((t) => t.name === 'delete_issue')?.annotations?.destructiveHint === true);
    check('the internal "risk" vocabulary is not leaked', tools.every((t) => !('risk' in t)));
    const names = tools.map((t) => t.name).sort();
    check('get_board_status is advertised', names.includes('get_board_status'), names);
    check('get_task_result is advertised', names.includes('get_task_result'));
    check('update_settings is gone', !names.includes('update_settings'));

    // Every advertised name must be callable — this is the assertion that keeps the three
    // old hand-kept lists from drifting apart again.
    section('every advertised tool is callable');
    const MINIMAL = {
      create_issue: { title: 'smoke' },
      list_issues: {},
      get_issue: {},
      update_issue: { issueNumber: 999999 },
      delete_issue: { issueNumber: 999999 },
      get_project_stats: {},
      get_board_status: {},
      get_focus_status: {},
      get_report: { id: 'no-such-report' },
      create_report: { title: 'smoke', content: 'smoke' },
      update_report: { id: 'no-such-report' },
      search_notes: { query: 'smoke' },
      list_notes: {},
      create_note: { title: 'smoke' },
      update_note: { id: 'no-such-note' },
      'tools/list': {},
      get_task_result: { taskId: 'hitl_nonexistent', waitMs: 0 },
    };
    for (let i = 0; i < tools.length; i++) {
      const name = tools[i].name;
      const reply = await shim.call(100 + i, 'tools/call', { name, arguments: MINIMAL[name] ?? {} });
      const text = JSON.stringify(reply);
      check(`${name} does not answer "Unknown tool"`, !/Unknown tool/.test(text), reply);
      check(`${name} has content blocks`, Array.isArray(reply.result?.content) && reply.result.content.length > 0);
    }

    // ─── a real read ───
    section('a read that returns real data');
    r = await shim.call(200, 'tools/call', { name: 'get_project_stats', arguments: {} });
    check('get_project_stats succeeded', r.result?.isError === false, r.result);
    check('get_project_stats returned structuredContent', typeof r.result?.structuredContent?.total === 'number', r.result?.structuredContent);
    check('the text block carries the JSON', /"total"/.test(r.result?.content?.[0]?.text || ''));
    const totalTasks = r.result?.structuredContent?.total;

    r = await shim.call(201, 'tools/call', { name: 'get_board_status', arguments: {} });
    check('get_board_status works (it never did before)', r.result?.isError === false, r.result);
    check('get_board_status describes columns', Array.isArray(r.result?.structuredContent?.columns), r.result?.structuredContent);

    r = await shim.call(202, 'tools/call', { name: 'get_project_stats', arguments: {} });
    check('the SAME read a second time still returns data (idempotency fix)', r.result?.structuredContent?.total === totalTasks, r.result?.structuredContent);

    // ─── a write: pending, then approve, then retry ───
    section('a write under a 3s budget');
    const writeArgs = { title: 'mcp smoke ' + Date.now() };
    r = await shim.call(300, 'tools/call', { name: 'create_issue', arguments: writeArgs });
    check('the write did NOT report success', r.result?.isError === true, r.result);
    const pendingText = r.result?.content?.[0]?.text || '';
    check('the text says nothing was executed', /NOTHING HAS BEEN EXECUTED/.test(pendingText), pendingText.slice(0, 200));
    check('the text names the approval id', /approval id: hitl_/.test(pendingText), pendingText.slice(0, 200));
    check('structuredContent carries the taskId', typeof r.result?.structuredContent?.taskId === 'string', r.result?.structuredContent);
    check('there is no JSON-RPC error key', !('error' in r));
    const taskId = r.result?.structuredContent?.taskId;

    // get_task_result itself succeeds — it answered "still pending" — but the answer it
    // carries is the pending envelope, and that is what a client should branch on.
    r = await shim.call(301, 'tools/call', { name: 'get_task_result', arguments: { taskId, waitMs: 0 } });
    check('get_task_result succeeded in answering', r.result?.isError === false, r.result);
    check('get_task_result says the approval is still pending', r.result?.structuredContent?.status === 'pending', r.result?.structuredContent);
    check('the answer text is the pending envelope, not the wrapper', /"status": "pending"/.test(r.result?.content?.[0]?.text || ''), r.result?.content?.[0]?.text);

    const approved = await post('/mcp.confirmById', { taskId });
    check('the UI approve path executed the tool', approved.status === 'approved', approved);

    r = await shim.call(302, 'tools/call', { name: 'create_issue', arguments: writeArgs });
    check('retrying with identical args returns the RESULT this time', r.result?.isError === false, r.result);
    check('the result contains the created issue key', typeof r.result?.structuredContent?.key === 'string', r.result?.structuredContent);
    ok('approve → retry → result: ' + JSON.stringify(r.result?.structuredContent));

    r = await shim.call(303, 'tools/call', { name: 'get_task_result', arguments: { taskId, waitMs: 0 } });
    check('get_task_result now returns the approved result', r.result?.isError === false && typeof r.result?.structuredContent?.result === 'object', r.result);

    // ─── refusals ───
    section('refusals and protocol errors');
    r = await shim.call(400, 'tools/call', { name: 'nope_not_a_tool', arguments: {} });
    check('unknown tool -> JSON-RPC -32602', r.error?.code === -32602, r);
    check('unknown tool -> no result key', !('result' in r));

    r = await shim.call(401, 'tools/call', { name: 'create_issue', arguments: {} });
    check('missing required field -> isError, not a protocol error', r.result?.isError === true, r);
    check('missing required field names the field', /Missing required field: title/.test(r.result?.content?.[0]?.text || ''));

    r = await shim.call(402, 'tools/nonsense', {});
    check('unknown method -> -32601', r.error?.code === -32601, r);

    r = await shim.call(403, 'server/discover', {});
    check('server/discover without _meta -> -32602, so a client falls back to initialize', r.error?.code === -32602, r);

    // ─── modern era, same process ───
    section('modern era (server/discover + _meta)');
    const meta = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'smoke', version: '1' },
    };
    r = await shim.call(500, 'server/discover', { _meta: meta });
    check('discover lists 2026-07-28', (r.result?.supportedVersions || []).includes('2026-07-28'), r.result?.supportedVersions);
    check('discover carries ttlMs', typeof r.result?.ttlMs === 'number', r.result?.ttlMs);
    check('discover carries cacheScope', r.result?.cacheScope === 'private');
    check('discover carries serverInfo in _meta', r.result?._meta?.['io.modelcontextprotocol/serverInfo']?.name === 'tomilite');
    check('discover carries resultType: complete', r.result?.resultType === 'complete');

    r = await shim.call(501, 'tools/list', { _meta: meta });
    check('modern tools/list has resultType', r.result?.resultType === 'complete');
    check('modern tools/list has ttlMs + cacheScope', typeof r.result?.ttlMs === 'number' && r.result?.cacheScope === 'private');
    check('modern tools/list still lists 17', (r.result?.tools || []).length === 17);

    r = await shim.call(502, 'ping', { _meta: meta });
    check('ping is REMOVED in 2026-07-28 -> -32601', r.error?.code === -32601, r);

    r = await shim.call(503, 'initialize', { _meta: meta });
    check('initialize is REMOVED in 2026-07-28 -> -32601', r.error?.code === -32601, r);

    r = await shim.call(504, 'tools/list', { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } });
    check('an unsupported revision -> -32022', r.error?.code === -32022, r);
    check('-32022 lists what we do support', Array.isArray(r.error?.data?.supported) && r.error.data.supported.length > 0);

    r = await shim.call(505, 'tools/call', { name: 'get_project_stats', arguments: {}, _meta: meta });
    check('a modern tools/call works too', r.result?.isError === false && typeof r.result?.structuredContent?.total === 'number', r.result);

    // ─── bad key ───
    section('a bad API key');
    const badShim = startShim('tl_not_a_real_key', 3000);
    r = await badShim.call(1, 'initialize', { protocolVersion: '2025-06-18' });
    check('the handshake still works with no valid key', typeof r.result?.protocolVersion === 'string');
    r = await badShim.call(2, 'tools/call', { name: 'list_issues', arguments: {} });
    check('a bad key is a TOOL error, not a protocol error', r.result?.isError === true && !('error' in r), r);
    check('the bad-key text is actionable', /Invalid or inactive API key/.test(r.result?.content?.[0]?.text || ''));
    badShim.stop();

    // ─── the same protocol over StreamableHTTP ───
    // Same dispatcher, different transport: anything that differs here is a transport bug.
    section('POST /api/mcp (StreamableHTTP)');

    const rpc = async (body, headers = {}) => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* SSE or empty */
      }
      return { status: res.status, headers: res.headers, text, json };
    };
    const MODERN_META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };

    let h = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    check('HTTP initialize -> 200', h.status === 200, h.status);
    check('HTTP initialize matches stdio', h.json?.result?.serverInfo?.name === 'tomilite' && !('resultType' in (h.json?.result || {})));

    h = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    check('HTTP tools/list -> 17 tools', (h.json?.result?.tools || []).length === 17, h.json?.result?.tools?.length);

    h = await rpc({ jsonrpc: '2.0', id: 3, method: 'server/discover', params: { _meta: MODERN_META } });
    check('HTTP server/discover -> resultType complete', h.json?.result?.resultType === 'complete');
    check('HTTP server/discover lists 2026-07-28', (h.json?.result?.supportedVersions || []).includes('2026-07-28'));

    h = await rpc({ jsonrpc: '2.0', id: 4, method: 'notifications/initialized', params: {} });
    check('a notification -> HTTP 202 with no body', h.status === 202 && h.text === '', { status: h.status, text: h.text });

    h = await rpc({ jsonrpc: '2.0', id: 5, method: 'no/such/method', params: {} });
    check('unknown method -> HTTP 404 + -32601', h.status === 404 && h.json?.error?.code === -32601, { status: h.status, body: h.json });

    h = await rpc('{not json at all');
    check('a malformed body -> HTTP 400 + -32700', h.status === 400 && h.json?.error?.code === -32700, { status: h.status, body: h.json });

    // The X-Api-Key header path, which is how an MCP client carries credentials.
    h = await rpc(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_project_stats', arguments: {} } },
      { 'X-Api-Key': key.key, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'get_project_stats' },
    );
    check('HTTP tools/call with X-Api-Key succeeds', h.json?.result?.isError === false, h.json?.result);
    // Compare the two transports at the same moment — the counts move as this test
    // creates tasks, so comparing against an earlier snapshot would be measuring time.
    const overStdio = await shim.call(600, 'tools/call', { name: 'get_project_stats', arguments: {} });
    check(
      'HTTP and stdio return identical data for the same call',
      JSON.stringify(h.json?.result?.structuredContent) === JSON.stringify(overStdio.result?.structuredContent),
      { http: h.json?.result?.structuredContent, stdio: overStdio.result?.structuredContent },
    );

    h = await rpc(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_project_stats', arguments: {} } },
      { 'X-Api-Key': key.key, 'Mcp-Method': 'tools/list' },
    );
    check('a lying Mcp-Method header -> 400 + -32020', h.status === 400 && h.json?.error?.code === -32020, { status: h.status, body: h.json });

    h = await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} }, { Origin: 'https://evil.example.com' });
    check('a cross-origin request -> HTTP 403', h.status === 403, h.status);

    h = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }, { 'Content-Type': 'text/plain' });
    check('a non-JSON content type -> HTTP 415', h.status === 415, h.status);

    h = await rpc({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} }, { Accept: 'text/event-stream' });
    check('Accept: text/event-stream -> an SSE frame', h.headers.get('content-type')?.includes('text/event-stream') === true, h.headers.get('content-type'));
    check('the SSE frame carries the same JSON-RPC reply', /^event: message\ndata: /.test(h.text) && JSON.parse(h.text.slice(20, -2)).result.tools.length === 17);

    // GET/DELETE: no server-initiated stream, no session to delete.
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/mcp`, { method });
      check(`${method} /api/mcp -> 405`, res.status === 405, res.status);
      check(`${method} /api/mcp advertises Allow: POST`, res.headers.get('allow') === 'POST', res.headers.get('allow'));
    }

    // ─── scopes now actually mean something ───
    section('a read-only API key');
    const roKey = await post('/apikey.generate', { name: 'mcp-smoke-readonly', scopes: 'read', hitlMode: 'manual' });
    h = await rpc(
      { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'delete_issue', arguments: { issueNumber: 1 } } },
      { 'X-Api-Key': roKey.key },
    );
    check('a read-scoped key is refused a write', h.json?.result?.isError === true, h.json?.result);
    check('the refusal says read-only', /read-only/.test(h.json?.result?.content?.[0]?.text || ''), h.json?.result?.content?.[0]?.text);
    h = await rpc(
      { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'list_issues', arguments: {} } },
      { 'X-Api-Key': roKey.key },
    );
    check('and is still allowed to read', h.json?.result?.isError === false, h.json?.result);

    // ─── the app not running ───
    // The one failure mode a user will actually hit, and the one that must not hang.
    section('TomiLite not running');
    api.kill();
    await sleep(2000);
    const noApp = startShim('tl_whatever', 1000);
    r = await noApp.call(1, 'tools/list', {});
    check('the handshake works with no API at all (nothing local is needed)', (r.result?.tools || []).length === 17);
    r = await noApp.call(2, 'tools/call', { name: 'list_issues', arguments: {} }, 15000);
    check('a call with the API down fails fast rather than hanging', r.result?.isError === true, r);
    check('and the message tells the user to start TomiLite', /start TomiLite/i.test(r.result?.content?.[0]?.text || ''), r.result?.content?.[0]?.text);
    noApp.stop();
  } finally {
    try {
      if (shim) shim.stop();
      if (api) api.kill();
    } catch {
      /* already gone */
    }
    await sleep(300);
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* windows lock */
    }
  }

  console.log('\n' + assertCount + ' assertions, ' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nfatal: ' + (e?.stack || e));
  process.exit(1);
});
