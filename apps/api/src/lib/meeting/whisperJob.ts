// ═══ Whisper transcription job ═══
//
// Runs the vendored whisper-cli.exe as a grandchild of the API process: one job
// at a time (whisper.cpp saturates every core it is given), progress streamed to
// the SSE bus, everything else reported as a typed failure the UI can localize.
//
// Facts below were measured against b4938 on Windows, not assumed:
//
//  • Progress lands on stderr as `whisper_print_progress_callback: progress =   6%`
//    (space padded). `-np` does not suppress it; `-np -pp` gives clean stderr.
//  • Exit code 0 DOES NOT MEAN SUCCESS. Given unreadable audio the CLI exits 0,
//    writes no JSON, and only prints `error: failed to read audio file` on stderr.
//    Success is therefore judged solely by "the output JSON exists and parses
//    with a transcription array". Exit 2 = bad args, 3 = model init failure.
//  • `-bs 1 -bo 1` (greedy) is exactly 2× faster than the default beam search
//    and produced byte-identical output on a 660s sample, so it is the default;
//    `accurate: true` restores beam-5.
//  • offsets are milliseconds and text carries a leading space — both trimmed here.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { publish } from './events';
import { ensureTmpDir, TMP_DIR } from './paths';
import { whisperCliPath, whisperThreads } from './whisperBin';

export interface TranscriptSegment {
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
}

export type WhisperFailure = 'busy' | 'cancelled' | 'no_binary' | 'no_model' | 'no_audio' | 'failed';

export type WhisperResult =
  | { ok: true; segments: TranscriptSegment[]; language: string; text: string }
  | { ok: false; error: WhisperFailure; message?: string };

interface ActiveJob {
  meetingId: string;
  child: ChildProcessWithoutNullStreams;
  cancelled: boolean;
}

let active: ActiveJob | null = null;

export function whisperBusy(): boolean {
  return active !== null;
}

export function activeWhisperMeetingId(): string | null {
  return active?.meetingId ?? null;
}

/** Kill the running job. Resolves true when something was actually stopped. */
export function cancelWhisperJob(meetingId?: string): boolean {
  if (!active) return false;
  if (meetingId && active.meetingId !== meetingId) return false;
  active.cancelled = true;
  try {
    active.child.kill();
  } catch {
    /* already gone */
  }
  return true;
}

// Anchored on the measured format; the leading `\s*` absorbs whisper's padding.
const PROGRESS_RE = /progress\s*=\s*(\d+)%/;
const ESTIMATED_AFTER_MS = 20_000;
// whisper tiny ran at RTF 0.059 with greedy decoding on a 12-core machine; a
// deliberately pessimistic 0.5 keeps the fallback bar moving slowly rather than
// hitting 95% in the first minute and sitting there.
const PESSIMISTIC_RTF = 0.5;

export interface RunOptions {
  meetingId: string;
  wavPath: string;
  modelPath: string;
  /** auto | en | zh | ja … passed straight through as -l */
  lang?: string;
  /** Beam search instead of greedy — ~2× slower, no measured quality gain. */
  accurate?: boolean;
  /** Audio length, used only for the no-progress-lines fallback estimate. */
  durationMs?: number;
}

