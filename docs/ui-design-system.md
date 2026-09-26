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
| `--green`           | `#22c55e`          | `#00a400`    | `#0d904f`    | `#0d904f`    |
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

|                      |                                                                 |
| -------------------- | --------------------------------------------------------------- |
| Attribute            | `<html data-mode="light" \| "dark">`                            |
| Storage key          | `tomilite-mode` (theme uses `tomilite-theme`)                   |
| API                  | `applyMode()` / `getMode()` in `apps/web/src/lib/constants.ts`  |
| Consumers use        | `useThemeStore` in `apps/web/src/stores/themeStore.ts`          |
| Default              | `light` — existing users see no change                          |
| Applied before paint | `apps/web/public/theme-init.js` (synchronous, in `<head>`)      |
| User-facing control  | Settings → **Appearance** (`panels/settings/AppearanceTab.tsx`) |

Theme and mode are one store, not two pieces of React state, because three
unrelated components need them: the settings panel, the first-run welcome guide,
and `<html>` itself. The store calls `applyTheme` / `applyMode` from its setters,
so a component never has to remember to apply what it just set. Nothing applies
on mount — `theme-init.js` has already written both attributes.

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
lifts `--brand` to a light tint so it stays legible as _ink_ on a dark surface —
which means text sitting _on_ it must go dark. Per theme, verified in both
directions:

| Theme    | dark `--brand`        | on `--surface` | `--on-accent` on `--brand` |
| -------- | --------------------- | -------------- | -------------------------- |
| pipeline | `#818cf8`             | 6.02:1         | 6.46:1                     |
| hub      | `#60a5fa`             | 7.13:1         | 7.65:1                     |
| canvas   | `#8ab4f8`             | 8.52:1         | 9.14:1                     |
| quantum  | `#76b900` (unchanged) | 7.44:1         | 7.98:1                     |

Changing only one of the pair is what breaks the ~14 "white text on the brand
fill" call sites; changing both together makes them correct for free.

`quantum` is the exception that proves the rule: its NVIDIA green is a bright
fill in _both_ modes, so white text on it is 1.9:1 even in light mode. It gets
`--on-accent: #1a1a1a` unconditionally.

**Gradient stops.** `--brand-hover` is never a hover _background_ anywhere in the
codebase — it is only the second stop of `linear-gradient(135deg, var(--brand),
var(--brand-hover))` (8 CSS sites, 3 inline). The first dark-mode set made that
gradient disappear. Measured on the real rendered pixels, its sweep spanned only
dL* 8-13, and because a dark stop _lightens_ the brand while dropping its chroma
the fill reads as fading out rather than as shading. Light mode carries a
comparable span (dL* 6-13) and reads fine — it darkens a saturated colour and
keeps the chroma up. Same span, opposite direction, opposite result; the numbers
alone do not tell you which one you have.

| Theme    | dark `--brand` | `--brand-hover` | dE76 | `--on-accent` on the stop |
| -------- | -------------- | --------------- | ---- | ------------------------- |
| pipeline | `#818cf8`      | `#bcc4fb`       | 36.4 | 11.35:1                   |
| hub      | `#60a5fa`      | `#a8d3fe`       | 29.4 | 12.25:1                   |
| canvas   | `#8ab4f8`      | `#c6dcfc`       | 25.0 | 13.74:1                   |
| quantum  | `#76b900`      | `#b4ea5e`       | 20.8 | 12.33:1                   |

`--on-warning` (`#1a1a1a`) is the matching token for text on `--amber`, which is
also bright in every theme and both modes.

**Contrast floor.** Three light-mode values sat below WCAG AA and were moved:

