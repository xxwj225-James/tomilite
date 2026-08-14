# TomiLite — Architecture & Feature Design

> **版本**: v1.0  
> **日期**: 2026-06-29  
> **定位**: 单用户本地 AI 生产力工具

---

## 1. 产品定位

TomiLite 是面向独立开发者的 AI 生产力工具。极简设计、零依赖部署、AI 原生交互、本地优先。

---

## 2. 技术选型

| 层 | 技术 | 原因 |
|----|------|------|
| 前端 | React 19 + Vite + Tailwind CSS | 现代、快速 |
| 后端 API | Node.js + tRPC | 轻量，无 Java 依赖 |
| 数据库 | SQLite (Prisma ORM) | 单文件，零配置 |
| AI | DeepSeek Cloud API (SSE streaming) | 成本低，效果好 |
| 搜索 | FTS5 全文搜索 | 替代 pgvector，零依赖 |
| 桌面 | Electron | 跨平台安装程序 |
| 代码共享 | npm workspaces (`@tomilite/shared-ui`) | 共享 UI 组件 |
| 混淆 | javascript-obfuscator + bytenode | P0 安全 |

---

## 3. 架构

```
tomilite/
├── apps/
│   ├── api/          # tRPC API Server (:3091)
│   │   └── src/routers/   # 13 routers
│   └── web/          # React SPA (:3002)
│       ├── src/App.tsx    # Chat-first UI
│       ├── src/components/ # UI components
│       └── src/panels/    # Feature panels (tasks, notes, email, reports, mcp)
├── packages/
│   ├── database/     # Prisma Schema + SQLite
│   └── shared-ui/    # 共享 UI 组件（npm workspace，非 Symlink）
├── electron/         # Electron wrapper
├── scripts/          # CLI tools (tomat focus, tomat init, uninstall)
└── mockup/           # Design mockup (HTML)
```

**数据流**:
```
Browser ↔ Vite Dev Server (:3002) ↔ tRPC API (:3091) ↔ SQLite
                                            ↕
                                    DeepSeek Cloud API
                                            ↕
                                    GitHub Releases (OTA)
```

---

## 4. API Routes (13 routers)

| Router | 端点 | 功能 |
|--------|------|------|
| `issue` | list, create, update, delete, children, updateRank | Issue CRUD + 拖拽排序 |
| `board` | getBoard, moveCard | 看板 + 拖拽 |
| `wiki` | list, create, update, delete | 知识库 CRUD |
| `git` | listRepos, addRepo, removeRepo, handleHook, recentRefs | Git 仓库 + commit 联动 |
| `focus` | heartbeat, status, endSession | IDE 焦点追踪 |
| `system` | checkUpdate, currentVersion | OTA 更新检测 |
| `llm` | getConfig, saveConfig, saveProvider, testConnection | LLM 配置 |
| `email` | listInbox, listDrafts, saveDraft, getConfig, saveConfig, stats | 邮件集成 |
| `agent` | /stream (SSE), chat, generateReport, getBoardStatus, getProjectStats | AI Agent + 工具 |
| `mcp` | listTools, execute, confirm, deny, confirmById, listPending, listAuditLogs, auditStats | MCP + HITL |
| `apikey` | list, generate, revoke, delete, verify | API Key 管理 |
| `health` | personalHealth, healthHistory | 5维健康评分 |
| `search` | search, reviewIssue, knowledgeMap | FTS5 搜索 + AI Review |
| `learn` | capture, reflect, getContext, stats | 自学习 |

---

## 5. Database (SQLite via Prisma)

25 个 model，关键表：

| Model | 用途 |
|-------|------|
| `Issue` | 任务管理（type, status, priority, storyPoints, sortOrder...） |
| `Board` / `BoardColumn` / `BoardCard` | 看板 |
| `KnowledgePage` | Wiki/笔记 |
| `FocusSession` | 焦点会话 |
| `GitRepo` / `GitCommitRef` | Git 集成 |
| `ApiKey` | API Key（SHA-256 哈希存储） |
| `McpAuditLog` | MCP 审计 |
| `AiDecisionFeedback` | 自学习反馈 |
| `UserHealthSnapshot` | 健康历史 |
| `InboundMessage` / `DraftReply` | 邮件 |
| `LlmProviderMaster` / `LlmProvider` / `LlmConfig` | LLM 配置 |

---

## 6. 功能清单

### 6.1 核心交互 — Chat-First UI

