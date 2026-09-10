// ═══ Meeting paths ═══
//
// Every meeting artefact lives under DATA_DIR so that moving ~/.tomilite moves
// the whole feature with it. Nothing here is ever written outside it.
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Same convention as lib/crypto.ts, lib/telemetry.ts and server.ts: TL_USER_DATA
// is the debug/test override, ~/.tomilite is the real thing.
export const DATA_DIR = process.env.TL_USER_DATA || join(homedir(), '.tomilite');
export const MEETINGS_DIR = join(DATA_DIR, 'meetings');
export const MODELS_DIR = join(DATA_DIR, 'models');
export const TMP_DIR = join(DATA_DIR, 'meeting-tmp');

export function ensureDir(dir: string): string {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch {
    /* caller surfaces the real error when it tries to write */
  }
  return dir;
}

export const ensureMeetingsDir = () => ensureDir(MEETINGS_DIR);
export const ensureModelsDir = () => ensureDir(MODELS_DIR);
export const ensureTmpDir = () => ensureDir(TMP_DIR);

/**
 * Repo/app root, resolved the same way server.ts resolves it — bundled the API
 * is a single CJS file at <root>/apps/api/dist/server.cjs, so three levels up is
 * the app root. In dev __dirname may be undefined (ESM via tsx) or point at the
 * source tree, so callers must treat the result as a hint and verify candidates.
 */
export function appRoot(): string {
  return typeof __dirname !== 'undefined' ? join(__dirname, '..', '..', '..') : process.cwd();
}

/** First candidate directory that actually contains `relPath`, or null. */
export function firstExisting(candidates: string[], relPath: string): string | null {
  for (const c of candidates) {
    if (existsSync(join(c, relPath))) return c;
  }
  return null;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Guard against path traversal: every id that reaches the filesystem is a uuid
 * we generated, so anything else is rejected outright. This is the only place
 * that turns a client-supplied string into a path component.
 */
export function isSafeId(id: string): boolean {
  return ID_RE.test(id);
}

export function meetingWavPath(id: string): string {
  return join(MEETINGS_DIR, `${id}.wav`);
}

export function meetingMetaPath(id: string): string {
  return join(MEETINGS_DIR, `${id}.meta.json`);
}

export function modelFileName(model: string): string {
  return `ggml-${model}.bin`;
}

export function modelPath(model: string): string {
  return join(MODELS_DIR, modelFileName(model));
}