| Token              | was       | is        | measured as                                 | before          | after           |
| ------------------ | --------- | --------- | ------------------------------------------- | --------------- | --------------- |
| pipeline `--muted` | `#94949e` | `#6f6f7a` | body text and icons on `--surface` / `--bg` | 3.00:1 / 2.90:1 | 4.96:1 / 4.79:1 |
| hub `--brand`      | `#1877f2` | `#1466d6` | `--on-accent` on a brand fill               | 4.23:1          | 5.38:1          |
| canvas `--brand`   | `#1a73e8` | `#1968d4` | `--on-accent` on a brand fill               | 4.51:1          | 5.29:1          |

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
   _painting_ is delegated: `toDOM` emits `.md-fg` / `.md-hl` plus a `--fg` /
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

| Category   | Tokens                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing    | `--space-1: 4px` … `--space-10: 40px` (4/8/12/16/20/24/32/40)                                                                                         |
| Radius     | `--radius-sm: 6px`, `--radius-md: 10px`, `--radius-lg: 14px`, `--radius-xl: 20px`, `--radius-full: 9999px`                                            |
| Shadows    | `--shadow-xs` (0 1px 2px) → `--shadow-xl` (0 16px 48px), layered shadows                                                                              |
| Motion     | `--dur-1: 120ms` … `--dur-4: 400ms`; `--ease-out` (enter/exit), `--ease-in-out` (state change), `--ease-spring` (travel); `--move-sm/md/lg: 4/8/16px` |
| Transition | `--transition-fast/base/slow` = `--dur-1/2/3` + `--ease-out`. Legacy aliases kept so older call sites pick up the curves unchanged                    |
| Celebration | `--celebration-ms` — set inline by `components/Celebration.tsx` from `CELEBRATION_MS` (1800); the stylesheet derives every internal beat with `calc()` (pieces 0.8×, the line 0.88×) and hard-codes no lifetime |
| Semantic   | `--brand-soft` / `--red-soft` derived with `color-mix()` from `--brand` / `--red`; `--red: #ef4444`; `--on-accent`; `--on-warning`                    |
| Type scale | `--text-xs: 11px`, `--text-sm: 12px`, `--text-base: 14px`, `--text-md: 16px`, `--text-lg: 20px`, `--text-xl: 24px`                                    |

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

#### What each semantic colour means

The four semantic tokens are **reserved meanings**, not a palette to pick from
when a component needs "a colour". The convention the codebase actually follows:

| Token     | Means                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `--muted` | no state yet · neutral · nothing to report                                                                 |
| `--amber` | needs attention: in progress, high priority, degraded, over a threshold                                    |
| `--brand` | the accent: primary buttons, selection, the active nav item, in review, work currently being run by the AI |
| `--green` | success, and only success: completed, sent, connected, test passed                                         |
| `--red`   | error · failed · destructive · recording in progress                                                       |

The one rule worth enforcing in review is the boundary between the last three:
**`--amber` = work that is not finished, `--brand` = the accent and "someone is
acting on this", `--green` = the outcome was good.** A task status map is the
canonical example, and it is duplicated consistently in
`components/chat/TaskBatchCard.tsx` and `panels/tasks/TasksEditor.tsx`:
`todo → muted`, `in_progress → amber`, `in_review → brand`, `done → green`.

`--brand` and `--green` are the pair most often confused, because "running" and
"done" both feel positive. Green is reserved for the second one.

**Known deviations** — deliberate, not bugs to file, but they mean this table is a
default rather than an invariant:

- `priorityColor()` maps `critical → --brand`, `high → --amber`. Severity is not
  the same axis as state; it reuses the accent to mean "most severe".
- `McpServerTab`'s enable/disable button tints the **action**, not the state:
  "Disable" renders amber and "Enable" renders green.

**The token values have to support the rule.** `--brand` and `--green` must be
**dE76 ≥ ~15 apart in every theme** — the same floor §1 holds the
`--brand` / `--brand-hover` pair to. `quantum` violated it: `--green` was
`#76b900`, literally the same hex as its `--brand`, dE76 `0.0`, which is why
"success" and "accent" were indistinguishable in that theme and nowhere else.
`--green` is now `#0d904f` (dE76 `46.2`); the other three measure `109.7`–`162.6`.

