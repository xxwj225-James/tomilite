import { useState } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import { ICONS } from '@/components/icons';
import { MORE_MENU, PRIMARY_MENU, MENU_LABEL } from '@/lib/constants';

// ═══ App menu — the sidebar block between "new chat" and the session list ═══
//
// This is the drawer's table of contents, so it reads top-down like one: the four
// destinations you work in, then "More" for the six you visit occasionally.
//
// "More" expands INLINE rather than into a popup. It used to float, which cannot
// work here — `.session-sidebar` is `overflow: hidden`, and an absolutely
// positioned list would be clipped by it. Inline expansion is a disclosure
// instead of a menu, which also drops the outside-click/Escape dismissal: the
// sub-list is part of the page now, and nothing is covering anything.
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

  const select = (key: string) => {
    // Navigating out of a sub-list leaves it behind you rather than leaving a
    // stale group expanded under a panel it no longer describes.
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
    <div className="side-menu">
      {PRIMARY_MENU.map((m) => (
        <button
          key={m.key}
          className={cn('menu-item', m.key === panel && 'menu-item--active')}
          onClick={() => select(m.key)}
        >
          <span className="menu-item-icon">{ICONS[m.key]}</span>
          <span className="menu-item-label">{t(MENU_LABEL[m.key], lang)}</span>
        </button>
      ))}
      <button
        className={cn('menu-item', moreActive && 'menu-item--active')}
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((o) => !o)}
      >
        <span className="menu-item-icon">{ICONS.more}</span>
        <span className="menu-item-label">{t('app.menuMore', lang)}</span>
        {moreFlagged && <span className="notif-dot" />}
        <svg
          className="side-menu-chevron"
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
      {moreOpen && (
        <div className="side-menu-sub">
          {MORE_MENU.map((m) => (
            <button
              key={m.key}
              className={cn('menu-item', m.key === panel && 'menu-item--active')}
              onClick={() => select(m.key)}
            >
              <span className="menu-item-icon">{ICONS[m.key]}</span>
              <span className="menu-item-label">{t(MENU_LABEL[m.key], lang)}</span>
              {m.key === 'email' && notifyCount > 0 && <span className="notif-badge">{notifyCount}</span>}
              {m.key === 'mcp' && mcpPending > 0 && (
                <span className="notif-badge notif-badge--amber">{mcpPending}</span>
              )}
              {m.key === 'about' && updateAvailable && !updateSeen && <span className="notif-dot" />}
            </button>
          ))}
        </div>
      )}
      {/* Morning & Evening notification bubbles. In the row they sat right-aligned
          at the far end; here they are a row of their own at the end of the block,
          which is the same "out of the way but always there" position. */}
      {(morningNotify || eveningNotify) && (
        <div className="side-menu-notify">
          {morningNotify && (
            <button
              className={cn('menu-item', 'menu-item--icon')}
              style={{
                padding: '4px 6px',
                cursor: thinking ? 'default' : 'pointer',
                opacity: thinking ? 0.4 : 1,
                border: 0,
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
              className={cn('menu-item', 'menu-item--icon')}
              style={{
                padding: '4px 6px',
                cursor: thinking || notifyLoading ? 'default' : 'pointer',
                opacity: thinking ? 0.4 : notifyLoading ? 0.6 : 1,
                border: 0,
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
        </div>
      )}
    </div>
  );
}
