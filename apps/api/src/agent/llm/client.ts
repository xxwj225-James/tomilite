import { sendToken, type SSESender } from '../utils/sse.js';
import { agentLog } from '../utils/logger.js';

// ─── Types ───

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  flashModel: string;
  remainingTokens: number;
  maxOutputTokens?: number; // reserved, not currently used (providerMaxTokens handles limits)
  proxy?: string; // HTTP proxy URL for API calls (e.g. http://127.0.0.1:7890)
}

export interface LLMResult {
  content: string;
  reasoningContent: string;
  toolCalls: Array<{ id: string; name: string; args: string }>;
}

// ─── Provider detection ───

/** Returns true if the baseUrl belongs to a Qwen/DashScope compatible API */
export function isQwenProvider(baseUrl: string): boolean {
  return baseUrl?.includes('dashscope');
}

/** Returns true if the provider supports native thinking mode (DeepSeek only) */
export function supportsThinking(baseUrl: string): boolean {
  return baseUrl?.includes('deepseek');
}

// ─── Streaming LLM client ───

/**
 * Streams a single LLM call via SSE (fetch + ReadableStream).
 * Accumulates text content, reasoning_content, and tool call chunks.
 * Sends 'token', 'reasoning' SSE events to the frontend in real-time.
 * Also handles JSON auto-repair for truncated tool arguments (Qwen fix).
 * Provider-specific: enables thinking mode for DeepSeek/Qwen.
 */
