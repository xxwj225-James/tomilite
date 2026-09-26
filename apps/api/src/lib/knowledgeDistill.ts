// ═══ Task, report and meeting knowledge → the user's notes ═══
//
// The database side of the distillation whose rules live in `lib/distillCandidates.ts`.
// Same relationship, and the same split, as `lib/chatDistill.ts` + its prompt: the pure
// half decides *what* is worth asking about and *whether it already was*, this half reads
// the rows, spends the money and writes the note.
//
// ─── The two passes ───
//
// `suggest` spends and writes nothing; `apply` writes and never spends. A third, free pass
// (`list`) sits in front of them so the user can see how many sources there are before any
// money moves — without it, the first thing this feature does is charge for a decision the
// user was never shown. That order is the same one `knowledge.suggestLinks` /
// `knowledge.applyLinks` already use, and for the same reason.
//
// ─── What is reused, deliberately ───
//
// `splitLinkSection` / `replaceLinkSection` for the `[[link]]` section, `utcStamp` for every
// stamp, `chat()` for the call, `t()` for the note-title fallbacks, `SOURCE_OF` /
// `CATEGORY_OF` for the merge keys. Nothing about the note write is new: a plain
// `prisma.knowledgePage` write is enough, because the triggers `lib/ftsIndex.ts` installs
// put the row in `global_fts` and queue its embedding automatically.
//
// ─── The brake ───
//
// Quota exhaustion writes `distill.pausedUntil` — **the same key the background chat
// distillation uses**, read here as a pre-check before anything is spent. The brake is a
// fact about the account, not about a feature: a second key would allow the state where one
// panel says AI spending is paused and this button cheerfully burns a quota that is already
// gone.
//
// The *other* distillation switch is deliberately not read: `distill.enabled === '0'` is a
// switch for the **background** job ("do not spend my money while I am not looking"), and
// pressing a button is the exact opposite of that. Written down because a reader will
// expect the two switches to be honoured identically.

import { prisma } from '@tomilite/database';
import { DEFAULT_PROJECT_ID } from '../agent/utils/constants.js';
import { utcStamp } from './dbTime.js';
import { resolveLLM } from './gateway.js';
import { t } from './i18n.js';
import { chat } from './meeting/pipeline.js';
import { parseLinks, replaceLinkSection, splitLinkSection } from './noteLinks.js';
import { TASK_WHERE, issueKey } from './taskScope.js';
import { track as telTrack } from './telemetry.js';
import {
  CATEGORY_OF,
  MAX_CANDIDATES_PER_RUN,
  MAX_CONTENT,
  SOURCE_OF,
  buildDistillPrompt,
  clipMaterial,
  isReAsk,
  liveDecisions,
  meetingRef,
  parseDistillVerdict,
  reportRefs,
  selectCandidates,
  taskRef,
  unitKey,
  type DistillKind,
  type DistillRef,
  type ExcludeWhy,
  type MeetingInput,
  type RefResult,
  type ReviewedEntry,
  type TaskInput,
} from './distillCandidates.js';

/** Reviewed units, keyed `unitKey(kind, refId)`. Mirrors `knowledge.linksReviewed`. */
const REVIEWED_KEY = 'knowledge.distillReviewed';
/** The account-level spending brake, shared with the background chat distillation. */
const PAUSE_KEY = 'distill.pausedUntil';
const PAUSE_MS = 6 * 60 * 60_000;
const STOP_CODES = new Set(['quota_exhausted', 'feature_closed', 'account_disabled', 'model_not_allowed']);

/** Per-item excerpts, so a whole month of reports can be represented inside the budget
 *  instead of the first few days of it filling the prompt on their own. */
const MAX_REPORT_CHARS = 700;
const MAX_COMMENT_CHARS = 500;
const MAX_DESC_CHARS = 2000;

/**
 * Default look-back, in days. A quarter of finished work is a first press the user can
 * afford; the dialog offers it as the server's own default so the number shown and the
 * number applied cannot drift.
 */
export const DEFAULT_SINCE_DAYS = 90;

// ─── Config ─────────────────────────────────────────────────────────────────────

async function getCfg(key: string): Promise<string | null> {
  try {
    return (await prisma.systemConfig.findUnique({ where: { key } }))?.value ?? null;
  } catch {
    return null;
  }
}

