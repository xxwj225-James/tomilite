// ═══ Redmine connector ═══
//
// One direction, by design. TomiLite reads a Redmine and shows the tickets assigned to
// you as tasks; it never writes back. The reason is not caution about write APIs — it is
// that a two-way mirror of somebody else's tracker is a merge problem with no good
// answer, and the user's own words on the question were "同步不能反过来更新 redmine 的，
// 似乎这个功能没有意义" — which is right: the value is not in moving the task board
// across, it is in the four pipelines that currently cannot see this work at all. The
// task board, the Home totals, the health score, the morning brief and the agent's
// list_issues all read the `Issue` table; mirroring into it is what lets them see it.
//
// One-way is only safe with two properties, and both are load-bearing:
//
//   **Idempotent.** The merge key is `(source='redmine', sourceId=String(issue.id))`, so
//   a re-run updates rows rather than duplicating them, and a cursor keeps the re-runs
//   cheap. A copy that cannot be re-run rots.
//
//   **Read-only locally.** Every writer refuses a mirrored row (see lib/taskScope.ts's
//   `isImported` and its callers), because a local edit would be silently reverted by the
//   next sync. There is never a second version of the truth to reconcile.
//
// Errors travel as data, not exceptions — the same contract `routers/hosted.ts` set out,
// for the same reason: the renderer's api.ts throws on a non-2xx and would discard the
// message that came back from the server.

import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { utcStamp } from '../lib/dbTime.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { mapStatus, mapType, mapPriority } from '../lib/redmineMap.js';
import {
  PAGE_SIZE,
  normalizeBaseUrl,
  isNetworkError,
  fetchCurrentUser,
  fetchTrackers,
  fetchIssueStatuses,
  fetchPriorities,
  fetchProjects,
  fetchIssuesPage,
} from '../lib/redmineClient.js';

const CONFIG_KEY = 'redmine.config';
const CURSOR_KEY = 'redmine.cursor';
const VOCAB_KEY = 'redmine.vocab';

/**
 * Tracker / status / priority vocabularies, cached for a day.
 *
 * They only change when an administrator edits the server's configuration, which is not
 * on the timescale of a sync that runs every 30 minutes — and each is two extra round
 * trips to somebody else's server.
 */
const VOCAB_TTL_MS = 24 * 60 * 60 * 1000;

/** 50 pages × 100 = 5000 tickets in one call. The cap bounds one sync's runtime. */
const DEFAULT_MAX_PAGES = 50;
const HARD_MAX_PAGES = 50;

/**
 * Mirrored rows are written to the app's only project. The whole renderer addresses
 * `proj-default` directly (useTaskState, useNotesState, HomePanel), so there is no
 * project picker to honour — introducing one here would create tasks nothing displays.
 */
const LOCAL_PROJECT = 'proj-default';

interface RedmineConfig {
  baseUrl: string;
  /** AES-256-GCM, via lib/crypto.ts. Never leaves the API. */
  apiKeyEnc: string;
  enabled: boolean;
  /** The Redmine project to pull, and the user whose tickets to pull. */
  projectId: number | null;
  projectName: string;
  userId: number | null;
  userName: string;
  maxPages: number;
  lastSyncAt: string | null;
  lastSync: SyncSummary | null;
}

interface SyncSummary {
  ok: boolean;
  error?: string;
  fetched: number;
  created: number;
  updated: number;
  pages: number;
  /** True when the pass reached the end of the result set, so the cursor moved. */
  complete: boolean;
  hasMore: boolean;
  startedAt: string;
  finishedAt: string;
}

interface Vocabulary {
  at: number;
  trackers: Array<{ id: number; name: string }>;
  statuses: Array<{ id: number; name: string; is_closed: boolean }>;
  priorities: Array<{ id: number; name: string }>;
}

// ═══ Config ═══

async function readConfig(): Promise<RedmineConfig | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as RedmineConfig;
  } catch {
    // An unreadable blob is treated as "not configured" rather than crashing every
    // caller. The settings panel then shows the empty state, and saving rewrites it.
    return null;
  }
}

async function writeConfig(cfg: RedmineConfig): Promise<void> {
  const value = JSON.stringify(cfg);
  await prisma.systemConfig.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value }, update: { value } });
}

async function readCursor(): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key: CURSOR_KEY } });
  return row?.value || null;
}

