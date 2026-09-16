// ═══ Embedding work queue ═══
//
// `embed_queue` is populated by six SQL triggers (created in lib/ftsIndex.ts, alongside
// the FTS rebuild — one versioned function owns both, so there is only ever one
// self-healing path to reason about). That choice is the whole design: there are ~24
// places in this codebase that write a note or a report, and a trigger covers every one
// of them including the ones written next quarter, with zero edits to the writers. The
// alternative — calling a helper from each writer — is guaranteed to miss the 25th.
//
// The queue is durable, so an interrupted backfill resumes instead of restarting, and
// `attempts` bounds a row that can never succeed.
import { prisma } from '@tomilite/database';
import {
  embedModelStatus,
  embedPassage,
  embedTextFor,
  encodeVector,
  isEmbedDisabled,
  setEmbedDownloading,
} from './index.js';
import { installEmbedModel } from './modelFiles.js';

/** Bump when the embedded representation changes (different text recipe, different
 *  chunking). A user's existing rows are then re-queued once. */
const BACKFILL_VERSION = '2';
const BACKFILL_KEY = 'embed.backfillVersion';
const STATUS_KEY = 'embed.status';
const ERROR_KEY = 'embed.lastError';

/** After this many failures a row is dropped with a log line, so one unembeddable
 *  record cannot occupy the drain loop forever. */
const MAX_ATTEMPTS = 5;

/** Rows per interval tick and per boot sweep.
 *
 *  Inference is ~17 ms serialized, so 60/tick is about one second of work per minute —
 *  invisible on a desktop that is doing something else, and enough for a 10k-note corpus
 *  to converge in a few hours. The boot sweep takes 200 at once because at that point
 *  semantic search is simply broken until it finishes, and 200 × 17 ms ≈ 3.5 s is a
 *  price worth paying once, 90 seconds after launch, rather than dribbling it out at
 *  10 rows a minute. */
const DRAIN_PER_TICK = 60;
const BOOT_DRAIN = 200;

/** `kind` comes out of the database, so it is mapped to a table name here rather than
 *  interpolated — nothing read from a row may reach SQL as an identifier. */
const TABLES: Record<string, { table: string; title: string; body: string }> = {
  note: { table: 'KnowledgePage', title: 'title', body: 'content' },
  report: { table: 'Report', title: 'title', body: 'content' },
};

function log(msg: string): void {
  console.warn('[Embed] ' + msg);
}

async function setConfig(key: string, value: string): Promise<void> {
  try {
    await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  } catch {
    /* observability only — never let a status write break the work */
  }
}

/**
 * Queue every note and report, once per BACKFILL_VERSION.
 *
 * `force` is the recompute-everything entry point (used after switching models); it
 * bypasses the gate and also resets `attempts`, which is the only way a previously
 * poison-pilled row gets another chance.
 */
export async function enqueueAllStale(force = false): Promise<number> {
  try {
    if (!force) {
      const stamp = await prisma.systemConfig.findUnique({ where: { key: BACKFILL_KEY } });
      if (stamp?.value === BACKFILL_VERSION) return 0;
    }
    const noteRows = await prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO embed_queue(id, kind, ref_id, attempts, queuedAt)
       SELECT 'note:' || id, 'note', id, 0, datetime('now') FROM KnowledgePage`,
    );
    const reportRows = await prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO embed_queue(id, kind, ref_id, attempts, queuedAt)
       SELECT 'report:' || id, 'report', id, 0, datetime('now') FROM Report`,
    );
    await setConfig(BACKFILL_KEY, BACKFILL_VERSION);
    const total = Number(noteRows) + Number(reportRows);
    if (total > 0) log(`queued ${total} rows for embedding (backfill v${BACKFILL_VERSION})`);
    return total;
  } catch (e: unknown) {
    log('backfill enqueue failed: ' + (e instanceof Error ? e.message : String(e)));
    return 0;
  }
}

export interface DrainResult {
  done: number;
  failed: number;
  /** True when the drain declined to run because the model is not usable yet. */
  skipped?: string;
}

/**
 * Embed up to `limit` queued rows.
 *
 * **Refuses to touch the queue unless the model is actually usable.** This guard is the
 * difference between a degraded feature and a destroyed one: an unavailable model makes
 * every row fail, and five drains later the poison-pill rule would have deleted the
 * entire queue and no note would ever be embedded again. Nothing is consumed while the
 * model is missing, so the backlog simply waits for it.
 */
