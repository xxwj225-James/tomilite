import { t } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { useThemeStore } from '@/stores/themeStore';
import { MODES, THEMES, THEME_COLORS } from '@/lib/constants';
import { cn } from '@/lib/cn';

// Theme and light/dark are two independent axes — any theme renders in either
// mode — so they are two controls, not one list of eight. These controls used
// to sit in the chat toolbar as four colour dots plus a sun/moon button; five
// controls for something set once and then left alone.
//
// The theme names are product names (`pipeline`, `hub`, `canvas`, `quantum`),
// not UI copy, so they are shown as-is and are not in the i18n dictionary —
// same reason `THEME_COLORS` is a literal table.

export function AppearanceTab() {
  const lang = useLang();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  return (
    <div className="p-2">
      <div className="card">
        <div className="card-hd">{t('appearance.theme', lang)}</div>
        <div className="card-bd">
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {THEMES.map((th) => {
              const active = theme === th;
              return (
                <button
                  key={th}
                  type="button"
                  onClick={() => setTheme(th)}
                  aria-pressed={active}
                  className={cn('theme-card', active && 'theme-card--active')}
                >
                  {/* The swatch is the theme's own --brand, so it has to be the
                      literal from THEME_COLORS: `var(--brand)` would resolve to
                      whichever theme is active and paint all four the same. */}
                  <span className="theme-card-swatch" style={{ background: THEME_COLORS[th] }} />
                  <span className="theme-card-name">{th}</span>
                </button>
              );
            })}
          </div>
          <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 'var(--space-3)' }}>
            {t('appearance.themeHint', lang)}
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">{t('appearance.mode', lang)}</div>
        <div className="card-bd">
          <div className="segmented" role="group" aria-label={t('appearance.mode', lang)}>
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn('segmented-item', mode === m && 'segmented-item--active')}
              >
                {t(m === 'dark' ? 'appearance.modeDark' : 'appearance.modeLight', lang)}
              </button>
            ))}
          </div>
          <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 'var(--space-3)' }}>
            {t('appearance.modeHint', lang)}
          </p>
        </div>
      </div>
    </div>
  );
}
