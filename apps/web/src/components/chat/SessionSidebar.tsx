import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import type { Lang } from '@/stores/languageStore';

type SessionRow = { id: string; title: string; tokenPercent: number; updatedAt?: string };

// `updatedAt` is a SQLite-style stamp ("YYYY-MM-DD HH:MM:SS") carrying **no zone**,
// and it is UTC: chat.ts writes it with toISOString() in both addMessage and
// renameSession, and chatDistill.ts documents the same convention. Parsing it as
// local — which is what a bare `new Date("...T...")` does — reads as "yesterday"
// for anything done before the UTC offset in the morning: at UTC+8, a chat at
// 00:30 local is stamped 16:30 the previous day. The `Z` pins it to the clock it
// was actually written in.
//
// The one exception is a session created and never used: createSession omits the
// field, so it takes the column default `datetime('now','localtime')`. Such a row
// is read here as offset-hours in the future, which still lands in 今天 — the
// bucket it belongs in. Making the two writers agree would mean touching the
// distillation idle check that depends on the UTC stamp, so it stays as is.
const parseStamp = (s: string) => new Date(s.replace(' ', 'T') + 'Z').getTime();

// Recency is the only thing that tells one session from the next once the titles
// are generated, so it is spelled out rather than left implicit in the order.
function groupByDay(sessions: SessionRow[], lang: Lang) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const startOfYesterdayMs = startOfTodayMs - 86_400_000;
  const buckets = [
    { key: 'today', label: t('sidebar.today', lang), items: [] as SessionRow[] },
    { key: 'yesterday', label: t('sidebar.yesterday', lang), items: [] as SessionRow[] },
    { key: 'earlier', label: t('sidebar.earlier', lang), items: [] as SessionRow[] },
  ];
  for (const s of sessions) {
    const ms = s.updatedAt ? parseStamp(s.updatedAt) : NaN;
    // An unparseable or missing stamp falls to the oldest bucket rather than
    // inventing a position for it.
    const idx = Number.isNaN(ms) ? 2 : ms >= startOfTodayMs ? 0 : ms >= startOfYesterdayMs ? 1 : 2;
    buckets[idx].items.push(s);
  }
  return buckets.filter((b) => b.items.length > 0);
}

// ═══ Session sidebar — new chat, session list with rename/delete, token meter ═══
export function SessionSidebar({
  sessions,
  currentSessionId,
  editingSessionId,
  editTitle,
  displayTokens,
  maxTokens,
  debugForceShow,
  onNew,
  onSwitch,
  onRenameStart,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onDelete,
  onCompress,
}: {
  sessions: SessionRow[];
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
  const groups = groupByDay(sessions, lang);

  // "Earlier" is the one group that grows without bound, so it starts folded —
  // today and yesterday are what you actually come back to. It unfolds itself
  // when the conversation you are in lives down there, because a folded group
  // would otherwise leave the sidebar with no active row and no way to tell
  // where you are; the ref keeps that from overriding a later manual fold.
  const [earlierOpen, setEarlierOpen] = useState(false);
  const autoOpenedFor = useRef('');
  useEffect(() => {
    if (currentSessionId === autoOpenedFor.current) return;
    autoOpenedFor.current = currentSessionId;
    const earlierIds = groups.find((g) => g.key === 'earlier')?.items.map((s) => s.id) ?? [];
    if (earlierIds.includes(currentSessionId)) setEarlierOpen(true);
  }, [currentSessionId, groups]);

  return (
    <div className="session-sidebar">
      <div className="session-sidebar-hd">
        <button className="session-new-btn" onClick={onNew}>
          {t('menu.newChat', lang)}
        </button>
      </div>
      <div className="session-list">
        {groups.map((g) => (
          <div key={g.key}>
            {g.key === 'earlier' ? (
              // The count rides the header so the fold still says how much is
              // behind it; without it the collapsed row is a bare label.
              <button
                type="button"
                className={cn('session-group-hd', 'session-group-hd--toggle')}
                aria-expanded={earlierOpen}
                onClick={() => setEarlierOpen((o) => !o)}
              >
                <span>{g.label}</span>
                <span className="session-group-count">{g.items.length}</span>
                <svg
                  className="session-group-chevron"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            ) : (
              <div className="session-group-hd">{g.label}</div>
            )}
            {(g.key !== 'earlier' || earlierOpen) &&
              g.items.map((s) => (
                <div
                  key={s.id}
                  className={cn('session-item', currentSessionId === s.id && 'session-item--active')}
                  onClick={() => onSwitch(s.id)}
                  onDoubleClick={() => onRenameStart(s)}
                >
                  {editingSessionId === s.id ? (
                    <input
                      className="form-input"
                      value={editTitle}
                      onChange={(e) => onRenameChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onRenameCommit();
                        if (e.key === 'Escape') onRenameCancel();
                      }}
                      onBlur={onRenameCommit}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: 'var(--text-xs)', padding: '2px 6px', flex: 1 }}
                    />
                  ) : (
                    <span className="session-item-title">{s.title}</span>
                  )}
                  <button
                    className="session-item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(s.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>
        ))}
      </div>
      {(() => {
        if (!debugForceShow && pct < 50) return null;
        const isWarn = pct >= 80;
        const warnColor = isWarn ? 'var(--amber)' : 'var(--muted)';
        const hoverText = isWarn ? t('chat.contextRemaining', lang, { pct: 100 - pct }) : '';
        return (
          <div
            style={{
              padding: '6px 12px',
              borderTop: '1px solid var(--edge)',
              flexShrink: 0,
              cursor: isWarn ? 'pointer' : 'default',
            }}
            onClick={isWarn ? onCompress : undefined}
            title={hoverText}
          >
            <div
              style={{ height: 3, borderRadius: 2, background: 'var(--surface2)', overflow: 'hidden', marginBottom: 4 }}
            >
              <div
                style={{
                  height: '100%',
                  width: pct + '%',
                  background: warnColor,
                  borderRadius: 2,
                  transition: 'width var(--dur-3) var(--ease-out)',
                }}
              />
            </div>
            <div
              style={{ fontSize: 'var(--text-xs)', color: warnColor, display: 'flex', justifyContent: 'space-between' }}
            >
              <span>
                {displayTokens >= 1000 ? Math.round(displayTokens / 1000) + 'k' : displayTokens} /{' '}
                {maxTokens >= 1000 ? Math.round(maxTokens / 1000) + 'k' : maxTokens} {t('chat.tokens', lang)}
              </span>
              <span>{pct}%</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
