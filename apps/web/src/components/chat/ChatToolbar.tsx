import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { LANGS, LANGS_FULL, THEMES, THEME_COLORS } from '@/lib/constants';

// ═══ Chat toolbar — language dropdown + theme dots + compress/clear ═══
export function ChatToolbar({ lang, setLang, langMenuOpen, setLangMenuOpen, theme, setTheme, messagesCount, compressing, onCompress, onClear }: {
  lang: string;
  setLang: (l: string) => void;
  langMenuOpen: boolean;
  setLangMenuOpen: (v: boolean) => void;
  theme: string;
  setTheme: (t: string) => void;
  messagesCount: number;
  compressing: boolean;
  onCompress: () => void;
  onClear: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px 2px', flexShrink: 0, minHeight: 28 }}>
      {/* Left: language + theme */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setLangMenuOpen(!langMenuOpen)} className="lang-btn lang-btn--active" style={{ padding: '2px 8px', fontSize: 10, gap: 3 }}>{LANGS_FULL[lang]} ▼</button>
          {langMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 8, padding: 4, minWidth: 130, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              {LANGS.map(l => (
                <button key={l} onClick={() => { setLang(l); setLangMenuOpen(false); fetch('/api/system.saveLanguage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: l }) }).catch(() => {}); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 10px', fontSize: 11, border: 'none', borderRadius: 4, background: lang === l ? 'var(--surface2)' : 'transparent', color: lang === l ? 'var(--brand)' : 'var(--ink)', cursor: 'pointer', fontWeight: lang === l ? 600 : 400, fontFamily: 'inherit' }}>
                  {LANGS_FULL[l]}
                </button>
              ))}
            </div>
          )}
        </div>
        <span style={{ width: 1, height: 14, background: 'var(--edge)', margin: '0 2px' }} />
        <div className="theme-dots" style={{ display: 'flex', gap: 3 }}>
          {THEMES.map(th => (<button key={th} onClick={() => setTheme(th)} title={th} className={cn('theme-dot', theme === th && 'theme-dot--active')} style={{ background: THEME_COLORS[th] }} />))}
        </div>
      </div>
      {/* Right: compress + clear */}
      {messagesCount > 0 && (
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onCompress} disabled={compressing} className="btn-ghost btn-xs" title={t('chat.compressTooltip', lang)} style={{ fontSize: 10, color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            {compressing ? t('chat.compressing', lang) : t('chat.compress', lang)}
          </button>
          <button onClick={onClear} className="btn-ghost btn-xs" title={t('chat.clearTooltip', lang)} style={{ fontSize: 10, color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            {t('chat.clear', lang)}
          </button>
        </div>
      )}
    </div>
  );
}
