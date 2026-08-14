import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import { ICONS } from '@/components/icons';
import { MENU, MENU_LABEL } from '@/lib/constants';

// ═══ Always-visible navigation toolbar — menu buttons + morning/evening notification bubbles ═══
export function MenuNav({ panel, notifyCount, mcpPending, updateAvailable, updateSeen, thinking, morningNotify, eveningNotify, notifyLoading, onNav, onMorning, onEvening }: {
  panel: string | null;
  notifyCount: number;
  mcpPending: number;
  updateAvailable: any;
  updateSeen: boolean;
  thinking: boolean;
  morningNotify: string | null;
  eveningNotify: string | null;
  notifyLoading: boolean;
  onNav: (key: string) => void;
  onMorning: () => void;
  onEvening: () => void;
}) {
  const lang = useLang();
  return (
    <div className="menu-popup">{MENU.map(m => (<button key={m.key} className={cn('menu-item', m.key === panel && 'menu-item--active')}
      onClick={() => onNav(m.key)}>
      <span className="menu-item-icon">{ICONS[m.key]}</span>
      {t(MENU_LABEL[m.key], lang)}
      {m.key === 'email' && notifyCount > 0 && <span className="notif-badge">{notifyCount}</span>}
      {m.key === 'mcp' && mcpPending > 0 && <span style={{ position: 'absolute', top: 2, right: 4, background: 'var(--amber)', color: '#fff', fontSize: 9, fontWeight: 700, minWidth: 15, height: 15, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{mcpPending}</span>}
      {m.key === 'about' && updateAvailable && !updateSeen && <span className="notif-dot" />}
    </button>))}
      {/* Morning & Evening notification bubbles */}
      {(morningNotify || eveningNotify) && (
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {morningNotify && (
            <button className="menu-item" style={{ padding: '4px 6px', cursor: thinking ? 'default' : 'pointer', opacity: thinking ? 0.4 : 1, border: 0, minWidth: 'unset' }}
              onClick={onMorning}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <defs>
                  <linearGradient id="morning-grad" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#fbbf24" /><stop offset="100%" stopColor="#f59e0b" />
                  </linearGradient>
                </defs>
                <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z" fill="url(#morning-grad)" opacity="0.85" />
              </svg>
            </button>
          )}
          {eveningNotify && (
            <button className="menu-item" style={{ padding: '4px 6px', cursor: thinking || notifyLoading ? 'default' : 'pointer', opacity: thinking ? 0.4 : notifyLoading ? 0.6 : 1, border: 0, minWidth: 'unset' }}
              onClick={onEvening}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <defs>
                  <linearGradient id="evening-grad" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#a78bfa" /><stop offset="100%" stopColor="#7c3aed" />
                  </linearGradient>
                </defs>
                <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z" fill="url(#evening-grad)" opacity="0.85" />
              </svg>
            </button>
          )}
        </span>
      )}
    </div>
  );
}
