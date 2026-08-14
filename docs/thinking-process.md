# Thinking Process 显示 — 经验总结

## 架构概述

Agent 的思考过程通过 SSE (Server-Sent Events) 实时推送到前端，显示为可折叠的 "💭 Thinking..." 区域。

```
后端                                        前端
───────────────────────────────────────────────
streamLLM  →  SSE reasoning 事件  →  reasoningContent 累积
            →  SSE thinking 事件   →  轮次标题 "💭 Thinking... (round N)"
            →  SSE token 事件      →  正文内容逐字流式
            →  SSE tool_call 事件  →  🔧 工具名 + 参数
            →  SSE tool_result 事件→  ✅/❌ 结果
```

### 关键事件类型

| SSE 事件 | 用途 | 数据 |
|---------|------|------|
| `reasoning` | 思考内容（实时流式） | `{ text: "..." }` |
| `thinking` | 轮次标题 | `{ text: "...", iteration: N }` |
| `token` | 正文回复（逐字流式） | `{ text: "..." }` |
| `tool_call` | 工具调用 | `{ tool: "create_issue", args: "..." }` |
| `tool_result` | 工具结果 | `{ tool: "create_issue", result: {...} }` |

---

## 前端实现要点

### 1. 实时流式更新 React State

**错误做法**：累积到局部变量，流结束后一次性 setMessages
```ts
// ❌ 用户在整个流过程中看不到 thinking
let reasoningContent = '';
// ... 累积 ...
// 只在最后设置一次
setMessages(prev => { ... copy[assistantIdx] = { ...finalMsg }; });
```

**正确做法**：每次收到 reasoning/tool_call/tool_result 事件立即 setMessages
```ts
// ✅ 每收到一个事件就更新 UI
if (currentEvent === 'reasoning') {
  reasoningContent += data.text;
  setMessages(prev => {
    const copy = [...prev];
    copy[assistantIdx] = { ...copy[assistantIdx], reasoningContent };
    return copy;
  });
}
```

### 2. 思考区自动展开

```tsx
// Msg 组件中
const [thinkingOpen, setThinkingOpen] = useState(!!thinking);
// thinking=true 表示 Agent 正在处理 → 自动展开
// thinking=false → 默认折叠，用户可手动展开
```

### 3. 正文 token 也要流式

```ts
if (data.text) {
  fullText += String(data.text || '');
  setAgentStatus('');
  // 也要推送 text 到 UI！
  setMessages(prev => {
    const copy = [...prev];
    copy[assistantIdx] = { ...copy[assistantIdx], text: fullText };
    return copy;
  });
}
```

---

## 后端实现要点

### 1. Provider 差异处理

| Provider | 思考来源 | 处理方式 |
|----------|---------|---------|
| DeepSeek | `delta.reasoning_content`（原生字段） | 直接流式发送 |
| Qwen (DashScope) | `delta.content` 中的 `<thinking>` 标签 | 解析标签 → reasoning 事件 |
| OpenAI/Anthropic | 无 | 系统 prompt 注入 `<thinking>` 要求 |

```ts
// 检测函数
export function isQwenProvider(baseUrl: string): boolean {
  return baseUrl?.includes('dashscope');
}
export function supportsThinking(baseUrl: string): boolean {
  return baseUrl?.includes('deepseek');
}
```

### 2. `<thinking>` 标签处理 — 避免正文闪烁

**问题**：Qwen 的 `<thinking>` 内容是 `delta.content` 的一部分。如果直接当 token 发送，用户会在正文区看到思考文字一闪而过，然后在结束后被剥离。

**解决方案**：流式过程中实时检测 `<thinking>` 标签并分流

```ts
let inThinkingTag = false; // 状态机

// delta.content 到达时：
let chunk: string = delta.content;

while (chunk.length > 0) {
  if (!inThinkingTag) {
    const openIdx = chunk.toLowerCase().indexOf('<thinking>');
    if (openIdx < 0) {
      // 不在 thinking 内 → 正常发 token
      if (streamTokens) sendToken(send, chunk);
      break;
    }
    // 标签前的文字 → token
    if (openIdx > 0 && streamTokens) sendToken(send, chunk.substring(0, openIdx));
    inThinkingTag = true;
    chunk = chunk.substring(openIdx + '<thinking>'.length);
  } else {
    const closeIdx = chunk.toLowerCase().indexOf('</thinking>');
    if (closeIdx < 0) {
      // 仍在 thinking 内 → 路由到 reasoning
      reasoningBuf += chunk;
      // throttle flush...
      break;
    }
    // 标签前的文字 → reasoning
    if (closeIdx > 0) reasoningBuf += chunk.substring(0, closeIdx);
    inThinkingTag = false;
    chunk = chunk.substring(closeIdx + '</thinking>'.length);
  }
}
```

### 3. Reasoning 流式节流

**问题**：SSE delta 通常只有 1-3 个字符。逐个发送 reasoning 事件导致前端每个字显示为一行。

