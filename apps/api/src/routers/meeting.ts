// ═══ Meeting Intelligence ═══
//
// record → transcribe locally → AI minutes → decisions → action items
//        → email the minutes → turn an action item into a real task
//
// The product claim is deliberately narrower than "we summarize your meeting".
// Otter's end point is a summary; TomiLite's end point is a task that exists.
// Everything from the transcript onwards therefore aims at the Create Task
// button, not at the reading experience.
//
// Audio never leaves the machine. Only transcript text reaches an LLM, and the
// Settings panel says so in exactly those words — see MeetingTab.tsx.
import { prisma } from '@tomilite/database';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { router, publicProcedure, z } from '../trpc';
import { isDeepseekEndpoint, resolveLLM } from '../lib/gateway';
import { sendWithStoredSmtp, smtpConfigured } from '../lib/smtpSend';
import { forget, publish, subscribe } from '../lib/meeting/events';
import {
  audioSizeBytes,
  createWavWriter,
  deleteAudio,
  getWavWriter,
  pcmDurationMs,
  readWavInfo,
  repairWavHeader,
} from '../lib/meeting/audioFile';
import {
  DEFAULT_MODEL,
  deleteModel,
  downloadModel as downloadModelFile,
  installedModelNames,
  pickModel,
  listModels,
} from '../lib/meeting/models';
import { isSafeId, meetingWavPath } from '../lib/meeting/paths';
import { assignSpeakerTurns, estimateMeeting, runPipeline } from '../lib/meeting/pipeline';
import { cancelWhisperJob, cleanupTempDir, runWhisperJob, whisperBusy } from '../lib/meeting/whisperJob';
import { whisperBinStatus, whisperThreads } from '../lib/meeting/whisperBin';

const CONSENT_KEY = 'meeting.consentAcknowledgedAt';

// ─── Recording session state (in-process) ───
// Chunk sequencing lives in memory: it exists to detect a dropped POST while
// recording, which is a single-process, single-session concern. Durable state
// (bytes, duration) is written through to the DB.
const seqState = new Map<string, number>();
const chunkCounter = new Map<string, number>();

function nowStr(): string {
  return new Date().toLocaleString('sv-SE').replace('T', ' ');
}

function defaultTitle(): string {
  return `Meeting ${new Date().toLocaleString('sv-SE').slice(0, 16)}`;
}

// ═══ Raw routes ═══

interface AudioChunkResult {
  ok: boolean;
  error?: string;
  nextSeq?: number;
  expectedSeq?: number;
  received?: number;
  bytes?: number;
  duplicate?: boolean;
}

const MAX_CHUNK_BYTES = 16 * 1024 * 1024; // a 5s chunk is ~160KB; 16MB is abuse

/**
 * POST /api/meeting/audio-chunk
 * Headers: x-tl-meeting-id, x-tl-seq (monotonic, starts at 0)
 * Body: raw Int16LE PCM, 16kHz mono.
 *
 * A missing sequence number is never silently ignored: the renderer is told
 * exactly which chunk to resend. Silently dropping audio would break the one
 * promise the feature cannot afford to break.
 */
export async function handleMeetingAudioChunk(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const respond = (status: number, payload: AudioChunkResult) => {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  const meetingId = String(req.headers['x-tl-meeting-id'] || '');
  const seq = Number(req.headers['x-tl-seq']);
  if (!isSafeId(meetingId) || !Number.isInteger(seq) || seq < 0) {
    respond(400, { ok: false, error: 'bad_request' });
    return;
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, status: true, source: true },
  });
  if (!meeting) {
    respond(404, { ok: false, error: 'not_found' });
    return;
  }
  if (meeting.status !== 'recording') {
    respond(409, { ok: false, error: 'not_recording' });
    return;
  }

  const expected = seqState.get(meetingId) ?? 0;
  if (seq < expected) {
    // Already have this one — a retry after a response we failed to deliver.
    respond(200, { ok: true, duplicate: true, nextSeq: expected });
    return;
  }
  if (seq > expected) {
    respond(409, { ok: false, error: 'gap', expectedSeq: expected });
    return;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const raw of req) {
      const buf = raw as Buffer;
      total += buf.length;
      if (total > MAX_CHUNK_BYTES) {
        respond(413, { ok: false, error: 'chunk_too_large' });
        return;
      }
      chunks.push(buf);
    }
  } catch (e: unknown) {
    respond(400, { ok: false, error: e instanceof Error ? e.message : 'read_failed' });
    return;
  }

  const pcm = Buffer.concat(chunks);
  // Int16 mono — an odd byte count means the renderer misaligned its buffer.
  if (pcm.length % 2 !== 0) {
    respond(400, { ok: false, error: 'misaligned_pcm' });
    return;
  }

  try {
    const writer = createWavWriter(meetingId, meeting.source);
    writer.append(pcm);
    seqState.set(meetingId, expected + 1);

    // Write-through throttled to every 30s: the panel reads duration for its
    // badge, but a DB write per 5s chunk would be pure churn.
    const n = (chunkCounter.get(meetingId) ?? 0) + 1;
    chunkCounter.set(meetingId, n);
    if (n % 6 === 0) {
      await prisma.meeting
        .update({
          where: { id: meetingId },
          data: { audioBytes: writer.bytes, durationMs: pcmDurationMs(writer.bytes) },
        })
        .catch(() => {});
    }

    respond(200, { ok: true, received: pcm.length, nextSeq: expected + 1, bytes: writer.bytes });
  } catch (e: unknown) {
    console.error('[Meeting] append failed:', e);
    respond(500, { ok: false, error: e instanceof Error ? e.message : 'write_failed' });
  }
}

