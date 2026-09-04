import { getProxyUrl } from './agent/utils/proxy.js';
const proxyUrl = getProxyUrl();
if (proxyUrl) console.warn('[server] Proxy detected:', proxyUrl);

import { createServer } from 'node:http';
import { router } from './trpc';
import { issueRouter } from './routers/issue';
import { boardRouter } from './routers/board';
import { wikiRouter } from './routers/wiki';
import { gitRouter, scanGitWorkDirs } from './routers/git';
import { focusRouter } from './routers/focus';
import { systemRouter } from './routers/system';
import { llmRouter } from './routers/llm';
import { emailRouter } from './routers/email';
import { agentRouter, handleAgentStream, initWorkspaceRoots } from './routers/agent';
import { mcpRouter } from './routers/mcp';
import { apikeyRouter } from './routers/apikey';
import { healthRouter } from './routers/health';
import { searchRouter } from './routers/search';
import { learnRouter } from './routers/learn';
import { knowledgeRouter } from './routers/knowledge';
import { reportRouter, startReportArchiver } from './routers/report';
import { feedbackRouter } from './routers/feedback';
import { chatRouter } from './routers/chat';
import { standupRouter, checkAndGenerateEvening, checkAndGenerateMorning } from './routers/standup';
import { mcpServerRouter } from './routers/mcpServer';
import { hostedRouter } from './routers/hosted';
import { resolveLLM } from './lib/gateway.js';
import * as telemetry from './lib/telemetry.js';

// ─── Compose all routers ───
const appRouter = router({
  issue: issueRouter,
  board: boardRouter,
  wiki: wikiRouter,
  git: gitRouter,
  focus: focusRouter,
  system: systemRouter,
  llm: llmRouter,
  email: emailRouter,
  agent: agentRouter,
  mcp: mcpRouter,
  mcpServer: mcpServerRouter,
  apikey: apikeyRouter,
  health: healthRouter,
  search: searchRouter,
  learn: learnRouter,
  knowledge: knowledgeRouter,
  report: reportRouter,
  feedback: feedbackRouter,
  chat: chatRouter,
  standup: standupRouter,
  hosted: hostedRouter,
});

export type AppRouter = typeof appRouter;

// ─── Minimal tRPC HTTP server (no express/fastify needed) ───
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, extname } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// Path to built frontend (relative to project root)
// In CJS (bundled), __dirname is the Node.js global pointing to this file's directory.
// In ESM (tsx dev), static serving is handled by Vite; this path won't be used.
const WEB_DIST = join(typeof __dirname !== 'undefined' ? __dirname : process.cwd(), '..', '..', 'web', 'dist');

function serveStatic(reqUrl: string, res: any) {
  try {
    let filePath = join(WEB_DIST, reqUrl === '/' ? 'index.html' : reqUrl);
    // SPA fallback: if file doesn't exist, serve index.html
    if (!existsSync(filePath) || !extname(filePath)) {
      filePath = join(WEB_DIST, 'index.html');
    }
    if (!existsSync(filePath)) {
      console.error('[Static] Not found: ' + filePath);
      return false;
    }
    const ext = extname(filePath);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.writeHead(200);
    res.end(readFileSync(filePath));
    return true;
  } catch (e: any) {
    console.error('[Static] Error serving ' + reqUrl + ': ' + (e?.message || e));
    return false;
  }
}

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api',
    req,
    router: appRouter,
    createContext: () => ({
      xApiKey: req.headers.get('x-api-key') || req.headers.get('X-Api-Key') || undefined,
    }),
  });

