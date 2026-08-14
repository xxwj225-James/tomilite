import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';
import crypto from 'crypto';

// ═══ HITL (Human-in-the-Loop) ═══
// Risk-gated execution, idempotency, confirm/deny
// Simplified for single-user local: in-memory task store, no Redis needed

type RiskLevel = 'read_only' | 'low' | 'medium' | 'high';
type TaskStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'executed';

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
  read_only: 0, low: 300000, medium: 600000, high: 300000,
}; // low/medium/high: 5/10/5 minutes — enough for human to notice and approve

// Risk levels per tool
const TOOL_RISK: Record<string, RiskLevel> = {
  'tools/list': 'read_only',
  create_issue: 'low',
  update_issue: 'medium',
  list_issues: 'read_only',
  get_issue: 'read_only',
  get_project_stats: 'read_only',
  get_board_status: 'read_only',
  search_notes: 'read_only',
  get_focus_status: 'read_only',
  create_report: 'low',
  update_report: 'medium',
  create_note: 'low',
  update_note: 'medium',
  list_notes: 'read_only',
  get_report: 'read_only',
  delete_issue: 'high',
  update_settings: 'medium',
};

function genToken() { return Math.random().toString(36).substring(2, 10); }
function genTaskId() { return `hitl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`; }

// Verify API key from header
function hashKey(rawKey: string) {
  return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
}

