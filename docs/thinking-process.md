# Thinking Process Display — Lessons Learned

## Architecture Overview

The Agent's thinking process is pushed to the frontend in real time over SSE (Server-Sent Events), displayed in a collapsible "💭 Thinking..." area.

```
Backend                                      Frontend
───────────────────────────────────────────────
streamLLM  →  SSE reasoning event  →  reasoningContent accumulated
            →  SSE thinking event   →  round title "💭 Thinking... (round N)"
            →  SSE token event      →  body content streamed char by char
            →  SSE tool_call event  →  🔧 tool name + args
            →  SSE tool_result event→  ✅/❌ result
```

### Key Event Types

| SSE Event     | Purpose                                | Data                                      |
| ------------- | -------------------------------------- | ----------------------------------------- |
| `reasoning`   | Thinking content (real-time streaming) | `{ text: "..." }`                         |
| `thinking`    | Round title                            | `{ text: "...", iteration: N }`           |
| `token`       | Body reply (streamed char by char)     | `{ text: "..." }`                         |
| `tool_call`   | Tool invocation                        | `{ tool: "create_issue", args: "..." }`   |
| `tool_result` | Tool result                            | `{ tool: "create_issue", result: {...} }` |

---

## Frontend Implementation Notes

### 1. Real-Time Streaming Updates to React State

**Wrong approach**: accumulate in a local variable and call setMessages once after the stream ends

```ts
// ❌ user can't see thinking during the whole stream
let reasoningContent = '';
// ... accumulate ...
// only set once at the end
setMessages(prev => { ... copy[assistantIdx] = { ...finalMsg }; });
```

**Correct approach**: call setMessages immediately on every reasoning/tool_call/tool_result event

```ts
// ✅ update the UI on every received event
if (currentEvent === 'reasoning') {
  reasoningContent += data.text;
  setMessages((prev) => {
    const copy = [...prev];
    copy[assistantIdx] = { ...copy[assistantIdx], reasoningContent };
    return copy;
  });
}
```

### 2. Auto-Expand the Thinking Area

```tsx
// in the Msg component
const [thinkingOpen, setThinkingOpen] = useState(!!thinking);
// thinking=true means the Agent is processing → auto-expand
// thinking=false → collapsed by default, user can expand manually
```

### 3. Body Tokens Must Stream Too

```ts
if (data.text) {
  fullText += String(data.text || '');
  setAgentStatus('');
  // push the text to the UI too!
  setMessages((prev) => {
    const copy = [...prev];
    copy[assistantIdx] = { ...copy[assistantIdx], text: fullText };
    return copy;
  });
}
```

---

## Backend Implementation Notes

### 1. Handling Provider Differences

| Provider         | Thinking Source                          | Handling                                               |
| ---------------- | ---------------------------------------- | ------------------------------------------------------ |
| DeepSeek         | `delta.reasoning_content` (native field) | Stream directly                                        |
| Qwen (DashScope) | `<thinking>` tags in `delta.content`     | Parse tags → reasoning events                          |
| OpenAI/Anthropic | None                                     | Inject `<thinking>` requirement into the system prompt |

```ts
// detection functions
export function isQwenProvider(baseUrl: string): boolean {
  return baseUrl?.includes('dashscope');
}
export function supportsThinking(baseUrl: string): boolean {
  return baseUrl?.includes('deepseek');
}
```

### 2. `<thinking>` Tag Handling — Avoiding Body Flicker

**Problem**: Qwen's `<thinking>` content is part of `delta.content`. If sent as tokens directly, users see the thinking text flash in the body area, then get stripped out at the end.

**Solution**: detect `<thinking>` tags in real time during streaming and route them separately

```ts
let inThinkingTag = false; // state machine

// when delta.content arrives:
let chunk: string = delta.content;

while (chunk.length > 0) {
  if (!inThinkingTag) {
    const openIdx = chunk.toLowerCase().indexOf('<thinking>');
    if (openIdx < 0) {
      // not inside thinking → send as normal tokens
      if (streamTokens) sendToken(send, chunk);
      break;
    }
    // text before the tag → token
    if (openIdx > 0 && streamTokens) sendToken(send, chunk.substring(0, openIdx));
    inThinkingTag = true;
    chunk = chunk.substring(openIdx + '<thinking>'.length);
  } else {
    const closeIdx = chunk.toLowerCase().indexOf('</thinking>');
    if (closeIdx < 0) {
      // still inside thinking → route to reasoning
      reasoningBuf += chunk;
      // throttle flush...
      break;
    }
    // text before the tag → reasoning
    if (closeIdx > 0) reasoningBuf += chunk.substring(0, closeIdx);
    inThinkingTag = false;
    chunk = chunk.substring(closeIdx + '</thinking>'.length);
  }
}
```

### 3. Reasoning Streaming — Main Stream Flushes Immediately

**Problem**: SSE deltas are usually only 1-3 characters. Batching them before flushing would make the frontend UI laggy.

