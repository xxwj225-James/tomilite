import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import type { StagedEdit, ChatCard } from '@/types/chat';
import type { ChatHook } from './useChatThreads';

// ═══ Session management: session list + bootstrap, per-session locked saveMsg, rename/delete/compress ═══
export function useSessionManager({
  chatHook,
  maxTokens,
  currentTokens,
}: {
  chatHook: ChatHook;
  maxTokens: number;
  currentTokens: number;
}) {
  const lang = useLang();
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; tokenPercent: number }>>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const messages = chatHook.messages;
  const setMessages = chatHook.setMessages;

  // Load sessions from DB on mount
  useEffect(() => {
    api.chat
      .listSessions()
      .then((list: any[]) => {
        if (list.length > 0) {
          setSessions(list.map((s) => ({ id: s.id, title: s.title, tokenPercent: s.tokenPercent || 0 })));
          const cur = list[0].id;
          setCurrentSessionId(cur);
          chatHook.switchSession(cur);
          chatHook.loadSession(cur);
        } else {
          api.chat.createSession('Chat 1').then((s: any) => {
            setSessions([{ id: s.id, title: s.title, tokenPercent: 0 }]);
            setCurrentSessionId(s.id);
            // Register + select the freshly created session, or activeSessionId stays ''
            // and every UI write from the first message is dropped (setMessages no-op),
            // while the backend still streams and bills. Mirrors deleteSession's empty branch.
            chatHook.switchSession(s.id);
            chatHook.loadSession(s.id);
          });
        }
      })
      .catch(() => {})
      .finally(() => setSessionsLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Save individual message to DB
  const sessionCreatingRef = useRef<Promise<string> | null>(null);
  const saveMsg = (msg: {
    role: 'user' | 'assistant';
    text: string;
    tool?: string;
    staged?: StagedEdit;
    card?: ChatCard;
    reasoningContent?: string;
    pinnable?: boolean;
    _threadId?: string;
    _sessionId?: string;
  }): Promise<any> => {
    const doSave = (sid: string): Promise<any> => {
      const _ea = (window as any).electronAPI;
      if (_ea?.log)
        _ea.log('[saveMsg] saving', {
          role: msg.role,
          hasCard: !!msg.card,
          cardType: msg.card?.type,
          textLen: msg.text?.length,
          reasoningLen: (msg.reasoningContent || '').length,
          sessionId: sid,
        });
      return api.chat
        .addMessage({
          id: (msg as any).id || undefined,
          sessionId: sid,
          role: msg.role,
          text: msg.text,
          tool: msg.tool,
          staged: msg.staged ? JSON.stringify(msg.staged) : undefined,
          card: msg.card ? JSON.stringify(msg.card) : undefined,
          reasoningContent: msg.reasoningContent,
          pinnable: msg.pinnable,
          threadId: (msg as any)._threadId || null,
        })
        .then((res: any) => {
          return res?.data;
        })
        .catch((e: any) => {
          console.error('[saveMsg] FAILED:', e?.message || e);
          return null;
        });
    };
    // Use explicit _sessionId if provided (per-session locking during streaming),
    // otherwise fall back to currentSessionId (UI actions like apply/undo edit).
    const sid = (msg as any)._sessionId || currentSessionId;
    if (sid) return doSave(sid);
    // Reuse in-flight session creation to avoid duplicates
    if (!sessionCreatingRef.current) {
      sessionCreatingRef.current = api.chat.createSession('Chat 1').then((s: any) => {
        setCurrentSessionId(s.id);
        setSessions((prev) => [...prev, { id: s.id, title: s.title, tokenPercent: 0 }]);
        sessionCreatingRef.current = null;
        return s.id;
      });
    }
    const creating = sessionCreatingRef.current;
    return creating ? creating.then((sid2: string) => doSave(sid2)).catch(() => null) : Promise.resolve(null);
  };

  const switchSession = (sid: string) => {
    setCurrentSessionId(sid);
    chatHook.switchSession(sid);
    chatHook.loadSession(sid);
  };
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const startRename = (s: { id: string; title: string }) => {
    setEditingSessionId(s.id);
    setEditTitle(s.title);
  };
  const clearSession = () => {
    setMessages([]);
    if (currentSessionId) api.chat.clearMessages(currentSessionId, chatHook.activeSessionId || null).catch(() => {});
  };
  const [compressConfirm, setCompressConfirm] = useState(false);
  const compressChat = () => {
    if (messages.length >= 4) setCompressConfirm(true);
    else setCompressMsg(t('chat.compressTooFew', lang));
  };
  const [compressing, setCompressing] = useState(false);
  const [compressMsg, setCompressMsg] = useState('');
  const executeCompress = async () => {
    setCompressConfirm(false);
    // Refuse to compress while a message is still streaming — the full replace would drop the in-flight reply
    if (messages.some((m: any) => m && m.status === 'running')) {
      setCompressMsg(t('chat.compressBusy', lang));
      return;
    }
    if (messages.length < 4) {
      setCompressMsg(t('chat.compressTooFew', lang));
      return;
    }
    setCompressing(true);
    try {
      // Keep last 3 message pairs intact, compress older messages
      const KEEP_RECENT = 6; // ~3 user+assistant pairs
      // Exclude running tasks and force-create internal messages
      const allMsgs = messages.filter(
        (m) => m && !(m.text || '').startsWith('__FORCE_CREATE__') && (m as any).status !== 'running',
      );
      const recent = allMsgs.slice(-KEEP_RECENT);
      const older = allMsgs.slice(0, -KEEP_RECENT);
      if (older.length === 0) {
        setCompressing(false);
        setCompressMsg(t('chat.compressTooFew', lang));
        return;
      }

      const history = older.map((m) => {
        const entry: any = { role: m.role, content: m.text?.substring(0, 2000) };
        if (m?.reasoningContent) entry.reasoning_content = m?.reasoningContent;
        return entry;
      });
      const resp = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Summarize our conversation above into a structured context summary. Keep it concise but preserve ALL of the following:

1. **Tasks Created/Modified**: Every TL- number, title, status, and priority mentioned
2. **Key Decisions**: What was agreed upon, rejected, or deferred
3. **Code Changes**: File paths, commit messages, bug fixes discussed
4. **Unfinished Items**: Tasks or discussions still in progress
5. **Important Context**: Facts that future conversations need to remember

Format with markdown headings (##). Do NOT add suggestions, offers to help, or polite closings — just the facts.`,
          history,
          lang,
        }),
      });
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('no stream');
      const decoder = new TextDecoder();
      let buffer = '',
        summary = '',
        currentEvent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === 'error') {
              summary = '[Compress failed]';
              break;
            }
            if (data.text) summary += data.text; // accumulate token text
            if (currentEvent === 'done' && !summary) summary = data.content || '';
          } catch {}
        }
        if (currentEvent === 'error') break;
      }
      if (summary) {
        const compressedMsg = {
          role: 'assistant' as const,
          text: `📋 **📦 Context Compressed**\n\n${summary.replace(/\n\n/g, '\n')}\n\n---\n💬 *Recent conversation kept intact below*`,
        };
        const recentMsgs = recent.map((m) => ({
          role: m.role,
          text: m.text,
          tool: m.tool,
          staged: m.staged,
          card: m.card,
          reasoningContent: m?.reasoningContent,
        }));
        setMessages([compressedMsg, ...recentMsgs]);
        // Clear old messages from DB, then re-save kept ones in order
        if (currentSessionId) {
          await api.chat.clearMessages(currentSessionId);
          await saveMsg(compressedMsg);
          for (const m of recentMsgs) await saveMsg(m);
        }
      }
    } catch {}
    setCompressing(false);
  };
  // Auto-compress when context >85% full (ensures room for thinking + tool calls)
  const didAutoCompress = useRef(false);
  useEffect(() => {
    const pct = (currentTokens / Math.max(maxTokens, 1)) * 100;
    if (
      pct >= 85 &&
      messages.length >= 6 &&
      !didAutoCompress.current &&
      !compressing &&
      !messages.some((m: any) => m && m.status === 'running')
    ) {
      didAutoCompress.current = true;
      executeCompress();
    }
    if (pct < 50) didAutoCompress.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- executeCompress is per-render; guard ref prevents loops
  }, [currentTokens, maxTokens, messages.length, compressing]);
  const commitRename = () => {
    if (editingSessionId && editTitle.trim()) {
      const newTitle = editTitle.trim();
      setSessions((prev) => prev.map((s) => (s.id === editingSessionId ? { ...s, title: newTitle } : s)));
      api.chat.renameSession(editingSessionId, newTitle).catch(() => {});
    }
    setEditingSessionId(null);
    setEditTitle('');
  };

  // Delete session
  const deleteSession = (sid: string) => {
    const newSessions = sessions.filter((s) => s.id !== sid);
    setSessions(newSessions);
    chatHook.removeSession(sid);
    api.chat.deleteSession(sid).catch(() => {});
    if (sid === currentSessionId) {
      if (newSessions.length > 0) switchSession(newSessions[0].id);
      else {
        api.chat
          .createSession('Chat 1')
          .then((s: any) => {
            setSessions([{ id: s.id, title: s.title, tokenPercent: 0 }]);
            setCurrentSessionId(s.id);
            chatHook.switchSession(s.id);
            chatHook.loadSession(s.id);
          })
          .catch(() => {});
      }
    }
  };

  return {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    sessionsLoaded,
    editingSessionId,
    setEditingSessionId,
    editTitle,
    setEditTitle,
    saveMsg,
    switchSession,
    startRename,
    commitRename,
    clearSession,
    deleteSession,
    compressConfirm,
    setCompressConfirm,
    compressing,
    compressMsg,
    setCompressMsg,
    compressChat,
    executeCompress,
  };
}