/**
 * GET /api/meeting/stream?meetingId=<id>
 *
 * One SSE stream per meeting carrying every stage: `transcribe:progress`,
 * `ai:progress`, `ai:done`, `ai:error`. Namespaced events mean a model download
 * and a transcription can share the connection without interfering.
 */
export async function handleMeetingStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const channel = url.searchParams.get('meetingId') || url.searchParams.get('channel') || '';
  if (!channel || channel.length > 64) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'missing channel' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: unknown) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* client vanished; 'close' will clean up */
    }
  };

  send('hello', { channel });
  // subscribe() replays the tail first, so a panel that mounts mid-job still
  // shows the current state instead of an empty bar.
  const unsubscribe = subscribe(channel, (e) => send(e.event, e.data));

  // Proxies and idle sockets drop silent connections; a comment line keeps it warm.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* handled by close */
    }
  }, 15_000);
  heartbeat.unref?.();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
}

// ═══ Boot recovery ═══

/**
 * Anything left `queued`/`running`, or recording when the app died, is a
 * casualty of the previous process — the spawned whisper child is gone with it.
 * Marking those rows failed at boot is what stops the UI showing a progress bar
 * that will never move.
 *
 * The recorded WAV is deliberately kept: the recording itself is the expensive,
 * unrepeatable part, and re-transcribing it is one click.
 */
export async function recoverStuckMeetings(): Promise<void> {
  try {
    cleanupTempDir();

    const stuck = await prisma.meeting.findMany({
      where: { transcribeStatus: { in: ['queued', 'running'] } },
      select: { id: true },
    });
    for (const m of stuck) {
      await prisma.meeting
        .update({
          where: { id: m.id },
          data: {
            transcribeStatus: 'failed',
            transcribeError: 'interrupted',
            jobStage: null,
          },
        })
        .catch(() => {});
    }

    await prisma.meeting
      .updateMany({
        where: { aiStatus: 'running' },
        data: { aiStatus: 'failed', jobStage: null },
      })
      .catch(() => {});

    // A recording that never got a finalize() still has a valid header — the
    // header is back-filled with the true length so the audio is playable and
    // transcribable rather than apparently zero-length.
    const abandoned = await prisma.meeting.findMany({
      where: { status: 'recording' },
      select: { id: true, source: true, projectId: true },
    });
    for (const m of abandoned) {
      if (getWavWriter(m.id)) continue;
      // Repair before reading: an interrupted recording has no `RIFF` magic, so
      // reading it first would report "no audio" and skip the finalize below —
      // leaving the file permanently unfinalized and permanently unusable.
      repairWavHeader(m.id);
      const info = readWavInfo(meetingWavPath(m.id));
      const bytes = audioSizeBytes(m.id);
      if (!info || bytes <= 44) {
        await prisma.meeting.update({ where: { id: m.id }, data: { status: 'recorded' } }).catch(() => {});
        continue;
      }
      const w = createWavWriter(m.id, m.source);
      w.bytes = info.dataBytes;
      const { durationMs } = w.finalize();
      await prisma.meeting
        .update({
          where: { id: m.id },
          data: { status: 'recorded', durationMs, audioBytes: info.dataBytes },
        })
        .catch(() => {});
    }

    if (stuck.length || abandoned.length) {
      console.warn(
        `[Init] Meeting recovery: ${stuck.length} interrupted job(s), ${abandoned.length} unfinished recording(s)`,
      );
    }
  } catch (e: unknown) {
    console.error('[Init] Meeting recovery failed:', e instanceof Error ? e.message : e);
  }
}

