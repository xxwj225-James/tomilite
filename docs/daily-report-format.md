# Daily Report Format Design

## Evening Report (晚报 / イブニングレポート)

### Structure

```
> **📋 Summary**
> One warm paragraph summarizing today's overall progress.

---

### 🔴 Critical & High Priority
| Priority | Key | Task | Status |
|----------|-----|------|--------|

### 🟡 Medium Priority
(same table format)

### 🟢 Low Priority / Backlog
(same table, skip if empty)

---

### ✅ Completed Today
- TL-3 Feature X done ✅

### 💻 Code Activity
- Brief summary of git commits

### 🧘 Focus — X min deep work

---

> **💡 Tomorrow's Focus**
> 2-3 prioritized action items with brief reasoning.
```

### Design Principles

| Element | Visual Treatment |
|---------|-----------------|
| `h2` section headers | Left accent bar (4px brand color) + gradient background |
| `blockquote` (summary & focus) | Card with brand-soft gradient, left border, rounded, shadow |
| `table` | Brand-color header row, white rows, hover highlight, rounded corners |
| `ul li` | Card-style items with border, hover lift |
| `hr` divider | Gradient brand → transparent, 2px |
| Priority emoji | 🔴 Critical / 🟡 High / 🟢 Low — in table Priority column |

### CSS Implementation

See `apps/web/src/styles/index.css` — `.md-preview` section.

---

## Morning Brief (早会 / 朝チェックイン)

### Structure

```
☀️ **Good morning!**

> *One warm encouraging sentence*

| Priority | Key | Task |
|----------|-----|------|
| 🔴 Critical | TL-1 | task name |
| 🟡 High | TL-2 | task name |
| 🔵 Medium | TL-3 | task name |
| 🟢 Low | TL-4 | task name |

⚠️ **Overdue** (N): TL-X ...

✅ **Yesterday**: N tasks completed

> 💡 **Today's Focus**: 1-2 sentence priority suggestion.
```

---

## LLM Prompt Design

### Key Requirements
- Language: auto-detect from system lang setting (zh/ja/en)
- Tables MUST use priority emoji in first column
- Tone: warm, encouraging
- Evening: under 400 words, no code blocks
- Morning: under 300 words, keep tables clean
- All sections required in evening report

### Max Tokens
- Evening: 1200 (was 800) — structured format needs more token budget
- Morning: 400 (unchanged) — brief table format fits
