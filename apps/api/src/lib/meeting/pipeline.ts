// ═══ Meeting AI: map-reduce over the transcript ═══
//
// A naive implementation sends the whole transcript to the expensive model three
// times (summary, decisions, action items). An hour-long meeting is 8–15k input
// tokens, so one meeting would burn a large slice of a trial quota.
//
// Instead:
//   MAP   (flash model) — chunk the transcript, summarize each chunk, persist
//                         each summary the moment it arrives.
//   REDUCE (pro model)  — one call over the concatenated chunk summaries.
//
// The expensive model never sees the raw transcript; its input grows with the
// number of chunks, not with the length of the meeting. Map is linear in duration
// but runs on the cheap model. That is the whole point of the design.
//
// Two idempotency boundaries protect the user's money:
//   1. `chunkSummaries` non-empty and !force ⇒ MAP is skipped entirely. A failed
//      or retried SYNTH never re-pays for chunking.
//   2. Artefacts are written only after a complete, successful parse. A truncated
//      response is discarded rather than half-saved.
// `force` is the only way to re-pay for a finished stage, and it re-enters the
// hosted confirmation gate like any other charge.
import { prisma } from '@tomilite/database';
import { isDeepseekEndpoint, resolveLLM, type LLMAccess } from '../gateway';
import { publish } from './events';
import type { TranscriptSegment } from './whisperJob';

// ─── Token accounting ───

const CJK_RE = /[㐀-䶿一-鿿぀-ヿ가-힯]/g;

/**
 * Rough token estimate. A single chars/N divisor under-counts Chinese by ~2.5×,
 * and this app's users are Chinese-first, so CJK characters and Latin words are
 * counted separately. Everywhere this number is shown it is labelled "about".
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) || []).length;
  const words = (text.replace(CJK_RE, ' ').match(/[\p{L}\p{N}'’-]+/gu) || []).length;
  return Math.ceil(cjk / 1.5 + words / 4);
}

// ─── Chunking ───

export interface Chunk {
  startIdx: number;
  endIdx: number; // exclusive
  text: string;
  estTokens: number;
}

const TARGET_CHUNK_TOKENS = 2500;
const OVERLAP_RATIO = 0.1;

/**
 * Split the transcript into token-bounded chunks without ever cutting a segment
 * in half. The boundary is nudged to the largest silence inside a ±15% window,
 * because silence is where a thought ends — cutting mid-sentence costs summary
 * quality at every chunk edge.
 */
export function chunkSegments(segments: TranscriptSegment[], lang: string): Chunk[] {
  if (!segments.length) return [];
  void lang;

  const segTokens = segments.map((s) => Math.max(1, estimateTokens(s.text)));
  const prefix: number[] = [0];
  for (let i = 0; i < segTokens.length; i++) prefix.push(prefix[i] + segTokens[i]);
  const tokensBetween = (a: number, b: number) => prefix[b] - prefix[a];

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < segments.length) {
    let end = start;
    while (end < segments.length && tokensBetween(start, end) < TARGET_CHUNK_TOKENS) end++;
    if (end >= segments.length) {
      chunks.push(makeChunk(segments, start, segments.length));
      break;
    }

    // Candidate cut points are segment indices k meaning "chunk ends before k".
    const lo = start + 1;
    let hi = start + 1;
    while (hi < segments.length && tokensBetween(start, hi) <= TARGET_CHUNK_TOKENS * 1.15) hi++;
    let cut = end;
    if (hi > lo) {
      let bestGap = -1;
      for (let k = lo; k < hi; k++) {
        if (tokensBetween(start, k) < TARGET_CHUNK_TOKENS * 0.85) continue;
        const gap = segments[k].startMs - segments[k - 1].endMs;
        if (gap > bestGap) {
          bestGap = gap;
          cut = k;
        }
      }
    }
    if (cut <= start) cut = start + 1;

    chunks.push(makeChunk(segments, start, cut));

    // Overlap by ~10% of the target so a decision spanning a boundary is seen
    // whole by at least one chunk.
    const overlapTokens = Math.floor(TARGET_CHUNK_TOKENS * OVERLAP_RATIO);
    let next = cut;
    while (next > start + 1 && tokensBetween(next - 1, cut) < overlapTokens) next--;
    start = next;
  }

  return chunks;
}

