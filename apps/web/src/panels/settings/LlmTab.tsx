import { useEffect, useState, type CSSProperties } from 'react';
import { LlmForm } from '@/components/settings/LlmForm';
import { HostedPanel, type HostedStatus } from '@/components/settings/HostedPanel';
import { api } from '@/lib/api';
import { useLang } from '@/stores/useLang';
import { t } from '@/lib/i18n';

const EMPTY: HostedStatus = { active: false, loggedIn: false, email: '', enabled: false };

export function LlmTab() {
  const lang = useLang();
  const [status, setStatus] = useState<HostedStatus>(EMPTY);
  const [view, setView] = useState<'byok' | 'hosted' | null>(null); // null = still loading session

  const refresh = async () => {
    const s: HostedStatus = await api.hosted.status().catch(() => EMPTY);
    setStatus(s);
    // Chat send-gating / setup checks listen on this event to re-evaluate "configured".
    window.dispatchEvent(new CustomEvent('tl-llm-config-changed'));
    return s;
  };

  useEffect(() => {
    (async () => {
      const s: HostedStatus = await api.hosted.status().catch(() => EMPTY);
      setStatus(s);
      setView(s.active ? 'hosted' : 'byok');
    })();
  }, []);

  const useHosted = async () => {
    await api.hosted.enable().catch(() => {});
    setView('hosted');
    refresh();
  };

  const segStyle = (selected: boolean): CSSProperties => ({
    padding: '4px 14px',
    fontSize: 12,
    border: 'none',
    background: selected ? 'var(--brand)' : 'transparent',
    color: selected ? 'var(--on-accent)' : 'var(--ink)',
    cursor: 'pointer',
  });

  return (
    <div className="card">
      <div className="card-hd">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2l1.8 5.5 5.7.7-4.3 3.8 1.3 5.5-4.5-3.3-4.5 3.3 1.3-5.5-4.3-3.8 5.7-.7z" />
            <path d="M19 1l.5 1.5L21 3l-1.5.5L19 5l-.5-1.5L17 3l1.5-.5z" />
          </svg>{' '}
          LLM
        </span>
      </div>
      <div className="card-bd">
        <div
          style={{
            display: 'inline-flex',
            border: '1px solid var(--edge)',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 12,
          }}
        >
          <button className="seg" style={segStyle(view === 'byok')} onClick={() => setView('byok')}>
            {t('hosted.segmentByok', lang)}
          </button>
          <button
            className="seg"
            style={{ ...segStyle(view === 'hosted'), borderLeft: '1px solid var(--edge)' }}
            onClick={() => setView('hosted')}
          >
            {t('hosted.segmentHosted', lang)}
          </button>
        </div>

        {view === null && <p className="text-xs text-ink-muted">…</p>}

        {view === 'byok' && (
          <>
            {status.loggedIn && (
              <p
                className="text-xs"
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  background: 'var(--surface2)',
                  border: '1px solid var(--edge)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  marginBottom: 10,
                }}
              >
                <span style={{ color: 'var(--muted)', flex: 1 }}>
                  {t('hosted.signedInBanner', lang, { email: status.email })}
                </span>
                <button className="btn btn-xs btn-brand" onClick={useHosted}>
                  {t('hosted.useHosted', lang)}
                </button>
              </p>
            )}
            <LlmForm standalone />
          </>
        )}

        {view === 'hosted' && (
          <HostedPanel status={status} onChanged={refresh} onSwitchToByok={() => setView('byok')} />
        )}
      </div>
    </div>
  );
}
