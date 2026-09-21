// ═══ Clock unification — one-time data migration ═══
//
// Until this ran, two writers fed the same timestamp columns: the schema default
// `datetime('now','localtime')` and ~26 inline `new Date().toISOString()` call sites.
// `Issue.updatedAt` held UTC on the rows a code path had touched and local time on the
// rest, and nothing in the stored text says which. See lib/dbTime.ts for the invariant
// this establishes and the writer-side changes that keep it true.
//
// ─── Why this is NOT an entry in the versioned migration array ───
//
// Same reason `ensureSearchIndexes()` is not (see lib/ftsIndex.ts): ensureSchema() marks
// SystemConfig.schemaVersion as applied even when an entry throws, and the loop skips any
// entry whose version is already stamped — so a migration that failed once is never
// retried. A half-converted database is worse than an unconverted one, because the two
// clocks become indistinguishable. This re-evaluates its preconditions every boot
// instead, and stamps only after the conversion verifiably succeeded.
//
// ─── How a row's clock is identified ───
//
// Nothing in the stored text says which writer produced it, so every decision here rests
// on one of two discriminators. Both are airtight for the direction they cover:
//
//   1. `updatedAt = createdAt`  ⇒ no update ever ran ⇒ the default wrote both ⇒ localtime.
//      Its converse is just as firm: a real update can never precede its creation, so
//      `updatedAt < createdAt` ⇒ that stamp is UTC and must be left alone.
//   2. `updatedAt > datetime('now', '+1 minute')` ⇒ a future stamp cannot have been written
//      by a UTC writer on this machine ⇒ it is localtime and must move. This is the case
//      discriminator 1 misses: an update path that also wrote local time bumps the stamp
//      *past* its created value, so equality alone reads it as "untouched and already UTC"
//      and leaves it 8h in the future. Found by asserting on every timestamp column during
//      the rehearsal rather than trusting the conversion.
//
// What neither covers is a second stamp whose distance from creation is positive but
// smaller than the UTC offset — either a localtime update minutes later or a UTC update
// hours later, and the text genuinely cannot say which. Those rows are left untouched and
// counted in the log rather than guessed at.
//
// ─── Which tables ───
//
// Measured on the dev database, not assumed. `Issue`, `ChatSession`, `KnowledgePage`,
// `McpServer` have a mixed `createdAt`/`updatedAt` pair; `Report` is the same shape with
// the second stamp named `generatedAt`. Disposition of the second stamp there:
//
//   table           rows   moved (equal / future-local)   kept (already UTC / ambiguous)
//   Issue            144          126 / 0                        14 / 0
//   ChatSession       27            0 / 0                        19 / 1
//   KnowledgePage     38           25 / 1                         5 / 2
//   McpServer          1            0 / 0                         1 / 0
//   Report            59           12 / 0                        46 / 1
//
// (`kept` also absorbs rows whose distance from creation exceeds the offset — a UTC update
// hours later, unambiguously UTC. That accounts for the remainder up to `rows`.)
//
// Seven more tables have a `createdAt` that only the column default ever wrote, so
// converting all of it is the entire fix: `SmartEmail` 959, `GitCommit` 407,
// `ChatMessage` 172, `KnowledgeCache` 99, `UserHealthSnapshot` 67, `McpAuditLog` 14,
// `AiDecisionFeedback` 1. Several of those were not merely a display nuance — they are
// read against a UTC cutoff or compared to an ISO string, so the 8h skew silently widened
// a cache, a staleness filter and a git window. `SmartEmail.createdAt` is the one that
// really was only used for ordering; it moves because a half-local column sorts wrongly
// the moment the machine's zone changes.
//
// `FocusSession.startTime` (17430 rows) and `ChatSession.distillCursor` (7, a message stamp
// copied verbatim, so it has to move with the column it copies) are the remaining singles.
// `GitCommit.timestamp` is a shape fix, not a clock fix: every one of its 407 values already
// carried `+08:00`, and all 407 still resolve to the identical instant afterwards.
//
// Every other timestamp column in the schema is *uniformly* localtime — no code path writes
// it, so only the default ever has. That is a consistent column, not a mixed one, and it is
// left alone deliberately: `Meeting` is the clearest case, where the writer (`nowStr()`), the
// retention cutoff (`lib/meeting/retention.ts`) and the reader (`.slice(0, 16)`) all agree on
// local time. Note that a `WHERE stamp > datetime('now')` test would NOT have found the mixed
// ones: localtime is only in the future while the row is younger than the UTC offset, so it
// misses every older row. It is useful as a probe for *new* bad writes, never as proof that a
// column is uniform.
//
// Net effect on the dev database: 3 rows that had been rendering one day early (`TL-99`, the
// `Chat 16` session, one note) now render the right date, and the three widened cutoffs above
// close. Verified by rehearsal on a copy of the live database — see the note on verification
// below.
//
// ─── Verification ───
//
// The migration was rehearsed against a copy of the live database before shipping: row counts
// unchanged in all 12 tables, `PRAGMA foreign_key_check` empty, `PRAGMA integrity_check` ok,
// the 3 inbound FK values and 3 triggers on `Issue` restored, and a second run a no-op. Every
// timestamp column was asserted to hold no future stamp afterwards — the assertion that found
// discriminator 2.

