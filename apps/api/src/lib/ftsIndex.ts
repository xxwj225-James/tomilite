// ═══ Search index maintenance ═══
//
// Two objects share one version stamp because they share one rebuild transaction:
//
//   global_fts   — the FTS5 index behind every search entry point
//   embed_queue  — the durable work list for local vector embedding
//
// ─── Why this is NOT an entry in the versioned migration array ───
//
// ensureSchema() (server.ts) marks SystemConfig.schemaVersion as applied even when
// an entry throws, and the loop skips any entry whose version is already stamped —
// so a migration that failed once is NEVER retried. For ordinary additive DDL that
// is survivable. For this index it is not: a single transient failure would leave
// Chinese full-text search permanently broken with no recovery path, and there is
// no pre-migration database backup anywhere in the codebase to fall back on.
//
// So the index re-evaluates its own preconditions on EVERY boot instead. A crash,
// a busy database, or a failed statement mid-rebuild is simply retried next launch;
// the stamp is only written after the rebuild verifiably succeeded.
//
// ─── Ordering invariant ───
//
// The rebuild runs BEFORE server.listen() (see the boot chain at the bottom of
// server.ts), so no request can observe a half-dropped index. Its DDL is wrapped in
// one transaction, and triggers are dropped BEFORE the table they write to: if the
// process dies between DROP TABLE global_fts and the trigger recreation, every
// INSERT into a source table (Issue/KnowledgePage/SmartEmail/GitCommit/Report, and
// since the 7-source revision also ChatMessage/Meeting — so chat is in that blast
// radius too, not just search) would throw "no such table: main.global_fts" for the
// rest of the session. Do not reorder those statements, and do not move this call
// into startBackgroundTasks() for a faster boot.

import { existsSync, statSync, statfsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { prisma } from '@tomilite/database';
import { DATA_DIR } from './meeting/paths.js';
import { INDEX_VERSION } from './fts.js';

export type EnsureResult = 'ok' | 'rebuilt' | 'deferred' | 'failed';

/** The slice of node:sqlite's DatabaseSync this module uses. */
interface Db {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
    run(...params: unknown[]): unknown;
  };
  close(): void;
}

const STAMP_KEY = 'ftsVersion';
const PENDING_KEY = 'ftsRebuildPending';
const VACUUM_KEY = 'ftsVacuumPending';

// Source tables, in the same shape the original initFTS5 used (server.ts history).
// `type` is the discriminator stored in global_fts.type and matched by every trigger.
//
// `updateOf`, when present, names the columns whose change is worth re-indexing and
// makes the UPDATE trigger an `AFTER UPDATE OF <cols>`. Two of these tables are
// written for reasons that have nothing to do with their indexed text, so a bare
// `AFTER UPDATE ON` would re-tokenize them on every such write:
//   * ChatMessage — five renderer call sites call updateMessage({card}) to cancel,
//     delete or force-resolve a card; only `text` changes the indexed body.
//   * Meeting — the transcription job writes transcribeProgress on every percent,
//     which would otherwise rewrite the whole transcript into the index ~100x.
// Same reasoning the embed triggers already carry (see EMBED_TABLES below).
//
// Chat puts its message text in `body` with an EMPTY `title`, unlike every other
// source. There is no short title to put there (the session title would need a JOIN
// to ChatSession, and a rename would then have to rewrite every one of its message
// rows — global_fts has only ref_id, so it could not even find them). The caller
// resolves the session title instead, which makes a rename cost zero index writes.
// No length cap: measured on a real snapshot, ChatMessage held 188 rows / 54k chars
// total (longest 16.8k), so capping at 4k would only have made one real message's
// remaining 12.8k chars unsearchable in exchange for no meaningful size win.
const SOURCES: Array<{ type: string; table: string; title: string; body: string; id: string; updateOf?: string[] }> = [
  { type: 'issue', table: 'Issue', title: 'title', body: "COALESCE(description,'')", id: 'id' },
  { type: 'note', table: 'KnowledgePage', title: 'title', body: "COALESCE(content,'')", id: 'id' },
  { type: 'email', table: 'SmartEmail', title: 'subject', body: "COALESCE(bodySnapshot,summary,'')", id: 'id' },
  { type: 'git', table: 'GitCommit', title: 'message', body: 'author', id: 'id' },
  { type: 'report', table: 'Report', title: 'title', body: "COALESCE(content,'')", id: 'id' },
  { type: 'chat', table: 'ChatMessage', title: "''", body: "COALESCE(text,'')", id: 'id', updateOf: ['text'] },
  {
    type: 'meeting',
    table: 'Meeting',
    title: 'title',
    body: "COALESCE(minutes,'')||' '||COALESCE(summary,'')||' '||COALESCE(transcript,'')",
    id: 'id',
    updateOf: ['title', 'minutes', 'summary', 'transcript'],
  },
];

