import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { getProvider } from '@/lib/llmProviders';
import { estimateTokens } from '@/lib/tokenEstimate';

// ═══ Context-window budget: max tokens from provider + estimated usage of current session ═══
export function useTokenUsage(messages: any[]) {
  const [maxTokens, setMaxTokens] = useState(100000);
  const refreshContextWindow = () => {
    api.llm.getConfig().then((d: any) => {
      const provider = d?.activeProvider?.providerId || 'deepseek';
      const pw = (getProvider(provider)?.contextWindow || 128000);
      setMaxTokens(pw);
    }).catch(() => {});
  };
  useEffect(() => { refreshContextWindow(); }, []);
  useEffect(() => {
    const handler = () => { refreshContextWindow(); };
    window.addEventListener('tl-llm-config-changed', handler);
    return () => window.removeEventListener('tl-llm-config-changed', handler);
  }, []);
  const currentTokens = useMemo(() => {
    // estimateTokens skips running tasks (partial content) for token counting
    const raw = estimateTokens(messages);
    // System prompt + tool defs are cached by LLM APIs (DeepSeek/OpenAI/Claude auto-cache, Qwen dashscope caches)
    // They don't consume context window on subsequent requests — don't reserve budget for them
    const CACHED_OVERHEAD = 3000; // system prompt ~2.5K + tool defs ~0.5K
    return Math.max(0, raw - CACHED_OVERHEAD);
  }, [messages]);
  // ─── Debug: token display testing via browser console ───
  // window.__tl_debug__.tokenOverride = 70000   // pretend currentTokens is 70k
  // window.__tl_debug__.tokenMultiplier = 10    // multiply real estimate
  // window.__tl_debug__.forceShow = true        // always show bar
  // window.__tl_debug__.reset()                 // clear all overrides
  const [debugTokenOverride, setDebugTokenOverride] = useState<number | null>(null);
  const [debugForceShow, setDebugForceShow] = useState(false);
  useEffect(() => {
    const win = window as any;
    win.__tl_debug__ = {
      get tokenOverride() { return debugTokenOverride; },
      set tokenOverride(v: number | null) { setDebugTokenOverride(v); },
      get forceShow() { return debugForceShow; },
      set forceShow(v: boolean) { setDebugForceShow(v); },
      tokenMultiplier: 1,
      reset() { setDebugTokenOverride(null); setDebugForceShow(false); win.__tl_debug__.tokenMultiplier = 1; },
    };
  }, [debugTokenOverride, debugForceShow]);
  const displayTokens = debugTokenOverride ?? (currentTokens * ((window as any).__tl_debug__?.tokenMultiplier || 1));

  return { maxTokens, currentTokens, displayTokens, debugForceShow };
}
