import { prisma } from '@tomilite/database';
import { utcStamp } from './dbTime.js';
import { resolveLLM } from './gateway.js';
import { chat } from './meeting/pipeline.js';
import { track as telTrack } from './telemetry.js';
import { t } from './i18n.js';
import { DEFAULT_PROJECT_ID } from '../agent/utils/constants.js';

// ═══════════════════════════════════════════════════════════════════════════
// Chat → Knowledge auto-distillation
//
// Background job: after a conversation has been idle for a while and has
// accumulated enough new messages, ask the model to fold that window into a
// single rolling note per session. The note lands in KnowledgePage, so the FTS
// triggers index it and the user sees it in the Notes panel.
//
// The watermark IS the job state — no queue table. `distillCursor` only ever
// advances after a successful write, so a crash simply replays that window.
// ═══════════════════════════════════════════════════════════════════════════

const IDLE_MS = 3 * 60_000; // session must be quiet this long
const MIN_MESSAGES = 6; // …and have at least this many new messages
const WINDOW = 40; // messages fed to the model per run
const MAX_SESSIONS_PER_SWEEP = 3;
const BACKOFF_MS = 30 * 60_000; // per-session retry floor after a run/attempt
const PAUSE_MS = 6 * 60 * 60_000; // quota/account brake
const MAX_CONTENT = 8000; // stored note body cap
const MAX_EXISTING_FOR_PROMPT = 4000;
const MAX_MSG_CHARS = 1500;

/** Gateway error codes that mean "stop spending", not "retry later". */
const STOP_CODES = new Set(['quota_exhausted', 'feature_closed', 'account_disabled', 'model_not_allowed']);

const LANG_LABEL: Record<string, string> = { zh: 'Chinese', ja: 'Japanese', en: 'English' };

export interface DistillRunResult {
  sessions: number;
  notesWritten: number;
  skipped: number;
  errors: number;
}

type SessionOutcome = 'distilled' | 'empty' | 'skipped' | 'paused' | 'error';

let sweeping = false;
const inFlight = new Set<string>();

// ─── Time helpers ───
// Every stamp this job writes is UTC, via lib/dbTime.ts. It used to use a private
// `localStamp()` for the distilled note, which is what made KnowledgePage.updatedAt a
// mixed column: the note write was local while the note panel's own saves were UTC.

// ─── SystemConfig helpers ───

async function getCfg(key: string): Promise<string | null> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function setCfg(key: string, value: string): Promise<void> {
  try {
    await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  } catch {
    /* best-effort */
  }
}

// ─── Run accounting ───

interface DistillMeta {
  at?: string;
  msgs?: number;
  model?: string;
  inTokens?: number | null;
  outTokens?: number | null;
  costCny?: number | null;
  noteId?: string | null;
  ok?: boolean;
  err?: string;
}

function parseMeta(raw: string | null | undefined): DistillMeta | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as DistillMeta) : null;
  } catch {
    return null;
  }
}

async function stampAttempt(sessionId: string, meta: DistillMeta, cursor?: string): Promise<void> {
  try {
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        distillAt: utcStamp(),
        distillMeta: JSON.stringify(meta),
        ...(cursor ? { distillCursor: cursor } : {}),
      },
    });
  } catch {
    /* best-effort — a failed stamp only costs a redundant re-run */
  }
}

// ─── Prompt + parsing ───

function buildPrompt(lang: string, existing: string | null, window: Array<{ role: string; text: string }>): string {
  const langName = LANG_LABEL[lang] || 'English';
  const transcript = window
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text.substring(0, MAX_MSG_CHARS)}`)
    .join('\n');
  return `You maintain a long-term knowledge note for one recurring conversation in a developer's productivity app. Read the transcript window and reply with ONLY a JSON object — no prose, no code fences.

If the window contains nothing durable, reply exactly: {"worthSaving":false}
Otherwise reply:
{"worthSaving":true,"title":"<=60 chars, specific","content":"markdown, <=3000 chars, in ${langName}"}

Rules:
- Keep only what a future conversation would need: decisions and their reasons, standing preferences, project facts, conventions, unresolved threads.
- Drop chit-chat, one-off questions, restatements of the transcript, and anything already present in the EXISTING NOTE.
- Write the content in ${langName}.

