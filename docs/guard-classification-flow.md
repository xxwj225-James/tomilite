# Guard Classification Flow

Agent 意图分类的三级流水线，负责决定用户消息应该触发创建操作还是直接回答问题。

> **注意**: 2026-07-23 调整顺序——关键词预判（Step 1）移到编辑器绕过（Step 2）之前，确保"为什么X"类提问不会被编辑器面板状态影响而误创建 task。

## 架构概览

```
用户消息
  │
  ├─ Step 1: 关键词预判 ─────────── 不含创建关键词 → general_chat（结束）
  │                                   含创建关键词 → 继续
  │
  ├─ Step 2: Note Editor 按钮绕过 ── 笔记编辑器 + [Note editor action:] → suggest_note_edit
  │
  └─ Step 3: Guard LLM 分类 ──────── flashModel 细分类 5 种 intent
     │                                 返回 JSON → 注入主模型 system prompt
     ├─ 成功 → intentHint = Guard 返回的 instruction
     └─ 失败 → 兜底 instruction
```

## Step 1: 关键词预判

**位置**: `apps/api/src/routers/agent.ts` 第 88-95 行

**逻辑**: 移除消息中的上下文前缀，检查是否包含显式创建意图。

**匹配"创建意图"的正则**:
- 开头: `创建`、`新建`、`create`、`new task/bug/issue/feature/story/note`
- 前 30 字符含: `创建`、`新建`、`create_`

**如果不匹配** → 直接设 `intentHint = "answer directly, do not create anything"`，跳过所有后续步骤。

**如果匹配** → 继续 Step 2/3。

## Step 2: Note Editor 按钮绕过

**位置**: 第 97-100 行

**触发条件**: Step 1 未设 intentHint **且** `noteEditorOpen` **且** 消息含 `[Note editor action:]`

**场景**: 用户在笔记编辑器中点击了润色/翻译/总结/扩写按钮。

**效果**: 直接设 intentHint 为 `suggest_note_edit`，告诉主模型先输出修改说明再调工具。

## Step 3: Guard LLM 分类

**位置**: 第 102-142 行

**触发条件**: Step 1 和 Step 2 都未设 intentHint（消息被判定为"含创建意图"）

**流程**:
1. 构造 prompt，要求 flashModel 输出 JSON:
   - `intent`: `create_task | create_note | edit_note | task_action | general_chat`
   - `instruction`: 具体工具调用指令
2. 调用 `flashModel` API（`temperature: 0`, `response_format: json_object`, 6s timeout）
3. 解析 JSON → `intentHint = instruction`
4. 失败兜底: 通用 instruction

**合法的 create_issue type**: `task`, `bug`, `story`（不含 `feature`/`epic`）
**映射规则**: 用户说"Feature/功能" → type `story`；不确定 → type `task`

## 主模型注入

**位置**: 第 223 行

`intentHint` 拼接到主模型的 system prompt 末尾:
```
Pick one that fits the conversation context.${intentHint}
```

主模型根据 system prompt + intentHint + tools 决定实际调用的工具。

## Hallucination 检测

**位置**: 第 470-510 行

主模型回复后，校验是否真的调了工具:

| Guard intent | 必须调用的工具 |
|-------------|---------------|
| `create_task` | `create_issue` 或 `force_create_issue` |
| `create_note` | `create_note` 或 `force_create_note` |
| `edit_note` | `suggest_note_edit` |

如果 Guard 说了要创建但主模型没调工具 → `[Hallucination]` 告警 → force re-run。

## 已知问题

1. **Qwen flashModel 分类不准**: 比 DeepSeek 更容易误判，把提问分类成 `create_task`
2. **关键词覆盖有限**: "帮我写个..." 不被 Step 1 的正则匹配，走到 Step 3 可能误判
3. **Guard 超时不触发 Hallucination**: 超时时 intentHint 为空，主模型自由发挥

## 相关文件

| 文件 | 内容 |
|------|------|
| `apps/api/src/routers/agent.ts:84-142` | Guard 分类主逻辑 |
| `apps/api/src/routers/agent.ts:470-510` | Hallucination 检测 |
| `apps/api/src/routers/agent.ts:223` | intentHint 注入主模型 |
| `apps/web/src/App.tsx:1467` | reasoningContent 持久化 |
