import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
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
import { useSessionManager } from '@/hooks/useSessionManager';
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
import { LlmBanner } from '@/components/chat/LlmBanner';
import { ChatInput } from '@/components/chat/ChatInput';
import { ConfirmDialogs } from '@/components/chat/ConfirmDialogs';
import { TelemetryConsentDialog } from '@/components/TelemetryConsentDialog';
import { setConsent as telSetConsent, track as telTrack } from '@/lib/telemetry';
import { LoadingScreen } from '@/components/LoadingScreen';
import { applyTheme, getTheme } from '@/lib/constants';
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
  const [theme, setTheme] = useState(getTheme());
  const [panel, setPanel] = useState<string | null>(null);
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
  // Apply theme to <html data-theme> whenever it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    msgsRef.current?.scrollTo(0, msgsRef.current.scrollHeight);
  }, [messages]);
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
  // Stable refs for callback closures — avoids re-registering event listeners on session/lang change
  const langRef = useRef(lang);
  langRef.current = lang;
  const sessionIdRef = useRef(currentSessionId);
  sessionIdRef.current = currentSessionId;
  const panelRef = useRef(panel);
  panelRef.current = panel;

  // Menu navigation (used by MenuNav) — unsaved-changes gate + update-seen + clear notifications
  const handleMenuNav = (key: string) => {
    if ((window as any).__tl_unsaved && key !== panel) {
      setLeaveTarget({ type: 'menu', key });
      return;
    }
    setPanel(key);
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
                setSessions((prev) => [{ id: s.id, title: s.title, tokenPercent: 0 }, ...prev]);
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
            <div className="app-viewport-chat">
              <ChatToolbar
                lang={lang}
                setLang={setLang}
                langMenuOpen={langMenuOpen}
                setLangMenuOpen={setLangMenuOpen}
                theme={theme}
                setTheme={setTheme}
                messagesCount={messages.length}
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
                      fontSize: 10,
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
                    theme={theme}
                    setTheme={setTheme}
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
                />
              </div>
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
                    fontSize: 11,
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
            <PanelResizeHandle panelOpen={!!panel} />
            <ContentPanel
              panel={panel}
              emailRefresh={emailRefresh}
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
          else if (target?.type === 'menu') setPanel(target.key ?? null);
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
      <TelemetryConsentDialog open={consentOpen} onAgree={onConsentAgree} onDecline={onConsentDecline} />
    </div>
  );
}
