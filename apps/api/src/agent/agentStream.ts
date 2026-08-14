import type { IncomingMessage, ServerResponse } from 'node:http';
import { prisma } from '@tomatolite/database';
import { decrypt } from '../lib/crypto.js';

import { createSSESender, sendToken, sendDone, sendError } from './utils/sse.js';
import { agentLog } from './utils/logger.js';
import { getProxyUrl } from './utils/proxy.js';
import { getWorkspaceRoots } from './utils/shell.js';
import { DEFAULT_PROJECT_ID } from './utils/constants.js';

import type { LLMConfig } from './llm/client.js';
import { isQwenProvider } from './llm/client.js';

import { ALL_TOOLS, getActiveTools, type PruningContext } from './tools/registry.js';
import { executeAgentTool } from './tools/dispatcher.js';
import { getInjectedTools } from './mcp/inject.js';

import { classifyGuard } from './core/guard.js';
import { getLearnHint, getPreferenceHint } from './core/selfLearning.js';
import { buildSystemPrompt } from './prompts/systemPrompt.js';
import { runAgentLoop } from './core/agentEngine.js';

// ═══════════════════════════════════════════════════════════════════════════
// SSE Stream Handler — main entry point for AI agent interactions
// ═══════════════════════════════════════════════════════════════════════════
export async function handleAgentStream(req: IncomingMessage, res: ServerResponse) {
  // ─── Parse JSON body ───
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  let body: any;
  try { body = JSON.parse(raw); } catch (e: any) { console.error('[AgentStream] JSON parse failed, raw length:', raw.length, 'error:', e.message); res.writeHead(400); res.end('Invalid JSON: ' + e.message); return; }
  const { message, history = [], panelContext = null, remainingTokens = 8000, lang = 'en' } = body;

  // ─── Context detection from message prefix ───
  const noteEditorOpen = message.startsWith('[Note editor OPEN:');
  const unsavedNote = noteEditorOpen && message.includes('(unsaved)');
  const taskEditorOpen = message.startsWith('[Task editor OPEN:');
  const newTaskFormOpen = message.startsWith('[New task form OPEN:');
  const reportEditorOpen = message.startsWith('[Report editor OPEN:');
  const reportsPanelOpen = message.startsWith('[Reports panel OPEN') || panelContext === 'reports';
  const notesPanelOpen = panelContext === 'notes';
  const tasksPanelOpen = panelContext === 'tasks';

  // ─── SSE headers ───
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const send = createSSESender(res);

  // ─── Force-create flow ───
  if (message.startsWith('__FORCE_CREATE__')) {
    try {
      const jsonStart = message.indexOf('{');
      if (jsonStart < 0) throw new Error('No JSON found in force-create message');
      const args = JSON.parse(message.slice(jsonStart));
      // Load config for force-create (no Guard or self-learning needed)
      const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
      if (!provider?.apiKey) { sendError(send, 'No API key configured.'); res.end(); return; }
      const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
      const apiKey = await decrypt(provider.apiKey);
      const cfg = await prisma.llmConfig.findFirst();
      const baseUrl = master?.apiBaseUrl || '';
      const model = cfg?.proModel || cfg?.flashModel || '';
      if (!baseUrl || !apiKey) { sendError(send, 'LLM not configured.'); res.end(); return; }
      sendToken(send, 'Creating...');
      // Force-create: call the right tool directly (skipping dedup)
      const cardType = args._type || args.type;
      if (cardType === 'task' || cardType === 'bug' || cardType === 'story') {
        const result = await executeAgentTool('force_create_issue', args);
        send('tool_call', { tool: 'force_create_issue', args: JSON.stringify(args) });
        send('tool_result', { tool: 'force_create_issue', result });
        sendDone(send, `✅ Created: ${(result as any)?.key || 'done'}`, 1, remainingTokens);
      } else if (cardType === 'note') {
        const result = await executeAgentTool('force_create_note', args);
        send('tool_call', { tool: 'force_create_note', args: JSON.stringify(args) });
        send('tool_result', { tool: 'force_create_note', result });
        sendDone(send, `✅ Note created: ${(result as any)?.title || 'done'}`, 1, remainingTokens);
      } else if (cardType === 'report') {
        const result = await executeAgentTool('force_create_report', args);
        send('tool_call', { tool: 'force_create_report', args: JSON.stringify(args) });
        send('tool_result', { tool: 'force_create_report', result });
        sendDone(send, `✅ Report created: ${(result as any)?.title || 'done'}`, 1, remainingTokens);
      } else {
        sendError(send, 'Unknown force-create type: ' + cardType);
      }
    } catch (e: any) {
      sendError(send, 'Force-create failed: ' + e.message);
    }
    res.end();
    return;
  }

  try {
    // ─── Load LLM config from DB ───
    const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
    if (!provider?.apiKey) { sendError(send, 'No API key configured. Go to Settings → 🤖 LLM.'); res.end(); return; }
    const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
    const cfg = await prisma.llmConfig.findFirst();
    const baseUrl = master?.apiBaseUrl || '';
    const model = cfg?.proModel || cfg?.flashModel || '';
    const flashModel = cfg?.flashModel || model;
    if (!baseUrl || !model) { sendError(send, 'LLM not fully configured. Check Settings → 🤖 LLM.'); res.end(); return; }

    // Send thinking indicator immediately — user sees activity during Guard/Self-learning
    // Spinner in UI already indicates activity — no need to send text

    const config: LLMConfig = {
      baseUrl,
      apiKey: await decrypt(provider.apiKey),
      model,
      flashModel,
      remainingTokens,
      maxOutputTokens: cfg?.maxOutputTokens || undefined,
      proxy: getProxyUrl() || undefined,
    };

    const context = { lang, unsavedNote, noteEditorOpen, taskEditorOpen, newTaskFormOpen, reportEditorOpen, notesPanelOpen, tasksPanelOpen, reportsPanelOpen };

    // ─── Guard: intent classification ───
    const guardResult = await classifyGuard(config, message, context, send);

    // ─── Self-learning: past mistakes + preferences ───
    const [learnHint, preferenceHint] = await Promise.all([getLearnHint(), getPreferenceHint()]);

    // ─── Build system prompt ───
    const systemPrompt = buildSystemPrompt({
      ...context,
      preferenceHint,
      learnHint,
      intentHint: guardResult.intentHint,
      workspaceRoots: getWorkspaceRoots(),
      baseUrl: config.baseUrl,
      model: config.model,
    });

    // ─── Build tools (with pruning) ───
    const pruningCtx: PruningContext = {
      noteEditorOpen, taskEditorOpen, newTaskFormOpen, reportEditorOpen,
      isQwen: isQwenProvider(config.baseUrl),
    };
    const activeTools = getActiveTools(ALL_TOOLS, pruningCtx);
    // Merge MCP-injected tools from connected servers (never throws)
    const injectedTools = await getInjectedTools();
    const allActiveTools = [...activeTools, ...injectedTools];

    // ─── Build message list ───
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((h: any) => {
        if (h.role === 'assistant' && h.reasoning_content && (!config.baseUrl?.includes('deepseek') || !h.tool_calls || h.tool_calls.length === 0)) {
          const { reasoning_content, ...rest } = h;
          return rest;
        }
        return h;
      }),
      { role: 'user', content: message },
    ];

    // ─── Run agent loop ───
    const result = await runAgentLoop(config, messages, allActiveTools, send, context, guardResult);
    sendDone(send, result.content, result.iterations, remainingTokens);
  } catch (e: any) {
    console.error('[AgentStream] Error:', e.message);
    sendError(send, e.message);
  }
  res.end();
}
