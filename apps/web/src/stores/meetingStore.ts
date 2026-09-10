import { create } from 'zustand';

// ═══ Global recording state ═══
//
// Lives outside the Meeting panel on purpose. A recording that keeps running
// while the user is looking at Tasks, with no indicator anywhere on screen, is
// indistinguishable from spyware — so the shell renders a banner off this store
// and the panel is only one of its readers.
//
// Elapsed time is stored as a start timestamp rather than a counter: the
// recorder pauses by suspending its AudioContext, so wall-clock drift would
// make the banner disagree with the panel.
interface MeetingRecordingState {
  meetingId: string | null;
  title: string;
  /** Epoch ms when the current unpaused stretch began; null while paused. */
  runningSince: number | null;
  /** Seconds already banked before the current stretch. */
  bankedSec: number;
  paused: boolean;
  start: (meetingId: string, title: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

export const useMeetingStore = create<MeetingRecordingState>((set, get) => ({
  meetingId: null,
  title: '',
  runningSince: null,
  bankedSec: 0,
  paused: false,

  start: (meetingId, title) => set({ meetingId, title, runningSince: Date.now(), bankedSec: 0, paused: false }),

  pause: () => {
    const s = get();
    if (!s.meetingId || s.paused) return;
    const banked = s.bankedSec + (s.runningSince ? (Date.now() - s.runningSince) / 1000 : 0);
    set({ bankedSec: banked, runningSince: null, paused: true });
  },

  resume: () => {
    if (!get().meetingId) return;
    set({ runningSince: Date.now(), paused: false });
  },

  stop: () => set({ meetingId: null, title: '', runningSince: null, bankedSec: 0, paused: false }),
}));

/** Seconds recorded so far, correct whether or not the timer is paused. */
export function meetingElapsedSec(s: Pick<MeetingRecordingState, 'runningSince' | 'bankedSec'>): number {
  return Math.max(0, s.bankedSec + (s.runningSince ? (Date.now() - s.runningSince) / 1000 : 0));
}
