// ═══ Local embeddings (ONNX, in-process) ═══
//
// Why local: the vector machinery already existed (`vector` column, cosineSimilarity,
// semanticRank) but had never produced a usable vector. `embedText` called the LLM's
// /embeddings endpoint behind a guard that rejected DeepSeek, Anthropic and the hosted
// gateway while letting OpenAI, Qwen and Kimi through. DeepSeek users — the default
// configuration — and hosted-trial users therefore got null on every call; OpenAI and Qwen
// users got a real vector of a foreign width (1536 and 1024 respectively, taking the
// provider's documented embedding model) written into the same column a 384-dim query
// reads; Kimi's outcome depended on whether Moonshot serves /embeddings at all, and a
// 404-then-catch would have been the benign case. The foreign-width outcome is the worse
// one: cosineSimilarity returns 0 on a length mismatch, so those rows rank last forever
// and nothing is logged. A local model has no endpoint to be rejected by, works offline,
// costs nothing per call, and cannot leak note text.
//
// The model is NOT bundled: it is fetched on first use into
// <TL_USER_DATA>/models/embed/ (see modelFiles.ts). Until it arrives, every function
// here returns null and the callers degrade to keyword search.
//
// ## The load is lazy on purpose — blast radius, not speed
//
// `searchNotesSemantic` sits in the static import graph of server.ts (via the agent
// dispatcher). A top-level `import '@huggingface/transformers'` would therefore pull the
// native ONNX binding — and that package's unconditional top-level `require('sharp')` —
// into API startup. Any platform where either is missing would then fail to boot the
// whole app rather than lose one search feature. Everything is behind `await import()`
// inside getExtractor().
import { EMBED_DIMS, embedModelId, embedModelsRoot, isModelInstalled } from './modelFiles.js';

// Re-exported so this module is the whole public surface of the embedding subsystem and
// callers never need to know that the model layout lives in a sibling file. Node ESM
// requires the re-export to be explicit — importing a name is not the same as exporting it.
export { EMBED_DIMS, embedModelId, isModelInstalled };

/** Mirrors the `dtype` below; part of the stored-vector contract (see decodeVector). */
const QUANT = 'q8';

/** Measured on the development machine (Electron 43 / Node 24, first call per process):
 *  11.2 s to build the ONNX session, then 14-18 ms per inference. The 11 s is real and
 *  unavoidable per process — it was identical on a warm filesystem cache — which is why
 *  nothing on the startup path may await it. */
const MAX_LENGTH = 512;

export type EmbedStatus = 'absent' | 'downloading' | 'ready' | 'failed' | 'disabled';

/** What `pipeline('feature-extraction', …)` returns once handed the options below:
 *  one pooled vector per input, not the [tokens, dims] tensor it returns by default. */
type FeatureExtractor = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean; truncation: boolean; max_length: number },
) => Promise<{ dims: number[]; data: Float32Array }>;

let extractorPromise: Promise<FeatureExtractor | null> | null = null;
let loaded = false;
let status: EmbedStatus | null = null;
let downloading = false;
let loggedFailure = false;

/** Serializes every inference. A 90-note backfill would otherwise try to open 90 ONNX
 *  sessions at once and pin every core on the machine. */
let chain: Promise<unknown> = Promise.resolve();

function log(msg: string): void {
  console.warn('[Embed] ' + msg);
}

export function isEmbedDisabled(): boolean {
  return process.env.TL_EMBED_DISABLE === '1';
}

/**
 * Whether the model is already resident. Synchronous and never blocks — this is what
 * latency-sensitive callers gate on, because the alternative is an 11 s stall in the
 * middle of an agent turn.
 */
export function isEmbedLoaded(): boolean {
  return loaded;
}

/**
 * Reconcile the cached state against the facts on disk, rather than trusting a value
 * written by a previous process. `ready` means "the files are present and will load" —
 * not "already resident", since the 11 s session build happens on demand.
 */
export async function embedModelStatus(): Promise<EmbedStatus> {
  if (isEmbedDisabled()) return 'disabled';
  if (downloading) return 'downloading';
  if (status === 'failed') return 'failed';
  return isModelInstalled() ? 'ready' : 'absent';
}