// ═══ Transcription runner ═══

/**
 * Start transcription for a recorded meeting. Fire-and-forget: the caller gets
 * an acknowledgement and follows progress over SSE, so a 20-minute job never
 * holds an HTTP request open.
 */
async function startTranscription(meetingId: string): Promise<{ ok: boolean; error?: string }> {
  if (whisperBusy()) return { ok: false, error: 'busy' };

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) return { ok: false, error: 'not_found' };
  if (meeting.status === 'recording') return { ok: false, error: 'still_recording' };

  const bin = whisperBinStatus();
  if (!bin.ok) return { ok: false, error: 'no_binary' };

  const picked = pickModel(meeting.whisperModel || DEFAULT_MODEL);
  if (!picked) return { ok: false, error: 'no_model' };

  const wavPath = meetingWavPath(meetingId);
  // A recording that was never finalized still has every byte of its audio —
  // only the 44-byte header is missing. Repair it before reading, or the meeting
  // is stuck on `no_audio` forever with a perfectly good file on disk.
  repairWavHeader(meetingId);
  const info = readWavInfo(wavPath);
  if (!info || info.dataBytes <= 0) return { ok: false, error: 'no_audio' };

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      transcribeStatus: 'running',
      transcribeProgress: 0,
      transcribeError: null,
      durationMs: info.durationMs || meeting.durationMs,
      jobStage: 'transcribe',
      // Record the substitution, so the row doesn't keep claiming a model that
      // isn't on disk and retries don't re-derive the same fallback.
      whisperModel: picked.name,
    },
  });

  void (async () => {
    const result = await runWhisperJob({
      meetingId,
      wavPath,
      modelPath: picked.path,
      lang: meeting.lang,
      durationMs: info.durationMs,
    });

    if (!result.ok) {
      await prisma.meeting
        .update({
          where: { id: meetingId },
          data: {
            transcribeStatus: result.error === 'cancelled' ? 'cancelled' : 'failed',
            transcribeError: result.message || result.error,
            jobStage: null,
          },
        })
        .catch(() => {});
      publish(meetingId, 'transcribe:error', { error: result.error, message: result.message });
      return;
    }

    const speakers = assignSpeakerTurns(result.segments);

    // Replace wholesale inside one transaction — segments are derived data and a
    // half-written transcript is worse than none.
    await prisma.$transaction(async (tx) => {
      await tx.meetingSegment.deleteMany({ where: { meetingId } });
      for (let i = 0; i < result.segments.length; i++) {
        const s = result.segments[i];
        await tx.meetingSegment.create({
          data: { meetingId, idx: i, startMs: s.startMs, endMs: s.endMs, speaker: speakers[i], text: s.text },
        });
      }
      await tx.meeting.update({
        where: { id: meetingId },
        data: {
          transcript: result.text,
          transcribeStatus: 'done',
          transcribeProgress: 100,
          transcribeError: null,
          jobStage: null,
          // Detected language is authoritative once whisper has decided.
          lang: result.language || 'auto',
          // A fresh transcript invalidates any previous analysis.
          aiStatus: 'none',
          chunkSummaries: null,
          summary: null,
          decisions: null,
          speakers: null,
          minutes: null,
          minutesSubject: null,
          minutesStatus: 'none',
          stageLog: '[]',
          updatedAt: nowStr(),
        },
      });
    });

    publish(meetingId, 'transcribe:done', { segments: result.segments.length, language: result.language });
  })();

  return { ok: true };
}

// ═══ Model downloads (one at a time) ═══

const MODEL_CHANNEL = 'model-download';
let modelDownload: { name: string; controller: AbortController } | null = null;

// ═══ Router ═══

