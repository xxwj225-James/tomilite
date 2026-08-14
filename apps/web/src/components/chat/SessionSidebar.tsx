import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';

// ═══ Session sidebar — new chat, session list with rename/delete, token meter ═══
export function SessionSidebar({ sessions, currentSessionId, editingSessionId, editTitle, displayTokens, maxTokens, debugForceShow, onNew, onSwitch, onRenameStart, onRenameChange, onRenameCommit, onRenameCancel, onDelete, onCompress }: {
  sessions: Array<{ id: string; title: string; tokenPercent: number }>;
  currentSessionId: string;
  editingSessionId: string | null;
  editTitle: string;
  displayTokens: number;
  maxTokens: number;
  debugForceShow: boolean;
  onNew: () => void;
  onSwitch: (sid: string) => void;
  onRenameStart: (s: { id: string; title: string }) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onDelete: (sid: string) => void;
  onCompress: () => void;
}) {
  const lang = useLang();
  const pct = Math.min(100, Math.round((displayTokens / Math.max(maxTokens, 1)) * 100));

  return (
    <div className="session-sidebar">
      <div className="session-sidebar-hd">
        <button className="session-new-btn" onClick={onNew}>{t('menu.newChat', lang)}</button>
      </div>
      <div className="session-list">
        {sessions.map(s => (
          <div key={s.id} className={cn('session-item', currentSessionId === s.id && 'session-item--active')} onClick={() => onSwitch(s.id)} onDoubleClick={() => onRenameStart(s)}>
            {editingSessionId === s.id ? (
              <input className="form-input" value={editTitle} onChange={e => onRenameChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel(); }}
                onBlur={onRenameCommit} autoFocus onClick={e => e.stopPropagation()}
                style={{ fontSize: 11, padding: '2px 6px', flex: 1 }} />
            ) : (
              <span className="session-item-title">{s.title}</span>
            )}
            <button className="session-item-delete" onClick={e => { e.stopPropagation(); onDelete(s.id); }}>×</button>
          </div>
        ))}
      </div>
      {(() => {
        if (!debugForceShow && pct < 50) return null;
        const isWarn = pct >= 80;
        const warnColor = isWarn ? 'var(--amber)' : 'var(--muted)';
        const hoverText = isWarn ? t('chat.contextRemaining', lang, { pct: 100 - pct }) : '';
        return (
          <div style={{ padding: '6px 12px', borderTop: '1px solid var(--edge)', flexShrink: 0, cursor: isWarn ? 'pointer' : 'default' }} onClick={isWarn ? onCompress : undefined} title={hoverText}>
            <div style={{ height: 3, borderRadius: 2, background: 'var(--surface2)', overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ height: '100%', width: pct + '%', background: warnColor, borderRadius: 2, transition: 'width .3s' }} />
            </div>
            <div style={{ fontSize: 9, color: warnColor, display: 'flex', justifyContent: 'space-between' }}>
              <span>{displayTokens >= 1000 ? Math.round(displayTokens / 1000) + 'k' : displayTokens} / {maxTokens >= 1000 ? Math.round(maxTokens / 1000) + 'k' : maxTokens} {t('chat.tokens', lang)}</span>
              <span>{pct}%</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
