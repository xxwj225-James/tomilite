import { create } from 'zustand';
import { decide, type Family, type Milestone, type Seen } from '@/lib/achievements';

// ═══ Celebration store — the ledger, the switch, and the queue ═══
//
// A store rather than a hook because the two places that observe the numbers are not
// components: `HomePanel.fetchTaskStats` and `KnowledgeCard.load()` are plain async
// functions called from effects, so they cannot call a hook. They push; this records and
// queues; `components/Celebration.tsx` paints. Nothing else reads the numbers, so nothing
// else has to know they are being watched.
//
// The decision itself lives in `lib/achievements.ts` and is pure. This file owns only the
// two things that make it stateful: where the ledger is kept, and what happens when two
// milestones arrive at once.

/** The once-ever ledger. `tl-` for one-shot client state, matching `tl-morning-date` and
 *  `tl-welcome-dismissed`; the setting below uses `tomilite-`, which is this app's prefix
 *  for a device-local preference. */
const LEDGER_KEY = 'tl-celebrated';
const SETTING_KEY = 'tomilite-celebrations';

/**
 * Absent means on — the same shape as `getMode()` in lib/constants, so a fresh install and
 * a user who turned it on are the same state.
 */
function getCelebrationsEnabled(): boolean {
  return localStorage.getItem(SETTING_KEY) !== 'off';
}

/**
 * Guarded because this runs in the store's initializer, i.e. at import time, before React
 * has rendered anything. An unguarded `JSON.parse` on a corrupted value would be a white
 * screen rather than a failed request — there is no `.catch` above it to swallow the throw.
 */
function readLedger(): Seen {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    return raw ? (JSON.parse(raw) as Seen) : {};
  } catch {
    return {};
  }
}

/** Monotonic. It is the identity of a celebration: a replacement is a new component
 *  instance, so its animations start from zero instead of continuing the one it replaced. */
let seq = 0;

type Item = Milestone & { seq: number };

interface CelebrationState {
  enabled: boolean;
  /** On screen now. */
  current: Item | null;
  /** At most one waiting. A newer arrival supersedes it — see `observe`. */
  pending: Item | null;
  setEnabled: (on: boolean) => void;
  observe: (family: Family, value: number | string) => void;
  /** Called by the overlay when its time is up. */
  advance: () => void;
}

export const useCelebrationStore = create<CelebrationState>((set, get) => ({
  // Read synchronously at import, so the first render already has the right answer and
  // there is no frame where a switched-off feature fires. The alternative — the
  // `SystemConfig` pattern used by the meeting defaults — is a fetch, and a value that
  // arrives late can only be handled by suppressing celebrations for a moment, which
  // would silently drop real ones.
  enabled: getCelebrationsEnabled(),
  current: null,
  pending: null,

  setEnabled: (on) => {
    localStorage.setItem(SETTING_KEY, on ? 'on' : 'off');
    set({ enabled: on });
  },

  observe: (family, value) => {
    const seen = readLedger();
    const { milestone, next } = decide(seen, family, value);
    // Identity, not deep equality: `decide` hands back the object it was given when nothing
    // moved, which is the overwhelming majority of calls — Home re-reads `taskStats` on
    // every activation and `map` on every visit.
    if (next !== seen) localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
    if (!milestone) return;
    // The ledger advanced either way, and that is deliberate: with celebrations switched
    // off the rungs are still consumed, so turning the setting back on never replays a
    // backlog of things that happened while it was off.
    if (!get().enabled) return;
    const item: Item = { ...milestone, seq: ++seq };
    // One on screen, one waiting. Dropping the second instead would make an achievement
    // invisible, and this codebase has already decided what invisible means — the tree
    // surfaces new notes for exactly this reason. A real queue is worse than it looks: the
    // second message would appear seconds after the number it describes left the screen.
    if (get().current) set({ pending: item });
    else set({ current: item });
  },

  advance: () => set((s) => ({ current: s.pending, pending: null })),
}));
