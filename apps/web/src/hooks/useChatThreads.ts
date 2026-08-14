import { useState, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

// ═══ Session-scoped message store: one message list per session ═══

export interface SessionData {
  id: string;
  title: string;
  messages: any[];
}

function makeTitle(text: string): string {
  return (text || '').replace(/\n/g, ' ').substring(0, 30).trim() || 'Chat';
}

function mapMsg(m: any) {
  return {
    id: m.id, role: m.role, text: m.text || '', tool: m.tool || undefined,
    staged: m.staged ? (() => { try { return JSON.parse(m.staged); } catch { return undefined; } })() : undefined,
    card: m.card ? (() => { try { return JSON.parse(m.card); } catch { return undefined; } })() : undefined,
    reasoningContent: m.reasoningContent || undefined,
    threadId: m.threadId || null,
  };
}

export function useChatSessions() {
  // Each session has its own messages array — keyed by sessionId, no shared state
  const [sessionsData, setSessionsData] = useState<Record<string, SessionData>>({});
  const sessionsDataRef = useRef<Record<string, SessionData>>({});
  const [activeSessionId, setActiveSessionId] = useState<string>('');

  const messages = sessionsData[activeSessionId]?.messages || [];
  const currentSessionTitle = sessionsData[activeSessionId]?.title || 'Chat';

  // ─── Load session messages from DB ───
  const loadSession = useCallback(async (sessionId: string) => {
    // Don't overwrite existing data if already loaded (preserves running tasks)
    if (sessionsData[sessionId]) return;

    try {
      const msgs = await api.chat.getMessages(sessionId);
      const data: SessionData = { id: sessionId, title: 'Chat', messages: msgs.map(mapMsg) };
      setSessionsData(prev => { const n = { ...prev, [sessionId]: data }; sessionsDataRef.current = n; return n; });
      if (!activeSessionId) setActiveSessionId(sessionId);
      return data;
    } catch {
      const data: SessionData = { id: sessionId, title: 'Chat', messages: [] };
      setSessionsData(prev => { const n = { ...prev, [sessionId]: data }; sessionsDataRef.current = n; return n; });
      if (!activeSessionId) setActiveSessionId(sessionId);
      return data;
    }
  }, [sessionsData, activeSessionId]);

  const switchSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const addSession = useCallback((sessionId: string, title: string) => {
    const data: SessionData = { id: sessionId, title, messages: [] };
    setSessionsData(prev => { const n = { ...prev, [sessionId]: data }; sessionsDataRef.current = n; return n; });
    setActiveSessionId(sessionId);
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    setSessionsData(prev => { const n = { ...prev }; delete n[sessionId]; sessionsDataRef.current = n; return n; });
    if (activeSessionId === sessionId) setActiveSessionId('');
  }, [activeSessionId]);

  // ─── Message manipulation — writes to a specific session ───
  const setMessages = useCallback((messagesOrFn: any[] | ((prev: any[]) => any[]), sessionId?: string) => {
    const sid = sessionId || activeSessionId;
    if (!sid) return;
    setSessionsData(prev => {
      const cur = prev[sid] || { id: sid, title: 'Chat', messages: [] };
      const newMsgs = typeof messagesOrFn === 'function' ? messagesOrFn(cur.messages) : messagesOrFn;
      const n = { ...prev, [sid]: { ...cur, messages: newMsgs } };
      sessionsDataRef.current = n;
      return n;
    });
  }, [activeSessionId]);

  // Locked setter for streaming — always writes to the captured session
  const getMessagesSetter = useCallback((sessionId: string) => {
    return (messagesOrFn: any[] | ((prev: any[]) => any[])) => setMessages(messagesOrFn, sessionId);
  }, [setMessages]);

  // Find and update a message by ID across ALL sessions
  const updateMessageById = useCallback((messageId: string, patch: Record<string, any>) => {
    setSessionsData(prev => {
      const n = { ...prev };
      let found = false;
      for (const sid of Object.keys(n)) {
        const idx = n[sid].messages.findIndex((m: any) => m.id === messageId);
        if (idx >= 0) {
          n[sid] = { ...n[sid], messages: [...n[sid].messages] };
          n[sid].messages[idx] = { ...n[sid].messages[idx], ...patch };
          found = true;
          break;
        }
      }
      if (found) sessionsDataRef.current = n;
      return found ? n : prev;
    });
  }, []);

  // Count running tasks across all sessions
  const countRunning = useCallback(() => {
    let count = 0;
    for (const sid of Object.keys(sessionsDataRef.current)) {
      for (const m of sessionsDataRef.current[sid].messages) {
        if ((m as any).status === 'running') count++;
      }
    }
    return count;
  }, []);

  // Auto-title from first user message
  const autoTitle = useCallback(() => {
    const sid = activeSessionId;
    if (!sid) return;
    setSessionsData(prev => {
      const cur = prev[sid];
      if (!cur || cur.title !== 'Chat') return prev;
      const firstUser = cur.messages.find((m: any) => m.role === 'user');
      if (!firstUser) return prev;
      const n = { ...prev, [sid]: { ...cur, title: makeTitle(firstUser.text) } };
      sessionsDataRef.current = n;
      return n;
    });
  }, [activeSessionId]);

  return {
    sessionsData, sessionsDataRef,
    activeSessionId, setActiveSessionId,
    messages, currentSessionTitle,
    loadSession, switchSession, addSession, removeSession,
    setMessages, getMessagesSetter, updateMessageById,
    countRunning, autoTitle,
  };
}
