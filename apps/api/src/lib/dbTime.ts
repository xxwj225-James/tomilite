// ═══ Database timestamps ═══
//
// Every timestamp column in this schema is a `String` holding `YYYY-MM-DD HH:MM:SS`
// — a SQLite stamp with **no zone in the text**. That is the whole problem: the
// string alone cannot tell a reader which clock wrote it.
//
// ─── The invariant ───
//
// A stored stamp is **UTC**. Two rules make that true:
//
//   1. Every INSERT sets its timestamps explicitly via `utcStamp()`.
//   2. No row is allowed to be born from the column default.
//
// Rule 2 is why this module exists as one shared helper instead of the pattern it
// replaces. `new Date().toISOString().replace('T',' ').substring(0,19)` was written
// out inline at ~26 sites, while the schema declared
// `@default(dbgenerated("(datetime('now','localtime'))"))` on 41 columns. Two writers,
// one column: `Issue.updatedAt` was UTC on the 18 rows a code path had touched and
// local on the 126 that had only ever taken the default. The reader has no way to
// tell them apart, and `TasksList` renders both by slicing the date — so three rows in
// the dev database (TL-99, the `Chat 16` session, one note) were showing the previous
// calendar day.
//
// `schema.prisma` still declares the localtime default for most tables (changing a
// column default needs a full table rebuild — see `clockUtc.ts`), so rule 2 is
// load-bearing, not decoration: an INSERT that forgets its timestamps silently
// reintroduces a second clock. `Issue` is the one model whose defaults were moved to
// UTC; every other model relies on rule 2 alone.

/**
 * `YYYY-MM-DD HH:MM:SS` in UTC — the shape every DB timestamp column stores.
 *
 * SQLite's own `datetime('now')` produces exactly this in UTC, which is what the
 * `Issue` column defaults now use; the two agree by construction.
 */
