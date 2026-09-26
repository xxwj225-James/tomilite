import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { isTask, isImported, issueKey } from '../lib/taskScope.js';
import { utcStamp } from '../lib/dbTime.js';
import { TOOLS, riskOf, toolByName, validateArgs, type RiskLevel } from '../mcp/catalogue.js';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import crypto from 'crypto';

// ═══ HITL (Human-in-the-Loop) ═══
// Same design as TomatoHub: risk-gated execution, idempotency, confirm/deny
// Simplified for single-user local: in-memory task store, no Redis needed

type TaskStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'executed';

/** The longest a single call may hold its connection open waiting for a human. */
const MAX_WAIT_MS = 300000;
/** What `mcp.execute` waits when the caller says nothing — unchanged from before. */
const DEFAULT_WAIT_MS = 300000;

/**
 * What the MCP transports wait by default, as opposed to the 5 minutes the plain tRPC
 * route above still uses.
 *
 * MCP clients time a tool call out somewhere near 60s and report a transport failure the
 * model cannot explain, so it is far better to answer "this is waiting for approval"
 * while there is still time for the model to tell the user. `TL_MCP_WAIT_MS` overrides.
 */
export function mcpDefaultWaitMs(): number {
  const raw = Number(process.env.TL_MCP_WAIT_MS);
  if (!Number.isFinite(raw) || raw < 0) return 20000;
  return Math.min(raw, MAX_WAIT_MS);
}

interface HITLTask {
  taskId: string;
  toolName: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  preview: string;
  confirmToken: string;
  idempotencyKey: string;
  hitlMode: string; // 'manual' | 'auto' — for enforcing human-in-the-loop
  auditLogId?: string; // DB record ID — written at pending, updated on approve/deny
  status: TaskStatus;
  result?: unknown;
  createdAt: number;
  expiresAt: number;
}

const hitlTasks = new Map<string, HITLTask>();
const HITL_TIMEOUTS: Record<RiskLevel, number> = {
  read_only: 0,
  low: 300000,
  medium: 600000,
  high: 300000,
}; // low/medium/high: 5/10/5 minutes — enough for human to notice and approve

// TOOL_RISK used to live here — 17 names, two of which no code implemented, and
// `requiredOf` was restated in a third list (`TOOL_REQUIRED`) that had drifted from the
// schemas. All of it now comes from ../mcp/catalogue.js, which is the only place a tool
// is described. Risk is a field on the tool, not a lookup in a parallel table.