**Current behavior** (`apps/api/src/agent/llm/client.ts`): the main `streamLLM` does **NOT** throttle reasoning. Every `delta.reasoning_content` (DeepSeek) or accumulated `<thinking>` tag content (Qwen) is sent as a `reasoning` event immediately — no buffer, no timer. The frontend coalesces the updates in React state.

### 4. Qwen Pre-Thinking Phase

Qwen needs to think before acting, otherwise it skips tool calls. This is the **only** place that throttles reasoning: it buffers into `rBuf` and flushes when the buffer reaches **30 chars or 150ms** (`apps/api/src/agent/core/agentEngine.ts`, lines ~130-135).

```ts
// only run for the first 2 rounds (quality degrades later)
if (iterations <= 2 && isQwenProvider(config.baseUrl) && activeTools.length > 0) {
  const tBody = {
    model,
    stream: true,
    messages: [
      ...messages,
      {
        role: 'user',
        content: 'Think through this naturally in <thinking> tags, like thinking to yourself. Stop at </thinking>.',
      },
    ],
    max_tokens: 1024,
    stop: ['</thinking>'],
  };
  // ... fetch and stream reasoning ...
  // on each delta:  rBuf += chunk;
  //                 if (rBuf.length >= 30) flushR();
  //                 else if (!rTimer) rTimer = setTimeout(flushR, 150);
}
```

Pre-thinking prompt key points:

- Use natural language; no numbered 1) 2) 3) lists
- Emphasize "like thinking to yourself" rather than "analyze and plan"
- Filter low-quality output (< 20 chars, echoing the instruction itself)

```ts
const thinking = tC
  .replace(/<thinking>/gi, '')
  .replace(/<\/thinking>/gi, '')
  .trim();
// filter invalid output
if (
  thinking &&
  thinking.length > 20 &&
  !thinking.includes('Analyze in <thinking>') &&
  !thinking.includes('Stop at </thinking>')
) {
  // valid — push into messages
}
```

### 5. Cross-Chunk Tag-Fragment Cleanup

SSE chunks can break mid-`<thinking>` tag; clean up residue when flushing:

```ts
const flushR = () => {
  // strip cross-chunk <thinking> tag fragments like <th, </thi, inking>
  const clean = rBuf
    .replace(/<\/?t(h(i(n(k(i(ng?)?)?)?)?)?)?>?/gi, '')
    .replace(/^[a-z]*>/, '')
    .trim();
  if (clean) send('reasoning', { text: clean });
  rBuf = '';
};
```

### 6. Send the First Event ASAP

After the user hits send, if Guard classification + self-learning DB queries take 1-3 seconds, the frontend shows no feedback during that time.

```ts
// send the first thinking indicator before Guard
sendToken(send, 'Thinking...');

// then the time-consuming operations
const guardResult = await classifyGuard(config, message, context, send);
const [learnHint, preferenceHint] = await Promise.all([getLearnHint(), getPreferenceHint()]);
```

---

## Common Problems & Troubleshooting

| Symptom                                     | Cause                                                                     | Fix                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Thinking text flashes in the body area      | `<thinking>` tags sent as tokens                                          | Route in real time with a state machine                                          |
| Thinking text broken into one char per line | A reasoning event sent for every delta                                    | Qwen pre-thinking buffers (30 chars / 150ms); main streamLLM flushes immediately |
| Thinking appears only after the stream ends | reasoning only accumulates in a local variable, never updates React state | Call setMessages on every received event                                         |
| Thinking area doesn't expand                | `thinkingOpen` defaults to false                                          | `useState(!!thinking)`                                                           |
| Seeing `<th` `inking>` fragments            | SSE chunk broke mid-tag                                                   | Regex cleanup on flush                                                           |
| "Thinking..." appears too late              | First event only sent after Guard finishes                                | Send it before Guard                                                             |
| Qwen thinking outputs 1) 2) 3)              | Prompt used "step by step: 1)..."                                         | Switch to "think naturally, like talking to yourself"                            |
| Qwen thinking is empty                      | Model echoed the instruction / output too short                           | Filter <20 chars + detect echo                                                   |
| Reply text doesn't stream                   | token events only accumulate fullText, never update state                 | Same as reasoning — setMessages on every event                                   |
| Final reply doesn't stream                  | intent-done confirmation used streamTokens=false                          | Change to true                                                                   |

---

## File Index

| File                                     | Responsibility                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `apps/api/src/agent/llm/client.ts`       | `streamLLM` — SSE parsing, thinking-tag routing, reasoning throttling      |
| `apps/api/src/agent/core/agentEngine.ts` | Qwen pre-thinking, `sendThinking` round titles                             |
| `apps/api/src/agent/agentStream.ts`      | Sends the "Thinking..." indicator early                                    |
| `apps/api/src/agent/utils/sse.ts`        | Helpers: `sendToken`, `sendReasoning`, `sendThinking`, etc.                |
| `apps/web/src/hooks/useSendMessage.ts`   | SSE event handling, real-time setMessages for reasoningContent persistence |
