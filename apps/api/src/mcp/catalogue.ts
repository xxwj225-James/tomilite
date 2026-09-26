// ═══ The tool catalogue ═══
//
// This file is THE list of tools TomiLite exposes over MCP. It exists because that
// list used to live in three places inside `routers/mcp.ts` that drifted apart:
//
//   TOOL_RISK     17 names, including two (`get_board_status`, `update_settings`)
//                 that no code anywhere implements
//   executeTool   15 implementations
//   listTools     14 schemas, and a separate TOOL_REQUIRED list that disagreed with
//                 them (`get_report` declared `required: ['id']` that the runtime
//                 validator had never heard of, so a call without `id` reached
//                 `findUnique({ where: { id: undefined } })` and became a 500)
//
// The bug is structural, not clerical: two lists describing one thing will drift.
// So the fix is one list, with `required` derived from the schema rather than
// restated — see `requiredOf`. A tool cannot ship with a schema and a validator that
// disagree, because there is only one field.
//
// Zero imports on purpose. This module is bundled into the stdio shim, which must
// reach no package at all (it is tens of KB; a stray Prisma import would make it
// tens of MB). If an import is ever added here, the shim bundle check fails loudly.

export type RiskLevel = 'read_only' | 'low' | 'medium' | 'high';

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  risk: RiskLevel;
  inputSchema: JsonSchema;
}

/**
 * What the server tells a connecting client about how it wants to be used. Sent in
 * the `initialize` result (legacy) and in `server/discover` (modern).
 */
