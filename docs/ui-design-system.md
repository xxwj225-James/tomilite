# TomiLite UI Design System — Comprehensive Analysis

> Generated: 2026-07-29

---

## 1. CSS Custom Properties & Theme System

All CSS variables are defined in `apps/web/src/styles/index.css`. Four themes: **pipeline** (default), **hub**, **canvas**, **quantum**.

| Property            | pipeline (default) | hub          | canvas       | quantum      |
| ------------------- | ------------------ | ------------ | ------------ | ------------ |
| `--brand`           | `#4338CA`          | `#1466D6`    | `#1968D4`    | `#76B900`    |
| `--brand-hover`     | `#3730A3`          | `#0f4fa8`    | `#124f9e`    | `#5c9400`    |
| `--bg`              | `#fafbfc`          | `#f8f9fb`    | `#fff`       | `#ffffff`    |
| `--surface`         | `#ffffff`          | `#fff`       | `#fafafa`    | `#fafafa`    |
| `--surface2`        | `#f3f4f6`          | `#f0f2f5`    | `#f5f5f5`    | `#f0f0f0`    |
| `--edge`            | `#e9ebf0`          | `#e4e6eb`    | `#e0e0e0`    | `#e0e0e0`    |
| `--ink`             | `#1a1a1e`          | `#1c1e21`    | `#202124`    | `#1a1a1a`    |
| `--muted`           | `#6f6f7a`          | `#65676b`    | `#5f6368`    | `#666666`    |
| `--surface-sidebar` | `#f4f5f7`          | `#fff`       | `#fafafa`    | `#f0f0f0`    |
| `--ink-sidebar`     | `#6b6b75`          | `#1c1e21`    | `#202124`    | `#1a1a1a`    |
| `--edge-sidebar`    | `#e9ebf0`          | `#e4e6eb`    | `#e0e0e0`    | `#e0e0e0`    |
| `--green`           | `#22c55e`          | `#00a400`    | `#0d904f`    | `#76B900`    |
| `--amber`           | `#f59e0b`          | `#f7a700`    | `#ea8600`    | `#e68a00`    |
| `--purple`          | `#a855f7`          | `#8b5cf6`    | `#9334e6`    | `#8b5cf6`    |
| `--blue`            | `#6366f1`          | `#1877F2`    | `#1A73E8`    | `#3498db`    |
| `--radius`          | `10px`             | _(inherits)_ | _(inherits)_ | _(inherits)_ |

- The palette above describes **light mode**. All four themes are light; dark
  mode is a separate axis layered on top (see §1a).
- Themes switch via `<html data-theme="...">` (`applyTheme()` / `getTheme()` in
  `apps/web/src/lib/constants.ts`, not `App.tsx`)

### 1a. Light / dark mode

Mode is orthogonal to theme: any of the four themes renders in either mode. It
lives in its own attribute and its own storage key.

| | |
| --- | --- |
| Attribute | `<html data-mode="light" \| "dark">` |
| Storage key | `tomilite-mode` (theme uses `tomilite-theme`) |
| API | `applyMode()` / `getMode()` in `apps/web/src/lib/constants.ts` |
| Default | `light` — existing users see no change |
| Applied before paint | `apps/web/public/theme-init.js` (synchronous, in `<head>`) |

**How the layer is built.** `:root[data-mode='dark']` restates only the neutral
surfaces, the shadow scale and the derived tints. The four light theme blocks
are untouched. The `:root` prefix is load-bearing: it makes the selector
specificity (0,2,0), which beats every theme block's (0,1,0) no matter where it
sits in the file. Without it the selector is (0,1,0) and would only win by
source order — fragile, and it fails silently.

**Dark neutrals:** `--bg #0d0f13`, `--surface #14171d`, `--surface2 #1c2027`,
`--edge #2a2f38`, `--ink #e8eaed`, `--muted #9aa0aa`, sidebar `#101319` /
`#b6bcc6` / `#262b33`. Shadows are re-tuned much darker (`--shadow-xl` goes from
`0 16px 48px rgba(0,0,0,0.1)` to `0.7`) because surface and bg differ by only a
few percent of lightness on dark.