// ─── API security token (generated once, persisted to data dir) ───
import { homedir } from 'node:os';
const DATA_DIR = process.env.TL_USER_DATA || join(homedir(), '.tomilite');
const tokenFile = join(DATA_DIR, '.api_token');
let API_TOKEN = '';
try {
  if (existsSync(tokenFile)) {
    API_TOKEN = readFileSync(tokenFile, 'utf-8').trim();
  }
} catch {}
function ensureApiToken() {
  if (API_TOKEN) return API_TOKEN;
  API_TOKEN = 'tl_' + randomBytes(32).toString('hex');
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(tokenFile, API_TOKEN, { mode: 0o600 });
  } catch {}
  console.warn('[Init] API token generated');
  return API_TOKEN;
}
ensureApiToken();

const server = createServer(async (req, res) => {
  // CORS — restrict to localhost (not '*')
  const origin = req.headers.origin;
  const host = req.headers.host || '';
  const isLocalOrigin = host.startsWith('localhost:') || host.startsWith('127.0.0.1:');
  if (origin && isLocalOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-TL-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Token validation for all API endpoints (except MCP which uses api_key)
  // Localhost is exempt; non-localhost MUST present a valid token
  const remoteAddr = req.socket.remoteAddress || '';
  const isLocalhost = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
  const isMcpPath = req.url?.startsWith('/api/mcp.'); // exact: /api/mcp.execute etc — NOT /api/mcpServers.*
  if (req.url?.startsWith('/api') && !isMcpPath) {
    const token = (req.headers['x-tl-token'] || req.headers['authorization']?.replace('Bearer ', '')) as string;
    if (!isLocalhost && (!token || token !== API_TOKEN)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Forbidden — invalid or missing token' }));
      return;
    }
  }

  // ─── Static file serving (non-API, non-SSE GET requests) ───
  if (req.method === 'GET' && req.url && !req.url.startsWith('/api')) {
    if (serveStatic(req.url, res)) return;
    console.error('[Static] 404: ' + req.url + ' (WEB_DIST=' + WEB_DIST + ')');
    res.setHeader('Content-Type', 'text/plain');
    res.writeHead(404);
    res.end('Not found: ' + req.url);
    return;
  }

  // ─── Token endpoint (frontend fetches once; localhost only — never leak to LAN) ───
  if (req.url === '/api/auth.token' && req.method === 'GET') {
    if (!isLocalhost) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ token: API_TOKEN }));
    return;
  }

  // ─── SSE stream handler (before tRPC) ───
  if (req.url?.startsWith('/api/agent/stream') && req.method === 'POST') {
    try {
      await handleAgentStream(req, res);
    } catch (e: any) {
      console.error('[AgentStream] 500:', e.message);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(e.message);
      }
    }
    return;
  }

  // ─── Anonymous usage telemetry (renderer → local buffer). Consent-gated at
  // both ends: the renderer client only calls this when opted in, and this
  // route drops anything when consent is off (204 no-op) as defense in depth.
  if (req.url === '/api/telemetry/event' && req.method === 'POST') {
    try {
      if (await telemetry.getConsent()) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        if (body && typeof body.name === 'string') {
          telemetry.track(body.name, body.p).catch(() => {});
        }
      }
      res.writeHead(204);
      res.end();
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  // tRPC handler
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const request = new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? (req as unknown as ReadableStream<Uint8Array>) : null,
    ...(req.method !== 'GET' && req.method !== 'HEAD' ? { duplex: 'half' as const } : {}),
  });

  handler(request)
    .then((response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) {
        const reader = response.body.getReader();
        const pump = () =>
          reader.read().then(({ done, value }) => {
            if (done) {
              res.end();
              return;
            }
            res.write(value);
            pump();
          });
        pump();
      } else {
        res.end();
      }
    })
    .catch((err) => {
      console.error('API error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    });
});

// ─── OS Notification helper ───
async function sendNotification(title: string, body: string) {
  try {
    await fetch('http://127.0.0.1:3191/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title, body: body }),
    });
    // Increment notification count
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'notifyCount' } });
    const count = (cfg ? parseInt(cfg.value) || 0 : 0) + 1;
    await prisma.systemConfig.upsert({
      where: { key: 'notifyCount' },
      create: { key: 'notifyCount', value: String(count) },
      update: { value: String(count) },
    });
  } catch {}
}

