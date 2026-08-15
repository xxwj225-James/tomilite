# TomiLite UI Design System — Comprehensive Analysis

> Generated: 2026-07-29

---

## 1. CSS Custom Properties & Theme System

All CSS variables are defined in `apps/web/src/styles/index.css`. Four themes: **pipeline** (default), **hub**, **canvas**, **quantum**.

| Property            | pipeline (default) | hub          | canvas       | quantum      |
| ------------------- | ------------------ | ------------ | ------------ | ------------ |
| `--brand`           | `#4338CA`          | `#1877F2`    | `#1A73E8`    | `#76B900`    |
| `--brand-hover`     | `#3730A3`          | `#1464d0`    | `#1557b0`    | `#5c9400`    |
| `--bg`              | `#fafbfc`          | `#f8f9fb`    | `#fff`       | `#ffffff`    |
| `--surface`         | `#ffffff`          | `#fff`       | `#fafafa`    | `#fafafa`    |
| `--surface2`        | `#f3f4f6`          | `#f0f2f5`    | `#f5f5f5`    | `#f0f0f0`    |
| `--edge`            | `#e9ebf0`          | `#e4e6eb`    | `#e0e0e0`    | `#e0e0e0`    |
| `--ink`             | `#1a1a1e`          | `#1c1e21`    | `#202124`    | `#1a1a1a`    |
| `--muted`           | `#94949e`          | `#65676b`    | `#5f6368`    | `#666666`    |
| `--surface-sidebar` | `#f4f5f7`          | `#fff`       | `#fafafa`    | `#f0f0f0`    |
| `--ink-sidebar`     | `#6b6b75`          | `#1c1e21`    | `#202124`    | `#1a1a1a`    |
| `--edge-sidebar`    | `#e9ebf0`          | `#e4e6eb`    | `#e0e0e0`    | `#e0e0e0`    |
| `--green`           | `#22c55e`          | `#00a400`    | `#0d904f`    | `#76B900`    |
| `--amber`           | `#f59e0b`          | `#f7a700`    | `#ea8600`    | `#e68a00`    |
| `--purple`          | `#a855f7`          | `#8b5cf6`    | `#9334e6`    | `#8b5cf6`    |
| `--blue`            | `#6366f1`          | `#1877F2`    | `#1A73E8`    | `#3498db`    |
| `--radius`          | `10px`             | _(inherits)_ | _(inherits)_ | _(inherits)_ |

- All **light mode**; no dark theme
- Themes switch via `<html data-theme="...">` (`applyTheme()` / `getTheme()` in `apps/web/src/lib/constants.ts`, not `App.tsx`)

**Design tokens** (defined on `:root` in `apps/web/src/styles/index.css`, shared by all themes):

| Category   | Tokens                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Spacing    | `--space-1: 4px` … `--space-10: 40px` (4/8/12/16/20/24/32/40)                                                      |
| Radius     | `--radius-sm: 6px`, `--radius-md: 10px`, `--radius-lg: 14px`, `--radius-xl: 20px`, `--radius-full: 9999px`         |
| Shadows    | `--shadow-xs` (0 1px 2px) → `--shadow-xl` (0 16px 48px), layered shadows                                           |
| Transition | `--transition-fast: 0.12s ease`, `--transition-base: 0.2s ease`, `--transition-slow: 0.3s ease`                    |
| Semantic   | `--brand-soft: rgba(99,102,241,0.08)`, `--red: #ef4444`, `--red-soft: rgba(239,68,68,0.1)`                         |
| Type scale | `--text-xs: 11px`, `--text-sm: 12px`, `--text-base: 14px`, `--text-md: 16px`, `--text-lg: 20px`, `--text-xl: 24px` |

---

## 2. Color Palette

### Surface (light)

- `--bg`: `#fafbfc` — page background
- `--surface`: `#ffffff` — cards/panels
- `--surface2`: `#f3f4f6` — secondary surface

### Text

- `--ink`: `#1a1a1e` — primary text
- `--muted`: `#94949e` — secondary text
- `--ink-sidebar`: `#6b6b75`

