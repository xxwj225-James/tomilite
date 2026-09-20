import { create } from 'zustand';
import { applyMode, applyTheme, getMode, getTheme, type Mode } from '@/lib/constants';

// Theme and light/dark used to be two `useState`s in App.tsx, which was fine
// while App was the only component rendering a control for them. It stopped
// being true: the welcome guide picks a theme too, and the controls themselves
// now live in Settings → Appearance, several levels down inside ContentPanel.
// Threading two values and two setters through that tree would add four more
// props to a component that already takes seventeen, so the pair lives here.
//
// `applyTheme` / `applyMode` are called from the setters rather than from an
// effect, because every write is a user action — there is no state to sync.
// Nothing applies on mount either: `public/theme-init.js` writes both
// attributes synchronously in <head>, before React renders.
interface ThemeState {
  theme: string;
  mode: Mode;
  setTheme: (theme: string) => void;
  setMode: (mode: Mode) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: getTheme(),
  mode: getMode(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setMode: (mode) => {
    applyMode(mode);
    set({ mode });
  },
}));