**Accent inversion.** `--brand` and `--on-accent` move as a pair. Dark mode
lifts `--brand` to a light tint so it stays legible as *ink* on a dark surface —
which means text sitting *on* it must go dark. Per theme, verified in both
directions:

| Theme | dark `--brand` | on `--surface` | `--on-accent` on `--brand` |
| --- | --- | --- | --- |
| pipeline | `#818cf8` | 6.02:1 | 6.46:1 |
| hub | `#60a5fa` | 7.13:1 | 7.65:1 |
| canvas | `#8ab4f8` | 8.52:1 | 9.14:1 |
| quantum | `#76b900` (unchanged) | 7.44:1 | 7.98:1 |

Changing only one of the pair is what breaks the ~14 "white text on the brand
fill" call sites; changing both together makes them correct for free.

`quantum` is the exception that proves the rule: its NVIDIA green is a bright
fill in *both* modes, so white text on it is 1.9:1 even in light mode. It gets
`--on-accent: #1a1a1a` unconditionally.

**Gradient stops.** `--brand-hover` is never a hover *background* anywhere in the
codebase — it is only the second stop of `linear-gradient(135deg, var(--brand),
var(--brand-hover))` (8 CSS sites, 3 inline). The first dark-mode set made that
gradient disappear. Measured on the real rendered pixels, its sweep spanned only
dL* 8-13, and because a dark stop *lightens* the brand while dropping its chroma
the fill reads as fading out rather than as shading. Light mode carries a
comparable span (dL* 6-13) and reads fine — it darkens a saturated colour and
keeps the chroma up. Same span, opposite direction, opposite result; the numbers
alone do not tell you which one you have.

| Theme | dark `--brand` | `--brand-hover` | dE76 | `--on-accent` on the stop |
| --- | --- | --- | --- | --- |
| pipeline | `#818cf8` | `#bcc4fb` | 36.4 | 11.35:1 |
| hub | `#60a5fa` | `#a8d3fe` | 29.4 | 12.25:1 |
| canvas | `#8ab4f8` | `#c6dcfc` | 25.0 | 13.74:1 |
| quantum | `#76b900` | `#b4ea5e` | 20.8 | 12.33:1 |

`--on-warning` (`#1a1a1a`) is the matching token for text on `--amber`, which is
also bright in every theme and both modes.

**Contrast floor.** Three light-mode values sat below WCAG AA and were moved:

| Token | was | is | measured as | before | after |
| --- | --- | --- | --- | --- | --- |
| pipeline `--muted` | `#94949e` | `#6f6f7a` | body text and icons on `--surface` / `--bg` | 3.00:1 / 2.90:1 | 4.96:1 / 4.79:1 |
| hub `--brand` | `#1877f2` | `#1466d6` | `--on-accent` on a brand fill | 4.23:1 | 5.38:1 |
| canvas `--brand` | `#1a73e8` | `#1968d4` | `--on-accent` on a brand fill | 4.51:1 | 5.29:1 |

hub and canvas keep their identity — Facebook blue and Google blue, one step
darker. canvas passed at 4.51:1 but with no margin at all, so it moved too.
Their `--brand-hover` moved with them: a stop landing within ~dE76 2 of its
partner silently flattens the gradient, so the pair is tuned together.

**Two things the token layer cannot reach, handled explicitly:**

1. `color-scheme: dark` — makes native browser chrome (date/time picker icons,
   `<select>` popups, checkbox glyphs, scrollbar tracks) render dark. Also
   declared as `<meta name="color-scheme" content="light dark">` in
   `index.html` so it applies before the stylesheet loads.
2. Rich-text marks. The text-colour and highlight swatches in the note editor
   are stored **in the document** — serialized into the note's markdown as
   `<span style="color:#ef4444">` and parsed back out of that HTML on load. The
   stored value stays a literal hex (it is document data, not theming). Only the
   *painting* is delegated: `toDOM` emits `.md-fg` / `.md-hl` plus a `--fg` /
   `--hl` custom property, and `:root[data-mode='dark']` re-derives them
   (`color-mix` toward `--ink` for text, toward `--surface` for highlights).
   Without this a dark mode would make **already-saved** notes unreadable —
   `#fecaca` highlight under `--ink` is about 1.2:1.