function makeChunk(segments: TranscriptSegment[], start: number, end: number): Chunk {
  const slice = segments.slice(start, end);
  const text = slice.map((s) => s.text).join(' ');
  return { startIdx: start, endIdx: end, text, estTokens: estimateTokens(text) };
}

// ─── Speaker turns (deliberately honest) ───

/** A pause at least this long is treated as a change of turn. */
const TURN_GAP_MS = 2500;

/**
 * Label turns by pause, NOT by voice. v1 ships no diarization, so this can only
 * ever distinguish "someone stopped and someone started" — it alternates between
 * two labels and will under-count participants. It never emits a name, and the
 * UI states the basis of the label, because a label that looks like voice
 * identification but isn't would be worse than no label at all.
 *
 * Real speaker attribution (sherpa-onnx) is Phase 2; this heuristic is what it
 * will replace, and the `speaker` column is the seam.
 */
export function assignSpeakerTurns(segments: TranscriptSegment[]): string[] {
  const labels: string[] = [];
  let turn = 0;
  for (let i = 0; i < segments.length; i++) {
    if (i > 0 && segments[i].startMs - segments[i - 1].endMs >= TURN_GAP_MS) turn ^= 1;
    labels.push(`Speaker ${turn + 1}`);
  }
  return labels;
}

// ─── LLM call ───

export interface ChatOk {
  ok: true;
  content: string;
  model: string;
  inTokens: number | null;
  outTokens: number | null;
  costCny: number | null;
}
export interface ChatErr {
  ok: false;
  error: string;
  code?: string;
}
export type ChatResult = ChatOk | ChatErr;

export interface ChatOptions {
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/**
 * One non-streaming chat completion. Non-streaming on purpose: nothing renders
 * per-token here, and the response body carries `usage` directly.
 *
 * Cost is read from the gateway's X-LLM-Cost-Cny header and tokens from the
 * usage block. BYOK providers supply neither, and both are recorded as null
 * rather than 0 so "unknown" never masquerades as "free".
 */
export async function chat(llm: LLMAccess, opts: ChatOptions): Promise<ChatResult> {
  const base = llm.baseUrl || '';
  if (!base) return { ok: false, error: 'LLM base URL not configured' };

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 1200,
    temperature: opts.temperature ?? 0,
  };
  // Extraction work — thinking would only burn tokens here.
  if (isDeepseekEndpoint(base)) body.thinking = { type: 'disabled' };
  else if (base.includes('dashscope')) body.enable_thinking = false;

  try {
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      let code: string | undefined;
      try {
        const j = JSON.parse(text);
        if (typeof j?.code === 'string') code = j.code;
      } catch {
        /* non-JSON error body */
      }
      return { ok: false, error: `HTTP ${resp.status}: ${text.substring(0, 200)}`, code };
    }

    const costHeader = resp.headers.get('x-llm-cost-cny');
    const doc = await resp.json();
    const content = doc?.choices?.[0]?.message?.content || '';
    if (!content.trim()) return { ok: false, error: 'empty_response' };