// ─── Start email watchers ───
import { emailManager, classifyEmail, heuristicClassify } from '@tomilite/email';
import { prisma } from '@tomilite/database';

/** Clean up processed emails older than 12h (piggybacks on each incoming message) */
async function cleanupOldEmails() {
  try {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    // Only cleanup fully-completed emails: processed AND (no Issue OR Issue is done)
    const toClean = await prisma.smartEmail.findMany({
      where: { isProcessed: true, processedAt: { lt: cutoff } },
      select: { id: true, issueId: true },
    });
    let cleaned = 0;
    for (const email of toClean) {
      if (email.issueId) {
        const issue = await prisma.issue.findUnique({ where: { id: email.issueId }, select: { status: true } });
        if (!issue || issue.status !== 'done') continue; // skip if Issue not completed
      }
      await prisma.smartEmail.delete({ where: { id: email.id } });
      cleaned++;
    }
    if (cleaned > 0) console.warn(`[Email Cleanup] Removed ${cleaned} completed emails`);
  } catch (err) {
    console.error('[Email Cleanup] Error:', (err as Error).message);
  }
}

emailManager.onMessage(async (msg) => {
  try {
    // Dedup by messageId
    const existing = await prisma.smartEmail.findUnique({ where: { messageId: msg.externalId } });
    if (existing) return;

    // Run AI classifier (fallback to heuristic if LLM unavailable).
    // BYOK or hosted gateway both work — resolveLLM supplies a decrypted key.
    let classification;
    try {
      const llm = await resolveLLM();
      if (llm) {
        classification = await classifyEmail(
          msg,
          llm.apiKey,
          llm.baseUrl,
          llm.flashModel || llm.proModel || 'deepseek-v4-flash',
        );
      } else {
        classification = heuristicClassify(msg);
      }
    } catch {
      classification = heuristicClassify(msg);
    }

    // All categories stored to DB

    // Create SmartEmail record
    await prisma.smartEmail.create({
      data: {
        messageId: msg.externalId,
        uid: msg.uid ?? 0,
        fromAddr: msg.from,
        toAddr: msg.to,
        cc: msg.cc || null,
        subject: msg.subject,
        date:
          msg.receivedAt instanceof Date
            ? msg.receivedAt.toISOString().replace('T', ' ').substring(0, 19)
            : String(msg.receivedAt),
        category: classification.category,
        summary: classification.summary,
        replyDraft: classification.replyDraft || null,
        bodySnapshot: msg.body?.substring(0, 2000) || null,
      },
    });

    // Send notifications for Cat 1/2/3 (no auto-issue creation — user creates tasks manually)
    if (classification.category === 1) {
      sendNotification('📥 紧急邮件', msg.subject).catch(() => {});
      console.warn(`[Email] Urgent: "${msg.subject}" from ${msg.from}`);
    } else if (classification.category === 2) {
      sendNotification('📥 新邮件', msg.subject).catch(() => {});
      console.warn(`[Email] Reply today: "${msg.subject}" from ${msg.from}`);
    } else if (classification.category === 3) {
      sendNotification('📥 新通知', msg.subject).catch(() => {});
      console.warn(`[Email] Notification: "${msg.subject}" from ${msg.from}`);
    } else if (classification.category === 4) {
      console.warn(`[Email] Other: "${msg.subject}" from ${msg.from}`);
    }

    // Piggyback: run cleanup after each new email
    cleanupOldEmails().catch(() => {});
  } catch (err) {
    console.error('[Email] Pipeline error:', (err as Error).message);
  }
});