**Known open issue — `--green` is used as ink, and no theme clears AA on light.**
29 call sites use it as `color:` (text and icons, some at 9–11px) against only 4
as a fill, and those fills carry no text on top, so the 4.5:1 text threshold
applies to it. Measured on `--surface`:

| Theme            | `--green` | on light `#fafafa` | on dark `#14171d` |
| ---------------- | --------- | ------------------ | ----------------- |
| pipeline         | `#22c55e` | 2.18:1             | 7.88:1            |
| hub              | `#00a400` | 3.19:1             | 5.39:1            |
| canvas / quantum | `#0d904f` | 3.93:1             | 4.38:1            |

No theme reaches 4.5:1 on the light surface, so green status text ("done",
"connected", "sent") is low-contrast in light mode today. The root cause is that
`--green`, `--amber`, `--purple` and `--blue` have **no per-mode override in any
theme** — only `--brand` / `--brand-hover` do. One value cannot satisfy both
surfaces: light-surface AA needs relative luminance ≤ 0.174 while dark-surface AA
needs ≥ 0.213. Fixing it means adding a `[data-mode='dark']` value for these four
tokens in all four themes.

---

## 3. Typography

Font: `'Geist', 'Geist Fallback', system-ui, -apple-system, sans-serif`

Unified type scale via tokens (all px, no rem):
`--text-xs 11px, --text-sm 12px, --text-base 14px, --text-md 16px, --text-lg 20px, --text-xl 24px` — components reference `var(--text-*)`

### Inline sizes in the chat column

The chat column used to set small text with raw numbers, and had drifted to five
sizes in 4px of range — 9 / 10 / 11 / 12 / 13. Two problems beyond the count:

- **The rungs were sub-perceptual.** A field label at 9px with its own value at
  10px is a distinction no one can see; the same for 11 vs 12. Hierarchy in this
  app is actually carried by `fontWeight` (400 / 600 / 700) and by colour
  (`--muted` vs `--ink` vs `--brand`), which the code already does consistently.
- **The card hierarchy was inverted.** In `Msg.tsx` tool cards the identifier sat
  at 10px inside a body set at 12px, so the card's own name was smaller than the
  text beneath it.

Now mapped onto the scale, chat column only:

| was       | token       | rendered |
| --------- | ----------- | -------- |
| 9, 10, 11 | `--text-xs` | 11px     |
| 12, 13    | `--text-sm` | 12px     |

That is five sizes down to two, using tokens that already existed — no new rung.
81 sites: `Msg.tsx` 29, `WelcomeGuide.tsx` 27, `TaskBatchCard.tsx` 7,
`ChatInput.tsx` 6, `ChatToolbar.tsx` 4, `App.tsx` 2, `SessionSidebar.tsx` 2,
and one each in `LlmBanner` / `MeetingIndicator` / `MsgList` / `UpdateBar`.
The chat card chip row gained `flexWrap` in the same change, because four chips
at 11px would otherwise run past the card edge at the 360px column minimum.

**Left alone deliberately:** 15px / 17px / 18px are emoji and glyph sizes (the
setup-checklist icons, the banner dismiss ×), not text tiers. The panel header
(`.panel-header`, `--space-*` + `--text-md`) and the bottom nav (`.menu-item`,
`--text-xs`) were already tokenized and needed nothing.

**Not done — the "cards by shadow, not border" idea does not apply here.** The
chat column has no border-stacking and essentially no shadows; message bubbles
separate by background tone (`--surface2` on `--bg`), which is the right call at
this density. The borders that do exist are `2px` on tool cards and their
**colour is the state** (`--brand` active / `--amber` blocked / `--edge`
resolved) — the convention in §2. Converting those to shadows would delete the
signal rather than add depth.

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

#### `<select>` must always own its current value

A `<select>` whose `value` matches no `<option>` does not fall back to the first one — it
renders **empty**, in both the browser and React. The state still holds the real value, so
the control silently misrepresents the data, and the next interaction writes the
mismatch: the user sees a blank field, picks something to "fix" it, and the original value
is gone with no undo.