    return {
      ok: true,
      content,
      model: opts.model,
      inTokens: typeof doc?.usage?.prompt_tokens === 'number' ? doc.usage.prompt_tokens : null,
      outTokens: typeof doc?.usage?.completion_tokens === 'number' ? doc.usage.completion_tokens : null,
      costCny: costHeader ? Number(costHeader) || null : null,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ─── Prompts ───

const LANG_LABEL: Record<string, string> = { zh: 'Chinese', ja: 'Japanese', en: 'English' };

function langLabel(lang: string): string {
  return LANG_LABEL[lang] || 'the same language as the transcript';
}

function mapPrompt(chunk: Chunk, i: number, n: number, lang: string): string {
  return `You are reading part ${i + 1} of ${n} of a meeting transcript.
Write a factual summary of THIS PART ONLY, in ${langLabel(lang)}, in at most 220 words, as plain prose (no headings).
Cover, when present: topics discussed, decisions made, action items with owner and due date, names/numbers/dates mentioned.
Do not invent anything that is not in the transcript. Do not add commentary, greetings or meta text.

Transcript part ${i + 1}/${n}:
"""
${chunk.text}
"""`;
}

function synthPrompt(digest: string, speakerLabels: string[], lang: string): string {
  return `You are writing meeting minutes from part-by-part summaries of ONE meeting. The summaries are ordered and are your ONLY source of truth. Never invent facts, names, numbers or dates that are not in them.

Output ONLY valid JSON, no markdown fence, in ${langLabel(lang)}:
{
  "summary": "3-6 short paragraphs in markdown, covering what was discussed and concluded",
  "decisions": ["each decision as one sentence"],
  "actionItems": [{"text":"concrete assignable action","owner":"name or empty","dueDate":"YYYY-MM-DD or empty","priority":"high|medium|low"}],
  "speakers": [{"label":"Speaker 1","inferredRole":"a short guess at their role"}]
}

Rules:
- summary/decisions/actionItems reflect only the summaries. Empty arrays are correct when the meeting decided or assigned nothing.
- actionItems must be concrete and assignable ("Send the revised quote to the client"), never topics ("pricing").
- The speaker labels below come from pause-based turn splitting, NOT voice recognition. They are unreliable as identities. In "speakers", keep the label verbatim and fill inferredRole with a HEDGED guess based on what that person said — phrased as a guess ("可能是项目负责人"), never as fact. Omit any speaker you cannot guess.
- Speaker labels present: ${speakerLabels.join(', ') || 'none'}

Summaries:
"""
${digest}
"""`;
}

// ─── Stage log ───

interface StageEntry {
  stage: string;
  model: string;
  inTokens: number | null;
  outTokens: number | null;
  costCny: number | null;
  ms: number;
  at: string;
  fallback?: boolean;
}

async function appendStage(meetingId: string, entry: StageEntry): Promise<void> {
  try {
    const row = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { stageLog: true } });
    let log: StageEntry[] = [];
    try {
      const parsed = JSON.parse(row?.stageLog || '[]');
      if (Array.isArray(parsed)) log = parsed;
    } catch {
      /* reset a corrupt log rather than fail the run */
    }
    log.push(entry);
    await prisma.meeting.update({ where: { id: meetingId }, data: { stageLog: JSON.stringify(log) } });
  } catch {
    /* logging must never break the pipeline */
  }
}

function stageFrom(r: ChatOk, stage: string, ms: number, fallback = false): StageEntry {
  return {
    stage,
    model: r.model,
    inTokens: r.inTokens,
    outTokens: r.outTokens,
    costCny: r.costCny,
    ms,
    at: new Date().toISOString(),
    ...(fallback ? { fallback: true } : {}),
  };
}

// ─── JSON parsing ───