// `type` and `ref_id` are UNINDEXED: they are read back by the triggers and by the
// `WHERE type = ?` post-filters, never searched. Leaving them indexed made
// `MATCH 'note'` spuriously hit the type column. The other two stay indexed.
const FTS_DDL = `CREATE VIRTUAL TABLE global_fts USING fts5(
  type UNINDEXED,
  title,
  body,
  ref_id UNINDEXED,
  tokenize = 'trigram'
)`;

// The 21 sync triggers. The body is unchanged from the original initFTS5 — they never
// mention the tokenizer, and their `WHERE ref_id=... AND type=...` predicates work
// exactly the same against UNINDEXED columns (verified). Do not convert them to
// rowid lookups: that would need a schema change for no benefit.
//
// The four maps below are parallel by `key` and must stay in step. They are not
// folded into SOURCES because the SELECT form takes bare columns and the trigger
// form takes `new.`-prefixed ones; a shared builder would need an identifier-
// rewriting pass, which is the kind of clever this file deliberately avoids.
const FTS_TRIGGER_KEYS = ['issue', 'note', 'email', 'git', 'report', 'chat', 'meeting'];
const FTS_SOURCE_TABLE: Record<string, string> = {
  issue: 'Issue',
  note: 'KnowledgePage',
  email: 'SmartEmail',
  git: 'GitCommit',
  report: 'Report',
  chat: 'ChatMessage',
  meeting: 'Meeting',
};
const FTS_INSERT: Record<string, string> = {
  issue: "VALUES('issue',new.title,new.description,new.id)",
  note: "VALUES('note',new.title,new.content,new.id)",
  email: "VALUES('email',new.subject,COALESCE(new.bodySnapshot,new.summary,''),new.id)",
  git: "VALUES('git',new.message,new.author,new.id)",
  report: "VALUES('report',new.title,new.content,new.id)",
  chat: "VALUES('chat','',COALESCE(new.text,''),new.id)",
  meeting:
    "VALUES('meeting',new.title,COALESCE(new.minutes,'')||' '||COALESCE(new.summary,'')||' '||COALESCE(new.transcript,''),new.id)",
};
const FTS_UPDATE_SET: Record<string, string> = {
  issue: 'SET title=new.title, body=new.description',
  note: 'SET title=new.title, body=new.content',
  email: "SET title=new.subject, body=COALESCE(new.bodySnapshot,new.summary,'')",
  git: 'SET title=new.message, body=new.author',
  report: 'SET title=new.title, body=new.content',
  chat: "SET title='', body=COALESCE(new.text,'')",
  meeting:
    "SET title=new.title, body=COALESCE(new.minutes,'')||' '||COALESCE(new.summary,'')||' '||COALESCE(new.transcript,'')",
};
/** Per-type column list for `AFTER UPDATE OF`. Absent = fire on any column. */
const FTS_UPDATE_OF: Record<string, string> = {
  chat: 'text',
  meeting: 'title, minutes, summary, transcript',
};

function ftsTriggers(): string[] {
  const out: string[] = [];
  for (const key of FTS_TRIGGER_KEYS) {
    const t = FTS_SOURCE_TABLE[key];
    const of = FTS_UPDATE_OF[key];
    out.push(
      `CREATE TRIGGER fts_${key}_i AFTER INSERT ON ${t} BEGIN INSERT INTO global_fts(type,title,body,ref_id) ${FTS_INSERT[key]}; END`,
    );
    out.push(
      `CREATE TRIGGER fts_${key}_u AFTER UPDATE${of ? ` OF ${of}` : ''} ON ${t} BEGIN UPDATE global_fts ${FTS_UPDATE_SET[key]} WHERE ref_id=new.id AND type='${key}'; END`,
    );
    out.push(
      `CREATE TRIGGER fts_${key}_d AFTER DELETE ON ${t} BEGIN DELETE FROM global_fts WHERE ref_id=old.id AND type='${key}'; END`,
    );
  }
  return out;
}