This is reachable whenever a stored value comes from a writer outside the component's own
list — a model, an import, a migration. `NotesEditor`'s category `<select>` hardcoded
`general | architecture | api_docs | runbook` while `chat_distill` was already writing
`chat`, so distillation notes rendered as uncategorised and were moved out of their
notebook by the first pick. Note import multiplied the same bug by the number of folders
in the user's disk.

**The pattern:** compute whether the current value is in the list; if not, render it as its
own `<option>` ahead of the "real" ones.

```tsx
const KNOWN = ['general', 'architecture', 'api_docs', 'runbook'];
{!KNOWN.includes(p.category) && (
  <option value={p.category}>{p.category || t('notes.uncategorized', lang)}</option>
)}
```

Use the raw stored value as the label — it is data the user typed or chose elsewhere, and
a translated label over an untranslated value is the same lie in a nicer font. Only the
empty case needs a string, because there is nothing to show.

The same rule applies to a `<select>` fed by a server vocabulary (Redmine trackers,
statuses, priorities): the vocabulary is fetched, so a value cached from a previous
session can be missing from this one.

### Settings tabs

`SettingsPanel.tsx` holds one flat `ALL_TABS` list, a `tabColor` map, and a
`settingsIcon` switch. `appearance` is deliberately last.

- **`tabColor` reuses tokens rather than inventing them.** The palette defines four
  accents per theme and they are already shared (`--blue` is `email` and `meeting`;
  `--purple` is `standup` and `appearance`).
- **A tab that produces something belongs to the panel that shows the result.** `import`
  used to sit at the end of this strip; it filled the notes library and the task board,
  while the settings tabs all configure a connection the panels then use. It is now a
  dialog in each of those two panels.
- **`--cyan` is referenced by `mcpServers` and defined in no theme block**, so it resolves
  to nothing and that tab's icon falls back to inherited colour. It is a live example of
  the failure mode this rule exists to prevent; fixing it means either defining the token
  in all four themes or moving that tab onto an existing accent, and it is unrelated to
  this batch.
- **The `settingsIcon` switch needs an explicit case per tab.** Its `default` returns
  `null`, so a missing case is not an error — the tab simply has no icon, which is easy to
  miss on a tab nobody opened yet.
- **`tabLabel` goes through `t()`**, not the local `Record` map it replaced. A tab added
  without an i18n key renders the key itself in every language.

### Messages

- `.msg-bubble`: `padding:var(--space-3) var(--space-4); max-width:85%; border-radius:var(--radius-lg)`
- User: `background:linear-gradient(135deg, var(--brand), var(--brand-hover)); color:#fff; border-bottom-right-radius:var(--radius-sm)`
- Assistant: `background:var(--surface2); color:var(--ink); border-bottom-left-radius:var(--radius-sm)`

### Empty states

`components/EmptyState.tsx` — one component for every panel that can be empty
(notes, tasks, reports, meeting, email), so the five cannot drift apart again.

| Part    | Style                                                                          |
| ------- | ------------------------------------------------------------------------------ |
| wrapper | `padding: var(--space-10) var(--space-5)`, centred column, `min-height: 200px` |
| icon    | 40px emoji — a glyph size, deliberately not on the `--text-*` scale            |
| title   | `--text-md`, 600, `--ink` — says what the panel **is**                         |
| hint    | `--text-sm`, `--muted`, `lineHeight 1.6`, `maxWidth: 300`                      |
| action  | `.btn .btn-brand .btn-sm`, and only when the caller passes a handler           |

Three rules worth keeping:

- **A no-match search is not an empty panel.** The panel-empty screen explains
  and offers an action; the search-empty screen is one muted line
  (`empty.noResults`). Notes, reports and meeting draw that line now.
