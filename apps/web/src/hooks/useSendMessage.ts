import { useRef, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import { dispatchUICommand, useUICommandStore } from '@/stores/uiCommandStore';
import type { ChatCard } from '@/types/chat';
import type { ChatHook } from './useChatThreads';

// Pre-flight: instant panel navigation for explicit OPEN commands only.
// Does NOT open panel for create commands — agent handles creation, C Plan cards show results.
export function preFlightPanel(msg: string): string | null {
  const m = msg.trim();
  if (/^(打开|open)\s*(task|任务).*一[览栏]/.test(m)) return 'tasks';
  if (/^(打开|open)\s*(note|笔记).*一[览栏]/.test(m)) return 'notes';
  if (/^(打开|open)\s*TL-(\d+)/i.test(m)) return 'tasks';
  if (/^(打开|open)\s*(report|报告)/i.test(m)) return 'reports';
  if (/^(打开|open)\s*(email|邮件|邮箱|メール)/i.test(m)) return 'email';
  return null;
}

// ═══ Send message: SSE streaming, force-create, blocked-card intent, staged edits, editor context ═══
export function useSendMessage({
  chatHook,
  saveMsg,
  currentSessionId,
  query,
  setQuery,
  maxTokens,
  currentTokens,
  llmConfigured,
  setLlmConfigured,
  editingNote,
  editingTask,
  editingReportRef,
  panel,
  setPanel,
  handleApplyEdit,
  bumpNote,
  bumpTask,
  bumpReport,
  bumpEmail,
  attachedFiles,
  setAttachedFiles,
  setAppliedEdit,
  setAppliedTaskEdit,
  setAppliedReport,
  compressing,
}: {
  chatHook: ChatHook;
  saveMsg: (msg: any) => Promise<any>;
  currentSessionId: string;
  query: string;
  setQuery: (q: string) => void;
  maxTokens: number;
  currentTokens: number;
  llmConfigured: boolean;
  setLlmConfigured: (v: boolean) => void;
  editingNote: { id?: string; title: string; content: string; category: string } | null;
  editingTask: {
    issueNumber?: number;
    title: string;
    description: string;
    status: string;
    priority: string;
    storyPoints?: number;
    editing?: boolean;
  } | null;
  editingReportRef: RefObject<{ title: string; content: string; id?: string } | null>;
  panel: string | null;
  setPanel: (p: string | null) => void;
  handleApplyEdit: (staged: any) => void;
  bumpNote: () => void;
  bumpTask: () => void;
  bumpReport: () => void;
  bumpEmail: () => void;
  attachedFiles: Array<{ name: string; size: number; content: string }>;
  setAttachedFiles: Dispatch<SetStateAction<Array<{ name: string; size: number; content: string }>>>;
  setAppliedEdit: (e: any) => void;
  setAppliedTaskEdit: (e: any) => void;
  setAppliedReport: (e: any) => void;
  compressing: boolean;
}) {
  const lang = useLang();
  const messages = chatHook.messages;
  const setMessages = chatHook.setMessages;
  const lastToolArgsRef = useRef<string>('');
  const cardRef = useRef<ChatCard | undefined>(undefined);
  const forceCreateRef = useRef<any>(null); // pending force-create args // survive stream end
  const forceAssistantIdxRef = useRef<number>(0); // pre-computed assistantIdx for text-confirm force-create
  const sendMessageRef = useRef<(payload?: string, noteActionPayload?: string) => void>(undefined);
  const streamingThreadRef = useRef<string>(''); // locked threadId during active stream
  // thinking/agentStatus are derived in App (messages.some(status==='running')) — local no-ops keep SSE code verbatim
  const setThinking = (_v: boolean) => {};
  const setAgentStatus = (_v: string) => {};

  const stopStream = () => {
    // Find running message in current session and abort its controller.
    // Uses sessionsDataRef (always-current) to handle multi-session concurrency.
    const sid = chatHook.activeSessionId;
    const msgs = chatHook.sessionsDataRef.current[sid]?.messages || [];
    const running = msgs.find((m: any) => m && m.status === 'running');
    if (running?.controller) {
      running.controller.abort();
    }
    streamingThreadRef.current = '';
    setThinking(false);
    setAgentStatus('');
    // Truncate partial assistant message with interrupt marker + persist
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant') {
        const updated = { ...last, text: (last.text || '') + '\n\n---\n⏸️ *' + t('chat.interrupted', lang) + '*' };
        copy[copy.length - 1] = updated;
        // Save interrupted message to DB (use addMessage — updateMessage would fail if record doesn't exist yet)
        api.chat
          .addMessage({
            id: updated.id,
            sessionId: currentSessionId,
            role: updated.role,
            text: updated.text,
            card: updated.card ? JSON.stringify(updated.card) : undefined,
            reasoningContent: updated.reasoningContent,
          })
          .catch(() => {});
      }
      return copy;
    });
  };

  const sendMessage = async (forcePayload?: string, noteActionPayload?: string) => {
    // Block sending while context compression is running — the compress full-replace would wipe the new message
    if (compressing) return;
    cardRef.current = undefined; // reset cardRef for new message
    // Lock thread — all setMessages + saveMsg in this stream write to THIS thread
    const lockedSid = chatHook.activeSessionId;
    const setMessages = chatHook.getMessagesSetter(lockedSid);
    streamingThreadRef.current = lockedSid;
    // If forcePayload is a normal chip message, set it as query for display
    if (forcePayload && !forcePayload.startsWith('__FORCE_CREATE__')) {
      setQuery(forcePayload);
    }
    // ─── Force-create: only for __FORCE_CREATE__ internal messages ───
    if (
      forcePayload?.startsWith('__FORCE_CREATE__') ||
      (query.trim() === '__FORCE_CREATE__' && forceCreateRef.current)
    ) {
      const pendingArgs = forceCreateRef.current;
      const msg = forcePayload || `__FORCE_CREATE__ ${JSON.stringify(pendingArgs)}`;
      forceCreateRef.current = null;
      setQuery('');
      // Don't show __FORCE_CREATE__ as user message — it's internal, LLM would echo it
      setThinking(true);
      setAgentStatus(t('chat.thinking', lang));
      const preIdx = forceAssistantIdxRef.current;
      forceAssistantIdxRef.current = 0;
      const assistantIdx = preIdx || messages.length;
      // Send directly — server detects __FORCE_CREATE__ prefix
      const controller = new AbortController();
      if (!preIdx) {
        setMessages((prev) => [...prev, { role: 'assistant' as const, text: '', status: 'running', controller }]);
      }
      let forceSuccess = false;
      try {
        const resp = await fetch('/api/agent/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            history: messages
              .filter((m) => m && m.text && (m as any).status !== 'running')
              .map((m) => {
                const e: any = { role: m.role, content: m.text };
                if (m?.reasoningContent) e.reasoning_content = m?.reasoningContent;
                return e;
              }),
            remainingTokens: Math.max(1000, maxTokens - currentTokens),
            lang,
          }),
          signal: controller.signal,
        });
        if (resp.ok) {
          // Read the stream to get the result
          const reader = resp.body?.getReader();
          if (reader) {
            const decoder = new TextDecoder();
            let buffer = '',
              fullText = '',
              currentEvent = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (line.startsWith('event:')) {
                  currentEvent = line.slice(6).trim();
                  continue;
                }
                if (!line.startsWith('data:')) continue;
                const raw = line.slice(5).trim();
                if (!raw.startsWith('{')) continue;
                try {
                  const data = JSON.parse(raw);
                  if (currentEvent === 'error') {
                    fullText = data.message || t('misc.forceCreateFailed', lang);
                    break;
                  }
                  if (data.text) fullText += String(data.text || '');
                  if (currentEvent === 'done') {
                    if (data.content) fullText += (fullText ? '\n' : '') + data.content;
                    forceSuccess = true;
                  }
                  if (currentEvent === 'error') {
                    fullText = data.message || t('misc.forceCreateFailed', lang);
                  }
                  if (currentEvent === 'debug') {
                    fullText += `\n\n🔍 **LLM Debug** | model: \`${data.model}\` | reasoning: ${data.reasoningLen} chars | content: ${data.contentLen} chars | toolCalls: ${data.toolCalls}${data.tools?.length ? ' [' + data.tools.join(', ') + ']' : ''}`;
                  }
                  if (data.tool && data.result) {
                    const r = data.result;
                    if (data.tool === 'force_create_note' && r.id) {
                      fullText += `\n\n> 📄 ${r.title || 'Untitled'}${r.category ? ` · \`${r.category}\`` : ''}`;
                      const card: ChatCard = {
                        type: 'note',
                        id: r.id,
                        title: r.title || '',
                        category: r.category || 'general',
                        content: pendingArgs?.content || '',
                      };
                      const msgId = crypto.randomUUID();
                      setMessages((prev) => {
                        const copy = [...prev];
                        copy[assistantIdx] = {
                          ...copy[assistantIdx],
                          role: 'assistant',
                          text: fullText,
                          card,
                          id: msgId,
                        };
                        return copy;
                      });
                      saveMsg({ id: msgId, role: 'assistant', text: fullText, card, _sessionId: lockedSid } as any);
                      bumpNote();
                      forceSuccess = true;
                    } else if (data.tool === 'force_create_report' && r.id) {
                      fullText += `\n\n> 📊 ${r.title || 'Untitled'}${r.reportType ? ` · \`${r.reportType}\`` : ''}`;
                      const card: ChatCard = {
                        type: 'report',
                        id: r.id,
                        title: r.title || '',
                        reportType: r.reportType || 'daily',
                      };
                      const msgId = crypto.randomUUID();
                      setMessages((prev) => {
                        const copy = [...prev];
                        copy[assistantIdx] = {
                          ...copy[assistantIdx],
                          role: 'assistant',
                          text: fullText,
                          card,
                          id: msgId,
                        };
                        return copy;
                      });
                      saveMsg({ id: msgId, role: 'assistant', text: fullText, card, _sessionId: lockedSid } as any);
                      bumpReport();
                      forceSuccess = true;
                    } else if (r.key) {
                      fullText += '\n\n> 🎫 **' + r.key + '** ' + (r.title || '') + ' · `' + (r.status || 'todo') + '`';
                      const card: ChatCard = {
                        type: 'task',
                        id: r.id || r.key,
                        key: r.key,
                        title: r.title || '',
                        status: r.status || 'todo',
                        description: pendingArgs?.description || '',
                        priority: r.priority,
                        issueType: r.type || 'task',
                      };
                      const msgId = crypto.randomUUID();
                      setMessages((prev) => {
                        const copy = [...prev];
                        copy[assistantIdx] = {
                          ...copy[assistantIdx],
                          role: 'assistant',
                          text: fullText,
                          card,
                          id: msgId,
                        };
                        return copy;
                      });
                      saveMsg({ id: msgId, role: 'assistant', text: fullText, card, _sessionId: lockedSid } as any);
                      bumpTask();
                      forceSuccess = true;
                    }
                  }
                } catch {}
              }
            }
            if (!fullText.trim()) fullText = t('misc.createdSuccess', lang);
            setMessages((prev) => {
              const copy = [...prev];
              copy[assistantIdx] = { ...copy[assistantIdx], role: 'assistant', text: fullText };
              return copy;
            });
          }
        } else {
          // HTTP error from server
          setMessages((prev) => {
            const copy = [...prev];
            copy[assistantIdx] = {
              ...copy[assistantIdx],
              role: 'assistant' as const,
              text: t('misc.createFailedRetry', lang),
            };
            return copy;
          });
        }
      } catch (e: any) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[assistantIdx] = {
            ...copy[assistantIdx],
            role: 'assistant' as const,
            text: t('misc.networkError', lang) + ': ' + (e?.message || ''),
          };
          return copy;
        });
      }
      // Mark the original blocked card as resolved only if force-create succeeded
      if (forceSuccess) {
        setMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 2; i >= 0; i--) {
            if (copy[i]?.card?.blocked && !copy[i]?.card?.resolved) {
              const updatedCard = { ...copy[i].card, resolved: true };
              copy[i] = { ...copy[i], card: updatedCard };
              const _ea = (window as any).electronAPI;
              if (_ea?.log) _ea.log('[forceResolved] m.id=' + copy[i].id + ' blocked=true');
              if (copy[i].id) {
                api.chat
                  .updateMessage({ id: copy[i].id as string, card: JSON.stringify(updatedCard) })
                  .then(() => {
                    if (_ea?.log) _ea.log('[forceResolved] updateMessage OK id=' + copy[i].id);
                  })
                  .catch((e: any) => {
                    if (_ea?.log)
                      _ea.log('[forceResolved] updateMessage FAILED id=' + copy[i].id + ' err=' + (e?.message || e));
                  });
              } else {
                if (_ea?.log) _ea.log('[forceResolved] NO m.id — cannot persist resolved state');
              }
              break;
            }
          }
          return copy;
        });
      }
      streamingThreadRef.current = '';
      setThinking(false);
      return;
    }
    setQuery('');
    const q = forcePayload || noteActionPayload || query.trim();
    if (!q) return;
    // ─── Concurrency gate: max 3 running tasks (browser connection limit) ───
    const runningCount = chatHook.countRunning();
    if (runningCount >= 3) {
      setAgentStatus(t('chat.tooMany', lang) || 'Max 3 concurrent tasks');
      return;
    }
    const files = [...attachedFiles];
    setAttachedFiles([]);
    // Build message with attachments
    let fullMessage = q;
    // ─── Blocked card pending: LLM semantic classification + regex fallback ───
    const lastBlockedIdx = [...messages].reverse().findIndex((m) => m && m.card?.blocked && m.card?.pendingArgs);
    const blockedMsg = lastBlockedIdx >= 0 ? messages[messages.length - 1 - lastBlockedIdx] : null;
    if (blockedMsg?.card?.blocked && blockedMsg.card?.pendingArgs) {
      const lastCard = blockedMsg.card;
      // Use LLM to classify user intent: confirm / cancel / other
      let intent: string = 'other';
      try {
        const res = await api.agent.classifyIntent({
          message: q,
          cardType: lastCard.type,
          blockedTitle: lastCard.pendingArgs?.title || '',
        });
        intent = res?.intent || 'other';
      } catch {
        /* fall through to regex fallback */
      }
      const resolveBlocked = (prev: any[]) => {
        const copy = [...prev];
        const idx = copy.findIndex((m) => m && m.card?.blocked && !m.card?.resolved);
        if (idx >= 0) {
          const updatedCard = { ...copy[idx].card, resolved: true };
          copy[idx] = { ...copy[idx], card: updatedCard };
          if (copy[idx].id)
            api.chat.updateMessage({ id: copy[idx].id, card: JSON.stringify(updatedCard) }).catch(() => {});
        }
        return copy;
      };
      if (intent === 'confirm') {
        const userMsgIdx = messages.length;
        const assistantIdx = userMsgIdx + 1;
        setMessages((prev) => {
          const copy = resolveBlocked(prev);
          copy.push({ role: 'user', text: q }, { role: 'assistant' as const, text: '' });
          return copy;
        });
        saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
        forceCreateRef.current = lastCard.pendingArgs;
        forceAssistantIdxRef.current = assistantIdx;
        setQuery('');
        try {
          sendMessage('__FORCE_CREATE__ ' + JSON.stringify(lastCard.pendingArgs));
        } catch {
          sendMessage(
            '__FORCE_CREATE__ ' +
              JSON.stringify({
                title: lastCard.pendingArgs?.title || '',
                _tool: lastCard.pendingArgs?._tool || 'force_create_issue',
              }),
          );
        }
        return;
      }
      if (intent === 'cancel') {
        setMessages((prev) => {
          const copy = resolveBlocked(prev);
          copy.push({ role: 'user', text: q });
          copy.push({ role: 'assistant', text: t('chat.cancelledCreate', lang) });
          return copy;
        });
        saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
        return;
      }
      // Other → normal flow, but if message clearly looks like cancellation, handle as cancel
      if (/^(放弃|算了|不要了|别建了|取消吧|不创建|不需要|stop|cancel|abort|never.?mind)/i.test(q.trim())) {
        setMessages((prev) => {
          const copy = resolveBlocked(prev);
          copy.push({ role: 'user', text: q });
          copy.push({ role: 'assistant', text: t('chat.cancelledCreate', lang) });
          return copy;
        });
        saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
        setQuery('');
        return;
      }
    }
    // Pre-flight: open panels instantly, then still send to agent for deeper handling
    const targetPanel = preFlightPanel(q);
    if (targetPanel) setPanel(targetPanel);
    // Check for acceptance keywords to apply staged suggestion
    const undoRe = /^(撤销|undo|revert|恢复|还原|回退)/i;
    const acceptRe = /^(接受|可以|好的|ok|yes|accept|apply|确认|sure|yep|yeah|行|好|可|保留)/i;
    const lastStaged = [...messages].reverse().find((m) => m && m.staged);
    if (undoRe.test(q) && lastStaged?.staged?.original) {
      const orig = lastStaged.staged.original;
      setMessages((prev) => [...prev, { role: 'user', text: q }]);
      saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
      fetch('/api/learn.capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          featureType: lastStaged.staged.type === 'task' ? 'suggest_issue_edit' : 'suggest_note_edit',
          aiOutput: JSON.stringify(lastStaged.staged).substring(0, 200),
          humanAction: 'REJECT',
        }),
      }).catch(() => {});
      if (lastStaged.staged.type === 'task') {
        useUICommandStore.getState().enqueue({
          type: 'apply_task_edit',
          payload: {
            title: orig.title || '',
            description: orig.description || '',
            status: orig.status || 'todo',
            priority: orig.priority || 'medium',
            storyPoints: orig.storyPoints ?? 0,
            __undo: true,
          },
        });
      } else if (lastStaged.staged.type === 'report') {
        setAppliedReport({ title: orig.title, content: orig.content });
      } else {
        setAppliedEdit({ title: orig.title, content: orig.content, category: orig.category });
      }
      setMessages((prev) => [...prev, { role: 'assistant', text: t('chat.revertedToPrev', lang) }]);
      return;
    }
    if (acceptRe.test(q) && lastStaged?.staged) {
      setMessages((prev) => [...prev, { role: 'user', text: q }]);
      saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
      fetch('/api/learn.capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          featureType: lastStaged.staged.type === 'task' ? 'suggest_issue_edit' : 'suggest_note_edit',
          aiOutput: JSON.stringify(lastStaged.staged).substring(0, 200),
          humanAction: 'ACCEPT',
        }),
      }).catch(() => {});
      handleApplyEdit(lastStaged.staged);
      return;
    }
    // Soft-gate: check DB for LLM key (not cached state — avoids stale after Settings change)
    const hasLLM =
      llmConfigured ||
      (await api.llm
        .getConfig()
        .then((d: any) => !!d?.activeProvider?.hasKey)
        .catch(() => false));
    if (!llmConfigured && hasLLM) setLlmConfigured(true); // update stale cache
    if (!hasLLM) {
      setMessages((prev) => [...prev, { role: 'user', text: q }, { role: 'assistant', text: t('chat.noLLM', lang) }]);
      saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
      setQuery('');
      return;
    }
    if (files.length > 0) {
      fullMessage +=
        '\n\n[Attached files — put FULL content in create_note tool args. Reply in 1 sentence. Do NOT echo content in chat.]\n' +
        files.map((f) => `--- ${f.name} ---\n${f.content}`).join('\n\n');
    }
    const history = messages
      .filter((m) => m && m.text && !m.text.startsWith('__FORCE_CREATE__') && (m as any).status !== 'running')
      .map((m) => {
        const entry: any = { role: m.role, content: m.text };
        if (m?.reasoningContent) entry.reasoning_content = m?.reasoningContent;
        return entry;
      });
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
    chatHook.autoTitle();
    setThinking(true);
    setAgentStatus(t('chat.thinking', lang));
    // Push assistant placeholder + capture its real index (functional updater = no stale closure)
    let assistantIdx = -1;
    const streamController = new AbortController();
    setMessages((prev) => {
      assistantIdx = prev.length;
      return [...prev, { role: 'assistant', text: '', status: 'running', controller: streamController }];
    });

    try {
      const noteSnapshot = editingNote; // capture at send time
      const taskSnapshot = editingTask; // capture at send time
      const reportSnapshot = editingReportRef.current; // capture latest via ref (updated on every content change)
      // Build context-aware message — agent reads user actions as natural language
      let contextMsg = '';
      if (noteSnapshot) {
        contextMsg = `[Note editor OPEN: "${noteSnapshot.title || '(untitled)'}"${noteSnapshot.id ? '' : ' (unsaved)'}]\nContent:\n\`\`\`\n${noteSnapshot.content || '(empty)'}\n\`\`\`\n\n`;
      } else if (taskSnapshot?.issueNumber && taskSnapshot.editing) {
        // Existing task being actively EDITED — agent can use suggest_issue_edit
        contextMsg = `[Task editor OPEN: TL-${taskSnapshot.issueNumber} "${taskSnapshot.title}"]\nStatus: ${taskSnapshot.status} | Priority: ${taskSnapshot.priority}${taskSnapshot.storyPoints ? ` | SP: ${taskSnapshot.storyPoints}` : ''}\nDescription: ${taskSnapshot.description || '(none)'}\n\n`;
      } else if (taskSnapshot?.issueNumber) {
        // Task is being VIEWED only (not editing) — treat as list view for agent context
        contextMsg = `[Tasks panel OPEN]\n`;
      } else if (taskSnapshot) {
        // New unsaved task form open (no issueNumber yet)
        contextMsg = `[New task form OPEN: "${taskSnapshot.title || '(untitled)'}"]\nStatus: ${taskSnapshot.status || 'todo'} | Priority: ${taskSnapshot.priority || 'medium'}\nDescription: ${taskSnapshot.description || '(empty)'}\n\n`;
      } else if (panel === 'notes') {
        contextMsg = `[Notes panel OPEN — user can see the note list]\n`;
      } else if (reportSnapshot) {
        contextMsg = `[Report editor OPEN: "${reportSnapshot.title || '(untitled)'}"]\nContent:\n\`\`\`html\n${reportSnapshot.content?.substring(0, 2000) || '(empty)'}\n\`\`\`\n\n`;
      } else if (panel === 'reports') {
        contextMsg = `[Reports panel OPEN — user can see the report list]\n`;
      } else if (panel === 'email') {
        contextMsg = `[Email panel OPEN]\n`;
      } else if (panel === 'tasks') {
        contextMsg = `[Tasks panel OPEN]\n`;
      }
      // ─── Context understanding: detect user intent from query + editor state ───
      const intentHints: string[] = [];
      const ql = q.toLowerCase();
      if (taskSnapshot?.issueNumber) {
        if (
          /^(close|complete|finish|done|关闭|完成|结束|关掉)(\s|$|任务|这个|它)/.test(ql) ||
          /\b(status|状态).*(done|完成)/.test(ql)
        ) {
          intentHints.push(
            `User wants to CLOSE TL-${taskSnapshot.issueNumber}. Call update_issue with issueNumber=${taskSnapshot.issueNumber} status=done.`,
          );
        } else if (/(move|start|begin|开始|做|进行|in.progress|in_progress)/.test(ql) && !/done/i.test(ql)) {
          intentHints.push(
            `User wants to MOVE TL-${taskSnapshot.issueNumber} to in_progress. Call update_issue with issueNumber=${taskSnapshot.issueNumber} status=in_progress.`,
          );
        } else if (/set.*priority.*(high|low|critical|medium)/i.test(ql) || /(高|低|严重|中等).*优先/i.test(ql)) {
          const pm = ql.match(/priority.*(high|low|critical|medium)|(高|低|严重|中等).*优先/i);
          const p =
            pm?.[1] ||
            (pm?.[2] === '高' ? 'high' : pm?.[2] === '低' ? 'low' : pm?.[2] === '严重' ? 'critical' : 'medium');
          intentHints.push(`User wants to change TL-${taskSnapshot.issueNumber} priority to ${p}. Call update_issue.`);
        }
      }
      if (intentHints.length > 0) {
        contextMsg += `\n⚠️ USER INTENT: ${intentHints.join(' ')}\n`;
      }
      const resp = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: contextMsg + fullMessage,
          history,
          panelContext: panel,
          remainingTokens: Math.max(1000, maxTokens - currentTokens),
          lang,
        }),
        signal: streamController.signal,
      });
      if (!resp.ok) throw new Error('stream failed');

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('no stream');
      const decoder = new TextDecoder();
      let buffer = '',
        fullText = '',
        doneContent = '',
        currentEvent = '',
        reasoningContent = '';
      let stagedData: any = null; // track staged edit across SSE loop, used in finalMsg (avoids closure issue)

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(line.indexOf(':') + 1).trim();
            continue;
          }
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(line.indexOf(':') + 1).trim();
          if (!raw.startsWith('{')) continue;
          try {
            const data = JSON.parse(raw);
            if (currentEvent === 'error') {
              fullText = (data.message || 'Unknown error') + (data.chain ? '\n\n`' + data.chain + '`' : '');
              setAgentStatus('');
              break;
            }
            if (currentEvent === 'done') {
              doneContent = data.content || '';
              continue;
            }
            if (currentEvent === 'debug') {
              continue;
            }
            if (currentEvent === 'thinking') {
              const label = t('chat.thinkingRound', lang, { n: data.iteration || '?' });
              setAgentStatus(label);
              reasoningContent += (reasoningContent ? '\n' : '') + label;
              setMessages((prev) => {
                const copy = [...prev];
                copy[assistantIdx] = { ...copy[assistantIdx], reasoningContent };
                return copy;
              });
              continue;
            }
            if (currentEvent === 'progress') {
              setAgentStatus(data.text || '');
              reasoningContent += data.text || '';
              continue;
            }
            if (currentEvent === 'reasoning') {
              reasoningContent += data.text || '';
              // Stream thinking to UI in real-time — user sees agent's thought process as it happens
              setMessages((prev) => {
                const copy = [...prev];
                copy[assistantIdx] = { ...copy[assistantIdx], reasoningContent };
                return copy;
              });
              continue;
            }
            if (currentEvent === 'tool_call') {
              let label = `🔧 ${data.tool || t('chat.working', lang)}`;
              try {
                const a = JSON.parse(data.args || '{}');
                const detail = a.query || a.title || a.issueNumber || a.command || '';
                label += detail ? ': ' + String(detail).substring(0, 60) : '...';
              } catch {
                label += '...';
              }
              reasoningContent += '\n' + label;
              setMessages((prev) => {
                const copy = [...prev];
                copy[assistantIdx] = { ...copy[assistantIdx], reasoningContent };
                return copy;
              });
            }
            if (data.text) {
              fullText += String(data.text || '');
              setAgentStatus('');
              setMessages((prev) => {
                const copy = [...prev];
                copy[assistantIdx] = { ...copy[assistantIdx], text: fullText, status: 'running' };
                return copy;
              });
            }
            // Only tool_result events (not tool_call) should add to fullText. Tool names go to reasoningContent only.
            if (data.tool && data.args && currentEvent !== 'tool_call') {
              lastToolArgsRef.current = data.args;
              const cut2 = fullText.lastIndexOf('{');
              if (cut2 >= 0) fullText = fullText.substring(0, cut2).trimEnd();
              let brief2 = '';
              try {
                const a2 = JSON.parse(data.args);
                brief2 = a2.title ? ' ' + String(a2.title).substring(0, 40) : '';
              } catch (e: any) {
                brief2 = ' ERR:' + e.message;
              }
              fullText += '\n🔧 ' + data.tool + brief2;
            }
            let msgCard: ChatCard | undefined;
            if (data.tool && data.result) {
              const r = data.result;
              // Capture tool result in thinking section
              const resultBrief = r?.error
                ? `❌ ${r.error}`
                : r?.blocked
                  ? `🚫 blocked (${r.duplicates?.length || 0} similar)`
                  : r?.key
                    ? `✅ ${r.key}`
                    : r?.id
                      ? `✅ ${r.id?.substring(0, 8)}`
                      : '✅ done';
              reasoningContent += '\n🔧 ' + data.tool + ' → ' + resultBrief;
              setMessages((prev) => {
                const copy = [...prev];
                copy[assistantIdx] = { ...copy[assistantIdx], reasoningContent };
                return copy;
              });
              dispatchUICommand(data.tool, data.result);
              if (data.tool === 'suggest_note_edit' && r.staged) {
                const f = r._full || r;
                stagedData = {
                  title: f.title,
                  content: f.content || '',
                  category: f.category,
                  original: noteSnapshot
                    ? { title: noteSnapshot.title, content: noteSnapshot.content, category: noteSnapshot.category }
                    : undefined,
                  type: 'note' as any,
                };
              } else if (
                (data.tool === 'suggest_report_edit' ||
                  data.tool === 'polish_report' ||
                  data.tool === 'summarize_report' ||
                  data.tool === 'expand_report' ||
                  data.tool === 'translate_report') &&
                r.staged
              ) {
                const f = r._full || r;
                stagedData = {
                  title: f.title,
                  content: f.content || '',
                  original: reportSnapshot
                    ? { title: reportSnapshot.title, content: reportSnapshot.content }
                    : undefined,
                  type: 'report' as any,
                };
              } else if (data.tool === 'suggest_issue_edit' && r.staged) {
                const f = r._full || r;
                if (taskSnapshot) {
                  // Guard: if new title is completely different from current task title, force create instead
                  const origTitle = taskSnapshot.title || '';
                  const newTitle: string = (f.title || '').replace(/\s+/g, '');
                  const origChars = new Set(origTitle.replace(/\s+/g, ''));
                  const overlap = [...new Set(newTitle)].filter((c: string) => origChars.has(c)).length;
                  const similarity = overlap / Math.max(newTitle.length, 1);
                  if (newTitle && origTitle && newTitle.length > 0 && origTitle.length > 0 && similarity < 0.3) {
                    setAppliedTaskEdit({
                      title: origTitle,
                      description: f.description || '',
                      status: f.status || taskSnapshot.status,
                      priority: f.priority || taskSnapshot.priority,
                      storyPoints: f.storyPoints ?? taskSnapshot.storyPoints,
                    });
                    fullText += '\n\n' + t('chat.titleMismatch', lang);
                  } else {
                    setAppliedTaskEdit({
                      title: f.title,
                      description: f.description || '',
                      status: f.status,
                      priority: f.priority,
                      storyPoints: f.storyPoints,
                    });
                  }
                }
              } else if (data.tool === 'edit_email_reply' && r.staged) {
                stagedData = { ...r, type: 'email_reply' as any };
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[assistantIdx] = { ...copy[assistantIdx], staged: stagedData };
                  return copy;
                });
                fullText += '\n\n---\n' + t('chat.replyDraftUpdated', lang);
              } else if (data.tool === 'list_emails') {
                const list = Array.isArray(r) ? r : [];
                fullText += list.length === 0 ? `\n📭 0` : `\n📧 ${list.length}`;
              } else if (data.tool === 'send_email_reply') {
                bumpEmail();
              } else if (data.tool === 'read_email_original') {
                fullText += `\n${(r.body || '').substring(0, 300)}`;
              } else if (data.tool === 'dismiss_email') {
                bumpEmail();
              } else if (data.tool === 'delete_email') {
                bumpEmail();
              } else if (
                data.tool === 'export_to_excel' ||
                data.tool === 'export_to_doc' ||
                data.tool === 'export_to_pdf' ||
                data.tool === 'export_to_ppt'
              ) {
                if (r.filePath) {
                  const kind =
                    r.type === 'xlsx' ? 'xlsx' : r.type === 'pdf' ? 'pdf' : r.type === 'pptx' ? 'ppt' : 'doc';
                  const typeMap: Record<string, string> = {
                    xlsx: 'export_xlsx',
                    doc: 'export_doc',
                    pdf: 'export_pdf',
                    ppt: 'export_ppt',
                  };
                  const labelMap: Record<string, string> = {
                    xlsx: '📊 Excel',
                    doc: '📝 Word',
                    pdf: '📄 PDF',
                    ppt: '📽 PPT',
                  };
                  cardRef.current = {
                    type: typeMap[kind] as any,
                    id: r.filePath,
                    title: r.filename,
                    key: r.filePath,
                    status: r.filePath,
                    description: `${(r.size / 1024).toFixed(1)}KB`,
                    html: r.html,
                  };
                  fullText += `\n\n📥 ${labelMap[kind] || 'File'} **${r.filename}** (${(r.size / 1024).toFixed(1)}KB)`;
                }
              } else if (data.tool === 'create_note' || data.tool === 'force_create_note') {
                fullText += `\n\n> 📄 ${r.title || 'Untitled'}${r.category ? ` · \`${r.category}\`` : ''}`;
              } else {
                if (r.key && r.title) {
                  fullText += `\n\n> 🎫 **${r.key}** ${r.title || ''}${r.status ? ` · \`${r.status}\`` : ''}`;
                } else if (r.key) {
                  fullText += ` ${r.key}`;
                }
              }
              if (data.tool === 'create_note' || data.tool === 'force_create_note' || data.tool === 'update_note')
                bumpNote();
              if (data.tool === 'create_issue' || data.tool === 'force_create_issue' || data.tool === 'update_issue')
                bumpTask();
              if (data.tool === 'create_report' || data.tool === 'force_create_report' || data.tool === 'update_report')
                bumpReport();
              // Build inline card
              if (
                (data.tool === 'create_issue' || data.tool === 'create_note' || data.tool === 'create_report') &&
                r.blocked
              ) {
                // Duplicate blocked — render with Force/Cancel buttons
                const blockedType =
                  data.tool === 'create_note' ? 'note' : data.tool === 'create_report' ? 'report' : 'task';
                const forceTool =
                  data.tool === 'create_note'
                    ? 'force_create_note'
                    : data.tool === 'create_report'
                      ? 'force_create_report'
                      : 'force_create_issue';
                msgCard = {
                  type: blockedType,
                  title: r.pendingArgs?.title || '',
                  blocked: true,
                  duplicates: r.duplicates,
                  pendingArgs: { ...r.pendingArgs, _tool: forceTool },
                };
              } else if ((data.tool === 'create_issue' || data.tool === 'force_create_issue') && r.key) {
                let toolArgs: any = {};
                try {
                  toolArgs = JSON.parse(lastToolArgsRef.current || '{}');
                } catch {}
                msgCard = {
                  type: 'task',
                  id: r.id || r.key,
                  key: r.key,
                  title: r.title || '',
                  status: r.status || 'todo',
                  description: toolArgs.description || '',
                  priority: r.priority,
                  storyPoints: toolArgs.storyPoints,
                  issueType: r.type || 'task',
                };
              } else if ((data.tool === 'create_note' || data.tool === 'force_create_note') && r.id) {
                let noteArgs: any = {};
                try {
                  noteArgs = JSON.parse(lastToolArgsRef.current || '{}');
                } catch {}
                msgCard = {
                  type: 'note',
                  id: r.id,
                  title: r.title || '',
                  category: r.category || 'general',
                  content: noteArgs.content || '',
                };
              } else if ((data.tool === 'create_report' || data.tool === 'force_create_report') && r.id) {
                msgCard = { type: 'report', id: r.id, title: r.title || '', reportType: r.reportType || 'daily' };
              } else {
              }
            }
            // Export cards have priority — don't let create_report/etc overwrite them
            if (
              msgCard &&
              cardRef.current?.type !== 'export_xlsx' &&
              cardRef.current?.type !== 'export_doc' &&
              cardRef.current?.type !== 'export_pdf' &&
              cardRef.current?.type !== 'export_ppt'
            ) {
              cardRef.current = msgCard;
            }
            // Prefer export card over any subsequent tool card
            const cardForMsg =
              cardRef.current?.type === 'export_xlsx' ||
              cardRef.current?.type === 'export_doc' ||
              cardRef.current?.type === 'export_pdf' ||
              cardRef.current?.type === 'export_ppt'
                ? cardRef.current
                : msgCard || cardRef.current;
            setMessages((prev) => {
              const copy = [...prev];
              copy[assistantIdx] = { ...copy[assistantIdx], role: 'assistant', text: fullText, card: cardForMsg };
              return copy;
            });
          } catch {}
        }
        if (currentEvent === 'error') break;
      }

      setAgentStatus('');
      // Prefer server-cleaned doneContent; fall back to fullText (may be error from SSE event)
      const displayText = doneContent;
      if (!displayText || !displayText.trim()) {
        // Keep fullText if it already has content (error message from SSE 'error' event, etc.)
        if (!fullText || !fullText.trim()) {
          fullText = t('chat.noAiContent', lang);
        }
      }
      const finalMsg: any = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        text: displayText || fullText,
        card: cardRef.current,
        reasoningContent: reasoningContent || undefined,
      };
      const _elog = (window as any).electronAPI?.log;
      if (_elog)
        _elog(
          '[finalMsg] reasoningLen=' + (reasoningContent || '').length + ' hasTools=' + reasoningContent.includes('🔧'),
        );
      if (stagedData) finalMsg.staged = stagedData;
      setMessages((prev) => {
        const copy = [...prev];
        copy[assistantIdx] = { ...finalMsg };
        return copy;
      });
      saveMsg({ ...finalMsg, _sessionId: lockedSid });
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[assistantIdx]) copy[assistantIdx] = { ...copy[assistantIdx], status: 'done' as const };
        return copy;
      });
    } catch (e: any) {
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[assistantIdx])
          copy[assistantIdx] = { ...copy[assistantIdx], status: e?.name === 'AbortError' ? 'aborted' : 'error' };
        return copy;
      });
      if (e?.name === 'AbortError') {
        // Stream was interrupted by user — no fallback, message already cleaned up by stopStream
      } else {
        setAgentStatus('');
        const errMsg = e?.message || e?.toString() || 'Unknown error';
        setMessages((prev) => {
          const copy = [...prev];
          copy[assistantIdx] = {
            ...copy[assistantIdx],
            role: 'assistant' as const,
            text: t('chat.callFailed', lang, { err: errMsg }),
          };
          return copy;
        });
      }
    }
    setThinking(false);
  };
  sendMessageRef.current = sendMessage; // keep ref fresh for onForceCreate callback

  return {
    sendMessage,
    stopStream,
    sendMessageRef,
    forceCreateRef,
    cardRef,
    lastToolArgsRef,
    forceAssistantIdxRef,
    streamingThreadRef,
  };
}
