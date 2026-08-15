# Daily Report Format Design

## Evening Report

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

### 📧 Emails Today *(conditional — skip if none)*
- Urgent/replied count + 2-3 key email subjects

### 🧘 Focus — X min deep work

---

> **💡 Tomorrow's Focus**
> 2-3 prioritized action items with brief reasoning.
```

### Design Principles

| Element                        | Visual Treatment                                                      |
| ------------------------------ | --------------------------------------------------------------------- |
| `h2` section headers           | Left accent bar (4px brand color) + gradient background               |
| `blockquote` (summary & focus) | Card with brand-soft gradient, no left border, rounded, shadow        |
| `table`                        | Brand-color header row, white rows, hover highlight, rounded corners  |
| `ul li`                        | Simple indented list items (no card-style borders or hover lift)      |
| `hr` divider                   | Gradient brand → transparent, 2px                                     |
| Priority emoji                 | 🔴 Critical / 🟡 High / 🔵 Medium / 🟢 Low — in table Priority column |

### CSS Implementation

See `apps/web/src/styles/index.css` — `.md-preview` section.

---

## Morning Brief

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

📧 **Pending Emails** (N): *(fallback only, conditional — skip if none)*
| 🔴 | sender | subject |

> 💡 **Today's Focus**: 1-2 sentence priority suggestion.
```

> Note: the 📧 Pending Emails section is present in the local fallback greeting (`buildGreeting`, `apps/api/src/routers/standup.ts`); the morning LLM prompt renders only tasks/overdue/yesterday/focus. Both skip the section when there are no unprocessed action-required emails (category 1/2, `isProcessed: false`).

---

## LLM Prompt Design

### Key Requirements

- Language: auto-detect from system lang setting (zh/ja/en)
- Tables MUST use priority emoji in first column (🔴🟡🔵🟢)
- Tone: warm, encouraging
- Evening: under 400 words, no code blocks
- Morning: under 250 words, keep tables clean
- Sections are **conditional** — skip any section with no data (priority tables, Emails Today); only the Summary and Tomorrow's Focus are required
- Evening report data excludes email-derived tasks (`type='email'`) — they are reported in the 📧 Emails section instead

### Max Tokens

- Evening: 1200 (was 800) — structured format needs more token budget
- Morning: 500 — brief table format fits