export const SERVER_INSTRUCTIONS =
  'TomiLite is a local developer-work app: tasks, notes/wiki pages, reports and a focus timer. ' +
  'Reads are free. Writes are gated by human approval that happens in the TomiLite window, not in ' +
  'this client — see the pending-approval text a write tool returns. Task identifiers look like ' +
  'TL-12 for tasks this app created and #1234 for tasks mirrored read-only from Redmine.';

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'create_issue',
    title: 'Create task',
    description: 'Create a new issue/task',
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
    name: 'list_issues',
    title: 'List tasks',
    description: 'List project issues',
    risk: 'read_only',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string' }, limit: { type: 'number', default: 20 } },
    },
  },
  {
    name: 'get_issue',
    title: 'Get task',
    description:
      'Get issue by number (TL-3) or fuzzy search by title keyword. Returns full details including description.',
    risk: 'read_only',
    inputSchema: {
      type: 'object',
      properties: {
        issueNumber: { type: 'number', description: 'Issue number e.g. 3 for TL-3' },
        query: { type: 'string', description: 'Search by title keyword' },
      },
    },
  },
  {
    name: 'update_issue',
    title: 'Update task',
    description: 'Update issue title/status/priority/description',
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
    name: 'delete_issue',
    title: 'Delete task',
    description: 'Delete an issue ⚠️ irreversible',
    risk: 'high',
    inputSchema: {
      type: 'object',
      properties: { issueNumber: { type: 'number' } },
      required: ['issueNumber'],
    },
  },
  {
    name: 'get_project_stats',
    title: 'Project statistics',
    description: 'Project statistics',
    risk: 'read_only',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    // Was declared in TOOL_RISK and never implemented, so a call queued a medium-risk
    // approval, waited for a human, and only then answered "Unknown tool". Now real.
    name: 'get_board_status',
    title: 'Board status',
    description:
      'What is on the kanban board right now, column by column, with the issue keys in each column.',
    risk: 'read_only',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_focus_status',
    title: 'Focus status',
    description: 'Current developer focus state',
    risk: 'read_only',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_report',
    title: 'Get report',
    // The old text said "Use after list_reports" — there is no list_reports tool, in
    // this catalogue or anywhere else. It pointed at nothing.
    description: 'Get the full content of a report by its ID.',
    risk: 'read_only',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Report ID (UUID)' } },
      required: ['id'],
    },
  },
  {
    name: 'create_report',
    title: 'Create report',
    description: 'Create a new daily/weekly report',
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
    name: 'update_report',
    title: 'Update report',
    description: 'Update an existing report',
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
    name: 'search_notes',
    title: 'Search notes',
    description: 'Search knowledge base',
    risk: 'read_only',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'list_notes',
    title: 'List notes',
    description: 'List all knowledge base notes. Returns id, title, category, and content snippet.',
    risk: 'read_only',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search keyword' },
        limit: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'create_note',
    title: 'Create note',
    description: 'Create a new note/wiki page',
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
    name: 'update_note',
    title: 'Update note',
    description: 'Update an existing note',
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
    // ⚠️ A tool whose name collides with a JSON-RPC method. MCP clients show both the
    // protocol method `tools/list` and this tool, which is confusing to read and
    // impossible to remove without breaking callers that reached TomiLite over the
    // pre-MCP HTTP surface documented in Settings → API Keys (that surface passes a
    // tool *name*, and `tools/list` is one of the names it passes). Kept deliberately;
    // if the legacy HTTP surface is ever retired, delete this entry first.
    name: 'tools/list',
    title: 'List tool names',
    description: 'List the names and one-line descriptions of every available tool.',
    risk: 'read_only',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    // Also new. Makes polling the protocol-idiomatic way to collect an approved write,
    // instead of relying only on re-issuing the original call.
    name: 'get_task_result',
    title: 'Get approval result',
    description:
      'Check the result of a write that was waiting for human approval. Pass the taskId a pending ' +
      'approval returned. Optionally wait up to waitMs for the approval to arrive.',
    risk: 'read_only',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The taskId from a pending-approval response' },
        waitMs: { type: 'number', description: 'Poll up to this many milliseconds (0 = do not wait)', default: 0 },
      },
      required: ['taskId'],
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolByName(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

export function riskOf(name: string): RiskLevel | undefined {
  return BY_NAME.get(name)?.risk;
}

/**
 * The required argument names for a tool, read from its schema rather than restated.
 * This is the whole point of the catalogue: a schema and a validator that live in
 * different lists will disagree, and the disagreement is invisible until a caller
 * hits it.
 */
export function requiredOf(name: string): string[] {
  return BY_NAME.get(name)?.inputSchema.required ?? [];
}

/**
 * Returns the name of the first required argument that is missing or blank, or null
 * when the call is well-formed. Blank strings count as missing: an empty title is
 * never what the caller meant, and the tools below would happily store it.
 */
export function validateArgs(name: string, args: Record<string, unknown>): string | null {
  for (const field of requiredOf(name)) {
    const v = args[field];
    if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return field;
  }
  return null;
}

/**
 * Risk published as protocol `ToolAnnotations`, which is the standard way to tell a
 * client how a tool behaves so it can build its own approval UI. Revisions older than
 * the field ignore unknown keys, so sending it costs nothing.
 */
function annotationsFor(risk: RiskLevel): Record<string, boolean> {
  switch (risk) {
    case 'read_only':
      return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    case 'low':
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
    case 'medium':
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
    case 'high':
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  }
}

/**
 * The `tools/list` payload. `risk` is TomiLite's own vocabulary and is not part of the
 * protocol, so it is deliberately absent here — it travels as `annotations` instead.
 * The tRPC `mcp.listTools` procedure keeps emitting `risk` for the existing UI.
 *
 * Not filtered by an API key's `scopes`, deliberately: a read-only key still sees the
 * whole catalogue, and the refusal happens when it calls a write tool. Filtering the
 * list here would make the two transports disagree — the stdio shim cannot see the
 * key's scopes, so it would advertise everything while the server advertised less —
 * and the list is not a security boundary; the call is.
 */
export function toMcpTools(): Array<Record<string, unknown>> {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: annotationsFor(t.risk),
  }));
}
