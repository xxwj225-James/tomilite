// ═══ Reading database timestamps ═══
//
// A stored stamp is `YYYY-MM-DD HH:MM:SS` with **no zone in the text**, and it is
// **UTC** — see `apps/api/src/lib/dbTime.ts` for the invariant and the migration that
// established it. Parsing one as local, which is what a bare `new Date("...T...")`
// does, reads as "yesterday" for anything done before the UTC offset in the morning:
// at UTC+8, a chat at 00:30 local is stamped 16:30 the previous day. The trailing `Z`
// pins it to the clock it was actually written in.
//
// Two habits this module exists to retire:
//   - `.substring(0, 10)` — correct only while the column was local, and silently
//     wrong by a day for the rows a UTC writer had touched.
//   - `.replace('T', ' ')` — a no-op on a column-shape stamp, so it never did what it
//     looked like it did.

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A stored stamp as epoch ms, or `null` when it is missing or unreadable.
 *
 * A stamp that carries its own zone (`GitCommit.timestamp` is `...T08:34:04+08:00`)
 * already names its instant — appending a `Z` to it would shift it by the offset.
 * Mirrors `parseUtc` in apps/api/src/lib/dbTime.ts.
 */
export function parseDbUtcMs(s: string | null | undefined): number | null {
  if (!s) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const stated = new Date(s).getTime();
    return Number.isNaN(stated) ? null : stated;
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s);
  if (m) return new Date(`${m[1]}T${m[2]}Z`).getTime();
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** A stored stamp as epoch ms, or `NaN` — for callers that bucket by recency. */
export function parseDbUtc(s: string | null | undefined): number {
  return parseDbUtcMs(s) ?? NaN;
}

/**
 * `YYYY-MM-DD` in the **viewer's** zone. This is a date for a human to read, so it has
 * to be the local calendar day, not the UTC one the column happens to hold.
 * Returns `''` for a missing or unreadable stamp rather than "Invalid Date".
 */
export function formatDbDate(s: string | null | undefined): string {
  const ms = parseDbUtcMs(s);
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD HH:MM` in the viewer's zone. */
export function formatDbDateTime(s: string | null | undefined): string {
  const ms = parseDbUtcMs(s);
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * `MM-DD HH:MM` in the **viewer's** zone. The compact lists (the email rows) used to get
 * this shape by slicing the raw text, which prints whatever clock the column holds —
 * and `SmartEmail.date` holds UTC, so every arrival time in the list was 8 hours early
 * at UTC+8. Same shape, right clock.
 */
export function formatDbShort(s: string | null | undefined): string {
  const ms = parseDbUtcMs(s);
  if (ms === null) return '';
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The current time in the shape the database stores, for optimistic updates. Using
 * `toISOString()` directly puts a `T` and a `Z` into local state that every other row
 * lacks, and `.substring(0,10)` on it then renders the UTC day.
 */
export function nowDbUtc(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}