function parseJsonLoose<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/^```json?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  }
}

interface SynthOut {
  summary?: string;
  decisions?: unknown;
  actionItems?: unknown;
  speakers?: unknown;
}

interface ActionOut {
  text?: unknown;
  owner?: unknown;
  dueDate?: unknown;
  priority?: unknown;
}

const PRIORITIES = ['high', 'medium', 'low'];

// ─── Estimate ───

export interface MeetingEstimate {
  ok: boolean;
  error?: string;
  transcriptChars: number;
  estInputTokens: number;
  mapCalls: number;
  mapModel: string;
  synthModel: string;
  hosted: boolean;
  cached: boolean;
}

export async function estimateMeeting(meetingId: string): Promise<MeetingEstimate> {
  const base: MeetingEstimate = {
    ok: false,
    transcriptChars: 0,
    estInputTokens: 0,
    mapCalls: 0,
    mapModel: '',
    synthModel: '',
    hosted: false,
    cached: false,
  };

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) return { ...base, error: 'not_found' };

  const llm = await resolveLLM();
  if (!llm) return { ...base, error: 'no_llm' };

  const segments = await prisma.meetingSegment.findMany({
    where: { meetingId },
    orderBy: { idx: 'asc' },
    select: { idx: true, startMs: true, endMs: true, text: true },
  });
  if (!segments.length) return { ...base, error: 'no_transcript' };

  const chunks = chunkSegments(segments as TranscriptSegment[], meeting.lang);
  const cached = !mapRequired(meeting.chunkSummaries);

  // SYNTH input is the chunk summaries; estimated at ~250 tokens each, which is
  // the summary budget rather than a guess at model behaviour.
  const synthInput = chunks.length * 250 + 300;
  const mapInput = cached ? 0 : chunks.reduce((n, c) => n + c.estTokens, 0);

  return {
    ok: true,
    transcriptChars: meeting.transcript?.length || segments.reduce((n, s) => n + s.text.length, 0),
    estInputTokens: mapInput + synthInput,
    mapCalls: cached ? 0 : chunks.length,
    mapModel: llm.flashModel || llm.proModel,
    synthModel: llm.proModel || llm.flashModel,
    hosted: llm.mode === 'hosted',
    cached,
  };
}

/** True when MAP still has to run — no usable cached chunk summaries. */
function mapRequired(json: string | null): boolean {
  try {
    const a = JSON.parse(json || '[]');
    return !Array.isArray(a) || a.length === 0;
  } catch {
    return true;
  }
}

// ─── Run ───

export interface RunOptions {
  force?: boolean;
  /** Hosted traffic costs the user's trial credit — the UI must confirm first. */
  confirmHosted?: boolean;
}

export interface RunResult {
  ok: boolean;
  error?: string;
  code?: string;
  mapCalls?: number;
  cachedMap?: boolean;
  fallback?: boolean;
}

export async function runPipeline(meetingId: string, opts: RunOptions = {}): Promise<RunResult> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) return { ok: false, error: 'not_found' };

  const llm = await resolveLLM();
  if (!llm) return { ok: false, error: 'no_llm' };

  const segments = await prisma.meetingSegment.findMany({
    where: { meetingId },
    orderBy: { idx: 'asc' },
    select: { idx: true, startMs: true, endMs: true, text: true, speaker: true },
  });
  if (!segments.length) return { ok: false, error: 'no_transcript' };

  const force = !!opts.force;
  const chunks = chunkSegments(segments as TranscriptSegment[], meeting.lang);
  const speakerLabels = Array.from(new Set(segments.map((s) => s.speaker).filter((s): s is string => !!s)));

  // ─── Guard: hosted traffic is a charge, never a side effect ───
  const willCallMap = force || mapRequired(meeting.chunkSummaries);
  if (llm.mode === 'hosted' && !opts.confirmHosted && (willCallMap || force || !meeting.summary)) {
    const est = await estimateMeeting(meetingId);
    return { ok: false, error: 'confirm_required', code: 'confirm_required', mapCalls: est.mapCalls };
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { aiStatus: 'running', jobStage: 'map' },
  });

  // ─── MAP ───
  let summaries: string[] = [];
  if (!willCallMap) {
    try {
      const cached = JSON.parse(meeting.chunkSummaries || '[]');
      if (Array.isArray(cached)) summaries = cached.map((s) => String(s));
    } catch {
      summaries = [];
    }
  }

  let mapCalls = 0;
  if (willCallMap || summaries.length !== chunks.length) {
    summaries = [];
    for (let i = 0; i < chunks.length; i++) {
      const t0 = Date.now();
      const r = await chat(llm, {
        model: llm.flashModel || llm.proModel,
        messages: [{ role: 'user', content: mapPrompt(chunks[i], i, chunks.length, meeting.lang) }],
        maxTokens: 700,
      });
      mapCalls++;

      if (!r.ok) {
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { aiStatus: 'failed', jobStage: null },
        });
        publish(meetingId, 'ai:error', { error: r.error, code: r.code, stage: 'map' });
        return { ok: false, error: r.error, code: r.code };
      }

      summaries.push(r.content.trim());
      await appendStage(meetingId, stageFrom(r, 'map', Date.now() - t0));
      // Persist immediately: this array is the idempotency boundary, so a crash
      // or a later failure must not discard chunks the user already paid for.
      await prisma.meeting.update({ where: { id: meetingId }, data: { chunkSummaries: JSON.stringify(summaries) } });

      publish(meetingId, 'ai:progress', {
        stage: 'map',
        done: i + 1,
        total: chunks.length,
        percent: Math.floor(((i + 1) / chunks.length) * 60),
      });
    }
  }

  if (!summaries.length) {
    await prisma.meeting.update({ where: { id: meetingId }, data: { aiStatus: 'failed', jobStage: null } });
    return { ok: false, error: 'map_empty' };
  }

  // ─── REDUCE ───
  await prisma.meeting.update({ where: { id: meetingId }, data: { jobStage: 'synth' } });
  publish(meetingId, 'ai:progress', { stage: 'synth', percent: 65 });

  const digest = summaries.map((s, i) => `[Part ${i + 1}] ${s}`).join('\n\n');
  const synthModel = llm.proModel || llm.flashModel;
  const t0 = Date.now();
  const synth = await chat(llm, {
    model: synthModel,
    messages: [{ role: 'user', content: synthPrompt(digest, speakerLabels, meeting.lang) }],
    maxTokens: 2200,
  });

  let parsed: SynthOut | null = null;
  let usedFallback = false;

  if (synth.ok) {
    parsed = parseJsonLoose<SynthOut>(synth.content);
    if (parsed) await appendStage(meetingId, stageFrom(synth, 'synth', Date.now() - t0));
  } else if (synth.code) {
    // Gateway refusal (quota etc.) — retrying with three calls cannot help.
    await prisma.meeting.update({ where: { id: meetingId }, data: { aiStatus: 'failed', jobStage: null } });
    publish(meetingId, 'ai:error', { error: synth.error, code: synth.code, stage: 'synth' });
    return { ok: false, error: synth.error, code: synth.code };
  }

  // ─── Degraded path: JSON failed to parse → three focused calls ───
  // Costs three pro calls instead of one, but the user gets minutes rather than
  // an error. Recorded in stageLog as `fallback` so the extra spend is explainable.
  if (!parsed) {
    usedFallback = true;
    const draft = synth.ok ? synth.content : digest;

    const [sumRes, decRes, actRes] = await Promise.all([
      chat(llm, {
        model: synthModel,
        messages: [
          {
            role: 'user',
            content: `Write meeting minutes in ${langLabel(meeting.lang)} from these summaries. Markdown, 3-6 short paragraphs, facts only, no invented details, no headings.\n\n${digest}`,
          },
        ],
        maxTokens: 1600,
      }),
      chat(llm, {
        model: synthModel,
        messages: [
          {
            role: 'user',
            content: `List the decisions made in this meeting, in ${langLabel(meeting.lang)}. Output ONLY a JSON array of strings, no fence. Empty array if none.\n\n${draft}`,
          },
        ],
        maxTokens: 700,
      }),
      chat(llm, {
        model: synthModel,
        messages: [
          {
            role: 'user',
            content: `List the action items from this meeting, in ${langLabel(meeting.lang)}. Output ONLY a JSON array of objects, no fence: [{"text":"","owner":"","dueDate":"","priority":"high|medium|low"}]. Concrete assignable actions only. Empty array if none.\n\n${draft}`,
          },
        ],
        maxTokens: 900,
      }),
    ]);

    for (const [stage, r] of [
      ['synth:summary', sumRes],
      ['synth:decisions', decRes],
      ['synth:actions', actRes],
    ] as const) {
      if (r.ok) await appendStage(meetingId, stageFrom(r, stage, 0, true));
    }

    if (!sumRes.ok || !sumRes.content.trim()) {
      await prisma.meeting.update({ where: { id: meetingId }, data: { aiStatus: 'failed', jobStage: null } });
      publish(meetingId, 'ai:error', { error: sumRes.ok ? 'empty_response' : sumRes.error, stage: 'synth' });
      return { ok: false, error: sumRes.ok ? 'empty_response' : sumRes.error };
    }

    parsed = {
      summary: sumRes.content.trim(),
      decisions: parseJsonLoose<unknown[]>(decRes.ok ? decRes.content : '[]') || [],
      actionItems: parseJsonLoose<unknown[]>(actRes.ok ? actRes.content : '[]') || [],
      speakers: [],
    };
  }

  // ─── Persist ───
  const summary = String(parsed.summary || '').trim();
  if (!summary) {
    await prisma.meeting.update({ where: { id: meetingId }, data: { aiStatus: 'failed', jobStage: null } });
    return { ok: false, error: 'empty_summary' };
  }

  const decisions = (Array.isArray(parsed.decisions) ? parsed.decisions : [])
    .map((d) => String(d).trim())
    .filter(Boolean);

  const actionItems = (Array.isArray(parsed.actionItems) ? parsed.actionItems : [])
    .filter((a): a is ActionOut => !!a && typeof a === 'object')
    .map((a) => ({
      text: String(a.text || '').trim(),
      owner: a.owner ? String(a.owner).trim() : null,
      dueDate: a.dueDate ? String(a.dueDate).trim() : null,
      priority: PRIORITIES.includes(String(a.priority)) ? String(a.priority) : 'medium',
    }))
    .filter((a) => a.text.length > 0);

  const speakers = (Array.isArray(parsed.speakers) ? parsed.speakers : [])
    .filter((s): s is { label?: unknown; inferredRole?: unknown } => !!s && typeof s === 'object')
    .map((s) => ({ label: String(s.label || '').trim(), inferredRole: String(s.inferredRole || '').trim() }))
    // A guess with no label is unusable, and the label must stay a neutral
    // "Speaker N" — never let a model name a person it cannot identify.
    .filter((s) => /^Speaker \d+$/.test(s.label));

  await prisma.$transaction(async (tx) => {
    await tx.meetingActionItem.deleteMany({ where: { meetingId, status: 'open' } });
    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        summary,
        decisions: JSON.stringify(decisions),
        speakers: speakers.length ? JSON.stringify(speakers) : null,
        aiStatus: 'done',
        jobStage: null,
        minutesStatus: 'draft',
        minutes: meeting.minutes || summary,
        minutesSubject: meeting.minutesSubject || meeting.title,
      },
    });
    for (let i = 0; i < actionItems.length; i++) {
      const a = actionItems[i];
      await tx.meetingActionItem.create({
        data: {
          meetingId,
          idx: i,
          text: a.text,
          owner: a.owner,
          dueDate: a.dueDate,
          priority: a.priority,
          status: 'open',
        },
      });
    }
  });

  publish(meetingId, 'ai:progress', { stage: 'synth', percent: 100 });
  publish(meetingId, 'ai:done', { actionItems: actionItems.length, decisions: decisions.length });

  return { ok: true, mapCalls, cachedMap: !willCallMap, fallback: usedFallback };
}