export async function runWhisperJob(opts: RunOptions): Promise<WhisperResult> {
  if (active) return { ok: false, error: 'busy' };

  const bin = whisperCliPath();
  if (!bin) return { ok: false, error: 'no_binary' };
  if (!existsSync(opts.wavPath)) return { ok: false, error: 'no_audio' };
  if (!existsSync(opts.modelPath)) return { ok: false, error: 'no_model' };

  ensureTmpDir();
  const outBase = join(TMP_DIR, `${opts.meetingId}-${Date.now()}`);
  const jsonPath = outBase + '.json';

  const args = [
    '-m',
    opts.modelPath,
    '-f',
    opts.wavPath,
    '-oj',
    '-of',
    outBase,
    '-np',
    '-pp',
    '-t',
    String(whisperThreads()),
    '-l',
    opts.lang || 'auto',
  ];
  if (!opts.accurate) args.push('-bs', '1', '-bo', '1');

  publish(opts.meetingId, 'progress', { stage: 'transcribe', percent: 0 });

  const startedAt = Date.now();
  const child = spawn(bin, args, {
    windowsHide: true,
    // The API runs as an Electron child with ELECTRON_RUN_AS_NODE=1; harmless for
    // a native exe, but stripped so nothing downstream misreads it.
    env: (() => {
      const e = { ...process.env };
      delete e.ELECTRON_RUN_AS_NODE;
      return e;
    })(),
  }) as ChildProcessWithoutNullStreams;

  const job: ActiveJob = { meetingId: opts.meetingId, child, cancelled: false };
  active = job;

  let stderr = '';
  let lastPercent = 0;
  let lastPublish = 0;
  let sawProgress = false;

  const onData = (buf: Buffer) => {
    stderr += buf.toString('utf-8');
    // Keep only the tail — whisper can be chatty and we only surface errors.
    if (stderr.length > 8000) stderr = stderr.slice(-4000);

    const m = stderr.match(PROGRESS_RE);
    if (m) {
      sawProgress = true;
      const pct = Math.max(0, Math.min(100, parseInt(m[1], 10)));
      if (pct !== lastPercent) lastPercent = pct;
    }
  };
  child.stderr.on('data', onData);
  child.stdout.on('data', onData);

  // The renderer needs a heartbeat even when whisper prints nothing; without it
  // the bar looks frozen for a multi-minute job.
  const ticker = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    let pct = lastPercent;
    if (!sawProgress) {
      if (elapsed < ESTIMATED_AFTER_MS) return;
      const total = (opts.durationMs || 0) * PESSIMISTIC_RTF;
      pct = total > 0 ? Math.min(95, Math.floor(((elapsed - ESTIMATED_AFTER_MS) / total) * 100)) : 0;
    }
    const now = Date.now();
    if (now - lastPublish < 700) return;
    lastPublish = now;
    publish(opts.meetingId, 'progress', { stage: 'transcribe', percent: pct, estimated: !sawProgress });
  }, 700);
  ticker.unref?.();

  const exitCode: number | null = await new Promise((resolve) => {
    child.on('error', (e) => {
      stderr += `\nspawn error: ${e.message}`;
      resolve(-1);
    });
    child.on('close', (code) => resolve(code));
  });

  clearInterval(ticker);
  active = null;

  const cleanupJson = () => {
    try {
      if (existsSync(jsonPath)) rmSync(jsonPath);
    } catch {
      /* best effort */
    }
  };

  if (job.cancelled) {
    cleanupJson();
    return { ok: false, error: 'cancelled' };
  }

  // Exit code is only a hint — see the file header. The JSON is the contract.
  const parsed = readTranscript(jsonPath);
  if (!parsed) {
    cleanupJson();
    const detail = lastMeaningfulLine(stderr);
    if (exitCode === 2) return { ok: false, error: 'failed', message: detail || 'invalid arguments' };
    if (exitCode === 3) return { ok: false, error: 'no_model', message: detail };
    return { ok: false, error: 'failed', message: detail || `whisper exited with code ${exitCode}` };
  }

  cleanupJson();
  publish(opts.meetingId, 'progress', { stage: 'transcribe', percent: 100 });

  return {
    ok: true,
    segments: parsed.segments,
    language: parsed.language,
    text: parsed.segments.map((s) => s.text).join(' '),
  };
}

/**
 * Parse whisper's -oj output. Returns null for a missing/corrupt file, which is
 * how "unreadable audio" (exit 0, no output) is distinguished from success.
 */
function readTranscript(jsonPath: string): { segments: TranscriptSegment[]; language: string } | null {
  try {
    if (!existsSync(jsonPath)) return null;
    const doc = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const rows = doc?.transcription;
    if (!Array.isArray(rows)) return null;

    const segments: TranscriptSegment[] = rows
      .map((r: any, i: number) => ({
        idx: typeof r?.id === 'number' ? r.id : i,
        startMs: Number(r?.offsets?.from ?? 0) || 0,
        endMs: Number(r?.offsets?.to ?? 0) || 0,
        text: String(r?.text ?? '').trim(),
      }))
      .filter((s: TranscriptSegment) => s.text.length > 0)
      .map((s: TranscriptSegment, i: number) => ({ ...s, idx: i }));

    if (!segments.length) return null;
    return { segments, language: String(doc?.result?.language ?? '') };
  } catch {
    return null;
  }
}

// Whisper's own chatter. The real failure is usually a line or two above these,
// and reporting "output_json: saving output to …" as the error is worse than
// reporting nothing.
const NOISE_RE =
  /^(output_json|output_txt|output_vtt|output_srt|output_lrc|output_csv|whisper_|ggml_|main:|system_info|load_|encode_|decode_|mel_)/i;

/** The line that actually explains the failure, if one was printed. */
function lastMeaningfulLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !PROGRESS_RE.test(l) && !NOISE_RE.test(l) && !/^saving output to/i.test(l));
  return lines[lines.length - 1] || '';
}

/** Remove stale temp outputs (called once at boot). */
export function cleanupTempDir(): void {
  try {
    if (!existsSync(TMP_DIR)) return;
    mkdirSync(TMP_DIR, { recursive: true });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const f of readdirSync(TMP_DIR)) {
      const p = join(TMP_DIR, f);
      try {
        if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* non-critical */
  }
}