/**
 * Load the model, or explain why we cannot. Caches the outcome — with one exception.
 *
 * A *failure* is cached: a broken ONNX runtime will not repair itself mid-session, and
 * retrying would charge 11 s to whichever query came next. An *absent model* is not
 * cached, because the model legitimately arrives later in the same session — that is
 * precisely what the boot sweep does — and caching "absent" would leave search degraded
 * until the next restart.
 */
async function getExtractor(): Promise<FeatureExtractor | null> {
  if (extractorPromise) return extractorPromise;

  if (isEmbedDisabled()) return null;
  if (!isModelInstalled()) {
    status = 'absent';
    return null;
  }

  extractorPromise = (async () => {
    const t0 = Date.now();
    const { pipeline, env } = await import('@huggingface/transformers');
    // Constructed to be offline: the files are already on disk and are hash-verified at
    // download time, so letting the library reach the network here would only add a
    // second, unchecked download path behind the user's back.
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = embedModelsRoot();
    env.useFSCache = false;
    const extractor = (await pipeline('feature-extraction', embedModelId(), {
      dtype: QUANT,
      // Sequential execution on a desktop app: the machine is doing other things, and
      // the throughput difference at this size does not pay for the contention.
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1, executionMode: 'sequential' },
    })) as unknown as FeatureExtractor;
    loaded = true;
    status = 'ready';
    log(`model ready in ${Date.now() - t0} ms (${embedModelId()} ${QUANT}, ${EMBED_DIMS}d)`);
    return extractor;
  })().catch((e: unknown) => {
    status = 'failed';
    if (!loggedFailure) {
      loggedFailure = true; // one line per process, not one per query
      log('model load failed, semantic search disabled: ' + (e instanceof Error ? e.message : String(e)));
    }
    return null;
  });

  return extractorPromise;
}

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/**
 * Embed one already-prefixed string.
 *
 * The emptiness check is on the RAW text, before the prefix is added, and that has to
 * happen in the caller-facing functions below: `'query: ' + ''` is the non-empty string
 * `'query: '`, so a guard inside this function never fires and an empty note quietly gets
 * a real vector — the mean of every empty-prefixed input the model has ever seen, which
 * is the same vector for every empty string and therefore sorts identically against
 * everything. `embedWith` is the only entry point, so the check cannot be bypassed.
 */
async function embedOne(text: string): Promise<number[] | null> {
  try {
    const extractor = await getExtractor();
    if (!extractor) return null;
    return await serial(async () => {
      // pooling/normalize are not optional: feature-extraction returns a [tokens, 384]
      // tensor by default, and handing that to cosineSimilarity yields NaN, not an error.
      const out = await extractor(text, {
        pooling: 'mean',
        normalize: true,
        truncation: true,
        max_length: MAX_LENGTH,
      });
      return Array.from(out.data);
    });
  } catch (e: unknown) {
    if (!loggedFailure) {
      loggedFailure = true;
      log('inference failed: ' + (e instanceof Error ? e.message : String(e)));
    }
    return null;
  }
}

const QUERY_PREFIX = 'query: ';
const PASSAGE_PREFIX = 'passage: ';

/** The single place a prefix is applied. Empty input is rejected BEFORE prefixing — see
 *  the note on embedOne for why that ordering is load-bearing. */
async function embedWith(prefix: string, text: string): Promise<number[] | null> {
  if (!text || !text.trim()) return null;
  return embedOne(prefix + text);
}

/**
 * Embed a search query.
 *
 * The two prefixes are load-bearing and are therefore welded in here rather than left to
 * callers: e5 was trained with `query:` / `passage:` asymmetry, and dropping them is the
 * classic way to get a model that runs fine and retrieves badly. Measured on the pair
 * ("数据库迁移" → "Database migration runbook" against a wrong passage), the margin over
 * the wrong pairing was 0.0354 prefixed vs 0.0212 unprefixed — the absolute similarity
 * is *lower* with the prefixes, which is exactly why comparing absolute values is
 * meaningless here.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  return embedWith(QUERY_PREFIX, text);
}

/** Embed documents for storage. One slot per input; a failed slot is null, never a
 *  silently shortened array — callers index by position. */
export async function embedPassages(texts: string[]): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = [];
  for (const t of texts) out.push(await embedWith(PASSAGE_PREFIX, t));
  return out;
}

/** One passage — the storage path's common case, and the one worth naming. */
export async function embedPassage(text: string): Promise<number[] | null> {
  return embedWith(PASSAGE_PREFIX, text);
}

