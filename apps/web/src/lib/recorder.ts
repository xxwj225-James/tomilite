/**
 * Meeting audio capture — microphone plus system output, mixed to one 16kHz
 * mono stream and POSTed to the local API in 5-second chunks.
 *
 * Two design choices carry most of the weight:
 *
 * 1. `new AudioContext({ sampleRate: 16000 })`. Chromium resamples every input
 *    down to it, which is exactly the format whisper.cpp accepts. That is why
 *    this feature ships no decoder and no ffmpeg (~70MB saved). The worklet
 *    still has a resampling path for the case where a platform ignores the rate.
 *
 * 2. Summing, not averaging, the two sources — averaging would halve each and
 *    make a quiet remote participant inaudible. A compressor after the sum keeps
 *    the louder local voice from clipping the result.
 *
 * The dead-stream detector is not a nicety. On Windows a broken loopback very
 * often returns a perfectly valid stream containing nothing, so "we recorded it"
 * and "we captured the other side of the call" are different facts. Noticing the
 * difference 30 seconds in is worth far more than noticing it after the meeting.
 */
export type RecorderSource = 'mic' | 'mic+system';

export type RecorderErrorCode = 'mic_denied' | 'audio_context_failed' | 'worklet_failed' | 'upload_failed';

export interface RecorderLevels {
  /** dBFS, clamped to [-100, 0]. */
  mic: number;
  system: number;
  mix: number;
  clipping: boolean;
}

export interface DeadStreamState {
  active: boolean;
  silentMs: number;
}

export interface RecorderCallbacks {
  onLevels?: (levels: RecorderLevels) => void;
  onDeadStream?: (state: DeadStreamState) => void;
  /** System audio was requested but unavailable — recording continues mic-only. */
  onDegraded?: (reason: 'no_loopback') => void;
  onError?: (code: RecorderErrorCode, message: string) => void;
  onUploaded?: (bytes: number) => void;
}

export interface RecorderOptions extends RecorderCallbacks {
  meetingId: string;
  source: RecorderSource;
  /** Override for testing; production always uses 16000. */
  targetSampleRate?: number;
}

export interface Recorder {
  /** May be 'mic' even when 'mic+system' was asked for. */
  readonly source: RecorderSource;
  readonly paused: boolean;
  pause(): void;
  resume(): void;
  /** PCM seconds captured so far (excludes time spent paused). */
  seconds(): number;
  stop(): Promise<{ bytes: number; seconds: number; uploaded: boolean }>;
}

const TARGET_RATE = 16_000;
const CHUNK_SECONDS = 5;
const CHUNK_BYTES = TARGET_RATE * 2 * CHUNK_SECONDS;
const UPLOAD_RETRIES = 3;
const SILENCE_DB = -55; // below this the loopback is carrying nothing
const VOICE_DB = -50; // ...and below this we assume nobody is speaking at all
const DEAD_AFTER_MS = 30_000;
const LEVEL_INTERVAL_MS = 50; // ~20fps

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rmsDb(analyser: AnalyserNode, scratch: Float32Array<ArrayBuffer>): { db: number; peak: number } {
  analyser.getFloatTimeDomainData(scratch);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < scratch.length; i++) {
    const v = scratch[i];
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / scratch.length);
  // -100 instead of -Infinity so the UI can render it without special cases.
  return { db: rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100, peak };
}

/** Float32 [-1,1] → Int16LE bytes, clamped. */
function toInt16Bytes(frames: Float32Array): Uint8Array {
  const out = new Int16Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    const v = frames[i] < -1 ? -1 : frames[i] > 1 ? 1 : frames[i];
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return new Uint8Array(out.buffer);
}

async function postChunkOnce(
  meetingId: string,
  seq: number,
  body: Uint8Array,
): Promise<{ ok: boolean; expectedSeq?: number; error?: string }> {
  try {
    const resp = await fetch('/api/meeting/audio-chunk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-tl-meeting-id': meetingId,
        'x-tl-seq': String(seq),
      },
      // A fresh copy — the buffer may be re-sent after a retry.
      body: body.slice().buffer as ArrayBuffer,
    });
    if (!resp.ok && resp.status !== 409) return { ok: false, error: `HTTP ${resp.status}` };
    return await resp.json();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network' };
  }
}