```
┌────────────────────────────────────┐
│ 左上: 🔒 Deep Flow 🎯 Focused 💤    │
│ 右上: EN | 中 | 日  ●●●●           │
├──────────┬─────────────────────────┤
│ Sessions │  🤖 RobotFace            │
│ + New    │  TomiLite AI Agent     │
│ Chat 1   │  [6 suggestion chips]    │
│ Chat 2   │                          │
│          │  User: create a bug...   │
│ 0/100k   │  Agent: ✅ Created TL-3  │
├──────────┴─────────────────────────┤
│  [+]  [Ask me anything...]      [↑] │
│  Enter to send · Shift+Enter new line│
└────────────────────────────────────┘
```

- **对话即主界面** — 无侧栏、无菜单栏
- **+ 菜单** — 8 个功能面板（Home/Board/Backlog/Issue/Notes/Email/MCP Audit/Reports/Feedback/Settings）
- **右侧滑入面板** — Chat 区缩小但可用
- **SSE 流式输出** — 逐 token 渲染，打字机效果

### 6.2 AI Agent

- **5 个工具**: `create_issue`, `get_stats`, `list_issues`, `search_notes`, `update_issue`
- **LLM Function Calling**: DeepSeek 原生支持，流式 + 工具调用
- **降级策略**: 无 API Key → 错误提示 + 模拟回复

### 6.3 个人健康评分 (AI Health)

5 维度规则引擎：
- `completion` — Issue 完成率
- `velocity` — 近期完成速度
- `focus` — 深度心流时长
- `git_activity` — Git commit 频率
- `staleness` — Issue 老化程度

LLM 润色摘要（可选），快照存 `user_health_snapshots`。

### 6.4 FTS5 搜索 + AI Issue Review

- **全文搜索**: Issue + Notes + Email + Report 四源检索 + LLM Web Search
- **AI Review**: 查重（≥70% 匹配标记高危）、标题质量、描述完整性、故事点合理性
- **LLM 润色**: 可选 DeepSeek 分析

### 6.5 知识地图

项目全局概览，LLM 合成 3 句摘要 + 推荐阅读。

### 6.6 Agent 自学习

- **隐式反馈捕获**: ISSUE_REOPEN, ASSIGN_REJECT, STATUS_REVERT
- **增量反思**: 启动时或手动触发，检测近期拒识模式
- **上下文注入**: `learn.getContext` 为 Agent prompt 注入教训

### 6.7 Git 集成

- `tomat init` — 安装 post-commit hook
- commit `fix #3` → 自动关闭 TL-3

### 6.8 通用 IDE 焦点追踪

- `tomat focus` — 轻量 IDE 扩展为主，文件系统监控为备
- 任何 IDE/编辑器通用
- **性能保护**：内置 ignore 规则（`.git`, `node_modules`, `dist`, `target`, `build`, `*.log`）
- **防抖机制**：文件变更 2s 内合并为一次 heartbeat，杜绝 CPU 100%

### 6.9 MCP + HITL

- 3 级风险闸门: read_only (直接) / low (自动) / medium+ (需确认)
- API Key 管理 + 审计日志

### 6.10 OTA 更新

- 2h 检查 GitHub Releases → 顶部横幅提示

### 6.11 Setup Wizard

6 步引导: Welcome → Language → Email → LLM → Git → Done

### 6.12 Electron 桌面应用

- NSIS 安装程序（Windows）、DMG（macOS）、AppImage（Linux）
- 系统托盘 + 关闭隐藏

---

## 7. 代码规范

详见 `CLAUDE.md`（8 Parts）：
- 禁硬编码颜色 → 语义 CSS 变量
- 禁 `any` 类型、`console.log`
- `cn()` 处理动态 class
- i18n 3 语言全覆盖
- Pre-commit hook: ESLint + Prettier + TypeScript
- javascript-obfuscator P0 混淆

---

## 8. 技术决策记录

| 需求 | 实现方案 |
|------|---------|
| AI 对话入口 | App.tsx Chat-First UI |
| SSE Streaming | `/api/agent/stream` |
| AI Health Scorer | `/api/health.personalHealth` |
| 向量搜索替代 | FTS5 全文搜索 |
| AI Issue Review | `/api/search.reviewIssue` |
| Knowledge Map | `/api/search.knowledgeMap` |
| AI Evolution | `/api/learn.*` |
| MCP Server + HITL | `/api/mcp.*` + `/api/apikey.*` |
| 定时任务 | node-cron + 启动时执行 |
| 事件通信 | 直接函数调用 |
| 防抖 | 内存 Map + setTimeout |
| 代码混淆 | javascript-obfuscator |
| 字节码加密 | bytenode (.jsc) |
