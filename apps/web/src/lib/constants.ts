// ═══ App-level constants — menus, themes, languages ═══
import type { I18NKey } from '@/lib/i18n';

export const MENU = [
  { key: 'tasks' }, { key: 'notes' },
  { key: 'home' }, { key: 'email' }, { key: 'reports' }, { key: 'mcp' }, { key: 'feedback' }, { key: 'settings' }, { key: 'about' },
] as const;

export type MenuKey = (typeof MENU)[number]['key'];

export const MENU_LABEL: Record<MenuKey, I18NKey> = {
  tasks: 'app.menuTasks',
  notes: 'app.menuNotes',
  home: 'app.menuHome',
  email: 'app.menuEmail',
  reports: 'app.menuReports',
  mcp: 'app.menuMcp',
  feedback: 'app.menuFeedback',
  settings: 'app.menuSettings',
  about: 'app.menuAbout',
};

export const THEMES = ['pipeline', 'hub', 'canvas', 'quantum'] as const;
export const THEME_COLORS: Record<string, string> = { pipeline: '#4338CA', hub: '#1877F2', canvas: '#1A73E8', quantum: '#76B900' };
export const LANGS = ['en', 'zh', 'ja'] as const;
export const LANGS_FULL: Record<string, string> = { en: 'English', zh: '中文', ja: '日本語' };

export function applyTheme(key: string) { document.documentElement.setAttribute('data-theme', key); localStorage.setItem('tomilite-theme', key); }
export function getTheme() { return localStorage.getItem('tomilite-theme') || 'pipeline'; }
