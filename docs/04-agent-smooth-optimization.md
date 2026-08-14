# Agent 丝滑优化方案 — 对标 Claude Code

> 版本: v1.0 | 日期: 2026-06-29
> 基于 Claude Code 架构分析，针对 TomiLite Agent 的 4 维优化

## 现状评估

| 维度 | 当前状态 | 差距 |
|------|----------|------|
| 意图路由 | Guard Flash 模型（一阶段） | 🟡 部分实现，需加强 |
| 上下文管理 | System prompt + noteContext | 🔴 无沙箱约束、无 JIT 注入 |
| 交互体验 | SSE → token → setState | 🟡 标准流程，无"抢跑" |
| 错误处理 | try-catch + 返回错误 | 🔴 无自愈机制 |

---

## 一、两阶段双模型架构

### 现状问题
当前 Guard 模型和 Pro 模型是串行的——Guard 输出指令后 Pro 才开始。用户需要等待 Guard 的 HTTP 往返 + Pro 的流式输出。如果 Guard 耗时 1s，Pro 耗时 3s，用户感知延迟是 4s。

### 优化方案

```
用户消息
  ↓
┌─ Phase 0：前端抢跑（< 50ms）──────────────┐
│ 前端关键字检测（纯 JS，无网络请求）          │
│ "打开task" → 立刻 dispatch open_task 骨架屏  │
│ "创建笔记" → 立刻打开 Notes 编辑器骨架屏     │
└────────────────────────────────────────────┘
  ↓
┌─ Phase 1：Guard 路由（< 500ms）───────────┐
│ Flash 模型 → 输出 JSON intent + parameters │
│ 如果前端已抢跑 → 只需校验/修正，无需重复 UI │
│ 如果前端未抢跑 → 触发对应的 UI 操作         │
└────────────────────────────────────────────┘
  ↓
┌─ Phase 2：Pro 执行（1-5s）───────────────┐
│ 完整上下文 + 工具调用 + Agentic Loop       │
│ 前端骨架屏被真实数据填充                    │
└────────────────────────────────────────────┘
```

### 实现重点

**前端抢跑规则（零网络延迟）：**

```typescript
const PRE_FLIGHT_RULES = [
  { pattern: /打开(task|任务).*一[览栏]/, action: () => navigateTo('tasks') },
  { pattern: /打开(note|笔记).*一[览栏]/, action: () => navigateTo('notes') },
  { pattern: /打开\s*TL-(\d+)/, action: (m) => openTask(parseInt(m[1])) },
  { pattern: /创建.*(task|任务|bug)/, action: () => openNewTaskForm() },
  { pattern: /创建.*(note|笔记)/, action: () => openNewNoteForm() },
];

function preFlightCheck(message: string): UICommand | null {
  for (const rule of PRE_FLIGHT_RULES) {
    const match = message.match(rule.pattern);
    if (match) return rule.action(match);
  }
  return null;
}
```

**效果对比：**

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| "打开 task 一览" | 4s（Guard+Pro） | <50ms（前端抢跑） |
| "创建新笔记" | 4s | <50ms（前端抢跑） |
| "给笔记加内容" | 4s | 1-2s（Guard routing + Pro execution）|

---

## 二、上下文沙箱与 JIT 注入

### 现状问题
- `shell_exec` 没有显式声明工作空间限制
- System prompt 包含了全部 10 个 tool 的定义（~2000 tokens），即使当前场景只需要 3 个
- 没有根据场景动态注入最小化上下文

### 优化方案

**1. 沙箱声明（System Prompt 级别）**

```
SANDBOX: Your workspace is ${WORKSPACE}. 
- You CAN read/write within this directory.
- You CANNOT access anything outside this directory.
- shell_exec cwd is locked to workspace.
- Any attempt to escape the sandbox will be blocked.
```

**2. JIT 上下文注入（Tool 执行时才注入）**

