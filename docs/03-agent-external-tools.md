# Agent 调用外部能力 技术方案

> 版本: v2.0 | 日期: 2026-06-29
> v2.0 变更: 安全模型重构 / 防死锁 / Token 脱敏 / MCP Client 优先

## 1. 背景

TomiLite 目前已实现 MCP Server（被外部 Agent 调用），但缺少反向能力——TomiLite Agent 无法调用外部 Agent 或服务。

**目标：让 Tomi 能操作外部工具，同时保证安全。**

## 2. 核心决策：不走自定义 http_call，直接走 MCP Client

### 为什么不自己造轮子

| | 自定义 http_call | MCP Client |
|---|---|---|
| Jira 创建 Issue | Agent 手动拼 JSON → 幻觉风险高 | 调 `jira_create_issue` → tool 定义已验证 |
| GitHub PR | Agent 记住 API 格式 | `github_create_pr` — 社区维护 |
| 安全性 | Agent 接触明文 Token | Token 只在服务端，Agent 不可见 |
| 生态 | 每个服务都要手写 | 直接继承开源 MCP Server |

**决策：Phase 1 就直接集成 MCP Client 协议。** 市面上已有成熟 MCP Server（github、jira、filesystem、postgres 等），TomiLite 只需做好 MCP Client 连接层。

## 3. 架构

```
┌──────────────────────────────────────────────────┐
│                Tomi Agent                         │
│                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │ shell_exec   │  │  mcp_call   │  │ 现有 DB    │ │
│  │ (受限白名单) │  │ (任意 MCP)  │  │ tool       │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┘ │
└─────────┼────────────────┼───────────────────────┘
          ▼                ▼
    ┌──────────┐    ┌──────────────────┐
    │ spawn()  │    │ MCP Client 连接池 │
    │ stdin 关 │    │ ┌──────────────┐ │
    │ cwd 受限 │    │ │ github MCP   │ │
    │ 进程组杀 │    │ │ jira MCP     │ │
    └────┬─────┘    │ │ filesystem   │ │
         ▼          │ │ postgres     │ │
    Claude Code CLI │ └──────────────┘ │
    git / npm       └──────────────────┘
```

## 4. Tool 设计

### 4.1 `shell_exec` — 受限命令行（只读白名单）

```typescript
{
  name: 'shell_exec',
  description: 'Execute a READ-ONLY shell command. Only whitelisted commands allowed. For git log, ls, cat, grep, find, wc, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string', description: 'Must be within workspace' }
    },
    required: ['command']
  }
}
```

**安全约束（Phase 1）：**

```typescript
// 只读白名单——除此之外一律拒绝
const READ_ONLY_WHITELIST = [
  /^git\s+(log|status|diff|show|branch|tag|rev-parse|config\s+--get)/,
  /^ls(\s|$)/, /^cat\s/, /^head\s/, /^tail\s/, /^wc\s/,
  /^grep\s/, /^find\s/, /^which\s/, /^pwd$/, /^echo\s/,
  /^node\s+-e\s/, /^npx\s+claude\s/,
];

// 多层 shell 嵌套禁止
const BLOCKED_PATTERNS = [
  /\|/, /`/, /\$\(/, /&&/, /\|\|/, /;/,        // 管道、命令替换、链式
  /bash/, /sh\s/, /zsh/, /exec/, /eval/,       // 子 shell
  /sudo/, /su\s/, /chmod/, /chown/,            // 权限提升
  /rm\s/, /mv\s/, /cp\s/, /mkdir/, /touch/,    // 文件修改
  />/, />>/, /<\s*\//,                          // 重定向
  /base64/, /xxd/, /openssl\s+enc/,            // 编码绕过
  /curl/, /wget/,                               // 网络请求（走 mcp_call）
];

function validateCommand(cmd: string, workspace: string, requestedCwd?: string): boolean {
  // 1. 白名单检查
  if (!READ_ONLY_WHITELIST.some(r => r.test(cmd))) return false;
  // 2. 黑名单检查
  if (BLOCKED_PATTERNS.some(r => r.test(cmd))) return false;
  // 3. cwd 必须在 workspace 内
  if (requestedCwd && !requestedCwd.startsWith(workspace)) return false;
  return true;
}
```

**防死锁执行：**

```typescript
import { spawn } from 'child_process';

