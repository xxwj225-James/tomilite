import { useState, useEffect, useRef } from 'react';
import { api, type SearchHit } from '@/lib/api';
import { tr, t } from '@/lib/i18n';
import { ContentPanel } from '@/components/ContentPanel';
import { useUICommandStore } from '@/stores/uiCommandStore';
import { useLang, useSetLang } from '@/stores/LangContext';
import { useChatSessions } from '@/hooks/useChatThreads';
import { useFileAttach } from '@/hooks/useFileAttach';
import { useTokenUsage } from '@/hooks/useTokenUsage';
import { useSetupChecks } from '@/hooks/useSetupChecks';
import { useNotifications } from '@/hooks/useNotifications';
import { useUpdates } from '@/hooks/useUpdates';
import { toSidebarSession, useSessionManager } from '@/hooks/useSessionManager';
import { useEditorMonitors } from '@/hooks/useEditorMonitors';
import { useSendMessage } from '@/hooks/useSendMessage';
import { useChatCardActions } from '@/hooks/useChatCardActions';
import { PanelResizeHandle } from '@/components/PanelResizeHandle';
import { SessionSidebar } from '@/components/chat/SessionSidebar';
import { ChatToolbar } from '@/components/chat/ChatToolbar';
import { UpdateBar } from '@/components/chat/UpdateBar';
import { WelcomeGuide } from '@/components/chat/WelcomeGuide';
import { MsgList } from '@/components/chat/MsgList';
import { MenuNav } from '@/components/chat/MenuNav';
import { MeetingIndicator } from '@/components/chat/MeetingIndicator';
import { LlmBanner } from '@/components/chat/LlmBanner';
import { ChatInput } from '@/components/chat/ChatInput';
import { ConfirmDialogs } from '@/components/chat/ConfirmDialogs';
import { SearchPalette, SidebarSearchButton } from '@/components/search/SearchPalette';
import { TelemetryConsentDialog } from '@/components/TelemetryConsentDialog';
import { CelebrationHost } from '@/components/Celebration';
import { setConsent as telSetConsent, track as telTrack } from '@/lib/telemetry';
import { LoadingScreen } from '@/components/LoadingScreen';
import type { StagedEdit } from '@/types/chat';

