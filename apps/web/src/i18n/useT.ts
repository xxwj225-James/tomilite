/**
 * ⚠️ VENDOR-SPECIFIC — useT() 仅服务于 vendor/pages/*
 * 主应用 UI 翻译统一使用 @/lib/i18n 的 t(key, lang) 或 @/stores/useLang
 */
import { translations } from './translations';
import { useLanguageStore } from '@/stores/languageStore';

export function useT() {
  const lang = useLanguageStore((s) => s.lang);
  return translations[lang] || translations.en;
}

// Non-reactive export for use outside components (e.g., event handlers)
export function getT() {
  try {
    const lang = useLanguageStore.getState().lang;
    return translations[lang] || translations.en;
  } catch {
    return translations.en;
  }
}
