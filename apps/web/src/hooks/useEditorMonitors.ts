import { useState, useEffect, useRef } from 'react';
import { t, tr } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import type { StagedEdit } from '@/types/chat';
import type { ChatHook } from './useChatThreads';

// ═══ Editor monitors: agent-applied edits, refresh counters, panel lifecycle + user-action context signals ═══
export function useEditorMonitors({ chatHook, currentSessionId: _currentSessionId, panel }: { chatHook: ChatHook; currentSessionId: string; panel: string | null }) {
  const lang = useLang();
  const setMessages = chatHook.setMessages;
  const [editingNote, setEditingNote] = useState<{ id?: string; title: string; content: string; category: string } | null>(null);
  const [editingTask, setEditingTask] = useState<{ issueNumber?: number; title: string; description: string; status: string; priority: string; storyPoints?: number; editing?: boolean } | null>(null);
  const [editingReport, setEditingReport] = useState<{ title: string; content: string } | null>(null);
  const editingReportRef = useRef<{ title: string; content: string; id?: string } | null>(null);
  const [appliedEdit, setAppliedEdit] = useState<StagedEdit | null>(null);
  const [appliedReport, setAppliedReport] = useState<{ title?: string; content?: string } | null>(null);
  const [appliedTaskEdit, setAppliedTaskEdit] = useState<Record<string, any> | null>(null);
  // Clear stale agent-applied edits when switching panels (prevents editor auto-open on re-entry)
  useEffect(() => { setAppliedEdit(null); setAppliedTaskEdit(null); setAppliedReport(null); }, [panel]);
  const [noteRefresh, setNoteRefresh] = useState(0);
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [reportRefresh, setReportRefresh] = useState(0);
  const [emailRefresh, setEmailRefresh] = useState(0);
  const bumpNote = () => setNoteRefresh(n => n + 1);
  const bumpTask = () => setTaskRefresh(n => n + 1);
  const bumpReport = () => setReportRefresh(n => n + 1);
  const bumpEmail = () => setEmailRefresh(n => n + 1);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notifyI18n recreated per render; [panel] is the real trigger
  }, [panel]);

  // User action monitor — tells agent what the user is doing
  // NOTE: these are NOT persisted to DB — they're ephemeral context signals for the AI agent
  const notifyAgent = (text: string) => {
    const sysMsg = { role: 'assistant' as const, text: `🔔 *${text}*` };
    setMessages(prev => [...prev, sysMsg]);
  };
  const notifyI18n = (key: string, params?: Record<string, string>) => {
    const msg = t(('agent.' + key) as any, lang, params);
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
      const newMsg = { role: 'assistant' as const, text: isNew ? t('editor.noteCreateHint', lang) : t('editor.noteEditHint', lang, { title: editingNote.title || '' }) };
      setMessages(prevMsgs => [...prevMsgs, newMsg]);
      // Not persisted — context signal for AI, not permanent chat history
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang/notifyI18n recreated per render; [editingNote] is the real trigger
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
        const msg = { role: 'assistant' as const, text: t('editor.taskCreateHint', lang) };
        setMessages(prevMsgs => [...prevMsgs, msg]);
      } else {
        // Existing task from list
        notifyI18n('openedTask', { num: String(curId), title: editingTask.title || '' });
        const msg = { role: 'assistant' as const, text: t('editor.taskViewHint', lang, { num: String(curId), title: editingTask.title || '', status: editingTask.status, priority: editingTask.priority, sp: editingTask.storyPoints ? ` · ${editingTask.storyPoints}sp` : '' }) };
        setMessages(prevMsgs => [...prevMsgs, msg]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang/notifyI18n recreated per render; [editingTask] is the real trigger
  }, [editingTask]);

  // Report monitor — fire once when panel opens
  const prevReportRef = useRef(false);
  useEffect(() => {
    if (!editingReport) { prevReportRef.current = false; return; }
    if (prevReportRef.current) return;
    prevReportRef.current = true;
    notifyI18n('openedReport');
    const msg = { role: 'assistant' as const, text: t('editor.reportHint', lang) };
    setMessages(prevMsgs => [...prevMsgs, msg]);
    // Not persisted — context signal for AI, not permanent chat history
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang/notifyI18n recreated per render; [editingReport] is the real trigger
  }, [editingReport]);

  return {
    editingNote, setEditingNote,
    editingTask, setEditingTask,
    editingReport, setEditingReport, editingReportRef,
    appliedEdit, setAppliedEdit,
    appliedTaskEdit, setAppliedTaskEdit,
    appliedReport, setAppliedReport,
    noteRefresh, taskRefresh, reportRefresh, emailRefresh,
    bumpNote, bumpTask, bumpReport, bumpEmail,
  };
}