// ─── Background tasks (started by startBackgroundTasks() after server is ready) ───
function startBackgroundTasks() {
  // Anonymous usage telemetry — flush shortly after boot, then every 6h
  setTimeout(() => {
    telemetry.flush().catch(() => {});
  }, 60_000);
  setInterval(() => {
    telemetry.flush().catch(() => {});
  }, 6 * 3600_000);

  // Hourly cleanup of processed emails older than 12h
  setInterval(cleanupOldEmails, 60 * 60 * 1000);

  // Git work directory scanner — every 10 minutes
  setInterval(
    () => {
      scanGitWorkDirs().catch(() => {});
    },
    10 * 60 * 1000,
  );
  setTimeout(() => {
    scanGitWorkDirs().catch(() => {});
  }, 15_000);

  // Report archiver (hourly)
  startReportArchiver();

  // Morning & Evening standup — check every 60 seconds
  setInterval(() => {
    checkAndGenerateMorning().catch(() => {});
  }, 60_000);
  setInterval(async () => {
    try {
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'uiLanguage' } });
      checkAndGenerateEvening(cfg?.value || 'en');
    } catch {
      /* non-critical */
    }
  }, 60_000);

  // Workspace roots refresh (every 5 min)
  initWorkspaceRoots();

  // Archive old data (3 months) — hide from UI, never delete
  setInterval(
    async () => {
      try {
        const cutoffIssue = new Date(Date.now() - 90 * 86400000).toISOString().replace('T', ' ').substring(0, 19);
        const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
        const a1 = await prisma.issue.deleteMany({
          where: { status: 'done', updatedAt: { lt: cutoffIssue } },
        });
        const a2 = await prisma.gitCommit.updateMany({
          where: { timestamp: { lt: cutoff }, archived: false },
          data: { archived: true },
        });
        const a3 = await prisma.smartEmail.updateMany({
          where: { date: { lt: cutoffIssue }, archived: false },
          data: { archived: true },
        });
        if (a1.count + a2.count + a3.count > 0) {
          console.warn(`[Archive] Issues:${a1.count} Git:${a2.count} Emails:${a3.count}`);
        }
      } catch {}
    },
    60 * 60 * 1000,
  );

  // Auto-start if there are enabled integrations
  setTimeout(async () => {
    try {
      const integrations = await prisma.integration.findMany({ where: { type: 'imap', enabled: true } });
      if (integrations.length > 0) {
        const { decrypt } = await import('./lib/crypto.js');
        for (const integration of integrations) {
          try {
            const cfg = JSON.parse(integration.config);
            cfg.password = await decrypt(cfg.password);
            if (cfg.smtp?.password) cfg.smtp.password = await decrypt(cfg.smtp.password);
            await emailManager.startIMAP(integration.id, cfg);
          } catch (err) {
            const errMsg = (err as Error).message;
            console.error(`[Email] Auto-start failed:`, errMsg);
            try {
              await prisma.systemConfig.upsert({
                where: { key: 'imapLastError' },
                create: { key: 'imapLastError', value: errMsg },
                update: { value: errMsg },
              });
            } catch {}
          }
        }
      }
    } catch (err) {
      console.error('[Email] Auto-start error:', (err as Error).message);
    }
  }, 2000);
}

// Schema version — bump when schema.prisma changes so db push runs
// ⚠️ OTA migration: increment EVERY TIME you change prisma/schema.prisma
// Only ADDITIVE changes (new columns/tables). Never rename or drop.
// ensureSchema() → detects old version → prisma db push → preserves all user data
const SCHEMA_VERSION = 20; // activate McpServer with transport/status/headers/toolsJson/hitlMode columns