**解决方案**：攒到 40 字符或 150ms 再 flush

```ts
let reasoningBuf = '';
let reasoningTimer: ReturnType<typeof setTimeout> | null = null;

const flushReasoning = () => {
  if (reasoningBuf) { send('reasoning', { text: reasoningBuf }); reasoningBuf = ''; }
  if (reasoningTimer) { clearTimeout(reasoningTimer); reasoningTimer = null; }
};

// 每个 delta：
reasoningBuf += chunk;
if (reasoningBuf.length >= 40) {
  flushReasoning();
} else if (!reasoningTimer) {
  reasoningTimer = setTimeout(flushReasoning, 150);
}

// 流结束时：
flushReasoning();
```

### 4. Qwen Pre-Thinking 阶段

Qwen 需要先思考再行动，否则会跳过工具调用。

```ts
// 仅前 2 轮执行（后期质量下降）
if (iterations <= 2 && isQwenProvider(config.baseUrl) && activeTools.length > 0) {
  const tBody = {
    model, stream: true,
    messages: [...messages, {
      role: 'user',
      content: 'Think through this naturally in <thinking> tags, like thinking to yourself. Stop at </thinking>.'
    }],
    max_tokens: 1024,
    stop: ['</thinking>'],
  };
  // ... fetch and stream reasoning ...
}
```

Pre-thinking prompt 要点：
- 用自然语言，不要编号 1) 2) 3)
- 强调 "like thinking to yourself" 而非 "analyze and plan"
- 过滤低质量输出（< 20 字符、echo 指令本身）

```ts
const thinking = tC.replace(/<thinking>/gi, '').replace(/<\/thinking>/gi, '').trim();
// 过滤无效输出
if (thinking && thinking.length > 20
    && !thinking.includes('Analyze in <thinking>')
    && !thinking.includes('Stop at </thinking>')) {
  // 有效 — 推入 messages
}
```

### 5. 跨 chunk 标签碎片清理

SSE chunk 可能在 `<thinking>` 标签中间断开，flush 时需要清理残留：

```ts
const flushR = () => {
  // 去掉跨 chunk 的 <thinking> 标签碎片：<th, </thi, inking> 等
  const clean = rBuf.replace(/<\/?t(h(i(n(k(i(ng?)?)?)?)?)?)?>?/gi, '')
                     .replace(/^[a-z]*>/, '').trim();
  if (clean) send('reasoning', { text: clean });
  rBuf = '';
};
```

### 6. 尽早发送第一个事件

用户点击发送后，如果 Guard 分类 + Self-learning DB 查询需要 1-3 秒，期间前端无任何反馈。

```ts
// 在 Guard 之前就发送第一个 thinking 指示
sendToken(send, 'Thinking...');

// 然后才是耗时的操作
const guardResult = await classifyGuard(config, message, context, send);
const [learnHint, preferenceHint] = await Promise.all([getLearnHint(), getPreferenceHint()]);
```

---

## 常见问题与排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 思考内容在正文区一闪而过 | `<thinking>` 标签被当 token 发送 | 用状态机实时分流 |
| 思考内容逐字断行 | 每个 delta 都单独发 reasoning 事件 | 加 throttle (40char/150ms) |
| 流结束后思考才一次性出现 | reasoning 只累积局部变量不更新 React state | 每次收到事件立即 setMessages |
| 思考区不展开 | `thinkingOpen` 默认 false | `useState(!!thinking)` |
| 看到 `<th` `inking>` 碎片 | SSE chunk 在标签中间断开 | flush 时正则清理 |
| "Thinking..." 出现太晚 | Guard 跑完才发第一个事件 | 提前到 Guard 之前发 |
| Qwen thinking 输出 1) 2) 3) | prompt 用了 "step by step: 1)..." | 改用 "think naturally, like talking to yourself" |
| Qwen thinking 无内容 | 模型 echo 了指令/输出过短 | 过滤 <20 字符 + 检测 echo |
| 回复文本不流式 | token 事件只累积 fullText 不更新 state | 同 reasoning，每次 setMessages |
| 最终回复不流式 | intent-done confirm 用了 streamTokens=false | 改为 true |

---

## 文件索引

| 文件 | 职责 |
|------|------|
| `apps/api/src/agent/llm/client.ts` | `streamLLM` — SSE 解析、thinking 标签分流、reasoning 节流 |
| `apps/api/src/agent/core/agentEngine.ts` | Qwen pre-thinking、`sendThinking` 轮次标题 |
| `apps/api/src/agent/agentStream.ts` | 提前发 "Thinking..." 指示 |
| `apps/api/src/agent/utils/sse.ts` | `sendToken`, `sendReasoning`, `sendThinking` 等 helpers |
| `apps/web/src/App.tsx` | SSE 事件处理、reasoningContent 实时 setMessages、thinkingOpen 自动展开 |
