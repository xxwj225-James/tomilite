import { systemProxy } from './agent/utils/proxy.js';
// One line at boot, and only when a proxy is actually in use — silence means requests go
// direct, which is the state almost every user is in and the one the absence of this line
// answers. Whether a proxy is in use is otherwise only visible as "the search tool comes
// back empty"; see the header of `utils/proxy.ts` for the failure that made this worth
// printing. The bypass list is here because "why is my local Redmine going through a
// proxy" is the other half of that failure.
const sysProxy = systemProxy();
if (sysProxy.url) console.warn('[server] System proxy:', sysProxy.url, '| bypass:', sysProxy.bypass.join(';') || 'none');

import { createServer } from 'node:http';
import { router } from './trpc';
import { issueRouter } from './routers/issue';
import { boardRouter } from './routers/board';
import { wikiRouter } from './routers/wiki';
import { redmineRouter, scheduledRedmineSync } from './routers/redmine';
import { gitRouter, scanGitWorkDirs } from './routers/git';
import { focusRouter } from './routers/focus';
import { systemRouter } from './routers/system';
import { llmRouter } from './routers/llm';
import { emailRouter } from './routers/email';
import { agentRouter, handleAgentStream, initWorkspaceRoots } from './routers/agent';
import { mcpRouter, sweepHitlTasks, executeMcp, mcpDefaultWaitMs } from './routers/mcp';
import { handleMcpRequest } from './mcp/http';
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
import {
  meetingRouter,
  handleMeetingAudioChunk,
  handleMeetingStream,
  recoverStuckMeetings,
  backfillMeetingDecisions,
} from './routers/meeting';
import { checkMeetingReminders } from './lib/meeting/reminders.js';
import { sweepMeetingAudioRetention } from './lib/meeting/retention.js';
import { runDistillationSweep } from './lib/chatDistill.js';
import { ensureSearchIndexes, reclaimIndexSpace } from './lib/ftsIndex.js';
import { ensureClockUtc, ensureIssueClock } from './lib/clockUtc.js';
import { embedWarmup } from './lib/embed/index.js';
import { DRAIN_PER_TICK, drainEmbedQueue, embedBootSweep } from './lib/embed/queue.js';
import { resolveLLM } from './lib/gateway.js';
import * as telemetry from './lib/telemetry.js';
// The one path to a Windows toast — shared with the meeting reminder sweep.
import { sendNotification } from './lib/notify.js';

/**
 * What MCP clients are told this server is. Set by electron/main.js from the packaged
 * app's own version; in `tsx` dev runs it is absent, and dev builds are not shipped.
 */
const APP_VERSION = process.env.TL_APP_VERSION || '0.0.0-dev';