function genToken() {
  return Math.random().toString(36).substring(2, 10);
}
function genTaskId() {
  return `hitl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export const mcpRouter = router({
  // ─── List available tools ───
  // Projected from the catalogue, not restated. This procedure feeds the TomiLite UI,
  // which wants the app's own vocabulary (`risk`, and the tool names as written); the
  // MCP transports read the same catalogue through `toMcpTools()`, which drops `risk`
  // and emits protocol `annotations` in its place. Four names were missing from this
  // list before (get_board_status, tools/list, get_task_result, and get_report lacked
  // its required field), because it was hand-maintained alongside two other lists.
  listTools: publicProcedure.query(() => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      risk: t.risk,
      inputSchema: t.inputSchema,
    })),
  })),


  // ─── Execute tool (with HITL gating + API key auth) ───
  //
  // The tRPC face of a tool call. The MCP transports do not come through here — they
  // build a caller and call `executeMcp` in-process (see server.ts) — but the accepted
  // body is identical, so `api_key`, `arguments` and `wait_ms` mean the same thing
  // whichever door the call arrived at.
  execute: publicProcedure
    .input(
      z.object({
        tool: z.string(),
        args: z.record(z.unknown()).optional(),
        arguments: z.record(z.unknown()).optional(), // MCP standard field name
        idempotency_key: z.string().optional(),
        api_key: z.string().optional(),
        // How long to hold the connection open waiting for a human. The MCP shim passes
        // a short one on purpose, so the model gets "pending approval" back inside the
        // client's own tool timeout rather than a transport error it cannot explain.
        wait_ms: z.number().min(0).max(MAX_WAIT_MS).optional(),
      }),
    )
    .mutation(({ input, ctx }) => executeMcp(input, ctx)),


  // ─── Confirm a HITL task (external MCP client) ───
  // Only works in auto mode. In manual mode, the human must approve via UI (confirmById).
  confirm: publicProcedure
    .input(
      z.object({
        taskId: z.string(),
        confirmToken: z.string(),
        api_key: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const task = hitlTasks.get(input.taskId);
      if (!task) return { error: 'Task not found' };
      if (task.status !== 'pending') return { error: `Task already ${task.status}` };
      if (Date.now() > task.expiresAt) {
        task.status = 'expired';
        return { error: 'Task expired' };
      }
      if (input.confirmToken !== task.confirmToken) return { error: 'Invalid confirm token' };

      // HITL enforcement: in manual mode, external confirm is rejected.
      // The human must approve via the TomiLite UI (which calls confirmById).
      // This is what makes it Human-in-the-Loop, not two-phase commit.
      if (task.hitlMode === 'manual') {
        return {
          error: 'Manual mode requires human approval. Please open the TomiLite UI to approve or deny this task.',
          taskId: task.taskId,
        };
      }

      task.status = 'approved';
      const result = await executeTool(task.toolName, task.args);
      task.result = result;
      if (task.auditLogId) await updateAuditLog(task.auditLogId, 'approved', result);
      else await auditLog('approved', task.toolName, task.args, result);
      return { status: 'approved', result, preview: task.preview };
    }),

  // ─── Confirm by task ID only (for TomiLite UI — human clicked Approve) ───
  confirmById: publicProcedure.input(z.object({ taskId: z.string() })).mutation(async ({ input }) => {
    const task = hitlTasks.get(input.taskId);
    if (!task) return { error: 'Task not found' };
    if (task.status !== 'pending') return { error: `Task already ${task.status}` };
    if (Date.now() > task.expiresAt) {
      task.status = 'expired';
      return { error: 'Task expired' };
    }

    task.status = 'approved';
    const result = await executeTool(task.toolName, task.args);
    task.result = result;
    if (task.auditLogId) await updateAuditLog(task.auditLogId, 'approved', result, 'human');
    else await auditLog('approved', task.toolName, task.args, result, undefined, 'human');
    return { status: 'approved', result, preview: task.preview };
  }),

  // ─── Deny a HITL task ───
  deny: publicProcedure
    .input(z.object({ taskId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const task = hitlTasks.get(input.taskId);
      if (!task) return { error: 'Task not found' };
      task.status = 'denied';
      if (task.auditLogId) await updateAuditLog(task.auditLogId, 'denied', { reason: input.reason || 'User denied' });
      else await auditLog('denied', task.toolName, task.args, { reason: input.reason || 'User denied' });
      return { status: 'denied', reason: input.reason || 'User denied' };
    }),

  // ─── Poll task result (MCP client waits for human approval) ───
  getTaskResult: publicProcedure.input(z.object({ taskId: z.string() })).query(async ({ input }) => {
    // Same state machine the `get_task_result` MCP tool uses, so the UI and an agent
    // cannot be told different things about one approval.
    const known = await lookupTaskResult(input.taskId, 0);
    if (!('error' in known)) return known;
    // Fallback: server restarted, look for the taskId in the DB audit trail. Known to
    // be dead — the taskId is never written into `arguments`, so nothing can match — but
    // harmless, and it starts working the day that column is added. See docs/mcp-client.md.
    const dbLog = await prisma.mcpAuditLog.findFirst({
      where: { arguments: { contains: input.taskId } },
      orderBy: { createdAt: 'desc' },
    });
    if (!dbLog) return { error: 'Task not found', status: 'unknown' };
    return {
      status: dbLog.status,
      result: dbLog.result ? JSON.parse(dbLog.result) : null,
      preview: dbLog.arguments?.substring(0, 100),
    };
  }),

  // ─── Audit logs (DB + in-memory fallback for pre-DB-persistence tasks) ───
  listAuditLogs: publicProcedure.input(z.object({ limit: z.number().default(50) })).query(async ({ input }) => {
    // Build a lookup: auditLogId → taskId (for approve/deny to work)
    const auditToTask = new Map<string, string>();
    for (const [taskId, task] of hitlTasks) {
      if (task.auditLogId) auditToTask.set(task.auditLogId, taskId);
    }
    const dbLogs = await prisma.mcpAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: input.limit,
    });
    // Attach _taskId so the UI can send the correct ID for approve/deny
    const enriched = dbLogs.map((log) => ({
      ...log,
      _taskId: auditToTask.get(log.id) || null,
    }));
    // Merge in-memory pending tasks that don't have DB records yet
    const orphans: any[] = [];
    for (const [taskId, task] of hitlTasks) {
      if (task.status === 'pending' && !task.auditLogId && Date.now() < task.expiresAt) {
        orphans.push({
          id: `mem-${taskId}`,
          toolName: task.toolName,
          arguments: task.preview,
          status: 'pending',
          result: null,
          confirmedBy: '',
          issueKey: null,
          agentName: 'external',
          apiKeyName: null,
          createdAt: new Date(task.createdAt),
          _taskId: taskId,
        });
      }
    }
    orphans.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return [...orphans, ...enriched].slice(0, input.limit);
  }),

  auditStats: publicProcedure.query(async () => {
    const [total, executed, pending] = await Promise.all([
      prisma.mcpAuditLog.count(),
      prisma.mcpAuditLog.count({ where: { status: { in: ['executed', 'approved'] } } }),
      prisma.mcpAuditLog.count({ where: { status: 'pending' } }),
    ]);
    return { total, executed, denied: total - executed - pending, pending };
  }),

  // ─── Pending count (for notification badge) ───
  pendingCount: publicProcedure.query(async () => {
    // Filter expired: DB rows older than max timeout (10 min) are stale. A UTC stamp,
    // matching the column — an ISO `Z` string never compared equal to it. See dbTime.ts.
    const cutoff = utcStamp(new Date(Date.now() - 600000));
    const count = await prisma.mcpAuditLog.count({
      where: { status: 'pending', createdAt: { gte: cutoff } },
    });
    // Also count in-memory tasks (race: task may be pending in memory but DB write still in-flight)
    let memCount = 0;
    for (const [, task] of hitlTasks) {
      if (task.status === 'pending' && Date.now() < task.expiresAt) memCount++;
    }
    return { count: Math.max(count, memCount) };
  }),

  // ─── Where the stdio shim lives, for the setup instructions ───
  //
  // Both paths have to be DETECTED, never hardcoded. The installer is per-user with a
  // user-chosen directory (`perMachine:false` + `allowToChangeInstallationDirectory`),
  // so there is no fixed install root — the only process that knows is this one.
  transportInfo: publicProcedure.query(() => {
    // `electron` is present in process.versions whenever the runtime is the app binary,
    // including the ELECTRON_RUN_AS_NODE child that runs this API. Under plain `node`
    // (a dev run) it is absent, and the executable is node.exe — which cannot run the
    // bundled shim the way a user needs, so we say so rather than hand out a bad path.
    const isAppBinary = !!process.versions.electron;
    const exePath = isAppBinary ? process.execPath : null;

    // Same expression server.ts listens with, so this can never report a port the
    // server is not actually on.
    const apiPort = process.env.API_PORT || '3091';

    // __dirname is `apps/api/dist` in the bundle and `apps/api/src` under tsx.
    const shimPath =
      basename(__dirname) === 'dist' ? join(__dirname, 'mcp-stdio.cjs') : join(__dirname, 'mcp', 'stdio.ts');
    return {
      apiPort,
      appVersion: process.env.TL_APP_VERSION || '',
      exePath,
      shimPath,
      shimBuilt: existsSync(shimPath),
      /** False in a dev run: the instructions below cannot be followed as written. */
      ready: !!exePath && existsSync(shimPath),
    };
  }),

  // ─── List pending HITL tasks ───
  listPending: publicProcedure.query(() => {
    return { pending: listPendingTasks() };
  }),
});

// ═══ The tool-call pipeline ═══
//
// Extracted from the `mcp.execute` procedure so the MCP transports can reach it without
// re-entering tRPC over HTTP. That is not a convenience: the HITL queue and the audit
// log live in THIS process's memory, so a caller that ran a second copy of the tool
// logic elsewhere could never see a human's approval arrive. One process, one queue.

export interface McpCallContext {
  /** From the `X-Api-Key` header, for callers that keep the key out of the body. */
  xApiKey?: string;
}

export interface McpCallInput {
  tool: string;
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  idempotency_key?: string;
  api_key?: string;
  wait_ms?: number;
}

/**
 * One tool call end to end: authenticate, authorize, apply the risk policy, wait for a
 * human if the risk demands one, execute, audit.
 *
 * Returns plain data, always — failures are data in this codebase, never throws. It has
 * no idea JSON-RPC exists; `../mcp/dispatch.js` is what turns the return value into a
 * tool result for an MCP client.
 */
export async function executeMcp(
  input: McpCallInput,
  ctx: McpCallContext,
): Promise<Record<string, unknown>> {
  const { tool, args, arguments: argsAlt, idempotency_key, api_key } = input;
  // Accept api_key from body OR X-Api-Key header (standard MCP protocol)
  const apiKey = api_key || ctx.xApiKey;
  if (!apiKey) return { error: 'Missing api_key. Include it in the request body or X-Api-Key header.' };

  // Unknown tools are rejected here, before any approval task exists. They used to queue
  // a real human approval and only then answer "Unknown tool" — for tools that had no
  // implementation at all. The MCP dispatcher rejects them even earlier, as a protocol
  // error; this guard covers the direct HTTP/tRPC callers.
  if (!toolByName(tool)) {
    return { error: `Unknown tool: ${tool}`, tool, hint: 'Call tools/list for the catalogue.' };
  }

  // Accept both args (non-standard) and arguments (MCP protocol).
  // Use Object.keys check — {} is truthy and would swallow real args data.
  const a = (argsAlt && Object.keys(argsAlt).length > 0 ? argsAlt : args || {}) as Record<string, any>;
  const risk = riskOf(tool) ?? 'medium';
  const hasArgs = Object.keys(a).length > 0;

  // Required fields are read from the tool's own schema, not from a second hand-kept
  // list. That list omitted `get_report.id`, so a call without `id` reached
  // `findUnique({ where: { id: undefined } })` and surfaced as a 500.
  const missing = validateArgs(tool, a);
  if (missing) {
    return {
      error: `Missing required field: ${missing}`,
      tool,
      hint: 'Use tools/list to see required parameters for each tool',
    };
  }

  // Bug 2: when args is empty (e.g. shell IFS eats the JSON), skip idempotency
  // otherwise every call with {} collides on the same tool:{} key
  const idemKey = idempotency_key || (hasArgs ? `${tool}:${JSON.stringify(a)}` : `${tool}:${genTaskId()}`);

  // Verify API key
  const keyHash = crypto.createHash('sha256').update(apiKey.trim()).digest('hex');
  const apiKeyData = await prisma.apiKey.findFirst({ where: { keyHash, isActive: true } });
  if (!apiKeyData) return { error: 'Invalid or inactive API key' };
  // Update usage
  await prisma.apiKey.update({
    where: { id: apiKeyData.id },
    data: { lastUsedAt: new Date().toISOString(), useCount: (apiKeyData.useCount || 0) + 1 },
  });

  // `scopes` was stored, shown in the API-keys table, and never read anywhere: a key
  // issued as "read" could call delete_issue. The column default is 'read,write', so
  // every key that already exists keeps working exactly as before.
  const scopes = String(apiKeyData.scopes || 'read,write')
    .split(',')
    .map((s) => s.trim());
  if (risk !== 'read_only' && !scopes.includes('write')) {
    return {
      error: `API key "${apiKeyData.name}" is read-only and cannot call ${tool}.`,
      hint: 'Grant it write scope in TomiLite → Settings → API Keys.',
    };
  }

  // Determine HITL behavior
  const hitlMode = apiKeyData.hitlMode || 'manual'; // default manual

  // Check idempotency — same key returns existing task (skip when args empty)
  if (hasArgs || idempotency_key) {
    for (const [, task] of hitlTasks) {
      if (task.idempotencyKey === idemKey && task.status !== 'expired') {
        return {
          status: task.status,
          taskId: task.taskId,
          tool: task.toolName,
          preview: task.preview,
          // `result` belongs here, and its absence was a live bug: a retry after an
          // approval reported "completed" with no answer in it. Because read-only calls
          // were also filed as tasks, simply repeating the same read returned nothing.
          result: task.result,
          message: 'Task already submitted (idempotent)',
        };
      }
    }
  }

  const preview = `🔧 ${tool}: ${JSON.stringify(a).substring(0, 100)}`;
  const taskId = genTaskId();

  // read_only → execute directly, no HITL, and retain no task: a read that answers the
  // same way on every call is the entire point. Keeping it only ever broke the retry.
  // The `taskId` still comes back for callers that log it, but it names nothing —
  // get_task_result will say so rather than pretend there is a result waiting.
  if (risk === 'read_only') {
    const result = await executeTool(tool, a);
    await auditLog('executed', tool, a, result, apiKeyData);
    return { status: 'executed', taskId, result, preview };
  }

  const task: HITLTask = {
    taskId,
    toolName: tool,
    args: a,
    risk,
    preview,
    confirmToken: genToken(),
    idempotencyKey: idemKey,
    hitlMode,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + (HITL_TIMEOUTS[risk] || DEFAULT_WAIT_MS),
  };

  // Auto mode: everything runs without asking. Manual mode: a write needs the human.
  if ((hitlMode as string) === 'auto') {
    const result = await executeTool(tool, a);
    task.status = 'approved';
    task.result = result;
    hitlTasks.set(taskId, task);
    await auditLog('executed', tool, a, result, apiKeyData);
    return { status: 'completed', taskId, result, preview, mode: 'auto' };
  }

  // Writes require confirmation. Write the audit row first, so the trail exists even if
  // this process dies before the human answers.
  hitlTasks.set(taskId, task);
  try {
    const pendingRecord = await auditLog('pending', tool, a, null, apiKeyData);
    task.auditLogId = pendingRecord.id;
  } catch (err) {
    console.error('[HITL] Failed to write pending audit log:', (err as Error).message);
  }
  // Best-effort desktop notification, so the user knows something is waiting.
  try {
    await fetch('http://localhost:3191/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'TomiLite — Pending Approval', body: preview }),
    });
  } catch {
    /* notification server may not be running */
  }

  return waitForDecision(task, input.wait_ms ?? DEFAULT_WAIT_MS);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Waits for the human, up to `waitMs`, and reports what happened.
 *
 * A timeout deliberately does NOT expire the task. The request is still sitting in the
 * MCP panel and the human may approve it a minute later, at which point `confirmById`
 * performs the action itself and stores the result — so an approval is never wasted
 * just because the caller stopped waiting. Expiry belongs to the task's own `expiresAt`,
 * not to how long one caller was willing to hold a connection.
 */
async function waitForDecision(task: HITLTask, waitMs: number): Promise<Record<string, unknown>> {
  const budget = Math.max(0, Math.min(waitMs, MAX_WAIT_MS));
  const deadline = Date.now() + budget;
  for (;;) {
    const current = hitlTasks.get(task.taskId);
    if (!current) return { error: 'Task lost', status: 'error' };
    if (current.status === 'approved' || current.status === 'executed') {
      return { status: 'completed', taskId: task.taskId, tool: current.toolName, result: current.result, preview: current.preview };
    }
    if (current.status === 'denied') {
      return { status: 'denied', taskId: task.taskId, tool: current.toolName, preview: current.preview };
    }
    if (current.status === 'expired' || Date.now() > current.expiresAt) {
      current.status = 'expired';
      return {
        status: 'expired',
        taskId: task.taskId,
        tool: current.toolName,
        preview: current.preview,
        error: 'The approval window closed before anyone answered',
      };
    }
    if (Date.now() >= deadline) {
      return {
        status: 'pending',
        taskId: task.taskId,
        tool: current.toolName,
        risk: current.risk,
        preview: current.preview,
        expiresAt: current.expiresAt,
        error: `Still waiting for approval after ${Math.round(budget / 1000)}s`,
      };
    }
    await sleep(500);
  }
}

/**
 * Where an approval got to. The state machine behind both the `get_task_result` tool and
 * the `getTaskResult` query the UI uses, so the two cannot answer differently.
 */
export async function lookupTaskResult(taskId: string, waitMs = 0): Promise<Record<string, unknown>> {
  const budget = Math.max(0, Math.min(waitMs, MAX_WAIT_MS));
  const deadline = Date.now() + budget;
  for (;;) {
    const task = hitlTasks.get(taskId);
    if (!task) {
      return {
        error:
          `No approval task "${taskId}" is known to this process. Pending approvals are held in ` +
          'memory and do not survive a TomiLite restart, and read-only calls are never filed as ' +
          'approvals at all.',
        taskId,
      };
    }
    if (task.status === 'approved' || task.status === 'executed') {
      return { status: task.status, taskId, tool: task.toolName, result: task.result, preview: task.preview };
    }
    if (task.status === 'denied') {
      return { status: 'denied', taskId, tool: task.toolName, preview: task.preview };
    }
    if (task.status === 'expired' || Date.now() > task.expiresAt) {
      if (task.status === 'pending') task.status = 'expired';
      return { status: 'expired', taskId, tool: task.toolName, preview: task.preview };
    }
    if (Date.now() >= deadline) {
      return { status: 'pending', taskId, tool: task.toolName, preview: task.preview, expiresAt: task.expiresAt };
    }
    await sleep(500);
  }
}

/**
 * Expires approvals whose window has closed, and forgets answered ones old enough that
 * the DB audit log is the only record anyone will want. Called every 60s from
 * `startBackgroundTasks()`. The sweep that used to run inside the execute path only ever
 * fired when somebody happened to be calling a tool.
 */
export function sweepHitlTasks(): number {
  const now = Date.now();
  let expired = 0;
  for (const [id, task] of hitlTasks) {
    if (task.status === 'pending' && now > task.expiresAt) {
      task.status = 'expired';
      expired++;
    } else if (task.status !== 'pending' && now > task.expiresAt + 3_600_000) {
      hitlTasks.delete(id);
    }
  }
  return expired;
}

/**
 * The pending approvals right now, for the MCP panel and the badge. Shared with the
 * transports so an agent asking "what is waiting?" sees the same list the human does.
 */
export function listPendingTasks(): Array<{ taskId: string; tool: string; preview: string; risk: RiskLevel; expiresIn: number }> {
  const pending: Array<{ taskId: string; tool: string; preview: string; risk: RiskLevel; expiresIn: number }> = [];
  const now = Date.now();
  for (const [, task] of hitlTasks) {
    if (task.status === 'pending' && now < task.expiresAt) {
      pending.push({
        taskId: task.taskId,
        tool: task.toolName,
        preview: task.preview,
        risk: task.risk,
        expiresIn: Math.floor((task.expiresAt - now) / 1000),
      });
    }
  }
  return pending;
}


// ─── Audit helper ───
async function auditLog(
  status: string,
  tool: string,
  args: Record<string, any>,
  result: any,
  apiKeyData?: any,
  confirmedBy?: string,
) {
  const record = await prisma.mcpAuditLog.create({
    data: {
      toolName: tool,
      arguments: JSON.stringify(args).substring(0, 1000),
      status,
      // Explicit, because the column default is localtime — see lib/dbTime.ts. Rows born
      // from it read 8h ahead of the UTC cutoff `pendingCount` filters with, so the
      // staleness filter never dropped anything.
      createdAt: utcStamp(),
      result: result ? JSON.stringify(result).substring(0, 500) : (null as any),
      confirmedBy: confirmedBy || 'system',
      issueKey: result?.key || (null as any),
      agentName: apiKeyData?.name ? `api:${apiKeyData.name}` : 'external',
      apiKeyName: apiKeyData?.name || (null as any),
    },
  });
  return record;
}

async function updateAuditLog(id: string, status: string, result: any, confirmedBy?: string) {
  await prisma.mcpAuditLog.update({
    where: { id },
    data: {
      status,
      result: result ? JSON.stringify(result).substring(0, 500) : (null as any),
      confirmedBy: confirmedBy || 'system',
    },
  });
}

// ═══ Tool executors ═══
async function executeTool(tool: string, args: Record<string, any>) {
  switch (tool) {
    case 'tools/list': {
      // A TOOL named `tools/list`, colliding by design with the JSON-RPC method of the
      // same name — kept because the pre-MCP HTTP surface documented in Settings → API
      // Keys passes tool *names*, and this is one of the names it passes. Projected from
      // the catalogue so it cannot fall behind again: the hand-written copy here was
      // already missing three tools.
      return { tools: TOOLS.map((t) => ({ name: t.name, description: t.description })) };
    }
    case 'get_task_result': {
      // Poll a pending approval. `waitMs` lets an agent hold on rather than spin — the
      // MCP shim's budget, not this tool's, decides how long that is.
      const waitMs = Math.max(0, Math.min(Number(args.waitMs) || 0, MAX_WAIT_MS));
      return lookupTaskResult(String(args.taskId), waitMs);
    }
    case 'create_issue': {
      const maxNum = await prisma.issue.aggregate({
        where: { projectId: 'proj-default' },
        _max: { issueNumber: true },
      });
      const now = utcStamp();
      const issue = await prisma.issue.create({
        data: {
          projectId: 'proj-default',
          issueNumber: (maxNum._max.issueNumber ?? 0) + 1,
          title: args.title,
          type: args.type || 'task',
          priority: args.priority || 'medium',
          description: args.description || null,
          storyPoints: args.storyPoints || null,
          status: 'todo',
          createdAt: now,
          updatedAt: now,
        },
      });
      return { key: issueKey(issue), title: issue.title, type: issue.type, status: issue.status };
    }
    case 'list_issues': {
      const where: any = { projectId: 'proj-default' };
      if (args.status) where.status = args.status;
      const issues = await prisma.issue.findMany({ where, orderBy: { createdAt: 'desc' }, take: args.limit || 20 });
      return issues.map((i) => ({
        key: issueKey(i),
        title: i.title,
        status: i.status,
        priority: i.priority,
      }));
    }
    case 'get_issue': {
      if (args.issueNumber) {
        const issue = await prisma.issue.findFirst({
          where: { projectId: 'proj-default', issueNumber: args.issueNumber },
        });
        if (!issue) return { error: `TL-${args.issueNumber} not found` };
        return {
          key: issueKey(issue),
          title: issue.title,
          status: issue.status,
          priority: issue.priority,
          type: issue.type,
          description: issue.description || '',
          storyPoints: issue.storyPoints,
          dueDate: issue.dueDate,
          createdAt: issue.createdAt,
        };
      }
      if (args.query) {
        const issues = await prisma.issue.findMany({
          where: { projectId: 'proj-default', title: { contains: args.query } },
          orderBy: { createdAt: 'desc' },
          take: args.limit || 5,
        });
        return issues.map((i) => ({
          key: issueKey(i),
          title: i.title,
          status: i.status,
          priority: i.priority,
          type: i.type,
          description: (i.description || '').substring(0, 300),
          dueDate: i.dueDate,
        }));
      }
      return { error: 'Provide issueNumber or query' };
    }
    case 'update_issue': {
      const issue = await prisma.issue.findFirst({
        where: { projectId: 'proj-default', issueNumber: args.issueNumber },
      });
      if (!issue) return { error: `TL-${args.issueNumber} not found` };
      // This is a second, independent implementation of the agent's update_issue, and
      // the easiest of the four write paths to forget. Mirrored rows are read-only.
      if (isImported(issue)) return { error: `${issueKey(issue)} is mirrored from Redmine and is read-only here` };
      const data: any = {};
      if (args.title) data.title = args.title;
      if (args.status) data.status = args.status;
      if (args.priority) data.priority = args.priority;
      if (args.description !== undefined) data.description = args.description;
      await prisma.issue.update({ where: { id: issue.id }, data });
      return { key: issueKey(issue), updated: true };
    }
    case 'delete_issue': {
      const issue = await prisma.issue.findFirst({
        where: { projectId: 'proj-default', issueNumber: args.issueNumber },
      });
      if (!issue) return { error: `TL-${args.issueNumber} not found` };
      // Deleting would not stick — the next sync re-creates the row.
      if (isImported(issue)) return { error: `${issueKey(issue)} is mirrored from Redmine — detach it in the task board first` };
      await prisma.issue.delete({ where: { id: issue.id } });
      return { key: issueKey(issue), deleted: true };
    }
    case 'get_project_stats': {
      // Same set Home and the task board count, so the agent does not tell the user
      // a different number than the UI shows. See lib/taskScope.ts.
      const issues = (await prisma.issue.findMany({ where: { projectId: 'proj-default' } })).filter(isTask);
      return {
        total: issues.length,
        todo: issues.filter((i) => i.status === 'todo').length,
        inProgress: issues.filter((i) => ['in_progress', 'in_review'].includes(i.status)).length,
        done: issues.filter((i) => i.status === 'done').length,
      };
    }
    case 'create_report': {
      // Both stamps explicitly — the column defaults are localtime. See lib/dbTime.ts.
      const createdAt = utcStamp();
      const report = await prisma.report.create({
        data: {
          projectId: 'proj-default',
          reportType: args.reportType || 'daily',
          title: args.title,
          content: args.content,
          status: 'draft',
          createdAt,
          generatedAt: createdAt,
        },
      });
      return { id: report.id, title: report.title, reportType: report.reportType, status: report.status };
    }
    case 'update_report': {
      const existing = await prisma.report.findUnique({ where: { id: args.id } });
      if (!existing) return { error: `Report not found: ${args.id}` };
      const data: any = {};
      if (args.title !== undefined) data.title = args.title;
      if (args.content !== undefined) data.content = args.content;
      const updated = await prisma.report.update({ where: { id: args.id }, data });
      return { id: updated.id, title: updated.title, reportType: updated.reportType, status: updated.status };
    }
    case 'create_note': {
      const now = utcStamp();
      const note = await prisma.knowledgePage.create({
        data: {
          projectId: 'proj-default',
          title: args.title || 'Untitled',
          content: args.content || '',
          category: args.category || 'general',
          createdAt: now,
          updatedAt: now,
        },
      });
      return { id: note.id, title: note.title, category: note.category };
    }
    case 'update_note': {
      const existing = await prisma.knowledgePage.findUnique({ where: { id: args.id } });
      if (!existing) return { error: `Note ${args.id} not found` };
      const data: any = {};
      if (args.title !== undefined) data.title = args.title;
      if (args.content !== undefined) data.content = args.content;
      if (args.category !== undefined) data.category = args.category;
      const updated = await prisma.knowledgePage.update({ where: { id: args.id }, data });
      return { id: updated.id, title: updated.title, category: updated.category };
    }
    case 'search_notes': {
      const pages = await prisma.knowledgePage.findMany({
        where: {
          projectId: 'proj-default',
          OR: [{ title: { contains: args.query } }, { content: { contains: args.query } }],
        },
        take: 10,
      });
      return pages.map((p) => ({ title: p.title, snippet: (p.content || '').substring(0, 200) }));
    }
    case 'list_notes': {
      const nWhere: any = { projectId: 'proj-default' };
      if (args.query) nWhere.title = { contains: args.query };
      const pages = await prisma.knowledgePage.findMany({
        where: nWhere,
        orderBy: { updatedAt: 'desc' },
        take: args.limit || 20,
      });
      return pages.map((p) => ({
        id: p.id,
        title: p.title,
        category: p.category,
        snippet: (p.content || '').substring(0, 200),
      }));
    }
    case 'get_report': {
      const report = await prisma.report.findUnique({ where: { id: args.id } });
      if (!report) return { error: 'Report not found' };
      return {
        id: report.id,
        title: report.title,
        content: report.content || '',
        reportType: report.reportType,
        status: report.status,
      };
    }
    case 'get_board_status': {
      // Declared in the old TOOL_RISK table and never implemented: a call queued a
      // read-only approval that resolved instantly and then answered "Unknown tool".
      // Shaped after board.getBoard, projected down to what a model can use.
      const board = await prisma.board.findFirst({
        where: { projectId: 'proj-default' },
        include: {
          columns: {
            orderBy: { sortOrder: 'asc' },
            include: { cards: { orderBy: { position: 'asc' }, include: { issue: true } } },
          },
        },
      });
      if (!board) return { error: 'No board configured' };
      return {
        board: board.name,
        columns: board.columns.map((col) => ({
          name: col.name,
          wipLimit: col.wipLimit,
          count: col.cards.length,
          cards: col.cards.map((card) => ({
            key: issueKey(card.issue),
            title: card.issue.title,
            status: card.issue.status,
          })),
        })),
      };
    }
    case 'get_focus_status': {
      const user = await prisma.user.findFirst();
      return { focusState: user?.focusState || 'available', focusScore: user?.focusScore || 0 };
    }
    default:
      return { error: `Unknown tool: ${tool}` };
  }
}