/** What is embedded for a note or report: the title carries most of the signal, so
 *  dropping it would make a well-titled note less findable than its body deserves. */
export function embedTextFor(title: string | null, body: string | null): string {
  // Inlined images are data URLs — `MarkdownEditor` writes them for a pasted or
  // local-file image, and the note importer writes the same shape. They are hundreds of
  // kilobytes of base64, they tokenize slowly, and they push the prose straight out of
  // E5's 512-token window — so a note with one screenshot embedded ended up with a
  // vector that represented the screenshot's base64 rather than its text. The alt text
  // is kept, which is the only part of an image that carries meaning to the model.
  const text = (body || '').replace(/!\[[^\]]*\]\(\s*data:[^)]*\)/g, '');
  return `${title || ''}\n${text}`.trim();
}

// ─── Stored-vector envelope ───
//
// `{"v":[...],"m":"Xenova/multilingual-e5-small@q8"}`
//
// An envelope rather than a `vectorMeta` column on purpose: a new column means
// SCHEMA_VERSION 24, which means a raw migration entry, which means `prisma db push`
// touching the user's database — on a path that never retries a failure and never takes
// a backup (see lib/ftsIndex.ts). The envelope gives the same invalidation semantics for
// zero migration surface: a vector written by a different model, a different
// quantization, or the old remote API is simply not recognised, and the caller recomputes.
//
// 5 decimal places: full float64 JSON is ~8 KB per row for no retrieval benefit, since
// cosine is already normalizing away far more than the 5th decimal.

const DECIMALS = 5;

export function encodeVector(v: number[], modelId: string = embedModelId()): string {
  const v5 = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) v5[i] = Number(v[i].toFixed(DECIMALS));
  return JSON.stringify({ v: v5, m: `${modelId}@${QUANT}` });
}

/**
 * Parse a stored vector, or null to force a recompute.
 *
 * Null is returned for every one of: unparseable JSON, a bare array (the shape the
 * removed remote path wrote, at 1536 dims), a different model or quantization, and a
 * length that is not EMBED_DIMS. Every one of those cases has to be a miss rather than a
 * zero, because a zero-length or NaN vector would silently sort last forever instead of
 * being replaced.
 */
export function decodeVector(raw: string | null | undefined, modelId: string = embedModelId()): number[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const env = parsed as { v?: unknown; m?: unknown };
  if (env.m !== `${modelId}@${QUANT}`) return null;
  if (!Array.isArray(env.v) || env.v.length !== EMBED_DIMS) return null;
  for (const x of env.v) if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return env.v as number[];
}

/** Cosine similarity between two equal-length vectors. Moved here from
 *  agent/utils/search.ts, which re-exports it so existing callers are unaffected. */
export function cosineSimilarity(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Model installation ───

/**
 * Load the model if it is already on disk. Never downloads — this is the warm-up, and
 * its whole job is to pay the 11 s session-build cost while nobody is waiting.
 */
export async function embedWarmup(): Promise<void> {
  if (isEmbedDisabled() || !isModelInstalled()) return;
  await getExtractor();
}

/** Flip the status while a download is in flight so `embedModelStatus()` is honest. */
export function setEmbedDownloading(on: boolean): void {
  downloading = on;
  if (on) status = 'downloading';
}

/**
 * Forget a cached failure so the next call tries to build the session again.
 *
 * `getExtractor()` deliberately caches a failure for the life of the process — a broken
 * ONNX runtime does not repair itself, and retrying costs 11 s to whichever query came
 * next. The consequence is that `status === 'failed'` is a latch, and every caller that
 * offers the user a retry is offering a button that does nothing: `embedModelStatus()`
 * short-circuits on that latch before it ever looks at the disk, so even downloading the
 * model by hand leaves the feature dead until the app restarts.
 *
 * This is the latch release. It is intentionally all-or-nothing — `extractorPromise`,
 * the cached `status`, `loaded` and the one-line-per-process log guard are one fact
 * stored in four places, and clearing three of them would leave the next attempt both
 * retrying and silent.
 *
 * `downloading` is left alone: a download in flight is not a failure, and cancelling its
 * flag here would let a second one start on top of it.
 */
export function resetEmbedStatus(): void {
  extractorPromise = null;
  loaded = false;
  status = null;
  loggedFailure = false;
}
