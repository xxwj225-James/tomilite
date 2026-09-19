// ═══ App-level constants — menus, themes, languages ═══
import type { I18NKey } from '@/lib/i18n';

export const MENU = [
  { key: 'tasks' },
  { key: 'notes' },
  { key: 'home' },
  { key: 'email' },
  { key: 'reports' },
  { key: 'meeting' },
  { key: 'mcp' },
  { key: 'feedback' },
  { key: 'settings' },
  { key: 'about' },
] as const;

export type MenuKey = (typeof MENU)[number]['key'];

export const MENU_LABEL: Record<MenuKey, I18NKey> = {
  tasks: 'app.menuTasks',
  notes: 'app.menuNotes',
  home: 'app.menuHome',
  email: 'app.menuEmail',
  reports: 'app.menuReports',
  meeting: 'app.menuMeeting',
  mcp: 'app.menuMcp',
  feedback: 'app.menuFeedback',
  settings: 'app.menuSettings',
  about: 'app.menuAbout',
};

export const THEMES = ['pipeline', 'hub', 'canvas', 'quantum'] as const;
// The theme swatches. This is the table of theme *values*, not a place to read
// one: `var(--brand)` resolves to whichever theme is currently active, so it
// would paint all four dots the same colour.
//
// The literals are the point of this table, so the colour rule is off across it.
// It used to carry an `eslint-disable-next-line` on the `export` line, but the
// hexes are two lines further down — the directive suppressed nothing and was
// itself reported as unused.
/* eslint-disable no-restricted-syntax */
export const THEME_COLORS: Record<string, string> = {
  pipeline: '#4338CA',
  hub: '#1466D6',
  canvas: '#1968D4',
  quantum: '#76B900',
};
/* eslint-enable no-restricted-syntax */
export const LANGS = ['en', 'zh', 'ja'] as const;
export const LANGS_FULL: Record<string, string> = { en: 'English', zh: '中文', ja: '日本語' };

// Setting `data-theme` / `data-mode` on <html> invalidates every custom
// property in the document at once. Chromium resolves that incrementally over
// several frames, and it can commit a composited frame in between — which
// leaves parts of the tree painted with the previous values until something
// forces a full, synchronous recalc. In practice that is the bottom nav, the
// last element after a long message list, and the workaround users find is to
// resize the window. Reading a layout property here forces that same full
// recalculation inside this task, before the swap can be composited, so no
// half-restyled frame ever reaches the screen. One forced reflow per
// user-triggered switch costs nothing.
function flushStyle() {
  void document.documentElement.offsetHeight;
}

export function applyTheme(key: string) {
  document.documentElement.setAttribute('data-theme', key);
  flushStyle();
  localStorage.setItem('tomilite-theme', key);
}
export function getTheme() {
  return localStorage.getItem('tomilite-theme') || 'pipeline';
}

// Light/dark is a separate axis from the four themes: any theme can be shown
// in either mode, so it lives in its own attribute (`data-mode`) and its own
// storage key. Default 'light' — existing users keep the look they have today.
export const MODES = ['light', 'dark'] as const;
export type Mode = (typeof MODES)[number];

export function applyMode(mode: string) {
  document.documentElement.setAttribute('data-mode', mode);
  flushStyle();
  localStorage.setItem('tomilite-mode', mode);
}
export function getMode(): Mode {
  return localStorage.getItem('tomilite-mode') === 'dark' ? 'dark' : 'light';
}
