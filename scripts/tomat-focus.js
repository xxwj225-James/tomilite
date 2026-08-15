#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script */
// tomat focus — Universal IDE focus tracker
// Watches a project directory for file changes and sends heartbeats to TomiLite API.
// Works with any IDE/editor: VS Code, JetBrains, Cursor, vim, etc.

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_URL = process.env.TOMAT_API || 'http://localhost:3091';
const WATCH_DIR = process.argv[2] || process.cwd();
const POLL_INTERVAL = parseInt(process.env.TOMAT_INTERVAL || '10000', 10); // 10s

// File extensions to track (ignore noise like node_modules, .git, etc.)
const TRACK_EXTENSIONS = new Set([
  '.js','.ts','.tsx','.jsx','.py','.java','.go','.rs','.rb','.php',
  '.c','.cpp','.h','.hpp','.cs','.swift','.kt','.scala','.clj',
  '.vue','.svelte','.html','.css','.scss','.less',
  '.json','.yaml','.yml','.toml','.xml','.md','.sql','.sh','.bash',
]);
const IGNORE_DIRS = new Set([
  'node_modules','.git','.hg','.svn','dist','build','.next','.nuxt',
  '__pycache__','venv','.venv','target','bin','obj','out','tmp',
  '.cache','.idea','.vscode','coverage','.nyc_output','.turbo',
]);
const MAX_FILE_SIZE = 1024 * 1024; // 1MB — skip large binaries/logs
const MAX_FILES_SCAN = 5000;       // hard cap to prevent CPU spin on giant repos
const DEBOUNCE_MS = 2000;          // 2s window before reporting activity

let lastActivity = Date.now();
let lastFileCount = 0;
let debounceTimer = null;

// Walk directory and collect file modification times (with size+count limits)
function scanDir(dir) {
  let mtimes = [];
  let scanned = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (scanned >= MAX_FILES_SCAN) break;
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = scanDir(fullPath);
        mtimes = mtimes.concat(sub);
        scanned += sub.length;
      } else if (TRACK_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size <= MAX_FILE_SIZE) {
            mtimes.push(stat.mtimeMs);
            scanned++;
          }
        } catch {}
      }
    }
  } catch {}
  return mtimes;
}

// Send heartbeat to TomiLite
function sendHeartbeat(state, idleSec) {
  const data = JSON.stringify({
    ts: Date.now(),
    idle_sec: idleSec,
    state: state === 'active' ? 'active' : 'idle',
    source: 'tomat',
  });

  const req = http.request(`${API_URL}/api/focus.heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    timeout: 3000,
  });
  req.on('error', () => {}); // silent fail if API not running
  req.write(data);
  req.end();
}

let lastState = '';
function detectAndSend() {
  const currentFiles = scanDir(WATCH_DIR);
  const fileCount = currentFiles.length;
  const now = Date.now();

  // Detect activity: file count changed OR recent modification times
  let activityDetected = false;
  if (fileCount !== lastFileCount) {
    activityDetected = true;
  } else {
    const threshold = now - POLL_INTERVAL * 2;
    activityDetected = currentFiles.some(m => m > threshold);
  }

  if (activityDetected) {
    // Debounce: wait DEBOUNCE_MS before confirming activity
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      lastActivity = Date.now();
    }, DEBOUNCE_MS);
  }
  lastFileCount = fileCount;

  // Use debounced lastActivity for idle calculation
  const effectiveActivity = debounceTimer ? lastActivity : (activityDetected ? now : lastActivity);
  const idleSec = Math.floor((now - (activityDetected ? lastActivity : effectiveActivity)) / 1000);
  const state = idleSec < 120 ? 'active' : idleSec < 600 ? 'idle' : 'away';

  if (state !== lastState) {
    sendHeartbeat(state, idleSec);
    lastState = state;
    const emoji = state === 'active' ? '🔒' : state === 'idle' ? '🎯' : '💤';
    process.stdout.write(`\r${emoji} ${state} | idle: ${idleSec}s | files: ${fileCount} | ${path.basename(WATCH_DIR)}  `);
  }
}

console.log(`tomat focus — watching ${WATCH_DIR}`);
console.log(`   API: ${API_URL}`);
console.log(`   Press Ctrl+C to stop.\n`);

// Initial scan
detectAndSend();

// Poll
const interval = setInterval(detectAndSend, POLL_INTERVAL);

process.on('SIGINT', () => {
  clearInterval(interval);
  console.log('\n👋 Focus tracking stopped.');
  process.exit(0);
});
