// ═══ Whisper model manager ═══
//
// Models are downloaded on first use into ~/.tomilite/models/ — they are far too
// large to ship in the installer (base alone is 142MiB) and the user may only
// ever want one of them.
//
// P0 scope: plain download + progress + cancel + presence check. Resume, SHA-256
// verification and a free-space precheck are deliberately deferred to P1; the
// only robustness here is that we write to `<name>.part` and rename on completion,
// so a truncated file is never mistaken for an installed model.
import { closeSync, existsSync, openSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { modelFileName, modelPath, MODELS_DIR, ensureModelsDir } from './paths';

export interface ModelSpec {
  name: string;
  label: string;
  /** Approximate download size in bytes — for display only, never for validation. */
  bytes: number;
  note: string;
}

export const MODEL_CATALOG: ModelSpec[] = [
  { name: 'tiny', label: 'Tiny', bytes: 77_691_713, note: 'Fastest, least accurate. Good for testing.' },
  { name: 'base', label: 'Base', bytes: 147_951_465, note: 'Recommended balance of speed and accuracy.' },
  { name: 'small', label: 'Small', bytes: 487_601_967, note: 'Noticeably better on accents and noisy rooms.' },
  { name: 'medium', label: 'Medium', bytes: 1_533_774_781, note: 'Best quality, several times slower.' },
];

export const DEFAULT_MODEL = 'base';

export function isKnownModel(name: string): boolean {
  return MODEL_CATALOG.some((m) => m.name === name);
}

export interface InstalledModel extends ModelSpec {
  installed: boolean;
  sizeBytes: number;
}

export function listModels(): InstalledModel[] {
  return MODEL_CATALOG.map((m) => {
    const p = modelPath(m.name);
    let sizeBytes = 0;
    let installed = false;
    try {
      if (existsSync(p)) {
        sizeBytes = statSync(p).size;
        // Guard against a corrupt/truncated file: anything wildly under the
        // expected size is reported as not installed so the UI offers a re-download.
        installed = sizeBytes > m.bytes * 0.5;
      }
    } catch {
      /* treat as absent */
    }
    return { ...m, installed, sizeBytes };
  });
}

export function installedModelNames(): string[] {
  return listModels()
    .filter((m) => m.installed)
    .map((m) => m.name);
}

/** Absolute path to an installed model, or null when it isn't there. */
export function resolveModel(name: string): string | null {
  if (!isKnownModel(name)) return null;
  const p = modelPath(name);
  try {
    return existsSync(p) && statSync(p).size > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Installed models, smallest first. */
export function installedModels(): ModelSpec[] {
  return MODEL_CATALOG.filter((m) => resolveModel(m.name)).sort((a, b) => a.bytes - b.bytes);
}

/**
 * The model that should actually run for a job.
 *
 * Prefer what the meeting asked for, then the default, then anything at all
 * that is installed. That last step matters: a meeting created while the
 * default was `base` would otherwise fail with "no model installed" for a user
 * who deliberately downloaded `small` — a message that is both wrong and
 * unactionable, and the most likely way to get stuck on first run.
 *
 * The unrequested fallback is the *smallest* installed model, not the largest.
 * Silently substituting a 1.5 GB `medium` (RTF ~1.5–3) would turn an hour-long
 * meeting into an hour-long wait, which reads as a hang.
 */
export function pickModel(requested?: string | null): { name: string; path: string } | null {
  for (const name of [requested, DEFAULT_MODEL]) {
    if (!name) continue;
    const path = resolveModel(name);
    if (path) return { name, path };
  }
  const first = installedModels()[0];
  if (!first) return null;
  return { name: first.name, path: resolveModel(first.name) as string };
}

export function deleteModel(name: string): { ok: boolean; error?: string } {
  if (!isKnownModel(name)) return { ok: false, error: 'unknown_model' };
  const p = modelPath(name);
  try {
    if (existsSync(p)) rmSync(p);
    const part = p + '.part';
    if (existsSync(part)) rmSync(part);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Download hosts, tried in order. huggingface.co is the canonical source;
 * hf-mirror.com is a community mirror that is often the only reachable one from
 * mainland China. TL_WHISPER_MODEL_MIRROR overrides the list (comma separated).
 */
function mirrorHosts(): string[] {
  const override = process.env.TL_WHISPER_MODEL_MIRROR;
  if (override) return override.split(',').map((s) => s.trim().replace(/\/+$/, ''));
  return ['https://huggingface.co', 'https://hf-mirror.com'];
}

export interface DownloadHandlers {
  onProgress: (p: { receivedBytes: number; totalBytes: number; percent: number }) => void;
  /** Called when a host produced no bytes for a while and we move to the next one. */
  onHostFailover?: (host: string) => void;
  signal?: AbortSignal;
}

const STALL_MS = 20_000;
const CHUNK_LOG_MS = 400;

/**
 * Download one model. Resolves once the file is complete and renamed into place.
 * Throws on abort or when every host fails.
 */
export async function downloadModel(name: string, handlers: DownloadHandlers): Promise<{ path: string }> {
  if (!isKnownModel(name)) throw new Error('unknown_model');
  ensureModelsDir();

  const finalPath = modelPath(name);
  const partPath = finalPath + '.part';
  const hosts = mirrorHosts();
  let lastError: unknown = null;

  for (let i = 0; i < hosts.length; i++) {
    const url = `${hosts[i]}/ggerganov/whisper.cpp/resolve/main/${modelFileName(name)}`;
    try {
      await downloadOnce(url, partPath, handlers);
      renameSync(partPath, finalPath); // atomic — never a half-file at finalPath
      return { path: finalPath };
    } catch (e) {
      lastError = e;
      try {
        if (existsSync(partPath)) rmSync(partPath);
      } catch {
        /* best effort */
      }
      if (handlers.signal?.aborted) throw e;
      if (i < hosts.length - 1) handlers.onHostFailover?.(hosts[i]);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function downloadOnce(url: string, partPath: string, handlers: DownloadHandlers): Promise<void> {
  const { signal } = handlers;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  // Node's fetch has no idle timeout, so a stalled host would hang forever.
  // A watchdog kills the request when no bytes arrive for STALL_MS and we fail
  // over to the next mirror.
  let watchdog: NodeJS.Timeout | null = null;
  const resetWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => ctrl.abort(), STALL_MS);
    watchdog.unref?.();
  };

  let fd: number | null = null;
  try {
    resetWatchdog();
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);

    const totalBytes = Number(res.headers.get('content-length') || 0) || 0;
    let receivedBytes = 0;
    let lastReport = 0;

    fd = openSync(partPath, 'w');
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      resetWatchdog();
      const buf = Buffer.from(chunk);
      writeSync(fd, buf);
      receivedBytes += buf.length;
      const now = Date.now();
      if (now - lastReport >= CHUNK_LOG_MS) {
        lastReport = now;
        handlers.onProgress({
          receivedBytes,
          totalBytes,
          percent: totalBytes ? Math.min(99, Math.floor((receivedBytes / totalBytes) * 100)) : 0,
        });
      }
    }

    closeSync(fd);
    fd = null;

    if (receivedBytes === 0) throw new Error('empty download');
    if (totalBytes && receivedBytes < totalBytes * 0.99) throw new Error('truncated download');

    handlers.onProgress({ receivedBytes, totalBytes: totalBytes || receivedBytes, percent: 100 });
  } finally {
    if (watchdog) clearTimeout(watchdog);
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
    signal?.removeEventListener('abort', onAbort);
  }
}

export const modelsDir = MODELS_DIR;