```typescript
async function executeAgentTool(tool: string, args: any) {
  // JIT: 在执行前注入最小化上下文
  switch (tool) {
    case 'shell_exec':
      // 注入当前 git 状态（仅 50 tokens）
      const gitCtx = await getGitContext(args.cwd);
      args._context = gitCtx; // { branch: 'main', recentCommits: [...], dirty: false }
      break;
    case 'create_issue':
      // 注入当前 project 统计（仅 30 tokens）
      const stats = await getProjectStats();
      args._context = stats; // { total: 12, todo: 5, inProgress: 4 }
      break;
    case 'create_note':
      // 注入已有 note 分类列表（仅 20 tokens）
      const cats = await getExistingCategories();
      args._context = cats; // ['general', 'architecture', 'api_docs']
      break;
  }
  // ... execute
}
```

**3. Tool 列表按场景裁剪（当前已有，需加强）**

| 场景 | 可用 Tools | Token 节省 |
|------|-----------|-----------|
| Note 编辑器打开 | suggest_note_edit | ~1500 |
| Tasks 面板 | create_issue, suggest_issue_edit, list_issues, get_stats | ~800 |
| 纯聊天 | 全 10 个 | 0 |
| shell 执行中 | 仅 shell_exec + mcp_call | ~1200 |

**效果：** 无效 tool 定义不再占用上下文，模型注意力更集中。

---

## 三、乐观更新（Optimistic UI）

### 现状问题
用户说"打开 TL-3"，Agent 开始流式输出 tool_call JSON → 前端等待完整的 `tool_result` 才更新 UI。用户看到的是打字机效果，延迟 2-4 秒。

### 优化方案

**SSE 流中检测 tool_call 前缀 → 立刻触发骨架屏**

```typescript
// App.tsx SSE handler
if (delta?.tool_calls) {
  const tc = delta.tool_calls[0];
  if (tc.function?.name && !toolCallStarted) {
    toolCallStarted = true;
    // 抢跑：不等待完整参数，立刻触发 UI 动作
    optimisticUI(tc.function.name, tc.function.arguments || '{}');
  }
}

function optimisticUI(toolName: string, partialArgs: string) {
  switch (toolName) {
    case 'open_task':
      setPanel('tasks');
      showSkeleton('task-detail');
      break;
    case 'open_note':
      setPanel('notes');
      showSkeleton('note-editor');
      break;
    case 'navigate_to':
      // 尝试从 partial args 中提取 panel
      const m = partialArgs.match(/"panel"\s*:\s*"(\w+)"/);
      if (m) setPanel(m[1]);
      break;
  }
}
```

**效果：** 用户看到面板**立刻**滑出（带骨架屏），0.5s 后数据填充完成。

---

## 四、自愈机制（Auto-Healing Loop）

### 现状问题
`shell_exec` 返回 `code !== 0` 时，直接告诉用户"命令失败"。用户需要自己分析错误、手动修正、重新发送。

### 优化方案

```typescript
async function shellExec(command: string, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const error = validateCommand(command, cwd);
  if (error) return { code: -1, stdout: '', stderr: `❌ ${error}` };

  let result = await nativeExec(command, cwd);
  
  // Auto-heal: 常见错误自动修复
  if (result.code !== 0 && isRecoverable(result.stderr)) {
    const fixedCmd = await aiFixCommand(command, cwd, result.stderr);
    if (fixedCmd && fixedCmd !== command) {
      send('progress', { text: 'Auto-fixing command...' });
      result = await nativeExec(fixedCmd, cwd);
      if (result.code === 0) {
        result.stdout = `(auto-fixed: ${fixedCmd})\n${result.stdout}`;
      }
    }
  }
  
  return result;
}

// 可恢复错误模式
const RECOVERABLE_PATTERNS = [
  /No such file or directory/,  // 路径错误
  /command not found/,          // 命令拼写
  /Permission denied/,          // 权限问题
  /fatal: not a git repository/,// 目录不对
];

function isRecoverable(stderr: string): boolean {
  return RECOVERABLE_PATTERNS.some(p => p.test(stderr));
}

async function aiFixCommand(cmd: string, cwd: string, error: string): Promise<string | null> {
  // 用 Flash 模型快速修复
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: flashModel,
      messages: [{
        role: 'user',
        content: `Command failed: "${cmd}"\nError: ${error}\nCWD: ${cwd}\nOutput ONLY the fixed command (one line, no explanation):`,
      }],
      max_tokens: 100,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(3000),
  });
  if (!resp.ok) return null;
  const d = await resp.json();
  return d.choices?.[0]?.message?.content?.trim() || null;
}
```

