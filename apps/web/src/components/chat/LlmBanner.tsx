import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';

// ═══ Soft-gate banner — LLM API key missing ═══
export function LlmBanner({ onConfigure, onDismiss }: {
  onConfigure: () => void;
  onDismiss: () => void;
}) {
  const lang = useLang();
  return (
    <div style={{ padding: '10px 14px', background: 'color-mix(in srgb, var(--amber) 10%, var(--surface2))', borderBottom: '1px solid var(--amber)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 600, flex: 1 }}>
        ⚠️ {t('misc.llmNotConfigured', lang)}
      </span>
      <button className="btn btn-brand btn-xs" onClick={onConfigure}>
        {t('misc.goConfigure', lang)}
      </button>
      <button className="btn-ghost btn-xs" onClick={onDismiss} style={{ color: 'var(--muted)', fontSize: 18, padding: '0 4px' }}>×</button>
    </div>
  );
}
