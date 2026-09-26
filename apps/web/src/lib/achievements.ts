// ═══ Achievements — the milestone ladders and the one decision that fires them ═══
//
// Pure, and deliberately import-free. Nothing here reads storage, calls an API or
// formats a string: the caller passes the previous ledger and the number it just
// observed, and gets back whether that crossed a rung. The import-free part is
// not a style preference — it is what lets `node --experimental-strip-types` load
// this file on its own to drive the decision with hand-fed values, which is the
// only way to test the parts of the ladder the current corpus cannot reach (see
// docs §Verification). For the same reason the i18n keys live in the component:
// this module has no business knowing about `I18NKey`.

export type Family = 'tasks' | 'notes' | 'health';

/** Highest rung index reached per family, as last persisted. A key's *presence*
 *  means "we have observed this family"; see `decide` for why that distinction is
 *  the whole design. */
export type Seen = Partial<Record<Family, number>>;

export interface Milestone {
  family: Family;
  /** Index into that family's ladder. */
  rung: number;
  /** What the copy interpolates: the rung that was crossed, not the value seen. */
  value: number | string;
}

export interface Decision {
  milestone: Milestone | null;
  /** Same object identity as the input when nothing moved, so the caller can skip
   *  writing to storage on the overwhelming majority of calls. */
  next: Seen;
  /** True only on the very first observation of this family — the value was
   *  adopted as a baseline, not earned. */
  seeded: boolean;
}

/** How long a celebration is on screen. The stylesheet derives every internal
 *  timing from this by `calc()`, so this is the only place the number exists. */
export const CELEBRATION_MS = 1800;

/**
 * Ascending rungs. Below the first one is -1, which is a real, storable state —
 * "we have looked, and there is nothing to celebrate yet" — and therefore not the
 * same thing as absent.
 *
 * `tasks` counts finished tasks (`taskStats.done`); `notes` counts the whole
 * library (`map.notes`). Both are monotone-ish counts. `completionRate` was
 * rejected because it is a ratio and therefore *falls* when a task is added, so
 * ordinary board churn would walk it up and down and burn every rung in a
 * session; `recentlyDone` was rejected because it decays as tasks age past seven
 * days, which makes it a sawtooth.
 */
const TASK_RUNGS = [1, 10, 25, 50, 100, 250];
const NOTE_RUNGS = [10, 25, 50, 100, 250, 500];

const LADDERS: Record<Family, readonly number[]> = {
  tasks: TASK_RUNGS,
  notes: NOTE_RUNGS,
  // A rank ladder of one: the health *level* is a machine code from the API, not
  // a count, and 0 is the only rung there is. The level names stay in
  // `routers/health.ts` and the copy is the only place that names them for the
  // user, so a threshold change cannot leak into the UI as a renamed number.
  health: [0],
};

function rungOfCount(rungs: readonly number[], n: number): number {
  if (!Number.isFinite(n)) return -1;
  let idx = -1;
  for (let i = 0; i < rungs.length; i++) if (n >= rungs[i]) idx = i;
  return idx;
}

/** Which rung a raw observation sits on. Exported for the test driver. */
export function rungIndex(family: Family, value: number | string): number {
  if (family === 'health') return value === 'excellent' ? 0 : -1;
  return rungOfCount(LADDERS[family], typeof value === 'number' ? value : Number.NaN);
}

/**
 * The rule, stated once because everything else follows from it:
 *
 *   **absent means "adopt the present"; present means "we have already accounted
 *   for this".**
 *
 * So a user who already has 39 notes when this feature ships stores `{ notes: 1 }`
 * on the first observation and sees nothing — their 719th launch behaves the same
 * way. There is no retroactive celebration and no "first run" flag to keep, because
 * the absence of the key *is* the first run.
 *
 * The ledger holds the **highest rung reached**, never the last observed value.
 * That is what makes a drop-then-re-cross silent: `done` going 65 → 12 → 60 finds
 * the ledger already sitting on the rung for 50 and says nothing. Storing the last
 * value instead would replay the celebration, and it is the tempting design.
 */
export function decide(seen: Seen, family: Family, value: number | string): Decision {
  const rung = rungIndex(family, value);
  const prev = seen[family];
  // `prev !== undefined` rather than a truthiness test, and not `seen[family]!`
  // either — `no-non-null-assertion` is an error in this repo, and this happens to
  // be the correct presence test anyway: -1 is a legitimate stored value.
  if (prev === undefined) {
    const seeded: Seen = { ...seen };
    seeded[family] = rung;
    return { milestone: null, next: seeded, seeded: true };
  }
  if (rung <= prev) return { milestone: null, next: seen, seeded: false };
  // One milestone even for a jump of several rungs: `rung` is already the highest
  // one crossed. The reported `value` is the rung, not the observation, so a
  // message that waited its turn in the queue cannot contradict the number it was
  // derived from — "50 notes" stays true after the library has moved to 53.
  const reached: Seen = { ...seen };
  reached[family] = rung;
  return {
    milestone: { family, rung, value: family === 'health' ? value : (LADDERS[family][rung] ?? value) },
    next: reached,
    seeded: false,
  };
}