// ═══ MAIN APP ═══
// App is a thin shell: it assembles feature hooks (hooks/) and renders
// layout components (components/). The agent streaming core lives in
// useSendMessage.ts, session CRUD in useSessionManager.ts, chat-card
// actions in useChatCardActions.ts.
export function App() {
  // ─── Local UI state ───
  const lang = useLang();
  const setLang = useSetLang();
  // Theme and light/dark live in stores/themeStore.ts — the settings panel and
  // the welcome guide both read it directly. App declares no state and runs no
  // effect here: the store writes <html> from its setters, and
  // `public/theme-init.js` has already written it before React's first render.
  const [panel, setPanel] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { attachedFiles, setAttachedFiles, dragOver, setDragOver, handleFiles } = useFileAttach();

  // ─── Chat session store — messages are per active session ───
  const chatHook = useChatSessions();
  // Derived from active session
  const messages = chatHook.messages;
  const setMessages = chatHook.setMessages;
  // Token usage estimation for the session context bar
  const { maxTokens, currentTokens, displayTokens, debugForceShow } = useTokenUsage(messages);
  // thinking: true if any message in current session has status 'running'
  const thinking = messages.some((m: any) => m.status === 'running');
  const agentStatus = thinking ? 'Thinking...' : '';
  // ─── Staged-edit apply/undo ───
  // The agent proposes note/task/report edits via tool calls; the user
  // confirms (Apply) or reverts (Undo) from the chat card. Applying writes
  // into the panel editor state and acknowledges back to the chat.
  const handleApplyEdit = (staged: StagedEdit) => {
    if (staged.type === 'task') {
      setAppliedTaskEdit({
        title: staged.title,
        description: staged.description,
        status: staged.status,
        priority: staged.priority,
        storyPoints: staged.storyPoints,
      });
    } else if (staged.type === 'report') {
      setAppliedReport({ title: staged.title, content: staged.content });
    } else if (staged.type === 'email_reply') {
      window.dispatchEvent(
        new CustomEvent('tl-email-draft-update', {
          detail: { text: (staged as any).original || staged.content || '' },
        }),
      );
    } else {
      setAppliedEdit(structuredClone(staged));
    }
    const msg = {
      role: 'assistant' as const,
      text: tr(
        lang,
        '✅ 已应用到编辑器。你可以继续修改或点击 **Save** 保存，也可以让我再调整。',
        '✅ エディタに適用しました。引き続き編集するか **Save** をクリックして保存、または調整を依頼してください。',
        '✅ Applied to editor. You can continue editing or click **Save** to save, or ask me to adjust.',
      ),
    };
    setMessages((prev) => [...prev, msg]);
    if (currentSessionId) api.chat.addMessage({ sessionId: currentSessionId, ...msg }).catch(() => {});
  };
  const handleUndoEdit = (staged: StagedEdit) => {
    if (!staged.original) return;
    if (staged.type === 'task') {
      useUICommandStore.getState().enqueue({
        type: 'apply_task_edit',
        payload: {
          title: staged.original.title || '',
          description: staged.original.description || '',
          status: staged.original.status || 'todo',
          priority: staged.original.priority || 'medium',
          storyPoints: staged.original.storyPoints ?? 0,
          __undo: true,
        },
      });
    } else if (staged.type === 'report') {
      setAppliedReport({ title: staged.original.title, content: staged.original.content });
    } else {
      setAppliedEdit({
        title: staged.original.title,
        content: staged.original.content,
        category: staged.original.category,
      });
    }
    const msg = {
      role: 'assistant' as const,
      text: tr(
        lang,
        '↩ 已撤销修改，恢复到之前的内容。',
        '↩ 変更を元に戻し、以前の内容に復元しました。',
        '↩ Reverted changes back to previous content.',
      ),
    };
    setMessages((prev) => [...prev, msg]);
    if (currentSessionId) api.chat.addMessage({ sessionId: currentSessionId, ...msg }).catch(() => {});
  };

  // ─── Feature hooks ───
  // Session CRUD, rename, clear/delete, context compression
  const {
    sessions,
    setSessions,
    autoTitle,
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
  } = useSessionManager({ chatHook, maxTokens, currentTokens });

  // Editor state for note/task/report panels + refresh bumping after agent edits
  const {
    editingNote,
    setEditingNote,
    editingTask,
    setEditingTask,
    editingReport,
    setEditingReport,
    editingReportRef,
    appliedEdit,
    setAppliedEdit,
    appliedTaskEdit,
    setAppliedTaskEdit,
    appliedReport,
    setAppliedReport,
    noteRefresh,
    taskRefresh,
    reportRefresh,
    emailRefresh,
    meetingRefresh,
    bumpNote,
    bumpTask,
    bumpReport,
    bumpEmail,
  } = useEditorMonitors({ chatHook, currentSessionId, panel });
  // First-run welcome guide + per-feature setup checks (LLM / email / git / ...)
  const {
    showWelcome,
    setShowWelcome,
    llmConfigured,
    setLlmConfigured,
    emailConfigured,
    gitConfigured,
    apikeyConfigured,
    standupConfigured,
    mcpConfigured,
    llmBannerDismissed,
    setLlmBannerDismissed,
  } = useSetupChecks();

  // ─── Anonymous usage telemetry — first-run opt-in (nothing is captured
  // until the user agrees). Consent is stored server-side (SystemConfig
  // 'telemetry.consent'); this dialog only asks when the key is unset. ───
  const [consentOpen, setConsentOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api.system
      .getConfig('telemetry.consent')
      .then((v: any) => {
        if (!alive) return;
        telSetConsent(v === 'yes');
        if (v === null || v === undefined) setConsentOpen(true);
      })
      .catch(() => {
        if (alive) telSetConsent(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // ─── Hosted gateway closed? Poll while a hosted session is routing LLM traffic, so the
  // chat input can warn BEFORE a request 403s (gateway total switch featureOpen=false). ───
  const [hostedClosed, setHostedClosed] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const st: any = await api.hosted.status();
        if (!st?.active) {
          if (alive) setHostedClosed(false);
          return;
        }
        const cfg: any = await api.hosted.config();
        if (alive) setHostedClosed(!!cfg?.ok && cfg.data?.featureOpen === false);
      } catch {
        if (alive) setHostedClosed(false);
      }
    };
    check();
    const iv = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const onConsentAgree = async () => {
    try {
      await api.system.setConfig({ key: 'telemetry.consent', value: 'yes' });
    } catch {}
    telSetConsent(true);
    setConsentOpen(false);
    // One-shot profile: which integrations were already configured at opt-in.
    // (The server itself logs app_launch when consent flips to 'yes'.)
    telTrack('profile.activation', {
      llm: llmConfigured,
      email: emailConfigured,
      git: gitConfigured,
      apikey: apikeyConfigured,
      standup: standupConfigured,
      mcp: mcpConfigured,
    });
  };

  const onConsentDecline = async () => {
    try {
      await api.system.setConfig({ key: 'telemetry.consent', value: 'no' });
    } catch {}
    telSetConsent(false);
    setConsentOpen(false);
  };

  // SSE send/stop core — pre-flight checks + streaming agent loop
  const { sendMessage, stopStream, sendMessageRef, forceCreateRef } = useSendMessage({
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
    autoTitle,
  });

  // Chat-card listeners (apply/undo/force-create/delete) + executeDelete
  const { deleteTarget, setDeleteTarget, deleting, saveResult, setSaveResult, executeDelete } = useChatCardActions({
    chatHook,
    saveMsg,
    currentSessionId,
    setPanel,
    sendMessageRef,
    forceCreateRef,
    editingNote,
    editingTask,
    editingReport,
    setEditingNote,
    setEditingTask,
    setEditingReport,
    bumpTask,
    bumpNote,
    bumpReport,
  });

  const [leaveTarget, setLeaveTarget] = useState<{ type: 'close' | 'menu'; key?: string } | null>(null);

  // MCP approval queue + morning/evening standup notifications
  const {
    notifyCount,
    setNotifyCount,
    mcpPending,
    morningNotify,
    setMorningNotify,
    eveningNotify,
    setEveningNotify,
    notifyLoading,
    setNotifyLoading,
  } = useNotifications({ sessionsLoaded });

  // Pinned message bar — persisted across restarts
  const [pinnedText, setPinnedText] = useState<string | null>(() => localStorage.getItem('tl-pinned-text'));
  useEffect(() => {
    if (pinnedText) localStorage.setItem('tl-pinned-text', pinnedText);
    else localStorage.removeItem('tl-pinned-text');
  }, [pinnedText]);
  const msgsRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // OTA updates via electron-updater (GitHub Releases provider)
  const {
    updateAvailable,
    updateProgress,
    updateSeen,
    setUpdateSeen,
    updateTimedOut,
    updateError,
    stopDownloadConfirm,
    setStopDownloadConfirm,
    updateFilePath,
    dismissUpdateNotification,
    handleUpdateInstall,
    handleUpdateDownload,
    handleOpenUpdateFolder,
  } = useUpdates({ onResult: setSaveResult });
  // The two `applyTheme` / `applyMode` effects that used to sit here are gone:
  // the store writes both attributes from its setters, and `public/theme-init.js`
  // has already written them before React's first render.
  // Stick to the bottom whenever something lands on screen. The dependency stays
  // on `messages` because streaming swaps the assistant message object on every
  // token, and that is exactly what has to keep scrolling. The ref guard covers
  // the internal context signals (see MsgList): they append to the array without
  // putting anything on screen, so scrolling on them would drag the view down
  // while the user is just opening a panel.
  const lastVisibleMsgRef = useRef<any>(null);
  const [flashMsgId, setFlashMsgId] = useState<string | null>(null);
  /** Set by `openSearchHit`, consumed by the jump effect below — and read by the auto-scroll
   *  effect above as its "a jump is in flight, do not fight me" flag. One value, two readers:
   *  two separate flags would be able to disagree. */
  const pendingJumpRef = useRef<{ sessionId: string; messageId: string } | null>(null);
  /** Bumped on every jump request. The effect below cannot rely on `messages` changing to
   *  re-run: `useChatThreads.loadSession` returns early when the session is already in
   *  memory, which is exactly the case of searching inside the conversation you are
   *  looking at — the effect would never fire and the jump would quietly do nothing. */
  const [jumpSeq, setJumpSeq] = useState(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // A search jump outranks this. Switching session loads the messages asynchronously,
    // and that arrival would otherwise fire this effect and drag the view to the bottom
    // a beat before the jump effect below tries to scroll to the matched message. The
    // early return is before the ref update on purpose: `lastVisibleMsgRef` then still
    // holds the older message, so the next message that actually arrives re-triggers
    // this and ordinary auto-scrolling resumes.
    if (pendingJumpRef.current) return;
    const visible = messages.filter((m: any) => !m.internal);
    const last = visible.length > 0 ? visible[visible.length - 1] : null;
    if (last === lastVisibleMsgRef.current) return;
    lastVisibleMsgRef.current = last;
    msgsRef.current?.scrollTo(0, msgsRef.current.scrollHeight);
  }, [messages]);
  // ─── A search result pointed at one specific message ───
  //
  // Declared AFTER the auto-scroll effect, and backed by the early return in it: two
  // effects racing on the same scroll position would otherwise depend on declaration order
  // alone, which is too thin a thread to hang this on.
  useEffect(() => {
    const target = pendingJumpRef.current;
    if (!target || target.sessionId !== currentSessionId) return;
    const el = msgsRef.current?.querySelector(`[data-msg-id="${target.messageId}"]`);
    // Not found yet — the session may still be loading. The 8-second deadline set when
    // the jump was requested is what ends the wait; giving up here would abandon a jump
    // that is merely slow.
    if (!el) return;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    pendingJumpRef.current = null;
    setFlashMsgId(target.messageId);
    // Held in a ref rather than returned as this effect's cleanup: the effect re-runs on
    // every arriving message, and a cleanup would be torn down mid-flash by the next
    // token of a streaming reply — leaving the highlight on screen permanently.
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashMsgId(null), 1600);
  }, [messages, currentSessionId, jumpSeq]);
  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  // Resize textarea only when line count changes (Enter/Shift+Enter), not on every keystroke
  const lineCount = query.split('\n').length;
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }
  }, [lineCount]);

  // Listen for agent-initiated panel navigation
  useEffect(() => {
    const handler = (e: Event) => setPanel((e as CustomEvent).detail);
    window.addEventListener('tl-navigate', handler);
    return () => window.removeEventListener('tl-navigate', handler);
  }, []);
  // The palette owns the Ctrl/⌘+K listener (it has to know whether it is already open);
  // this is only the receiving end of its "open me" signal, so that the sidebar button
  // and the keyboard shortcut land on the same state.
  useEffect(() => {
    const handler = () => setSearchOpen(true);
    window.addEventListener('tl-open-search', handler);
    return () => window.removeEventListener('tl-open-search', handler);
  }, []);
  // Stable refs for callback closures — avoids re-registering event listeners on session/lang change
  const langRef = useRef(lang);
  langRef.current = lang;
  const sessionIdRef = useRef(currentSessionId);
  sessionIdRef.current = currentSessionId;

  // Menu navigation (used by MenuNav) — unsaved-changes gate + update-seen + clear notifications
  // Every menu key is now a real panel key, so this is a null-normaliser: the
  // nav passes `null` for "no panel", and the confirm-leave path can pass an
  // undefined key. Both entry points share it so they cannot drift apart.
  const panelForKey = (key: string | null | undefined) => key ?? null;
  const handleMenuNav = (key: string) => {
    if ((window as any).__tl_unsaved && key !== panel) {
      setLeaveTarget({ type: 'menu', key });
      return;
    }
    setPanel(panelForKey(key));
    if (key === 'about') setUpdateSeen(true);
    if (key === 'email' && notifyCount > 0) {
      fetch('/api/system.clearNotifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
        .then(() => setNotifyCount(0))
        .catch(() => {});
    }
  };
  // A deep link can outlive its row. Most panels say so themselves (each has a "has been
  // deleted" notice), but the email panel has no such channel and cannot word a message —
  // there is no shared notify helper in this app. The alert dialog behind `saveResult` is
  // the existing general-purpose surface, so the panel raises a signal and App words it.
  useEffect(() => {
    const handler = () => setSaveResult({ ok: false, message: t('search.msgNotFound', lang) });
    window.addEventListener('tl-search-miss', handler);
    return () => window.removeEventListener('tl-search-miss', handler);
  }, [lang, setSaveResult]);

  // ─── A search result was opened ───
  //
  // Six kinds, six landing places. Three of them are plain "select this row" — note, task
  // and report have had that protocol for a while (see useChatCardActions) — and the other
  // three are assembled here.
  //
  // The pending stash always goes down BEFORE the navigation, and that order is the whole
  // trick. When an editor holds unsaved changes `handleMenuNav` stops at a confirm dialog,
  // so the panel is not mounted at that moment: an event dispatched now has no listener
  // and is gone. The stash survives, and the panel consumes it when it does mount, or when
  // it is re-activated after the user confirms. Same reasoning for going through
  // `handleMenuNav` instead of dispatching `tl-navigate` as the chat cards do — that
  // listener has no unsaved gate at all, and a search hitting a half-edited note must not
  // silently drop the edit.
  const openSearchHit = (hit: SearchHit) => {
    setSearchOpen(false);

    if (hit.kind === 'chat') {
      // A chat hit that somehow carries no session cannot be jumped to. Dropping the click
      // is the honest outcome; scrolling to a message in the wrong conversation is not.
      if (!hit.sessionId) return;
      pendingJumpRef.current = { sessionId: hit.sessionId, messageId: hit.id };
      // The safety valve. `switchSession` loads asynchronously, so the scroll itself has
      // to happen in the effect above — but that effect's partner (auto-scroll) returns
      // early for as long as this ref is set. If the session never finishes loading, the
      // app would silently lose "follow the conversation" forever. Eight seconds of no
      // auto-scroll is a bounded, explainable cost; losing it permanently is not.
      setTimeout(() => {
        if (pendingJumpRef.current?.messageId === hit.id) pendingJumpRef.current = null;
      }, 8000);
      setJumpSeq((n) => n + 1);
      switchSession(hit.sessionId);
      return;
    }

    // The row's own title is only a placeholder here: each receiving panel re-fetches the
    // full record by id and prefers it (see useTaskState's `f.title || d.title`). It gets
    // used only when that fetch fails, and a stale title beats a blank one.
    if (hit.kind === 'task') {
      // No `key`: the panel selects by id and reads the issue number off the fetched row.
      // The palette's title carries a "TL-181: " prefix for display, and parsing it back
      // out to satisfy the event's old shape would be recovering data from a label.
      const detail = { id: hit.id, title: hit.title, editMode: false };
      (window as any).__tl_pendingTaskSelect = detail;
      handleMenuNav('tasks');
      window.dispatchEvent(new CustomEvent('tl-select-task', { detail }));
    } else if (hit.kind === 'note') {
      const detail = { id: hit.id, title: hit.title, editMode: false };
      (window as any).__tl_pendingNoteSelect = detail;
      handleMenuNav('notes');
      window.dispatchEvent(new CustomEvent('tl-select-note', { detail }));
    } else if (hit.kind === 'report') {
      // No reportType here on purpose. Passing the palette's guess would reintroduce the
      // bug useReportsState is being fixed for; omitting it lets the fetched row decide.
      const detail = { id: hit.id, title: hit.title, editMode: false };
      (window as any).__tl_pendingReportSelect = detail;
      handleMenuNav('reports');
      window.dispatchEvent(new CustomEvent('tl-select-report', { detail }));
    } else if (hit.kind === 'meeting') {
      const detail = { id: hit.id, title: hit.title, segmentQuery: hit.segmentQuery };
      (window as any).__tl_pendingMeetingSelect = detail;
      handleMenuNav('meeting');
      window.dispatchEvent(new CustomEvent('tl-select-meeting', { detail }));
    } else if (hit.kind === 'email') {
      const detail = { id: hit.id };
      (window as any).__tl_pendingEmailSelect = detail;
      handleMenuNav('email');
      window.dispatchEvent(new CustomEvent('tl-select-email', { detail }));
    }
  };
  // Morning check-in bubble click (used by MenuNav)
  const handleMorningNotify = () => {
    if (thinking || !morningNotify) return;
    const text = morningNotify;
    setMessages((prev) => [...prev, { role: 'assistant' as const, text, tool: 'greeting', pinnable: true }]);
    saveMsg({ role: 'assistant', text, tool: 'greeting', pinnable: true });
    setMorningNotify(null);
    setTimeout(() => msgsRef.current?.scrollTo(0, msgsRef.current.scrollHeight), 100);
  };
  // Evening report bubble click (used by MenuNav) — generate + stream report into chat
  const handleEveningNotify = async () => {
    if (thinking || notifyLoading) return;
    setNotifyLoading(true);
    const today = new Date().toISOString().substring(0, 10);
    localStorage.setItem('tl-evening-shown', today);
    setEveningNotify(null);
    // Add loading indicator then replace with report
    const loadingIdx = messages.length;
    setMessages((prev) => [
      ...prev,
      { role: 'assistant' as const, text: tr(lang, '⏳ 生成日报中...', '⏳ 日報生成中...', '⏳ Generating report...') },
    ]);
    try {
      const r = await api.standup.getEveningReport(lang);
      const content = r?.reportContent || '';
      const todayStr = new Date().toISOString().substring(0, 10);
      const card = r.reportId
        ? {
            type: 'report' as const,
            id: r.reportId,
            title: `${tr(lang, '📋 晚报', '📋 イブニングレポート', '📋 Evening Report')} — ${todayStr}`,
            reportType: 'daily',
          }
        : undefined;
      setMessages((prev) => {
        const copy = [...prev];
        copy[loadingIdx] = {
          role: 'assistant' as const,
          text: content || tr(lang, '⚠️ 暂无数据', '⚠️ データなし', '⚠️ No data'),
          card,
        };
        return copy;
      });
      if (content) saveMsg({ role: 'assistant', text: content, card });
      bumpReport(); // refresh Reports panel list
    } catch {
      setMessages((prev) => {
        const copy = [...prev];
        copy[loadingIdx] = { role: 'assistant' as const, text: tr(lang, '⚠️ 生成失败', '⚠️ 生成失敗', '⚠️ Failed') };
        return copy;
      });
    }
    setNotifyLoading(false);
    setTimeout(() => msgsRef.current?.scrollTo(0, msgsRef.current.scrollHeight), 100);
  };

  // Show loading while sessions load (avoids black flash on first launch)
  if (!sessionsLoaded) {
    return <LoadingScreen />;
  }

  // ─── Layout: session sidebar | chat viewport | optional side panel ───
  return (
    <div className="app-root">
      <div className="app-shell">
        <SessionSidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          editingSessionId={editingSessionId}
          editTitle={editTitle}
          displayTokens={displayTokens}
          maxTokens={maxTokens}
          debugForceShow={debugForceShow}
          onNew={() => {
            api.chat
              .createSession(`Chat ${sessions.length + 1}`)
              .then((s: any) => {
                setSessions((prev) => [toSidebarSession(s), ...prev]);
                setCurrentSessionId(s.id);
                chatHook.switchSession(s.id);
                chatHook.loadSession(s.id);
              })
              .catch(() => {});
          }}
          onSwitch={switchSession}
          onRenameStart={startRename}
          onRenameChange={setEditTitle}
          onRenameCommit={commitRename}
          onRenameCancel={() => setEditingSessionId(null)}
          onDelete={deleteSession}
          onCompress={compressChat}
          search={<SidebarSearchButton onOpen={() => setSearchOpen(true)} lang={lang} />}
          nav={
            <MenuNav
              panel={panel}
              notifyCount={notifyCount}
              mcpPending={mcpPending}
              updateAvailable={updateAvailable}
              updateSeen={updateSeen}
              thinking={thinking}
              morningNotify={morningNotify}
              eveningNotify={eveningNotify}
              notifyLoading={notifyLoading}
              onNav={handleMenuNav}
              onMorning={handleMorningNotify}
              onEvening={handleEveningNotify}
            />
          }
        />
        <div className="main-chat-wrapper">
          {/* File paste / drag-drop attaches files to the chat input */}
          <div
            className="app-viewport"
            style={dragOver ? { outline: '2px dashed var(--brand)', outlineOffset: -4 } : {}}
            onPaste={async (e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const files: File[] = [];
              for (let i = 0; i < items.length; i++) {
                const f = items[i].getAsFile();
                if (f && f.size > 0) files.push(f);
              }
              if (files.length > 0) {
                e.preventDefault();
                await handleFiles(files);
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer?.files?.length) await handleFiles(e.dataTransfer.files);
            }}
          >
            <ContentPanel
              panel={panel}
              emailRefresh={emailRefresh}
              meetingRefresh={meetingRefresh}
              onClose={() => {
                if ((window as any).__tl_unsaved) {
                  setLeaveTarget({ type: 'close' });
                  return;
                }
                (window as any).__tl_unsaved = null;
                setPanel(null);
              }}
              onEditingNote={setEditingNote}
              onEditingTask={setEditingTask}
              onEditingReport={(r) => {
                setEditingReport(r);
                editingReportRef.current = r;
              }}
              onNoteAction={(action) => {
                // Note editor AI actions (polish/translate/...) — sent as chat prompts
                // prefixed with [Note editor action: ...] so the agent routes them correctly.
                const actionLabels: Record<string, string> = {
                  polish: tr(lang, '润色', '推敲', 'Polish'),
                  translate: tr(
                    lang,
                    '翻译（先确认目标语言）',
                    '翻訳（翻訳先の言語を確認）',
                    'Translate (ask target language first)',
                  ),
                  summarize: tr(lang, '总结为3个要点', '3つの要点に要約', 'Summarize into 3 bullet points'),
                  expand: tr(lang, '扩写为更详细的版本', '詳細版に拡張', 'Expand into a detailed version'),
                };
                if (!actionLabels[action] || !sendMessageRef.current) return;
                const msg = `[Note editor action: ${actionLabels[action]}]\n\n${editingNote?.content?.substring(0, 2000) || ''}`;
                sendMessageRef.current?.(undefined, msg);
              }}
              onReportAction={(action) => {
                // Report editor AI actions map to agent tools like polish_report — the
                // prompt includes the report snapshot for context.
                const tool = action + '_report'; // polish → polish_report, summarize → summarize_report, etc.
                if (!sendMessageRef.current) return;
                const reportSnapshot = editingReportRef.current;
                const msg = `[Report editor OPEN — call ${tool}]\nTitle: ${reportSnapshot?.title || ''}\nContent:\n\`\`\`\n${(reportSnapshot?.content || '').substring(0, 3000)}\n\`\`\``;
                sendMessageRef.current?.(undefined, msg);
              }}
              noteRefresh={noteRefresh}
              taskRefresh={taskRefresh}
              reportRefresh={reportRefresh}
              appliedEdit={appliedEdit}
              appliedTaskEdit={appliedTaskEdit}
              appliedReport={appliedReport}
            />
            <PanelResizeHandle panelOpen={!!panel} />
            <div className="app-viewport-chat">
              {/* `messagesCount` drives the compress/clear buttons, which act on
                  stored messages. The internal context signals are never stored,
                  so counting them would offer "clear" on a chat that looks empty.
                  The token meter deliberately still counts them — they are sent to
                  the model, so they are real context even while hidden. */}
              <ChatToolbar
                lang={lang}
                setLang={setLang}
                langMenuOpen={langMenuOpen}
                setLangMenuOpen={setLangMenuOpen}
                messagesCount={messages.filter((m: any) => !m.internal).length}
                compressing={compressing}
                onCompress={compressChat}
                onClear={clearSession}
              />
              <UpdateBar
                updateAvailable={updateAvailable}
                updateError={updateError}
                updateProgress={updateProgress}
                updateTimedOut={updateTimedOut}
                updateFilePath={updateFilePath}
                onInstall={handleUpdateInstall}
                onDownload={handleUpdateDownload}
                onClose={dismissUpdateNotification}
                onOpenFolder={handleOpenUpdateFolder}
                onStopDownload={() => setStopDownloadConfirm(true)}
                onResult={setSaveResult}
              />
              {pinnedText && (
                <div className="pinned-bar">
                  <span style={{ flex: 1, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                    {pinnedText}
                  </span>
                  <button
                    className="btn btn-xs"
                    style={{
                      flexShrink: 0,
                      background: 'var(--surface2)',
                      border: '1px solid var(--edge)',
                      borderRadius: 4,
                      padding: '2px 10px',
                      fontSize: 'var(--text-xs)',
                      cursor: 'pointer',
                      color: 'var(--ink)',
                    }}
                    onClick={() => setPinnedText(null)}
                  >
                    {tr(lang, '取消置顶', 'ピン留め解除', 'Unpin')}
                  </button>
                </div>
              )}
              <div
                ref={msgsRef}
                className="chat-messages"
                style={{ borderTop: '1px solid var(--edge)', borderBottom: '1px solid var(--edge)' }}
              >
                {/* First-run welcome guide (replaces the old setup wizard) */}
                {showWelcome && (
                  <WelcomeGuide
                    lang={lang}
                    setLang={setLang}
                    llmConfigured={llmConfigured}
                    emailConfigured={emailConfigured}
                    gitConfigured={gitConfigured}
                    apikeyConfigured={apikeyConfigured}
                    standupConfigured={standupConfigured}
                    mcpConfigured={mcpConfigured}
                    onConfigure={(tab) => {
                      (window as any).__tl_settingsTab = tab;
                      window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' }));
                    }}
                    onStart={() => {
                      localStorage.setItem('tl-welcome-dismissed', '1');
                      setShowWelcome(false);
                    }}
                    onSkip={() => setShowWelcome(false)}
                    onDontShow={() => {
                      setShowWelcome(false);
                      localStorage.setItem('tl-welcome-dismissed', '1');
                    }}
                    onSuggestion={(text) => sendMessage(text)}
                  />
                )}
                <MsgList
                  messages={messages}
                  thinking={thinking}
                  agentStatus={agentStatus}
                  pinnedText={pinnedText}
                  onApply={handleApplyEdit}
                  onUndo={handleUndoEdit}
                  onPin={(t) => setPinnedText((prev) => (prev === t ? null : t))}
                  flashMsgId={flashMsgId}
                />
              </div>
              {/* Recording stays visible on every panel — see MeetingIndicator. */}
              <MeetingIndicator onOpen={() => handleMenuNav('meeting')} />
              {!llmConfigured && !llmBannerDismissed && (
                <LlmBanner
                  onConfigure={() => {
                    (window as any).__tl_settingsTab = 'llm';
                    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' }));
                  }}
                  onDismiss={() => setLlmBannerDismissed(true)}
                />
              )}
              {hostedClosed && (
                <div
                  style={{
                    margin: '0 12px 8px',
                    padding: '6px 10px',
                    fontSize: 'var(--text-xs)',
                    lineHeight: 1.5,
                    color: 'var(--amber)',
                    background: 'var(--surface2)',
                    border: '1px solid var(--amber)',
                    borderRadius: 8,
                  }}
                >
                  {t('hosted.closedBanner', lang)}
                </div>
              )}
              <ChatInput
                query={query}
                setQuery={setQuery}
                attachedFiles={attachedFiles}
                onRemoveFile={(i) => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                onFiles={handleFiles}
                thinking={thinking}
                onSend={() => sendMessage()}
                onStop={stopStream}
                textareaRef={textareaRef}
                disabled={compressing}
              />
            </div>
          </div>
        </div>
      </div>
      {/* ─── Modal dialogs: unsaved-changes leave, compress, delete, save result, stop download ─── */}
      <ConfirmDialogs
        leaveTarget={leaveTarget}
        compressConfirm={compressConfirm}
        compressMsg={compressMsg}
        deleteTarget={deleteTarget}
        deleting={deleting}
        saveResult={saveResult}
        stopDownloadConfirm={stopDownloadConfirm}
        updateAvailable={updateAvailable}
        onLeaveConfirm={() => {
          const target = leaveTarget;
          setLeaveTarget(null);
          (window as any).__tl_unsaved = null;
          if (target?.type === 'close') setPanel(null);
          else if (target?.type === 'menu') setPanel(panelForKey(target.key));
          setTimeout(() => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }, 50);
        }}
        onLeaveCancel={() => {
          setLeaveTarget(null);
          setTimeout(() => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }, 50);
        }}
        onCompressConfirm={executeCompress}
        onCompressCancel={() => setCompressConfirm(false)}
        onCompressMsgClose={() => setCompressMsg('')}
        onDeleteConfirm={executeDelete}
        onDeleteCancel={() => {
          setDeleteTarget(null);
          setTimeout(() => textareaRef.current?.focus(), 50);
        }}
        onDeletingClose={() => {}}
        onSaveResultClose={() => setSaveResult(null)}
        onStopDownloadConfirm={() => {
          setStopDownloadConfirm(false);
          dismissUpdateNotification();
        }}
        onStopDownloadCancel={() => setStopDownloadConfirm(false)}
      />
      {/* Portals itself to the body, like every other dialog here, so its position in the
          tree only decides when it exists — not where it lands. */}
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onOpenHit={openSearchHit} />
      <TelemetryConsentDialog open={consentOpen} onAgree={onConsentAgree} onDecline={onConsentDecline} />
      {/* Portals itself to the body and renders nothing until a milestone is crossed, so
          where it sits in the tree does not matter — only that it is past the loading
          screen, since there is nothing to celebrate while the app is still starting. */}
      <CelebrationHost />
    </div>
  );
}