// Only notes and reports get vectors. The queue is what lets a single trigger catch
// every writer — there are ~24 note/report write paths across tools, routers, MCP and
// the chat distiller, and a helper called from each one would be missed by the 25th.
//
// `AFTER UPDATE OF title, content` is load-bearing: without the column list, a write
// that only touches status/uuid/updatedAt would re-embed for nothing.
const EMBED_TABLES: Array<{ kind: string; table: string; content: string }> = [
  { kind: 'note', table: 'KnowledgePage', content: 'content' },
  { kind: 'report', table: 'Report', content: 'content' },
];

const EMBED_QUEUE_DDL = `CREATE TABLE IF NOT EXISTS embed_queue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  queuedAt TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const EMBED_QUEUE_INDEX_DDL = 'CREATE INDEX IF NOT EXISTS embed_queue_queuedAt_idx ON embed_queue(queuedAt)';

function embedTriggers(): string[] {
  const out: string[] = [];
  for (const { kind, table, content } of EMBED_TABLES) {
    const cols = `id,kind,ref_id,attempts,queuedAt`;
    const vals = `'${kind}:'||new.id,'${kind}',new.id,0,datetime('now')`;
    out.push(
      `CREATE TRIGGER embed_${kind}_i AFTER INSERT ON ${table} BEGIN INSERT OR REPLACE INTO embed_queue(${cols}) VALUES(${vals}); END`,
    );
    out.push(
      `CREATE TRIGGER embed_${kind}_u AFTER UPDATE OF title, ${content} ON ${table} BEGIN INSERT OR REPLACE INTO embed_queue(${cols}) VALUES(${vals}); END`,
    );
    out.push(`CREATE TRIGGER embed_${kind}_d AFTER DELETE ON ${table} BEGIN DELETE FROM embed_queue WHERE id='${kind}:'||old.id; END`);
  }
  return out;
}

/** Every trigger this module owns, so a rebuild can drop them before the table. */
function allTriggerNames(): string[] {
  const names: string[] = [];
  for (const key of FTS_TRIGGER_KEYS) names.push(`fts_${key}_i`, `fts_${key}_u`, `fts_${key}_d`);
  for (const { kind } of EMBED_TABLES) names.push(`embed_${kind}_i`, `embed_${kind}_u`, `embed_${kind}_d`);
  return names;
}

/**
 * The SQLite file the API is actually serving. Derived from DATABASE_URL rather
 * than assumed, because electron/main.js passes `file:<abs path>` while dev runs
 * may point anywhere.
 */
export function dbFilePath(): string {
  const url = process.env.DATABASE_URL || '';
  if (url.startsWith('file:')) {
    let p = url.slice('file:'.length);
    if (p.startsWith('//')) p = p.slice(2);
    if (p.endsWith('?') || p.includes('?')) p = p.split('?')[0];
    if (p) {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    }
  }
  return join(DATA_DIR, 'dev.db');
}

async function openDb(): Promise<Db | null> {
  try {
    // Lazy so a runtime without node:sqlite degrades to "no index maintenance"
    // instead of failing the whole API at import time.
    const mod: any = await import('node:sqlite');
    const db = new mod.DatabaseSync(dbFilePath()) as Db;
    db.exec('PRAGMA busy_timeout = 15000');
    return db;
  } catch (e) {
    console.error('[Search] node:sqlite unavailable:', msg(e));
    return null;
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function scalar(db: Db, sql: string): number {
  const row = db.prepare(sql).get();
  const v = row ? Object.values(row)[0] : 0;
  return typeof v === 'number' ? v : Number(v ?? 0);
}

async function getCfg(key: string): Promise<string | null> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function setCfg(key: string, value: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function delCfg(key: string): Promise<void> {
  try {
    await prisma.systemConfig.delete({ where: { key } });
  } catch {
    /* absent is the desired state */
  }
}

function ftsTableSql(db: Db): string | null {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='global_fts'").get();
  return row ? String(row.sql ?? '') : null;
}

function tableExists(db: Db, name: string): boolean {
  const row = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return !!row && Number(row.n) > 0;
}

/** Which sources exist — a half-built schema must not abort the whole rebuild. */
function presentSources(db: Db) {
  return SOURCES.filter((s) => tableExists(db, s.table));
}

function sourceRowTotal(db: Db, sources: ReturnType<typeof presentSources>): number {
  let n = 0;
  for (const s of sources) n += scalar(db, `SELECT count(*) FROM ${s.table}`);
  return n;
}

/**
 * Preconditions, all re-checked every boot. Any failure here means the index cannot
 * be trusted, and the rebuild is the only way to get to a known-good state.
 */
async function needsRebuild(db: Db): Promise<string | null> {
  const sql = ftsTableSql(db);
  if (!sql) return 'global_fts missing';
  if (!/trigram/i.test(sql)) return 'tokenizer is not trigram';
  if (!/UNINDEXED/i.test(sql)) return 'type/ref_id are indexed';
  if (!tableExists(db, 'embed_queue')) return 'embed_queue missing';
  if ((await getCfg(STAMP_KEY)) !== String(INDEX_VERSION)) return 'stamp is stale';
  return null;
}

function hasDiskHeadroom(path: string): boolean {
  try {
    const size = existsSync(path) ? statSync(path).size : 0;
    const st = statfsSync(dirname(path) || '.');
    const free = Number(st.bavail) * Number(st.bsize);
    // Rebuild + VACUUM peak at roughly twice the file, plus slack for the WAL.
    return free >= size * 2 + 64 * 1024 * 1024;
  } catch {
    return true; // can't measure → don't block on it
  }
}

/**
 * Drop and recreate the index in one transaction, then repopulate from the sources.
 *
 * Recreating rather than ALTERing is the point: `CREATE VIRTUAL TABLE IF NOT EXISTS`
 * silently keeps a table with the wrong tokenizer, which is precisely the failure
 * mode that made Chinese search return nothing. `DROP` + unconditional `CREATE`
 * cannot leave a wrong definition behind.
 */
function rebuild(db: Db): { ok: boolean; detail: string } {
  const sources = presentSources(db);
  try {
    db.exec('BEGIN IMMEDIATE');
    // Triggers first: dropping the FTS table while they exist leaves them dangling
    // and every later write to a source table fails.
    for (const name of allTriggerNames()) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
    db.exec('DROP TABLE IF EXISTS global_fts');
    db.exec(FTS_DDL);
    // Unconditional CREATE: `IF NOT EXISTS` never updates an existing trigger body,
    // so a future edit to one would be silently ignored forever.
    for (const sql of ftsTriggers()) db.exec(sql);
    db.exec(EMBED_QUEUE_DDL);
    db.exec(EMBED_QUEUE_INDEX_DDL);
    for (const sql of embedTriggers()) db.exec(sql);
    // No `OR IGNORE`: the table is empty, and IGNORE never did anything anyway — FTS5
    // has no unique constraint to violate. That is what let the old unconditional
    // repopulation grow the index by a full copy of the corpus on every boot.
    for (const s of sources) {
      db.exec(
        `INSERT INTO global_fts(type,title,body,ref_id) SELECT '${s.type}',${s.title},${s.body},${s.id} FROM ${s.table}`,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* the transaction was already unwound */
    }
    return { ok: false, detail: msg(e) };
  }

  // The index must hold exactly one row per source row. A mismatch means the rebuild
  // did not do what it claims, so leave the stamp unwritten and retry next boot.
  const indexed = scalar(db, 'SELECT count(*) FROM global_fts');
  const expected = sourceRowTotal(db, sources);
  if (indexed !== expected) return { ok: false, detail: `global_fts=${indexed} but sources=${expected}` };
  return { ok: true, detail: `${indexed} rows from ${sources.length} tables` };
}

let running: Promise<EnsureResult> | null = null;

/**
 * Bring global_fts and embed_queue to the current definition. Idempotent and
 * self-healing; never throws.
 */
export async function ensureSearchIndexes(): Promise<EnsureResult> {
  if (!running) {
    running = run().finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(): Promise<EnsureResult> {
  const db = await openDb();
  if (!db) return 'failed';
  try {
    const reason = await needsRebuild(db);
    if (!reason) {
      // Normal boot. Cheap drift guard against a future regression that goes back to
      // repopulating unconditionally — on a healthy index this counts ~1.6k rows.
      const sources = presentSources(db);
      const indexed = scalar(db, 'SELECT count(*) FROM global_fts');
      const expected = sourceRowTotal(db, sources);
      if (indexed > expected * 2 + 100) {
        console.warn(`[Search] Index drift detected (${indexed} rows for ${expected} sources) — rebuilding`);
        return stamp(db, rebuild(db));
      }
      return 'ok';
    }

    const path = dbFilePath();
    if (!hasDiskHeadroom(path)) {
      // Deferring is better than starting a destructive rebuild we cannot finish;
      // the stale index keeps serving reads in the meantime.
      console.error(`[Search] Rebuild needed (${reason}) but disk is short — deferring to next launch`);
      await setCfg(PENDING_KEY, '1').catch(() => {});
      return 'deferred';
    }

    console.warn(`[Search] Rebuilding global_fts (${reason})`);
    return stamp(db, rebuild(db));
  } catch (e) {
    console.error('[Search] Index maintenance failed:', msg(e));
    return 'failed';
  } finally {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
}

async function stamp(db: Db, result: { ok: boolean; detail: string }): Promise<EnsureResult> {
  if (!result.ok) {
    // No stamp on failure — the checks re-run next boot, which is the retry path.
    console.error('[Search] Index rebuild failed:', result.detail);
    return 'failed';
  }
  await setCfg(STAMP_KEY, String(INDEX_VERSION));
  await delCfg(PENDING_KEY);
  // VACUUM cannot run inside the rebuild transaction, and it is a multi-second stall
  // on a large file — so it is deferred to after listen() instead.
  await setCfg(VACUUM_KEY, '1');
  console.warn(`[Search] global_fts rebuilt (${result.detail})`);
  return 'rebuilt';
}

/**
 * Return the space the rebuild freed to the filesystem. Called after the server is
 * listening (a VACUUM takes an exclusive lock and can take a while on a large file,
 * which would otherwise show up as "the app takes a minute to start").
 *
 * The pending flag stays set on failure, so a busy database is retried next boot.
 */
export async function reclaimIndexSpace(): Promise<boolean> {
  if ((await getCfg(VACUUM_KEY)) !== '1') return false;
  const db = await openDb();
  if (!db) return false;
  try {
    db.exec('PRAGMA busy_timeout = 60000');
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* not in WAL mode — VACUUM below still reclaims */
    }
    db.exec('VACUUM');
    await delCfg(VACUUM_KEY);
    console.warn('[Search] Reclaimed freed index space');
    return true;
  } catch (e) {
    console.error('[Search] VACUUM deferred to next launch:', msg(e));
    return false;
  } finally {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
}

/** Observability + the assertions the verification harness makes. */
export async function globalFtsStatus(): Promise<{
  installed: boolean;
  tokenizer: string | null;
  rowCount: number;
  sourceTotal: number;
  stamped: string | null;
  vacuumPending: boolean;
}> {
  const db = await openDb();
  const stamped = await getCfg(STAMP_KEY);
  const vacuumPending = (await getCfg(VACUUM_KEY)) === '1';
  if (!db) return { installed: false, tokenizer: null, rowCount: 0, sourceTotal: 0, stamped, vacuumPending };
  try {
    const sql = ftsTableSql(db);
    const m = sql?.match(/tokenize\s*=\s*'([^']+)'/i);
    const rowCount = sql ? scalar(db, 'SELECT count(*) FROM global_fts') : 0;
    return {
      installed: !!sql,
      tokenizer: m ? m[1] : null,
      rowCount,
      sourceTotal: sourceRowTotal(db, presentSources(db)),
      stamped,
      vacuumPending,
    };
  } catch (e) {
    console.error('[Search] Status check failed:', msg(e));
    return { installed: false, tokenizer: null, rowCount: 0, sourceTotal: 0, stamped, vacuumPending };
  } finally {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
}

/** Resolve a possibly-relative DB path the way the verification harness needs. */
export function absoluteDbPath(): string {
  const p = dbFilePath();
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}