// ─── Compose all routers ───
const appRouter = router({
  issue: issueRouter,
  board: boardRouter,
  wiki: wikiRouter,
  // Mounted here, and deliberately NOT in the MCP server's allow-list (routers/mcp.ts):
  // `sync` spends a stored credential against a third-party server and writes hundreds of
  // rows, which is not something an LLM-composed call should be able to do. The agent
  // reads the resulting rows through the tools it already has.
  redmine: redmineRouter,
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
  meeting: meetingRouter,
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
  // X-Api-Key was missing, so a browser preflight for any MCP call failed outright; the
  // Mcp-* headers are the ones a StreamableHTTP client sends on every request.
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-TL-Token, X-Api-Key, Mcp-Protocol-Version, Mcp-Method, Mcp-Name',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Protocol-Version');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Token validation for all API endpoints (except MCP which uses api_key)
  // Localhost is exempt; non-localhost MUST present a valid token
  const remoteAddr = req.socket.remoteAddress || '';
  const isLocalhost = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
  // `/api/mcp` (the StreamableHTTP endpoint) and `/api/mcp.*` (execute, listTools, …)
  // authenticate with an API key rather than the desktop token. The old prefix test had
  // a dot in it, so bare `/api/mcp` was NOT exempt and a non-localhost MCP client was
  // asked for a token it has no way to obtain. `/api/mcpServer.*` still does not match.
  const urlPath = (req.url || '').split('?')[0];
  const isMcpPath = urlPath === '/api/mcp' || urlPath.startsWith('/api/mcp.');
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

  // ─── Meeting audio upload (raw PCM body — tRPC can't carry binary) ───
  if (req.url?.startsWith('/api/meeting/audio-chunk') && req.method === 'POST') {
    try {
      await handleMeetingAudioChunk(req, res);
    } catch (e: any) {
      console.error('[MeetingAudio] 500:', e?.message || e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
      }
    }
    return;
  }

  // ─── Meeting progress stream (SSE: model download / transcribe / AI stages) ───
  if (req.url?.startsWith('/api/meeting/stream') && req.method === 'GET') {
    try {
      await handleMeetingStream(req, res);
    } catch (e: any) {
      console.error('[MeetingStream] 500:', e?.message || e);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(e?.message || String(e));
      }
    }
    return;
  }

  // ─── MCP over StreamableHTTP ───
  // Mounted ahead of tRPC because it answers `/api/mcp` itself and consumes the request
  // body. It reaches the very same `executeMcp` the tRPC route uses, in this process —
  // which is the only way a waiting tool call can see the human's approval, since the
  // HITL queue is a Map in this module's memory.
  if (urlPath === '/api/mcp') {
    try {
      await handleMcpRequest(req, res, {
        serverVersion: APP_VERSION,
        callTool: (tool, args) =>
          executeMcp(
            { tool, arguments: args, wait_ms: mcpDefaultWaitMs() },
            { xApiKey: (req.headers['x-api-key'] as string) || undefined },
          ),
      });
    } catch (e: any) {
      console.error('[MCP] 500:', e?.message || e);
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }));
      }
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

