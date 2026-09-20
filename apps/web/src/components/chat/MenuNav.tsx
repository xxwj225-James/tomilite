import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import { ICONS } from '@/components/icons';
import { MORE_MENU, PRIMARY_MENU, MENU_LABEL } from '@/lib/constants';

// ═══ Always-visible navigation toolbar — menu buttons + morning/evening notification bubbles ═══
//
// Four destinations plus "More"; the rest live behind that trigger. The row used
// to carry all ten, which needed ~592px against a chat column that is only
// guaranteed 360px — so it scrolled sideways exactly when a panel was open.
export function MenuNav({
  panel,
  notifyCount,
  mcpPending,
  updateAvailable,
  updateSeen,
  thinking,
  morningNotify,
  eveningNotify,
  notifyLoading,
  onNav,
  onMorning,
  onEvening,
}: {
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
  const [moreOpen, setMoreOpen] = useState(false);

  // The overflow list floats over the message thread, so anything that leaves it
  // open while the user works somewhere else reads as stuck.
  //
  // "Outside" is the list and the trigger, not the nav bar. The bar spans the whole
  // chat column — measured 1004px wide against a 280px row of buttons — so keying
  // the dismiss off it meant that clicking the empty strip beside the buttons, the
  // one place that still looks like part of the menu, left the menu sitting open.
  // Both nodes are matched with `closest` because the list is absolutely
  // positioned outside the bar's own box.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.menu-more-list, .menu-more-trigger')) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const select = (key: string) => {
    setMoreOpen(false);
    onNav(key);
  };

  // The pending-MCP count and the unread-email count used to badge their own
  // top-level buttons. Now that both live one level down, the trigger has to
  // carry the news that something down there wants attention.
  //
  // It carries a dot rather than the sum. `notifyCount + mcpPending` adds two
  // unrelated queues, so the "3" it produced answered no question anyone has —
  // and the entries inside the list still show their own real numbers. About's
  // update notice was already a dot, so both cases collapse into one mark
  // instead of two that mean the same thing.
  const moreFlagged = notifyCount + mcpPending > 0 || (updateAvailable && !updateSeen);
  const moreActive = MORE_MENU.some((m) => m.key === panel);

  return (
    <div className="menu-nav">
      {moreOpen && (
        <div className="menu-more-list" role="menu">
          {MORE_MENU.map((m) => (
            <button
              key={m.key}
              role="menuitem"
              className={cn('menu-item', 'menu-more-item', m.key === panel && 'menu-item--active')}
              onClick={() => select(m.key)}
            >
              <span className="menu-item-icon">{ICONS[m.key]}</span>
              {t(MENU_LABEL[m.key], lang)}
              {m.key === 'email' && notifyCount > 0 && <span className="notif-badge">{notifyCount}</span>}
              {m.key === 'mcp' && mcpPending > 0 && (
                <span className="notif-badge notif-badge--amber">{mcpPending}</span>
              )}
              {m.key === 'about' && updateAvailable && !updateSeen && <span className="notif-dot" />}
            </button>
          ))}
        </div>
      )}
      <div className="menu-popup">
        {PRIMARY_MENU.map((m) => (
          <button
            key={m.key}
            className={cn('menu-item', m.key === panel && 'menu-item--active')}
            onClick={() => select(m.key)}
          >
            <span className="menu-item-icon">{ICONS[m.key]}</span>
            {t(MENU_LABEL[m.key], lang)}
          </button>
        ))}
        <button
          className={cn('menu-item', 'menu-more-trigger', moreActive && 'menu-item--active')}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <span className="menu-item-icon">{ICONS.more}</span>
          {t('app.menuMore', lang)}
          {moreFlagged && <span className="notif-dot" />}
        </button>
        {/* Morning & Evening notification bubbles */}
        {(morningNotify || eveningNotify) && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {morningNotify && (
              <button
                className="menu-item"
                style={{
                  padding: '4px 6px',
                  cursor: thinking ? 'default' : 'pointer',
                  opacity: thinking ? 0.4 : 1,
                  border: 0,
                  minWidth: 'unset',
                }}
                onClick={onMorning}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id="morning-grad" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
                      {/* These are SVG presentation *attributes*, and those do not
                          resolve var() — only a style declaration does. Painting
                          the sun/moon from the theme tokens also means they stop
                          being the only two saturated gradients still hardcoded
                          to a light-mode value in dark mode. */}
                      <stop offset="0%" style={{ stopColor: 'var(--amber)' }} />
                      <stop
                        offset="100%"
                        style={{ stopColor: 'color-mix(in srgb, var(--amber) 75%, var(--on-warning))' }}
                      />
                    </linearGradient>
                  </defs>
                  <path
                    d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z"
                    fill="url(#morning-grad)"
                    opacity="0.85"
                  />
                </svg>
              </button>
            )}
            {eveningNotify && (
              <button
                className="menu-item"
                style={{
                  padding: '4px 6px',
                  cursor: thinking || notifyLoading ? 'default' : 'pointer',
                  opacity: thinking ? 0.4 : notifyLoading ? 0.6 : 1,
                  border: 0,
                  minWidth: 'unset',
                }}
                onClick={onEvening}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id="evening-grad" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
                      {/* Same treatment as the morning gradient above. */}
                      <stop offset="0%" style={{ stopColor: 'var(--purple)' }} />
                      <stop
                        offset="100%"
                        style={{ stopColor: 'color-mix(in srgb, var(--purple) 80%, var(--on-warning))' }}
                      />
                    </linearGradient>
                  </defs>
                  <path
                    d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z"
                    fill="url(#evening-grad)"
                    opacity="0.85"
                  />
                </svg>
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
