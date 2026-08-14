import { create } from 'zustand';

interface AppState {
  projectId: string | null;
  focusState: string;
  focusScore: number;
  setProjectId: (id: string) => void;
  setFocus: (state: string, score: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  projectId: null,
  focusState: 'available',
  focusScore: 0,
  setProjectId: (id) => set({ projectId: id }),
  setFocus: (state, score) => set({ focusState: state, focusScore: score }),
}));
