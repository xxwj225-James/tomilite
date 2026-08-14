#!/usr/bin/env node
/**
 * TomiLite driver — programmatic harness for the Electron app.
 *
 * The app ships an HTTP API on localhost:3192 (the backend) and an Electron
 * shell (the frontend). This driver targets the API for fast feedback and
 * optionally launches the Electron window for visual checks.
 *
 * Usage:
 *   node driver.mjs api <method> [args]       # call the API server
 *   node driver.mjs chat "<message>"          # send a chat message via SSE
 *   node driver.mjs launch                    # launch the Electron app
 *   node driver.mjs build [debug]             # build + pack the installer
 *
 * The API must be running (the Electron app launches it automatically, or
 * you can start it standalone for headless API-only testing).
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = 'http://localhost:3192';
const REPO = join(__dirname, '..', '..', '..', '..');

// ─── Helpers ───

async function apiGet(path) {
  const r = await fetch(API + path);
  const j = await r.json();
  return j.result?.data ?? j;
}

async function apiPost(path, body = {}) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return j.result?.data ?? j;
}

// ─── Commands ───

/** Build and pack the app. `debug` builds with debug.flag for logs. */
async function build(debug = false) {
  const script = debug ? 'pack:debug' : 'pack';
  console.log(`[build] running npm run ${script}...`);
  execSync(`npm run ${script}`, { cwd: REPO, stdio: 'inherit' });
  const installer = join(REPO, 'dist-electron', 'TomiLite-Setup-1.0.0.exe');
  console.log(`[build] installer: ${installer}`);
  return installer;
}

/** Launch the unpacked Electron app (assumes already built). */
async function launch() {
  const exe = join(REPO, 'dist-electron', 'win-unpacked', 'TomiLite.exe');
  if (!existsSync(exe)) {
    console.error(`[launch] not found: ${exe}. Run "node driver.mjs build" first.`);
    process.exit(1);
  }
  console.log(`[launch] starting ${exe}...`);
  const proc = spawn(exe, [], { detached: true, stdio: 'ignore' });
  proc.unref();
  console.log('[launch] pid:', proc.pid);
  // Wait for API
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      await fetch(API + '/api/system.getHomeDir');
      console.log('[launch] API server ready');
      return proc.pid;
    } catch {}
  }
  console.error('[launch] API server did not start within 30s');
  process.exit(1);
}

/** Send a chat message via SSE and stream the response. */
async function chat(message, lang = 'zh') {
  const resp = await fetch(API + '/api/agent/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history: [], lang, remainingTokens: 8000 }),
  });
  if (!resp.ok) {
    console.error('[chat] HTTP', resp.status, await resp.text());
    process.exit(1);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let reasoning = '', fullText = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const d = JSON.parse(line.slice(6));
        if (d.text) { fullText += d.text; process.stdout.write(d.text); }
        if (d.reasoning) reasoning += d.reasoning;
      } catch {}
    }
  }
  console.log('\n');
  return { fullText, reasoning };
}

/** List sessions or get session messages. */
async function sessions(sid) {
  if (sid) {
    const msgs = await apiGet(`/api/chat.getMessages?input=${encodeURIComponent(JSON.stringify({ sessionId: sid }))}`);
    console.log(JSON.stringify(msgs, null, 2));
    return msgs;
  }
  const list = await apiGet('/api/chat.listSessions');
  console.log(JSON.stringify(list, null, 2));
  return list;
}

/** Get LLM config. */
async function config() {
  const cfg = await apiGet('/api/llm.getConfig');
  console.log(JSON.stringify(cfg, null, 2));
  return cfg;
}

/** Create debug.flag to enable agent.log + frontend.log */
async function debug(enable = true) {
  const flag = join(homedir(), '.tomilite', 'debug.flag');
  if (enable) {
    mkdirSync(dirname(flag), { recursive: true });
    writeFileSync(flag, '');
    console.log('[debug] debug.flag created — logs enabled');
  } else {
    try { require('fs').unlinkSync(flag); console.log('[debug] debug.flag removed'); } catch { console.log('[debug] no debug.flag'); }
  }
}

// ─── CLI ───

const cmd = process.argv[2];
const args = process.argv.slice(3);

(async () => {
  switch (cmd) {
    case 'build': return await build(args[0] === 'debug');
    case 'launch': return await launch();
    case 'chat': return await chat(args.join(' '));
    case 'sessions': return await sessions(args[0]);
    case 'config': return await config();
    case 'debug': return await debug(args[0] !== 'off');
    case 'api': {
      const method = args[0];
      const path = args[1];
      const body = args[2] ? JSON.parse(args[2]) : {};
      if (method === 'GET') console.log(JSON.stringify(await apiGet(path), null, 2));
      else console.log(JSON.stringify(await apiPost(path, body), null, 2));
      return;
    }
    default:
      console.log(`Usage: node driver.mjs <command> [args]

Commands:
  build [debug]     Build + pack the installer (debug = pack:debug)
  launch            Launch the Electron app (API on :3192)
  chat "<msg>"      Send a chat message via SSE streaming
  sessions [id]     List sessions or get messages for a session
  config            Show LLM config
  debug [off]       Enable (default) or disable debug.flag
  api GET <path>    Raw API call (GET)
  api POST <path> '<json>'  Raw API call (POST)
`);
  }
})();