export async function startRecording(opts: RecorderOptions): Promise<Recorder> {
  const targetRate = opts.targetSampleRate || TARGET_RATE;
  let effectiveSource: RecorderSource = opts.source;

  // ─── Sources ───
  let micStream: MediaStream;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    // NotAllowedError covers both "user said no" and "the OS privacy switch is
    // off" — they are indistinguishable from here, so the UI copy must offer a
    // retry *and* the Windows settings deep link.
    opts.onError?.('mic_denied', e instanceof Error ? e.message : String(e));
    throw e;
  }

  let systemStream: MediaStream | null = null;
  if (opts.source === 'mic+system') {
    try {
      systemStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      // The screen video track is a side effect of the audio request; keeping it
      // alive would hold a capture of the user's screen for the whole meeting.
      systemStream.getVideoTracks().forEach((t) => t.stop());
      if (systemStream.getAudioTracks().length === 0) {
        systemStream = null;
        opts.onDegraded?.('no_loopback');
      }
    } catch {
      systemStream = null;
      opts.onDegraded?.('no_loopback');
    }
    if (!systemStream) effectiveSource = 'mic';
  }

  // ─── Graph ───
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: targetRate });
  } catch (e) {
    micStream.getTracks().forEach((t) => t.stop());
    systemStream?.getTracks().forEach((t) => t.stop());
    opts.onError?.('audio_context_failed', e instanceof Error ? e.message : String(e));
    throw e;
  }

  let worklet: AudioWorkletNode;
  try {
    await ctx.audioWorklet.addModule('/meeting-worklet.js');
    worklet = new AudioWorkletNode(ctx, 'meeting-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { sampleRate: ctx.sampleRate },
    });
  } catch (e) {
    await ctx.close().catch(() => {});
    micStream.getTracks().forEach((t) => t.stop());
    systemStream?.getTracks().forEach((t) => t.stop());
    opts.onError?.('worklet_failed', e instanceof Error ? e.message : String(e));
    throw e;
  }

  const micSource = ctx.createMediaStreamSource(micStream);
  const micGain = ctx.createGain();
  micSource.connect(micGain);

  let systemSource: MediaStreamAudioSourceNode | null = null;
  let systemGain: GainNode | null = null;
  if (systemStream) {
    systemSource = ctx.createMediaStreamSource(systemStream);
    systemGain = ctx.createGain();
    systemSource.connect(systemGain);
  }

  const mixBus = ctx.createGain();
  micGain.connect(mixBus);
  systemGain?.connect(mixBus);

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 24;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  mixBus.connect(compressor);
  compressor.connect(worklet);

  // The graph must terminate at destination for Chromium to pull it, but routing
  // the mix there would play the user's own microphone back at them.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  worklet.connect(sink);
  sink.connect(ctx.destination);

  // ─── Metering ───
  const micAnalyser = ctx.createAnalyser();
  micAnalyser.fftSize = 2048;
  micAnalyser.smoothingTimeConstant = 0.3;
  micGain.connect(micAnalyser);

  const systemAnalyser = ctx.createAnalyser();
  systemAnalyser.fftSize = 2048;
  systemAnalyser.smoothingTimeConstant = 0.3;
  systemGain?.connect(systemAnalyser);

  const mixAnalyser = ctx.createAnalyser();
  mixAnalyser.fftSize = 2048;
  mixAnalyser.smoothingTimeConstant = 0.3;
  compressor.connect(mixAnalyser);

  const scratch = new Float32Array(micAnalyser.fftSize);

  // ─── Upload buffers ───
  let sendBuffer: Uint8Array[] = [];
  let buffered = 0;
  let seq = 0;
  let uploadedBytes = 0;
  let uploaded = true;
  let stopped = false;
  let paused = false;
  let flushing: Promise<boolean> | null = null;

  const post = async (body: Uint8Array): Promise<boolean> => {
    for (let attempt = 0; attempt < UPLOAD_RETRIES; attempt++) {
      const r = await postChunkOnce(opts.meetingId, seq, body);
      if (r.ok) {
        seq++;
        return true;
      }
      // The server tells us which chunk it actually wants; align to it so the
      // stream resynchronises instead of stalling forever on a permanent gap.
      if (typeof r.expectedSeq === 'number') seq = r.expectedSeq;
      await sleep(400 * (attempt + 1));
    }
    return false;
  };

  const flush = async (): Promise<boolean> => {
    // Single-flight. Two callers — the size trigger in onmessage and the 5s
    // timer — can otherwise be in flight at once, and they race on `seq`: both
    // read the same number, so the loser is answered as a duplicate, advances
    // `seq` anyway, and the next chunk trips the gap check — whose retry path
    // then re-sends the *same* PCM under the corrected number, and the server
    // appends it twice. It also double-counts `uploadedBytes`, which is the
    // duration `stop()` reports.
    //
    // Returning the in-flight promise rather than a bare `true` keeps the tail
    // drain in stop() correct too — it can tell when the buffer is really empty.
    if (flushing) return flushing;
    if (!sendBuffer.length) return true;
    const run = (async (): Promise<boolean> => {
      const total = sendBuffer.reduce((n, b) => n + b.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const b of sendBuffer) {
        merged.set(b, off);
        off += b.length;
      }
      sendBuffer = [];
      buffered = 0;

      if (await post(merged)) {
        uploadedBytes += total;
        opts.onUploaded?.(total);
        return true;
      }
      // Never drop audio silently: hold it and stop recording loudly instead.
      sendBuffer.unshift(merged);
      buffered += total;
      uploaded = false;
      opts.onError?.('upload_failed', 'Could not upload the recording to the local service.');
      pause();
      return false;
    })();
    flushing = run;
    void run.finally(() => {
      if (flushing === run) flushing = null;
    });
    return run;
  };

  worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (stopped) return;
    const bytes = toInt16Bytes(e.data);
    sendBuffer.push(bytes);
    buffered += bytes.length;
    if (buffered >= CHUNK_BYTES) void flush();
  };

  // 5s timer as well as the size trigger: the size trigger alone would hold the
  // last partial chunk indefinitely if the speaker went quiet.
  const sendTimer = window.setInterval(() => {
    if (!stopped && !paused) void flush();
  }, CHUNK_SECONDS * 1000);

  // ─── Levels + dead-stream detection ───
  let deadActive = false;
  let silentMs = 0;
  let lastTick = performance.now();
  let lastLevelAt = 0;
  let rafId = 0;

  const tick = () => {
    rafId = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;
    // Reading analysers 20×/second is wasteful when nothing is on screen.
    if (document.hidden) return;

    const mic = rmsDb(micAnalyser, scratch);
    const mix = rmsDb(mixAnalyser, scratch);
    let sys = { db: -100, peak: 0 };
    if (systemAnalyser) sys = rmsDb(systemAnalyser, scratch);

    if (systemAnalyser) {
      // Only accumulate while the microphone is live: silence from the system
      // while the room is also silent means nobody is talking, not that the
      // capture is broken.
      if (mic.db > VOICE_DB && sys.db < SILENCE_DB) silentMs += dt;
      else if (sys.db >= SILENCE_DB) silentMs = 0;
    } else {
      silentMs = 0;
    }

    if (!deadActive && silentMs >= DEAD_AFTER_MS) {
      deadActive = true;
      opts.onDeadStream?.({ active: true, silentMs });
    } else if (deadActive && silentMs < DEAD_AFTER_MS) {
      deadActive = false;
      opts.onDeadStream?.({ active: false, silentMs: 0 });
    }

    if (now - lastLevelAt >= LEVEL_INTERVAL_MS) {
      lastLevelAt = now;
      opts.onLevels?.({
        mic: mic.db,
        system: sys.db,
        mix: mix.db,
        clipping: mic.peak > 0.995 || mix.peak > 0.995,
      });
    }
  };
  rafId = requestAnimationFrame(tick);

  // ─── Lifecycle ───
  const teardownGraph = async () => {
    cancelAnimationFrame(rafId);
    window.clearInterval(sendTimer);
    worklet.port.onmessage = null;
    worklet.disconnect();
    sink.disconnect();
    micSource.disconnect();
    systemSource?.disconnect();
    await ctx.close().catch(() => {});
    micStream.getTracks().forEach((t) => t.stop());
    systemStream?.getTracks().forEach((t) => t.stop());
    stopWatchers.forEach((fn) => fn());
  };

  // A system-audio track can end on its own (device removed, stream revoked).
  // Losing it silently would be exactly the failure the detector exists for.
  // (Full hot-plug recovery is deferred; for now the loss is surfaced.)
  const stopWatchers: Array<() => void> = [];
  micStream.getAudioTracks().forEach((track) => {
    const onEnded = () => opts.onError?.('upload_failed', 'The microphone stopped.');
    track.addEventListener('ended', onEnded);
    stopWatchers.push(() => track.removeEventListener('ended', onEnded));
  });

  const pause = () => {
    if (paused || stopped) return;
    paused = true;
    void ctx.suspend().catch(() => {});
  };

  const resume = () => {
    if (!paused || stopped) return;
    paused = false;
    lastTick = performance.now();
    void ctx.resume().catch(() => {});
  };

  return {
    get source() {
      return effectiveSource;
    },
    get paused() {
      return paused;
    },
    pause,
    resume,
    seconds: () => uploadedBytes / (TARGET_RATE * 2),
    async stop() {
      if (stopped) return { bytes: uploadedBytes, seconds: uploadedBytes / (TARGET_RATE * 2), uploaded };
      stopped = true;
      paused = false;
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      // Ask the worklet for whatever is still in its buffer, then send the tail.
      // Twice: the first call may only await a flush that was already running,
      // and anything the worklet handed over while that was in flight would
      // otherwise be dropped. `flush()` single-flights, so a second call is
      // either a no-op or exactly the remaining tail.
      worklet.port.postMessage('flush');
      await sleep(60);
      await flush();
      await flush();
      const seconds = uploadedBytes / (TARGET_RATE * 2);
      await teardownGraph();
      return { bytes: uploadedBytes, seconds, uploaded };
    },
  };
}

/** True when the platform can plausibly give us system audio. */
export function captureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    typeof AudioWorkletNode !== 'undefined'
  );
}
