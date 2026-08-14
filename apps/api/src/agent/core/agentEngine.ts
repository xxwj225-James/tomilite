import { prisma } from '@tomatolite/database';
import type { SSESender } from '../utils/sse.js';
import { sendToken, sendToolCall, sendToolResult, sendThinking, sendReasoning } from '../utils/sse.js';
import { agentLog } from '../utils/logger.js';
import { DEFAULT_PROJECT_ID, MAX_ITERATIONS } from '../utils/constants.js';

import type { LLMConfig } from '../llm/client.js';
import { streamLLMWithRetry, isQwenProvider } from '../llm/client.js';
import { toolLabels } from '../tools/registry.js';
import { executeAgentTool } from '../tools/dispatcher.js';
import type { GuardResult } from './guard.js';
import type { AgentContext } from '../prompts/systemPrompt.js';

// ─── Dedup helpers ───

interface DedupTarget {
  model: string; // 'issue' | 'knowledgePage' | 'report'
  resultKey: (item: any) => string;
  resultTitle: (item: any) => string;
}

function getDedupTarget(toolName: string): DedupTarget {
  if (toolName === 'create_issue') {
    return {
      model: 'issue',
      resultKey: (i: any) => 'TL-' + i.issueNumber,
      resultTitle: (i: any) => i.title,
    };
  }
  if (toolName === 'create_note') {
    return {
      model: 'knowledgePage',
      resultKey: (p: any) => p.id?.substring(0, 8) || '',
      resultTitle: (p: any) => p.title,
    };
  }
  return {
    model: 'report',
    resultKey: (r: any) => r.id?.substring(0, 8) || '',
    resultTitle: (r: any) => r.title,
  };
}

async function checkDedup(
  toolName: string,
  args: Record<string, any>,
  _config: LLMConfig,
  send: SSESender,
  messages: any[],
  tcId: string,
): Promise<boolean> {
  if (!args.title) return false;

  const target = getDedupTarget(toolName);
  const modelAny = prisma as any;
  const findMany = modelAny[target.model]?.findMany as ((opts: any) => Promise<any[]>) | undefined;
  if (!findMany) return false;

  // Exact title match — no LLM, no fuzzy matching
  const where: any = toolName === 'create_report'
    ? { title: args.title }
    : { projectId: DEFAULT_PROJECT_ID, title: args.title };

  const dups = await findMany({ where, take: 5 });
  if (dups.length === 0) return false;

  const label = toolName === 'create_issue' ? 'Task' : toolName === 'create_note' ? 'Note' : 'Report';
  sendToolResult(send, toolName, {
    blocked: true,
    duplicates: dups.map((d: any) => ({ key: target.resultKey(d), title: d.title, status: d.status || d.category || d.reportType || '', priority: d.priority || '', description: (d.description || d.content || '').substring(0, 200) })),
    pendingArgs: args,
  });
  const dupKeys = dups.map((d: any) => target.resultKey(d)).join(', ');
  messages.push({ role: 'tool', tool_call_id: tcId, content: JSON.stringify({ blocked: true, duplicates: dups.map((d: any) => ({ key: target.resultKey(d), title: d.title })) }) });
  messages.push({ role: 'user', content: `⚠️ ${label} already exists (${dupKeys}). Do NOT try to create it again. Reply to the user.` });
  return true;
}

// ─── Agent ReAct Loop ───