async function setCfg(key: string, value: string): Promise<void> {
  try {
    await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  } catch {
    /* best-effort — a brake that fails to be written costs a redundant call, not data */
  }
}

async function readReviewed(): Promise<Record<string, ReviewedEntry>> {
  const raw = await getCfg(REVIEWED_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, ReviewedEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      // Shape-checked, not trusted: this is a KV value a user can edit, and a malformed
      // entry must read as "never reviewed" rather than crash the panel.
      if (v && typeof v === 'object' && typeof (v as ReviewedEntry).watermark === 'string') {
        out[k] = { at: String((v as ReviewedEntry).at ?? ''), watermark: (v as ReviewedEntry).watermark };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Record the answered units, **including the ones the user left unticked**.
 *
 * This is where it differs from `applyLinks`, which only records what it wrote. The
 * difference is the point: an unticked box is still a decision the user made, and asking
 * again on the next press is how you train someone to stop reading the list. Re-asking is
 * available, but it has to be asked for — that is what `force` is for.
 *
 * The watermark is the one that travelled back from `suggest`, never a fresh derivation:
 * re-deriving here would let the set that was reviewed and the set that was recorded
 * differ, which is the one thing a confirmation step must not allow.
 */
async function rememberReviewed(entries: Array<{ key: string; watermark: string }>): Promise<void> {
  if (!entries.length) return;
  const current = await readReviewed();
  const at = utcStamp();
  for (const e of entries) current[e.key] = { at, watermark: e.watermark };
  await setCfg(REVIEWED_KEY, JSON.stringify(current));
}

// ─── Loading: one pass per kind ─────────────────────────────────────────────────

/** A loaded source: its ref when eligible, or why not — with a label for the dialog
 *  either way, so an excluded source can be named rather than counted. */
interface Loaded {
  label: string;
  result: RefResult;
}

/** The cutoff as a UTC stamp, or null for "no bound". */
function cutoffOf(sinceDays: number | null): string | null {
  if (sinceDays === null || sinceDays <= 0) return null;
  return utcStamp(new Date(Date.now() - sinceDays * 24 * 60 * 60_000));
}

function after(stamp: string, cutoff: string | null): boolean {
  return !cutoff || stamp >= cutoff;
}

/** The row maps the material pass needs, for the units that were actually taken. */
interface RowMaps {
  tasks: Map<string, TaskInput>;
  meetings: Map<string, MeetingInput>;
}

async function loadTaskRefs(cutoff: string | null): Promise<{ loaded: Loaded[]; rows: Map<string, TaskInput> }> {
  const issues = await prisma.issue.findMany({
    // `status: 'done'` is spread *after* `TASK_WHERE`, so it overrides the four-status `in`
    // rather than being ANDed with it — the same order and the same reason as
    // `agent/tools/issueTools.ts`.
    where: { projectId: DEFAULT_PROJECT_ID, ...TASK_WHERE, status: 'done' },
    select: {
      id: true,
      issueNumber: true,
      title: true,
      description: true,
      type: true,
      status: true,
      labels: true,
      priority: true,
      source: true,
      sourceId: true,
      updatedAt: true,
      _count: { select: { comments: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const rows = new Map<string, TaskInput>();
  const loaded: Loaded[] = [];
  for (const i of issues) {
    const input: TaskInput = { ...i, commentCount: i._count.comments };
    rows.set(i.id, input);
    const label = `${issueKey(i)} ${i.title}`.trim();
    // The period is a *selector*, applied here so a cheap DB filter does not need to be
    // re-derived from a ref later. It is never a filter on material: a unit in scope is
    // distilled whole — a narrower window must not rewrite the same note from a smaller
    // set and drop what the previous run wrote.
    if (!after(i.updatedAt, cutoff)) {
      loaded.push({ label, result: { ok: false, why: 'out-of-scope' } });
      continue;
    }
    loaded.push({ label, result: taskRef(input) });
  }
  return { loaded, rows };
}

async function loadReportRefs(cutoff: string | null): Promise<Loaded[]> {
  // Titles and stamps only — a corpus of reports' full text is megabytes, and this pass is
  // free and runs before anything is spent. Full content is read per month, for the months
  // that were actually taken (`monthMaterial`).
  const reports = await prisma.report.findMany({
    select: { id: true, title: true, reportType: true, generatedAt: true, archived: true },
  });

  // `reportRefs` does the grouping and the watermark, so the two halves of this feature
  // cannot disagree about which months exist.
  const results = reportRefs(
    reports.map((r) => ({
      id: r.id,
      title: r.title,
      reportType: r.reportType,
      content: '',
      generatedAt: r.generatedAt,
      archived: r.archived,
    })),
  );

  const loaded: Loaded[] = [];
  for (const result of results) {
    if (!result.ok) {
      loaded.push({ label: '', result });
      continue;
    }
    const month = result.ref.refId;
    // A month is in scope when *any* report in it is — the whole month is then distilled,
    // so a window that selected "September since the 15th" still produces the September
    // note rather than a September-half note.
    const anyInScope = reports.some((r) => r.generatedAt.startsWith(month) && after(r.generatedAt, cutoff));
    loaded.push({
      label: month,
      result: anyInScope ? result : { ok: false, why: 'out-of-scope' },
    });
  }
  return loaded;
}

async function loadMeetingRefs(cutoff: string | null): Promise<{ loaded: Loaded[]; rows: Map<string, MeetingInput> }> {
  const meetings = await prisma.meeting.findMany({
    select: {
      id: true,
      title: true,
      aiStatus: true,
      decisionItems: { select: { id: true, status: true, decidedAt: true, createdAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rows = new Map<string, MeetingInput>();
  const loaded: Loaded[] = [];
  for (const m of meetings) {
    // A decision's own time: the day the meeting pinned it to, else when the row was
    // extracted. Read for the period selector and for ordering — never compared to a bound
    // derived from `Meeting.createdAt`, which is a local-time column frozen at creation
    // (`lib/dbTime.ts` explains the column default, and `lib/distillCandidates.ts` why no
    // meeting clock can be a watermark).
    const decisions = m.decisionItems.map((d) => ({ id: d.id, status: d.status, at: d.decidedAt || d.createdAt }));
    const input: MeetingInput = { id: m.id, title: m.title, aiStatus: m.aiStatus, decisions };
    rows.set(m.id, input);
    const newest = liveDecisions(input).reduce((a, d) => (d.at > a ? d.at : a), '');
    if (!after(newest, cutoff)) {
      loaded.push({ label: m.title, result: { ok: false, why: 'out-of-scope' } });
      continue;
    }
    loaded.push({ label: m.title, result: meetingRef(input) });
  }
  return { loaded, rows };
}

// ─── Material ───────────────────────────────────────────────────────────────────

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** A task's own material: what it was, and the discussion that resolved it. */
async function taskMaterial(issueId: string, row: TaskInput): Promise<string> {
  const comments = await prisma.comment.findMany({
    where: { issueId },
    orderBy: { createdAt: 'asc' },
    select: { body: true, createdAt: true },
  });
  const head = [
    `# ${row.title}`,
    `Status: done · Type: ${row.type ?? 'task'} · Priority: ${row.priority ?? 'medium'}`,
    row.labels ? `Labels: ${row.labels}` : '',
    '',
    clip(row.description ?? '', MAX_DESC_CHARS) || '(no description)',
  ].filter(Boolean);
  const replies = comments.map((c) => `### Comment (${c.createdAt})\n${clip(c.body, MAX_COMMENT_CHARS)}`);
  return [...head, '', ...replies].join('\n');
}

/** One month's reports, oldest first, each excerpted so the whole month is represented. */
async function monthMaterial(month: string): Promise<{ text: string; items: number }> {
  // `startsWith` on the month prefix, not a date range: every `generatedAt` is a UTC
  // `'YYYY-MM-DD HH:MM:SS'` (`lib/dbTime.ts`), so the first seven characters *are* the month.
  // `archived` and `status` are deliberately not filtered — see `reportRefs` for why a
  // month that re-reads itself without its archived reports would silently shrink.
  const reports = await prisma.report.findMany({
    where: { generatedAt: { startsWith: month } },
    orderBy: { generatedAt: 'asc' },
    select: { title: true, reportType: true, content: true, generatedAt: true },
  });
  const blocks = reports.map(
    (r) => `## ${r.title} — ${r.generatedAt}\n${clip(r.content ?? '', MAX_REPORT_CHARS)}`,
  );
  return { text: blocks.join('\n\n'), items: reports.length };
}

async function meetingMaterial(meetingId: string, row: MeetingInput): Promise<string> {
  const all = await prisma.meetingDecision.findMany({
    where: { meetingId },
    orderBy: { idx: 'asc' },
    select: { id: true, text: true, rationale: true, decidedAt: true, status: true },
  });
  const live = new Set(liveDecisions(row).map((d) => d.id));
  const blocks = all
    .filter((d) => live.has(d.id))
    .map((d) =>
      [`### ${d.text}`, d.decidedAt ? `Decided: ${d.decidedAt}` : '', d.rationale ? `Why: ${d.rationale}` : '']
        .filter(Boolean)
        .join('\n'),
    );
  return blocks.join('\n\n');
}

/** Material for one taken ref, clipped to the budget with the cut reported. */
async function materialFor(
  kind: DistillKind,
  refId: string,
  fallbackItems: number,
  rows: RowMaps,
): Promise<{ text: string; items: number; truncated: boolean }> {
  let raw = '';
  let items = fallbackItems;
  if (kind === 'task') {
    const row = rows.tasks.get(refId);
    raw = row ? await taskMaterial(refId, row) : '';
  } else if (kind === 'report') {
    const month = await monthMaterial(refId);
    raw = month.text;
    items = month.items;
  } else {
    const row = rows.meetings.get(refId);
    raw = row ? await meetingMaterial(refId, row) : '';
  }
  const clipped = clipMaterial(raw);
  return { text: clipped.text, items, truncated: clipped.truncated };
}

/** The note a unit already rolls into, if any. */
async function existingNote(kind: DistillKind, refId: string) {
  return prisma.knowledgePage.findFirst({
    where: { source: SOURCE_OF[kind], sourceId: refId },
    select: { id: true, title: true, content: true, updatedAt: true },
  });
}

// ─── Pass 1: who is a candidate (free) ──────────────────────────────────────────

export interface CandidateItem {
  kind: DistillKind;
  refId: string;
  label: string;
  watermark: string;
  items: number;
  existingNoteId: string | null;
}

export interface CandidateList {
  candidates: CandidateItem[];
  /** Sources that exist but were not offered, by machine reason. Named, not just counted. */
  excluded: Array<{ label: string; why: ExcludeWhy }>;
  /** In scope and unanswered, but over this run's ceiling. The next press starts here. */
  deferred: number;
}

export interface CandidateInput {
  kinds: DistillKind[];
  force: boolean;
  sinceDays: number | null;
}

/**
 * One read of every source in scope, shared by both passes.
 *
 * Read once and split into the two lists the callers need — the refs, and the rows the
 * material pass will read from. Having `suggest` re-derive them would double a full scan of
 * the task table, and (worse) let the two passes disagree about which units exist.
 */
async function gather(
  input: CandidateInput,
): Promise<{ answered: DistillRef[]; excluded: Array<{ label: string; why: ExcludeWhy }>; rows: RowMaps }> {
  const cutoff = cutoffOf(input.sinceDays);
  const reviewed = await readReviewed();

  const loaded: Loaded[] = [];
  const rows: RowMaps = { tasks: new Map(), meetings: new Map() };

  // Sequential rather than `Promise.all` only because two of the three hand back row maps;
  // the queries are independent and a local SQLite read is not what makes this slow.
  if (input.kinds.includes('task')) {
    const tasks = await loadTaskRefs(cutoff);
    loaded.push(...tasks.loaded);
    rows.tasks = tasks.rows;
  }
  if (input.kinds.includes('report')) loaded.push(...(await loadReportRefs(cutoff)));
  if (input.kinds.includes('meeting')) {
    const meetings = await loadMeetingRefs(cutoff);
    loaded.push(...meetings.loaded);
    rows.meetings = meetings.rows;
  }

  const excluded: Array<{ label: string; why: ExcludeWhy }> = [];
  const unanswered: DistillRef[] = [];
  for (const item of loaded) {
    if (!item.result.ok) {
      excluded.push({ label: item.label, why: item.result.why });
      continue;
    }
    if (!isReAsk(item.result.ref, reviewed, input.force)) {
      excluded.push({ label: item.label || item.result.ref.title, why: 'already-reviewed' });
      continue;
    }
    unanswered.push(item.result.ref);
  }

  return { answered: unanswered, excluded, rows };
}

/**
 * The free pass. Reads, groups and filters; spends nothing and writes nothing.
 *
 * It exists so the user sees a number before they see a bill — the same line the rest of
 * this router holds to (`Reading is free; generating costs money`). Every excluded source
 * comes back with a reason, because the five empty states behind this feature look
 * identical on screen and need opposite responses.
 */
export async function listCandidates(input: CandidateInput): Promise<CandidateList> {
  const { answered, excluded } = await gather(input);
  const { taken, deferred } = selectCandidates(answered, MAX_CANDIDATES_PER_RUN);

  const candidates: CandidateItem[] = [];
  for (const ref of taken) {
    const note = await existingNote(ref.kind, ref.refId);
    candidates.push({
      kind: ref.kind,
      refId: ref.refId,
      label: ref.title,
      watermark: ref.watermark,
      items: ref.items,
      existingNoteId: note?.id ?? null,
    });
  }

  return { candidates, excluded, deferred: deferred.length };
}

// ─── Pass 2: propose the notes (spends, writes nothing) ─────────────────────────

export interface Proposal {
  kind: DistillKind;
  refId: string;
  label: string;
  watermark: string;
  existingNoteId: string | null;
  /** Re-read at apply time; a note edited since review is refused rather than overwritten. */
  existingUpdatedAt: string | null;
  title: string;
  content: string;
  items: number;
  truncated: boolean;
}

export interface SuggestResult {
  ok: boolean;
  reason?: 'no-sources' | 'no-llm' | 'paused';
  pausedUntil?: string;
  proposals: Proposal[];
  skipped: Array<{ label: string; why: string }>;
  failures: Array<{ label: string; why: string }>;
  model?: string;
  tokens: number;
  deferred: number;
}

export interface SuggestInput extends CandidateInput {
  lang: string;
  excludeIds: string[];
}

/**
 * Ask the model for one note per candidate. **Writes nothing.**
 *
 * A failure is per unit, not per run: each candidate is its own call, so one bad response
 * costs that candidate and nothing else — finer than `suggestLinks`, which drops a whole
 * batch because a batch is one call. A truncated response is dropped whole rather than
 * half-read, because the part the model never reached would otherwise read as "there was
 * nothing durable in it".
 *
 * The user reviews these before anything is stored, and the review is the point: the text
 * that gets written is the text they saw, not a second model call that could differ.
 */
export async function suggestDistill(input: SuggestInput): Promise<SuggestResult> {
  const base: SuggestResult = { ok: false, proposals: [], skipped: [], failures: [], tokens: 0, deferred: 0 };

  // Read before spending anything: a user who presses this after their quota ran out must
  // be told when it comes back, not handed twelve failed calls to read.
  const paused = await getCfg(PAUSE_KEY);
  if (paused && Date.now() < new Date(paused).getTime()) {
    return { ...base, reason: 'paused', pausedUntil: paused };
  }

  const { answered, rows } = await gather({ kinds: input.kinds, force: input.force, sinceDays: input.sinceDays });
  const { taken, deferred } = selectCandidates(answered, MAX_CANDIDATES_PER_RUN);
  if (!taken.length) {
    return { ...base, reason: 'no-sources' };
  }

  const llm = await resolveLLM();
  const model = llm ? llm.flashModel || llm.proModel : null;
  if (!llm || !model) return { ...base, reason: 'no-llm' };

  const excluded = new Set(input.excludeIds);
  const out: SuggestResult = { ...base, ok: true, model, deferred: deferred.length };

  for (const ref of taken) {
    const candidate = { kind: ref.kind, refId: ref.refId, label: ref.title, watermark: ref.watermark, items: ref.items };

    const note = await existingNote(candidate.kind, candidate.refId);
    if (note && excluded.has(note.id)) {
      // Open in the editor. Its body is a load-time snapshot the editor will save back
      // wholesale, so a write here would be overwritten — or would overwrite an edit.
      out.skipped.push({ label: candidate.label, why: 'open-in-editor' });
      continue;
    }

    // The model sees the note's prose only. Its link section is this app's own text, and
    // feeding it in invites the model to paraphrase the links into prose or drop them —
    // and since the write below replaces the whole body, whatever it does not repeat is
    // gone. `chatDistill` learned this the hard way.
    const prior = splitLinkSection(note?.content ?? null);

    const material = await materialFor(candidate.kind, candidate.refId, candidate.items, rows);
    if (!material.text.trim()) {
      out.skipped.push({ label: candidate.label, why: 'no-material' });
      continue;
    }

    const res = await chat(llm, {
      model,
      messages: [
        {
          role: 'user',
          content: buildDistillPrompt(candidate.kind, input.lang, candidate.label, material.text, prior.body || null),
        },
      ],
      maxTokens: 2000,
      temperature: 0,
      responseFormat: 'json_object',
      timeoutMs: 90_000,
    });

    if (!res.ok) {
      if (res.code && STOP_CODES.has(res.code)) {
        // The stamp is computed once and both written and returned. Re-reading it back
        // would make `pausedUntil` nullable for no reason — the only way the read differs
        // from the write is if the write failed, in which case reporting the value we
        // meant to store would be a lie, while reporting null tells the caller nothing
        // about when the pause ends. Writing and reporting the same value is also one
        // fewer round trip inside a loop that runs per candidate.
        const until = utcStamp(new Date(Date.now() + PAUSE_MS));
        await setCfg(PAUSE_KEY, until);
        return { ...out, reason: 'paused', pausedUntil: until };
      }
      out.failures.push({ label: candidate.label, why: 'llm-error' });
      continue;
    }
    out.tokens += (res.inTokens ?? 0) + (res.outTokens ?? 0);

    if (res.finishReason === 'length') {
      // Dropped whole, and not written: a merge cut off at the token limit is an
      // incomplete note, and storing it would lose the tail of what the note already had.
      out.failures.push({ label: candidate.label, why: 'truncated' });
      continue;
    }

    const verdict = parseDistillVerdict(res.content);
    if (!verdict) {
      out.failures.push({ label: candidate.label, why: 'parse' });
      continue;
    }
    if (!verdict.worthSaving) {
      // A correct and common answer for a finished task that was routine. Recorded as a
      // decision, so the next press does not pay to be told the same thing again.
      out.skipped.push({ label: candidate.label, why: 'nothing-durable' });
      continue;
    }

    out.proposals.push({
      kind: candidate.kind,
      refId: candidate.refId,
      label: candidate.label,
      watermark: candidate.watermark,
      existingNoteId: note?.id ?? null,
      existingUpdatedAt: note?.updatedAt ?? null,
      title: verdict.title || fallbackTitle(candidate.kind, input.lang, candidate),
      content: verdict.content ?? '',
      items: material.items,
      truncated: material.truncated,
    });
  }

  // Aggregate counters only — no model id, no content. See docs/telemetry.md.
  telTrack('knowledge_distill_suggest', {
    kinds: input.kinds.length,
    proposed: out.proposals.length,
    tokens: out.tokens,
    hosted: llm.mode === 'hosted',
  }).catch(() => {});

  return out;
}

/**
 * What to call the note when the model did not name it.
 *
 * A task and a meeting already carry a name a reader recognises; a report month does not,
 * so it gets a localized one. The `{month}` value is the ref id — a `'YYYY-MM'` string,
 * which is the same in every language and therefore the one part of this that is not
 * translated.
 */
function fallbackTitle(kind: DistillKind, lang: string, candidate: { refId: string; label: string }): string {
  if (kind === 'report') return t('distill.reportTitle', lang, { month: candidate.refId });
  return candidate.label;
}

// ─── Pass 3: write what was reviewed (never spends) ─────────────────────────────

export interface ApplyItem {
  kind: DistillKind;
  refId: string;
  title: string;
  content: string;
  watermark: string;
  existingUpdatedAt: string | null;
}

export interface ApplyResult {
  written: Array<{ kind: DistillKind; refId: string; noteId: string; action: 'created' | 'updated'; title: string }>;
  skipped: Array<{ refId: string; why: string }>;
  unchanged: number;
}

/**
 * Store the notes the user approved, **verbatim**. No model is called here, ever.
 *
 * That separation is the whole point of the two passes. Re-deriving on apply would mean the
 * set the user reviewed and the set that gets written could differ — which is the one thing
 * a confirmation step must not allow. Same argument as `knowledge.applyLinks`.
 */
export async function applyDistill(lang: string, items: ApplyItem[]): Promise<ApplyResult> {
  const heading = t('knowledge.linksHeading', lang);
  const written: ApplyResult['written'] = [];
  const skipped: ApplyResult['skipped'] = [];
  let unchanged = 0;
  const answered: Array<{ key: string; watermark: string }> = [];

  for (const item of items) {
    const unit = unitKey(item.kind, item.refId);

    // The source is re-read now, not trusted from the proposal. A task deleted while the
    // dialog was open, or a month whose reports all went away, must be refused rather than
    // left as a note pointing at nothing.
    const alive = await sourceAlive(item.kind, item.refId);
    if (!alive) {
      skipped.push({ refId: item.refId, why: 'source-missing' });
      continue;
    }

    const note = await existingNote(item.kind, item.refId);
    if (note && item.existingUpdatedAt !== null && note.updatedAt !== item.existingUpdatedAt) {
      // Stricter than `applyLinks`, deliberately. That one *merges* into a link section, so
      // a concurrent edit survives it. This one replaces the entire body — so an edit made
      // between the review and the press would be destroyed, and refusing is the difference
      // between a confirmation step and a data-loss window.
      skipped.push({ refId: item.refId, why: 'note-changed' });
      continue;
    }

    const body = (item.content || '').substring(0, MAX_CONTENT);
    // The link section is this app's own text and is not part of what the user reviewed.
    // Rebuilt around the new body rather than dropped: a `[[link]]` the backfill added, or
    // one the user typed by hand, would otherwise vanish in a write they did not make.
    const priorTitles = parseLinks(splitLinkSection(note?.content ?? null).section).map((l) => l.title);
    const content = priorTitles.length
      ? replaceLinkSection(body, priorTitles, heading)
      : body.replace(/\s+$/, '') || body;

    if (note && note.title === item.title && note.content === content) {
      // Same bytes. Writing anyway would bump `updatedAt`, which makes the map report
      // itself stale and re-queues the note for embedding — for no change.
      unchanged++;
      answered.push({ key: unit, watermark: item.watermark });
      continue;
    }

    const now = utcStamp();
    if (note) {
      await prisma.knowledgePage.update({
        where: { id: note.id },
        data: { title: item.title, content, updatedAt: now },
      });
      written.push({ kind: item.kind, refId: item.refId, noteId: note.id, action: 'updated', title: item.title });
    } else {
      // No row, even though the proposal named one: the note was deleted while the dialog
      // was open. Created rather than refused — the user approved this content, and the
      // thing they approved still belongs in the library.
      const created = await prisma.knowledgePage.create({
        data: {
          projectId: DEFAULT_PROJECT_ID,
          title: item.title,
          content,
          category: CATEGORY_OF[item.kind],
          status: 'active',
          source: SOURCE_OF[item.kind],
          sourceId: item.refId,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      });
      written.push({ kind: item.kind, refId: item.refId, noteId: created.id, action: 'created', title: item.title });
    }
    answered.push({ key: unit, watermark: item.watermark });
  }

  await rememberReviewed(answered);

  // Aggregate counters only — no model id, no content. See docs/telemetry.md.
  telTrack('knowledge_distill_apply', { written: written.length, unchanged, skipped: skipped.length }).catch(() => {});

  return { written, skipped, unchanged };
}

/** Does the source this note would be distilled from still exist? */
async function sourceAlive(kind: DistillKind, refId: string): Promise<boolean> {
  if (kind === 'task') {
    return !!(await prisma.issue.findUnique({ where: { id: refId }, select: { id: true } }));
  }
  if (kind === 'meeting') {
    return !!(await prisma.meeting.findUnique({ where: { id: refId }, select: { id: true } }));
  }
  // A month has no row of its own; it is alive while any report claims it.
  const any = await prisma.report.findFirst({ where: { generatedAt: { startsWith: refId } }, select: { id: true } });
  return !!any;
}
