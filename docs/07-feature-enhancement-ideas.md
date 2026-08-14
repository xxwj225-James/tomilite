# TomiLite Feature Enhancement Plan

## Task Management

### 🧩 AI One-Click Decomposition
- **Description**: Select a large task → AI splits it into 3-5 subtasks, auto-generating child cards on the kanban
- **Value**: Lowers the psychological barrier, ends procrastination. Vague large tasks become executable subtasks
- **Implementation**: Add a decomposition mode to the `create_issue` tool, triggered from a frontend context menu
- **Difficulty**: Medium

### 📊 Task Statistics Panel ✅
- **Description**: Completion-rate trend chart, priority distribution, weekly heatmap
- **Value**: Visualizes progress; spot backlogs at a glance
- **Implementation**: Reuse existing Health data-collection logic + CSS bar charts
- **Difficulty**: Low
- **Status**: ✅ Done — below the Knowledge Map on the Home page: total/completion rate/7-day done + priority bar chart + type labels

### ⌨️ Keyboard Shortcut for Quick Task Creation
- **Description**: `Ctrl+N` pops up a floating input; type a title + Enter to create the task
- **Value**: Uninterrupted flow, no panel switching
- **Implementation**: Global hotkey listener + floating Modal
- **Difficulty**: Low

### 🏷️ AI Auto-Tagging
- **Description**: Agent auto-tags based on the title (frontend/bug/docs/urgent) → kanban filters by tag
- **Value**: Automatic categorization, faster search
- **Implementation**: Agent returns tag suggestions; add a labels field to the Issue model
- **Difficulty**: Low

---

## Notes

### 🔗 Bidirectional Links
- **Description**: `[[note title]]` syntax auto-generates links; the bottom shows which notes reference the current note
- **Value**: Builds a personal knowledge network, an Obsidian-like experience
- **Implementation**: Render layer parses `[[...]]` syntax + a reverse-index table
- **Difficulty**: Medium

### 📑 Auto Table of Contents ✅
- **Description**: Collapsible TOC under the note title
- **Value**: Instant navigation in long documents
- **Implementation**: Parse `#` headings + `<details>` collapse + click-to-jump
- **Status**: ✅ Done

### 🎨 Code-Block Syntax Highlighting ✅
- **Description**: ```js ```python etc. auto-colored
- **Value**: Essential for technical notes
- **Implementation**: highlight.js, 9 languages, GitHub Dark theme
- **Status**: ✅ Done

### 🤖 AI Polish/Rewrite ✅
- **Description**: Header buttons in the note editor → Agent polishes/translates/summarizes/expands
- **Value**: Writing accelerator
- **Implementation**: 4 buttons — ✨Polish 🌐Translate 📝Summarize 📖Expand — sent to the Agent via sendMessage
- **Status**: ✅ Done

---

## Priority Suggestions

| Priority | Feature | Rationale |
|--------|------|------|
| P0 | AI one-click decomposition | Biggest pain point |
| P0 | ~~Code-block syntax highlighting~~ ✅ | Done |
| P0 | ~~AI polish/rewrite~~ ✅ | Done |
| P0 | ~~Auto TOC~~ ✅ | Done |
| P0 | ~~Task statistics panel~~ ✅ | Done |
| P1 | Keyboard shortcut for quick task creation | Low effort, high frequency |
| P2 | Bidirectional links | Core knowledge-management capability |
| P3 | AI auto-tagging | Depends on tag-system rework |
