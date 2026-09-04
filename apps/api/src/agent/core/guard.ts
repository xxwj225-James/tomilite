import type { SSESender } from '../utils/sse.js';
import type { LLMConfig } from '../llm/client.js';
import { buildGuardPrompt, type GuardPromptContext } from '../prompts/guardPrompt.js';
import { isDeepseekEndpoint } from '../../lib/gateway.js';

// ─── Types ───

export interface GuardResult {
  intentHint: string;
  lastGuardRaw: string;
  needsWebSearch: boolean;
  guardIntent: string;
  cleanMsg: string;
}

// ─── Keyword pre-filter ───

/**
 * Classify user intent using a 2-phase approach:
 * Phase 1: Keyword pre-filter — catches explicit create patterns immediately.
 * Phase 2: Guard LLM — calls the small/flash model for precise intent classification.
 */
export async function classifyGuard(
  config: LLMConfig,
  message: string,
  context: GuardPromptContext,
  _send: SSESender,
): Promise<GuardResult> {
  let intentHint = '';
  let lastGuardRaw = '';
  let needsWebSearch = false;
  let guardIntent = '';

  // Strip context prefix brackets before analysis
  const cleanMsg = message
    .replace(/\[(Note editor|Task editor|New task|Report editor)[^\]]*\]/g, '')
    .replace(/\(unsaved\)/g, '')
    .trim();

  // Phase 1: Keyword pre-filter
  const isExplicitCreate =
    /^(创建|新建|create|new\s+(task|bug|issue|feature|story|note)|add\s+(task|bug)|write\s+(a|note)|帮.*(创建|写|加))/i.test(
      cleanMsg,
    ) || /创建|新建|create_/.test(cleanMsg.substring(0, 30));
  const wantsCreateNote =
    /(总结|写|做|记|新建|创建|建|加|生成|弄).{0,4}(笔记|note)/i.test(cleanMsg) ||
    /(笔记|note).{0,4}(总结|写|做|记)/i.test(cleanMsg);
  const wantsCreateTask =
    /(加|添|新建|创建|建|生成|弄|派).{0,3}(任务|task|bug|issue)/i.test(cleanMsg) ||
    /(任务|task).{0,3}(加|添|新建|创建|建)/i.test(cleanMsg);

  if (!isExplicitCreate && !wantsCreateNote && !wantsCreateTask) {
    needsWebSearch = true;
    intentHint =
      '\n[INTERNAL ROUTING (do NOT mention this to user): This is a conversation turn — the user is asking, discussing, or reviewing content. Reply directly in chat. The only tool relevant to general conversation is web_search: call it when the user asks for factual, recent, or real-time information (then answer from the results). Do NOT create tasks/notes/reports unless the user explicitly asks to save or create something.]';
  }

  // Editor action button bypass
  if (!intentHint && context.noteEditorOpen && message.includes('[Note editor action:')) {
    intentHint =
      '\n[INTERNAL ROUTING (do NOT mention this to user): Step 1: reply with a BRIEF change summary (what changed, why — 1-2 lines max). Step 2: call suggest_note_edit where content = ONLY the final note text (NO explanations inside content). The reply and the content are SEPARATE — never put explanations in the content field.]';
  }

  // Phase 2: Guard LLM classification (only for explicit create requests)
  if (!intentHint)
    try {
      const guardPrompt = buildGuardPrompt(message, context);
      const guardResp = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.flashModel,
          messages: [{ role: 'user', content: guardPrompt }],
          max_tokens: 200,
          temperature: 0,
          response_format: { type: 'json_object' },
          ...(config.baseUrl.includes('moonshot') || isDeepseekEndpoint(config.baseUrl)
            ? { thinking: { type: 'disabled' } }
            : {}),
          ...(config.baseUrl.includes('dashscope') ? { enable_thinking: false } : {}),
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (guardResp.ok) {
        const d = await guardResp.json();
        const o = d.choices?.[0]?.message?.content || '';
        lastGuardRaw = o;
        try {
          const p = JSON.parse(o);
          guardIntent = p.intent || '';
          if (p.webSearch === true) needsWebSearch = true;
          if (p.instruction) intentHint = `\n[INTERNAL ROUTING (do NOT mention this to user): ${p.instruction}]`;
        } catch {
          /* invalid JSON — ignore */
        }
      }
    } catch {
      intentHint =
        '\n[INTERNAL ROUTING: Guard model unavailable. Use the most appropriate tool for the user request. For creating tasks use create_issue. For notes use create_note. For general questions reply naturally.]';
    }

  return { intentHint, lastGuardRaw, needsWebSearch, guardIntent, cleanMsg };
}