// ─── Ensure database schema is up to date (runs db push only when needed) ───
async function ensureSchema() {
  let cfg: any = null;
  try {
    cfg = await prisma.systemConfig.findUnique({ where: { key: 'schemaVersion' } });
    if (cfg && parseInt(cfg.value) >= SCHEMA_VERSION) {
      return true; // Schema already up to date — skip migration
    }
  } catch {
    // Table might not exist yet — first launch, proceed with migration
  }

  console.warn('[Init] Syncing database schema to v' + SCHEMA_VERSION + '...');

  // ─── Phase 1: Raw SQL migration (reliable, no prisma db push dependency) ───
  // Each migration is idempotent — catches "duplicate column" errors silently
  const migrations: Array<{ version: number; sql: string }> = [
    { version: 8, sql: 'ALTER TABLE ChatMessage ADD COLUMN card TEXT' },
    { version: 9, sql: 'ALTER TABLE UserHealthSnapshot ADD COLUMN lang TEXT' },
    { version: 10, sql: 'ALTER TABLE ChatMessage ADD COLUMN reasoningContent TEXT' },
    { version: 11, sql: 'ALTER TABLE ChatMessage ADD COLUMN pinnable INTEGER DEFAULT 0' },
    { version: 12, sql: 'ALTER TABLE KnowledgeCache ADD COLUMN lang TEXT' },
    { version: 13, sql: "UPDATE KnowledgeCache SET lang = 'en' WHERE lang IS NULL" },
    // Only update if the user hasn't customized — old default values only
    { version: 13, sql: "UPDATE LlmConfig SET flashModel = 'deepseek-v4-flash' WHERE flashModel = 'deepseek-chat'" },
    { version: 13, sql: "UPDATE LlmConfig SET proModel = 'deepseek-v4-pro' WHERE proModel = 'deepseek-reasoner'" },
    { version: 13, sql: 'UPDATE LlmConfig SET contextWindow = 128000 WHERE contextWindow = 100000' },
    { version: 14, sql: 'ALTER TABLE Report ADD COLUMN vector TEXT' },
    { version: 14, sql: 'ALTER TABLE KnowledgePage ADD COLUMN vector TEXT' },
    { version: 15, sql: 'ALTER TABLE LlmConfig ADD COLUMN maxOutputTokens INTEGER DEFAULT 16000' },
    {
      version: 16,
      sql: "CREATE TABLE IF NOT EXISTS DailyMotto (id TEXT PRIMARY KEY, text TEXT NOT NULL, date TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'en', createdAt TEXT DEFAULT (datetime('now','localtime')), UNIQUE(date, lang))",
    },
    { version: 17, sql: "ALTER TABLE DailyMotto ADD COLUMN lang TEXT DEFAULT 'en'" },
    { version: 18, sql: 'ALTER TABLE SmartEmail ADD COLUMN topicGroup TEXT' },
    { version: 19, sql: 'ALTER TABLE ChatMessage ADD COLUMN threadId TEXT' },
    { version: 20, sql: "ALTER TABLE McpServer ADD COLUMN transport TEXT DEFAULT 'http'" },
    { version: 20, sql: 'ALTER TABLE McpServer ADD COLUMN headers TEXT' },
    { version: 20, sql: "ALTER TABLE McpServer ADD COLUMN status TEXT DEFAULT 'unknown'" },
    { version: 20, sql: 'ALTER TABLE McpServer ADD COLUMN lastError TEXT' },
    { version: 20, sql: 'ALTER TABLE McpServer ADD COLUMN lastConnectedAt TEXT' },
    { version: 20, sql: 'ALTER TABLE McpServer ADD COLUMN toolsJson TEXT' },
    { version: 20, sql: 'ALTER TABLE McpServer ADD COLUMN toolCount INTEGER DEFAULT 0' },
    { version: 20, sql: "ALTER TABLE McpServer ADD COLUMN hitlMode TEXT DEFAULT 'none'" },
    { version: 20, sql: 'ALTER TABLE McpServer ADD COLUMN hitlConfirmUrl TEXT' },
    { version: 20, sql: 'ALTER TABLE McpServer ADD COLUMN updatedAt TEXT' },
  ];

  for (const m of migrations) {
    if (cfg && parseInt(cfg.value) >= m.version) continue; // already applied
    try {
      await prisma.$executeRawUnsafe(m.sql);
      console.warn('[Init] Raw migration v' + m.version + ' applied');
    } catch (e: any) {
      // SQLite "duplicate column" → column already exists, skip
      if (e.message?.includes('duplicate column') || e.message?.includes('already exists')) {
        console.warn('[Init] Raw migration v' + m.version + ' skipped (already applied)');
      } else {
        console.error('[Init] Raw migration v' + m.version + ' failed:', e.message);
      }
    }
  }

  // ─── Phase 2: prisma db push (catch-all for any other schema changes) ───
  const { execSync } = await import('node:child_process');
  const root = typeof __dirname !== 'undefined' ? join(__dirname, '..', '..', '..') : process.cwd();
  const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const candidates = [
    join(root, '..', 'prisma', 'schema.prisma'), // packaged (extraResources)
    join(root, 'packages', 'database', 'prisma', 'schema.prisma'), // dev
    join(root, 'prisma', 'schema.prisma'), // fallback
  ];
  const schemaPath = candidates.find((p) => existsSync(p)) || candidates[0];
  try {
    // Use Electron's bundled Node.js (or system node in dev)
    const nodeBin = process.env.ELECTRON_RUN_AS_NODE === '1' ? process.execPath : 'node';
    // Prisma CLI writes cache to node_modules/.cache — redirect to writable user dir
    const cacheDir = join(DATA_DIR, 'prisma-cache');
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    // Point Prisma to bundled engine binaries (avoid downloading from internet)
    const engineDir = join(root, 'node_modules', '@prisma', 'engines');
    const schemaEngine = join(engineDir, 'schema-engine-windows.exe');
    // OTA: additive-only migrations. Remove --accept-data-loss — never silently drop user data.
    (execSync as any)(`"${nodeBin}" "${prismaCli}" db push --schema="${schemaPath}" --skip-generate`, {
      stdio: 'pipe',
      timeout: 60000,
      shell: true,
      env: Object.assign({}, process.env, {
        ELECTRON_RUN_AS_NODE: '1',
        npm_config_cache: join(DATA_DIR, 'npm-cache'),
        PRISMA_SCHEMA_ENGINE_BINARY: schemaEngine,
        PRISMA_QUERY_ENGINE_BINARY: join(engineDir, 'query_engine-windows.dll.node'),
      }),
      cwd: DATA_DIR,
    });
    // Mark schema version so we skip db push next time
    await prisma.systemConfig.upsert({
      where: { key: 'schemaVersion' },
      create: { key: 'schemaVersion', value: String(SCHEMA_VERSION) },
      update: { value: String(SCHEMA_VERSION) },
    });
    console.warn('[Init] Schema synced to v' + SCHEMA_VERSION);
    return true;
  } catch (e: any) {
    console.error('[Init] db push failed:', e.stderr?.toString() || e.message);
    // Best-effort: mark version anyway if raw migrations applied — prevents
    // re-running the whole migration (and a slow/hanging db push) on every startup.
    try {
      await prisma.systemConfig.upsert({
        where: { key: 'schemaVersion' },
        create: { key: 'schemaVersion', value: String(SCHEMA_VERSION) },
        update: { value: String(SCHEMA_VERSION) },
      });
    } catch {
      /* non-critical */
    }
    return false;
  }
}

