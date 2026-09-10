// ═══ Meeting WAV storage ═══
//
// The renderer POSTs raw Int16LE PCM in 5-second chunks; this module appends it
// to a RIFF/WAVE file on disk. whisper-cli only accepts 16kHz mono PCM, and
// Chromium already resamples to 16kHz when the AudioContext is created with that
// sampleRate — so no encoder, decoder or ffmpeg is involved anywhere.
//
// The header is written as 44 zero bytes and back-filled on finalize. A crash
// therefore leaves a WAV whose header says "0 samples": the `<id>.meta.json`
// sidecar records the truth so a later sweep can repair it rather than lose the
// audio (the repair itself lands in P1).
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { ensureMeetingsDir, meetingMetaPath, meetingWavPath } from './paths';

export const SAMPLE_RATE = 16_000;
export const CHANNELS = 1;
export const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = (BITS_PER_SAMPLE / 8) * CHANNELS; // 2
const HEADER_BYTES = 44;
export const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE;

export function pcmDurationMs(pcmBytes: number): number {
  return Math.round((pcmBytes / BYTES_PER_SECOND) * 1000);
}

function canonicalHeader(dataBytes: number): Buffer {
  const h = Buffer.alloc(HEADER_BYTES);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataBytes, 4); // chunk size = 36 + data
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16); // PCM fmt chunk size
  h.writeUInt16LE(1, 20); // audio format = PCM
  h.writeUInt16LE(CHANNELS, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(BYTES_PER_SECOND, 28);
  h.writeUInt16LE(BYTES_PER_SAMPLE, 32); // block align
  h.writeUInt16LE(BITS_PER_SAMPLE, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/**
 * Back-fill a header that was never finalized.
 *
 * A recording that ends without `finalize()` — the app was killed, the machine
 * slept, the renderer never sent the stop — leaves the 44 placeholder zero bytes
 * in place. The PCM that follows them is perfect; only the header is wrong. But
 * that is enough to make the recording unreadable from both ends: `readWavInfo`
 * bails on the missing `RIFF` magic, and whisper.cpp rejects the file outright.
 * The meeting then reports "no audio" forever, with its audio sitting right
 * there on disk.
 *
 * Repair is idempotent and touches only those 44 bytes, and only when the magic
 * is absent. The `<id>.meta.json` sidecar has to exist and have to agree with
 * the header we are about to write — without that agreement, a file that merely
 * happens to live in the meetings directory is left alone.
 */
export function repairWavHeader(id: string): boolean {
  const path = meetingWavPath(id);
  try {
    if (statSync(path).size <= HEADER_BYTES) return false;
    const meta = JSON.parse(readFileSync(meetingMetaPath(id), 'utf8')) as Partial<{
      sampleRate: number;
      channels: number;
      bits: number;
    }>;
    // Only repair files we are certain use the canonical layout below.
    if (meta.sampleRate !== SAMPLE_RATE || meta.channels !== CHANNELS || meta.bits !== BITS_PER_SAMPLE) return false;
  } catch {
    return false;
  }

  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const magic = Buffer.alloc(4);
    readSync(fd, magic, 0, 4, 0);
    if (magic.toString('ascii') === 'RIFF') return false; // already a valid WAV
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }

  const h = canonicalHeader(statSync(path).size - HEADER_BYTES);
  const hfd = openSync(path, 'r+');
  try {
    writeSync(hfd, h, 0, HEADER_BYTES, 0);
  } finally {
    closeSync(hfd);
  }
  return true;
}

export interface WavWriter {
  id: string;
  path: string;
  /** Total PCM bytes appended so far. */
  bytes: number;
  append(pcm: Buffer): void;
  finalize(): { bytes: number; durationMs: number };
  abort(): void;
}

const open = new Map<string, WavWriter>();

/** Start (or resume) writing the WAV for a meeting. Idempotent per meeting id. */
export function createWavWriter(id: string, source: string): WavWriter {
  const existing = open.get(id);
  if (existing) return existing;

  ensureMeetingsDir();
  const path = meetingWavPath(id);
  const fresh = !existsSync(path);

  // 'a' so reconnects after a network hiccup append rather than restart.
  const fd = openSync(path, fresh ? 'w' : 'a');

  if (fresh) {
    writeSync(fd, Buffer.alloc(HEADER_BYTES));
    try {
      writeFileSync(
        meetingMetaPath(id),
        JSON.stringify({
          sampleRate: SAMPLE_RATE,
          channels: CHANNELS,
          bits: BITS_PER_SAMPLE,
          source,
          startedAt: new Date().toISOString(),
        }),
      );
    } catch {
      /* sidecar is optional */
    }
  }

  const writer: WavWriter = {
    id,
    path,
    bytes: Math.max(0, (existsSync(path) ? statSync(path).size : 0) - HEADER_BYTES),
    append(pcm: Buffer) {
      if (!pcm.length) return;
      writeSync(fd, pcm);
      writer.bytes += pcm.length;
    },
    finalize() {
      closeSync(fd);
      open.delete(id);
      // Back-fill the real sizes. This is the only moment the file becomes a
      // valid, seekable WAV.
      const h = canonicalHeader(writer.bytes);
      const hfd = openSync(path, 'r+');
      try {
        writeSync(hfd, h, 0, HEADER_BYTES, 0);
      } finally {
        closeSync(hfd);
      }
      return { bytes: writer.bytes, durationMs: pcmDurationMs(writer.bytes) };
    },
    abort() {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
      open.delete(id);
    },
  };

  open.set(id, writer);
  return writer;
}

/** The writer currently streaming for this meeting, if any. */
export function getWavWriter(id: string): WavWriter | null {
  return open.get(id) ?? null;
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationMs: number;
}

/**
 * Read a WAV's real parameters by walking its chunk table. We write canonical
 * 44-byte headers ourselves, but whisper's own sample files (and any file a user
 * drops in) can carry extra chunks — jfk.wav has a LIST chunk between 'fmt ' and
 * 'data', which naive offset arithmetic reads as silence.
 */
export function readWavInfo(path: string): WavInfo | null {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    if (size < 44) return null;
    fd = openSync(path, 'r');
    const head = Buffer.alloc(Math.min(size, 4096));
    readSync(fd, head, 0, head.length, 0);

    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return null;

    let off = 12;
    let fmt: Omit<WavInfo, 'dataBytes' | 'durationMs'> | null = null;
    let dataBytes = 0;

    while (off + 8 <= head.length) {
      const cid = head.toString('ascii', off, off + 4);
      const csize = head.readUInt32LE(off + 4);
      const body = off + 8;

      if (cid === 'fmt ' && body + 16 <= head.length) {
        fmt = {
          channels: head.readUInt16LE(body + 2),
          sampleRate: head.readUInt32LE(body + 4),
          bitsPerSample: head.readUInt16LE(body + 14),
        };
      } else if (cid === 'data') {
        // A header back-fill that never happened reports 0; fall back to the file size.
        dataBytes = csize > 0 && csize <= size - body ? csize : Math.max(0, size - body);
        break;
      }
      off = body + csize + (csize % 2); // chunks are word-aligned
    }

    if (!fmt) return null;
    const bytesPerSecond = fmt.sampleRate * (fmt.bitsPerSample / 8) * fmt.channels;
    return {
      ...fmt,
      dataBytes,
      durationMs: bytesPerSecond > 0 ? Math.round((dataBytes / bytesPerSecond) * 1000) : 0,
    };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

/** Delete a meeting's audio and its sidecar. Used by explicit delete (and P1 retention). */
export function deleteAudio(id: string): void {
  for (const p of [meetingWavPath(id), meetingMetaPath(id)]) {
    try {
      if (existsSync(p)) rmSync(p);
    } catch {
      /* best effort */
    }
  }
}

export function audioSizeBytes(id: string): number {
  try {
    const p = meetingWavPath(id);
    return existsSync(p) ? statSync(p).size : 0;
  } catch {
    return 0;
  }
}

/** Crash-recovery hint: the sidecar exists and claims a larger payload than the header. */
export function readMeta(id: string): { sampleRate?: number; source?: string; startedAt?: string } | null {
  try {
    const p = meetingMetaPath(id);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}
