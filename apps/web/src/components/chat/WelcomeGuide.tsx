import { t, type I18NKey } from '@/lib/i18n';
import { RobotFace } from '@/components/RobotFace';
import { LANGS, LANGS_FULL, THEMES, THEME_COLORS } from '@/lib/constants';
import type { Lang } from '@/stores/languageStore';

// ═══ Welcome guide — first-run setup checklist + suggestion chips ═══
export function WelcomeGuide({ lang, setLang, theme, setTheme, llmConfigured, emailConfigured, gitConfigured, apikeyConfigured, standupConfigured, mcpConfigured, onConfigure, onStart, onSkip, onDontShow, onSuggestion }: {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: string;
  setTheme: (t: string) => void;
  llmConfigured: boolean;
  emailConfigured: boolean;
  gitConfigured: boolean;
  apikeyConfigured: boolean;
  standupConfigured: boolean;
  mcpConfigured: boolean;
  onConfigure: (tab: string) => void;
  onStart: () => void;
  onSkip: () => void;
  onDontShow: () => void;
  onSuggestion: (text: string) => void;
}) {
  return (
    <div className="welcome"><div className="welcome-robot"><RobotFace size={36} /></div><div className="welcome-title">{t('app.welcomeTitle', lang)}</div><div className="welcome-desc">{t('app.welcomeDesc', lang)}</div>
      {/* Simplified setup guide */}
      <div style={{ marginTop: 16, maxWidth: 380, textAlign: 'left', margin: '16px auto 0' }}>
        {/* LLM */}
        <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 17 }}>🤖</span>
          <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupLlm', lang)}</span>
          {llmConfigured ? (
            <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
          ) : (
            <button className="btn btn-brand btn-xs" style={{ whiteSpace: 'nowrap' }} onClick={() => onConfigure('llm')}>{t('app.welcomeSetupConfigure', lang)}</button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
          {t('app.welcomeSetupLlmDesc', lang)}
        </div>
        {!llmConfigured && (
          <div style={{ fontSize: 10, color: 'var(--amber)', margin: '-6px 8px 10px', lineHeight: 1.5, fontWeight: 500 }}>
            {t('app.welcomeSetupLlmPriority', lang)}
          </div>
        )}
        {/* Email */}
        <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 17 }}>📧</span>
          <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupEmail', lang)}</span>
          {emailConfigured ? (
            <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
          ) : (
            <button className="btn btn-xs" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--edge)', whiteSpace: 'nowrap', fontSize: 10 }} onClick={() => onConfigure('email')}>{t('app.welcomeSetupConfigure', lang)}</button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
          {t('app.welcomeSetupEmailDesc', lang)}
        </div>
        {/* Git */}
        <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 17 }}>📂</span>
          <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupGit', lang)}</span>
          {gitConfigured ? (
            <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
          ) : (
            <button className="btn btn-xs" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--edge)', whiteSpace: 'nowrap', fontSize: 10 }} onClick={() => onConfigure('git')}>{t('app.welcomeSetupConfigure', lang)}</button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
          {t('app.welcomeSetupGitDesc', lang)}
        </div>
        {/* API Keys */}
        <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 17 }}>🔑</span>
          <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupApikey', lang)}</span>
          {apikeyConfigured ? (
            <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
          ) : (
            <button className="btn btn-xs" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--edge)', whiteSpace: 'nowrap', fontSize: 10 }} onClick={() => onConfigure('apikey')}>{t('app.welcomeSetupConfigure', lang)}</button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
          {t('app.welcomeSetupApikeyDesc', lang)}
        </div>
        {/* Standup */}
        <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 17 }}>📅</span>
          <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupStandup', lang)}</span>
          {standupConfigured ? (
            <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
          ) : (
            <button className="btn btn-xs" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--edge)', whiteSpace: 'nowrap', fontSize: 10 }} onClick={() => onConfigure('standup')}>{t('app.welcomeSetupConfigure', lang)}</button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
          {t('app.welcomeSetupStandupDesc', lang)}
        </div>
        {/* MCP Servers */}
        <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 17 }}>🔌</span>
          <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupMcp', lang)}</span>
          {mcpConfigured ? (
            <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
          ) : (
            <button className="btn btn-xs" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--edge)', whiteSpace: 'nowrap', fontSize: 10 }} onClick={() => onConfigure('mcpServers')}>{t('app.welcomeSetupConfigure', lang)}</button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
          {t('app.welcomeSetupMcpDesc', lang)}
        </div>
        {/* Language + Theme row */}
        <div style={{ padding: '8px 12px', marginBottom: 8, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 17 }}>🌐</span>
          <select className="form-select" style={{ fontSize: 11, padding: '3px 6px', flex: 1 }} value={lang} onChange={e => { const newLang = e.target.value; setLang(newLang as Lang); fetch('/api/system.saveLanguage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: newLang }) }).catch(() => {}); }}>
            {LANGS.map(l => <option key={l} value={l}>{LANGS_FULL[l]}</option>)}
          </select>
          <span style={{ fontSize: 17 }}>🎨</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {THEMES.map(th => (
              <button key={th} onClick={() => setTheme(th)} title={th}
                style={{ width: 18, height: 18, borderRadius: 4, background: THEME_COLORS[th], border: theme === th ? '2px solid var(--ink)' : '1px solid var(--edge)', cursor: 'pointer' }} />
            ))}
          </div>
        </div>
        {/* Congratulations or Start button */}
        {llmConfigured && emailConfigured && gitConfigured && apikeyConfigured && standupConfigured && mcpConfigured ? (
          <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
            <div style={{ fontSize: 15, marginBottom: 2 }}>🎉</div>
            <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, marginBottom: 8 }}>
              {t('app.welcomeSetupDone', lang)}
            </div>
            <button className="btn btn-brand btn-sm" onClick={onStart}>
              {t('app.welcomeStart', lang)}
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <button className="btn btn-brand btn-sm" onClick={onSkip}>
              {t('app.welcomeSkip', lang)}
            </button>
            <div style={{ marginTop: 6 }}>
              <button className="btn-ghost btn-xs" style={{ color: 'var(--muted)', fontSize: 10 }} onClick={onDontShow}>
                {t('app.welcomeDontShow', lang)}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="suggestions" style={{ marginTop: 10 }}>{['app.sugg1','app.sugg2','app.sugg3','app.sugg4','app.sugg5'].map(k => (<span key={k} className="suggestion-chip" onClick={() => onSuggestion(t(k as I18NKey, lang))}>{t(k as I18NKey, lang)}</span>))}</div></div>
  );
}