// ─── Start email watchers ───
import { emailManager, classifyEmail, heuristicClassify } from '@tomilite/email';
import { prisma } from '@tomilite/database';
import { utcStamp } from './lib/dbTime.js';

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
        // Explicit: the column default is localtime and this was the only writer, so
        // every row was born local. See lib/dbTime.ts for the invariant.
        createdAt: utcStamp(),
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

  // MCP approvals — expire pending ones whose window has closed, every 60s. This used
  // to happen only inside the execute path, so an approval nobody was waiting on stayed
  // "pending" in the panel until the next tool call happened to sweep it.
  setInterval(() => {
    sweepHitlTasks();
  }, 60_000);

  // The index rebuild dropped a large amount of duplicated data; VACUUM gives those
  // pages back to the filesystem. Deferred well past listen() because a VACUUM takes
  // an exclusive lock and would otherwise be visible as a slow startup.
  setTimeout(() => {
    reclaimIndexSpace().catch(() => {});
  }, 120_000);

  // ── Embedding (semantic search) ──
  //
  // Three timers, none of them awaited, none of them on the request path. The order and
  // the delays matter:
  //
  //   45 s — build the ONNX session. This costs ~11 s of CPU and the whole reason it is
  //          a timer is that no user action may ever pay it. Doing it first also means
  //          knowledge recall's fallback (which is gated on isEmbedLoaded()) starts
  //          working a minute into the session instead of never.
  //   90 s — enqueue the backfill, download the model if it is missing, drain a first
  //          batch. Placed after the warm-up so a model that IS installed is never
  //          loaded twice concurrently, and late enough that the download does not
  //          compete with startup I/O.
  //   60 s — steady-state drain (60 rows ≈ 1 s of work per minute). Notes and reports
  //          enqueue themselves via triggers; this is what turns the queue into vectors.
  //          Worth knowing before changing it: a big corpus is bounded by this rate, and
  //          the boot sweep's 200 rows only covers the first pass.
  setTimeout(() => {
    embedWarmup().catch(() => {});
  }, 45_000);
  setTimeout(() => {
    embedBootSweep().catch(() => {});
  }, 90_000);
  setInterval(() => {
    drainEmbedQueue(DRAIN_PER_TICK).catch(() => {});
  }, 60_000);

  // Meetings interrupted by a crash/force-quit would otherwise sit at
  // "transcribing…" forever. Flip them to a retryable state on boot.
  setTimeout(() => {
    recoverStuckMeetings().catch(() => {});
  }, 5_000);

  // Decisions used to live in a JSON column; copy them into rows once so old
  // meetings don't open with their decisions missing.
  setTimeout(() => {
    backfillMeetingDecisions().catch(() => {});
  }, 8_000);

  // Meeting reminders — action item due tomorrow, and post-meeting review.
  // Same 60s cadence as the standup checks; both are single indexed queries.
  setInterval(() => {
    checkMeetingReminders().catch(() => {});
  }, 60_000);

  // Meeting audio retention — delete audio past each meeting's own window.
  // Retention is measured in days, so an hourly tick is already far finer than
  // the field's resolution; the first run waits 10 minutes so a slow startup
  // (index rebuild, model warmup) is not competing with filesystem work.
  setTimeout(() => {
    sweepMeetingAudioRetention().catch(() => {});
  }, 10 * 60_000);
  setInterval(() => {
    sweepMeetingAudioRetention().catch(() => {});
  }, 60 * 60_000);

  // Chat → knowledge distillation. The run itself re-checks both gates (idle
  // ≥3min, ≥6 new messages), so a 5-minute tick is plenty; a faster one would
  // only add DB churn and gateway pressure for nothing.
  setTimeout(() => {
    runDistillationSweep().catch(() => {});
  }, 3 * 60_000);
  setInterval(() => {
    runDistillationSweep().catch(() => {});
  }, 5 * 60_000);

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

  // Archive old data (3 months). Commits and emails are *hidden* (`archived: true`), but a
  // finished local task is a hard DELETE, and it takes its comments, changelog, git-ref
  // links and board cards with it (those relations cascade) while orphaning its subtasks
  // (`Issue.children` is `onDelete: SetNull`, so a child survives with `parentId` cleared).
  // That behaviour is pre-existing and this batch does not change it; it is written down
  // here because the line above used to claim it was a hide.
  //
  // Mirrored rows are excluded from it entirely — see the `source: null` below.
  // Redmine sync: once 4 minutes after boot, then every 30 minutes.
  //
  // The 4-minute delay is because the first tick of a startup timer lands while the app
  // is still doing its own boot work — the embedding warmup, the FTS backfill — and a
  // network round trip to somebody else's server has no business being in that queue.
  //
  // 30 minutes and not 5: the cursor makes each pass cheap, and the cost of a pass falls
  // on a server the user does not administer. A ticket that appears 30 minutes late is
  // not late. The sweep returns immediately when there is no config or it is disabled,
  // and `runSync` re-enters as a no-op, so overlapping ticks are safe.
  setTimeout(() => {
    scheduledRedmineSync().catch(() => {});
  }, 4 * 60_000);
  setInterval(
    () => {
      scheduledRedmineSync().catch(() => {});
    },
    30 * 60_000,
  );

  setInterval(
    async () => {
      try {
        const cutoffIssue = utcStamp(new Date(Date.now() - 90 * 86400000));
        // `GitCommit.timestamp` is a naive-UTC stamp like every other column now, so the
        // archiver's cutoff has to be one too — it used to be an ISO `Z` string, which
        // never compared equal to it. See lib/dbTime.ts.
        const cutoff = cutoffIssue;
        // `source: null` is not a filter of convenience — it is the whole safety of this
        // line. A mirrored row is not stale work the user abandoned: it is a copy of
        // someone else's tracker, and `status: 'done'` there means the ticket was
        // closed, not that the user finished it. Without the predicate, importing 400
        // Redmine issues silently became 87 an hour later — the closed ones are exactly
        // the ones older than the 90-day cutoff, and the sync cursor has already moved
        // past them, so they never come back. Every existing row is NULL and every
        // writer in this repo keeps writing NULL, so this changes nothing for local work.
        const a1 = await prisma.issue.deleteMany({
          where: { status: 'done', updatedAt: { lt: cutoffIssue }, source: null },
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
//
// A changed *column default* is not deliverable this way (SQLite has no ALTER COLUMN
// SET DEFAULT, and db push cannot run against a database carrying the search index —
// see the Phase 2 note below). Those are delivered by lib/clockUtc.ts instead, which
// self-heals on every boot like lib/ftsIndex.ts. The bump here is only so the additive
// array re-runs.
const SCHEMA_VERSION = 26; // Issue gained the external-tracker reference (source/sourceId)

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
    // ─── v21: Meeting Intelligence ───
    // DDL below is copied verbatim from `prisma migrate diff --from-empty
    // --to-schema-datamodel` so these tables match what `db push` (Phase 2)
    // would create. Any drift here surfaces as a db push failure, not silent
    // corruption. Order matters: Meeting must exist before its children (FKs).
    {
      version: 21,
      sql: `CREATE TABLE IF NOT EXISTS "Meeting" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "projectId" TEXT NOT NULL DEFAULT 'proj-default',
        "title" TEXT NOT NULL,
        "source" TEXT NOT NULL DEFAULT 'mic+system',
        "status" TEXT NOT NULL DEFAULT 'recording',
        "audioFile" TEXT,
        "audioBytes" INTEGER NOT NULL DEFAULT 0,
        "sampleRate" INTEGER NOT NULL DEFAULT 16000,
        "durationMs" INTEGER NOT NULL DEFAULT 0,
        "whisperModel" TEXT NOT NULL DEFAULT 'base',
        "transcribeModel" TEXT,
        "lang" TEXT NOT NULL DEFAULT 'auto',
        "transcribeStatus" TEXT NOT NULL DEFAULT 'none',
        "transcribeProgress" INTEGER NOT NULL DEFAULT 0,
        "transcribeError" TEXT,
        "aiStatus" TEXT NOT NULL DEFAULT 'none',
        "minutesStatus" TEXT NOT NULL DEFAULT 'none',
        "jobStage" TEXT,
        "transcript" TEXT,
        "chunkSummaries" TEXT,
        "summary" TEXT,
        "decisions" TEXT,
        "speakers" TEXT,
        "minutes" TEXT,
        "minutesSubject" TEXT,
        "stageLog" TEXT NOT NULL DEFAULT '[]',
        "attendees" TEXT,
        "sendTo" TEXT,
        "sendCc" TEXT,
        "sentAt" TEXT,
        "retentionDays" INTEGER NOT NULL DEFAULT 30,
        "audioDeletedAt" TEXT,
        "consentAcknowledgedAt" TEXT,
        "archived" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        "updatedAt" TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`,
    },
    {
      version: 21,
      sql: `CREATE TABLE IF NOT EXISTS "MeetingSegment" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "meetingId" TEXT NOT NULL,
        "idx" INTEGER NOT NULL,
        "startMs" INTEGER NOT NULL,
        "endMs" INTEGER NOT NULL,
        "speaker" TEXT,
        "text" TEXT NOT NULL,
        CONSTRAINT "MeetingSegment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
    },
    {
      version: 21,
      sql: `CREATE TABLE IF NOT EXISTS "MeetingActionItem" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "meetingId" TEXT NOT NULL,
        "idx" INTEGER NOT NULL,
        "text" TEXT NOT NULL,
        "owner" TEXT,
        "dueDate" TEXT,
        "priority" TEXT NOT NULL DEFAULT 'medium',
        "status" TEXT NOT NULL DEFAULT 'open',
        "issueId" TEXT,
        "createdAt" TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "MeetingActionItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`,
    },
    {
      version: 21,
      sql: 'CREATE INDEX IF NOT EXISTS "Meeting_status_createdAt_idx" ON "Meeting"("status", "createdAt")',
    },
    { version: 21, sql: 'CREATE INDEX IF NOT EXISTS "Meeting_transcribeStatus_idx" ON "Meeting"("transcribeStatus")' },
    {
      version: 21,
      sql: 'CREATE INDEX IF NOT EXISTS "MeetingSegment_meetingId_idx_idx" ON "MeetingSegment"("meetingId", "idx")',
    },
    {
      version: 21,
      sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "MeetingActionItem_issueId_key" ON "MeetingActionItem"("issueId")',
    },
    {
      version: 21,
      sql: 'CREATE INDEX IF NOT EXISTS "MeetingActionItem_meetingId_idx_idx" ON "MeetingActionItem"("meetingId", "idx")',
    },
    // ─── v22: structured decisions + follow-up draft & reminders ───
    // Decisions move out of the JSON `decisions` column into rows so each one
    // can carry a rationale and a date. The old column stays (dropping it would
    // lose data on existing installs); backfillMeetingDecisions() copies it once.
    {
      version: 22,
      sql: `CREATE TABLE IF NOT EXISTS "MeetingDecision" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "meetingId" TEXT NOT NULL,
        "idx" INTEGER NOT NULL,
        "text" TEXT NOT NULL,
        "rationale" TEXT,
        "decidedAt" TEXT,
        "status" TEXT NOT NULL DEFAULT 'active',
        "createdAt" TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        CONSTRAINT "MeetingDecision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
    },
    {
      version: 22,
      sql: 'CREATE INDEX IF NOT EXISTS "MeetingDecision_meetingId_idx_idx" ON "MeetingDecision"("meetingId", "idx")',
    },
    { version: 22, sql: 'ALTER TABLE "Meeting" ADD COLUMN "followUpSubject" TEXT' },
    { version: 22, sql: 'ALTER TABLE "Meeting" ADD COLUMN "followUpBody" TEXT' },
    { version: 22, sql: 'ALTER TABLE "Meeting" ADD COLUMN "followUpStatus" TEXT NOT NULL DEFAULT \'none\'' },
    { version: 22, sql: 'ALTER TABLE "Meeting" ADD COLUMN "followUpAt" TEXT' },
    { version: 22, sql: 'ALTER TABLE "MeetingActionItem" ADD COLUMN "remindedAt" TEXT' },
    {
      version: 22,
      sql: 'CREATE INDEX IF NOT EXISTS "MeetingActionItem_status_dueDate_idx" ON "MeetingActionItem"("status", "dueDate")',
    },
    // ─── v23: chat → knowledge auto-distillation ───
    // KnowledgePage gains provenance so a distilled note can be told apart from
    // a user-written one AND found again for the next merge (sourceId = session).
    { version: 23, sql: 'ALTER TABLE "KnowledgePage" ADD COLUMN "source" TEXT' },
    { version: 23, sql: 'ALTER TABLE "KnowledgePage" ADD COLUMN "sourceId" TEXT' },
    {
      version: 23,
      sql: 'CREATE INDEX IF NOT EXISTS "KnowledgePage_source_sourceId_idx" ON "KnowledgePage"("source", "sourceId")',
    },
    // ChatSession gains the distillation watermark (distillCursor = createdAt of
    // the newest distilled message, copied verbatim), the last-attempt stamp for
    // the backoff, and the per-run accounting.
    { version: 23, sql: 'ALTER TABLE "ChatSession" ADD COLUMN "distillCursor" TEXT' },
    { version: 23, sql: 'ALTER TABLE "ChatSession" ADD COLUMN "distillAt" TEXT' },
    { version: 23, sql: 'ALTER TABLE "ChatSession" ADD COLUMN "distillMeta" TEXT' },
    { version: 23, sql: 'CREATE INDEX IF NOT EXISTS "ChatSession_updatedAt_idx" ON "ChatSession"("updatedAt")' },
    // `whisperModel` used to double as both "what the user asked for" and "what ran",
    // because `startTranscription` wrote the fallback back into it — which pinned a
    // meeting to whatever was on disk that day, permanently. It now records the request
    // only, and this column holds the model that did the work.
    { version: 25, sql: 'ALTER TABLE "Meeting" ADD COLUMN "transcribeModel" TEXT' },
    // ─── v26: external tracker mirroring (Redmine) ───
    // `source`/`sourceId` are KnowledgePage's pair (v23), reused verbatim so both
    // mirrored tables answer "where did this row come from" the same way, and so the
    // merge lookup in routers/redmine.ts has an index with the same shape as the one
    // routers/wiki.ts uses. NULL source = written by this app, which is what every
    // existing row is and what every existing writer keeps writing — the hourly
    // archiver's `source: null` predicate depends on exactly that.
    { version: 26, sql: 'ALTER TABLE "Issue" ADD COLUMN "source" TEXT' },
    { version: 26, sql: 'ALTER TABLE "Issue" ADD COLUMN "sourceId" TEXT' },
    {
      version: 26,
      sql: 'CREATE INDEX IF NOT EXISTS "Issue_source_sourceId_idx" ON "Issue"("source", "sourceId")',
    },
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
  //
  // Skipped whenever the database carries objects Prisma does not model: `global_fts`
  // (6 shadow tables) and `embed_queue` belong to lib/ftsIndex.ts and are NOT NULL, so
  // db push proposes dropping them, warns NonEmptyTableDrop, and — since we deliberately
  // pass no --accept-data-loss — refuses. That refusal is correct, but it used to happen
  // on *every* launch of *every* existing install and be marked as applied anyway, which
  // made the whole function a no-op that looked like a success. On those databases the
  // additive `migrations[]` array above and the self-healing functions in lib/ are the
  // delivery path, so the honest thing is to say so and not spend 60s failing.
  const hasUnmanagedTables = await prisma
    .$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table' AND name='global_fts'")
    .then((rows) => rows.length > 0)
    .catch(() => false);
  if (hasUnmanagedTables) {
    console.warn(
      '[Init] db push skipped: this database carries objects Prisma does not model ' +
        '(global_fts, embed_queue). Schema changes reach it through the additive migration ' +
        'array and the self-healing functions in lib/ — see docs/architecture.md.',
    );
    await prisma.systemConfig.upsert({
      where: { key: 'schemaVersion' },
      create: { key: 'schemaVersion', value: String(SCHEMA_VERSION) },
      update: { value: String(SCHEMA_VERSION) },
    });
    await prisma.systemConfig.deleteMany({ where: { key: 'schemaPushError' } }).catch(() => {});
    return true;
  }

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
    await prisma.systemConfig.deleteMany({ where: { key: 'schemaPushError' } }).catch(() => {});
    return true;
  } catch (e: any) {
    console.error('[Init] db push failed:', e.stderr?.toString() || e.message);
    // Deliberately NOT stamping schemaVersion. Stamping it on failure is what hid the
    // problem above: it made the next launch skip the migration pass entirely, so a
    // push that never worked was indistinguishable from one that did. Leaving the
    // version behind means the pass re-runs, and the flag below makes the failure
    // visible to the UI instead of only to a log nobody reads.
    try {
      await prisma.systemConfig.upsert({
        where: { key: 'schemaPushError' },
        create: {
          key: 'schemaPushError',
          value: String(e.stderr?.toString() || e.message || 'unknown').substring(0, 500),
        },
        update: { value: String(e.stderr?.toString() || e.message || 'unknown').substring(0, 500) },
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

// The FTS5 index used to be created and repopulated here, with `porter unicode61` as
// the tokenizer and an unconditional `INSERT OR IGNORE ... SELECT` on every boot.
// Two problems with that: porter unicode61 treats a run of Han/Kana as ONE token, so
// no Chinese query shorter than the indexed run could ever match; and FTS5 has no
// unique constraint, so the "ignore duplicates" population appended a full copy of the
// corpus on every launch — 498,107 index rows for 1,616 source rows, 95% of the
// database. It now lives in lib/ftsIndex.ts, which re-checks its own preconditions on
// every boot (see the header comment there for why it is deliberately not a versioned
// migration).

// Run DB migration FIRST, then start server (avoids race: query before column exists)
const PORT = parseInt(process.env.API_PORT || '3091', 10);

ensureSchema()
  .then((schemaOk) => {
    if (!schemaOk) {
      console.error('[Init] Schema push failed');
    }
    return ensureSeed();
  })
  // Must stay before startBackgroundTasks() and before listen(): the rebuild runs its
  // DDL in one transaction, and nothing may query global_fts while it is mid-swap.
  .then(() => ensureSearchIndexes())
  // Clock normalisation, also before listen() — the Issue rebuild swaps the table under a
  // transaction and must not race a reader. After ensureSearchIndexes() because that is
  // what owns the fts_issue_* triggers the rebuild has to put back.
  .then(() => ensureClockUtc())
  .then(() => ensureIssueClock())
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
