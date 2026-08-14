import { create } from 'zustand';

export type Lang = 'en' | 'zh' | 'ja';

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem('tomilite-lang');
    if (stored === 'en' || stored === 'zh' || stored === 'ja') return stored as Lang;
  } catch {}
  if (typeof navigator !== 'undefined') {
    if (navigator.language?.startsWith('zh')) return 'zh';
    if (navigator.language?.startsWith('ja')) return 'ja';
  }
  return 'en';
}

interface LanguageState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  lang: detectLang(),
  setLang: (l) => {
    try { localStorage.setItem('tomilite-lang', l); } catch {}
    set({ lang: l });
  },
}));