**Switching repaints synchronously.** `applyTheme()` and `applyMode()` set an
attribute on `<html>`, which invalidates every custom property in the document
at once. Chromium resolves that incrementally across frames and can commit a
composited frame in the middle, leaving part of the tree painted with the
previous values until something forces a full recalculation — in practice the
bottom nav, which is the last element after a long message list, and the
workaround is to resize the window. Both functions therefore read
`document.documentElement.offsetHeight` immediately after the attribute change,
which forces that full recalc inside the same task so no half-restyled frame can
reach the compositor. One forced reflow per user-triggered switch costs nothing.

Two layers that used to persist while invisible were also removed, since a
composited layer that is never repainted is the thing that goes stale:
`.panel-header` / `.panel-body` now take `visibility: hidden` once the close
transition finishes (delayed by `--dur-3` so the fade-out still plays), and
`.menu-popup` is `overflow-y: hidden` so it is a single-axis scroll container.

**Known limitation:** `electron/main.js` sets `backgroundColor: '#f8f9fb'` when
creating the window. The renderer cannot read or style that, so a dark-mode user
sees one light frame on cold start. Fixing it needs an IPC round-trip and a
preference file under `app.getPath('userData')` (`localStorage` is not readable
from the main process). Not done.

**Design tokens** (defined on `:root` in `apps/web/src/styles/index.css`, shared by all themes):

| Category   | Tokens                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Spacing    | `--space-1: 4px` … `--space-10: 40px` (4/8/12/16/20/24/32/40)                                                      |
| Radius     | `--radius-sm: 6px`, `--radius-md: 10px`, `--radius-lg: 14px`, `--radius-xl: 20px`, `--radius-full: 9999px`         |
| Shadows    | `--shadow-xs` (0 1px 2px) → `--shadow-xl` (0 16px 48px), layered shadows                                           |
| Motion     | `--dur-1: 120ms` … `--dur-4: 400ms`; `--ease-out` (enter/exit), `--ease-in-out` (state change), `--ease-spring` (travel); `--move-sm/md/lg: 4/8/16px` |
| Transition | `--transition-fast/base/slow` = `--dur-1/2/3` + `--ease-out`. Legacy aliases kept so older call sites pick up the curves unchanged |
| Semantic   | `--brand-soft` / `--red-soft` derived with `color-mix()` from `--brand` / `--red`; `--red: #ef4444`; `--on-accent`; `--on-warning` |
| Type scale | `--text-xs: 11px`, `--text-sm: 12px`, `--text-base: 14px`, `--text-md: 16px`, `--text-lg: 20px`, `--text-xl: 24px` |

---

## 2. Color Palette

### Surface (light)

- `--bg`: `#fafbfc` — page background
- `--surface`: `#ffffff` — cards/panels
- `--surface2`: `#f3f4f6` — secondary surface

### Text

- `--ink`: `#1a1a1e` — primary text
- `--muted`: `#6f6f7a` — secondary text (pipeline; the other three themes already
  cleared AA, see the contrast-floor table in §1a)
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

1. ~~**No dark mode**~~ — **addressed**, see §1a. (The app is still light by
   default; dark mode is opt-in via the sun/moon button in the chat toolbar.)
2. **Hardcoded colors** — the brand-derived tints are now token-driven via
   `color-mix()`, and 13 inline black `box-shadow`s were routed through
   `--shadow-*`. Remaining literals are deliberate: the four theme blocks,
   `THEME_COLORS`, the markdown colour palettes, email-provider brand colours,
   and the `#ddd`/`#f5f5f5` inside outbound SMTP bodies (mail clients don't
   support CSS variables).
3. **CSS inconsistencies** — `btn-danger` undefined
4. **Borders everywhere** — high visual noise (edges on sidebar/panels/headers)
5. **No elevation hierarchy** — only two effective elevation levels (cards + open panel)