- **Test the judge against the _unfiltered_ collection.** `TasksList` narrows
  by tab, search and two dropdowns into one array, so `sortedIssues.length === 0`
  is true for a user with twenty finished tasks sitting on the "todo" tab —
  telling them the board is empty and offering to create their first task. The
  guard is `libraryEmpty`, computed from the raw `issues`. The other four panels
  already tested the raw collection (`p.reports` / `p.notes` / `s.meetings` /
  `emails`, each with its filtered twin stored separately); tasks was the one
  that collapsed both into a single array.
- **The action must be a path that already exists.** No new create flows were
  invented for these buttons: notes/tasks/reports clear the editor to its blank
  state (which _is_ how those panels create — they persist on save) and meeting
  calls `requestStart`, the same entry point the recorder bar uses, so the
  recording-consent prompt is not bypassed.

### Celebrations

`components/Celebration.tsx`, portalled to `document.body` at `z-index: 900` (above panels
and nav, below `.modal-overlay`), `pointer-events: none`, `inset: 0`. Two elements:

- `.celebration-burst` — 24 spans, one `@keyframes` for all of them. Each piece differs only
  by inline custom properties (`--dx/--dy/--up/--rot/--delay/--piece-color/--piece-w/--piece-h`),
  which is enough because custom properties are not interpolated themselves: `translate3d(0,0,0)`
  is substituted at computed-value time into `translate3d(37px,-180px,0)`, and *that* is what
  animates.
- `.celebration-line` — one `.card`-shaped line of text, `role="status"`.