export const meetingRouter = router({
  // ─── Library ───

  list: publicProcedure
    .input(z.object({ search: z.string().default(''), limit: z.number().default(200) }).default({}))
    .query(async ({ input }) => {
      const where: Record<string, unknown> = { archived: false };
      if (input.search.trim()) {
        const q = input.search.trim();
        where.OR = [{ title: { contains: q } }, { transcript: { contains: q } }, { summary: { contains: q } }];
      }
      const rows = await prisma.meeting.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        include: {
          _count: { select: { actionItems: true, segments: true } },
        },
      });
      return rows.map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        source: m.source,
        durationMs: m.durationMs,
        audioBytes: m.audioBytes,
        whisperModel: m.whisperModel,
        lang: m.lang,
        transcribeStatus: m.transcribeStatus,
        transcribeProgress: m.transcribeProgress,
        transcribeError: m.transcribeError,
        aiStatus: m.aiStatus,
        minutesStatus: m.minutesStatus,
        segmentCount: m._count.segments,
        actionItemCount: m._count.actionItems,
        retentionDays: m.retentionDays,
        sentAt: m.sentAt,
        createdAt: m.createdAt,
        // "audio will be deleted in N days" — computed server-side so the renderer
        // never has to know how the two fields combine.
        audioExpiresAt: m.retentionDays > 0 ? addDays(m.createdAt, m.retentionDays) : null,
        audioDeletedAt: m.audioDeletedAt,
      }));
    }),

  get: publicProcedure
    .input(z.object({ id: z.string(), segmentLimit: z.number().default(200), segmentOffset: z.number().default(0) }))
    .query(async ({ input }) => {
      const meeting = await prisma.meeting.findUnique({ where: { id: input.id } });
      if (!meeting) return null;

      const [segments, actionItems, total] = await Promise.all([
        prisma.meetingSegment.findMany({
          where: { meetingId: input.id },
          orderBy: { idx: 'asc' },
          skip: input.segmentOffset,
          take: input.segmentLimit,
        }),
        prisma.meetingActionItem.findMany({ where: { meetingId: input.id }, orderBy: { idx: 'asc' } }),
        prisma.meetingSegment.count({ where: { meetingId: input.id } }),
      ]);

      return {
        meeting: {
          ...meeting,
          decisions: parseArray(meeting.decisions),
          speakers: parseArray(meeting.speakers) as Array<{ label: string; inferredRole: string }>,
          attendees: parseArray(meeting.attendees) as string[],
          stageLog: parseArray(meeting.stageLog),
        },
        segments,
        actionItems,
        totalSegments: total,
      };
    }),

  stats: publicProcedure.query(async () => {
    const [total, recording, transcribing, ready, failed] = await Promise.all([
      prisma.meeting.count({ where: { archived: false } }),
      prisma.meeting.count({ where: { status: 'recording' } }),
      prisma.meeting.count({ where: { transcribeStatus: { in: ['queued', 'running'] } } }),
      prisma.meeting.count({ where: { transcribeStatus: 'done' } }),
      prisma.meeting.count({ where: { transcribeStatus: 'failed', archived: false } }),
    ]);
    return { total, recording, transcribing, ready, failed };
  }),

  // ─── Recording lifecycle ───

  create: publicProcedure
    .input(
      z.object({
        title: z.string().optional(),
        source: z.enum(['mic', 'mic+system']).default('mic+system'),
        lang: z.string().default('auto'),
        whisperModel: z.string().default(DEFAULT_MODEL),
        retentionDays: z.number().min(0).default(30),
      }),
    )
    .mutation(async ({ input }) => {
      const consent = await prisma.systemConfig.findUnique({ where: { key: CONSENT_KEY } });
      const row = await prisma.meeting.create({
        data: {
          id: randomUUID(),
          title: input.title?.trim() || defaultTitle(),
          source: input.source,
          status: 'recording',
          lang: input.lang,
          whisperModel: input.whisperModel,
          retentionDays: input.retentionDays,
          consentAcknowledgedAt: consent?.value || null,
        },
      });
      seqState.set(row.id, 0);
      chunkCounter.set(row.id, 0);
      return { ok: true, id: row.id, title: row.title };
    }),

  /** Close the WAV, back-fill its header, and optionally transcribe right away. */
  finalizeRecording: publicProcedure
    .input(z.object({ id: z.string(), autoTranscribe: z.boolean().default(true), durationMs: z.number().optional() }))
    .mutation(async ({ input }) => {
      const meeting = await prisma.meeting.findUnique({ where: { id: input.id } });
      if (!meeting) return { ok: false, error: 'not_found' };

      const writer = getWavWriter(input.id);
      let durationMs = input.durationMs ?? 0;
      let bytes = 0;

      if (writer) {
        const out = writer.finalize();
        durationMs = out.durationMs;
        bytes = out.bytes;
      } else {
        const info = readWavInfo(meetingWavPath(input.id));
        if (info) {
          durationMs = info.durationMs;
          bytes = info.dataBytes;
        }
      }

      seqState.delete(input.id);
      chunkCounter.delete(input.id);

      await prisma.meeting.update({
        where: { id: input.id },
        data: {
          status: 'recorded',
          durationMs,
          audioBytes: bytes,
          audioFile: `${input.id}.wav`,
          updatedAt: nowStr(),
        },
      });

      if (bytes <= 0) {
        await prisma.meeting.update({
          where: { id: input.id },
          data: { transcribeStatus: 'failed', transcribeError: 'no_audio' },
        });
        return { ok: true, durationMs, bytes, transcribeStarted: false, error: 'no_audio' };
      }

      if (!input.autoTranscribe) return { ok: true, durationMs, bytes, transcribeStarted: false };

      const started = await startTranscription(input.id);
      if (!started.ok) {
        await prisma.meeting
          .update({ where: { id: input.id }, data: { transcribeStatus: 'failed', transcribeError: started.error } })
          .catch(() => {});
      }
      return { ok: true, durationMs, bytes, transcribeStarted: started.ok, error: started.error };
    }),

  transcribe: publicProcedure
    .input(z.object({ id: z.string(), force: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      if (input.force) {
        await prisma.meetingSegment.deleteMany({ where: { meetingId: input.id } });
      }
      return startTranscription(input.id);
    }),

  cancelTranscribe: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    // Audio is preserved on cancel — the recording is the irreplaceable part.
    const stopped = cancelWhisperJob(input.id);
    return { ok: stopped };
  }),

  // ─── Editing ───

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        minutes: z.string().optional(),
        minutesSubject: z.string().optional(),
        attendees: z.array(z.string()).optional(),
        sendTo: z.string().optional(),
        sendCc: z.string().optional(),
        retentionDays: z.number().min(0).optional(),
        lang: z.string().optional(),
        whisperModel: z.string().optional(),
        archived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const data: Record<string, unknown> = { updatedAt: nowStr() };
      for (const k of [
        'title',
        'minutes',
        'minutesSubject',
        'sendTo',
        'sendCc',
        'lang',
        'whisperModel',
        'archived',
      ] as const) {
        if (input[k] !== undefined) data[k] = input[k];
      }
      if (input.attendees !== undefined) data.attendees = JSON.stringify(input.attendees);
      if (input.retentionDays !== undefined) data.retentionDays = input.retentionDays;
      const saved = await prisma.meeting.update({ where: { id: input.id }, data });
      return { ok: true, meeting: saved };
    }),

  setActionItemStatus: publicProcedure
    .input(z.object({ id: z.string(), status: z.enum(['open', 'created', 'dismissed']) }))
    .mutation(async ({ input }) => {
      await prisma.meetingActionItem.update({ where: { id: input.id }, data: { status: input.status } });
      return { ok: true };
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    cancelWhisperJob(input.id);
    // SQLite does not enforce foreign keys here (PRAGMA foreign_keys is off), so
    // onDelete: Cascade is documentation only — delete children explicitly.
    await prisma.$transaction([
      prisma.meetingActionItem.deleteMany({ where: { meetingId: input.id } }),
      prisma.meetingSegment.deleteMany({ where: { meetingId: input.id } }),
      prisma.meeting.delete({ where: { id: input.id } }),
    ]);
    deleteAudio(input.id);
    forget(input.id);
    seqState.delete(input.id);
    chunkCounter.delete(input.id);
    return { ok: true };
  }),

  // ─── Transcript segment search (in-panel, P0 uses a linear scan) ───

  searchSegments: publicProcedure.input(z.object({ id: z.string(), q: z.string() })).query(async ({ input }) => {
    if (!input.q.trim()) return [];
    return prisma.meetingSegment.findMany({
      where: { meetingId: input.id, text: { contains: input.q.trim() } },
      orderBy: { idx: 'asc' },
      take: 100,
    });
  }),

  // ─── AI ───

  estimate: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => estimateMeeting(input.id)),

  summarize: publicProcedure
    .input(
      z.object({
        id: z.string(),
        force: z.boolean().default(false),
        confirmHosted: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await runPipeline(input.id, { force: input.force, confirmHosted: input.confirmHosted });
      if (!result.ok) {
        await prisma.meeting
          .update({ where: { id: input.id }, data: { aiStatus: 'failed', jobStage: null } })
          .catch(() => {});
      }
      return result;
    }),

  // ─── Minutes email ───

  emailStatus: publicProcedure.query(async () => ({ configured: await smtpConfigured() })),

  sendMinutes: publicProcedure
    .input(
      z.object({
        id: z.string(),
        to: z.string(),
        cc: z.string().optional(),
        subject: z.string(),
        html: z.string(),
        attachTranscript: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const meeting = await prisma.meeting.findUnique({ where: { id: input.id } });
      if (!meeting) return { ok: false, error: 'not_found' };

      const attachments: Array<{ filename: string; content: string; contentType: string }> = [];
      if (input.attachTranscript && meeting.transcript) {
        const segments = await prisma.meetingSegment.findMany({
          where: { meetingId: input.id },
          orderBy: { idx: 'asc' },
          select: { speaker: true, startMs: true, text: true },
        });
        const md = [
          `# ${meeting.title}`,
          '',
          ...segments.map((s) => `- \`${fmtClock(s.startMs)}\` **${s.speaker || 'Speaker 1'}**: ${s.text}`),
        ].join('\n');
        attachments.push({
          filename: `${safeFileName(meeting.title)}-transcript.md`,
          content: Buffer.from(md, 'utf-8').toString('base64'),
          contentType: 'text/markdown',
        });
      }

      const sent = await sendWithStoredSmtp({
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        html: input.html,
        attachments,
      });
      if (!sent.ok) return { ok: false, error: sent.error, code: sent.code };

      await prisma.meeting.update({
        where: { id: input.id },
        data: {
          minutesStatus: 'sent',
          minutesSubject: input.subject,
          sendTo: input.to,
          sendCc: input.cc || null,
          sentAt: nowStr(),
          updatedAt: nowStr(),
        },
      });
      return { ok: true };
    }),

  // ─── Action item → Task ───

  /**
   * Structurally the same move as email.createLinkedTask: ask the flash model for
   * a title/description/type, but fall back to a hard-coded task built from the
   * action item text whenever the model is unavailable. Creating the task must
   * never depend on the network.
   */
  createTaskFromActionItem: publicProcedure
    .input(z.object({ actionItemId: z.string(), lang: z.string().default('en') }))
    .mutation(async ({ input }) => {
      const item = await prisma.meetingActionItem.findUnique({
        where: { id: input.actionItemId },
        include: { meeting: { select: { title: true, summary: true } } },
      });
      if (!item) return { ok: false, error: 'not_found' };
      if (item.issueId) return { ok: false, error: 'already_linked' };

      let title = item.text.length > 80 ? item.text.slice(0, 77) + '…' : item.text;
      let description = `**来自会议**: ${item.meeting.title}\n\n${item.text}`;
      let type = 'task';

      try {
        const llm = await resolveLLM();
        if (llm) {
          const base = llm.baseUrl || '';
          const langLabel = input.lang === 'zh' ? 'Chinese' : input.lang === 'ja' ? 'Japanese' : 'English';
          const body: Record<string, unknown> = {
            model: llm.flashModel || llm.proModel || 'deepseek-chat',
            messages: [
              {
                role: 'user',
                content: `Turn this meeting action item into a task. Determine type (task/bug/story).\n\nMeeting: ${item.meeting.title}\nAction item: ${item.text}\nOwner: ${item.owner || 'unassigned'}\nDue: ${item.dueDate || 'none'}\n\nOutput ONLY valid JSON in ${langLabel}:\n{"type":"task|bug|story","title":"under 60 chars","description":"Markdown, 2-3 bullet points"}`,
              },
            ],
            max_tokens: 400,
            temperature: 0,
          };
          if (isDeepseekEndpoint(base)) body.thinking = { type: 'disabled' };
          else if (base.includes('dashscope')) body.enable_thinking = false;

          const resp = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(12_000),
          });
          if (resp.ok) {
            const d = await resp.json();
            const raw = (d.choices?.[0]?.message?.content || '')
              .replace(/^```json?\s*/i, '')
              .replace(/\s*```$/, '')
              .trim();
            const parsed = parseJsonObject(raw);
            if (parsed?.title) title = String(parsed.title);
            if (parsed?.description) description = String(parsed.description);
            const guessed = String(parsed?.type || '');
            if (['task', 'bug', 'story'].includes(guessed)) type = guessed;
          }
        }
      } catch {
        /* the hard-coded task below is always available */
      }

      const maxNum = await prisma.issue.aggregate({
        where: { projectId: 'proj-default' },
        _max: { issueNumber: true },
      });
      const issue = await prisma.issue.create({
        data: {
          projectId: 'proj-default',
          issueNumber: (maxNum._max.issueNumber ?? 0) + 1,
          title,
          description,
          type,
          status: 'todo',
          priority: item.priority || 'medium',
          createdAt: nowStr(),
          updatedAt: nowStr(),
        },
      });

      await prisma.meetingActionItem.update({
        where: { id: item.id },
        data: { issueId: issue.id, status: 'created' },
      });

      return {
        ok: true,
        issue: {
          id: issue.id,
          issueNumber: issue.issueNumber,
          title: issue.title,
          status: issue.status,
          priority: issue.priority,
        },
      };
    }),

  // ─── Speech model management ───

  binStatus: publicProcedure.query(() => {
    const status = whisperBinStatus();
    return { ...status, threads: whisperThreads() };
  }),

  listModels: publicProcedure.query(() => ({
    models: listModels(),
    defaultModel: DEFAULT_MODEL,
    downloading: modelDownload ? { name: modelDownload.name } : null,
    active: installedModelNames(),
  })),

  /**
   * P0 download: no resume, no checksum, no free-space precheck (all P1). What it
   * does have is a `.part` file renamed on completion, a stall watchdog that
   * fails over to the mirror, and a live progress stream.
   */
  downloadModel: publicProcedure.input(z.object({ name: z.string() })).mutation(async ({ input }) => {
    if (modelDownload) return { ok: false, error: 'busy', name: modelDownload.name };
    if (!listModels().some((m) => m.name === input.name)) return { ok: false, error: 'unknown_model' };

    const controller = new AbortController();
    modelDownload = { name: input.name, controller };
    publish(MODEL_CHANNEL, 'model:start', { name: input.name });

    void (async () => {
      try {
        await downloadModelFile(input.name, {
          signal: controller.signal,
          onProgress: (p) => publish(MODEL_CHANNEL, 'model:progress', { ...p, name: input.name }),
          onHostFailover: (host) => publish(MODEL_CHANNEL, 'model:failover', { host, name: input.name }),
        });
        publish(MODEL_CHANNEL, 'model:done', { name: input.name });
      } catch (e: unknown) {
        const aborted = controller.signal.aborted;
        publish(MODEL_CHANNEL, 'model:error', {
          name: input.name,
          error: aborted ? 'cancelled' : e instanceof Error ? e.message : String(e),
        });
      } finally {
        modelDownload = null;
      }
    })();

    return { ok: true, name: input.name };
  }),

  cancelDownload: publicProcedure.mutation(() => {
    if (!modelDownload) return { ok: false, error: 'not_downloading' };
    modelDownload.controller.abort();
    return { ok: true };
  }),

  deleteModel: publicProcedure.input(z.object({ name: z.string() })).mutation(({ input }) => {
    if (modelDownload?.name === input.name) return { ok: false, error: 'busy' };
    return deleteModel(input.name);
  }),

  // ─── Consent ───

  consent: publicProcedure.query(async () => {
    const row = await prisma.systemConfig.findUnique({ where: { key: CONSENT_KEY } });
    return { acknowledgedAt: row?.value || null };
  }),

  acknowledgeConsent: publicProcedure.mutation(async () => {
    const at = new Date().toISOString();
    await prisma.systemConfig.upsert({
      where: { key: CONSENT_KEY },
      create: { key: CONSENT_KEY, value: at },
      update: { value: at },
    });
    // Stamp open recordings so the record survives even if the row is recreated.
    await prisma.meeting
      .updateMany({ where: { status: 'recording' }, data: { consentAcknowledgedAt: at } })
      .catch(() => {});
    return { ok: true, acknowledgedAt: at };
  }),
});

// ─── Helpers ───

function parseArray(json: string | null): unknown[] {
  if (!json) return [];
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function addDays(stamp: string, days: number): string {
  const d = new Date(stamp.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toLocaleString('sv-SE').replace('T', ' ');
}

function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function safeFileName(name: string): string {
  return (name || 'meeting').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}
