# TomiLite UI Design System — Comprehensive Analysis

> Generated: 2026-07-29

---

## 1. CSS Custom Properties & Theme System

All CSS variables are defined in `apps/web/src/styles/index.css`. Four themes: **pipeline** (default), **hub**, **canvas**, **quantum**.

| Property | pipeline (default) | hub | canvas | quantum |
|---|---|---|---|---|
| `--brand` | `#6366f1` | `#1877F2` | `#1A73E8` | `#76B900` |
| `--brand-hover` | `#5558e6` | `#1464d0` | `#1557b0` | `#5c9400` |
| `--bg` | `#f8f9fb` | `#f8f9fb` | `#fff` | `#ffffff` |
| `--surface` | `#ffffff` | `#fff` | `#fafafa` | `#fafafa` |
| `--surface2` | `#f1f3f6` | `#f0f2f5` | `#f5f5f5` | `#f0f0f0` |
| `--edge` | `#e8eaef` | `#e4e6eb` | `#e0e0e0` | `#e0e0e0` |
| `--ink` | `#1a1a1e` | `#1c1e21` | `#202124` | `#1a1a1a` |
| `--muted` | `#8e8e96` | `#65676b` | `#5f6368` | `#666666` |
| `--surface-sidebar` | `#f0f1f4` | `#fff` | `#fafafa` | `#f0f0f0` |
| `--ink-sidebar` | `#5a5a62` | `#1c1e21` | `#202124` | `#1a1a1a` |
| `--edge-sidebar` | `#e0e2e7` | `#e4e6eb` | `#e0e0e0` | `#e0e0e0` |
| `--green` | `#22c55e` | `#00a400` | `#0d904f` | `#76B900` |
| `--amber` | `#f59e0b` | `#f7a700` | `#ea8600` | `#e68a00` |
| `--purple` | `#a855f7` | `#8b5cf6` | `#9334e6` | `#8b5cf6` |
| `--blue` | `#6366f1` | `#1877F2` | `#1A73E8` | `#3498db` |
| `--radius` | `8px` | *(inherits)* | *(inherits)* | *(inherits)* |

- All **light mode**; no dark theme
- Themes switch via `<html data-theme="...">` (`applyTheme()` in `App.tsx`)

---

## 2. Color Palette

### Surface (light)
- `--bg`: `#f8f9fb` — page background
- `--surface`: `#ffffff` — cards/panels
- `--surface2`: `#f1f3f6` — secondary surface

### Text
- `--ink`: `#1a1a1e` — primary text
- `--muted`: `#8e8e96` — secondary text
- `--ink-sidebar`: `#5a5a62`

### Border
- `--edge`: `#e8eaef`
- `--edge-sidebar`: `#e0e2e7`

### Semantic
- `--green`: `#22c55e` | `--amber`: `#f59e0b` | `--purple`: `#a855f7` | `--blue`: `#6366f1`
- `#ef4444` (hardcoded) — delete/danger

---

## 3. Typography

Font: `system-ui, -apple-system, 'Segoe UI', sans-serif`

Font-size distribution (all px, no rem):
`8, 9, 10, 11, 12, 13, 14, 16, 18, 24` — no unified type scale

Line heights: `1.5`, `1.55`, `1.6`, `1.7`, `1.8`

---

## 4. Spacing / Radius / Shadows

**Radius**: 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 50% — no token system

**Shadows** (rarely used):
- `0 4px 16px rgba(0,0,0,0.3)` — welcome robot
- `0 8px 32px rgba(0,0,0,0.2)` — modals
- No shadows on cards/buttons/panels — pure flat design

---

## 5. Component Styles

### Buttons
- `.btn`: `border:none; border-radius:6px; padding:6px 14px; font-size:12px; font-weight:600`
- `.btn-brand`: `background:var(--brand); color:#fff`
- ⚠️ `danger` variant has no CSS class

### Cards
- `.card`: `background:var(--surface); border:1px solid var(--edge); border-radius:var(--radius)`

### Forms
- `.form-input`: `background:var(--bg); border:1px solid var(--edge); border-radius:6px; padding:8px 12px; font-size:12px`

### Messages
- `.msg-bubble`: `padding:8px 14px; max-width:88%; border-radius:16px`
- User: `background:var(--brand); filter:saturate(0.7); border-bottom-right-radius:4px`
- Assistant: `background:var(--surface2); border-bottom-left-radius:4px`

---

## 6. Layout

```
.app-root (100vw×100vh, 4px padding)
  └── .app-shell
       ├── .session-sidebar (160px)
       └── .main-chat-wrapper
            ├── Top bar
            ├── .app-viewport
            │    ├── .app-viewport-chat (min 360px)
            │    │    ├── .chat-messages
            │    │    ├── .menu-popup (7 items)
            │    │    └── .chat-input-row
            │    └── .panel (340-560px, slide-in)
```

---

## 7. Design Weaknesses

1. **No dark mode** — all four themes are light
2. **No typographic scale** — font sizes are ad-hoc (8-24px, 10 levels)
3. **Hardcoded colors** — many `#ef4444`, `#fef3c7` etc. hardcoded in JSX
4. **CSS inconsistencies** — `btn-danger` undefined; `--color-edge` doesn't exist
5. **Flat, no depth** — no elevation hierarchy
6. **Borders everywhere** — high visual noise
7. **Missing transitions** — some elements have no hover transitions
8. **No spacing tokens** — all spacing hardcoded
