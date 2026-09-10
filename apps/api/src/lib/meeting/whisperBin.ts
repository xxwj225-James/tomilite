// ═══ Vendored whisper-cli ═══
//
// The binary is not committed — scripts/fetch-whisper-bin.js downloads the pinned
// b4938 release at pack time into packages/whisper-bin/bin/ (see that package's
// README). At runtime we only locate and sanity-check it: a missing file is
// reported to the UI as "speech model not available", never as a crash.
//
// Layout notes that matter (all measured):
//  - whisper-cli.exe is a 479KB thin shell; whisper.dll + ggml.dll + ggml-base.dll
//    do the work.
//  - ggml picks ONE of nine ggml-cpu-<microarch>.dll at runtime based on the host
//    CPU, so all nine must ship or transcription dies on unfamiliar hardware.
//  - The MSVC runtime (vcomp140/msvcp140/vcruntime140/vcruntime140_1) is NOT in
//    the upstream zip; without it a clean machine fails with 0xC0000135.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { appRoot, firstExisting } from './paths';

const CORE = ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll'];
const CPU_VARIANT = /^ggml-cpu-.*\.dll$/;
const MSVC = ['vcomp140.dll', 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];

let cachedDir: string | null | undefined;

/** Directory holding the vendored binary, or null when it was never fetched. */
export function whisperBinDir(): string | null {
  if (cachedDir !== undefined) return cachedDir;
  cachedDir = firstExisting(
    [
      join(appRoot(), 'packages', 'whisper-bin', 'bin'), // packaged: resources/app/packages/...
      join(process.cwd(), 'packages', 'whisper-bin', 'bin'), // dev: repo root
      join(appRoot(), '..', 'packages', 'whisper-bin', 'bin'), // one level out (unpacked--dir)
    ],
    'whisper-cli.exe',
  );
  return cachedDir;
}

export function whisperCliPath(): string | null {
  const dir = whisperBinDir();
  return dir ? join(dir, 'whisper-cli.exe') : null;
}

export interface WhisperBinStatus {
  ok: boolean;
  path: string | null;
  missing: string[];
  bytes: number;
}

/** Report exactly which files are absent so packaging mistakes are diagnosable. */
export function whisperBinStatus(): WhisperBinStatus {
  const dir = whisperBinDir();
  if (!dir) return { ok: false, path: null, missing: ['whisper-cli.exe'], bytes: 0 };

  const missing: string[] = [];
  let bytes = 0;
  const check = (name: string) => {
    const p = join(dir, name);
    if (!existsSync(p)) {
      missing.push(name);
      return;
    }
    try {
      bytes += statSync(p).size;
    } catch {
      /* size is cosmetic */
    }
  };

  for (const f of [...CORE, ...MSVC]) check(f);

  // Any one CPU variant is enough to run, but the whole set must be present for
  // the binary to work on every machine we ship to — treat <9 as a defect.
  // Their size counts toward the total: they are the bulk of the 10.4MB.
  let cpuVariants = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (!CPU_VARIANT.test(f)) continue;
      cpuVariants++;
      try {
        bytes += statSync(join(dir, f)).size;
      } catch {
        /* size is cosmetic */
      }
    }
  } catch {
    /* fall through — reported as missing variants */
  }
  if (cpuVariants < 9) missing.push(`${9 - cpuVariants} × ggml-cpu-*.dll`);

  return { ok: missing.length === 0, path: join(dir, 'whisper-cli.exe'), missing, bytes };
}

/**
 * Threads passed to whisper-cli via -t. Leaves one core for the UI — the app
 * stays responsive while a long meeting transcribes.
 */
export function whisperThreads(): number {
  return Math.min(8, Math.max(1, cpus().length - 1));
}
