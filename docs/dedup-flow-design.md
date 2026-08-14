# 任务创建去重流程 v2 — 交互按钮方案

## 1. 当前状态

### 1.1 已正确实现的部分

| 模块 | 文件 | 状态 |
|------|------|------|
| `executeAgentTool` — create_issue/force_create_issue 纯创建 | `agent.ts` | ✅ 正确 |
| Agent Loop — 拦截 create_issue 做 DB 查重 | `agent.ts` | ✅ 正确 |
| 服务端 SSE 事件发送 (tool_call/tool_result) | `agent.ts` | ✅ 正确 |
| `scripts/test-sse-debug.js` — 独立测试前端处理逻辑 | 测试脚本 | ✅ 通过 |

### 1.2 存在的问题

| 问题 | 现象 | 可能原因 |
|------|------|----------|
| `data.tool && data.args` 从未为 true | 前端从未执行 tool_call 处理代码 | SSE 事件解析层（粘包/半包/JSON.parse 静默失败） |
| 用户确认"强制创建"后 LLM 行为不确定 | Agent 有时调 suggest_issue_edit，有时不调 | LLM 缺乏强状态约束 |

## 2. 目标流程

```
用户: "创建任务：Debug UI交互"
│
▼
LLM 调 create_issue("Debug UI交互", desc, priority...)
│
▼
Agent Loop 拦截 → DB 查重 → 有重复 → 返回 blocked
│
▼
前端收到 { blocked: true, duplicates: [...], pendingArgs: {...} }
│
▼
┌─────────────────────────────────────────────┐
│  聊天中渲染交互卡片：                         │
│                                             │
│  ⚠️ 发现 9 个相似任务                        │
│  TL-40 Debug UI...     todo                 │
│  TL-41 debug UI...     todo                 │
│  ...                                        │
│                                             │
│  [💥 强行创建]   [取消]                       │
└─────────────────────────────────────────────┘
│                    │
▼                    ▼
用户点"强行创建"      用户点"取消"
│                    │
▼                    ▼
前端直接调           追加 "已取消" 消息
force_create_issue   不做任何创建
(写DB → 出卡片)
```

## 3. 需要的改动

### 3.1 服务端：blocked 响应里加上 `pendingArgs`

`apps/api/src/routers/agent.ts` — Agent Loop 拦截处：

```typescript
if (dups.length > 0) {
    send('tool_result', {
        tool: tc.name,
        result: {
            blocked: true,
            duplicates: dups.map(i => ({...})),
            pendingArgs: args,   // ← 新增：用户点"强行创建"时原样回传
        }
    });
    continue;
}
```

### 3.2 前端：收到 blocked 渲染交互按钮

`apps/web/src/App.tsx` — `data.tool && data.result` 处理块：

```typescript
if (data.tool === 'create_issue' && r.blocked) {
    // 不构建普通卡片，构建带按钮的 blocked 卡片
    msgCard = {
        type: 'task',
        blocked: true,
        duplicates: r.duplicates,
        pendingArgs: r.pendingArgs,  // 供按钮回调使用
    };
}
```

`Msg` 组件渲染 blocked 卡片时显示按钮：
```jsx
{card.blocked && (
    <div>
        {card.duplicates.map(d => <div>{d.key} {d.title}</div>)}
        <button onClick={() => handleForceCreate(card.pendingArgs)}>
            💥 强行创建
        </button>
        <button onClick={() => handleCancelDedup()}>
            取消
        </button>
    </div>
)}
```

### 3.3 前端：按钮回调直接调 API

```typescript
const handleForceCreate = (args) => {
    // 方式 A：通过 agent 流接口发送 force 指令
    sendMessage(`__FORCE_CREATE__ ${JSON.stringify(args)}`);
    
    // 方式 B：直接调后端 force_create_issue（需要暴露为独立接口）
    // fetch('/api/issue.create', { body: JSON.stringify({...args, force: true}) })
};

const handleCancelDedup = () => {
    // 追加一条系统消息表示取消
    setMessages(prev => [...prev, { role: 'assistant', text: '已取消创建。' }]);
};
```

### 3.4 服务端：识别 `__FORCE_CREATE__` 前缀

`apps/api/src/routers/agent.ts` — 在 Agent Loop 开始处：

```typescript
// 检测前端发来的强制创建指令（支持 task/note/report）
if (message.startsWith('__FORCE_CREATE__')) {
    const args = JSON.parse(message.slice(18));
    const tool = args._tool || 'force_create_issue';
    delete args._tool;
    const r = await executeAgentTool(tool, args);
    send('tool_result', { tool, result: r });
    send('done', { content: '✅ 强制创建成功' });
    res.end();
    return;
}
```

### 3.5 工具分层：`create_*` vs `force_create_*`

LLM 可直接调用两类工具：

| 工具 | 去重 | 用途 |
|------|------|------|
| `create_issue` / `create_note` / `create_report` | ✅ 走去重 | 正常创建。有重复 → blocked 卡片 |
| `force_create_issue` / `force_create_note` / `force_create_report` | ❌ 跳过 | 用户确认强制创建时使用 |

**调用路径：**