/** What the panel is allowed to see: presence of a key, never the key. */
function publicConfig(cfg: RedmineConfig | null) {
  if (!cfg) return { configured: false, hasKey: false };
  return {
    configured: true,
    hasKey: !!cfg.apiKeyEnc,
    baseUrl: cfg.baseUrl,
    enabled: cfg.enabled,
    projectId: cfg.projectId,
    projectName: cfg.projectName,
    userId: cfg.userId,
    userName: cfg.userName,
    maxPages: cfg.maxPages,
    lastSyncAt: cfg.lastSyncAt,
    lastSync: cfg.lastSync,
  };
}

/**
 * Credentials for one call: what the caller typed, falling back to what is stored.
 *
 * The fallback is what makes "change the URL without retyping the key" work — the panel
 * sends an empty `apiKey` field, not a redacted placeholder, and empty means *keep*.
 * `decrypt` is lenient by design (lib/crypto.ts returns non-ciphertext input unchanged
 * and swallows a failed tag check), so "the key looks like plaintext" cannot be told
 * apart from "the stored key was encrypted with a key file that has since changed" —
 * only an actual request can, which is why `testConnection` exists as its own procedure.
 */
async function resolveCreds(input: { baseUrl?: string; apiKey?: string }): Promise<
  { ok: true; baseUrl: string; apiKey: string } | { ok: false; error: string }
> {
  const cfg = await readConfig();
  const base = normalizeBaseUrl(input.baseUrl || cfg?.baseUrl || '');
  if (!base) return { ok: false, error: 'Enter the Redmine address, such as http://redmine.example.com' };
  const typed = (input.apiKey || '').trim();
  if (typed) return { ok: true, baseUrl: base, apiKey: typed };
  if (!cfg?.apiKeyEnc) return { ok: false, error: 'An API key is required.' };
  return { ok: true, baseUrl: base, apiKey: await decrypt(cfg.apiKeyEnc) };
}

// ═══ Vocabularies ═══

async function readVocabCache(): Promise<Vocabulary | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key: VOCAB_KEY } });
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value) as Vocabulary;
    return Date.now() - v.at < VOCAB_TTL_MS ? v : null;
  } catch {
    return null;
  }
}

/**
 * Read the server's own tracker / status / priority names.
 *
 * This is the whole answer to "why not hardcode the ids": Redmine lets every
 * installation name its own trackers, statuses and priorities, usually in its own
 * language, so an id is only meaningful next to the vocabulary that defines it. What the
 * maps in lib/redmineMap.ts need is a *name*, and this is where names come from.
 */
async function loadVocab(
  baseUrl: string,
  apiKey: string,
  opts: { refresh?: boolean } = {},
): Promise<{ ok: true; vocab: Vocabulary } | { ok: false; error: string }> {
  if (!opts.refresh) {
    const cached = await readVocabCache();
    if (cached) return { ok: true, vocab: cached };
  }
  const [t, s, p] = await Promise.all([
    fetchTrackers(baseUrl, apiKey),
    fetchIssueStatuses(baseUrl, apiKey),
    fetchPriorities(baseUrl, apiKey),
  ]);
  if (!t.ok) return { ok: false, error: t.error };
  if (!s.ok) return { ok: false, error: s.error };
  const vocab: Vocabulary = {
    at: Date.now(),
    trackers: t.trackers,
    statuses: s.statuses,
    priorities: p.ok ? p.priorities : [],
  };
  const value = JSON.stringify(vocab);
  await prisma.systemConfig.upsert({ where: { key: VOCAB_KEY }, create: { key: VOCAB_KEY, value }, update: { value } });
  return { ok: true, vocab };
}

// ═══ Mapping ═══

/**
 * A Redmine issue → an `Issue` row.
 *
 * `updatedAt` is normalised to the app's naive-UTC stamp while the *cursor* keeps
 * Redmine's own string verbatim. That asymmetry is deliberate and is the one thing in
 * this file most likely to be "tidied up" into a bug: a `T`-and-`Z` ISO string sorts
 * after every space-separated stamp under SQLite's text comparison, so storing Redmine's
 * format in `updatedAt` would file every mirrored ticket after every local one — the
 * task board's `orderBy: { updatedAt: 'desc' }` would then show nothing else — while the
 * cursor needs Redmine's exact format because it is handed back to Redmine, whose
 * `updated_since` filter requires `YYYY-MM-DDTHH:MM:SSZ`. See docs/architecture.md.
 */