export async function drainEmbedQueue(limit = 10): Promise<DrainResult> {
  if (isEmbedDisabled()) return { done: 0, failed: 0, skipped: 'disabled' };
  const status = await embedModelStatus();
  if (status !== 'ready') return { done: 0, failed: 0, skipped: status };

  let done = 0;
  let failed = 0;
  try {
    const batch = await prisma.$queryRawUnsafe<Array<{ id: string; kind: string; ref_id: string; attempts: number }>>(
      'SELECT id, kind, ref_id, attempts FROM embed_queue ORDER BY queuedAt LIMIT ?',
      limit,
    );
    if (batch.length === 0) return { done, failed };

    for (const job of batch) {
      const spec = TABLES[job.kind];
      if (!spec) {
        // Unknown kind (a trigger added ahead of this code, or a hand-edited row):
        // drop it rather than let it retry forever.
        await prisma.$executeRawUnsafe('DELETE FROM embed_queue WHERE id = ?', job.id);
        log(`dropped queue row with unknown kind "${job.kind}" (${job.id})`);
        continue;
      }
      try {
        const rows = await prisma.$queryRawUnsafe<Array<{ title: string | null; content: string | null }>>(
          `SELECT ${spec.title} AS title, ${spec.body} AS content FROM ${spec.table} WHERE id = ?`,
          job.ref_id,
        );
        const row = rows[0];
        if (!row) {
          // The source row is gone; the AFTER DELETE trigger should have cleaned this
          // up, so reaching here means a trigger was missing. Drop the orphan.
          await prisma.$executeRawUnsafe('DELETE FROM embed_queue WHERE id = ?', job.id);
          continue;
        }
        const vec = await embedPassage(embedTextFor(row.title, row.content));
        if (!vec) throw new Error('embedding returned null');
        // Vector first, queue row second: a crash in between leaves the work queued and
        // merely redundant, which is recoverable. The reverse order loses it.
        await prisma.$executeRawUnsafe(
          `UPDATE ${spec.table} SET vector = ? WHERE id = ?`,
          encodeVector(vec),
          job.ref_id,
        );
        await prisma.$executeRawUnsafe('DELETE FROM embed_queue WHERE id = ?', job.id);
        done++;
      } catch (e: unknown) {
        const attempts = job.attempts + 1;
        const reason = e instanceof Error ? e.message : String(e);
        if (attempts >= MAX_ATTEMPTS) {
          await prisma.$executeRawUnsafe('DELETE FROM embed_queue WHERE id = ?', job.id);
          log(`giving up on ${job.id} after ${attempts} attempts: ${reason}`);
        } else {
          await prisma.$executeRawUnsafe('UPDATE embed_queue SET attempts = ? WHERE id = ?', attempts, job.id);
        }
        failed++;
      }
    }
  } catch (e: unknown) {
    log('drain failed: ' + (e instanceof Error ? e.message : String(e)));
  }
  return { done, failed };
}

/**
 * Boot-time: fetch the model if there is work waiting for it, then drain.
 *
 * The download is not a precondition for anything else — tasks, notes, mail, chat and
 * keyword search all work without it — so it happens here, minutes after boot, and any
 * failure just leaves semantic search unavailable.
 */
export async function embedBootSweep(): Promise<void> {
  if (isEmbedDisabled()) {
    await setConfig(STATUS_KEY, 'disabled');
    return;
  }
  try {
    await enqueueAllStale();

    const pending = await prisma.$queryRawUnsafe<Array<{ n: number }>>('SELECT count(*) AS n FROM embed_queue');
    const waiting = pending[0]?.n ?? 0;
    if (waiting === 0) return;

    if (await embedModelStatus() === 'absent') {
      log(`model missing and ${waiting} rows queued — downloading in the background`);
      await setConfig(STATUS_KEY, 'downloading');
      setEmbedDownloading(true);
      try {
        const res = await installEmbedModel({
          onProgress: () => {},
          onHostFailover: (host) => log(`host failed, trying next: ${host}`),
        });
        if (!res.ok) {
          await setConfig(STATUS_KEY, 'failed');
          await setConfig(ERROR_KEY, res.error || 'unknown');
          log('model download failed: ' + (res.error || 'unknown'));
          return;
        }
        log(`model installed (${res.downloaded.length} file(s) downloaded)`);
        await setConfig(STATUS_KEY, 'ready');
      } finally {
        setEmbedDownloading(false);
      }
    }

    const res = await drainEmbedQueue(BOOT_DRAIN);
    log(`boot sweep: ${res.done} embedded, ${res.failed} failed, ${waiting} were queued`);
    await setConfig(STATUS_KEY, await embedModelStatus());
  } catch (e: unknown) {
    log('boot sweep failed: ' + (e instanceof Error ? e.message : String(e)));
  }
}