EXISTING NOTE (merge into this; return the merged whole, never a diff):
${existing ? existing.substring(0, MAX_EXISTING_FOR_PROMPT) : '(none)'}

TRANSCRIPT WINDOW:
${transcript}`;
}

interface Verdict {
  worthSaving: boolean;
  title?: string;
  content?: string;
}

/** Narrow type guard — no `as`, per the project TS rules. */
function parseVerdict(raw: string): Verdict | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw.substring(start, end + 1));
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const rec = v as Record<string, unknown>;
  if (typeof rec.worthSaving !== 'boolean') return null;
  if (!rec.worthSaving) return { worthSaving: false };
  const title = typeof rec.title === 'string' ? rec.title.trim() : '';
  const content = typeof rec.content === 'string' ? rec.content.trim() : '';
  if (!content) return null; // claimed worth saving but wrote nothing → treat as failure
  return { worthSaving: true, title, content };
}

// ─── Per-session run ───

export async function distillSession(sessionId: string, opts: { force?: boolean } = {}): Promise<SessionOutcome> {
  if (inFlight.has(sessionId)) return 'skipped';
  inFlight.add(sessionId);
  try {
    if ((await getCfg('distill.enabled')) === '0') return 'skipped';

    const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) return 'skipped';

    if (!opts.force) {
      const last = parseMeta(session.distillMeta)?.at;
      if (last && Date.now() - new Date(last).getTime() < BACKOFF_MS) return 'skipped';
    }

    // Local-time column → the bounds must be built the same way data is stored.
    // `gt` on a string works because every createdAt is 'YYYY-MM-DD HH:MM:SS'.
    const cursor = session.distillCursor || '';
    const rows = await prisma.chatMessage.findMany({
      where: { sessionId, ...(cursor ? { createdAt: { gt: cursor } } : {}) },
      orderBy: { createdAt: 'asc' },
      take: WINDOW,
    });
    const fresh = rows.filter((m) => !m.text.startsWith('__FORCE_CREATE__'));
    if (fresh.length < MIN_MESSAGES) return 'skipped';

    const llm = await resolveLLM();
    if (!llm) return 'skipped'; // no key configured is not an error

    const lang = (await getCfg('uiLanguage')) || 'en';
    const existing = await prisma.knowledgePage.findFirst({
      where: { source: 'chat_distill', sourceId: sessionId },
    });
    const model = llm.flashModel || llm.proModel;
    const res = await chat(llm, {
      model,
      messages: [{ role: 'user', content: buildPrompt(lang, existing?.content ?? null, fresh) }],
      maxTokens: 2000,
      temperature: 0,
    });

    // Only advance on success — a crash or a bad response must replay this window.
    const nextCursor = fresh[fresh.length - 1].createdAt;

    if (!res.ok) {
      await stampAttempt(sessionId, { at: utcStamp(), msgs: fresh.length, model, ok: false, err: res.error });
      if (res.code && STOP_CODES.has(res.code)) {
        // Background work must never eat a metered trial's last quota.
        await setCfg('distill.pausedUntil', utcStamp(new Date(Date.now() + PAUSE_MS)));
        return 'paused';
      }
      return 'error';
    }

    const verdict = parseVerdict(res.content);
    if (!verdict) {
      await stampAttempt(sessionId, {
        at: utcStamp(),
        msgs: fresh.length,
        model,
        inTokens: res.inTokens,
        outTokens: res.outTokens,
        costCny: res.costCny,
        ok: false,
        err: 'unparsable_response',
      });
      return 'error';
    }

    const usage: DistillMeta = {
      at: utcStamp(),
      msgs: fresh.length,
      model,
      inTokens: res.inTokens,
      outTokens: res.outTokens,
      costCny: res.costCny,
      noteId: existing?.id ?? null,
      ok: true,
    };

    // Nothing durable in this window — still advance, or the same window would
    // be re-charged to the gateway on every sweep forever.
    if (!verdict.worthSaving) {
      await stampAttempt(sessionId, { ...usage, err: 'nothing_worth_saving' }, nextCursor);
      // Aggregate counters only — no model id, no content. See docs/telemetry.md.
      telTrack('chat_distill', {
        msgs: fresh.length,
        inTokens: res.inTokens,
        outTokens: res.outTokens,
        costCny: res.costCny,
        hosted: llm.mode === 'hosted',
        saved: false,
      }).catch(() => {});
      return 'empty';
    }

    // The model names the note after its topic. Fall back to the session title
    // when it didn't, so the note is still findable in the Notes list.
    const title =
      verdict.title ||
      (session.title ? t('distill.noteTitle', lang, { title: session.title }) : t('distill.untitled', lang));
    const content = (verdict.content || '').substring(0, MAX_CONTENT);
    let noteId: string;
    if (existing) {
      await prisma.knowledgePage.update({
        where: { id: existing.id },
        data: { title, content, updatedAt: utcStamp() },
      });
      noteId = existing.id;
    } else {
      const now = utcStamp();
      const created = await prisma.knowledgePage.create({
        data: {
          projectId: DEFAULT_PROJECT_ID,
          title,
          content,
          category: 'chat', // machine value; the Notes list localizes it
          status: 'active',
          source: 'chat_distill',
          sourceId: sessionId,
          createdAt: now,
          updatedAt: now,
        },
      });
      noteId = created.id;
    }

    await stampAttempt(sessionId, { ...usage, noteId }, nextCursor);
    // Aggregate counters only — no model id, no content. See docs/telemetry.md.
    telTrack('chat_distill', {
      msgs: fresh.length,
      inTokens: res.inTokens,
      outTokens: res.outTokens,
      costCny: res.costCny,
      hosted: llm.mode === 'hosted',
      saved: true,
    }).catch(() => {});
    console.warn(`[distill] session ${sessionId}: ${fresh.length} msgs → note ${noteId}`);
    return 'distilled';
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[distill] session failed:', sessionId, msg);
    await stampAttempt(sessionId, { at: utcStamp(), ok: false, err: msg });
    return 'error';
  } finally {
    inFlight.delete(sessionId);
  }
}

// ─── Sweep ───

export async function runDistillationSweep(opts: { force?: boolean } = {}): Promise<DistillRunResult> {
  const result: DistillRunResult = { sessions: 0, notesWritten: 0, skipped: 0, errors: 0 };
  if (sweeping) return result; // a slow run must not overlap the next tick
  sweeping = true;
  try {
    if (!opts.force) {
      if ((await getCfg('distill.enabled')) === '0') return result;
      const pausedUntil = await getCfg('distill.pausedUntil');
      if (pausedUntil && Date.now() < new Date(pausedUntil).getTime()) return result;
      // updatedAt is UTC — this cutoff must be too, or every session looks 8h
      // (in CN) more/less idle than it really is.
      const candidates = await prisma.chatSession.findMany({
        where: { updatedAt: { lt: utcStamp(new Date(Date.now() - IDLE_MS)) } },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: { id: true },
      });
      for (const s of candidates) {
        if (result.sessions >= MAX_SESSIONS_PER_SWEEP) break;
        const outcome = await distillSession(s.id);
        if (outcome === 'skipped') {
          result.skipped++;
          continue;
        }
        result.sessions++;
        if (outcome === 'distilled') result.notesWritten++;
        else if (outcome === 'error') result.errors++;
        else if (outcome === 'paused') break; // stop the whole sweep
      }
      return result;
    }
    // force: run one specific-or-most-recent idle session regardless of gates
    const one = await prisma.chatSession.findFirst({ orderBy: { updatedAt: 'desc' }, select: { id: true } });
    if (one) {
      const outcome = await distillSession(one.id, { force: true });
      result.skipped = outcome === 'skipped' ? 1 : 0;
      result.sessions = outcome === 'skipped' ? 0 : 1;
      result.notesWritten = outcome === 'distilled' ? 1 : 0;
      result.errors = outcome === 'error' ? 1 : 0;
    }
    return result;
  } catch (e: unknown) {
    console.warn('[distill] sweep failed:', e instanceof Error ? e.message : String(e));
    result.errors++;
    return result;
  } finally {
    sweeping = false;
  }
}

// Manual run for verification: TL_DISTILL_ONCE=1 npx tsx src/lib/chatDistill.ts
if (process.env.TL_DISTILL_ONCE === '1') {
  runDistillationSweep({ force: true })
    .then((r) => console.warn('[distill] run:', JSON.stringify(r)))
    .catch((e) => console.error('[distill] failed:', e instanceof Error ? e.message : String(e)))
    .finally(() => process.exit(0));
}