export async function runAgentLoop(
  config: LLMConfig,
  messages: any[],
  activeTools: any[],
  send: SSESender,
  context: AgentContext,
  guardResult: GuardResult,
): Promise<{ content: string; iterations: number }> {
  const { needsWebSearch, guardIntent, lastGuardRaw, cleanMsg } = guardResult;
  const { unsavedNote, noteEditorOpen, taskEditorOpen, newTaskFormOpen } = context;
  const isQwen = isQwenProvider(config.baseUrl);
  let fullContent = '';
  let iterations = 0;
  const calledTools = new Set<string>();
  let createdKeys: string[] = [];
  let hadError = false;
  let exportSucceeded = false; // set when export_to_* returns ok:true — reliable hallucination guard
  let llmResponded = false; // set after first LLM response — suppress SYSTEM CHECKs after that

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    sendThinking(send, 'Thinking...', iterations);

    // Qwen: think-only stage before tools (only first 2 iterations — quality degrades after)
    if (iterations <= 2 && isQwenProvider(config.baseUrl) && activeTools.length > 0) {
      try {
        const tBody = { model: config.model, stream: true, messages: [...messages, { role: 'user', content: 'Think through this naturally in <thinking> tags, like thinking to yourself. What does the user need? How should you help? Stop at </thinking>.' }], max_tokens: 1024, stop: ['</thinking>'] };
        const tResp = await fetch(config.baseUrl + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey }, body: JSON.stringify(tBody), signal: AbortSignal.timeout(30000) });
        if (tResp.ok) {
          const tReader = tResp.body?.getReader();
          if (tReader) {
            let tC = ''; let tBuf = ''; const tD = new TextDecoder();
            let rBuf = ''; let rTimer: ReturnType<typeof setTimeout> | null = null;
            const flushR = () => {
              // Strip <thinking> tag fragments that span SSE chunk boundaries
              const clean = rBuf.replace(/<\/?t(h(i(n(k(i(ng?)?)?)?)?)?)?>?/gi, '').replace(/^[a-z]*>/, '').trim();
              if (clean) { send('reasoning', { text: clean }); }
              rBuf = '';
              if (rTimer) { clearTimeout(rTimer); rTimer = null; }
            };
            while (true) {
              const r = await tReader.read();
              if (r.done) { flushR(); break; }
              tBuf += tD.decode(r.value, { stream: true });
              const lines = tBuf.split('\n');
              tBuf = lines.pop() || '';
              for (const line of lines) {
                if (!line.startsWith('data: ') || line.slice(6).trim() === '[DONE]') continue;
                try {
                  const d = JSON.parse(line.slice(6)).choices?.[0]?.delta;
                  if (d?.content) {
                    tC += d.content;
                    const chunk = d.content.replace(/<thinking>/gi, '').replace(/<\/thinking>/gi, '');
                    if (chunk.trim()) {
                      rBuf += chunk;
                      if (rBuf.length >= 30) { flushR(); }
                      else if (!rTimer) { rTimer = setTimeout(flushR, 150); }
                    }
                  }
                } catch (_) { /* skip */ }
              }
            }
            const thinking = tC.replace(/<thinking>/gi, '').replace(/<\/thinking>/gi, '').trim();
            if (thinking && thinking.length > 20 && !thinking.includes('Analyze in <thinking>') && !thinking.includes('Stop at </thinking>')) { messages.push({ role: 'assistant', content: '<thinking>' + thinking + '</thinking>' }); messages.push({ role: 'user', content: 'Now act. Call the right tool or write your answer.' }); }
          }
        }
      } catch (_) { /* falls through to normal flow */ }
    }

    const result = await streamLLMWithRetry(config, messages, activeTools, send);
    fullContent = result.content || fullContent;
    if (result.reasoningContent && result.toolCalls.length > 0) {
      sendReasoning(send, result.reasoningContent);
    }

    if (result.toolCalls.length === 0) {
      // ─── Hallucination guard (6-stage post-execution validation) ───
      // Each guard fires at most once: llmResponded is set before continue to prevent re-injection.
      const expectedTool = unsavedNote || noteEditorOpen ? 'suggest_note_edit' : (taskEditorOpen || newTaskFormOpen) ? 'suggest_issue_edit' : null;
      // #1: editor form open but suggest_*_edit not called
      if (!llmResponded && expectedTool && !calledTools.has(expectedTool)) {
        const userAskedToEdit = messages[0]?.content?.includes('编辑') || messages[0]?.content?.includes('修改') || messages[0]?.content?.includes('更新') || messages[0]?.content?.includes('edit') || messages[0]?.content?.includes('update') || messages[0]?.content?.includes('change');
        if (userAskedToEdit || unsavedNote) {
          llmResponded = true;
          sendToken(send, 'Correcting...');
          messages.push({ role: 'user', content: `⚠️ SYSTEM CHECK: You did NOT call ${expectedTool}. The user wants to modify the open form. Call ${expectedTool} with the complete content.` });
          continue;
        }
      }
      // #2-4: Guard intent vs. actual tool calls
      const parsedGuard = (() => { try { return JSON.parse(lastGuardRaw || '{}').intent; } catch { return ''; } })();
      if (!llmResponded) {
        if (parsedGuard === 'create_task' && !calledTools.has('create_issue') && !calledTools.has('force_create_issue')) {
          llmResponded = true;
          agentLog('[Hallucination] Guard said create_task but no create_issue called');
          sendToken(send, 'Correcting...');
          messages.push({ role: 'user', content: '⚠️ SYSTEM CHECK: The user asked to create a task. You MUST call create_issue tool with the title and details. Do NOT reply with text — call the tool first, then reply.' });
          continue;
        }
        if (parsedGuard === 'create_note' && !calledTools.has('create_note') && !calledTools.has('force_create_note')) {
          llmResponded = true;
          agentLog('[Hallucination] Guard said create_note but no create_note called');
          sendToken(send, 'Correcting...');
          messages.push({ role: 'user', content: '⚠️ SYSTEM CHECK: The user asked to create a note. You MUST call create_note tool with the title and content. Do NOT reply with text — call the tool first, then reply.' });
          continue;
        }
        if (parsedGuard === 'edit_note' && !calledTools.has('suggest_note_edit')) {
          llmResponded = true;
          agentLog('[Hallucination] Guard said edit_note but no suggest_note_edit called');
          sendToken(send, 'Correcting...');
          messages.push({ role: 'user', content: '⚠️ SYSTEM CHECK: The user wants to edit a note. You MUST call suggest_note_edit tool with the complete content. Do NOT reply with text — call the tool first, then reply.' });
          continue;
        }
      }
      // #5: export/report request but no matching tool called
      const isExportRequest = /导出|export/i.test(cleanMsg);
      const askedForReport = !isExportRequest && (cleanMsg.includes('报告') || cleanMsg.includes('report') || cleanMsg.includes('日报') || cleanMsg.includes('周报'));
      if (!llmResponded) {
        if (askedForReport) {
          llmResponded = true;
          agentLog('[Hallucination] User asked for report but no create_report called');
          sendToken(send, 'Correcting...');
          messages.push({ role: 'user', content: '⚠️ SYSTEM CHECK: The user asked to create a report. You MUST call create_report tool with the title and content. Do NOT reply with text — call the tool first, then reply.' });
          continue;
        }
        if (isExportRequest) {
          llmResponded = true;
          agentLog('[Hallucination] User asked to export but no export tool called');
          sendToken(send, 'Correcting...');
          messages.push({ role: 'user', content: '⚠️ SYSTEM CHECK: The user asked to export to Excel/Word. You MUST call export_to_excel or export_to_doc. First use list_reports to find the report UUID, then call the export tool. Do NOT just say "done" — actually CALL the tool.' });
          continue;
        }
      }
      // Any iteration: if export/report was requested but never actually succeeded — fire once
      if (!llmResponded && isExportRequest && !exportSucceeded) {
        llmResponded = true;
        agentLog('[Hallucination] Export requested but no export tool returned ok:true');
        sendToken(send, 'Correcting...');
        messages.push({ role: 'user', content: '⚠️ The export has NOT been completed yet. You must call export_to_excel or export_to_doc with the correct reportId and get ok:true before confirming.' });
        continue;
      }
      // #6: web search needed but not called
      if (!llmResponded && needsWebSearch && !isQwen && !calledTools.has('web_search')) {
          llmResponded = true;
          agentLog('[Hallucination] Guard said webSearch but no web_search called');
          sendToken(send, 'Correcting...');
          messages.push({ role: 'user', content: '⚠️ SYSTEM CHECK: This question requires current information. You MUST call web_search FIRST with a relevant query, then answer based on the results. Do NOT just talk about searching — actually CALL the tool now.' });
          continue;
        }
      // #7: hallucination guard — parsedGuard intent mismatch + text fallback
      if (!llmResponded && calledTools.size === 0) {
        const parsedIntent = (() => { try { return JSON.parse(lastGuardRaw || '{}').intent; } catch { return ''; } })();
        if (['create_task', 'create_note', 'edit_note'].includes(parsedIntent)) {
          const toolMap: Record<string, string> = { create_task: 'create_issue', create_note: 'create_note', edit_note: 'suggest_note_edit' };
          llmResponded = true;
          agentLog(`[Hallucination] Guard=${parsedIntent} but no tool called`);
          sendToken(send, 'Correcting...');
          messages.push({ role: 'user', content: `SYSTEM CHECK: Guard classified as "${parsedIntent}" but NO tool called. Call ${toolMap[parsedIntent]}. Do NOT fake a result.` });
          continue;
        }
        // Fallback: text claims success (✅ + TL-/created/创建/作成) but no tool called
        if (/✅|📄|📋|📊/.test(result.content) && /TL-|创建|created|作成/.test(result.content)) {
          llmResponded = true;
          agentLog('[Hallucination] Text claims success but no tool called');
          sendToken(send, 'Correcting...');
          messages.push({ role: 'user', content: 'SYSTEM CHECK: Reply claims success but NO tool called. Call create_issue/create_note/create_report.' });
          continue;
        }
      }
      break;
    }

    // Editor guard: suppress spurious create_* calls when editor form is open
    const editorExpectedTool = unsavedNote || noteEditorOpen ? 'suggest_note_edit' : (taskEditorOpen || newTaskFormOpen) ? 'suggest_issue_edit' : null;
    if (editorExpectedTool) {
      const spuriousCreates = result.toolCalls.filter((tc: any) =>
        ['create_issue', 'force_create_issue', 'create_note', 'force_create_note', 'create_report', 'force_create_report'].includes(tc.name)
      );
      const hasExpectedSuggest = result.toolCalls.some((tc: any) => tc.name === editorExpectedTool);
      if (spuriousCreates.length > 0 && hasExpectedSuggest) {
        result.toolCalls = result.toolCalls.filter((tc: any) => !spuriousCreates.includes(tc));
        messages.push({ role: 'user', content: `⚠️ SYSTEM: Ignored ${spuriousCreates.map((tc: any) => tc.name).join(', ')} — form is open, only ${editorExpectedTool} is appropriate here.` });
        if (result.toolCalls.length === 0) continue;
      }
    }

    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: result.content || '',
      ...(result.reasoningContent ? { reasoning_content: result.reasoningContent } : {}),
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id, type: 'function',
        function: { name: tc.name, arguments: tc.args },
      })),
    });

    // Execute tools with dedup
    for (const tc of result.toolCalls) {
      calledTools.add(tc.name);
      try {
        // Qwen malformed JSON repair
        let argsStr = tc.args;
        try { JSON.parse(argsStr); } catch (e1: any) {
          agentLog('[JSON] parse failed for', tc.name + ':', e1.message, '| raw:', argsStr.substring(0, 200));
          argsStr = argsStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
          argsStr = argsStr.replace(/,(\s*[}\]])/g, '$1');
          if (e1.message.includes('Unterminated string') && !argsStr.endsWith('"}')) {
            argsStr += '"}'; // close the last string + object — preserves content (API max_tokens truncation)
          }
          if (!argsStr.endsWith('}')) argsStr += '}';
          try { JSON.parse(argsStr); } catch (e2: any) {
            agentLog('[JSON] repair also failed:', e2.message);
          }
        }
        const args = JSON.parse(argsStr);

        // Dedup for create_issue / create_note / create_report
        if ((tc.name === 'create_issue' || tc.name === 'create_note' || tc.name === 'create_report') && args.title) {
          const blocked = await checkDedup(tc.name, args, config, send, messages, tc.id);
          if (blocked) continue;
        }

        // Normal execution
        const fixedName = toolLabels[tc.name] ? tc.name : Object.keys(toolLabels).find(k => k.replace(/_/g, '') === tc.name.replace(/_/g, '')) || tc.name;
        sendToolCall(send, fixedName, tc.args);
        const r = await executeAgentTool(fixedName, args);
        agentLog('[Tool]', fixedName, 'result keys:', Object.keys(r || {}).join(','), 'error:', (r as any)?.error || 'none');
        sendToolResult(send, fixedName, r);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(r) });
        if ((r as any)?.key) createdKeys.push((r as any).key);
        else if ((r as any)?.id && (tc.name === 'create_note' || tc.name === 'force_create_note')) createdKeys.push('Note:' + (r as any).id.substring(0, 8));
        // Track export success via return value — reliable, not text heuristics
        if ((tc.name === 'export_to_excel' || tc.name === 'export_to_doc') && (r as any)?.ok) exportSucceeded = true;

        // ─── Post-execution: detect empty search results and guide fallback ───
        if (tc.name === 'list_reports' && Array.isArray(r) && (r as any[]).length === 0 && args.query) {
          messages.push({ role: 'user', content: `SYSTEM: list_reports found nothing. Instead of retrying, use search_local_data to do a full-text search across all local data. Then tell the user what you found. Do NOT output tool names as text — actually CALL the tool.` });
        }

        // Error recovery hints
        const errMsg = (r && typeof r === 'object' && 'error' in r) ? (r as Record<string, unknown>).error : null;
        if (typeof errMsg === 'string') {
          hadError = true;
          const hints: Record<string, string> = {
            'Unknown tool': 'Use one of the available tools. To find notes: search_notes or search_local_data. To find reports: list_reports. To find issues: list_issues or get_issue.',
            'Report not found': 'Use list_reports to get the correct UUID (NOT the title). If list_reports returns nothing, try search_local_data for fuzzy matching. Only give up if BOTH fail.',
            'not found': 'LIST issues first to find the correct issueNumber, then retry.',
            'permission denied': 'Check workspace roots and retry with an allowed path.',
            'no task editor': 'STOP using suggest_issue_edit. Use create_issue for new tasks or update_issue(issueNumber=N) for existing ones.',
            'no note editor': 'STOP using suggest_note_edit. Use create_note for new notes or update_note for existing ones.',
            'no report editor': 'STOP using suggest_report_edit. Use create_report for new reports — it saves directly to DB.',
            'Invalid JSON': 'Your tool arguments contain invalid JSON. Simplify the content — use plain text without special characters, quotes, or markdown. Keep it short.',
            'Unexpected token': 'Your tool arguments contain invalid JSON. Simplify the content — use plain text without special characters, quotes, or markdown. Keep it short.',
          };
          const hint = Object.entries(hints).find(([k]) => errMsg.toLowerCase().includes(k))?.[1] || 'Check the error and retry with corrected parameters.';
          messages.push({ role: 'user', content: `⚠️ ${tc.name} failed: ${errMsg}. ${hint}` });
        }
      } catch (e: any) {
        send('tool_result', { tool: tc.name, error: e.message });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: e.message }) });
        messages.push({ role: 'user', content: `⚠️ ${tc.name} threw an exception: ${e.message}. Retry with corrected input or use a different approach.` });
      }
    }

    if (result.toolCalls.length > 0) llmResponded = true; // LLM took real action
    // Qwen intent-done shortcut
    if (result.toolCalls.length > 0 && !hadError && isQwenProvider(config.baseUrl)) {
      const intentDone = (guardIntent === 'create_task' && (calledTools.has('create_issue') || calledTools.has('force_create_issue'))) ||
                         (guardIntent === 'create_note' && (calledTools.has('create_note') || calledTools.has('force_create_note'))) ||
                         (calledTools.size > 0 && !guardIntent);
      if (intentDone) {
        const keyList = createdKeys.length > 0 ? createdKeys.join(', ') : 'it';
        messages.push({ role: 'user', content: keyList + ' created. Reply to confirm — no more tools needed.' });
        const confirmResult = await streamLLMWithRetry(config, messages, [], send, true);
        fullContent = confirmResult.content || fullContent;
        break;
      }
    }
  }

  // Force summary if max iterations reached
  if (iterations >= MAX_ITERATIONS && !fullContent) {
    sendToken(send, 'Summarizing...');
    messages.push({ role: 'user', content: 'Please provide a final response summarizing what you\'ve found or done. Be concise.' });
    const { content: final } = await streamLLMWithRetry(config, messages, activeTools, send, true);
    fullContent = final || fullContent;
  }

  return { content: fullContent, iterations };
}