Colours are the theme's own `--brand` / `--green` / `--amber` / `--purple` / `--blue`, one per
piece by position. Not `--red` (this app's failure colour) and not `--muted` (grey) — a
celebration painted in the error tint reads as a warning.

**`prefers-reduced-motion` needs two exemptions, and both are load-bearing.** The global block
sets `animation-duration: 1ms !important` on `*`, and both keyframes end on `opacity: 0` —
so collapsing them to 1ms does not make them fast, it makes them draw **nothing at all**. So:
the JS skips the burst entirely rather than shortening it (`lib/motion.ts`'s
`prefersReducedMotion()`), and inside the reduced-motion block
`.celebration-line { animation: none !important }` plus `.celebration-piece { display: none !important }`
say the same thing again in the stylesheet. What such a user gets is the text capsule,
instantly, held for the full duration and then gone — which is the point of the feature.

---

## 6. Layout

```
.app-root (100vw×100vh, no padding)
  └── .app-shell
       ├── .session-sidebar (180px, fixed, shrink 0)
       │    └── .session-list (today / yesterday / earlier — "earlier" folds)
       └── .main-chat-wrapper
            ├── Top bar
            ├── .app-viewport (overflow-x: scroll)
            │    ├── .app-viewport-chat (flex: 1 1 360px, min-width: 360px)
            │    │    ├── .chat-messages
            │    │    ├── .menu-nav          ← position: relative, holds the popup
            │    │    │    ├── .menu-popup (PRIMARY_MENU: home/notes/tasks/meeting)
            │    │    │    └── .menu-more-list (MORE_MENU, anchored to "More")
            │    │    └── .chat-input-row
            │    └── .panel (slide-in)
            │         .panel--open        = max(0px, min(clamp(380px, 40%, 560px), 100% - 360px))
            │         .panel--open.panel--wide (meeting only)
            │                             = max(0px, min(clamp(420px, 46%, 680px), 100% - 360px))
```

**Why the panel widths are wrapped.** The clamp is a preference; the row not
overflowing is a constraint. `.app-viewport` is `overflow-x: scroll` and its two
children cannot shrink below 360px (chat) and the panel's flex-basis, so a panel
wider than `100% - 360px` — measured against `.app-viewport`, which excludes the
sidebar — pushes the row sideways and puts a horizontal scrollbar across the whole
app. The plain clamp alone was already reachable at the 900px minimum window
width (`360 + 380 = 740 > 720`).

**The nav is split, not trimmed.** `PRIMARY_MENU` holds four entries plus the
"More" trigger; `MORE_MENU` holds the remaining six behind it. Ten flat items at
`min-width: 56px` plus the popup's padding wanted 592px against a 360px chat
column, so the row scrolled sideways exactly when a panel was open.

**Every nav entry is a panel.** `chat` used to be a fifth entry, special-cased in
`panelForKey` to mean "no panel". It was removed: `.app-viewport-chat` is a
sibling of `.panel`, never covered by it, so "go to chat" revealed nothing that
was not already on screen — it was a close button labelled as a destination, and
the panel header's ✕ already does that. With no panel open the row now shows no
active item, which is correct: "no panel" is not a destination.

**The More popup is anchored to its trigger.** The `.menu-nav` wrapper exists
because `.menu-popup` is an x-axis scroll container (`overflow-y: hidden`), which
would clip an absolutely-positioned popup placed inside it. That rules out making
the trigger the popup's containing block, so the popup attaches by CSS anchor
positioning instead (`anchor-name` on the trigger, `left: anchor(left)` /
`bottom: calc(anchor(top) + 6px)` on the list), with the old `left`/`bottom`
pair kept as a fallback for a renderer without `anchor()`. Placing it by
`.menu-nav`'s right edge — harmless when the row held ten items and nearly filled
the column — put it 634px from the trigger once the row shrank to four.

It matches **left** edges, not right ones. The list is 172px against a 56px
trigger, so matching right edges hangs the box entirely to the trigger's left:
measured at 319–491 with the trigger at 435–491, i.e. over Tasks and Meetings
while the button it belongs to sat just off its edge. Matching left edges puts it
over the row's empty run, which is also where the room is. In a chat column at its
360px minimum it can then run past the bar's right edge, and that is the
deliberate half of the trade: it stays on screen, and it never covers a
destination button. A `min(anchor(left), …)` clamp was tried and rejected — it
keeps the box inside the bar, but only by pushing it back over Meetings, which is
the thing being fixed.

Dismissal keys off the list and the trigger, **not** off `.menu-nav`. The bar
spans the whole chat column — 1004px against a 280px row of buttons — so treating
it as "inside" left the menu open when you clicked the empty strip beside the
buttons, the one place that still reads as part of the menu. Both nodes are
matched with `closest` rather than containment, because the list is absolutely
positioned outside the bar's own box.

**"Earlier" is the one folding group.** It is the only bucket with no upper
bound, and today/yesterday are what you come back to, so it starts folded; the
header becomes a `<button aria-expanded>` carrying the count and a chevron. It
unfolds itself when the active session lives down there — a folded group would
otherwise leave the sidebar with no active row — and a ref keeps that from
re-opening it after a deliberate fold.

---

## 7. Design Weaknesses

1. ~~**No dark mode**~~ — **addressed**, see §1a. (The app is still light by
   default; dark mode is opt-in via **Settings → Appearance**.)
2. **Hardcoded colors** — the brand-derived tints are now token-driven via
   `color-mix()`, and 13 inline black `box-shadow`s were routed through
   `--shadow-*`. Remaining literals are deliberate: the four theme blocks,
   `THEME_COLORS`, the markdown colour palettes, email-provider brand colours,
   and the `#ddd`/`#f5f5f5` inside outbound SMTP bodies (mail clients don't
   support CSS variables).

   The `no-restricted-syntax` rule that enforces §1.1 now reports **zero
   warnings repo-wide**, so the pre-commit gate (`--max-warnings 0`) is passable
   again. The deliberate literals above carry inline suppressions that name
   their reason and are scoped to the data tables themselves, so a _new_ hex
   elsewhere in those files is still caught. Two sites that were only ever
   inconsistent — not deliberate — were fixed rather than suppressed: the email
   category accents (`EmailList.tsx` `CAT_META`) and the morning/evening nav
   glyphs (`MenuNav.tsx`) now derive from the semantic tokens, which also
   removes the light-mode-only tints `CAT_META` used to carry into dark mode.

3. **CSS inconsistencies** — `btn-danger` undefined
4. **Borders everywhere** — high visual noise (edges on sidebar/panels/headers)
5. **No elevation hierarchy** — only two effective elevation levels (cards + open panel)