### Border

- `--edge`: `#e9ebf0`
- `--edge-sidebar`: `#e9ebf0`

### Semantic

- `--green`: `#22c55e` | `--amber`: `#f59e0b` | `--purple`: `#a855f7` | `--blue`: `#6366f1`
- `--red`: `#ef4444` (tokenized, not hardcoded) — delete/danger; `--red-soft` for soft backgrounds

---

## 3. Typography

Font: `'Geist', 'Geist Fallback', system-ui, -apple-system, sans-serif`

Unified type scale via tokens (all px, no rem):
`--text-xs 11px, --text-sm 12px, --text-base 14px, --text-md 16px, --text-lg 20px, --text-xl 24px` — components reference `var(--text-*)`

Line heights: `1.5`, `1.6` (base body and messages)

---

## 4. Spacing / Radius / Shadows

**Spacing**: tokenized — `--space-1..10` (4/8/12/16/20/24/32/40px), used via `padding: var(--space-*)`

**Radius**: tokenized — `--radius-sm 6px / md 10px / lg 14px / xl 20px / full 9999px`, plus `--radius: 10px` per theme

**Shadows** (tokenized, used on cards/panels/interactive elements):

- `--shadow-xs` — suggestion chips
- `--shadow-sm` — cards
- `--shadow-lg` — open panel
- `0 8px 32px rgba(99,102,241,0.25)` — welcome robot; `0 8px 32px rgba(0,0,0,0.2)`-style — modals

---

## 5. Component Styles

### Buttons

- `.btn`: `border:none; border-radius:var(--radius-md); padding:8px 16px; font-size:var(--text-sm); font-weight:500; transition:all var(--transition-base)`
- `.btn-brand`: `background:linear-gradient(135deg, var(--brand), var(--brand-hover)); color:#fff;` + hover lift + brand shadow
- Variants: `.btn-secondary` (surface2), `.btn-ghost` (transparent), sizes `.btn-xs` / `.btn-sm`, `:disabled` (opacity 0.4)
- ⚠️ `danger` variant still has no CSS class

### Cards

- `.card`: `background:var(--surface); box-shadow:var(--shadow-sm); border-radius:var(--radius)` — **no border**
- Header (`card-hd`) separated by `border-bottom: 1px solid var(--edge)`

### Forms

- `.form-input / .form-select / .form-textarea`: `background:var(--bg); border:1px solid var(--edge); border-radius:var(--radius-md); padding:var(--space-2) var(--space-3); font-size:var(--text-sm)`; focus ring `box-shadow:0 0 0 3px var(--brand-soft)`

### Messages

- `.msg-bubble`: `padding:var(--space-3) var(--space-4); max-width:85%; border-radius:var(--radius-lg)`
- User: `background:linear-gradient(135deg, var(--brand), var(--brand-hover)); color:#fff; border-bottom-right-radius:var(--radius-sm)`
- Assistant: `background:var(--surface2); color:var(--ink); border-bottom-left-radius:var(--radius-sm)`

---

## 6. Layout

```
.app-root (100vw×100vh, no padding)
  └── .app-shell
       ├── .session-sidebar (180px)
       └── .main-chat-wrapper
            ├── Top bar
            ├── .app-viewport
            │    ├── .app-viewport-chat (flex-basis 360px, min 360px)
            │    │    ├── .chat-messages
            │    │    ├── .menu-popup (7 items)
            │    │    └── .chat-input-row
            │    └── .panel (slide-in; .panel--open = clamp(380px, 40%, 560px))
```

---

## 7. Design Weaknesses

1. **No dark mode** — all four themes are light
2. **Hardcoded colors** — some `#ef4444`, `#fef3c7` etc. remain hardcoded in JSX (though `--red`/`--red-soft`/`--brand-soft` now exist as tokens)
3. **CSS inconsistencies** — `btn-danger` undefined
4. **Borders everywhere** — high visual noise (edges on sidebar/panels/headers)
5. **No elevation hierarchy** — only two effective elevation levels (cards + open panel)
