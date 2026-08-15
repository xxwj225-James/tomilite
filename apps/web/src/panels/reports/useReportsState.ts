/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { tr, t as tt2 } from '@/lib/i18n';
import { marked } from 'marked';
import { useLang } from '@/stores/useLang';

// ═══ Reports State Hook — all state + business logic for ReportsPanel ═══

export function useReportsState(onEditingReport?: (r: any) => void, appliedReport?: any, reportRefresh?: number, active?: boolean) {
  const lang = useLang();
  // ─── Core state ───
  const [reportType, setReportType] = useState('daily');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);

  // ─── UI state ───
  const [reportSearch, setReportSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  type SendResult = { key: 'success' | 'smtp-fail' | 'fail'; errorDetail?: string };
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const sendResultText = (r: SendResult | null, lang: string): string => {
    if (!r) return '';
    const msgs: Record<string, Record<string, string>> = {
      success: { zh: '✅ 报告发送成功！', ja: '✅ レポートを送信しました！', en: '✅ Report sent successfully!' },
      'smtp-fail': { zh: `❌ ${r.errorDetail || '发送失败。检查 SMTP 配置。'}`, ja: `❌ ${r.errorDetail || '送信失敗。SMTP設定を確認してください。'}`, en: `❌ ${r.errorDetail || 'Send failed. Check SMTP config.'}` },
      fail: { zh: '❌ 发送失败。请在 Settings → Email 中检查 SMTP 配置。', ja: '❌ 送信失敗。Settings → Email でSMTP設定を確認してください。', en: '❌ Send failed. Please check SMTP config in Settings → Email.' },
    };
    return msgs[r.key]?.[lang] || msgs[r.key]?.en || '';
  };
  const [sendTo, setSendTo] = useState('');
  const [sendCC, setSendCC] = useState('');
  const [sendSubject, setSendSubject] = useState('');
  const [sendBody, setSendBody] = useState('');
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [unsavedTarget, setUnsavedTarget] = useState<any>(null);
  const [sendAttachments, setSendAttachments] = useState<File[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reportPendBack, setReportPendBack] = useState(false);
  const [deletedNotify, setDeletedNotify] = useState<string | null>(null);

  // ─── Derived ───
  const editing = !!(selected || (title && selected === null && content));
  const isSent = selected?.status === 'sent';

  // ─── Fetch ───
  const fetchReports = async () => { try { const d = await api.report.list(50); setReports(Array.isArray(d) ? d : []); } catch {} };
  useEffect(() => { fetchReports(); }, []);
  useEffect(() => { if (reportRefresh) fetchReports(); }, [reportRefresh]);
  // Re-sync editingReport when panel becomes active — it was cleared on panel exit
  const prevSelectedRef = useRef<any>(null);
  useEffect(() => {
    if (active && selected) onEditingReport?.({ title, content, id: currentReportId || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- [active] only; sync effect at line 74 covers field changes
  }, [active]);
  useEffect(() => { const h = (e: Event) => { const d = (e as any).detail; fetchReports(); setTitle(d.title); setReportType(d.reportType||'daily'); setCurrentReportId(d.id); api.report.byId(d.id).then((r:any) => { if(r) { setSelected({id:d.id,title:d.title,content:r.content||''}); setContent(r.content||''); onEditingReport?.({title:r.title,content:r.content||'',id:d.id}); } else { setDeletedNotify(tr(lang,'该报告已被删除。','このレポートは削除されました。','รายงานนี้ถูกลบแล้ว','Kua Mukua tēnei Pūrongo','Этот отчёт удалён.','This report has been deleted.')); } }).catch(()=>{}); }; window.addEventListener('tl-select-report', h); const onCloseEditor = () => { setSelected(null); setTitle(''); setContent(''); onEditingReport?.(null as any); }; window.addEventListener('tl-close-report-editor', onCloseEditor); const consumePending = () => { const pending = (window as any).__tl_pendingReportSelect; if (pending) { (window as any).__tl_pendingReportSelect = null; h({ detail: pending } as any); } }; consumePending(); return () => { window.removeEventListener('tl-select-report', h); window.removeEventListener('tl-close-report-editor', onCloseEditor); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listeners registered once; lang/onEditingReport recreated per render
  }, []);
  // Auto-refresh when returning to list (selected goes from truthy → null)
  const skipFetchRef = useRef(false);
  useEffect(() => {
    const wasEditing = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (wasEditing && !selected && !skipFetchRef.current) fetchReports();
    skipFetchRef.current = false;
  }, [selected]);
  // Clear App.tsx editingReport when editor closes (returns to report list)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onEditingReport recreated per render; [selected] is the real trigger
  useEffect(() => { if (!selected) (onEditingReport as any)?.(null); }, [selected]);
  // Re-check pending selection when panel becomes active (panel stays mounted via lazy-mount)
  useEffect(() => { if (!active) return; const pending = (window as any).__tl_pendingReportSelect; if (pending) { (window as any).__tl_pendingReportSelect = null; window.dispatchEvent(new CustomEvent('tl-select-report', { detail: pending })); } fetchReports(); }, [active]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onEditingReport recreated per render; [title, content, currentReportId] are the real triggers
  useEffect(() => { if (selected) onEditingReport?.({title, content, id: currentReportId||undefined}); }, [title, content, currentReportId]);
  useEffect(() => { if (appliedReport) { if (appliedReport.title) setTitle(appliedReport.title); if (appliedReport.content) setContent(appliedReport.content); } }, [appliedReport]);

  // ─── Dirty tracking ───
  const reportEditedRef = useRef(false);
  const [reportReady, setReportReady] = useState(false);
  useEffect(() => { reportEditedRef.current = false; setReportReady(false); const t = setTimeout(() => setReportReady(true), 1000); return () => clearTimeout(t); }, [selected?.id]);
  const onReportContent = (val: string) => { setContent(val); if (reportReady) reportEditedRef.current = true; };
  const onReportTitle = (e: any) => { setTitle(e.target.value); if (reportReady) reportEditedRef.current = true; };
  const onReportType = (e: any) => { setReportType(e.target.value); if (reportReady) reportEditedRef.current = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selected identity changes on list refresh; selected?.id is the real trigger
  useEffect(() => { const dirty = selected && reportReady && reportEditedRef.current; (window as any).__tl_unsaved = dirty ? 'reports' : null; return () => { if ((window as any).__tl_unsaved === 'reports') (window as any).__tl_unsaved = null; }; }, [title, content, reportType, reportReady, selected?.id]);

  // ─── Save ───
  const handleSave = async () => {
    if (!content && !title.trim()) return;
    setSaving(true);
    try {
      const today = new Date().toISOString().substring(0,10);
      const t = title.trim() || `${lang === 'zh' ? '日报' : 'Daily'} — ${today}`;
      const saved = await api.report.save({ reportType, title: t, content, id: selected?.id || currentReportId || undefined });
      if (saved?.id) { setCurrentReportId(saved.id); if (!selected?.id) setSelected({...selected, id: saved.id, status:'draft'}); }
      reportEditedRef.current = false; setReportReady(false); setTimeout(() => setReportReady(true), 500);
      fetchReports();
    } catch { alert(tt2('report.saveFailed', lang)); }
    setSaving(false);
  };

  // ─── Delete ───
  const executeDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteTarget(null);
    skipFetchRef.current = true;
    try {
      await api.report.delete(deleteTarget);
      setReports(prev => prev.filter((r: any) => r.id !== deleteTarget));
      setSelected(null); setTitle(''); setContent(''); setCurrentReportId(null); onEditingReport?.(null);
    } catch { alert(tt2('report.deleteFailed', lang)); }
    setDeleting(false);
    setDeleteTarget(null);
  };

  // ─── Send ───
  const handleSendEmail = async () => {
    if (!content) return;
    setSending(true);
    try {
      setSendMsg(lang === 'zh' ? '发送中...' : lang === 'ja' ? '送信中...' : 'Sending...');
      const today = new Date().toISOString().substring(0,10);
      const t = title.trim() || `${lang === 'zh' ? '日报' : 'Daily'} — ${today}`;
      const subject = sendSubject || `[TomiLite] ${t}`;
      const atts: any[] = [];
      for (const file of sendAttachments) { const b64 = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(',')[1]); reader.readAsDataURL(file); }); atts.push({ filename: file.name, content: b64, contentType: file.type||'application/octet-stream' }); }
      const body = sendBody || content || '';
      const html = await marked.parse(body, { async: true });
      const result = await api.email.sendReport({ to: sendTo, cc: sendCC, subject, html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}th{background:#f5f5f5;font-weight:600}</style></head><body style="font-family:sans-serif"><div style="max-width:600px;margin:0 auto;padding:20px">
${html}</div></body></html>`, attachments: atts });
      if (!result?.ok) { setSendResult({ key: 'smtp-fail', errorDetail: result?.error }); setSending(false); return; }
      setShowSendDialog(false); setSendResult({ key: 'success' });
      const saved = await api.report.save({ reportType, title: t, content, id: selected?.id||currentReportId||undefined });
      if (saved?.id) { await api.report.markSent(saved.id); fetchReports(); setSelected(null); setTitle(''); setContent(''); setCurrentReportId(null); }
    } catch { setSendResult({ key: 'fail' }); }
    setSending(false);
  };

  return {
    reportType, setReportType, title, setTitle, content, setContent, selected, setSelected,
    reports, setReports, currentReportId, setCurrentReportId, reportSearch, setReportSearch,
    saving, setSaving, sending, setSending, sendMsg, setSendMsg, sendResult, setSendResult, sendResultMsg: sendResultText(sendResult, lang),
    sendTo, setSendTo, sendCC, setSendCC, sendSubject, setSendSubject,
    sendBody, setSendBody,
    showSendDialog, setShowSendDialog, unsavedTarget, setUnsavedTarget,
    sendAttachments, setSendAttachments, deleteTarget, setDeleteTarget, deleting, reportPendBack, setReportPendBack, deletedNotify, setDeletedNotify,
    editing, isSent, fetchReports,
    reportReady, reportEditedRef, onReportContent, onReportTitle, onReportType,
    handleSave, executeDelete, handleSendEmail,
  };
}
