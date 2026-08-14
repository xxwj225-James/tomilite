import { useState, useRef, useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import type { ChatCard } from '@/types/chat';

// ═══ Chat card actions: card event listeners (open/edit/delete/move/force-create/cancel-dedup/save-result) + delete handler ═══
export function useChatCardActions({ chatHook, saveMsg, currentSessionId, setPanel, sendMessageRef, forceCreateRef, editingNote, editingTask, editingReport, setEditingNote, setEditingTask, setEditingReport, bumpTask, bumpNote, bumpReport }: {
  chatHook: any;
  saveMsg: (msg: any) => Promise<any>;
  currentSessionId: string;
  setPanel: (p: string | null) => void;
  sendMessageRef: RefObject<((payload?: string, noteActionPayload?: string) => void) | undefined>;
  forceCreateRef: RefObject<any>;
  editingNote: { id?: string; title: string; content: string; category: string } | null;
  editingTask: { issueNumber?: number; title: string; description: string; status: string; priority: string; storyPoints?: number; editing?: boolean } | null;
  editingReport: { title: string; content: string } | null;
  setEditingNote: Dispatch<SetStateAction<{ id?: string; title: string; content: string; category: string } | null>>;
  setEditingTask: Dispatch<SetStateAction<{ issueNumber?: number; title: string; description: string; status: string; priority: string; storyPoints?: number; editing?: boolean } | null>>;
  setEditingReport: Dispatch<SetStateAction<{ title: string; content: string } | null>>;
  bumpTask: () => void;
  bumpNote: () => void;
  bumpReport: () => void;
}) {
  const lang = useLang();
  const setMessages = chatHook.setMessages;
  const [deleteTarget, setDeleteTarget] = useState<ChatCard | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang; // keep current lang for listener registered once
  const sessionIdRef = useRef(currentSessionId);
  sessionIdRef.current = currentSessionId;

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
      if (card.type === 'task') { fetch('/api/issue.update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: card.id, status: card.status }) }).then(() => bumpTask()).catch(() => {}); }
    };
    const onForceCreate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Inject card type so backend knows which force_create_* to call
      const args = { ...detail.pendingArgs, _type: detail.type || 'task' };
      forceCreateRef.current = args;
      sendMessageRef.current?.('__FORCE_CREATE__ ' + JSON.stringify(args));
    };
    const onCancelDedup = () => {
      const cancelMsg = { role: 'assistant' as const, text: t('chat.cancelledCreate', langRef.current) };
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
      if (card.type === 'task') { bumpTask(); /* Clear editor if deleted task is currently open */ if (editingTask?.issueNumber && card.key === `TL-${editingTask.issueNumber}`) { setEditingTask(null); window.dispatchEvent(new CustomEvent('tl-close-task-editor')); } }
      else if (card.type === 'note') { bumpNote(); if (editingNote?.id === card.id) { setEditingNote(null); window.dispatchEvent(new CustomEvent('tl-close-note-editor')); } }
      else if (card.type === 'report') { bumpReport(); if ((editingReport as any)?.id === card.id) { setEditingReport(null); window.dispatchEvent(new CustomEvent('tl-close-report-editor')); } }
      setMessages(prev => prev.map(m => { if ((card.id && m.card?.id === card.id) || (card.key && m.card?.key === card.key)) { const updatedCard = JSON.stringify({ ...m.card, disabled: true, status: 'deleted' }); if (m.id) { api.chat.updateMessage({ id: m.id as string, card: updatedCard }).catch((e: any) => console.warn('[deleteCard] updateMessage FAILED:', e?.message || e)); } else { console.warn('[deleteCard] m.id missing — card state NOT persisted, cardId=' + card.id); } return { ...m, card: { ...m.card, disabled: true, status: 'deleted' } }; } return m; }));
    };
    if (isExport) {
      doDisable();
      const label = card.title || card.key || card.type;
      const text = t('delete.deletedLabel', lang, { label });
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
      const text = t('delete.deletedLabel', lang, { label });
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

  return { deleteTarget, setDeleteTarget, deleting, setDeleting, saveResult, setSaveResult, executeDelete };
}