```
create_* → Agent Loop 去重 → 无重复 → 创建成功卡片
                           → 有重复 → blocked 卡片 → 用户确认 → force_create_* → 直接创建
```

LLM 判断逻辑：用户首次创建用 `create_*`，用户坚持/确认用 `force_create_*`。

## 4. 用户不点按钮、输入文字的处理

### 4.1 场景

blocked 卡片显示了 `[💥 强行创建] [取消]` 按钮，但用户**不点按钮**，自己打字：

| 用户输入 | 期望行为 |
|----------|----------|
| "继续" / "yes" / "强制创建" / "行吧那就建吧" / "不管了建" | LLM 分类为 confirm → 等同点击"强行创建" |
| "算了" / "取消" / "别建了" / "还是不要了" / "no" | LLM 分类为 cancel → 等同点击"取消" |
| "改成 Debug UI v2" / "帮我查下 TL-40" | LLM 分类为 other → 正常传给 Agent，卡片保留 |

### 4.2 实现

使用 `agent.classifyIntent`（flash 模型，~1s）做语义分类，替代正则关键词匹配。

**为什么用 LLM 而不是正则？** 正则太死板，"行吧那就建吧"/"还是算了我不要了" 等自然语言无法覆盖。LLM 能理解语义意图。

```typescript
const lastCard = messages[messages.length - 1]?.card;
if (lastCard?.blocked && lastCard?.pendingArgs) {
  // LLM semantic classification: confirm / cancel / other
  const { intent } = await api.agent.classifyIntent({ message: q, cardType: lastCard.type });
  if (intent === 'confirm') {
    // 等同点击"强行创建"按钮 → 直接调 __FORCE_CREATE__，不经过 Agent LLM
    forceCreateRef.current = lastCard.pendingArgs;
    sendMessage('__FORCE_CREATE__ ' + JSON.stringify(lastCard.pendingArgs));
    return;
  }
  if (intent === 'cancel') {
    // 等同点击"取消"按钮 → 标记卡片 resolved + 追加"已取消"消息
    ...
    return;
  }
  // intent === 'other' → 正常发给 Agent，卡片保留作上下文
}
```

### 4.3 决策树

```
用户输入文字
│
├─ 最后一条消息有 blocked 卡片？
│   │
│   ├─ YES → LLM 语义分类 intent
│   │   ├─ "confirm" → 自动转 __FORCE_CREATE__（等同点按钮）
│   │   ├─ "cancel"  → 标记卡片 resolved + "已取消"
│   │   └─ "other"   → 正常发给 Agent，卡片保留作上下文
│   │
│   └─ NO  → 正常流程
```

### 4.4 对比总结

| 维度 | 实现 |
|------|------|
| 状态标记 | 直接读 `card.blocked` + `card.pendingArgs`，无需额外字段 |
| 意图判断 | LLM `classifyIntent` 语义分类（confirm/cancel/other），不依赖正则 |
| confirm 路径 | 前端直接调 `__FORCE_CREATE__`，完全不经过 Agent LLM |
| cancel 路径 | 前端标记卡片 `resolved` + 按钮置灰 + 追加"已取消" |
| other 路径 | 正常发给 Agent LLM，blocked 卡片保留在聊天中作上下文 |
| 按钮失效 | 卡片 `resolved` 后按钮自动置灰不可点击，无需手动清理 |

## 5. SSE 解析 Bug 排查（独立问题）

`data.tool && data.args` 从未触发的问题需要在 **修改业务逻辑之前** 先排查。

### 排查步骤

1. 安装当前包（已含 `[KEYS:]` 调试），创建任务
2. 看聊天内容里是否有 `[KEYS:tool_call tool,args t=true a=true]`
3. 如果看到 → 解析正常，问题在后面的 `if` 判断逻辑
4. 如果没看到 → `JSON.parse` 静默失败了

### 如果是 JSON.parse 失败

当前代码用 `line.slice(6)` 硬切 `data: ` 前缀。如果 SSE 数据格式不是严格的 `data: {...}`（例如有空格、换行符嵌入、粘包），`JSON.parse` 抛异常，`catch {}` 吞掉。

**修复**：增强解析容错——

```typescript
const raw = line.slice(line.indexOf(':') + 1).trim();  // 不硬编码 6
if (raw.startsWith('{')) {
    try { data = JSON.parse(raw); } catch { continue; }
}
```

## 6. 实施顺序

| 优先级 | 步骤 | 说明 |
|--------|------|------|
| P0 | 排查 SSE 解析 bug | `[KEYS:]` 调试确认问题层级 |
| P1 | 修复 SSE 解析（如需要） | 容错化 JSON.parse |
| P2 | blocked 响应加 pendingArgs | 服务端一行改动 |
| P3 | 前端渲染交互按钮 | blocked 卡片 + 两个按钮 |
| P4 | 前端按钮回调 → force_create | `__FORCE_CREATE__` 前缀 |
| P5 | 用户不点按钮、打字的处理 | 检查最后消息 card.blocked，确认词自动转 force |
| P6 | 验证完整闭环 | 创建→拦截→按钮/打字→创建成功→卡片 |