async function shellExec(command: string, cwd: string, timeout = 30000) {
  if (!validateCommand(command, WORKSPACE_ROOT, cwd)) {
    return { code: -1, stdout: '', stderr: '❌ Blocked: command not in read-only whitelist or contains unsafe patterns.' };
  }

  return new Promise(resolve => {
    const proc = spawn(command, {
      cwd: cwd || WORKSPACE_ROOT,
      shell: true,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],  // stdin 关闭 → 需要交互的命令立即失败
    });

    let stdout = '', stderr = '';
    proc.stdout?.on('data', d => stdout += d);
    proc.stderr?.on('data', d => stderr += d);

    const timer = setTimeout(() => {
      // 杀整个进程组，不留僵尸
      try { process.kill(-proc.pid!, 'SIGKILL'); } catch {}
      resolve({ code: -1, stdout: stdout.slice(0, 8000), stderr: '⏱ Timeout' });
    }, timeout);

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 2000) });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: err.message });
    });
  });
}
```

### 4.2 `mcp_call` — MCP 协议调用（替代 http_call）

```typescript
{
  name: 'mcp_call',
  description: 'Call a tool from a connected MCP server. Token is injected server-side — Agent never sees credentials.',
  parameters: {
    type: 'object',
    properties: {
      server: { type: 'string', description: 'MCP server name (e.g. github, jira)' },
      tool: { type: 'string', description: 'Tool name as defined by the MCP server' },
      args: { type: 'string', description: 'JSON string of tool arguments' }
    },
    required: ['server', 'tool', 'args']
  }
}
```

**Token 脱敏执行：**

```typescript
async function mcpCall(server: string, tool: string, args: string) {
  // Agent 只传 server 名称，不知道 Token
  const integration = await prisma.integration.findFirst({
    where: { type: server, enabled: true }
  });
  if (!integration) return { error: `No integration configured for "${server}". Set it up in Settings.` };

  const config = JSON.parse(integration.config);
  const client = getMCPClient(server, config); // 从连接池获取

  // 后端注入 Token，Agent 全程不可见
  const result = await client.callTool(tool, JSON.parse(args));
  return { server, tool, result };
}
```

Agent 的 system prompt 只看到：
```
Connected services: github, jira
Use mcp_call(server, tool, args) to interact with them.
```

Agent 看不到任何 Token、API Key、Authorization header。所有凭据由后端从加密 DB 读取并注入。

## 5. 安全模型

### 5.1 三层防护

```
Layer 1: 白名单 + 黑名单（Phase 1）
  ├─ 只读命令 → 直接执行
  ├─ shell_exec 写命令 → 直接拒绝（Phase 2 才开放 + HITL）
  └─ mcp_call → 始终需要 HITL（外部操作不可逆）

Layer 2: 执行沙箱（Phase 1）
  ├─ stdin 关闭 → 交互命令立即失败
  ├─ cwd 限制在 workspace
  ├─ 进程组超时 kill(-SIGKILL)
  └─ 输出截断 8000 字符

Layer 3: Token 隔离（Phase 1）
  ├─ Agent 只传 server 名称
  ├─ 后端从加密 DB 读凭据
  └─ Agent 全程不接触明文 Token
```

### 5.2 Phase 演进

| Phase | shell_exec | mcp_call |
|-------|-----------|----------|
| Phase 1（本次）| 只读白名单，无 HITL | 读操作直接执行，写操作需 HITL |
| Phase 2（后续）| 写命令开放，带 HITL 弹窗 | 全部带 HITL 弹窗 |

## 6. HITL 确认流程

写入操作（Phase 2）调用链：

```
Agent 调 mcp_call({ server:'jira', tool:'create_issue', args:... })
  ↓
后端解析 → 评估风险 → medium/high
  ↓
生成 HITL Task → 推送到前端
  ↓
前端弹窗: "Agent 要通过 Jira 创建 Issue「Login crash」— 允许？"
  [Approve] [Deny]
  ↓
Approve → 执行 → 返回结果
Deny → 返回拒绝
```

复用现有 MCP HITL 机制（`apps/api/src/routers/mcp.ts`），不需要新建。

## 7. MCP Client 连接管理

```
服务启动时:
  1. 读取 Integration 表中所有 enabled 的服务
  2. 对每个服务建立 MCP Client 连接
  3. 调用 tools/list 发现可用工具
  4. 将工具列表注入 Agent system prompt

运行时:
  Agent 调 mcp_call → 从连接池取 client → 调 tool → 返回结果
  
连接池:
  - 每个 MCP Server 保持一个长连接
  - 断线自动重连（指数退避）
  - 30s 超时无响应 → 连接标记为降级
```

## 8. 改动清单（Phase 1）

| 文件 | 改动 |
|------|------|
| `agent.ts` | +1 tool（shell_exec 只读白名单）+1 tool（mcp_call） |
| `agent.ts` | executeAgentTool 新增 shellExec + mcpCall |
| `agent.ts` | 安全校验：白名单/黑名单/cwd 限制/stdin 关闭/进程组杀 |
| `mcp-client.ts`（新）| MCP Client 连接池 + 工具发现 + Token 注入 |
| Settings UI（新）| Integration 配置页面（MCP Server URL + Token） |
| 无前端 HITL | Phase 1 只读操作直接显示结果，Phase 2 加弹窗 |