// ─── Ensure seed data exists (idempotent upserts) ───
async function ensureSeed() {
  try {
    await prisma.user.upsert({
      where: { id: 'local-dev' },
      update: {},
      create: { id: 'local-dev', displayName: 'Developer', focusState: 'available' },
    });
    await prisma.project.upsert({
      where: { id: 'proj-default' },
      update: {},
      create: { id: 'proj-default', name: 'My Project', key: 'TL', methodology: 'scrum' },
    });
    const board = await prisma.board.upsert({
      where: { id: 'board-default' },
      update: {},
      create: { id: 'board-default', projectId: 'proj-default', name: 'Kanban' },
    });
    const cols = [
      { id: 'col-todo', name: 'To Do', mappedStatuses: 'todo', sortOrder: 0 },
      { id: 'col-progress', name: 'In Progress', mappedStatuses: 'in_progress', sortOrder: 1 },
      { id: 'col-review', name: 'Review', mappedStatuses: 'in_review', sortOrder: 2 },
      { id: 'col-done', name: 'Done', mappedStatuses: 'done', sortOrder: 3 },
    ];
    for (const c of cols) {
      await prisma.boardColumn.upsert({ where: { id: c.id }, update: {}, create: { ...c, boardId: board.id } });
    }
    await prisma.llmProviderMaster.upsert({
      where: { name: 'deepseek' },
      update: {},
      create: { name: 'deepseek', displayName: 'DeepSeek', apiBaseUrl: 'https://api.deepseek.com', requiresKey: true },
    });
    await prisma.llmProviderMaster.upsert({
      where: { name: 'openai' },
      update: {},
      create: { name: 'openai', displayName: 'OpenAI', apiBaseUrl: 'https://api.openai.com/v1', requiresKey: true },
    });
    await prisma.llmProviderMaster.upsert({
      where: { name: 'anthropic' },
      update: {},
      create: {
        name: 'anthropic',
        displayName: 'Anthropic',
        apiBaseUrl: 'https://api.anthropic.com/v1',
        requiresKey: true,
      },
    });
    await prisma.llmProviderMaster.upsert({
      where: { name: 'qwen' },
      update: {},
      create: {
        name: 'qwen',
        displayName: 'Qwen (通义千问)',
        apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        requiresKey: true,
      },
    });
    await prisma.llmProviderMaster.upsert({
      where: { name: 'kimi' },
      update: {},
      create: {
        name: 'kimi',
        displayName: 'Kimi (Moonshot)',
        apiBaseUrl: 'https://api.moonshot.cn/v1',
        requiresKey: true,
      },
    });
    // Ensure LlmConfig exists (needed for model selection; standalone seed.ts also does this)
    await prisma.llmConfig.upsert({
      where: { id: 'llm-default' },
      update: {},
      create: {
        id: 'llm-default',
        flashModel: 'deepseek-v4-flash',
        proModel: 'deepseek-v4-pro',
        contextWindow: 128000,
        maxOutputTokens: 16000,
      },
    });
  } catch (e: any) {
    console.error('[Seed] Error:', e.message);
  }
}