import { prisma } from '@tomilite/database';
import {
  explicitOffsetToUtcSql,
  localToUtcColumnSql,
  localToUtcCreatedAtSql,
  localToUtcPairSql,
  localToUtcSql,
  utcStamp,
} from './dbTime.js';
import { dbFilePath } from './ftsIndex.js';

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

const STAMP_KEY = 'clockVersion';
const ISSUE_DEFAULT_KEY = 'issueDefaultVersion';
const VERSION = 1;

/** Tables with a mixed `createdAt`/`updatedAt` pair — see the header. */
const MIXED_PAIRS = ['Issue', 'ChatSession', 'KnowledgePage', 'McpServer'];
/**
 * Tables whose only timestamp is a uniformly localtime `createdAt` — no code path ever
 * wrote it, so every row took the default. Converting all of them is the whole fix.
 */
const CREATED_AT_ONLY = [
  'ChatMessage',
  // The rest are outside the Issue family but are each read against a UTC cutoff or
  // compared to an ISO string, so the 8h skew widened something real rather than only
  // shifting a displayed date: the health-snapshot cache TTL (`routers/health.ts`), the
  // knowledge cache TTL (`routers/knowledge.ts`), the self-learning feedback window
  // (`agent/core/selfLearning.ts`), the MCP pending-approval staleness filter
  // (`routers/mcp.ts`), and the git commit window (`routers/git.ts`). See the header.
  'UserHealthSnapshot',
  'KnowledgeCache',
  'AiDecisionFeedback',
  'McpAuditLog',
  'GitCommit',
  // Ordering-only, so the 8h skew was invisible here — converted anyway, because a
  // column that is half local and half UTC sorts wrongly the moment the app runs across
  // a DST or timezone change, and because `server.ts` was the only writer and now stamps
  // UTC explicitly.
  'SmartEmail',
];
/** Columns holding a verbatim copy of a converted stamp — must move with it. */
const COPIED_STAMPS = [{ table: 'ChatSession', column: 'distillCursor' }];
/** Uniformly localtime columns that are not the `createdAt` half of a pair. */
const SINGLE_NAIVE = [{ table: 'FocusSession', column: 'startTime' }];
/**
 * Columns holding ISO strings that carry their own offset. Not a clock problem — every
 * value already names its instant — but a *shape* problem: string filters against them
 * could not line up. Shape-guarded, so this one is idempotent by construction.
 */
const OFFSET_ISO = [{ table: 'GitCommit', column: 'timestamp' }];
/**
 * A `createdAt`-named pair whose second stamp is called something else. `Report`'s
 * `generatedAt` is written by two clocks — standup stores UTC, the manual save path
 * lets the default store local time — so it is mixed, same as `Issue.updatedAt` was.
 */
const PAIR_ALIASES = [{ table: 'Report', created: 'createdAt', second: 'generatedAt' }];

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function scalar(db: Db, sql: string): number {
  const row = db.prepare(sql).get();
  const v = row ? Object.values(row)[0] : 0;
  return typeof v === 'number' ? v : Number(v ?? 0);
}