export async function streamLLM(
  config: LLMConfig,
  messages: any[],
  toolsList: any[],
  send: SSESender,
  streamTokens = true,
): Promise<LLMResult> {
  const { baseUrl, apiKey, model, remainingTokens, proxy } = config;
  // Proxy only for foreign providers (OpenAI/Anthropic). Domestic (DeepSeek/Qwen/Kimi) go direct.
  const needsProxy = proxy && (baseUrl?.includes('openai') || baseUrl?.includes('anthropic'));
  const fetchOpts: any = {};
  if (needsProxy) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional dep loaded lazily
      const { ProxyAgent } = require('undici');
      fetchOpts.dispatcher = new ProxyAgent(proxy);
    } catch { /* undici not available */ }
  }
  const providerMaxTokens = !baseUrl?.includes('deepseek') ? 8192 : 16000;
  const body: Record<string, unknown> = { model, stream: true, messages, max_tokens: Math.min(remainingTokens, providerMaxTokens) };
  if (toolsList.length > 0) { body.tools = toolsList; body.tool_choice = 'auto'; }
  if (baseUrl?.includes('deepseek')) {
    body.thinking = { type: 'enabled' };
  } else if (baseUrl?.includes('dashscope')) {
    // Qwen3.x: enable thinking + parallel tool calls
    // Qwen3.8-max is thinking-only (reasoning_effort), 3.7-plus supports both modes
    body.enable_thinking = true;
    body.parallel_tool_calls = true;
    delete body.tool_choice; // Qwen: tool_choice suppresses reasoning_content
  }
  // OpenAI/Anthropic: standard params only — no extra fields needed
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    ...fetchOpts,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(()=>'');
    const msgSummary = messages.map((m: any) =>
      `${m.role}${m.tool_calls ? '+tc(' + m.tool_calls.length + ')' : ''}${m.tool_call_id ? '(id=' + m.tool_call_id.substring(0,8) + ')' : ''}`
    ).join(' → ');
    console.error('[LLM] API error', resp.status, '| messages:', messages.length, '| chain:', msgSummary, '| body:', errText.substring(0, 500));
    throw new Error(`API error ${resp.status}: ${errText.substring(0, 100)}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No stream response');

  let content = '';
  let reasoningContent = '';
  let inThinkingTag = false; // suppress token output inside <thinking> blocks
  let reasoningBuf = ''; // flushed immediately via flushReasoning()
  const flushReasoning = () => {
    if (reasoningBuf) { send('reasoning', { text: reasoningBuf }); reasoningBuf = ''; }
  };
  const tcMap: Record<number, { id?: string; name?: string; args: string }> = {};
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) { flushReasoning(); break; }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6).trim();
      if (d === '[DONE]') continue;
      try {
        const json = JSON.parse(d);
        const delta = json.choices?.[0]?.delta;
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!tcMap[idx]) tcMap[idx] = { args: '' };
            if (tc.id) tcMap[idx].id = tc.id;
            if (tc.function?.name) tcMap[idx].name = tc.function.name;
            if (tc.function?.arguments) tcMap[idx].args += tc.function.arguments;
          }
        }
        if (delta?.content) {
          let chunk: string = delta.content;
          content += chunk;
          // Route <thinking> blocks to reasoning during streaming — avoid flicker in main text area
          while (chunk.length > 0) {
            if (!inThinkingTag) {
              const openIdx = chunk.toLowerCase().indexOf('<thinking>');
              if (openIdx < 0) { flushReasoning(); if (streamTokens) sendToken(send, chunk); break; }
              if (openIdx > 0) { flushReasoning(); if (streamTokens) sendToken(send, chunk.substring(0, openIdx)); }
              inThinkingTag = true;
              chunk = chunk.substring(openIdx + '<thinking>'.length);
            } else {
              const closeIdx = chunk.toLowerCase().indexOf('</thinking>');
              if (closeIdx < 0) {
                reasoningBuf += chunk;
                flushReasoning();
                break;
              }
              if (closeIdx > 0) { reasoningBuf += chunk.substring(0, closeIdx); flushReasoning(); }
              inThinkingTag = false;
              chunk = chunk.substring(closeIdx + '</thinking>'.length);
            }
          }
        }
        if (delta?.reasoning_content) {
          reasoningContent += delta.reasoning_content;
          reasoningBuf += delta.reasoning_content;
          flushReasoning(); // immediate — prevent content from appearing before reasoning
        }
      } catch { /* skip malformed SSE lines */ }
    }
  }
  // Final flush
  flushReasoning();

  let toolCalls = Object.values(tcMap).filter(tc => tc.name && tc.id) as Array<{ id: string; name: string; args: string }>;

  // Build alias map: v4-pro drops underscores, apply to ALL tool calls
  const KNOWN_TOOLS = new Set(toolsList.map((t: any) => t.function.name));
  const toolAliases: Record<string, string> = {};
  for (const name of KNOWN_TOOLS) {
    const noUnderscore = name.replace(/_/g, '');
    if (noUnderscore !== name) toolAliases[noUnderscore] = name;
  }
  for (const tc of toolCalls) {
    if (!KNOWN_TOOLS.has(tc.name) && toolAliases[tc.name]) tc.name = toolAliases[tc.name];
  }

  // v4-pro thinking mode: function calls output as text
  if (toolCalls.length === 0) {
    toolAliases['forcecreateissue'] = 'force_create_issue';
    toolAliases['forcecreatenote'] = 'force_create_note';
    toolAliases['forcecreatereport'] = 'force_create_report';
    const foundCalls: Array<{ id: string; name: string; args: string }> = [];
    const removeRanges: Array<[number, number]> = [];
    let searchFrom = 0;
    while (true) {
      const jsonIdx = content.indexOf('{"', searchFrom);
      if (jsonIdx < 0) break;
      let depth = 0, endIdx = -1;
      for (let i = jsonIdx; i < content.length; i++) {
        if (content[i] === '{') depth++;
        if (content[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
      }
      if (endIdx <= jsonIdx) break;
      const jsonStr = content.substring(jsonIdx, endIdx + 1);
      try {
        JSON.parse(jsonStr); // validate
        const before = content.substring(0, jsonIdx);
        const fnMatch = before.match(/(\w[\w_]*)\s*$/);
        const rawName = fnMatch?.[1] || '';
        const resolvedName = KNOWN_TOOLS.has(rawName) ? rawName : toolAliases[rawName] || '';
        const validCall = fnMatch && resolvedName && (() => {
          if (fnMatch.index === undefined) return false;
          const beforeFn = before.substring(0, fnMatch.index);
          if (beforeFn.length === 0 || beforeFn.endsWith('\n')) return true;
          return /(?:Using\s+|🔧\s*)$/.test(beforeFn);
        })();
        if (validCall) {
          foundCalls.push({ id: 'v4-' + (Date.now() + foundCalls.length), name: resolvedName, args: jsonStr });
          removeRanges.push([fnMatch.index ?? 0, endIdx]);
        }
      } catch { /* not valid JSON */ }
      searchFrom = endIdx + 1;
    }
    if (foundCalls.length > 0) {
      toolCalls = foundCalls;
      let clean = content;
      for (let i = removeRanges.length - 1; i >= 0; i--) {
        clean = clean.substring(0, removeRanges[i][0]) + clean.substring(removeRanges[i][1] + 1);
      }
      content = clean.trim();
    }
  }
  if (toolCalls.length > 0) content = content.replace(/\{[\s\S]*?"(title|description|content|status)"[\s\S]*?\}/g, '').trim();

  // Strip <thinking> tags from content, accumulate into reasoningContent
  content = content.replace(/<thinking>([\s\S]*?)<\/thinking>\s*/gi, (_m: string, thinking: string) => {
    if (!reasoningBuf) reasoningContent = (reasoningContent ? reasoningContent + '\n' : '') + thinking.trim();
    return '';
  }).trim();
  // Reasoning was already streamed chunk-by-chunk via flushReasoning() — don't resend as blob
  agentLog('[streamLLM] model=' + model + ' reasoningLen=' + reasoningContent.length + ' contentLen=' + content.length + ' toolCalls=' + toolCalls.length);
  send('debug', { model, reasoningLen: reasoningContent.length, contentLen: content.length, toolCalls: toolCalls.length, tools: toolCalls.map(tc => tc.name) });
  return { content, reasoningContent, toolCalls };
}

/**
 * Streams LLM with automatic retry on failure (up to 3 attempts with exponential backoff).
 */
export async function streamLLMWithRetry(
  config: LLMConfig,
  messages: any[],
  toolsList: any[],
  send: SSESender,
  streamTokens = true,
): Promise<LLMResult> {
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await streamLLM(config, messages, toolsList, send, streamTokens); }
    catch (e: any) {
      lastError = e;
      if (attempt < 2) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
