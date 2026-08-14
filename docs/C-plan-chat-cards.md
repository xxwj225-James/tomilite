# C 方案：聊天内嵌可操作卡片

## 设计目标

Agent 创建的内容（任务/笔记/报告）在聊天中呈现为可操作卡片，用户无需切换到面板即可查看、编辑、删除。面板作为"高级视图"使用。

## 核心原则

```
面板开着 → Agent 填表单，用户精调后 Save
面板没开 → Agent 直接写 DB，聊天出卡片
```

**一个工具只做一件事**：
- `create_issue` / `create_note` / `create_report` → 直接写 DB
- `suggest_issue_edit` / `suggest_note_edit` / `suggest_report_edit` → 只填表单（编辑器开着时）

## 卡片交互

```
┌──────────────────────────────────────┐
│ 🎫 TL-50   todo   high               │
│ Debug UI与Agent会话交互的C方案         │
│ 通过事件总线+状态机解耦...             │  ← 描述片段 (120字)
│                                      │
│ [👁 查看] [✏️ 编辑] [▶ Start] [🗑 删除] │
└──────────────────────────────────────┘

[查看] → 面板打开，选中该项（只读）
[编辑] → 面板打开，选中该项 + 进入编辑模式
[Start] → 任务直接移至 in_progress
[删除] → 确认后删除 DB 记录
```

## 技术实现

### 前端 (App.tsx)

1. **ChatCard 接口** — 定义卡片数据结构 (type, id, title, key, status, ...)
2. **Msg 组件** — 渲染卡片 JSX，含状态 badge + 操作按钮
3. **SSE 处理** — `create_*` 事件构建卡片，缓存到 `cardRef`，随消息持久化
4. **卡片事件** — `tl-open-card`, `tl-edit-card`, `tl-delete-card`, `tl-move-card` CustomEvent

### 前端 (ContentPanel.tsx)

5. **面板联动** — `tl-select-task/note/report` 事件监听，选中对应条目

### 后端 (agent.ts)

6. **最小改动** — `create_issue` 返回值加 `id: issue.id`（UUID），供卡片删除使用

### 前端 (其它)

7. **preFlight** — 移除创建类正则，不再自动导航到面板
8. **create_* SSE** — 移除 `setPanel()`，纯聊天不跳面

## 当前状态

### ✅ 已完成

| 功能 | 状态 | 备注 |
|------|------|------|
| ChatCard 接口 | ✅ | |
| Msg 卡片渲染 | ✅ | 含状态 badge + 4 个操作按钮 |
| 卡片事件监听 | ✅ | open / edit / delete / move |
| 面板联动 (task) | ✅ | tl-select-task → TasksPanel |
| 面板联动 (note) | ✅ | tl-select-note → NotesPanel |
| 面板联动 (report) | ✅ | tl-select-report → ReportsPanel |
| lastToolArgsRef 缓存 | ✅ | 解决 tool_result 无 args 问题 |
| finalMsg 保存 card | ✅ | 通过 cardRef 持久化到最终消息 |
| agent.ts 最小改动 | ✅ | create_issue 返回 id + priority，完整 args |
| 卡片 DB 持久化 | ✅ | ChatMessage.card 列 + saveMsg/load |
| DB 迁移 | ✅ | 原始 SQL ALTER TABLE + prisma db push 兜底 |
| DeepSeek JSON 清洗 | ✅ | Non-greedy 正则对齐后端 |

### 🔧 已修复

1. **cardRef 被覆盖** → `if (msgCard) cardRef.current = msgCard`
2. **args 截断 200 字符** → 改为完整传递，JSON.parse 不再失败
3. **create_issue 缺 priority** → 返回值加 `priority: issue.priority`
4. **卡片不持久化** → Prisma schema + chat router + saveMsg
5. **DB 迁移竞态** → 原始 SQL 先执行，server.listen 在迁移完成后
6. **DeepSeek 原始 JSON 泄露** → Non-greedy 正则清洗

### 🔄 待回加（agent.ts）

- `streamLLMWithRetry` — 指数退避重试
- `suggest_*` guard 移到 agent loop
- prompt 优化 — 多步执行/智能默认/查重/终止信号
- 错误恢复 — tool 返回 error 时注入修正提示
- tool result 截断 — LLM 只看到摘要

## 版本记录

| 版本 | 日期 | 内容 |
|------|------|------|
| v0.1.0-beta | 2026-07-09 | C Plan 卡片完整可用 |
| - | 2026-07-09 | 修复 cardRef 覆盖、args 截断、priority 缺失 |
| - | 2026-07-09 | 加卡片 DB 持久化 + 原始 SQL 迁移 |