export const mcpRouter = router({
  // ─── List available tools ───
  listTools: publicProcedure.query(() => ({
    tools: [
      {
        name: 'create_issue', description: 'Create a new issue/task',
        risk: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            type: { type: 'string', enum: ['task', 'bug', 'story', 'feature', 'epic'], default: 'task' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
            description: { type: 'string' },
            storyPoints: { type: 'number' },
          },
          required: ['title'],
        },
      },
      {
        name: 'list_issues', description: 'List project issues',
        risk: 'read_only',
        inputSchema: {
          type: 'object',
          properties: { status: { type: 'string' }, limit: { type: 'number', default: 20 } },
        },
      },
      {
        name: 'get_issue', description: 'Get issue by number (TL-3) or fuzzy search by title keyword. Returns full details including description.',
        risk: 'read_only',
        inputSchema: {
          type: 'object',
          properties: { issueNumber: { type: 'number', description: 'Issue number e.g. 3 for TL-3' }, query: { type: 'string', description: 'Search by title keyword' } },
        },
      },
      {
        name: 'update_issue', description: 'Update issue title/status/priority/description',
        risk: 'medium',
        inputSchema: {
          type: 'object',
          properties: {
            issueNumber: { type: 'number' },
            title: { type: 'string', description: 'New title for the issue' },
            status: { type: 'string', enum: ['todo', 'in_progress', 'in_review', 'done'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            description: { type: 'string', description: 'Updated description (markdown supported)' },
          },
          required: ['issueNumber'],
        },
      },
      {
        name: 'get_project_stats', description: 'Project statistics',
        risk: 'read_only',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'search_notes', description: 'Search knowledge base',
        risk: 'read_only',
        inputSchema: {
          type: 'object', properties: { query: { type: 'string' } }, required: ['query'],
        },
      },
      {
        name: 'list_notes', description: 'List all knowledge base notes. Returns id, title, category, and content snippet.',
        risk: 'read_only',
        inputSchema: {
          type: 'object', properties: { query: { type: 'string', description: 'Optional search keyword' }, limit: { type: 'number', default: 20 } },
        },
      },
      {
        name: 'get_report', description: 'Get full content of a report by ID. Use after list_reports.',
        risk: 'read_only',
        inputSchema: {
          type: 'object', properties: { id: { type: 'string', description: 'Report ID (UUID)' } }, required: ['id'],
        },
      },
      {
        name: 'get_focus_status', description: 'Current developer focus state',
        risk: 'read_only',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'create_report', description: 'Create a new daily/weekly report',
        risk: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            reportType: { type: 'string', enum: ['daily', 'weekly'], default: 'daily' },
            title: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'update_report', description: 'Update an existing report',
        risk: 'medium',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Report ID' },
            title: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['id'],
        },
      },
      {
        name: 'create_note', description: 'Create a new note/wiki page',
        risk: 'low',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            category: { type: 'string', enum: ['general', 'architecture', 'api_docs', 'runbook'], default: 'general' },
          },
          required: ['title'],
        },
      },
      {
        name: 'update_note', description: 'Update an existing note',
        risk: 'medium',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note ID' },
            title: { type: 'string' },
            content: { type: 'string' },
            category: { type: 'string', enum: ['general', 'architecture', 'api_docs', 'runbook'] },
          },
          required: ['id'],
        },
      },
      {
        name: 'delete_issue', description: 'Delete an issue ⚠️ irreversible',
        risk: 'high',
        inputSchema: {
          type: 'object', properties: { issueNumber: { type: 'number' } }, required: ['issueNumber'],
        },
      },
    ],
  })),

  // ─── Execute tool (with HITL gating + API key auth) ───
  execute: publicProcedure
    .input(z.object({
      tool: z.string(),
      args: z.record(z.unknown()).optional(),
      arguments: z.record(z.unknown()).optional(), // MCP standard field name
      idempotency_key: z.string().optional(),
      api_key: z.string().optional(), }))
    .mutation(async ({ input, ctx }) => {
      const { tool, args, arguments: argsAlt, idempotency_key, api_key } = input;
      // Accept api_key from body OR X-Api-Key header (standard MCP protocol)
      const apiKey = api_key || ctx.xApiKey;
      if (!apiKey) return { error: 'Missing api_key. Include it in the request body or X-Api-Key header.' };
      // Accept both args (non-standard) and arguments (MCP protocol).
      // Use Object.keys check — {} is truthy and would swallow real args data.
      const a = (argsAlt && Object.keys(argsAlt).length > 0 ? argsAlt : args || {}) as Record<string, any>;
      const risk = TOOL_RISK[tool] || 'medium';
      const hasArgs = Object.keys(a).length > 0;
      // Validate required fields per tool
      const TOOL_REQUIRED: Record<string, string[]> = {
        create_issue: ['title'],
        create_note: ['title'],
        create_report: ['title', 'content'],
        update_issue: ['issueNumber'],
        update_note: ['id'],
        update_report: ['id'],
        delete_issue: ['issueNumber'],
        search_notes: ['query'],
      };
      const required = TOOL_REQUIRED[tool];
      if (required) {
        for (const field of required) {
          if (a[field] === undefined || a[field] === null || (typeof a[field] === 'string' && !a[field].trim())) {
            return { error: `Missing required field: ${field}`, tool, hint: 'Use tools/list to see required parameters for each tool' };
          }
        }
      }

      // Bug 2: when args is empty (e.g. shell IFS eats the JSON), skip idempotency
      // otherwise every call with {} collides on the same tool:{} key
      const idemKey = idempotency_key || (hasArgs ? `${tool}:${JSON.stringify(a)}` : `${tool}:${genTaskId()}`);

      // Verify API key
      let apiKeyData: any = null;
      const keyHash = crypto.createHash('sha256').update(apiKey.trim()).digest('hex');
      apiKeyData = await prisma.apiKey.findFirst({ where: { keyHash, isActive: true } });
      if (!apiKeyData) return { error: 'Invalid or inactive API key' };
      // Update usage
      await prisma.apiKey.update({ where: { id: apiKeyData.id }, data: { lastUsedAt: new Date().toISOString(), useCount: (apiKeyData.useCount || 0) + 1 } });

      // Determine HITL behavior
      const hitlMode = apiKeyData?.hitlMode || 'manual'; // default manual

      // Check idempotency — same key returns existing task (skip when args empty)
      if (hasArgs || idempotency_key) {
        for (const [, task] of hitlTasks) {
          if (task.idempotencyKey === idemKey && task.status !== 'expired') {
            return { status: task.status, taskId: task.taskId, preview: task.preview, message: 'Task already submitted (idempotent)' };
          }
        }
      }

      const preview = `🔧 ${tool}: ${JSON.stringify(a).substring(0, 100)}`;
      const taskId = genTaskId();
      const confirmToken = genToken();

      const task: HITLTask = {
        taskId, toolName: tool, args: a, risk, preview, confirmToken,
        idempotencyKey: idemKey, hitlMode, status: 'pending',
        createdAt: Date.now(),
        expiresAt: Date.now() + (HITL_TIMEOUTS[risk] || 300000),
      };

      // read_only → execute directly, no HITL
      if (risk === 'read_only') {
        const result = await executeTool(tool, a);
        task.status = 'executed';
        task.result = result;
        hitlTasks.set(taskId, task);
        await auditLog('executed', tool, a, result, apiKeyData);
        return { status: 'executed', taskId, result, preview };
      }

      // Manual mode: any write (non-read_only) requires confirmation
      // Auto mode: everything auto-executed
      const shouldAutoApprove = (hitlMode as string) === 'auto' || (risk as string) === 'read_only';
      if (shouldAutoApprove) {
        const result = await executeTool(tool, a);
        task.status = 'approved';
        task.result = result;
        hitlTasks.set(taskId, task);
        await auditLog('executed', tool, a, result, apiKeyData);
        return { status: 'completed', taskId, result, preview, mode: hitlMode === 'auto' ? 'auto' : 'low_risk' };
      }

      // Write require confirmation (HITL) — pending tasks to DB for audit visibility
      hitlTasks.set(taskId, task);
      try {
        const pendingRecord = await auditLog('pending', tool, a, null, apiKeyData);
        task.auditLogId = pendingRecord.id;
      } catch (err) {
        console.error('[HITL] Failed to write pending audit log:', (err as Error).message);
      }
      // Send system notification so user knows there's a pending approval
      try {
        await fetch('http://localhost:3191/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'TomiLite — Pending Approval', body: preview }),
        });
      } catch { /* notification server may not be running */ }

      // Clean expired tasks periodically
      for (const [tid, t] of hitlTasks) {
        if (Date.now() > t.expiresAt && t.status === 'pending') t.status = 'expired';
      }

      // Long-poll: wait for human approval (max 5 min, check every 1s)
      const pollStart = Date.now();
      const pollTimeout = 300000; // 5 min
      while (Date.now() - pollStart < pollTimeout) {
        const current = hitlTasks.get(taskId);
        if (!current) return { error: 'Task lost', status: 'error' };
        if (current.status === 'approved' || current.status === 'executed') {
          return { status: 'completed', taskId, result: current.result, preview, mode: 'manual' };
        }
        if (current.status === 'denied') return { status: 'denied', taskId, preview };
        if (current.status === 'expired' || Date.now() > current.expiresAt) {
          current.status = 'expired';
          return { status: 'expired', taskId, preview };
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      return { status: 'expired', taskId, preview, error: 'Approval timeout (5 min)' };
    }),

  // ─── Confirm a HITL task (external MCP client) ───
  // Only works in auto mode. In manual mode, the human must approve via UI (confirmById).
  confirm: publicProcedure
    .input(z.object({
      taskId: z.string(),
      confirmToken: z.string(),
      api_key: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const task = hitlTasks.get(input.taskId);
      if (!task) return { error: 'Task not found' };
      if (task.status !== 'pending') return { error: `Task already ${task.status}` };
      if (Date.now() > task.expiresAt) { task.status = 'expired'; return { error: 'Task expired' }; }
      if (input.confirmToken !== task.confirmToken) return { error: 'Invalid confirm token' };

      // HITL enforcement: in manual mode, external confirm is rejected.
      // The human must approve via the TomiLite UI (which calls confirmById).
      // This is what makes it Human-in-the-Loop, not two-phase commit.
      if (task.hitlMode === 'manual') {
        return { error: 'Manual mode requires human approval. Please open the TomiLite UI to approve or deny this task.', taskId: task.taskId };
      }

      task.status = 'approved';
      const result = await executeTool(task.toolName, task.args);
      task.result = result;
      if (task.auditLogId) await updateAuditLog(task.auditLogId, 'approved', result);
      else await auditLog('approved', task.toolName, task.args, result);
      return { status: 'approved', result, preview: task.preview };
    }),

  // ─── Confirm by task ID only (for TomiLite UI — human clicked Approve) ───
  confirmById: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const task = hitlTasks.get(input.taskId);
      if (!task) return { error: 'Task not found' };
      if (task.status !== 'pending') return { error: `Task already ${task.status}` };
      if (Date.now() > task.expiresAt) { task.status = 'expired'; return { error: 'Task expired' }; }

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
  getTaskResult: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input }) => {
      const task = hitlTasks.get(input.taskId);
      if (task) {
        if (task.status === 'approved' || task.status === 'executed') {
          return { status: task.status, result: task.result, preview: task.preview };
        }
        if (task.status === 'denied') return { status: 'denied', preview: task.preview };
        if (task.status === 'expired' || Date.now() > task.expiresAt) {
          if (task.status === 'pending') task.status = 'expired';
          return { status: 'expired', preview: task.preview };
        }
        return { status: 'pending', preview: task.preview };
      }
      // Fallback: server restarted, check DB audit log by taskId pattern
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
  listAuditLogs: publicProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input }) => {
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
      const enriched = dbLogs.map(log => ({
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
    // Filter expired: DB rows older than max timeout (10 min) are stale
    const cutoff = new Date(Date.now() - 600000).toISOString();
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

  // ─── List pending HITL tasks ───
  listPending: publicProcedure.query(() => {
    const pending: Array<{ taskId: string; tool: string; preview: string; risk: string; expiresIn: number }> = [];
    for (const [, task] of hitlTasks) {
      if (task.status === 'pending' && Date.now() < task.expiresAt) {
        pending.push({
          taskId: task.taskId,
          tool: task.toolName,
          preview: task.preview,
          risk: task.risk,
          expiresIn: Math.floor((task.expiresAt - Date.now()) / 1000),
        });
      }
    }
    return { pending };
  }),
});

// ─── Audit helper ───
async function auditLog(status: string, tool: string, args: Record<string, any>, result: any, apiKeyData?: any, confirmedBy?: string) {
  const record = await prisma.mcpAuditLog.create({
    data: {
      toolName: tool,
      arguments: JSON.stringify(args).substring(0, 1000),
      status,
      result: result ? JSON.stringify(result).substring(0, 500) : null as any,
      confirmedBy: confirmedBy || 'system',
      issueKey: result?.key || null as any,
      agentName: apiKeyData?.name ? `api:${apiKeyData.name}` : 'external',
      apiKeyName: apiKeyData?.name || null as any,
    },
  });
  return record;
}

async function updateAuditLog(id: string, status: string, result: any, confirmedBy?: string) {
  await prisma.mcpAuditLog.update({
    where: { id },
    data: {
      status,
      result: result ? JSON.stringify(result).substring(0, 500) : null as any,
      confirmedBy: confirmedBy || 'system',
    },
  });
}

// ═══ Tool executors ═══
async function executeTool(tool: string, args: Record<string, any>) {
  switch (tool) {
    case 'tools/list': {
      return {
        tools: [
          { name: 'create_issue', description: 'Create a new issue/task' },
          { name: 'list_issues', description: 'List project issues' },
          { name: 'get_issue', description: 'Get issue by number or search by title. Returns full details.' },
          { name: 'update_issue', description: 'Update issue title/status/priority/description' },
          { name: 'delete_issue', description: 'Delete an issue (irreversible)' },
          { name: 'get_project_stats', description: 'Project statistics' },
          { name: 'search_notes', description: 'Search knowledge base' },
          { name: 'list_notes', description: 'List all notes' },
          { name: 'get_focus_status', description: 'Current developer focus state' },
          { name: 'get_report', description: 'Get full report content by ID' },
          { name: 'create_report', description: 'Create a new daily/weekly report' },
          { name: 'update_report', description: 'Update an existing report' },
          { name: 'create_note', description: 'Create a new note/wiki page' },
          { name: 'update_note', description: 'Update an existing note' },
        ],
      };
    }
    case 'create_issue': {
      const maxNum = await prisma.issue.aggregate({ where: { projectId: 'proj-default' }, _max: { issueNumber: true } });
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
        },
      });
      return { key: `TL-${issue.issueNumber}`, title: issue.title, type: issue.type, status: issue.status };
    }
    case 'list_issues': {
      const where: any = { projectId: 'proj-default' };
      if (args.status) where.status = args.status;
      const issues = await prisma.issue.findMany({ where, orderBy: { createdAt: 'desc' }, take: args.limit || 20 });
      return issues.map(i => ({ key: `TL-${i.issueNumber}`, title: i.title, status: i.status, priority: i.priority }));
    }
    case 'get_issue': {
      if (args.issueNumber) {
        const issue = await prisma.issue.findFirst({ where: { projectId: 'proj-default', issueNumber: args.issueNumber } });
        if (!issue) return { error: `TL-${args.issueNumber} not found` };
        return { key: `TL-${issue.issueNumber}`, title: issue.title, status: issue.status, priority: issue.priority, type: issue.type, description: issue.description || '', storyPoints: issue.storyPoints, dueDate: issue.dueDate, createdAt: issue.createdAt };
      }
      if (args.query) {
        const issues = await prisma.issue.findMany({ where: { projectId: 'proj-default', title: { contains: args.query } }, orderBy: { createdAt: 'desc' }, take: args.limit || 5 });
        return issues.map(i => ({ key: `TL-${i.issueNumber}`, title: i.title, status: i.status, priority: i.priority, type: i.type, description: (i.description || '').substring(0, 300), dueDate: i.dueDate }));
      }
      return { error: 'Provide issueNumber or query' };
    }
    case 'update_issue': {
      const issue = await prisma.issue.findFirst({ where: { projectId: 'proj-default', issueNumber: args.issueNumber } });
      if (!issue) return { error: `TL-${args.issueNumber} not found` };
      const data: any = {};
      if (args.title) data.title = args.title;
      if (args.status) data.status = args.status;
      if (args.priority) data.priority = args.priority;
      if (args.description !== undefined) data.description = args.description;
      await prisma.issue.update({ where: { id: issue.id }, data });
      return { key: `TL-${issue.issueNumber}`, updated: true };
    }
    case 'delete_issue': {
      const issue = await prisma.issue.findFirst({ where: { projectId: 'proj-default', issueNumber: args.issueNumber } });
      if (!issue) return { error: `TL-${args.issueNumber} not found` };
      await prisma.issue.delete({ where: { id: issue.id } });
      return { key: `TL-${args.issueNumber}`, deleted: true };
    }
    case 'get_project_stats': {
      const issues = await prisma.issue.findMany({ where: { projectId: 'proj-default' } });
      return { total: issues.length, todo: issues.filter(i => i.status === 'todo').length, inProgress: issues.filter(i => ['in_progress', 'in_review'].includes(i.status)).length, done: issues.filter(i => i.status === 'done').length };
    }
    case 'create_report': {
      const report = await prisma.report.create({
        data: { projectId: 'proj-default', reportType: args.reportType || 'daily', title: args.title, content: args.content, status: 'draft' },
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
      const note = await prisma.knowledgePage.create({
        data: { projectId: 'proj-default', title: args.title || 'Untitled', content: args.content || '', category: args.category || 'general' },
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
      const pages = await prisma.knowledgePage.findMany({ where: { projectId: 'proj-default', OR: [{ title: { contains: args.query } }, { content: { contains: args.query } }] }, take: 10 });
      return pages.map(p => ({ title: p.title, snippet: (p.content || '').substring(0, 200) }));
    }
    case 'list_notes': {
      const nWhere: any = { projectId: 'proj-default' };
      if (args.query) nWhere.title = { contains: args.query };
      const pages = await prisma.knowledgePage.findMany({ where: nWhere, orderBy: { updatedAt: 'desc' }, take: args.limit || 20 });
      return pages.map(p => ({ id: p.id, title: p.title, category: p.category, snippet: (p.content || '').substring(0, 200) }));
    }
    case 'get_report': {
      const report = await prisma.report.findUnique({ where: { id: args.id } });
      if (!report) return { error: 'Report not found' };
      return { id: report.id, title: report.title, content: report.content || '', reportType: report.reportType, status: report.status };
    }
    case 'get_focus_status': {
      const user = await prisma.user.findFirst();
      return { focusState: user?.focusState || 'available', focusScore: user?.focusScore || 0 };
    }
    default: return { error: `Unknown tool: ${tool}` };
  }
}
