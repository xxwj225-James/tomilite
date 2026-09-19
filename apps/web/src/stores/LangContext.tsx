import { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { useLanguageStore, type Lang } from './languageStore';

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const LangContext = createContext<LangContextValue>({ lang: 'en', setLang: () => {} });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('tomilite-lang');
      if (saved === 'en' || saved === 'zh' || saved === 'ja') return saved;
    } catch {}
    if (typeof navigator !== 'undefined') {
      if (navigator.language?.startsWith('zh')) return 'zh';
      if (navigator.language?.startsWith('ja')) return 'ja';
    }
    return 'en';
  });

  const setLangStable = useCallback((l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem('tomilite-lang', l);
    } catch {}
    // Sync to zustand for vendor pages (useT) and non-React code
    useLanguageStore.getState().setLang(l);
  }, []);

  // Keep zustand store in sync on initial mount
  useEffect(() => {
    useLanguageStore.getState().setLang(lang);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => ({ lang, setLang: setLangStable }), [lang, setLangStable]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

// The provider and its two consumer hooks live together because they close over
// the same context object; splitting them into separate files would only move
// the seam, and react-refresh's constraint is a dev-server nicety rather than a
// correctness one. Both exports are flagged for that reason.
// eslint-disable-next-line react-refresh/only-export-components
export function useLang(): Lang {
  return useContext(LangContext).lang;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSetLang() {
  return useContext(LangContext).setLang;
}
