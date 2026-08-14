import { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { t, tr, type I18NKey } from '@/lib/i18n';
import { ContentPanel } from '@/components/ContentPanel';
import { ConfirmDialog } from '@tomatolite/shared-ui/components/ConfirmDialog';
import { dispatchUICommand, useUICommandStore } from '@/stores/uiCommandStore';
import { useLanguageStore, type Lang } from '@/stores/languageStore';
import { useLang, useSetLang } from '@/stores/LangContext';
import { getProvider } from '@/lib/llmProviders';
import { useChatSessions } from '@/hooks/useChatThreads';
import { RobotFace } from '@/components/RobotFace';
import { PanelResizeHandle } from '@/components/PanelResizeHandle';
import { Msg } from '@/components/chat/Msg';
import type { StagedEdit, ChatCard } from '@/types/chat';

// ═══ i18n ═══
function _t(key: string, lang: string) { return t(key as I18NKey, lang); }
function _l(zh: string, ja: string, en: string) {
  const lang = useLanguageStore.getState().lang;
  return lang === 'zh' ? zh : lang === 'ja' ? ja : en;
}
const ICONS: Record<string, React.ReactNode> = {
  home: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  board: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  tasks: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  notes: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  email: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  reports: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  settings: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  mcp: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  feedback: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  about: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  deep_flow: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  focused: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>,
  available: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>,
};
const MENU = [
  { key: 'tasks' }, { key: 'notes' },
  { key: 'home' }, { key: 'email' }, { key: 'reports' }, { key: 'mcp' }, { key: 'feedback' }, { key: 'settings' }, { key: 'about' },
] as const;
const THEMES = ['pipeline', 'hub', 'canvas', 'quantum'] as const;
const THEME_COLORS: Record<string, string> = { pipeline: '#4338CA', hub: '#1877F2', canvas: '#1A73E8', quantum: '#76B900' };
const LANGS = ['en', 'zh', 'ja'] as const;
const LANGS_FULL: Record<string, string> = { en: 'English', zh: '中文', ja: '日本語' };

function applyTheme(key: string) { document.documentElement.setAttribute('data-theme', key); localStorage.setItem('tomilite-theme', key); }
function getTheme() { return localStorage.getItem('tomilite-theme') || 'pipeline'; }

// ═══ AI response simulation ═══
// ═══ MAIN APP ═══
export function App() {
  const lang = useLang();
  const setLang = useSetLang();
  const [theme, setTheme] = useState(getTheme());
  const [showWelcome, setShowWelcome] = useState(false); // moved here: must be before useEffect that references it (obfuscator TDZ)
  const [panel, setPanel] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [panelMenuOpen, setPanelMenuOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; size: number; content: string }>>([]);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState('');

  // Shared file parser — handles .xlsx .docx .pdf and all text formats
  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const loaded: Array<{ name: string; size: number; content: string }> = [];
    for (const f of arr) {
      const ext = f.name.split('.').pop()?.toLowerCase();
      try {
        if (ext === 'xlsx') {
          const XLSX: any = await import('xlsx');
          const buf = await f.arrayBuffer();
          const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
          const rows: string[] = [];
          for (const sn of wb.SheetNames) {
            const ws = wb.Sheets[sn];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
            rows.push(`--- Sheet: ${sn} ---`);
            for (const row of data.slice(0, 100)) rows.push(row.map(c => String(c ?? '')).join('\t'));
          }
          loaded.push({ name: f.name, size: f.size, content: rows.join('\n') });
        } else if (ext === 'docx') {
          const mammoth = await import('mammoth');
          const buf = await f.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer: buf });
          loaded.push({ name: f.name, size: f.size, content: result.value.substring(0, 10000) });
        } else if (ext === 'pdf') {
          const pdfjsLib = await import('pdfjs-dist');
          pdfjsLib.GlobalWorkerOptions.workerSrc = '';
          const buf = await f.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
          const pages: string[] = [];
          for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
            const page = await pdf.getPage(i);
            const text = await page.getTextContent();
            pages.push(text.items.map((t: any) => t.str).join(' '));
          }
          loaded.push({ name: f.name, size: f.size, content: pages.join('\n\n').substring(0, 10000) });
        } else {
          const text = await f.text();
          loaded.push({ name: f.name, size: f.size, content: text.substring(0, 10000) });
        }
      } catch { loaded.push({ name: f.name, size: f.size, content: `[${tr(lang,'无法解析','解析不能','Cannot parse')}: ${f.name}]` }); }
    }
    setAttachedFiles(prev => [...prev, ...loaded]);
  };

  // Session management — persisted to DB via API
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; tokenPercent: number }>>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const chatHook = useChatSessions();
  const [appliedEdit, setAppliedEdit] = useState<StagedEdit | null>(null);
  // Derived from active session
  const messages = chatHook.messages;
  const setMessages = chatHook.setMessages;
  // thinking: true if any message in current session has status 'running'
  const thinking = messages.some((m: any) => m.status === 'running');
  const agentStatus = thinking ? 'Thinking...' : '';
  const setThinking = (_v: boolean) => {}; // derived, no-op
  const setAgentStatus = (_v: string) => {}; // derived, no-op
  const lastToolArgsRef = useRef<string>('');
  const cardRef = useRef<ChatCard | undefined>(undefined);
  const forceCreateRef = useRef<any>(null); // pending force-create args // survive stream end
  const forceAssistantIdxRef = useRef<number>(0); // pre-computed assistantIdx for text-confirm force-create
  const sendMessageRef = useRef<(payload?: string, noteActionPayload?: string) => void>(undefined);
  const streamingThreadRef = useRef<string>(''); // locked threadId during active stream
  const [deleteTarget, setDeleteTarget] = useState<ChatCard | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  // Load sessions from DB on mount
  useEffect(() => {
    api.chat.listSessions().then((list: any[]) => {
      if (list.length > 0) {
        setSessions(list.map(s => ({ id: s.id, title: s.title, tokenPercent: s.tokenPercent || 0 })));
        const cur = list[0].id;
        setCurrentSessionId(cur);
        chatHook.switchSession(cur);
        chatHook.loadSession(cur);
      } else {
        api.chat.createSession('Chat 1').then((s: any) => {
          setSessions([{ id: s.id, title: s.title, tokenPercent: 0 }]);
          setCurrentSessionId(s.id);
        });
      }
    }).catch(() => {}).finally(() => setSessionsLoaded(true));
  }, []);

  const handleApplyEdit = (staged: StagedEdit) => {
    if (staged.type === 'task') {
      setAppliedTaskEdit({ title: staged.title, description: staged.description, status: staged.status, priority: staged.priority, storyPoints: staged.storyPoints });
    } else if (staged.type === 'report') {
      setAppliedReport({ title: staged.title, content: staged.content });
    } else if (staged.type === 'email_reply') {
      window.dispatchEvent(new CustomEvent('tl-email-draft-update', { detail: { text: (staged as any).original || staged.content || '' } }));
    } else {
      setAppliedEdit(structuredClone(staged));
    }
    const msg = { role: 'assistant' as const, text: tr(lang,'✅ 已应用到编辑器。你可以继续修改或点击 **Save** 保存，也可以让我再调整。','✅ エディタに適用しました。引き続き編集するか **Save** をクリックして保存、または調整を依頼してください。','✅ Applied to editor. You can continue editing or click **Save** to save, or ask me to adjust.') };
    setMessages(prev => [...prev, msg]);
    if (currentSessionId) api.chat.addMessage({ sessionId: currentSessionId, ...msg }).catch(() => {});
  };
  const handleUndoEdit = (staged: StagedEdit) => {
    if (!staged.original) return;
    if (staged.type === 'task') {
      useUICommandStore.getState().enqueue({ type: 'apply_task_edit', payload: { title: staged.original.title || '', description: staged.original.description || '', status: staged.original.status || 'todo', priority: staged.original.priority || 'medium', storyPoints: staged.original.storyPoints ?? 0, __undo: true } });
    } else if (staged.type === 'report') {
      setAppliedReport({ title: staged.original.title, content: staged.original.content });
    } else {
      setAppliedEdit({ title: staged.original.title, content: staged.original.content, category: staged.original.category });
    }
    const msg = { role: 'assistant' as const, text: tr(lang,'↩ 已撤销修改，恢复到之前的内容。','↩ 変更を元に戻し、以前の内容に復元しました。','↩ Reverted changes back to previous content.') };
    setMessages(prev => [...prev, msg]);
    if (currentSessionId) api.chat.addMessage({ sessionId: currentSessionId, ...msg }).catch(() => {});
  };

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
  // Token estimation: CJK chars ≈2 tokens each, others ≈0.25 tokens (4 chars/token). Includes thinking content.
  const estimateTokens = (msgs: Array<{ text?: string; reasoningContent?: string }>) => {
    let tokens = 0;
    for (const m of msgs) {
      const combined = (m?.text || '') + (m?.reasoningContent || '');
      for (let i = 0; i < combined.length; i++) {
        const c = combined.charCodeAt(i);
        // CJK Unified (U+4E00-9FFF), CJK Ext A (U+3400-4DBF), Korean (U+AC00-D7AF), Japanese kana (U+3040-30FF)
        tokens += (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0x3040 && c <= 0x30FF) ? 2 : 0.25;
      }
    }
    return Math.ceil(tokens);
  };
  const currentTokens = useMemo(() => {
    // Skip running tasks (partial content) for token counting
    const raw = estimateTokens(messages.filter(m => m && (m.text != null || m.reasoningContent != null) && (m as any).status !== 'running'));
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
  }, []);
  const displayTokens = debugTokenOverride ?? (currentTokens * ((window as any).__tl_debug__?.tokenMultiplier || 1));

  // Save individual message to DB
  const sessionCreatingRef = useRef<Promise<string> | null>(null);
  const saveMsg = (msg: { role: 'user' | 'assistant'; text: string; tool?: string; staged?: StagedEdit; card?: ChatCard; reasoningContent?: string; pinnable?: boolean; _threadId?: string; _sessionId?: string }): Promise<any> => {
    const doSave = (sid: string): Promise<any> => {
      const _ea = (window as any).electronAPI;
      if (_ea?.log) _ea.log('[saveMsg] saving', { role: msg.role, hasCard: !!msg.card, cardType: msg.card?.type, textLen: msg.text?.length, reasoningLen: (msg.reasoningContent || '').length, sessionId: sid });
      return api.chat.addMessage({
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
      }).then((res: any) => {
        return res?.data;
      }).catch((e: any) => { console.error('[saveMsg] FAILED:', e?.message || e); return null; });
    };
    // Use explicit _sessionId if provided (per-session locking during streaming),
    // otherwise fall back to currentSessionId (UI actions like apply/undo edit).
    const sid = (msg as any)._sessionId || currentSessionId;
    if (sid) return doSave(sid);
    // Reuse in-flight session creation to avoid duplicates
    if (!sessionCreatingRef.current) {
      sessionCreatingRef.current = api.chat.createSession('Chat 1').then((s: any) => {
        setCurrentSessionId(s.id);
        setSessions(prev => [...prev, { id: s.id, title: s.title, tokenPercent: 0 }]);
        sessionCreatingRef.current = null;
        return s.id;
      });
    }
    return sessionCreatingRef.current!.then((sid2: string) => doSave(sid2)).catch(() => null);
  };

  const switchSession = (sid: string) => {
    setCurrentSessionId(sid);
    chatHook.switchSession(sid);
    chatHook.loadSession(sid);
  };
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const startRename = (s: { id: string; title: string }) => { setEditingSessionId(s.id); setEditTitle(s.title); };
  const clearSession = () => {
    setMessages([]);
    if (currentSessionId) api.chat.clearMessages(currentSessionId, chatHook.activeSessionId || null).catch(() => {});
  };
  const [compressConfirm, setCompressConfirm] = useState(false);
  const compressChat = () => { if (messages.length >= 4) setCompressConfirm(true); else setCompressMsg(t('chat.compressTooFew', lang)); };
  const [compressing, setCompressing] = useState(false);
  const [compressMsg, setCompressMsg] = useState('');
  const executeCompress = async () => {
    setCompressConfirm(false);
    if (messages.length < 4) { setCompressMsg(t('chat.compressTooFew', lang)); return; }
    setCompressing(true);
    try {
      // Keep last 3 message pairs intact, compress older messages
      const KEEP_RECENT = 6; // ~3 user+assistant pairs
      // Exclude running tasks and force-create internal messages
      const allMsgs = messages.filter(m => m && !(m.text || '').startsWith('__FORCE_CREATE__') && (m as any).status !== 'running');
      const recent = allMsgs.slice(-KEEP_RECENT);
      const older = allMsgs.slice(0, -KEEP_RECENT);
      if (older.length === 0) { setCompressing(false); setCompressMsg(t('chat.compressTooFew', lang)); return; }

      const history = older.map(m => {
        const entry: any = { role: m.role, content: m.text?.substring(0, 2000) };
        if (m?.reasoningContent) entry.reasoning_content = m?.reasoningContent;
        return entry;
      });
      const resp = await fetch('/api/agent/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Summarize our conversation above into a structured context summary. Keep it concise but preserve ALL of the following:

1. **Tasks Created/Modified**: Every TL- number, title, status, and priority mentioned
2. **Key Decisions**: What was agreed upon, rejected, or deferred
3. **Code Changes**: File paths, commit messages, bug fixes discussed
4. **Unfinished Items**: Tasks or discussions still in progress
5. **Important Context**: Facts that future conversations need to remember

Format with markdown headings (##). Do NOT add suggestions, offers to help, or polite closings — just the facts.`,
          history, lang,
        }),
      });
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('no stream');
      const decoder = new TextDecoder();
      let buffer = '', summary = '', currentEvent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim(); continue; }
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === 'error') { summary = '[Compress failed]'; break; }
            if (data.text) summary += data.text; // accumulate token text
            if (currentEvent === 'done' && !summary) summary = data.content || '';
          } catch {}
        }
        if (currentEvent === 'error') break;
      }
      if (summary) {
        const compressedMsg = { role: 'assistant' as const, text: `📋 **📦 Context Compressed**\n\n${summary.replace(/\n\n/g, '\n')}\n\n---\n💬 *Recent conversation kept intact below*` };
        const recentMsgs = recent.map(m => ({ role: m.role, text: m.text, tool: m.tool, staged: m.staged, card: m.card, reasoningContent: m?.reasoningContent }));
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
    if (pct >= 85 && messages.length >= 6 && !didAutoCompress.current && !compressing) {
      didAutoCompress.current = true;
      executeCompress();
    }
    if (pct < 50) didAutoCompress.current = false;
  }, [currentTokens, maxTokens, messages.length, compressing]);
  const commitRename = () => {
    if (editingSessionId && editTitle.trim()) {
      const newTitle = editTitle.trim();
      setSessions(prev => prev.map(s => s.id === editingSessionId ? { ...s, title: newTitle } : s));
      api.chat.renameSession(editingSessionId, newTitle).catch(() => {});
    }
    setEditingSessionId(null); setEditTitle('');
  };

  // Delete session
  const deleteSession = (sid: string) => {
    const newSessions = sessions.filter(s => s.id !== sid);
    setSessions(newSessions);
    chatHook.removeSession(sid);
    api.chat.deleteSession(sid).catch(() => {});
    if (sid === currentSessionId) {
      if (newSessions.length > 0) switchSession(newSessions[0].id);
      else {
        api.chat.createSession('Chat 1').then((s: any) => {
          setSessions([{ id: s.id, title: s.title, tokenPercent: 0 }]);
          setCurrentSessionId(s.id);
          chatHook.switchSession(s.id);
          chatHook.loadSession(s.id);
        }).catch(() => {});
      }
    }
  };
  const [editingNote, setEditingNote] = useState<{ id?: string; title: string; content: string; category: string } | null>(null);
  const [editingTask, setEditingTask] = useState<{ issueNumber?: number; title: string; description: string; status: string; priority: string; storyPoints?: number; editing?: boolean } | null>(null);
  const [editingReport, setEditingReport] = useState<{ title: string; content: string } | null>(null);
  const editingReportRef = useRef<{ title: string; content: string; id?: string } | null>(null);
  const [appliedReport, setAppliedReport] = useState<{ title?: string; content?: string } | null>(null);
  // Clear stale agent-applied edits when switching panels (prevents editor auto-open on re-entry)
  useEffect(() => { setAppliedEdit(null); setAppliedTaskEdit(null); setAppliedReport(null); }, [panel]);
  const [appliedTaskEdit, setAppliedTaskEdit] = useState<Record<string, any> | null>(null);
  const [noteRefresh, setNoteRefresh] = useState(0);
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [reportRefresh, setReportRefresh] = useState(0);
  const [emailRefresh, setEmailRefresh] = useState(0);
  // ─── Soft-gate: LLM API key check ───
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [gitConfigured, setGitConfigured] = useState(false);
  const [apikeyConfigured, setApikeyConfigured] = useState(false);
  const [standupConfigured, setStandupConfigured] = useState(false);
  const [mcpConfigured, setMcpConfigured] = useState(false);
  const [llmBannerDismissed, setLlmBannerDismissed] = useState(false);

  useEffect(() => {
    // Check all setup statuses, then decide whether to show welcome guide
    Promise.all([
      api.llm.getConfig().then((d: any) => !!d?.activeProvider?.hasKey).catch(() => false),
      fetch('/api/email.getConfig').then(r => r.json()).then(d => (d.result?.data || []).some((c: any) => c.type === 'imap')).catch(() => false),
      fetch('/api/git.listWorkDirs').then(r => r.json()).then(d => (d.result?.data || []).length > 0).catch(() => false),
      fetch('/api/apikey.list').then(r => r.json()).then(d => (d.result?.data || []).length > 0).catch(() => false),
      fetch('/api/standup.getSettings').then(r => r.json()).then(d => !!(d.result?.data?.evening)).catch(() => false),
      fetch('/api/mcpServer.list').then(r => r.json()).then(d => (d?.result?.data || []).filter((s: any) => s.enabled).length > 0).catch(() => false),
    ]).then(([hasLLM, hasEmail, hasGit, hasApikey, hasStandup, hasMcp]) => {
      setLlmConfigured(hasLLM);
      setEmailConfigured(hasEmail);
      setGitConfigured(hasGit);
      setApikeyConfigured(hasApikey);
      setStandupConfigured(hasStandup);
      setMcpConfigured(hasMcp);
      // If all DB settings are already configured → auto-dismiss (OTA user with everything set up)
      if (hasLLM && hasEmail && hasGit && hasApikey && hasStandup && hasMcp) {
        localStorage.setItem('tl-welcome-dismissed', '1');
      }
      // Show welcome guide if not dismissed
      if (localStorage.getItem('tl-welcome-dismissed') !== '1') setShowWelcome(true);
    });
  }, []);

  // Periodically re-check configs while welcome guide is visible (instant ✅ update)
  useEffect(() => {
    if (!showWelcome) return;
    const refresh = () => {
      Promise.all([
        api.llm.getConfig().then((d: any) => !!d?.activeProvider?.hasKey).catch(() => false),
        fetch('/api/email.getConfig').then(r => r.json()).then(d => (d.result?.data || []).some((c: any) => c.type === 'imap')).catch(() => false),
        fetch('/api/git.listWorkDirs').then(r => r.json()).then(d => (d.result?.data || []).length > 0).catch(() => false),
        fetch('/api/apikey.list').then(r => r.json()).then(d => (d.result?.data || []).length > 0).catch(() => false),
        fetch('/api/standup.getSettings').then(r => r.json()).then(d => !!(d.result?.data?.evening)).catch(() => false),
        fetch('/api/mcpServer.list').then(r => r.json()).then(d => (d?.result?.data || []).filter((s: any) => s.enabled).length > 0).catch(() => false),
      ]).then(([hasLLM, hasEmail, hasGit, hasApikey, hasStandup, hasMcp]) => {
        setLlmConfigured(hasLLM);
        setEmailConfigured(hasEmail);
        setGitConfigured(hasGit);
        setApikeyConfigured(hasApikey);
        setStandupConfigured(hasStandup);
        setMcpConfigured(hasMcp);
        if (hasLLM && hasEmail && hasGit && hasApikey && hasStandup && hasMcp) {
          localStorage.setItem('tl-welcome-dismissed', '1');
          setShowWelcome(false);
        }
      });
    };
    refresh();
    const iv = setInterval(refresh, 10000);
    return () => clearInterval(iv);
  }, [showWelcome]);

  const [notifyCount, setNotifyCount] = useState(0);
  const [mcpPending, setMcpPending] = useState(0);
  const [leaveTarget, setLeaveTarget] = useState<{ type: 'close' | 'menu'; key?: string } | null>(null);

  // Poll notification count (Cat-1 urgent emails + MCP pending) every 30s
  useEffect(() => {
    const poll = () => {
      fetch('/api/system.notifyCount').then(r => r.json()).then(d => {
        setNotifyCount(d.result?.data?.count || 0);
      }).catch(() => {});
      fetch('/api/mcp.pendingCount').then(r => r.json()).then(d => {
        setMcpPending(d.result?.data?.count || 0);
      }).catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, []);

  const [updateAvailable, setUpdateAvailable] = useState<any>(() => {
    try { const saved = localStorage.getItem('tl-update'); if (!saved) return null; const parsed = JSON.parse(saved); if (parsed.downloaded) { parsed.downloaded = false; } /* Ignore stale cache: only show if stored version is actually newer than current */ if (parsed.version && __APP_VERSION__ && parsed.version <= __APP_VERSION__) { localStorage.removeItem('tl-update'); return null; } return parsed; } catch { return null; }
  });
  // Clean stale download state on startup (electron-updater staging does not survive restart)
  useEffect(() => { try { localStorage.removeItem('tl-update-dl'); localStorage.removeItem('tl-update-done'); localStorage.removeItem('tl-update-path'); } catch {} }, []);
  // Persist update state so it survives app restart
  useEffect(() => {
    if (updateAvailable) localStorage.setItem('tl-update', JSON.stringify(updateAvailable));
    else localStorage.removeItem('tl-update');
  }, [updateAvailable]);
  const [morningNotify, setMorningNotify] = useState<string | null>(null);
  const [eveningNotify, setEveningNotify] = useState<string | null>(null);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [pinnedText, setPinnedText] = useState<string | null>(() => localStorage.getItem('tl-pinned-text'));
  useEffect(() => { if (pinnedText) localStorage.setItem('tl-pinned-text', pinnedText); else localStorage.removeItem('tl-pinned-text'); }, [pinnedText]);
  const msgsRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Morning check-in: poll for ready status (backend generates at set time - 5min)
  useEffect(() => {
    if (!sessionsLoaded) return;
    const today = new Date().toISOString().substring(0, 10);
    const check = () => {
      if (localStorage.getItem('tl-morning-date') === today) return; // already shown today
      api.standup.getMorningStatus().then((s: any) => {
        if (s?.ready) {
          api.standup.getMorningBrief(lang).then((data: any) => {
            if (data?.greeting) { setMorningNotify(data.greeting as string); localStorage.setItem('tl-morning-date', today); }
          }).catch(() => {});
        }
      }).catch(() => {});
    };
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, [sessionsLoaded, lang]);

  // Evening report: poll every 60s, show bubble when auto-generated
  useEffect(() => {
    if (!sessionsLoaded) return;
    const check = () => {
      api.standup.getEveningStatus().then((s: any) => {
        if (s?.notify && s.reportId) {
          const today = new Date().toISOString().substring(0, 10);
          if (localStorage.getItem('tl-evening-shown') !== today) {
            setEveningNotify(s.reportId);
          }
        }
      }).catch(() => {});
    };
    check();
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, [sessionsLoaded]);

  // Sync UI language to backend on startup (so evening report timer uses correct language)
  useEffect(() => {
    if (!sessionsLoaded) return;
    const savedLang = localStorage.getItem('tomilite-lang');
    if (savedLang && LANGS.includes(savedLang as any)) {
      fetch('/api/system.saveLanguage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: savedLang }) }).catch(() => {});
    }
  }, [sessionsLoaded]);
  const updateAvailableRef = useRef<any>(null); // stable ref for callbacks that can't re-register
  useEffect(() => { updateAvailableRef.current = updateAvailable; }, [updateAvailable]);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateSeen, setUpdateSeen] = useState(false); // clear About red dot once user views it
  const [updateTimedOut, setUpdateTimedOut] = useState(false); // fallback: no progress for >30 min
  const [updateError, setUpdateError] = useState(''); // actual download error from electron-updater
  const [stopDownloadConfirm, setStopDownloadConfirm] = useState(false);
  // Dismiss update notification & sync AboutTab via event (so it stops showing stale "downloading")
  const dismissUpdateNotification = () => {
    try { localStorage.removeItem('tl-update-dl'); } catch {}
    setUpdateAvailable((prev: any) => prev ? { version: prev.version, dismissed: true, downloaded: prev.downloaded || false } : prev);
    window.dispatchEvent(new CustomEvent('tl-update-dismissed'));
  };
  const [updateFilePath, setUpdateFilePath] = useState(() => {
    try { localStorage.removeItem('tl-update-path'); } catch {} return ''; // never survive restart
  });
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onUpdateAvailable) return; // browser dev mode — no electron
    api.onUpdateAvailable((info: any) => {
      setUpdateAvailable({ version: info.version, changelog: '', downloadUrl: '', publishedAt: info.releaseDate || '' });
      setUpdateSeen(false); // new update → show red dot again
      setUpdateTimedOut(false); // reset timeout
      setUpdateError(''); // clear any previous error
      try { localStorage.removeItem('tl-update-done'); } catch {} // clear stale completion flag
    });
    api.onUpdateNotAvailable(() => {
      setUpdateAvailable(null); // already on latest, clear stale localStorage state
    });
    // Listen for About tab re-download after user dismissed notification bar
    const onUndismissed = (e: Event) => {
      setUpdateAvailable((e as CustomEvent).detail);
      setUpdateProgress(0);
      setUpdateTimedOut(false);
    };
    window.addEventListener('tl-update-undismissed', onUndismissed);
    api.onDownloadProgress((p: any) => {
      const pct = p.percent || 0;
      setUpdateProgress(pct);
      setUpdateTimedOut(false); // progress = alive, reset timeout
      // Store download progress for About tab to read
      try { const d = JSON.parse(localStorage.getItem('tl-update-dl') || '{}'); localStorage.setItem('tl-update-dl', JSON.stringify({ ...d, progress: pct, lastProgress: Date.now() })); } catch {}
    });
    api.onUpdateError((msg: string) => {
      setUpdateError(msg || (_l('下载失败','ダウンロード失敗','Download failed')));
      setUpdateProgress(0);
      try { localStorage.removeItem('tl-update-dl'); } catch {}
    });
    api.onUpdateDownloaded((info: any) => {
      setUpdateProgress(100);
      setUpdateError(''); // clear any previous error
      const fp = info?.downloadedFile || info?.path || info?.installerPath || '';
      setUpdateFilePath(fp);
      try { if (fp) localStorage.setItem('tl-update-path', fp); } catch {}
      try { localStorage.removeItem('tl-update-dl'); } catch {} // clear stale progress for About tab
      try { const v = updateAvailableRef.current?.version; if (v) localStorage.setItem('tl-update-done', JSON.stringify({ version: v, time: Date.now() })); } catch {}
      setUpdateAvailable((prev: any) => prev ? { ...prev, downloaded: true } : prev);
    });
    return () => window.removeEventListener('tl-update-undismissed', onUndismissed);
  }, []);

  // Detect download timeout (>30 min with no progress events — fallback for hung downloads)
  useEffect(() => {
    const check = () => {
      try {
        const d = JSON.parse(localStorage.getItem('tl-update-dl') || '{}');
        const last = d?.lastProgress || d?.startTime || 0;
        if (d?.active && last && (Date.now() - last > 1800000)) {
          setUpdateTimedOut(true);
        }
      } catch {}
    };
    check();
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { msgsRef.current?.scrollTo(0, msgsRef.current.scrollHeight); }, [messages]);
  // Resize textarea only when line count changes (Enter/Shift+Enter), not on every keystroke
  const lineCount = query.split('\n').length;
  useEffect(() => {
    const el = textareaRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }
  }, [lineCount]);

  // Listen for agent-initiated panel navigation
  useEffect(() => {
    const handler = (e: Event) => setPanel((e as CustomEvent).detail);
    window.addEventListener('tl-navigate', handler);
    return () => window.removeEventListener('tl-navigate', handler);
  }, []);
  // Stable refs for callback closures — avoids re-registering event listeners on session/lang change
  const langRef = useRef(lang);
  langRef.current = lang;
  const sessionIdRef = useRef(currentSessionId);
  sessionIdRef.current = currentSessionId;
  const panelRef = useRef(panel);
  panelRef.current = panel;

  // Chat card actions
  useEffect(() => {
    const openInPanel = (card: ChatCard, editMode = false) => {
      if (card.type === 'task') {
        const detail = { id: card.id, key: card.key, title: card.title, status: card.status, priority: card.priority, description: card.description, storyPoints: card.storyPoints, editMode };
        (window as any).__tl_pendingTaskSelect = detail;
        setPanel('tasks');
        window.dispatchEvent(new CustomEvent('tl-select-task', { detail })); // fire even if panel already open
      }
      else if (card.type === 'note') {
        const detail = { id: card.id, title: card.title, category: card.category, content: card.content, editMode };
        (window as any).__tl_pendingNoteSelect = detail;
        setPanel('notes');
        window.dispatchEvent(new CustomEvent('tl-select-note', { detail }));
      }
      else if (card.type === 'report') {
        const detail = { id: card.id, title: card.title, reportType: card.reportType, editMode };
        (window as any).__tl_pendingReportSelect = detail;
        setPanel('reports');
        window.dispatchEvent(new CustomEvent('tl-select-report', { detail }));
      }
    };
    const onOpen = (e: Event) => openInPanel((e as CustomEvent).detail as ChatCard);
    const onEdit = (e: Event) => openInPanel((e as CustomEvent).detail as ChatCard, true);
    const onDelete = (e: Event) => {
      const card = (e as CustomEvent).detail as ChatCard;
      setDeleteTarget(card);
    };
    const onMove = (e: Event) => {
      const card = (e as CustomEvent).detail as ChatCard;
      if (card.type === 'task') { fetch('/api/issue.update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: card.id, status: card.status }) }).then(() => setTaskRefresh(n => n + 1)).catch(() => {}); }
    };
    const onForceCreate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Inject card type so backend knows which force_create_* to call
      const args = { ...detail.pendingArgs, _type: detail.type || 'task' };
      forceCreateRef.current = args;
      sendMessageRef.current?.('__FORCE_CREATE__ ' + JSON.stringify(args));
    };
    const onCancelDedup = () => {
      const cancelMsg = { role: 'assistant' as const, text: tr(langRef.current,'好的，已取消创建。','キャンセルしました。','OK, creation cancelled.') };
      setMessages(prev => {
        const copy = [...prev];
        // Mark the blocked card as resolved (disabled) + persist
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i]?.card?.blocked) {
            const msgId = copy[i].id;
            const updatedCard = { ...copy[i].card!, resolved: true };
            copy[i] = { ...copy[i], card: updatedCard };
            const _ea = (window as any).electronAPI;
            if (_ea?.log) _ea.log('[cancelDedup] m.id=' + msgId + ' blocked=true');
            if (msgId) { api.chat.updateMessage({ id: msgId, card: JSON.stringify(updatedCard) }).then(() => { if (_ea?.log) _ea.log('[cancelDedup] updateMessage OK id=' + msgId); }).catch((e: any) => { if (_ea?.log) _ea.log('[cancelDedup] updateMessage FAILED id=' + msgId + ' err=' + (e?.message || e)); }); } else { if (_ea?.log) _ea.log('[cancelDedup] NO m.id — cannot persist resolved state'); }
            break;
          }
        }
        copy.push(cancelMsg);
        return copy;
      });
      if (sessionIdRef.current) api.chat.addMessage({ sessionId: sessionIdRef.current, role: cancelMsg.role, text: cancelMsg.text }).catch(() => {});
    };
    window.addEventListener('tl-open-card', onOpen); window.addEventListener('tl-edit-card', onEdit);
    window.addEventListener('tl-delete-card', onDelete); window.addEventListener('tl-move-card', onMove);
    window.addEventListener('tl-force-create', onForceCreate); window.addEventListener('tl-cancel-dedup', onCancelDedup);
    const onSaveResult = (e: Event) => setSaveResult((e as CustomEvent).detail);
    window.addEventListener('tl-save-result', onSaveResult);
    return () => { window.removeEventListener('tl-open-card', onOpen); window.removeEventListener('tl-edit-card', onEdit); window.removeEventListener('tl-delete-card', onDelete); window.removeEventListener('tl-move-card', onMove); window.removeEventListener('tl-force-create', onForceCreate); window.removeEventListener('tl-cancel-dedup', onCancelDedup); window.removeEventListener('tl-save-result', onSaveResult); };
  }, []); // listeners registered once, refs keep values fresh

  // Delete card handler (component level, used by ConfirmDialog JSX)
  const executeDelete = () => {
    if (!deleteTarget) return;
    const card = deleteTarget;
    setDeleteTarget(null);
    setDeleting(true);
    // Export cards have no DB record — just disable the chat card
    const isExport = card.type === 'export_xlsx' || card.type === 'export_doc';
    const doDisable = () => {
      if (card.type === 'task') { setTaskRefresh(n => n + 1); /* Clear editor if deleted task is currently open */ if (editingTask?.issueNumber && card.key === `TL-${editingTask.issueNumber}`) { setEditingTask(null); window.dispatchEvent(new CustomEvent('tl-close-task-editor')); } }
      else if (card.type === 'note') { setNoteRefresh(n => n + 1); if (editingNote?.id === card.id) { setEditingNote(null); window.dispatchEvent(new CustomEvent('tl-close-note-editor')); } }
      else if (card.type === 'report') { setReportRefresh(n => n + 1); if ((editingReport as any)?.id === card.id) { setEditingReport(null); window.dispatchEvent(new CustomEvent('tl-close-report-editor')); } }
      setMessages(prev => prev.map(m => { if ((card.id && m.card?.id === card.id) || (card.key && m.card?.key === card.key)) { const updatedCard = JSON.stringify({ ...m.card, disabled: true, status: 'deleted' }); if (m.id) { api.chat.updateMessage({ id: m.id as string, card: updatedCard }).catch((e: any) => console.warn('[deleteCard] updateMessage FAILED:', e?.message || e)); } else { console.warn('[deleteCard] m.id missing — card state NOT persisted, cardId=' + card.id); } return { ...m, card: { ...m.card, disabled: true, status: 'deleted' } }; } return m; }));
    };
    if (isExport) {
      doDisable();
      const label = card.title || card.key || card.type;
      const text = lang === 'zh' ? `🗑️ 已删除 ${label}` : `🗑️ Deleted ${label}`;
      const msgId = crypto.randomUUID();
      saveMsg({ id: msgId, role: 'assistant', text, card: undefined } as any);
      // Defer setMessages + setDeleting to flush React 19 batch — otherwise deleting spinner never renders
      setTimeout(() => {
        setMessages(prev => {
          const idx = prev.findIndex(m => m && (card.id && m.card?.id === card.id) || (card.key && m.card?.key === card.key));
          const copy = [...prev];
          copy.splice(idx >= 0 ? idx + 1 : copy.length, 0, { id: msgId, role: 'assistant' as const, text });
          return copy;
        });
        setDeleting(false);
      }, 200);
      return;
    }
    const ep = card.type === 'task' ? '/api/issue.delete' : card.type === 'note' ? '/api/wiki.delete' : '/api/report.delete';
    fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: card.id }) }).then(() => {
      doDisable();
      // Persist delete confirmation message to DB
      const label = card.key || card.title;
      const text = lang === 'zh' ? `🗑️ 已删除 ${label}` : `🗑️ Deleted ${label}`;
      const msgId = crypto.randomUUID();
      saveMsg({ id: msgId, role: 'assistant', text, card: undefined } as any);
      setMessages(prev => {
        const idx = prev.findIndex(m => m && (card.id && m.card?.id === card.id) || (card.key && m.card?.key === card.key));
        const copy = [...prev];
        copy.splice(idx >= 0 ? idx + 1 : copy.length, 0, { id: msgId, role: 'assistant' as const, text });
        return copy;
      });
    }).catch(() => {}).finally(() => setDeleting(false));
  };

  // Panel lifecycle — enter/exit notifications + state cleanup
  const prevPanelRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPanelRef.current;
    prevPanelRef.current = panel;
    // Exit previous panel
    if (prev === 'notes' && panel !== 'notes') {
      setEditingNote(null);
      notifyI18n('exitedNotes');
    }
    if (prev === 'tasks' && panel !== 'tasks') {
      setEditingTask(null);
      notifyI18n('exitedTasks');
    }
    // Enter new panel
    if (panel === 'notes' && prev !== 'notes') {
      notifyI18n('enteredNotes');
    }
    if (panel === 'tasks' && prev !== 'tasks') {
      notifyI18n('enteredTasks');
    }
    if (panel === 'reports' && prev !== 'reports') {
      notifyI18n('enteredReports');
    }
    if (panel === 'email' && prev !== 'email') {
      notifyI18n('enteredEmail');
    }
    if (prev === 'reports' && panel !== 'reports') {
      setEditingReport(null);
      notifyI18n('exitedReports');
    }
    if (prev === 'email' && panel !== 'email') {
      notifyI18n('exitedEmail');
    }
  }, [panel]);

  // User action monitor — tells agent what the user is doing
  // NOTE: these are NOT persisted to DB — they're ephemeral context signals for the AI agent
  const notifyAgent = (text: string) => {
    const sysMsg = { role: 'assistant' as const, text: `🔔 *${text}*` };
    setMessages(prev => [...prev, sysMsg]);
  };
  const notifyI18n = (key: string, params?: Record<string, string>) => {
    const map: Record<string, Record<string, string>> = {
      enteredNotes: { zh: '打开了 Notes 面板', en: 'Opened Notes panel' },
      enteredTasks: { zh: '打开了 Tasks 面板', en: 'Opened Tasks panel' },
      exitedNotes: { zh: '退出了 Notes 面板', en: 'Exited Notes panel' },
      exitedTasks: { zh: '退出了 Tasks 面板', en: 'Exited Tasks panel' },
      enteredReports: { zh: '打开了 Reports 面板', en: 'Opened Reports panel' },
      exitedReports: { zh: '退出了 Reports 面板', en: 'Exited Reports panel' },
      enteredEmail: { zh: '打开了 Email 面板', en: 'Opened Email panel' },
      exitedEmail: { zh: '退出了 Email 面板', en: 'Exited Email panel' },
      openedReport: { zh: '用户打开了Report编辑', en: 'Opened report editor' },
      createdNote: { zh: '用户创建了新笔记', en: 'Created a new note' },
      openedNote: { zh: '用户打开了笔记《${title}》', en: 'Opened note "${title}"' },
      newTaskForm: { zh: '用户打开了新建Task表单「${title}」', en: 'Opened new task form "${title}"' },
      openedTask: { zh: '用户打开了 Task TL-${num}「${title}」', en: 'Opened task TL-${num} "${title}"' },
    };
    let msg = map[key]?.[lang] || map[key]?.en || key;
    if (params) { for (const [k, v] of Object.entries(params)) { msg = msg.replace('${' + k + '}', v); } }
    notifyAgent(msg);
  };

  const prevNoteIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!editingNote) { prevNoteIdRef.current = undefined; return; }
    const curId = editingNote.id || '__new__';
    if (curId !== prevNoteIdRef.current) {
      prevNoteIdRef.current = curId;
      const isNew = !editingNote.id;
      if (isNew) {
        notifyI18n('createdNote');
      } else {
        notifyI18n('openedNote', { title: editingNote.title || '' });
      }
      const msg = isNew
        ? { zh: `📝 **你正在创建新笔记**\n告诉我你的需求，我可以帮你：优化内容结构、翻译成其他语言、补充细节、修正语法……直接说出你的想法就好！`, en: `📝 **You're creating a new note**\nTell me what you need — I can help optimize structure, translate, add details, fix grammar... Just let me know!` }
        : { zh: `📔 **你正在编辑《${editingNote.title}》**\n需要我帮忙优化、翻译、改写吗？直接告诉我你的需求～`, en: `📔 **You're editing "${editingNote.title}"**\nNeed help optimizing, translating, or rewriting? Just tell me what you need~` };
      const newMsg = { role: 'assistant' as const, text: (msg as any)[lang] || (msg as any).en };
      setMessages(prevMsgs => [...prevMsgs, newMsg]);
      // Not persisted — context signal for AI, not permanent chat history
    }
  }, [editingNote]);

  // Task monitor — like note monitor, tells agent when user interacts with tasks
  const prevTaskIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!editingTask) { prevTaskIdRef.current = undefined; return; }
    const curId = editingTask.issueNumber;
    // Use -1 as tracking sentinel for new unsaved task form
    const trackingId = curId ?? -1;
    if (trackingId !== prevTaskIdRef.current) {
      prevTaskIdRef.current = trackingId;
      if (curId === undefined) {
        // New unsaved task form
        notifyI18n('newTaskForm', { title: editingTask.title || (tr(lang,'无标题','無題','Untitled')) });
        const msg = { role: 'assistant' as const, text: lang === 'zh' ? `📝 **你正在创建新Task**\n告诉我标题、描述、优先级，我帮你整理并创建～` : `📝 **You're creating a new task**\nTell me the title, description, and priority — I'll help organize and create it~` };
        setMessages(prevMsgs => [...prevMsgs, msg]);
      } else {
        // Existing task from list
        notifyI18n('openedTask', { num: String(curId), title: editingTask.title || '' });
        const msg = { role: 'assistant' as const, text: lang === 'zh' ? `📋 **你正在查看 TL-${curId}「${editingTask.title}」**\n状态: ${editingTask.status} · 优先级: ${editingTask.priority}${editingTask.storyPoints ? ` · ${editingTask.storyPoints}sp` : ''}\n需要我帮忙更新状态、修改内容，或者拆分子任务吗？` : `📋 **Viewing TL-${curId} "${editingTask.title}"**\nStatus: ${editingTask.status} · Priority: ${editingTask.priority}${editingTask.storyPoints ? ` · ${editingTask.storyPoints}sp` : ''}\nNeed help updating status, editing content, or splitting into subtasks?` };
        setMessages(prevMsgs => [...prevMsgs, msg]);
      }
    }
  }, [editingTask]);

  // Report monitor — fire once when panel opens
  const prevReportRef = useRef(false);
  useEffect(() => {
    if (!editingReport) { prevReportRef.current = false; return; }
    if (prevReportRef.current) return;
    prevReportRef.current = true;
    notifyI18n('openedReport');
    const msg = { role: 'assistant' as const, text: lang === 'zh' ? `📊 **你正在编辑报告**\n告诉我你的需求，我可以帮你：生成报告、优化内容、补充数据、调整格式。` : `📊 **You're editing a report**\nTell me what you need — I can help generate, optimize, add data, or adjust formatting.` };
    setMessages(prevMsgs => [...prevMsgs, msg]);
    // Not persisted — context signal for AI, not permanent chat history
  }, [editingReport]);


  // Pre-flight: instant panel navigation for explicit OPEN commands only.
  // Does NOT open panel for create commands — agent handles creation, C Plan cards show results.
  const preFlight = (msg: string) => {
    const m = msg.trim();
    if (/^(打开|open)\s*(task|任务).*一[览栏]/.test(m)) { setPanel('tasks'); return true; }
    if (/^(打开|open)\s*(note|笔记).*一[览栏]/.test(m)) { setPanel('notes'); return true; }
    if (/^(打开|open)\s*TL-(\d+)/i.test(m)) { setPanel('tasks'); return true; }
    if (/^(打开|open)\s*(report|报告)/i.test(m)) { setPanel('reports'); return true; }
    if (/^(打开|open)\s*(email|邮件|邮箱|メール)/i.test(m)) { setPanel('email'); return true; }
    return false;
  };

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
    setMessages(prev => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant') {
        const updated = { ...last, text: (last.text || '') + '\n\n---\n⏸️ *' + (tr(lang,'已中断','中断されました','Interrupted')) + '*' };
        copy[copy.length - 1] = updated;
        // Save interrupted message to DB (use addMessage — updateMessage would fail if record doesn't exist yet)
        api.chat.addMessage({ id: updated.id, sessionId: currentSessionId, role: updated.role, text: updated.text, card: updated.card ? JSON.stringify(updated.card) : undefined, reasoningContent: updated.reasoningContent }).catch(() => {});
      }
      return copy;
    });
  };

  const sendMessage = async (forcePayload?: string, noteActionPayload?: string) => {
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
    if (forcePayload?.startsWith('__FORCE_CREATE__') || (query.trim() === '__FORCE_CREATE__' && forceCreateRef.current)) {
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
        setMessages(prev => [...prev, { role: 'assistant' as const, text: '', status: 'running', controller }]);
      }
      let forceSuccess = false;
      try {
        const resp = await fetch('/api/agent/stream', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg, history: messages.filter(m => m && m.text && (m as any).status !== 'running').map(m => { const e: any = { role: m.role, content: m.text }; if (m?.reasoningContent) e.reasoning_content = m?.reasoningContent; return e; }), remainingTokens: Math.max(1000, maxTokens - currentTokens), lang }),
          signal: controller.signal,
        });
        if (resp.ok) {
          // Read the stream to get the result
          const reader = resp.body?.getReader();
          if (reader) {
            const decoder = new TextDecoder();
            let buffer = '', fullText = '', currentEvent = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (line.startsWith('event:')) { currentEvent = line.slice(6).trim(); continue; }
                if (!line.startsWith('data:')) continue;
                const raw = line.slice(5).trim();
                if (!raw.startsWith('{')) continue;
                try {
                  const data = JSON.parse(raw);
                  if (currentEvent === 'error') {
                    fullText = data.message || (tr(lang,'创建失败','作成失敗','Creation failed'));
                    break;
                  }
                  if (data.text) fullText += String(data.text || '');
                  if (currentEvent === 'done') {
                    if (data.content) fullText += (fullText ? '\n' : '') + data.content;
                    forceSuccess = true;
                  }
                  if (currentEvent === 'error') {
                    fullText = data.message || (tr(lang,'创建失败','作成失敗','Creation failed'));
                  }
                  if (currentEvent === 'debug') {
                    console.log('[LLM DEBUG]', JSON.stringify(data));
                    fullText += `\n\n🔍 **LLM Debug** | model: \`${data.model}\` | reasoning: ${data.reasoningLen} chars | content: ${data.contentLen} chars | toolCalls: ${data.toolCalls}${data.tools?.length ? ' [' + data.tools.join(', ') + ']' : ''}`;
                  }
                  if (data.tool && data.result) {
                    const r = data.result;
                    if (data.tool === 'force_create_note' && r.id) {
                      fullText += `\n\n> 📄 ${r.title || 'Untitled'}${r.category ? ` · \`${r.category}\`` : ''}`;
                      const card: ChatCard = { type: 'note', id: r.id, title: r.title || '', category: r.category || 'general', content: pendingArgs?.content || '' };
                      const msgId = crypto.randomUUID();
                      setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], role: 'assistant', text: fullText, card, id: msgId }; return copy; });
                      saveMsg({ id: msgId, role: 'assistant', text: fullText, card, _sessionId: lockedSid } as any);
                      setNoteRefresh(n => n + 1);
                      forceSuccess = true;
                    } else if (data.tool === 'force_create_report' && r.id) {
                      fullText += `\n\n> 📊 ${r.title || 'Untitled'}${r.reportType ? ` · \`${r.reportType}\`` : ''}`;
                      const card: ChatCard = { type: 'report', id: r.id, title: r.title || '', reportType: r.reportType || 'daily' };
                      const msgId = crypto.randomUUID();
                      setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], role: 'assistant', text: fullText, card, id: msgId }; return copy; });
                      saveMsg({ id: msgId, role: 'assistant', text: fullText, card, _sessionId: lockedSid } as any);
                      setReportRefresh(n => n + 1);
                      forceSuccess = true;
                    } else if (r.key) {
                      fullText += '\n\n> 🎫 **' + r.key + '** ' + (r.title || '') + ' · `' + (r.status || 'todo') + '`';
                      const card: ChatCard = { type: 'task', id: r.id || r.key, key: r.key, title: r.title || '', status: r.status || 'todo', description: pendingArgs?.description || '', priority: r.priority, issueType: r.type || 'task' };
                      const msgId = crypto.randomUUID();
                      setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], role: 'assistant', text: fullText, card, id: msgId }; return copy; });
                      saveMsg({ id: msgId, role: 'assistant', text: fullText, card, _sessionId: lockedSid } as any);
                      setTaskRefresh(n => n + 1);
                      forceSuccess = true;
                    }
                  }
                } catch {}
              }
            }
            if (!fullText.trim()) fullText = tr(lang,'✅ 创建成功','✅ 作成成功','✅ Created successfully');
            setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], role: 'assistant', text: fullText }; return copy; });
          }
        } else {
          // HTTP error from server
          setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], role: 'assistant' as const, text: tr(lang,'❌ 创建失败，请重试','❌ 作成失敗、再試行','❌ Creation failed, please retry') }; return copy; });
        }
      } catch (e: any) {
        setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], role: 'assistant' as const, text: (tr(lang,'❌ 网络错误','❌ ネットワークエラー','❌ Network error')) + ': ' + (e?.message || '') }; return copy; });
      }
      // Mark the original blocked card as resolved only if force-create succeeded
      if (forceSuccess) {
        setMessages(prev => {
          const copy = [...prev];
          for (let i = copy.length - 2; i >= 0; i--) {
            if (copy[i]?.card?.blocked && !copy[i]?.card?.resolved) {
              const updatedCard = { ...copy[i].card!, resolved: true };
              copy[i] = { ...copy[i], card: updatedCard };
              const _ea = (window as any).electronAPI;
              if (_ea?.log) _ea.log('[forceResolved] m.id=' + copy[i].id + ' blocked=true');
              if (copy[i].id) { api.chat.updateMessage({ id: copy[i].id as string, card: JSON.stringify(updatedCard) }).then(() => { if (_ea?.log) _ea.log('[forceResolved] updateMessage OK id=' + copy[i].id); }).catch((e: any) => { if (_ea?.log) _ea.log('[forceResolved] updateMessage FAILED id=' + copy[i].id + ' err=' + (e?.message || e)); }); } else { if (_ea?.log) _ea.log('[forceResolved] NO m.id — cannot persist resolved state'); }
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
    if (runningCount >= 3) { setAgentStatus(t('chat.tooMany', lang) || 'Max 3 concurrent tasks'); return; }
    const files = [...attachedFiles];
    setAttachedFiles([]);
    // Build message with attachments
    let fullMessage = q;
    // ─── Blocked card pending: LLM semantic classification + regex fallback ───
    const lastBlockedIdx = [...messages].reverse().findIndex(m => m && m.card?.blocked && m.card?.pendingArgs);
    const blockedMsg = lastBlockedIdx >= 0 ? messages[messages.length - 1 - lastBlockedIdx] : null;
    if (blockedMsg?.card?.blocked && blockedMsg.card?.pendingArgs) {
      const lastCard = blockedMsg.card;
      // Use LLM to classify user intent: confirm / cancel / other
      let intent: string = 'other';
      try {
        const res = await api.agent.classifyIntent({ message: q, cardType: lastCard.type, blockedTitle: lastCard.pendingArgs?.title || '' });
        intent = res?.intent || 'other';
      } catch { /* fall through to regex fallback */ }
      const resolveBlocked = (prev: any[]) => {
        const copy = [...prev];
        const idx = copy.findIndex(m => m && m.card?.blocked && !m.card?.resolved);
        if (idx >= 0) {
          const updatedCard = { ...copy[idx].card!, resolved: true };
          copy[idx] = { ...copy[idx], card: updatedCard };
          if (copy[idx].id) api.chat.updateMessage({ id: copy[idx].id, card: JSON.stringify(updatedCard) }).catch(() => {});
        }
        return copy;
      };
      if (intent === 'confirm') {
        const userMsgIdx = messages.length;
        const assistantIdx = userMsgIdx + 1;
        setMessages(prev => { const copy = resolveBlocked(prev); copy.push({ role: 'user', text: q }, { role: 'assistant' as const, text: '' }); return copy; });
        saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
        forceCreateRef.current = lastCard.pendingArgs;
        forceAssistantIdxRef.current = assistantIdx;
        setQuery('');
        try {
          sendMessage('__FORCE_CREATE__ ' + JSON.stringify(lastCard.pendingArgs));
        } catch {
          sendMessage('__FORCE_CREATE__ ' + JSON.stringify({ title: lastCard.pendingArgs?.title || '', _tool: lastCard.pendingArgs?._tool || 'force_create_issue' }));
        }
        return;
      }
      if (intent === 'cancel') {
        setMessages(prev => { const copy = resolveBlocked(prev); copy.push({ role: 'user', text: q }); copy.push({ role: 'assistant', text: tr(lang,'好的，已取消创建。','キャンセルしました。','OK, creation cancelled.') }); return copy; });
        saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
        return;
      }
      // Other → normal flow, but if message clearly looks like cancellation, handle as cancel
      if (/^(放弃|算了|不要了|别建了|取消吧|不创建|不需要|stop|cancel|abort|never.?mind)/i.test(q.trim())) {
        setMessages(prev => { const copy = resolveBlocked(prev); copy.push({ role: 'user', text: q }); copy.push({ role: 'assistant', text: tr(lang,'好的，已取消创建。','キャンセルしました。','OK, creation cancelled.') }); return copy; });
        saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
        setQuery('');
        return;
      }
    }
    // Pre-flight: open panels instantly, then still send to agent for deeper handling
    const didPreFlight = preFlight(q);
    // Check for acceptance keywords to apply staged suggestion
    const undoRe = /^(撤销|undo|revert|恢复|还原|回退)/i;
    const acceptRe = /^(接受|可以|好的|ok|yes|accept|apply|确认|sure|yep|yeah|行|好|可|保留)/i;
    const lastStaged = [...messages].reverse().find(m => m && m.staged);
    if (undoRe.test(q) && lastStaged?.staged?.original) {
      const orig = lastStaged.staged.original;
      setMessages(prev => [...prev, { role: 'user', text: q }]);
      saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
      fetch('/api/learn.capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ featureType: lastStaged.staged.type === 'task' ? 'suggest_issue_edit' : 'suggest_note_edit', aiOutput: JSON.stringify(lastStaged.staged).substring(0, 200), humanAction: 'REJECT' }) }).catch(() => {});
      if (lastStaged.staged.type === 'task') {
        useUICommandStore.getState().enqueue({ type: 'apply_task_edit', payload: { title: orig.title || '', description: orig.description || '', status: orig.status || 'todo', priority: orig.priority || 'medium', storyPoints: orig.storyPoints ?? 0, __undo: true } });
      } else if (lastStaged.staged.type === 'report') {
        setAppliedReport({ title: orig.title, content: orig.content });
      } else {
        setAppliedEdit({ title: orig.title, content: orig.content, category: orig.category });
      }
      setMessages(prev => [...prev, { role: 'assistant', text: tr(lang,'✅ 已恢复到修改前的内容。','✅ 以前の内容に復元しました。','✅ Reverted to previous content.') }]);
      return;
    }
    if (acceptRe.test(q) && lastStaged?.staged) {
      setMessages(prev => [...prev, { role: 'user', text: q }]);
      saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
      fetch('/api/learn.capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ featureType: lastStaged.staged.type === 'task' ? 'suggest_issue_edit' : 'suggest_note_edit', aiOutput: JSON.stringify(lastStaged.staged).substring(0, 200), humanAction: 'ACCEPT' }) }).catch(() => {});
      handleApplyEdit(lastStaged.staged);
      return;
    }
    // Soft-gate: check DB for LLM key (not cached state — avoids stale after Settings change)
    const hasLLM = llmConfigured || await api.llm.getConfig().then((d: any) => !!d?.activeProvider?.hasKey).catch(() => false);
    if (!llmConfigured && hasLLM) setLlmConfigured(true); // update stale cache
    if (!hasLLM) {
      setMessages(prev => [...prev,
        { role: 'user', text: q },
        { role: 'assistant', text: t('chat.noLLM', lang) },
      ]);
      saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
      setQuery('');
      return;
    }
    if (files.length > 0) {
      fullMessage += '\n\n[Attached files — put FULL content in create_note tool args. Reply in 1 sentence. Do NOT echo content in chat.]\n' + files.map(f => `--- ${f.name} ---\n${f.content}`).join('\n\n');
    }
    const history = messages.filter(m => m && m.text && !m.text.startsWith('__FORCE_CREATE__') && (m as any).status !== 'running').map(m => {
      const entry: any = { role: m.role, content: m.text };
      if (m?.reasoningContent) entry.reasoning_content = m?.reasoningContent;
      return entry;
    });
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    saveMsg({ role: 'user', text: q, _sessionId: lockedSid });
    chatHook.autoTitle();
    setThinking(true);
    setAgentStatus(t('chat.thinking', lang));
    // Push assistant placeholder + capture its real index (functional updater = no stale closure)
    let assistantIdx = -1;
    const streamController = new AbortController();
    setMessages(prev => { assistantIdx = prev.length; return [...prev, { role: 'assistant', text: '', status: 'running', controller: streamController }]; });

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
        if (/^(close|complete|finish|done|关闭|完成|结束|关掉)(\s|$|任务|这个|它)/.test(ql) || /\b(status|状态).*(done|完成)/.test(ql)) {
          intentHints.push(`User wants to CLOSE TL-${taskSnapshot.issueNumber}. Call update_issue with issueNumber=${taskSnapshot.issueNumber} status=done.`);
        } else if (/(move|start|begin|开始|做|进行|in.progress|in_progress)/.test(ql) && !/done/i.test(ql)) {
          intentHints.push(`User wants to MOVE TL-${taskSnapshot.issueNumber} to in_progress. Call update_issue with issueNumber=${taskSnapshot.issueNumber} status=in_progress.`);
        } else if (/set.*priority.*(high|low|critical|medium)/i.test(ql) || /(高|低|严重|中等).*优先/i.test(ql)) {
          const pm = ql.match(/priority.*(high|low|critical|medium)|(高|低|严重|中等).*优先/i);
          const p = pm?.[1] || (pm?.[2] === '高' ? 'high' : pm?.[2] === '低' ? 'low' : pm?.[2] === '严重' ? 'critical' : 'medium');
          intentHints.push(`User wants to change TL-${taskSnapshot.issueNumber} priority to ${p}. Call update_issue.`);
        }
      }
      if (intentHints.length > 0) {
        contextMsg += `\n⚠️ USER INTENT: ${intentHints.join(' ')}\n`;
      }
      const resp = await fetch('/api/agent/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: contextMsg + fullMessage, history, panelContext: panel, remainingTokens: Math.max(1000, maxTokens - currentTokens), lang }),
        signal: streamController.signal,
      });
      if (!resp.ok) throw new Error('stream failed');

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('no stream');
      const decoder = new TextDecoder();
      let buffer = '', fullText = '', doneContent = '', currentEvent = '', reasoningContent = '';
      let stagedData: any = null; // track staged edit across SSE loop, used in finalMsg (avoids closure issue)

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) { currentEvent = line.slice(line.indexOf(':') + 1).trim(); continue; }
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
              console.log('[LLM DEBUG]', JSON.stringify(data));
              continue;
            }
            if (currentEvent === 'thinking') {
              const label = lang === 'zh' ? `💭 思考中（第 ${data.iteration || '?'} 轮）` : lang === 'ja' ? `💭 考え中（${data.iteration || '?'}ラウンド目）` : `💭 Thinking... (round ${data.iteration || '?'})`;
              setAgentStatus(label);
              reasoningContent += (reasoningContent ? '\n' : '') + label;
              setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], reasoningContent }; return copy; });
              continue;
            }
            if (currentEvent === 'progress') {
              setAgentStatus(data.text || '');
              reasoningContent += (data.text || '');
              continue;
            }
            if (currentEvent === 'reasoning') {
              reasoningContent += (data.text || '');
              // Stream thinking to UI in real-time — user sees agent's thought process as it happens
              setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], reasoningContent }; return copy; });
              continue;
            }
            if (currentEvent === 'tool_call') {
              let label = `🔧 ${data.tool || t('chat.working', lang)}`;
              try { const a = JSON.parse(data.args || '{}'); const detail = a.query || a.title || a.issueNumber || a.command || ''; label += (detail ? ': ' + String(detail).substring(0, 60) : '...'); } catch { label += '...'; }
              reasoningContent += '\n' + label;
              setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], reasoningContent }; return copy; });
            }
            if (data.text) { fullText += String(data.text || ''); setAgentStatus(''); setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], text: fullText, status: 'running' }; return copy; }); }
            // Only tool_result events (not tool_call) should add to fullText. Tool names go to reasoningContent only.
            if (data.tool && data.args && currentEvent !== 'tool_call') {
              lastToolArgsRef.current = data.args;
              var cut2 = fullText.lastIndexOf('{');
              if (cut2 >= 0) fullText = fullText.substring(0, cut2).trimEnd();
              var brief2 = '';
              try { var a2 = JSON.parse(data.args); brief2 = a2.title ? ' ' + String(a2.title).substring(0, 40) : ''; } catch (e: any) { brief2 = ' ERR:' + e.message; }
              fullText += '\n🔧 ' + data.tool + brief2;
            }
            let msgCard: ChatCard | undefined;
            if (data.tool && data.result) {
              const r = data.result;
              // Capture tool result in thinking section
              const resultBrief = r?.error ? `❌ ${r.error}` : r?.blocked ? `🚫 blocked (${r.duplicates?.length || 0} similar)` : r?.key ? `✅ ${r.key}` : r?.id ? `✅ ${r.id?.substring(0, 8)}` : '✅ done';
              reasoningContent += '\n🔧 ' + data.tool + ' → ' + resultBrief;
              setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], reasoningContent }; return copy; });
              dispatchUICommand(data.tool, data.result);
              if (data.tool === 'suggest_note_edit' && r.staged) {
                const f = r._full || r;
                stagedData = { title: f.title, content: f.content || '', category: f.category, original: noteSnapshot ? { title: noteSnapshot.title, content: noteSnapshot.content, category: noteSnapshot.category } : undefined, type: 'note' as any };
              } else if ((data.tool === 'suggest_report_edit' || data.tool === 'polish_report' || data.tool === 'summarize_report' || data.tool === 'expand_report' || data.tool === 'translate_report') && r.staged) {
                const f = r._full || r;
                stagedData = { title: f.title, content: f.content || '', original: reportSnapshot ? { title: reportSnapshot.title, content: reportSnapshot.content } : undefined, type: 'report' as any };
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
                    setAppliedTaskEdit({ title: origTitle, description: f.description || '', status: f.status || taskSnapshot.status, priority: f.priority || taskSnapshot.priority, storyPoints: f.storyPoints ?? taskSnapshot.storyPoints });
                    fullText += lang === 'zh' ? '\n\n⚠️ 标题与当前任务不匹配，仅应用了其他字段。如需新建请使用 create_issue。' : '\n\n⚠️ Title mismatch — only other fields applied. Use create_issue for a new task.';
                  } else {
                    setAppliedTaskEdit({ title: f.title, description: f.description || '', status: f.status, priority: f.priority, storyPoints: f.storyPoints });
                  }
                }
              } else if (data.tool === 'edit_email_reply' && r.staged) {
                stagedData = { ...r, type: 'email_reply' as any };
                setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], staged: stagedData }; return copy; });
                fullText += lang === 'zh' ? `\n\n---\n📧 **回复草稿已更新**。回复「撤销」恢复原稿。` : lang === 'ja' ? `\n\n---\n📧 **返信下書きが更新されました**。「元に戻す」で復元。` : `\n\n---\n📧 **Reply draft updated**. Reply "undo" to revert.`;
              } else if (data.tool === 'list_emails') {
                const list = Array.isArray(r) ? r : [];
                fullText += list.length === 0 ? `\n📭 0` : `\n📧 ${list.length}`;
              } else if (data.tool === 'send_email_reply') {
                setEmailRefresh(n => n + 1);
              } else if (data.tool === 'read_email_original') {
                fullText += `\n${(r.body || '').substring(0, 300)}`;
              } else if (data.tool === 'dismiss_email') {
                setEmailRefresh(n => n + 1);
              } else if (data.tool === 'delete_email') {
                setEmailRefresh(n => n + 1);
              } else if (data.tool === 'export_to_excel' || data.tool === 'export_to_doc') {
                if (r.filePath) {
                  cardRef.current = { type: r.type === 'xlsx' ? 'export_xlsx' as any : 'export_doc' as any, id: r.filePath, title: r.filename, key: r.filePath, status: r.filePath, description: `${(r.size / 1024).toFixed(1)}KB` };
                  fullText += `\n\n📥 ${r.type === 'xlsx' ? '📊 Excel' : '📝 Word'} **${r.filename}** (${(r.size / 1024).toFixed(1)}KB)`;
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
              if (data.tool === 'create_note' || data.tool === 'force_create_note' || data.tool === 'update_note') setNoteRefresh(n => n + 1);
              if (data.tool === 'create_issue' || data.tool === 'force_create_issue' || data.tool === 'update_issue') setTaskRefresh(n => n + 1);
              if (data.tool === 'create_report' || data.tool === 'force_create_report' || data.tool === 'update_report') setReportRefresh(n => n + 1);
              // Build inline card
              if ((data.tool === 'create_issue' || data.tool === 'create_note' || data.tool === 'create_report') && r.blocked) {
                // Duplicate blocked — render with Force/Cancel buttons
                const blockedType = data.tool === 'create_note' ? 'note' : data.tool === 'create_report' ? 'report' : 'task';
                const forceTool = data.tool === 'create_note' ? 'force_create_note' : data.tool === 'create_report' ? 'force_create_report' : 'force_create_issue';
                msgCard = { type: blockedType, title: r.pendingArgs?.title || '', blocked: true, duplicates: r.duplicates, pendingArgs: { ...r.pendingArgs, _tool: forceTool } };
              } else if ((data.tool === 'create_issue' || data.tool === 'force_create_issue') && r.key) {
                let toolArgs: any = {};
                try { toolArgs = JSON.parse(lastToolArgsRef.current || '{}'); } catch {}
                msgCard = { type: 'task', id: r.id || r.key, key: r.key, title: r.title || '', status: r.status || 'todo', description: toolArgs.description || '', priority: r.priority, storyPoints: toolArgs.storyPoints, issueType: r.type || 'task' };
              } else if ((data.tool === 'create_note' || data.tool === 'force_create_note') && r.id) {
                let noteArgs: any = {};
                try { noteArgs = JSON.parse(lastToolArgsRef.current || '{}'); } catch {}
                msgCard = { type: 'note', id: r.id, title: r.title || '', category: r.category || 'general', content: noteArgs.content || '' };
              } else if ((data.tool === 'create_report' || data.tool === 'force_create_report') && r.id) {
                msgCard = { type: 'report', id: r.id, title: r.title || '', reportType: r.reportType || 'daily' };
              } else {
              }
            }
            // Export cards have priority — don't let create_report/etc overwrite them
            if (msgCard && cardRef.current?.type !== 'export_xlsx' && cardRef.current?.type !== 'export_doc') { cardRef.current = msgCard; }
            // Prefer export card over any subsequent tool card
            const cardForMsg = (cardRef.current?.type === 'export_xlsx' || cardRef.current?.type === 'export_doc') ? cardRef.current : (msgCard || cardRef.current);
            setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], role: 'assistant', text: fullText, card: cardForMsg }; return copy; });
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
          fullText = tr(lang,'抱歉，AI 未返回内容。请重试或检查 API 配置。','AIが応答しませんでした。再試行するか、API設定を確認してください。','Sorry, the AI returned no content. Please retry or check your API configuration.');
        }
      }
      const finalMsg: any = { id: crypto.randomUUID(), role: 'assistant' as const, text: displayText || fullText, card: cardRef.current, reasoningContent: reasoningContent || undefined };
      const _elog = (window as any).electronAPI?.log;
      if (_elog) _elog('[finalMsg] reasoningLen=' + (reasoningContent || '').length + ' hasTools=' + reasoningContent.includes('🔧'));
      if (stagedData) finalMsg.staged = stagedData;
      setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...finalMsg }; return copy; });
      saveMsg({ ...finalMsg, _sessionId: lockedSid });
      setMessages(prev => { const copy = [...prev]; if (copy[assistantIdx]) copy[assistantIdx] = { ...copy[assistantIdx], status: 'done' as const }; return copy; });
    } catch (e: any) {
      setMessages(prev => { const copy = [...prev]; if (copy[assistantIdx]) copy[assistantIdx] = { ...copy[assistantIdx], status: (e?.name === 'AbortError' ? 'aborted' : 'error') as const }; return copy; });
      if (e?.name === 'AbortError') {
        // Stream was interrupted by user — no fallback, message already cleaned up by stopStream
      } else {
        setAgentStatus('');
        const errMsg = e?.message || e?.toString() || 'Unknown error';
        setMessages(prev => { const copy = [...prev]; copy[assistantIdx] = { ...copy[assistantIdx], role: 'assistant' as const, text: (lang === 'zh' ? `❌ 调用失败: ${errMsg}` : `❌ Call failed: ${errMsg}`) }; return copy; });
      }
    }
    setThinking(false);
  };
  sendMessageRef.current = sendMessage; // keep ref fresh for onForceCreate callback


  // Show loading while sessions load (avoids black flash on first launch)
  if (!sessionsLoaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', flexDirection: 'column', fontFamily: 'sans-serif' }}>
        <svg width="60" height="60" viewBox="0 0 20 20" style={{ fill: '#4338CA', animation: 'pulse 2s ease-in-out infinite' }}>
          <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
        </svg>
        <style>{'@keyframes pulse{0%,100%{opacity:.4;transform:scale(.9)}50%{opacity:1;transform:scale(1.1)}}'}</style>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)', marginTop: 16 }}>TomiLite</div>
        <div style={{ width: 200, height: 3, background: 'var(--surface2)', borderRadius: 2, marginTop: 12, overflow: 'hidden' }}>
          <div style={{ width: '30%', height: '100%', background: 'linear-gradient(90deg,#4338CA,#6366f1)', borderRadius: 2, animation: 'barSlide 1.5s ease-in-out infinite' }} />
        </div>
        <style>{'@keyframes barSlide{0%{transform:translateX(-30%)}100%{transform:translateX(330%)}}'}</style>
      </div>
    );
  }

  return (
    <div className="app-root">
      <div className="app-shell">
        <div className="session-sidebar">
          <div className="session-sidebar-hd">
            <button className="session-new-btn" onClick={() => { api.chat.createSession(`Chat ${sessions.length + 1}`).then((s: any) => { setSessions(prev => [{ id: s.id, title: s.title, tokenPercent: 0 }, ...prev]); setCurrentSessionId(s.id); chatHook.switchSession(s.id); chatHook.loadSession(s.id); }).catch(() => {}); }}>{t('menu.newChat', lang)}</button>
          </div>
          <div className="session-list">
            {sessions.map(s => (
              <div key={s.id} className={cn('session-item', currentSessionId === s.id && 'session-item--active')} onClick={() => switchSession(s.id)} onDoubleClick={() => startRename(s)}>
                {editingSessionId === s.id ? (
                  <input className="form-input" value={editTitle} onChange={e => setEditTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingSessionId(null); }}
                    onBlur={commitRename} autoFocus onClick={e => e.stopPropagation()}
                    style={{ fontSize: 11, padding: '2px 6px', flex: 1 }} />
                ) : (
                  <span className="session-item-title">{s.title}</span>
                )}
                <button className="session-item-delete" onClick={e => { e.stopPropagation(); deleteSession(s.id); }}>×</button>
              </div>
            ))}
          </div>
          {(() => {
            const pct = Math.min(100, Math.round((displayTokens / Math.max(maxTokens, 1)) * 100));
            if (!debugForceShow && pct < 50) return null;
            const isWarn = pct >= 80;
            const warnColor = isWarn ? 'var(--amber)' : 'var(--muted)';
            const hoverText = isWarn ? (lang === 'zh' ? `剩余 ${100-pct}% 上下文空间，点击压缩` : `${100-pct}% context remaining — click to compress`) : '';
            return (
              <div style={{ padding: '6px 12px', borderTop: '1px solid var(--edge)', flexShrink: 0, cursor: isWarn ? 'pointer' : 'default' }} onClick={isWarn ? compressChat : undefined} title={hoverText}>
                <div style={{ height: 3, borderRadius: 2, background: 'var(--surface2)', overflow: 'hidden', marginBottom: 4 }}>
                  <div style={{ height: '100%', width: pct + '%', background: warnColor, borderRadius: 2, transition: 'width .3s' }} />
                </div>
                <div style={{ fontSize: 9, color: warnColor, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{displayTokens >= 1000 ? Math.round(displayTokens / 1000) + 'k' : displayTokens} / {maxTokens >= 1000 ? Math.round(maxTokens / 1000) + 'k' : maxTokens} {t('chat.tokens', lang)}</span>
                  <span>{pct}%</span>
                </div>
              </div>
            );
          })()}
        </div>
        <div className="main-chat-wrapper">
          <div className="app-viewport" style={dragOver ? { outline: '2px dashed var(--brand)', outlineOffset: -4 } : {}}
            onPaste={async (e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const files: File[] = [];
              for (let i = 0; i < items.length; i++) {
                const f = items[i].getAsFile();
                if (f && f.size > 0) files.push(f);
              }
              if (files.length > 0) { e.preventDefault(); await handleFiles(files); }
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
            onDrop={async (e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer?.files?.length) await handleFiles(e.dataTransfer.files); }}
          >
            <div className="app-viewport-chat">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px 2px', flexShrink: 0, minHeight: 28 }}>
                {/* Left: language + theme */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ position: 'relative' }}>
                    <button onClick={() => setLangMenuOpen(!langMenuOpen)} className="lang-btn lang-btn--active" style={{ padding: '2px 8px', fontSize: 10, gap: 3 }}>{LANGS_FULL[lang]} ▼</button>
                    {langMenuOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 8, padding: 4, minWidth: 130, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                        {LANGS.map(l => (
                          <button key={l} onClick={() => { setLang(l); setLangMenuOpen(false); fetch('/api/system.saveLanguage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: l }) }).catch(() => {}); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 10px', fontSize: 11, border: 'none', borderRadius: 4, background: lang === l ? 'var(--surface2)' : 'transparent', color: lang === l ? 'var(--brand)' : 'var(--ink)', cursor: 'pointer', fontWeight: lang === l ? 600 : 400, fontFamily: 'inherit' }}>
                            {LANGS_FULL[l]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span style={{ width: 1, height: 14, background: 'var(--edge)', margin: '0 2px' }} />
                  <div className="theme-dots" style={{ display: 'flex', gap: 3 }}>
                    {THEMES.map(th => (<button key={th} onClick={() => setTheme(th)} title={th} className={cn('theme-dot', theme === th && 'theme-dot--active')} style={{ background: THEME_COLORS[th] }} />))}
                  </div>
                </div>
                {/* Right: compress + clear */}
                {messages.length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={compressChat} disabled={compressing} className="btn-ghost btn-xs" title={t('chat.compressTooltip', lang)} style={{ fontSize: 10, color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                      {compressing ? t('chat.compressing', lang) : t('chat.compress', lang)}
                    </button>
                    <button onClick={clearSession} className="btn-ghost btn-xs" title={t('chat.clearTooltip', lang)} style={{ fontSize: 10, color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                      {t('chat.clear', lang)}
                    </button>
                  </div>
                )}
              </div>
              {updateAvailable && !updateAvailable.dismissed && (
                <div className="update-bar">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {updateError ? (
                    <span>❌ <strong>v{updateAvailable.version}</strong> {updateError}</span>
                  ) : updateProgress > 0 && updateProgress < 100 ? (
                    <span>⬇️ <strong>v{updateAvailable.version}</strong> {tr(lang,'下载中','ダウンロード中','Downloading')}... {Math.round(updateProgress)}%</span>
                  ) : updateAvailable.downloaded ? (
                    <span>✅ <strong>v{updateAvailable.version}</strong> {tr(lang,'已下载，点击安装','ダウンロード完了','Downloaded — click to install')}</span>
                  ) : updateTimedOut ? (
                    <span>⚠️ <strong>v{updateAvailable.version}</strong> {_l('下载超时，请重试','ダウンロードタイムアウト、再試行','Download timed out, retry')}</span>
                  ) : (
                    <span>🚀 <strong>v{updateAvailable.version}</strong> {tr(lang,'可用','利用可能','available')}</span>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    {updateAvailable.downloaded ? (
                      <button className="btn btn-brand btn-xs" onClick={async () => { const api = (window as any).electronAPI; if (api?.installUpdate) { try { const r = await api.installUpdate(); if (r && !r.ok) { setSaveResult({ ok: false, message: lang === 'zh' ? `安装失败: ${r.error || '未知错误'}, 请重试下载` : `Install failed: ${r.error || 'unknown'}. Please retry download.` }); setUpdateAvailable((prev: any) => prev ? { ...prev, downloaded: false } : prev); } } catch(e: any) { setSaveResult({ ok: false, message: lang === 'zh' ? '安装启动失败，请重试' : 'Install failed, please retry.' }); } } }}>{tr(lang,'安装并重启','インストールして再起動','Install & Restart')}</button>
                    ) : updateProgress > 0 ? null : (
                      <button className="btn btn-brand btn-xs" onClick={() => { const api = (window as any).electronAPI; if (api?.startDownload) { setUpdateTimedOut(false); setUpdateError(''); api.startDownload(); setUpdateProgress(0.1); try { localStorage.setItem('tl-update-dl', JSON.stringify({ active: true, startTime: Date.now(), progress: 0 })); } catch {} } else { window.open(updateAvailable.downloadUrl || 'https://tomatovector.com/tomilite', '_blank'); } }}>{(updateError || updateTimedOut) ? (_l('🔄 重试','🔄 再試行','🔄 Retry')) : t('chat.download', lang)}</button>
                    )}
                    <button className="btn-ghost btn-xs" onClick={() => { if (updateProgress > 0 && updateProgress < 100) { setStopDownloadConfirm(true); } else { dismissUpdateNotification(); } }}>✕</button>
                  </div>
                  </div>
                  {updateFilePath && <div style={{ fontSize: 9, color: 'var(--blue)', wordBreak: 'break-all', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { const api = (window as any).electronAPI; if (api?.openFolder) api.openFolder(updateFilePath); }}>📁 {updateFilePath}</div>}
                  {updateProgress > 0 && updateProgress < 100 && (
                    <div style={{ height: 3, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden', marginTop: 2 }}>
                      <div style={{ width: `${Math.round(updateProgress)}%`, height: '100%', background: 'var(--brand)', borderRadius: 2, transition: 'width 0.3s ease' }} />
                    </div>
                  )}
                </div>
              )}
              {pinnedText && (
                <div className="pinned-bar">
                  <span style={{ flex: 1, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{pinnedText}</span>
                  <button className="btn btn-xs" style={{ flexShrink: 0, background: 'var(--surface2)', border: '1px solid var(--edge)', borderRadius: 4, padding: '2px 10px', fontSize: 10, cursor: 'pointer', color: 'var(--ink)' }} onClick={() => setPinnedText(null)}>{tr(lang,'取消置顶','ピン留め解除','Unpin')}</button>
                </div>
              )}
              <div ref={msgsRef} className="chat-messages" style={{ borderTop: '1px solid var(--edge)', borderBottom: '1px solid var(--edge)' }}>
                {showWelcome && (<div className="welcome"><div className="welcome-robot"><RobotFace size={36} /></div><div className="welcome-title">{t('app.welcomeTitle', lang)}</div><div className="welcome-desc">{t('app.welcomeDesc', lang)}</div>
                  {/* Simplified setup guide */}
                  <div style={{ marginTop: 16, maxWidth: 380, textAlign: 'left', margin: '16px auto 0' }}>
                    {/* LLM */}
                    <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 17 }}>🤖</span>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupLlm', lang)}</span>
                      {llmConfigured ? (
                        <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
                      ) : (
                        <button className="btn btn-brand btn-xs" style={{ whiteSpace: 'nowrap' }} onClick={() => { (window as any).__tl_settingsTab = 'llm'; window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' })); }}>{t('app.welcomeSetupConfigure', lang)}</button>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
                      {t('app.welcomeSetupLlmDesc', lang)}
                    </div>
                    {!llmConfigured && (
                      <div style={{ fontSize: 10, color: 'var(--amber)', margin: '-6px 8px 10px', lineHeight: 1.5, fontWeight: 500 }}>
                        {t('app.welcomeSetupLlmPriority', lang)}
                      </div>
                    )}
                    {/* Email */}
                    <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 17 }}>📧</span>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupEmail', lang)}</span>
                      {emailConfigured ? (
                        <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
                      ) : (
                        <button className="btn btn-xs" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--edge)', whiteSpace: 'nowrap', fontSize: 10 }} onClick={() => { (window as any).__tl_settingsTab = 'email'; window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' })); }}>{t('app.welcomeSetupConfigure', lang)}</button>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
                      {t('app.welcomeSetupEmailDesc', lang)}
                    </div>
                    {/* Git */}
                    <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 17 }}>📂</span>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupGit', lang)}</span>
                      {gitConfigured ? (
                        <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
                      ) : (
                        <button className="btn btn-xs" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--edge)', whiteSpace: 'nowrap', fontSize: 10 }} onClick={() => { (window as any).__tl_settingsTab = 'git'; window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' })); }}>{t('app.welcomeSetupConfigure', lang)}</button>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
                      {t('app.welcomeSetupGitDesc', lang)}
                    </div>
                    {/* API Keys */}
                    <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 17 }}>🔑</span>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupApikey', lang)}</span>
                      {apikeyConfigured ? (
                        <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
                      ) : (
                        <button className="btn btn-xs" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--edge)', whiteSpace: 'nowrap', fontSize: 10 }} onClick={() => { (window as any).__tl_settingsTab = 'apikey'; window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' })); }}>{t('app.welcomeSetupConfigure', lang)}</button>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
                      {t('app.welcomeSetupApikeyDesc', lang)}
                    </div>
                    {/* Standup */}
                    <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 17 }}>📅</span>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupStandup', lang)}</span>
                      {standupConfigured ? (
                        <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
                      ) : (
                        <button className="btn btn-xs" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--edge)', whiteSpace: 'nowrap', fontSize: 10 }} onClick={() => { (window as any).__tl_settingsTab = 'standup'; window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' })); }}>{t('app.welcomeSetupConfigure', lang)}</button>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
                      {t('app.welcomeSetupStandupDesc', lang)}
                    </div>
                    {/* MCP Servers */}
                    <div style={{ padding: '8px 12px', marginBottom: 6, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 17 }}>🔌</span>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>{t('app.welcomeSetupMcp', lang)}</span>
                      {mcpConfigured ? (
                        <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>✅</span>
                      ) : (
                        <button className="btn btn-xs" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--edge)', whiteSpace: 'nowrap', fontSize: 10 }} onClick={() => { (window as any).__tl_settingsTab = 'mcpServers'; window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' })); }}>{t('app.welcomeSetupConfigure', lang)}</button>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', margin: '0 8px 10px', lineHeight: 1.5 }}>
                      {t('app.welcomeSetupMcpDesc', lang)}
                    </div>
                    {/* Language + Theme row */}
                    <div style={{ padding: '8px 12px', marginBottom: 8, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--edge)', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 17 }}>🌐</span>
                      <select className="form-select" style={{ fontSize: 11, padding: '3px 6px', flex: 1 }} value={lang} onChange={e => { const newLang = e.target.value; setLang(newLang as Lang); fetch('/api/system.saveLanguage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: newLang }) }).catch(() => {}); }}>
                        {LANGS.map(l => <option key={l} value={l}>{LANGS_FULL[l]}</option>)}
                      </select>
                      <span style={{ fontSize: 17 }}>🎨</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {THEMES.map(th => (
                          <button key={th} onClick={() => setTheme(th)} title={th}
                            style={{ width: 18, height: 18, borderRadius: 4, background: THEME_COLORS[th], border: theme === th ? '2px solid var(--ink)' : '1px solid var(--edge)', cursor: 'pointer' }} />
                        ))}
                      </div>
                    </div>
                    {/* Congratulations or Start button */}
                    {llmConfigured && emailConfigured && gitConfigured && apikeyConfigured && standupConfigured && mcpConfigured ? (
                      <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
                        <div style={{ fontSize: 15, marginBottom: 2 }}>🎉</div>
                        <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, marginBottom: 8 }}>
                          {t('app.welcomeSetupDone', lang)}
                        </div>
                        <button className="btn btn-brand btn-sm" onClick={() => { localStorage.setItem('tl-welcome-dismissed', '1'); setShowWelcome(false); }}>
                          {t('app.welcomeStart', lang)}
                        </button>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
                        <button className="btn btn-brand btn-sm" onClick={() => { setShowWelcome(false); }}>
                          {t('app.welcomeSkip', lang)}
                        </button>
                        <div style={{ marginTop: 6 }}>
                          <button className="btn-ghost btn-xs" style={{ color: 'var(--muted)', fontSize: 10 }} onClick={() => { setShowWelcome(false); localStorage.setItem('tl-welcome-dismissed', '1'); }}>
                            {t('app.welcomeDontShow', lang)}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="suggestions" style={{ marginTop: 10 }}>{['app.sugg1','app.sugg2','app.sugg3','app.sugg4','app.sugg5'].map(k => (<span key={k} className="suggestion-chip" onClick={() => sendMessage(_t(k, lang))}>{_t(k, lang)}</span>))}</div></div>)}
                {messages.filter(m => m != null).map((m, i) => { const pinnable = !!(m as any).pinnable || (m.role === 'assistant' && m.tool === 'greeting'); const pinned = pinnable && !!pinnedText && pinnedText === m.text; return <Msg key={i} role={m.role} text={m.text} tool={m.tool} staged={m.staged} card={m.card} onApply={handleApplyEdit} onUndo={handleUndoEdit} thinking={thinking} pinnable={pinnable} isPinned={pinned} onPin={(t) => setPinnedText(prev => prev === t ? null : t)} reasoningContent={(m as any).reasoningContent} />; })}
                {thinking && (
                  <div className="msg msg--assistant" style={{ marginBottom: 4 }}>
                    <div className="msg-bubble msg-bubble--assistant" style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.7 }}>
                      <span className="agent-spinner" style={{ width: 14, height: 14, border: '2px solid var(--edge)', borderTopColor: 'var(--brand)', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite' }} />
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{agentStatus || t('chat.working', lang)}</span>
                    </div>
                  </div>
                )}
              </div>
              {/* Always-visible navigation toolbar */}
              <div className="menu-popup">{MENU.map(m => (<button key={m.key} className={cn('menu-item', m.key === panel && 'menu-item--active')}
                onClick={() => {
                  if ((window as any).__tl_unsaved && m.key !== panel) {
                    setLeaveTarget({ type: 'menu', key: m.key });
                    return;
                  }
                  setPanel(m.key);
                  if (m.key === 'about') setUpdateSeen(true);
                  if (m.key === 'email' && notifyCount > 0) { fetch('/api/system.clearNotifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(() => setNotifyCount(0)).catch(() => {}); }
                }}>
                <span className="menu-item-icon">{ICONS[m.key]}</span>
                {_t(`app.menu${m.key.charAt(0).toUpperCase() + m.key.slice(1)}`, lang)}
                {m.key === 'email' && notifyCount > 0 && <span className="notif-badge">{notifyCount}</span>}
                {m.key === 'mcp' && mcpPending > 0 && <span style={{ position: 'absolute', top: 2, right: 4, background: 'var(--amber)', color: '#fff', fontSize: 9, fontWeight: 700, minWidth: 15, height: 15, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{mcpPending}</span>}
                {m.key === 'about' && updateAvailable && !updateSeen && <span className="notif-dot" />}
              </button>))}
                {/* Morning & Evening notification bubbles */}
                {(morningNotify || eveningNotify) && (
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {morningNotify && (
                      <button className="menu-item" style={{ padding: '4px 6px', cursor: thinking ? 'default' : 'pointer', opacity: thinking ? 0.4 : 1, border: 0, minWidth: 'unset' }}
                        onClick={() => { if (thinking) return;
                          const text = morningNotify;
                          setMessages(prev => [...prev, { role: 'assistant' as const, text, tool: 'greeting', pinnable: true }]);
                          saveMsg({ role: 'assistant', text, tool: 'greeting', pinnable: true });
                          setMorningNotify(null);
                          setTimeout(() => msgsRef.current?.scrollTo(0, msgsRef.current.scrollHeight), 100);
                        }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <defs>
                            <linearGradient id="morning-grad" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
                              <stop offset="0%" stopColor="#fbbf24" /><stop offset="100%" stopColor="#f59e0b" />
                            </linearGradient>
                          </defs>
                          <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z" fill="url(#morning-grad)" opacity="0.85" />
                        </svg>
                      </button>
                    )}
                    {eveningNotify && (
                      <button className="menu-item" style={{ padding: '4px 6px', cursor: thinking || notifyLoading ? 'default' : 'pointer', opacity: thinking ? 0.4 : notifyLoading ? 0.6 : 1, border: 0, minWidth: 'unset' }}
                        onClick={async () => {
                          if (thinking || notifyLoading) return;
                          setNotifyLoading(true);
                          const today = new Date().toISOString().substring(0, 10);
                          localStorage.setItem('tl-evening-shown', today);
                          setEveningNotify(null);
                          // Add loading indicator then replace with report
                          const loadingIdx = messages.length;
                          setMessages(prev => [...prev, { role: 'assistant' as const, text: tr(lang,'⏳ 生成日报中...','⏳ 日報生成中...','⏳ Generating report...') }]);
                          try {
                            const r = await api.standup.getEveningReport(lang);
                            const content = r?.reportContent || '';
                            const todayStr = new Date().toISOString().substring(0, 10);
                            const card = r.reportId ? { type: 'report' as const, id: r.reportId, title: `${tr(lang,'📋 晚报','📋 イブニングレポート','📋 Evening Report')} — ${todayStr}`, reportType: 'daily' } : undefined;
                            setMessages(prev => { const copy = [...prev]; copy[loadingIdx] = { role: 'assistant' as const, text: content || (tr(lang,'⚠️ 暂无数据','⚠️ データなし','⚠️ No data')), card }; return copy; });
                            if (content) saveMsg({ role: 'assistant', text: content, card });
                            setReportRefresh(n => n + 1); // refresh Reports panel list
                          } catch {
                            setMessages(prev => { const copy = [...prev]; copy[loadingIdx] = { role: 'assistant' as const, text: tr(lang,'⚠️ 生成失败','⚠️ 生成失敗','⚠️ Failed') }; return copy; });
                          }
                          setNotifyLoading(false);
                          setTimeout(() => msgsRef.current?.scrollTo(0, msgsRef.current.scrollHeight), 100);
                        }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <defs>
                            <linearGradient id="evening-grad" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
                              <stop offset="0%" stopColor="#a78bfa" /><stop offset="100%" stopColor="#7c3aed" />
                            </linearGradient>
                          </defs>
                          <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z" fill="url(#evening-grad)" opacity="0.85" />
                        </svg>
                      </button>
                    )}
                  </span>
                )}
              </div>
              {/* Soft-gate: LLM API key missing banner */}
              {!llmConfigured && !llmBannerDismissed && (
                <div style={{ padding: '10px 14px', background: 'color-mix(in srgb, var(--amber) 10%, var(--surface2))', borderBottom: '1px solid var(--amber)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 600, flex: 1 }}>
                    ⚠️ {tr(lang,'未配置 LLM API Key，AI 聊天功能不可用。','LLM APIキーが未設定です。','LLM API Key not configured. AI chat unavailable.')}
                  </span>
                  <button className="btn btn-brand btn-xs" onClick={() => {
                    (window as any).__tl_settingsTab = 'llm';
                    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' }));
                  }}>
                    {tr(lang,'前往配置 →','設定へ →','Configure →')}
                  </button>
                  <button className="btn-ghost btn-xs" onClick={() => setLlmBannerDismissed(true)} style={{ color: 'var(--muted)', fontSize: 18, padding: '0 4px' }}>×</button>
                </div>
              )}
              <div className="chat-input-row">
                {attachedFiles.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingBottom: 6 }}>
                    {attachedFiles.map((f, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--surface2)', border: '1px solid var(--edge)', borderRadius: 14, padding: '3px 10px', fontSize: 11, color: 'var(--ink)' }}>
                        📎 {f.name}
                        <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="chat-input-inner">
                  <div style={{ position: 'relative' }}>
                    <button className="chat-plus-btn" onClick={() => { document.getElementById('file-upload')?.click(); }} title={t('chat.uploadFile', lang)} style={{ position: 'relative' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
                    </button>
                  </div>
                  <input id="file-upload" type="file" multiple hidden onChange={async (e) => { if (e.target.files) { await handleFiles(e.target.files); e.target.value = ''; } }} />
                  <div className="chat-input-wrap">
                    <textarea ref={textareaRef} className="chat-textarea" placeholder={t('chat.placeholder', lang)} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (query.trim()) { sendMessage(); } else { sendMessage(); } } if (e.key === 'Escape' && thinking) { e.preventDefault(); stopStream(); } }} rows={1} />
                    {thinking ? (
                      <button className="chat-send-btn chat-send-btn--stop" onClick={stopStream} title={t('chat.sendToInterrupt', lang)} style={{ background: 'var(--brand)', border: 'none' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button>
                    ) : (
                      <button className={cn('chat-send-btn', query.trim() ? 'chat-send-btn--active' : 'chat-send-btn--idle')} onClick={() => sendMessage()} disabled={!query.trim()} title={t('chat.sendEnter', lang)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 01-4 4H4" /></svg></button>
                    )}
                  </div>
                </div>
                <div className="chat-hint" style={{ padding: '4px 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {thinking ? (
                    <span style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 500 }}>{t('chat.hintEsc', lang)}</span>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 10, background: 'var(--surface2)', color: 'var(--ink)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--edge)' }}>Enter → {t('chat.send', lang)}</span>
                      <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 10, background: 'var(--surface2)', color: 'var(--ink)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--edge)' }}>(Shift + Enter) → {t('chat.newLine', lang)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <PanelResizeHandle panelOpen={!!panel} />
            <ContentPanel panel={panel} emailRefresh={emailRefresh} onClose={() => {
  if ((window as any).__tl_unsaved) { setLeaveTarget({ type: 'close' }); return; }
  (window as any).__tl_unsaved = null; setPanel(null);
}} onEditingNote={setEditingNote} onEditingTask={setEditingTask} onEditingReport={(r) => { setEditingReport(r); editingReportRef.current = r; }} onNoteAction={(action) => {
  const actionLabels: Record<string, string> = { polish: tr(lang,'润色','推敲','Polish'), translate: tr(lang,'翻译（先确认目标语言）','翻訳（翻訳先の言語を確認）','Translate (ask target language first)'), summarize: tr(lang,'总结为3个要点','3つの要点に要約','Summarize into 3 bullet points'), expand: tr(lang,'扩写为更详细的版本','詳細版に拡張','Expand into a detailed version') };
  if (!actionLabels[action] || !sendMessageRef.current) return;
  const msg = `[Note editor action: ${actionLabels[action]}]\n\n${editingNote?.content?.substring(0, 2000) || ''}`;
  sendMessageRef.current?.(undefined, msg);
}} onReportAction={(action) => {
  const tool = action + '_report'; // polish → polish_report, summarize → summarize_report, etc.
  if (!sendMessageRef.current) return;
  const reportSnapshot = editingReportRef.current;
  const msg = `[Report editor OPEN — call ${tool}]\nTitle: ${reportSnapshot?.title || ''}\nContent:\n\`\`\`\n${(reportSnapshot?.content || '').substring(0, 3000)}\n\`\`\``;
  sendMessageRef.current?.(undefined, msg);
}} noteRefresh={noteRefresh} taskRefresh={taskRefresh} reportRefresh={reportRefresh} appliedEdit={appliedEdit} appliedTaskEdit={appliedTaskEdit} appliedReport={appliedReport} />
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={!!leaveTarget}
        title={tr(lang,'未保存的更改','保存されていない変更','Unsaved Changes')}
        message={tr(lang,'有未保存的内容，离开将丢失更改。确定离开？','保存されていない変更があります。このまま離れますか？','Unsaved changes will be lost. Leave anyway?')}
        lang={lang}
        confirmLabel={tr(lang,'离开','閉じる','Leave')}
        cancelLabel={tr(lang,'取消','キャンセル','Cancel')}
        onConfirm={() => {
          const target = leaveTarget;
          setLeaveTarget(null);
          (window as any).__tl_unsaved = null;
          if (target?.type === 'close') setPanel(null);
          else if (target?.type === 'menu') setPanel(target.key!);
          setTimeout(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }, 50);
        }}
        onCancel={() => { setLeaveTarget(null); setTimeout(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }, 50); }}
      />
      <ConfirmDialog
        open={compressConfirm}
        title={t('chat.compressTitle', lang)}
        message={t('chat.compressMessage', lang)}
        lang={lang}
        onConfirm={executeCompress}
        onCancel={() => setCompressConfirm(false)}
      />
      <ConfirmDialog
        open={!!compressMsg}
        variant="alert"
        title={compressMsg}
        message=""
        lang={lang}
        onConfirm={() => setCompressMsg('')}
        onCancel={() => setCompressMsg('')}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title={_l('删除','削除','Delete')}
        message={tr(lang,`确定删除 "${deleteTarget?.title || ''}" 吗？此操作无法撤销。`,`"${deleteTarget?.title || ''}"を削除しますか？元に戻せません。`,`Delete "${deleteTarget?.title || ''}"? This cannot be undone.`)}
        lang={lang}
        confirmLabel={_l('删除','削除','Delete')}
        cancelLabel={tr(lang,'取消','キャンセル','Cancel')}
        onConfirm={executeDelete}
        onCancel={() => { setDeleteTarget(null); setTimeout(() => textareaRef.current?.focus(), 50); }}
      />
      <ConfirmDialog
        open={deleting}
        variant="alert"
        loading
        message={tr(lang,'🗑️ 删除中...','🗑️ 削除中...','🗑️ Deleting...')}
        lang={lang}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
      <ConfirmDialog
        open={!!saveResult}
        variant="alert"
        message={saveResult?.message || ''}
        lang={lang}
        onConfirm={() => setSaveResult(null)}
        onCancel={() => setSaveResult(null)}
      />
      <ConfirmDialog
        open={stopDownloadConfirm}
        title={_l('停止下载','ダウンロード停止','Stop Download')}
        message={lang === 'zh' ? `确定要停止下载 v${updateAvailable?.version || ''} 吗？` : `Stop downloading v${updateAvailable?.version || ''}?`}
        lang={lang}
        confirmLabel={_l('停止','停止','Stop')}
        cancelLabel={tr(lang,'取消','キャンセル','Cancel')}
        onConfirm={() => { setStopDownloadConfirm(false); dismissUpdateNotification(); }}
        onCancel={() => { setStopDownloadConfirm(false); }}
      />
    </div>
  );
}