function mapIssue(
  raw: any,
  vocab: Vocabulary,
  baseUrl: string,
): {
  sourceId: string;
  title: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  assignee: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
} {
  const status = vocab.statuses.find((s) => s.id === raw?.status?.id);
  const tracker = vocab.trackers.find((t) => t.id === raw?.tracker?.id);
  const priority = vocab.priorities.find((p) => p.id === raw?.priority?.id);

  // `is_closed` from the status vocabulary, not from `raw.status.name`: the name is what
  // the server's administrator chose to call it. See redmineMap.ts.
  const mappedStatus = mapStatus(status?.name ?? raw?.status?.name ?? '', status?.is_closed ?? false);

  const stamp = (v: unknown, fallback: string): string => {
    const d = new Date(String(v ?? ''));
    return Number.isNaN(d.getTime()) ? fallback : utcStamp(d);
  };
  const now = utcStamp();

  // `Issue` has no URL column, so provenance goes in the body. Nothing can overwrite it:
  // the row is read-only everywhere.
  const head = `> Redmine #${raw.id} · ${tracker?.name ?? raw?.tracker?.name ?? 'issue'} · ${raw?.project?.name ?? ''}\n> ${baseUrl}/issues/${raw.id}`;
  const body = typeof raw?.description === 'string' ? raw.description : '';

  return {
    sourceId: String(raw.id),
    title: String(raw?.subject ?? '').slice(0, 500) || `#${raw.id}`,
    description: body ? `${head}\n\n${body}` : head,
    type: mapType(tracker?.name ?? raw?.tracker?.name ?? ''),
    status: mappedStatus,
    priority: mapPriority(priority?.name ?? raw?.priority?.name ?? ''),
    assignee: raw?.assigned_to?.name ?? null,
    dueDate: typeof raw?.due_date === 'string' ? raw.due_date : null,
    createdAt: stamp(raw?.created_on, now),
    updatedAt: stamp(raw?.updated_on, now),
  };
}

/**
 * The value to send as `updated_since`, one second before the stored cursor.
 *
 * Stored verbatim, sent shifted back — and the shift is the point. Redmine's
 * `updated_since` filter is documented as inclusive but its comparison has varied across
 * versions, and `updated_on` has one-second resolution, so on a `>` comparison every
 * ticket sharing the final second of a pass would be skipped. Because the stored cursor
 * was taken as that pass's **maximum** `updated_on`, those tickets are then permanently
 * behind it: no later pass would ever ask for them again. Shifting back one second makes
 * the question inclusive under either comparison, and the cost is re-reading one second
 * of changes — which is the same cheap duplicate the descending sort already produces.
 */