export function utcStamp(d: Date = new Date()): string {
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Local-time stamp, `YYYY-MM-DD HH:MM:SS`.
 *
 * Kept only as the counterpart `utcStamp` is defined against — no caller should reach
 * for it to "match the column default". The default is the thing being retired; a
 * writer that uses this in a column some other writer fills with `utcStamp()` is
 * exactly how `KnowledgePage.updatedAt` became a mixed column.
 */
export function localStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Read a stored stamp as UTC. Returns `null` rather than an Invalid Date, so callers
 * cannot accidentally compare against `NaN`.
 *
 * Two shapes reach this. The column shape `YYYY-MM-DD HH:MM:SS` states no zone, so the
 * `Z` is appended — that is the whole point of the invariant. A stamp that *does* carry
 * a zone (GitCommit.timestamp is the one column written as `...T08:34:04+08:00`) already
 * names its instant, so it goes straight to the Date parser instead; appending another
 * `Z` to it would silently shift it by the offset.
 */
export function parseUtc(s: string | null | undefined): Date | null {
  if (!s) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const stated = new Date(s);
    return Number.isNaN(stated.getTime()) ? null : stated;
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s);
  if (m) return new Date(`${m[1]}T${m[2]}Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `parseUtc` as epoch ms, or `null` when the stamp is missing/unreadable. */
export function parseUtcMs(s: string | null | undefined): number | null {
  return parseUtc(s)?.getTime() ?? null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * `YYYY-MM-DD` in the **host's** zone — the calendar day a human would name.
 *
 * For bucketing rows into days (health's one-snapshot-per-day trend). Deriving the day
 * by slicing the stored text gives the *UTC* day instead, which at UTC+8 is the wrong
 * one for everything logged after 16:00 UTC — i.e. after midnight local. The server has
 * no viewer zone to render in, so this uses the host's, which is the same assumption the
 * conversion in `clockUtc.ts` makes.
 */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The SQL that converts a column's existing localtime values to UTC, in place.
 *
 * `strftime(...,'utc')` treats the stored text as localtime and returns UTC, using the
 * **host's timezone at execution time** — the one assumption in this migration that
 * cannot be checked from the data. It matches the assumption the frontend already
 * makes when it parses these stamps as UTC (`apps/web/src/lib/dbTime.ts`), so the two
 * halves agree; a database carried across a timezone change will convert those rows
 * by the wrong offset, and nothing can detect that afterwards.
 *
 * Note that a single UPDATE's SET expressions all read the **old** row values, so the
 * `updatedAt = createdAt` test below sees the pre-conversion pair. That equality is
 * one of two discriminators:
 *
 *   1. `updatedAt = createdAt` — a row no code path has touched, so both are localtime.
 *      A real update never precedes its own creation, so the converse also holds: a row
 *      with `updatedAt < createdAt` had a UTC writer touch it, and its `updatedAt` is
 *      already UTC and must be left alone.
 *   2. `updatedAt > datetime('now')` — **a future stamp cannot have been written by a
 *      UTC writer on this machine**, because a UTC writer only ever writes the present.
 *      Read as UTC it means the row was updated hours from now, so it is localtime and
 *      has to move. This is the case the equality test alone misses: a *localtime*
 *      update path bumping `updatedAt` leaves it greater than `createdAt` by the few
 *      minutes between them, which looks exactly like an untouched row. One live row
 *      was in that state (`KnowledgePage` 21ca62e8, created 09:07 local, updated 09:52
 *      local) and the equality test alone would have left it 8 hours fast.
 *
 * The band between — `0 < updatedAt - createdAt < the UTC offset` — is genuinely
 * ambiguous: it is either a localtime update minutes later, or a UTC update 8 hours
 * later, and nothing in the stored text distinguishes them. Those rows keep their
 * `updatedAt` and are counted in the migration log; see clockUtc.ts.
 *
 * The GLOB guard skips malformed stamps: `strftime` returns NULL for them, and these
 * columns are NOT NULL, which would abort the whole migration transaction.
 */
/**
 * `YYYY-MM-DD HH:MM:SS` and nothing else. Guards every conversion here: `strftime`
 * returns NULL for a value it cannot read, and these columns are NOT NULL, so one
 * malformed or already-ISO stamp would abort the whole transaction instead of being
 * skipped.
 */
const WELL_FORMED = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] *';

export function localToUtcSql(table: string): string {
  return localToUtcPairSql(table, 'createdAt', 'updatedAt');
}

/**
 * The same conversion for a table whose second stamp is not called `updatedAt`.
 * `Report` is the one case: its pair is `(createdAt, generatedAt)`, and it needs the
 * same two discriminators for the same reason — `generatedAt` is written by two
 * different clocks (standup stores UTC, the manual save path lets the default store
 * local time), so it is a mixed column exactly like `Issue.updatedAt` was.
 */
export function localToUtcPairSql(table: string, createdCol: string, secondCol: string): string {
  const stamp = (c: string) => `strftime('%Y-%m-%d %H:%M:%S', "${c}", 'utc')`;
  return `UPDATE "${table}" SET
    "${createdCol}" = ${stamp(createdCol)},
    "${secondCol}" = CASE
      WHEN "${secondCol}" = "${createdCol}" THEN ${stamp(secondCol)}
      WHEN "${secondCol}" > datetime('now', '+1 minute') THEN ${stamp(secondCol)}
      ELSE "${secondCol}" END
  WHERE "${createdCol}" GLOB '${WELL_FORMED}' AND "${secondCol}" IS NOT NULL`;
}

/**
 * Same conversion for a table whose only clock is `createdAt` — no code path writes
 * it, so every row is a default-written localtime value.
 */
export function localToUtcCreatedAtSql(table: string): string {
  return localToUtcColumnSql(table, 'createdAt');
}

/**
 * Shift one column on its own, for a column that is uniformly localtime but is not the
 * `createdAt` half of a pair:
 *
 *   - a column holding a *copy* of another table's stamp, which has to move with it or
 *     stop matching. `ChatSession.distillCursor` is a `ChatMessage.createdAt` stored
 *     verbatim and compared with `gt`, so converting the messages without the cursors
 *     would leave each cursor 8h in the future and stall the distillation until real
 *     time caught up with it.
 *   - `FocusSession.startTime`, whose table has no second stamp at all (`endTime` is
 *     never written).
 *
 * Only safe where *every* row is localtime. On a mixed column this shifts rows that are
 * already UTC — see `localToUtcPairSql` for the discriminator that avoids that.
 */
export function localToUtcColumnSql(table: string, column: string): string {
  return `UPDATE "${table}" SET "${column}" = strftime('%Y-%m-%d %H:%M:%S', "${column}", 'utc')
  WHERE "${column}" IS NOT NULL AND "${column}" GLOB '${WELL_FORMED}'`;
}

/**
 * Normalise a column whose values are ISO strings that **name their own instant** —
 * `2026-09-03T08:34:04+08:00` (git's `%aI`) or `...T00:34:04.000Z`.
 *
 * This is the opposite situation to the rest of this module. Those stamps are not
 * ambiguous: the offset is right there in the text, so SQLite reads the instant exactly
 * and no timezone assumption is involved. The only problem is that they are a different
 * *shape* from every other timestamp column, which breaks string comparisons against
 * them (`health.ts`, `git.ts`'s daily summary, the 90-day archiver each compared a
 * cutoff that could not line up with them).
 *
 * `strftime(..., 'utc')` honours an embedded offset first and then applies the modifier,
 * so an offset-bearing value comes out as the correct UTC instant. The LIKE guard is
 * therefore load-bearing, not decoration: a *naive* value would be read as localtime and
 * shifted, which is the opposite of what this function is for. The guard also makes it
 * idempotent — a converted value matches neither pattern, so a second run cannot occur.
 */
export function explicitOffsetToUtcSql(table: string, column: string): string {
  return `UPDATE "${table}" SET "${column}" = strftime('%Y-%m-%d %H:%M:%S', "${column}", 'utc')
  WHERE "${column}" IS NOT NULL
    AND ("${column}" LIKE '%+%' OR "${column}" LIKE '%Z' OR "${column}" LIKE '%-__:__')`;
}