**效果：** 用户说 `git lig`（打错了），Agent 自动修正为 `git log` 并执行，用户看到正确结果，完全感知不到中间的修复过程。

---

## 实施优先级

| 优先级 | 优化项 | 难度 | 用户感知提升 |
|--------|--------|------|-------------|
| P0 | 前端抢跑（Pre-flight Rules） | 低 | 🔥🔥🔥🔥🔥 |
| P0 | Tool 列表按场景极致裁剪 | 低 | 🔥🔥🔥 |
| P1 | JIT 上下文注入（git context）| 中 | 🔥🔥🔥🔥 |
| P1 | 沙箱声明强化 | 低 | 🔥🔥 |
| P2 | 乐观更新（SSE 骨架屏） | 中 | 🔥🔥🔥🔥 |
| P2 | 自愈机制 | 中 | 🔥🔥🔥🔥 |

---

## 改动清单（P0 实现）

| 文件 | 改动 |
|------|------|
| `App.tsx` | `preFlightCheck()` — 消息发送前检测关键字，<50ms 触发 UI |
| `agent.ts` | 沙箱声明注入 system prompt |
| `agent.ts` | JIT 上下文注入（shell_exec 前注入 git 状态） |
| `agent.ts` | Tool 裁剪强化——编辑 note 时只保留 1 个 tool |

---

## 附录：Review 修正（v1.1）

### 修正 1：乐观更新 JSON 截断 ➔ 累积匹配

**问题**：SSE delta chunk 可能在 JSON 中间截断，正则 `partialArgs.match()` 失效。

**修正**：维护 `accumulatedArgs` 字符串，每收到一个 chunk 累加后匹配：

```typescript
let accumulatedArgs = '';
// SSE loop:
if (delta?.tool_calls) {
  accumulatedArgs += delta.tool_calls[0].function?.arguments || '';
  // Match against accumulated, not individual chunk
  const m = accumulatedArgs.match(/"panel"\s*:\s*"(\w+)"/);
  if (m) optimisticNavigate(m[1]);
}
```

### 修正 2：自愈机制 ➔ 最多重试 1 次

**问题**：修复后的命令再次报错可能陷入死循环。

**修正**：硬编码 `maxRetries = 1`，一次修复后仍失败则返回原始错误：

```typescript
let retries = 0;
const MAX_RETRIES = 1;
while (result.code !== 0 && isRecoverable(result.stderr) && retries < MAX_RETRIES) {
  retries++;
  const fixedCmd = await aiFixCommand(command, cwd, result.stderr);
  if (!fixedCmd || fixedCmd === command) break;
  result = await nativeExec(fixedCmd, cwd);
}
```

### 修正 3：Tool 裁剪 ➔ 保留核心工具，避免缓存失效

**问题**：频繁切换 tool 列表导致 LLM Context Cache 失效。用户编辑笔记时突然问"看板状态"，模型因缺少工具而呆滞。

**修正**：定义 `CORE_TOOLS = ['get_stats', 'list_issues', 'web_search', 'shell_exec', 'mcp_call']` 始终可用，仅裁剪场景专属工具。编辑 note 时 = Core + `suggest_note_edit`，查看 task 时 = Core + `suggest_issue_edit`。