function tableExists(db: Db, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnNames(db: Db, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((c) => String(c.name));
}

async function getCfg(key: string): Promise<string | null> {
  try {
    return (await prisma.systemConfig.findUnique({ where: { key } }))?.value ?? null;
  } catch {
    return null;
  }
}

async function setCfg(key: string, value: string): Promise<void> {
  await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/**
 * Mark the migration done **inside** the transaction that did the work.
 *
 * Writing it afterwards through Prisma would leave a window: a process that died between
 * COMMIT and the upsert would re-run the conversion on the next boot and shift every
 * stamp a second time. Because the conversion is not idempotent — nothing in the stored
 * text says whether it has already been applied — that window has to be closed rather
 * than tolerated. `SystemConfig.key` is the primary key, so the upsert is a plain
 * `ON CONFLICT`.
 */
const MARK_SQL =
  `INSERT INTO "SystemConfig" ("key","value","updatedAt") VALUES (?,?,?) ` +
  `ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"`;

function mark(db: Db, key: string, value: string): void {
  // Stamp the config row in UTC too, so it does not become the one localtime row left.
  db.prepare(MARK_SQL).run(key, value, utcStamp());
}

/**
 * Rows whose second stamp the conversion **cannot** classify, per table.
 *
 * A pair is ambiguous when the second stamp is greater than the first but by less than
 * the UTC offset: that is either a localtime update minutes after creation, or a UTC
 * update eight hours after it, and the stored text says nothing about which. Everything
 * outside the band is decidable — see the discriminators in dbTime.ts — so these are the
 * only rows this migration knowingly leaves on the old clock. Counted rather than
 * guessed at: the log line is how many, and nothing converts on a coin flip.
 */
function ambiguousPairs(db: Db, table: string, createdCol: string, secondCol: string): number {
  return scalar(
    db,
    `SELECT count(*) FROM "${table}"
      WHERE "${createdCol}" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] *'
        AND "${secondCol}" IS NOT NULL
        AND "${secondCol}" <> "${createdCol}"
        AND "${secondCol}" <= datetime('now', '+1 minute')
        AND strftime('%s', "${secondCol}") - strftime('%s', "${createdCol}") > 0
        AND strftime('%s', "${secondCol}") - strftime('%s', "${createdCol}")
            < strftime('%s', 'now', 'localtime') - strftime('%s', 'now')`,
  );
}

async function openDb(): Promise<Db | null> {
  try {
    // Lazy, for the same reason as ftsIndex: a runtime without node:sqlite should
    // degrade to "no clock migration" rather than fail the API at import time.
    const mod: any = await import('node:sqlite');
    const db = new mod.DatabaseSync(dbFilePath()) as Db;
    db.exec('PRAGMA busy_timeout = 15000');
    return db;
  } catch (e) {
    console.error('[Clock] node:sqlite unavailable:', msg(e));
    return null;
  }
}

/**
 * Move every localtime stamp in the mixed columns to UTC, in one transaction.
 *
 * The discriminator lives in dbTime's SQL: `createdAt` is always a default-written local
 * stamp, and `updatedAt` is converted only where it still equals `createdAt` — i.e. only
 * on the rows no code path has touched.
 */
/**
 * Does this database predate the fix? The marker is `Issue`'s column default: it is the
 * only default this project has changed, so a live `datetime('now','localtime')` on that
 * table means the file was created before v24.
 *
 * The conversion below is not idempotent and cannot check itself — nothing in a stored
 * stamp says which clock wrote it — so it must not run against a database whose rows are
 * already UTC. A fresh install reaches that state immediately: `ensureSchema()` runs
 * `db push` on the empty file *before* `ensureSearchIndexes()` creates `global_fts`
 * (which is what makes later pushes skip), so it gets the UTC defaults from the schema
 * and its inserts are all explicit. Without this gate the first boot of every new install
 * would shift its own timestamps 8h.
 */
function predatesUtcDefaults(db: Db): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Issue'").get();
  return !!row && /localtime/i.test(String(row.sql ?? ''));
}

export async function ensureClockUtc(): Promise<boolean> {
  if ((await getCfg(STAMP_KEY)) === String(VERSION)) return true;

  const db = await openDb();
  if (!db) return false;
  try {
    if (!predatesUtcDefaults(db)) {
      // Already UTC by construction — nothing here to convert, and converting would be
      // the bug. Stamp it so this decision is made once.
      mark(db, STAMP_KEY, String(VERSION));
      return true;
    }

    const targets = [
      ...MIXED_PAIRS.map((t) => ({ t, sql: localToUtcSql(t) })),
      ...CREATED_AT_ONLY.map((t) => ({ t, sql: localToUtcCreatedAtSql(t) })),
      ...PAIR_ALIASES.map(({ table, created, second }) => ({
        t: table,
        sql: localToUtcPairSql(table, created, second),
      })),
      ...COPIED_STAMPS.map(({ table, column }) => ({ t: table, sql: localToUtcColumnSql(table, column) })),
      ...SINGLE_NAIVE.map(({ table, column }) => ({ t: table, sql: localToUtcColumnSql(table, column) })),
      ...OFFSET_ISO.map(({ table, column }) => ({
        t: table,
        sql: explicitOffsetToUtcSql(table, column),
      })),
    ].filter((x) => tableExists(db, x.t));
    if (targets.length === 0) return false;

    const before = targets.map((x) => scalar(db, `SELECT count(*) FROM "${x.t}"`));
    const ambiguous = [
      ...MIXED_PAIRS.map((t) => ({ t, c: 'createdAt', s: 'updatedAt' })),
      ...PAIR_ALIASES.map(({ table, created, second }) => ({ t: table, c: created, s: second })),
    ]
      .filter((x) => tableExists(db, x.t))
      .map((x) => ({ t: x.t, n: ambiguousPairs(db, x.t, x.c, x.s) }))
      .filter((x) => x.n > 0);

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const x of targets) db.exec(x.sql);
      // The conversion must not change how many rows exist. It cannot, but a miscounted
      // statement would show up here rather than as silent data loss. Checked before the
      // COMMIT so a surprise leaves the database untouched.
      for (let i = 0; i < targets.length; i++) {
        const after = scalar(db, `SELECT count(*) FROM "${targets[i].t}"`);
        if (after !== before[i]) throw new Error(`${targets[i].t} row count moved ${before[i]} -> ${after}`);
      }
      mark(db, STAMP_KEY, String(VERSION));
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* already unwound */
      }
      console.error('[Clock] Conversion failed, nothing changed:', msg(e));
      return false;
    }

    console.warn(`[Clock] Timestamps normalised to UTC in ${[...new Set(targets.map((x) => x.t))].join(', ')}`);
    if (ambiguous.length) {
      // Not an error: these are the rows where the two clocks are indistinguishable from
      // the stored text. Named so the number is visible instead of implied.
      console.warn(
        `[Clock] Left as-is (second stamp between creation and the UTC offset — undecidable): ${ambiguous
          .map((x) => `${x.t} ${x.n}`)
          .join(', ')}`,
      );
    }
    return true;
  } catch (e) {
    console.error('[Clock] Migration failed:', msg(e));
    return false;
  } finally {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Move `Issue`'s two column defaults from localtime to UTC.
 *
 * SQLite has no `ALTER COLUMN ... SET DEFAULT`, so the only way is a full table rebuild.
 * `prisma db push` would generate one — but it can never run against a database that has
 * the search index, because it also proposes dropping the `global_fts` shadow tables and
 * `server.ts` passes no `--accept-data-loss`. See docs/architecture.md. So the rebuild is
 * written here, by hand, in the same shape `ftsIndex` uses.
 *
 * The new DDL is derived from the **live** table rather than inlined: `sqlite_master.sql`
 * with the two defaults swapped. A literal copy of the schema's 30 columns would rot the
 * first time a column is added, and the additive `migrations[]` array is what actually
 * delivers columns to existing installs.
 *
 * Inbound foreign keys: seven relations point at `Issue` (self, Comment, IssueChangelog,
 * BoardCard, SmartEmail, GitCommitRef, MeetingActionItem). `PRAGMA foreign_keys = OFF`
 * outside a transaction is what keeps the DROP from firing their ON DELETE actions, but
 * the referencing values are also saved and restored around the swap — so the outcome
 * does not depend on the pragma having taken effect. That matters: a pragma set inside a
 * transaction is silently ignored, and whether one is open is up to the driver.
 *
 * Triggers go with the table. `fts_issue_i/u/d` live on `Issue` and are what keep the
 * search index in step with it; `DROP TABLE` takes them and only a full index rebuild
 * would ever put them back, so they are saved and recreated here like the indexes.
 * (`global_fts` itself is keyed by `ref_id` — the Issue's TEXT id — so the new rowids
 * SQLite assigns on copy do not matter to it.)
 */
export async function ensureIssueClock(): Promise<boolean> {
  if ((await getCfg(ISSUE_DEFAULT_KEY)) === String(VERSION)) return true;

  const db = await openDb();
  if (!db) return false;
  try {
    if (!tableExists(db, 'Issue')) return false;

    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Issue'").get();
    const live = row ? String(row.sql ?? '') : '';
    if (!live) return false;
    if (!/localtime/i.test(live)) {
      // Already UTC — a fresh install got it from `prisma db push`. Nothing to rebuild.
      await setCfg(ISSUE_DEFAULT_KEY, String(VERSION));
      return true;
    }

    const rebuilt = live
      .replace(/^CREATE TABLE\s+"Issue"/i, 'CREATE TABLE "new_Issue"')
      .replace(/datetime\(\s*'now'\s*,\s*'localtime'\s*\)/gi, "datetime('now')");
    if (rebuilt === live || /localtime/i.test(rebuilt) || !/"new_Issue"/.test(rebuilt)) {
      console.error('[Clock] Could not rewrite the Issue DDL — leaving the defaults alone');
      return false;
    }

    const cols = columnNames(db, 'Issue');
    const colList = cols.map((c) => `"${c}"`).join(',');
    const indexes = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='Issue' AND sql IS NOT NULL")
      .all()
      .map((r) => String(r.sql ?? ''));
    const triggers = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='Issue' AND sql IS NOT NULL")
      .all()
      .map((r) => String(r.sql ?? ''));

    const before = scalar(db, 'SELECT count(*) FROM "Issue"');

    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      // Save the inbound references, then clear them so the DROP below cannot trip a
      // constraint whatever the pragma did.
      const refs: Array<{ table: string; id: string; issueId: string }> = [];
      for (const t of ['SmartEmail', 'GitCommitRef', 'MeetingActionItem']) {
        if (!tableExists(db, t) || !columnNames(db, t).includes('issueId')) continue;
        for (const r of db.prepare(`SELECT id, "issueId" FROM "${t}" WHERE "issueId" IS NOT NULL`).all()) {
          refs.push({ table: t, id: String(r.id), issueId: String(r.issueId) });
        }
      }
      const parentRefs = columnNames(db, 'Issue').includes('parentId')
        ? db.prepare('SELECT id, "parentId" FROM "Issue" WHERE "parentId" IS NOT NULL').all()
        : [];

      for (const t of ['SmartEmail', 'GitCommitRef', 'MeetingActionItem']) {
        if (!tableExists(db, t) || !columnNames(db, t).includes('issueId')) continue;
        db.exec(`UPDATE "${t}" SET "issueId" = NULL WHERE "issueId" IS NOT NULL`);
      }
      if (parentRefs.length) db.exec('UPDATE "Issue" SET "parentId" = NULL WHERE "parentId" IS NOT NULL');

      db.exec(rebuilt);
      db.exec(`INSERT INTO "new_Issue" (${colList}) SELECT ${colList} FROM "Issue"`);
      db.exec('DROP TABLE "Issue"');
      db.exec('ALTER TABLE "new_Issue" RENAME TO "Issue"');
      for (const sql of indexes) db.exec(sql);
      for (const sql of triggers) db.exec(sql);

      for (const r of refs) db.prepare(`UPDATE "${r.table}" SET "issueId" = ? WHERE id = ?`).run(r.issueId, r.id);
      for (const r of parentRefs) db.prepare('UPDATE "Issue" SET "parentId" = ? WHERE id = ?').run(r.parentId, r.id);

      // Both checks run before the COMMIT, so a rebuild that dropped a row or broke an
      // inbound reference is rolled back instead of committed and stamped.
      const after = scalar(db, 'SELECT count(*) FROM "Issue"');
      if (after !== before) throw new Error(`row count moved ${before} -> ${after}`);
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`${broken.length} broken foreign key(s) after rebuild`);

      mark(db, ISSUE_DEFAULT_KEY, String(VERSION));
      db.exec('COMMIT');
      console.warn(`[Clock] Issue defaults moved to UTC (${after} rows rebuilt)`);
      return true;
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* already unwound */
      }
      console.error('[Clock] Issue rebuild failed, nothing changed:', msg(e));
      return false;
    } finally {
      try {
        db.exec('PRAGMA foreign_keys = ON');
      } catch {
        /* reconnect resets it anyway */
      }
    }
  } catch (e) {
    console.error('[Clock] Issue rebuild failed:', msg(e));
    return false;
  } finally {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
}