// Initialize FTS5 full-text search
async function initFTS5() {
  try {
    await prisma.$executeRawUnsafe(
      `CREATE VIRTUAL TABLE IF NOT EXISTS global_fts USING fts5(type, title, body, ref_id, tokenize='porter unicode61')`,
    );
    // Sync triggers for real-time indexing
    const triggers = [
      `CREATE TRIGGER IF NOT EXISTS fts_issue_i AFTER INSERT ON Issue BEGIN INSERT INTO global_fts(type,title,body,ref_id) VALUES('issue',new.title,new.description,new.id); END`,
      `CREATE TRIGGER IF NOT EXISTS fts_issue_u AFTER UPDATE ON Issue BEGIN UPDATE global_fts SET title=new.title, body=new.description WHERE ref_id=new.id AND type='issue'; END`,
      `CREATE TRIGGER IF NOT EXISTS fts_issue_d AFTER DELETE ON Issue BEGIN DELETE FROM global_fts WHERE ref_id=old.id AND type='issue'; END`,
      `CREATE TRIGGER IF NOT EXISTS fts_note_i AFTER INSERT ON KnowledgePage BEGIN INSERT INTO global_fts(type,title,body,ref_id) VALUES('note',new.title,new.content,new.id); END`,
      `CREATE TRIGGER IF NOT EXISTS fts_note_u AFTER UPDATE ON KnowledgePage BEGIN UPDATE global_fts SET title=new.title, body=new.content WHERE ref_id=new.id AND type='note'; END`,
      `CREATE TRIGGER IF NOT EXISTS fts_note_d AFTER DELETE ON KnowledgePage BEGIN DELETE FROM global_fts WHERE ref_id=old.id AND type='note'; END`,
      `CREATE TRIGGER IF NOT EXISTS fts_email_i AFTER INSERT ON SmartEmail BEGIN INSERT INTO global_fts(type,title,body,ref_id) VALUES('email',new.subject,COALESCE(new.bodySnapshot,new.summary,''),new.id); END`,
      `CREATE TRIGGER IF NOT EXISTS fts_email_u AFTER UPDATE ON SmartEmail BEGIN UPDATE global_fts SET title=new.subject, body=COALESCE(new.bodySnapshot,new.summary,'') WHERE ref_id=new.id AND type='email'; END`,
      `CREATE TRIGGER IF NOT EXISTS fts_email_d AFTER DELETE ON SmartEmail BEGIN DELETE FROM global_fts WHERE ref_id=old.id AND type='email'; END`,
      `CREATE TRIGGER IF NOT EXISTS fts_git_i AFTER INSERT ON GitCommit BEGIN INSERT INTO global_fts(type,title,body,ref_id) VALUES('git',new.message,new.author,new.id); END`,
      `CREATE TRIGGER IF NOT EXISTS fts_git_u AFTER UPDATE ON GitCommit BEGIN UPDATE global_fts SET title=new.message, body=new.author WHERE ref_id=new.id AND type='git'; END`,
      `CREATE TRIGGER IF NOT EXISTS fts_git_d AFTER DELETE ON GitCommit BEGIN DELETE FROM global_fts WHERE ref_id=old.id AND type='git'; END`,
      `CREATE TRIGGER IF NOT EXISTS fts_report_i AFTER INSERT ON Report BEGIN INSERT INTO global_fts(type,title,body,ref_id) VALUES('report',new.title,new.content,new.id); END`,
      `CREATE TRIGGER IF NOT EXISTS fts_report_u AFTER UPDATE ON Report BEGIN UPDATE global_fts SET title=new.title, body=new.content WHERE ref_id=new.id AND type='report'; END`,
      `CREATE TRIGGER IF NOT EXISTS fts_report_d AFTER DELETE ON Report BEGIN DELETE FROM global_fts WHERE ref_id=old.id AND type='report'; END`,
    ];
    for (const sql of triggers) {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch {}
    }
    // Initial population (INSERT OR IGNORE to skip duplicates)
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO global_fts(type,title,body,ref_id) SELECT 'issue',title,COALESCE(description,''),id FROM Issue`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO global_fts(type,title,body,ref_id) SELECT 'note',title,COALESCE(content,''),id FROM KnowledgePage`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO global_fts(type,title,body,ref_id) SELECT 'email',subject,COALESCE(bodySnapshot,summary,''),id FROM SmartEmail`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO global_fts(type,title,body,ref_id) SELECT 'git',message,author,id FROM GitCommit`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO global_fts(type,title,body,ref_id) SELECT 'report',title,COALESCE(content,''),id FROM Report`,
    );
    console.warn('[Init] FTS5 search index ready');
  } catch (e: any) {
    console.error('[Init] FTS5 setup failed:', e.message);
  }
}

// Run DB migration FIRST, then start server (avoids race: query before column exists)
const PORT = parseInt(process.env.API_PORT || '3091', 10);

ensureSchema()
  .then((schemaOk) => {
    if (!schemaOk) {
      console.error('[Init] Schema push failed');
    }
    return ensureSeed();
  })
  .then(initFTS5)
  .then(() => {
    console.warn('[Init] Database ready');
    startBackgroundTasks();
    // Telemetry boot hook (install id + app_launch if opted in) — DB is ready here
    telemetry.init().catch(() => {});
    // Start HTTP server only after DB is fully ready
    server.listen(PORT, () => {
      console.warn(`TomiLite API running on http://localhost:${PORT}/api`);
    });
  });