function shiftBackOneSecond(cursor: string): string {
  const t = Date.parse(cursor);
  if (Number.isNaN(t)) return cursor; // unknown shape: hand it back untouched
  return new Date(t - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ═══ Fetching a window ═══

interface Fetched {
  rows: ReturnType<typeof mapIssue>[];
  pages: number;
  complete: boolean;
  /** The largest `updated_on` seen, verbatim from the server. */
  maxUpdatedOn: string;
  totalCount: number;
}

async function fetchWindow(
  baseUrl: string,
  apiKey: string,
  vocab: Vocabulary,
  opts: { projectId: number | null; updatedSince?: string; maxPages: number },
): Promise<{ ok: true; data: Fetched } | { ok: false; error: string }> {
  const rows: Fetched['rows'] = [];
  let offset = 0;
  let pages = 0;
  let maxUpdatedOn = '';
  let totalCount = 0;
  let complete = false;

  for (;;) {
    const page = await fetchIssuesPage(baseUrl, apiKey, {
      projectId: opts.projectId ?? undefined,
      // Only the tickets assigned to the configured user. This is what keeps the
      // mirrored rows meaning "your work" rather than "an arbitrary project's throughput",
      // which matters because the user chose to have them counted in every statistic.
      assignedToId: 'me',
      updatedSince: opts.updatedSince,
      offset,
      limit: PAGE_SIZE,
    });
    if (!page.ok) {
      // A partial pass writes nothing and does not move the cursor: the next run asks the
      // same question. Half a sync that advanced the cursor would lose the other half.
      return { ok: false, error: page.error };
    }

    pages++;
    totalCount = page.totalCount;
    for (const raw of page.issues) {
      rows.push(mapIssue(raw, vocab, baseUrl));
      // Compared as strings, which is safe only because every `updated_on` from one
      // server is the same fixed-width ISO shape in the same timezone — so lexicographic
      // order is chronological order. This is the format the value keeps; `updatedAt`
      // above does not, and that difference is the point.
      const u = String(raw?.updated_on ?? '');
      if (u > maxUpdatedOn) maxUpdatedOn = u;
    }

    if (page.issues.length === 0 || offset + PAGE_SIZE >= page.totalCount) {
      complete = true;
      break;
    }
    if (pages >= opts.maxPages) break;
    offset += PAGE_SIZE;
  }

  return { ok: true, data: { rows, pages, complete, maxUpdatedOn, totalCount } };
}

// ═══ Writing ═══

/**
 * Upsert a window of mirrored rows, allocating local issue numbers.
 *
 * ## Inside one transaction, with the number read inside it
 *
 * `Issue.issueNumber` has no unique constraint (schema.prisma only indexes
 * `(projectId, status)`) while three code paths already treat `(projectId, issueNumber)`
 * as an identity, so a duplicate number is not a rejected insert — it is two rows sharing
 * a number and `findFirst` picking one arbitrarily, from which point the user edits a
 * mirrored ticket believing it is their own task. `issue.create` computes `max + 1`
 * outside a transaction, which is fine when writes are a user clicking Save and not fine
 * when this loop is inserting 400 rows: a save landing mid-sync would read a stale max.
 * SQLite serialises write transactions, so reading the max here either misses this batch
 * entirely (and so sees the post-sync max) or sees it.
 *
 * ## Only present fields are updated
 *
 * `createdAt` is written once, on insert. Redmine's `created_on` does not change, but a
 * row whose first import happened to fall back to "now" should not have that guess
 * re-guessed on every later sync.
 */
async function writeWindow(rows: Fetched['rows']): Promise<{ created: number; updated: number }> {
  if (rows.length === 0) return { created: 0, updated: 0 };

  // Dedupe inside the window, last wins: the descending sort can legitimately return the
  // same ticket twice if someone edits it mid-pagination, and a batch that contains the
  // same `sourceId` twice would otherwise try to insert it twice.
  const byKey = new Map(rows.map((r) => [r.sourceId, r]));
  const uniq = [...byKey.values()];

  return prisma.$transaction(async (tx) => {
    const existing = await tx.issue.findMany({
      where: { source: 'redmine', sourceId: { in: uniq.map((r) => r.sourceId) } },
      select: { id: true, sourceId: true },
    });
    const have = new Map(existing.map((e) => [e.sourceId as string, e.id]));

    let created = 0;
    let updated = 0;
    let next: number | null = null;

    for (const r of uniq) {
      const id = have.get(r.sourceId);
      if (id) {
        await tx.issue.update({
          where: { id },
          data: {
            title: r.title,
            description: r.description,
            type: r.type,
            status: r.status,
            priority: r.priority,
            assignee: r.assignee,
            dueDate: r.dueDate,
            updatedAt: r.updatedAt,
          },
        });
        updated++;
        continue;
      }
      if (next === null) {
        const maxRow = await tx.issue.aggregate({ where: { projectId: LOCAL_PROJECT }, _max: { issueNumber: true } });
        next = (maxRow._max.issueNumber ?? 0) + 1;
      }
      await tx.issue.create({
        data: {
          projectId: LOCAL_PROJECT,
          issueNumber: next++,
          title: r.title,
          description: r.description,
          type: r.type,
          status: r.status,
          priority: r.priority,
          assignee: r.assignee,
          dueDate: r.dueDate,
          sortOrder: 0,
          source: 'redmine',
          sourceId: r.sourceId,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        },
      });
      created++;
    }
    return { created, updated };
  });
}

// ═══ The sync ═══

/**
 * One pass. Serialised against itself, because two overlapping passes would each read the
 * cursor before the other moved it and fetch the same window twice — harmless for the
 * rows, wasteful on somebody else's server, and confusing in the summary the panel shows.
 */
let inFlight: Promise<SyncSummary> | null = null;

export function runSync(opts: { full?: boolean; maxPages?: number } = {}): Promise<SyncSummary> {
  if (inFlight) return inFlight;
  const run = syncOnce(opts).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

export function isSyncing(): boolean {
  return inFlight !== null;
}

async function syncOnce(opts: { full?: boolean; maxPages?: number }): Promise<SyncSummary> {
  const startedAt = utcStamp();
  const fail = (error: string): SyncSummary => ({
    ok: false,
    error,
    fetched: 0,
    created: 0,
    updated: 0,
    pages: 0,
    complete: false,
    hasMore: false,
    startedAt,
    finishedAt: utcStamp(),
  });

  try {
    const cfg = await readConfig();
    if (!cfg?.apiKeyEnc) return fail('Redmine is not configured yet.');
    const apiKey = await decrypt(cfg.apiKeyEnc);
    const baseUrl = normalizeBaseUrl(cfg.baseUrl);
    if (!baseUrl) return fail('The saved Redmine address is not usable. Re-enter it in Settings.');

    const v = await loadVocab(baseUrl, apiKey);
    if (!v.ok) return fail(v.error);

    // `full` ignores the cursor and re-reads everything, which is what a user wants after
    // changing the project or the user — the stored cursor describes the *old* query and
    // would otherwise hide every ticket the new query adds that has not been touched since.
    const storedCursor = opts.full ? null : await readCursor();
    const window = await fetchWindow(baseUrl, apiKey, v.vocab, {
      projectId: cfg.projectId,
      updatedSince: storedCursor ? shiftBackOneSecond(storedCursor) : undefined,
      maxPages: Math.min(opts.maxPages ?? cfg.maxPages ?? DEFAULT_MAX_PAGES, HARD_MAX_PAGES),
    });
    if (!window.ok) return fail(window.error);

    const { created, updated } = await writeWindow(window.data.rows);

    // Advanced only on a pass that reached the end. A pass truncated by `maxPages` has
    // seen the *newest* rows (the sort is descending) but not the oldest, so moving the
    // cursor to its maximum would put the unseen tail behind it for good.
    if (window.data.complete && window.data.maxUpdatedOn) {
      await prisma.systemConfig.upsert({
        where: { key: CURSOR_KEY },
        create: { key: CURSOR_KEY, value: window.data.maxUpdatedOn },
        update: { value: window.data.maxUpdatedOn },
      });
    }

    const summary: SyncSummary = {
      ok: true,
      fetched: window.data.rows.length,
      created,
      updated,
      pages: window.data.pages,
      complete: window.data.complete,
      hasMore: !window.data.complete,
      startedAt,
      finishedAt: utcStamp(),
    };
    const latest = await readConfig();
    if (latest) await writeConfig({ ...latest, lastSyncAt: summary.finishedAt, lastSync: summary });
    return summary;
  } catch (e) {
    return fail(isNetworkError(e) ? 'The sync could not reach Redmine. Check the address and the network.' : String((e as any)?.message || e));
  }
}

/**
 * The background entry point. Called from `startBackgroundTasks` on a 30-minute timer.
 *
 * Never throws: a rejecting interval takes down the process, and this one talks to a
 * server the user does not control. Unconfigured or disabled installs return immediately
 * without a request, so the timer costs nothing for the majority of users who never
 * enable it.
 */
export async function scheduledRedmineSync(): Promise<void> {
  try {
    const cfg = await readConfig();
    if (!cfg?.enabled || !cfg.apiKeyEnc) return;
    const r = await runSync();
    if (!r.ok) console.warn(`[Redmine] Scheduled sync failed: ${r.error}`);
  } catch (e: unknown) {
    console.error('[Redmine] Scheduled sync threw:', e instanceof Error ? e.message : e);
  }
}

// ═══ Router ═══
//
// Deliberately NOT exposed to the agent or the MCP server. `sync` reaches out to a third
// party with a stored credential and writes hundreds of rows; nothing an LLM composes
// should be able to trigger that, and no tool the agent has needs it — the agent reads
// the resulting `Issue` rows through the tools it already has. See routers/mcp.ts, which
// mounts an explicit allow-list rather than the whole appRouter.

export const redmineRouter = router({
  /** Stored configuration, with the API key reduced to a boolean. */
  getConfig: publicProcedure.query(async () => publicConfig(await readConfig())),

  /**
   * Save the connection.
   *
   * Not delegated to `email.saveConfig`: that one's schema is `z.enum(['imap','gmail',
   * 'smtp'])` and it encrypts four fixed field names unconditionally, so a second save
   * through it would double-encrypt. An empty or absent `apiKey` keeps the stored one,
   * which is what makes editing the URL a one-field edit.
   */
  saveConfig: publicProcedure
    .input(
      z.object({
        baseUrl: z.string().max(500),
        apiKey: z.string().max(200).optional(),
        enabled: z.boolean().optional(),
        projectId: z.number().int().nullable().optional(),
        projectName: z.string().max(300).optional(),
        userId: z.number().int().nullable().optional(),
        userName: z.string().max(300).optional(),
        maxPages: z.number().int().min(1).max(HARD_MAX_PAGES).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const base = normalizeBaseUrl(input.baseUrl);
      if (!base) return { ok: false as const, error: 'Enter the Redmine address, such as http://redmine.example.com' };
      const prev = await readConfig();
      const typed = (input.apiKey || '').trim();
      if (!typed && !prev?.apiKeyEnc) return { ok: false as const, error: 'An API key is required.' };

      const cfg: RedmineConfig = {
        baseUrl: base,
        apiKeyEnc: typed ? await encrypt(typed) : (prev?.apiKeyEnc as string),
        enabled: input.enabled ?? prev?.enabled ?? true,
        projectId: input.projectId === undefined ? (prev?.projectId ?? null) : input.projectId,
        projectName: input.projectName ?? prev?.projectName ?? '',
        userId: input.userId === undefined ? (prev?.userId ?? null) : input.userId,
        userName: input.userName ?? prev?.userName ?? '',
        maxPages: input.maxPages ?? prev?.maxPages ?? DEFAULT_MAX_PAGES,
        lastSyncAt: prev?.lastSyncAt ?? null,
        lastSync: prev?.lastSync ?? null,
      };
      await writeConfig(cfg);
      // A changed address or key means the cached vocabularies describe a different
      // server, so they are dropped rather than left to be trusted for a day.
      if (prev?.baseUrl !== base) await prisma.systemConfig.deleteMany({ where: { key: VOCAB_KEY } });
      return { ok: true as const, config: publicConfig(cfg) };
    }),

  /** Prove the address and the key, and report whose key it is. */
  testConnection: publicProcedure
    .input(z.object({ baseUrl: z.string().optional(), apiKey: z.string().optional() }))
    .mutation(async ({ input }) => {
      const creds = await resolveCreds(input);
      if (!creds.ok) return { ok: false as const, error: creds.error };
      const r = await fetchCurrentUser(creds.baseUrl, creds.apiKey);
      if (!r.ok) return { ok: false as const, error: r.error };
      const u = r.user;
      return {
        ok: true as const,
        userId: u.id as number,
        userName: [u.firstname, u.lastname].filter(Boolean).join(' ') || u.login || '',
        login: u.login || '',
      };
    }),

  /**
   * The projects and the vocabularies the pickers need.
   *
   * Takes credentials so it works *before* saving — the user has to see the project list
   * in order to choose one. `projects` is a live call; the vocabularies come from the
   * day-long cache when there is one, and only exist to render "Tracker: Bug · Status:
   * In Progress" in the preview, not to drive the mapping.
   */
  vocabularies: publicProcedure
    .input(z.object({ baseUrl: z.string().optional(), apiKey: z.string().optional(), refresh: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const creds = await resolveCreds(input);
      if (!creds.ok) return { ok: false as const, error: creds.error };
      const [projects, vocab] = await Promise.all([
        fetchProjects(creds.baseUrl, creds.apiKey),
        loadVocab(creds.baseUrl, creds.apiKey, { refresh: input.refresh }),
      ]);
      if (!projects.ok) return { ok: false as const, error: projects.error };
      if (!vocab.ok) return { ok: false as const, error: vocab.error };
      return {
        ok: true as const,
        projects: projects.projects.map((p: any) => ({ id: p.id, name: p.name, identifier: p.identifier })),
        statuses: vocab.vocab.statuses,
        trackers: vocab.vocab.trackers,
        priorities: vocab.vocab.priorities,
      };
    }),

  /**
   * What a sync would do, without doing it.
   *
   * One page only. Reads the current vocabulary so the user can see that their server's
   * "進行中" is about to become the board's "In Progress" — the mappings are name-based
   * guesses, and this is the one place they can be checked before several hundred rows
   * depend on them.
   */
  preview: publicProcedure
    .input(z.object({ projectId: z.number().int().nullable().optional() }))
    .mutation(async ({ input }) => {
      const cfg = await readConfig();
      if (!cfg?.apiKeyEnc) return { ok: false as const, error: 'Redmine is not configured yet.' };
      const apiKey = await decrypt(cfg.apiKeyEnc);
      const baseUrl = normalizeBaseUrl(cfg.baseUrl);
      if (!baseUrl) return { ok: false as const, error: 'The saved Redmine address is not usable.' };

      const vocab = await loadVocab(baseUrl, apiKey);
      if (!vocab.ok) return { ok: false as const, error: vocab.error };

      const page = await fetchIssuesPage(baseUrl, apiKey, {
        projectId: (input.projectId === undefined ? cfg.projectId : input.projectId) ?? undefined,
        assignedToId: 'me',
        offset: 0,
        limit: PAGE_SIZE,
      });
      if (!page.ok) return { ok: false as const, error: page.error };

      // Annotated because `page.issues` comes back from `fetchIssuesPage` as `any` (its
      // parse callback reads a JSON body), so the mapped array would be `any` and every
      // `rows.…((r) => …)` below would take an implicitly-`any` parameter. Same annotation
      // as the `Fetched` interface above, for the same reason.
      const rows: ReturnType<typeof mapIssue>[] = page.issues.map((raw: any) =>
        mapIssue(raw, vocab.vocab, baseUrl),
      );
      const existing = await prisma.issue.findMany({
        where: { source: 'redmine', sourceId: { in: rows.map((r) => r.sourceId) } },
        select: { sourceId: true },
      });
      const have = new Set(existing.map((e) => e.sourceId as string));
      const tally = (key: 'status' | 'type' | 'priority') => {
        const m: Record<string, number> = {};
        for (const r of rows) m[r[key]] = (m[r[key]] ?? 0) + 1;
        return m;
      };
      return {
        ok: true as const,
        totalCount: page.totalCount,
        sampled: rows.length,
        wouldCreate: rows.filter((r) => !have.has(r.sourceId)).length,
        wouldUpdate: rows.filter((r) => have.has(r.sourceId)).length,
        byStatus: tally('status'),
        byType: tally('type'),
        byPriority: tally('priority'),
        sample: rows.slice(0, 10).map((r) => ({
          sourceId: r.sourceId,
          title: r.title,
          status: r.status,
          type: r.type,
          priority: r.priority,
        })),
      };
    }),

  /** Run a pass now. */
  sync: publicProcedure
    .input(z.object({ full: z.boolean().optional() }).optional())
    .mutation(async ({ input }) => runSync({ full: input?.full })),

  /** Where the connection stands, for the panel and its polling. */
  status: publicProcedure.query(async () => {
    const cfg = await readConfig();
    const [mirrored, cursor] = await Promise.all([
      prisma.issue.count({ where: { source: 'redmine' } }),
      readCursor(),
    ]);
    return {
      configured: !!cfg,
      hasKey: !!cfg?.apiKeyEnc,
      enabled: cfg?.enabled ?? false,
      syncing: isSyncing(),
      projectName: cfg?.projectName ?? '',
      userName: cfg?.userName ?? '',
      lastSyncAt: cfg?.lastSyncAt ?? null,
      lastSync: cfg?.lastSync ?? null,
      cursor,
      mirrored,
    };
  }),

  /**
   * Forget the connection.
   *
   * The disposition of the already-mirrored rows is required rather than defaulted,
   * because there is no safe silent answer: leaving them behind strands a few hundred
   * rows that are read-only *and* no longer refreshable — the user cannot edit them and
   * cannot delete them, which is precisely the dead end `issue.detach` was added to
   * avoid. `detach` is offered first because it is the only option that keeps the data
   * while removing the lock.
   */
  disconnect: publicProcedure
    .input(z.object({ tasks: z.enum(['keep', 'detach', 'delete']) }))
    .mutation(async ({ input }) => {
      let affected = 0;
      if (input.tasks === 'detach') {
        const r = await prisma.issue.updateMany({
          where: { source: 'redmine' },
          data: { source: null, sourceId: null, updatedAt: utcStamp() },
        });
        affected = r.count;
      } else if (input.tasks === 'delete') {
        const r = await prisma.issue.deleteMany({ where: { source: 'redmine' } });
        affected = r.count;
      }
      await prisma.systemConfig.deleteMany({ where: { key: { in: [CONFIG_KEY, CURSOR_KEY, VOCAB_KEY] } } });
      return { ok: true as const, affected };
    }),
});
