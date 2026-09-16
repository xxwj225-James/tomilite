// ═══ Embedding model files ═══
//
// Same delivery mechanism as the whisper models: fetched on first use into
// <TL_USER_DATA>/models/embed/<modelId>/, never bundled in the installer. The 135 MB
// payload is too large to ship and most users would only ever need it once.
//
// Two deliberate differences from lib/meeting/models.ts:
//
//   * **The host order is inverted.** huggingface.co is the canonical source but is not
//     reachable from every network — measured from the machine this was written on, the
//     request failed to connect (curl exit 000) while hf-mirror.com returned 200. So the
//     mirror is tried first, and huggingface.co is the fallback rather than the reverse.
//   * **Every file carries a pinned SHA-256.** transformers.js has its own downloader;
//     it validates nothing. A truncated or substituted weight file would load happily and
//     then produce quietly wrong vectors, which is the single worst failure mode for a
//     retrieval feature — search would simply return plausible nonsense forever. The
//     sizes are checked as well, because a 118 MB file that arrives one byte short is
//     otherwise indistinguishable from a good one.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS_DIR, ensureDir } from '../meeting/paths.js';
import { downloadOnce, type DownloadHandlers } from '../meeting/models.js';

/** e5-small is 384-dimensional. The number is part of the stored-vector contract —
 *  see encodeVector/decodeVector in ./index.ts. */
export const EMBED_DIMS = 384;

export interface ModelFile {
  /** Path relative to the model directory — mirrors the layout transformers.js expects
   *  under `env.localModelPath`. */
  rel: string;
  bytes: number;
  sha256: string;
}

/**
 * `onnx/model_quantized.onnx` is what `dtype: 'q8'` resolves to. The others are the
 * tokenizer and config; `tokenizer.json` is 17 MB on its own because e5 uses the
 * multilingual XLM-R sentencepiece vocabulary.
 *
 * Hashes were computed from files fetched over hf-mirror.com on 2026-09-12. For the two
 * LFS-backed files the values also match the `lfs.oid` the Hugging Face API reports for
 * the repo, which is an independent confirmation rather than a self-consistent one.
 */
export const MODEL_FILES: ModelFile[] = [
  {
    rel: 'config.json',
    bytes: 658,
    sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1',
  },
  {
    rel: 'tokenizer_config.json',
    bytes: 443,
    sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
  },
  {
    rel: 'tokenizer.json',
    bytes: 17_082_730,
    sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
  },
  {
    rel: 'onnx/model_quantized.onnx',
    bytes: 118_308_185,
    sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
  },
];

export const DEFAULT_MODEL_ID = 'Xenova/multilingual-e5-small';

/**
 * The model id from `TL_EMBED_MODEL`, else the default. Validated because it is read from
 * the environment and is interpolated into a filesystem path — without the check,
 * `TL_EMBED_MODEL=../../..` would turn "download a model" into "write outside the data
 * directory".
 */
export function embedModelId(): string {
  const raw = (process.env.TL_EMBED_MODEL || '').trim() || DEFAULT_MODEL_ID;
  return /^[\w.-]+\/[\w.-]+$/.test(raw) ? raw : DEFAULT_MODEL_ID;
}

/** `<DATA_DIR>/models/embed` — the `env.localModelPath` root. */
export const embedModelsRoot = () => join(MODELS_DIR, 'embed');

/** `<DATA_DIR>/models/embed/<org>/<name>` — the directory transformers.js reads. */
export const embedModelDir = () => join(embedModelsRoot(), embedModelId());

export const embedFilePath = (rel: string) => join(embedModelDir(), rel);

function hostList(): string[] {
  const override = process.env.TL_EMBED_MODEL_MIRROR || process.env.TL_WHISPER_MODEL_MIRROR;
  if (override) return override.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  return ['https://hf-mirror.com', 'https://huggingface.co'];
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  // Streamed: the weight file is 118 MB and there is no reason to hold it in memory.
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Presence check by size only, deliberately.
 *
 * Hashing all 135 MB here would cost a ~0.3-1 s read on every boot, and this runs on the
 * boot path. The hash is enforced at download time, where corruption actually happens;
 * a file that is the right size but wrong in content would still fail loudly inside
 * onnxruntime the first time it is loaded.
 */
export function missingFiles(): ModelFile[] {
  return MODEL_FILES.filter((f) => {
    const p = embedFilePath(f.rel);
    try {
      return !existsSync(p) || statSync(p).size !== f.bytes;
    } catch {
      return true;
    }
  });
}

export function isModelInstalled(): boolean {
  return missingFiles().length === 0;
}

export interface InstallResult {
  ok: boolean;
  error?: string;
  /** Files this call actually fetched; empty when the model was already complete. */
  downloaded: string[];
}

/**
 * Fetch every missing file, host by host. Resolves `{ok:false}` rather than throwing so
 * the caller (a background sweep) never has to guard against it.
 */
export async function installEmbedModel(handlers: DownloadHandlers): Promise<InstallResult> {
  const missing = missingFiles();
  if (missing.length === 0) return { ok: true, downloaded: [] };

  ensureDir(embedModelDir());
  const hosts = hostList();
  const downloaded: string[] = [];
  let lastError = '';

  for (const file of missing) {
    const finalPath = embedFilePath(file.rel);
    const partPath = finalPath + '.part';
    let done = false;
    for (const host of hosts) {
      const url = `${host}/${embedModelId()}/resolve/main/${file.rel}`;
      try {
        await downloadOnce(url, partPath, handlers);
        // downloadOnce only ever writes to partPath; the hash is checked there, so a
        // mismatching file is never renamed into place and the next boot retries.
        const got = await sha256File(partPath);
        if (got !== file.sha256) throw new Error(`sha256 mismatch for ${file.rel}: got ${got}`);
        renameSync(partPath, finalPath);
        downloaded.push(file.rel);
        done = true;
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        try {
          if (existsSync(partPath)) rmSync(partPath);
        } catch {
          /* best effort */
        }
        // An aborted signal is the user's own cancel — do not fail over to another host.
        if (handlers.signal?.aborted) return { ok: false, error: 'aborted', downloaded };
        if (host !== hosts[hosts.length - 1]) handlers.onHostFailover?.(host);
      }
    }
    if (!done) return { ok: false, error: `${file.rel}: ${lastError}`, downloaded };
  }

  return { ok: true, downloaded };
}
