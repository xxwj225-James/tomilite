/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { useLang } from '@/stores/useLang';
import { t as tt2 } from '@/lib/i18n';
import { marked } from 'marked';

// ═══ Email State Hook — standalone, independent polling ═══

/** Map backend/nodemailer error messages to i18n keys */
function translateSendError(errMsg: string, lang: string): string {
  if (!errMsg) return tt2('emailPanel.sendError.sendFailed', lang);
  const lower = errMsg.toLowerCase();
  if (lower.includes('no recipients') || lower.includes('recipients defined')) return tt2('emailPanel.sendError.noRecipients', lang);
  if (lower.includes('smtp') && lower.includes('config')) return tt2('emailPanel.sendError.smtpIncomplete', lang);
  if (lower.includes('password') || lower.includes('auth')) return tt2('emailPanel.sendError.noPassword', lang);
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('abort') || lower.includes('timeout')) return tt2('emailPanel.sendError.network', lang);
  // Return raw error for unknown messages (already English from nodemailer/system)
  return errMsg;
}

export function useEmailState(emailRefresh?: number, active?: boolean) {
  const lang = useLang();
  // ─── Core state ───
  const [emails, setEmails] = useState<any[]>([]);
  const emailsRef = useRef<any[]>([]);
  const [userEmail, setUserEmail] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [activeCategory, setActiveCategory] = useState<number | null>(null); // 1|2|3|null=all

  // ─── Detail state ───
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendCC, setSendCC] = useState('');
  const [sendSubject, setSendSubject] = useState('');
  const lastSavedDraftRef = useRef('');
  const [draftGenerating, setDraftGenerating] = useState(false);
  const draftAbortRef = useRef<AbortController | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [emailFullBody, setEmailFullBody] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);

  // ─── Connection state ───
  const [connected, setConnected] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  // ─── UI state ───
  const [refreshing, setRefreshing] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [pendingBack, setPendingBack] = useState(false);
  const [emailSearch, setEmailSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDismissing, setBatchDismissing] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // ─── Email sort state (persisted to DB) ───
  const [emailSortKey, setEmailSortKey] = useState<'date' | 'from' | 'subject'>('date');
  const [emailSortDir, setEmailSortDir] = useState<'asc' | 'desc'>('desc');

  // Load persisted email sort
  useEffect(() => {
    fetch('/api/system.getConfig?input=' + encodeURIComponent(JSON.stringify({ key: 'emailSort' })))
      .then(r => r.json()).then(d => { if (d.result?.data) try { const v = JSON.parse(d.result.data); setEmailSortKey(v.key||'date'); setEmailSortDir(v.dir||'desc'); } catch {} }).catch(() => {});
  }, []);

  // Save email sort on change
  useEffect(() => {
    fetch('/api/system.setConfig', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ key: 'emailSort', value: JSON.stringify({ key: emailSortKey, dir: emailSortDir }) }) }).catch(() => {});
  }, [emailSortKey, emailSortDir]);

  const toggleEmailSort = (key: 'date' | 'from' | 'subject') => {
    if (emailSortKey === key) setEmailSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setEmailSortKey(key); setEmailSortDir('asc'); }
  };
  const emailSortArrow = (key: string) => emailSortKey === key ? (emailSortDir === 'asc' ? ' ▲' : ' ▼') : '';

  // ─── LLM sub-grouping (all categories) ───
  const [subGroups, setSubGroups] = useState<Record<number, Array<{ groupKey: string; label: string; emailIds: string[] }>>>({});
  const [subGroupLoading, setSubGroupLoading] = useState<Record<number, boolean>>({});
  const subGroupsRef = useRef(subGroups);
  subGroupsRef.current = subGroups;
  // Track which categories have been attempted (even if LLM returned empty)
  const subGroupsFetchedRef = useRef<Set<number>>(new Set());

  const loadSubGroups = useCallback(async (cat: number, emailIds: string[]) => {
    if (subGroupsFetchedRef.current.has(cat)) return; // already attempted
    if (!emailIds.length) return;
    subGroupsFetchedRef.current.add(cat);
    setSubGroupLoading(prev => ({ ...prev, [cat]: true }));
    try {
      const resp = await fetch('/api/email.subGroupByCategory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailIds, category: cat, lang }),
      });
      const d = await resp.json();
      const groups = d.result?.data?.groups;
      if (groups && groups.length > 0) {
        setSubGroups(prev => ({ ...prev, [cat]: groups }));
      }
    } catch { /* fall back to flat table */ }
    setSubGroupLoading(prev => ({ ...prev, [cat]: false }));
  }, [lang]);

  // Clear sub-group cache when emails refresh
  useEffect(() => { setSubGroups({}); subGroupsFetchedRef.current = new Set(); }, [emailRefresh]);
  // Also clear when emails array content changes
  const prevEmailIdsRef = useRef('');
  useEffect(() => {
    const key = emails.map(e => e.id).sort().join(',');
    if (prevEmailIdsRef.current && prevEmailIdsRef.current !== key) {
      setSubGroups({});
      subGroupsFetchedRef.current = new Set();
    }
    prevEmailIdsRef.current = key;
  }, [emails]);

  // ─── i18n helper (delegates to centralized i18n.ts) ───
  const t = (key: string) => tt2(('emailDetail.' + key) as any, lang);

  // ─── Data fetching (debounced, independent from Tasks) ───
  const fetchEmails = useCallback(async () => {
    try {
      const r = await fetch('/api/email.listSmartEmails?input=' + encodeURIComponent(JSON.stringify({ unprocessedOnly: true, limit: 50 })));
      const d = await r.json();
      const newEmails = d.result?.data || [];
      setEmails(newEmails);
      emailsRef.current = newEmails;
    } catch { /* silent */ }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/email.imapStatus');
      const d = await r.json();
      // emailManager.getStatus() returns { [integrationId]: { connected, ... } }
      const status = d.result?.data || {};
      const anyConnected = typeof status === 'object' && Object.values(status).some((s: any) => s?.connected);
      setConnected(anyConnected);
    } catch { /* silent */ }
    try {
      const r = await fetch('/api/email.getConfig');
      const d = await r.json();
      const cfgs = d.result?.data || [];
      const hasImap = cfgs.some((c: any) => c.type === 'imap');
      setConfigLoaded(hasImap);
      // Extract user email from SMTP config
      const smtp = cfgs.find((c: any) => c.type === 'smtp');
      if (smtp) {
        try {
          const cfg = JSON.parse(smtp.config);
          setUserEmail(cfg.user || '');
        } catch {}
      }
    } catch { /* silent */ }
  }, []);

  // Initial fetch + debounced polling
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    fetchEmails();
    fetchStatus();
  }, [fetchEmails, fetchStatus]);

  useEffect(() => {
    if (emailRefresh && emailRefresh > 0) {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      fetchTimerRef.current = setTimeout(() => { fetchEmails(); fetchStatus(); }, 300);
    }
    return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); };
  }, [emailRefresh, fetchEmails, fetchStatus]);

  // Refresh when panel becomes active
  useEffect(() => {
    if (active) { fetchEmails(); fetchStatus(); }
  }, [active, fetchEmails, fetchStatus]);

  // Periodic check every 60s when panel is active
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => { fetchEmails(); fetchStatus(); }, 60000);
    return () => clearInterval(iv);
  }, [active, fetchEmails, fetchStatus]);

  // ─── Select email → load draft ───
  const selectEmail = useCallback(async (email: any) => {
    setIsReplying(false);
    setSelected(email);
    setSendError('');
    // Seed reply fields from original email
    const extractEmail = (addr: string) => { const m = addr.match(/<([^>]+)>/); return m ? m[1] : addr; };
    setSendTo(extractEmail(email.fromAddr || '') || '');
    setSendCC(email.cc || '');
    setSendSubject('Re: ' + (email.subject || '').replace(/^📥\s*/, ''));
    const existingDraft = email.replyDraft || '';
    setReplyText(existingDraft);
    lastSavedDraftRef.current = existingDraft;
    // Mark as read — update local state + DB
    if (!email.isRead) {
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: true } : e));
      fetch('/api/email.markRead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: email.id }),
      }).catch(() => {});
    }
    // For cat 1/2 without draft, auto-generate
    if ((email.category === 1 || email.category === 2) && !existingDraft) {
      startDraftGenerationInner(email);
    }
    // Cat 1/2: auto-show original email body
    if (email.category === 1 || email.category === 2) {
      setEmailLoading(true);
      setEmailFullBody(null);
      try {
        const r = await fetch('/api/email.getBody?input=' + encodeURIComponent(JSON.stringify({ id: email.id })));
        const d = await r.json();
        const body = d.result?.data;
        setEmailFullBody(body || null); // store raw — sanitize at render time
      } catch { /* silent */ }
      setEmailLoading(false);
    } else {
      setEmailFullBody(null);
    }
  }, []);

  // ─── Batch select ───
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAllInView = useCallback((ids: string[]) => {
    setSelectedIds(prev => {
      const allSelected = ids.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...ids]);
    });
  }, []);

  const batchDismiss = useCallback(() => {
    if (selectedIds.size === 0) return;
    setBatchDismissing(true);
    const ids = [...selectedIds];
    // Optimistic UI update — remove immediately, fire requests in background
    setEmails(prev => prev.filter(e => !selectedIds.has(e.id)));
    if (selected && selectedIds.has(selected.id)) setSelected(null);
    setSelectedIds(new Set());
    // Fire all requests in parallel (fire-and-forget)
    Promise.all(ids.map(id =>
      fetch('/api/email.markProcessed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => null)
    )).finally(() => setBatchDismissing(false));
  }, [selectedIds, selected]);

  // ─── Dismiss ───
  const dismissEmail = useCallback(async (id: string) => {
    setDismissing(true);
    try {
      await fetch('/api/email.markProcessed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch { /* non-critical, still remove from UI */ }
    setEmails(prev => prev.filter(e => e.id !== id));
    if (selected?.id === id) setSelected(null);
    setDismissTarget(null);
    setDismissing(false);
  }, [selected?.id]);

  // ─── Read full email ───
  const handleReadFullEmail = async () => {
    if (!selected?.id) { console.warn('[Email] getBody: no selected.id'); return; }
    setEmailLoading(true);
    setEmailFullBody(null);
    try {
      console.log('[Email] getBody: fetching', selected.id);
      const r = await fetch('/api/email.getBody?input=' + encodeURIComponent(JSON.stringify({ id: selected.id })));
      const d = await r.json();
      const body = d.result?.data;
      console.log('[Email] getBody: got', { ok: !!body, len: body?.length });
      // Store raw body — sanitize at render time only (double sanitize strips too much)
      setEmailFullBody(body || `<p style="color:var(--muted)">${t('loadFail')}</p>`);
    } catch (e: any) {
      console.error('[Email] getBody: fetch error', e?.message);
      setEmailFullBody(`<p style="color:var(--muted)">${t('loadFail')}</p>`);
    }
    setEmailLoading(false);
  };

  // ─── Generate AI reply draft ───
  const startDraftGenerationInner = useCallback(async (email: any) => {
    if (!email) return;
    setDraftGenerating(true);
    const controller = new AbortController();
    draftAbortRef.current = controller;
    try {
      const resp = await fetch('/api/email.generateDraft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: (email.subject || '').replace(/^📥\s*/, ''),
          fromAddr: email.fromAddr || '',
          body: email.summary || '',
          lang,
          issueId: email.issueId || undefined,
          smartEmailId: email.id,
        }),
        signal: controller.signal,
      });
      const d = await resp.json();
      const draft = d.result?.data?.draft || '';
      if (draft && !controller.signal.aborted) {
        setIsReplying(true);
        setReplyText(draft);
        lastSavedDraftRef.current = draft;
      }
    } catch { /* aborted or network error */ }
    if (!controller.signal.aborted) setDraftGenerating(false);
    draftAbortRef.current = null;
  }, [lang]);

  const startDraftGeneration = useCallback(() => {
    if (selected) startDraftGenerationInner(selected);
  }, [selected, startDraftGenerationInner]);

  const startManualReply = useCallback(() => {
    if (!selected) return;
    setIsReplying(true);
    const extractEmail = (addr: string) => { const m = addr.match(/<([^>]+)>/); return m ? m[1] : addr; };
    setSendTo(extractEmail(selected.fromAddr || '') || '');
    setSendCC(selected.cc || '');
    setSendSubject('Re: ' + (selected.subject || '').replace(/^📥\s*/, ''));
    setReplyText(''); // empty editor — user writes their own reply
    lastSavedDraftRef.current = '';
  }, [selected]);

  // Listen for agent-applied email draft updates
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.text) { setIsReplying(true); setReplyText(detail.text); lastSavedDraftRef.current = detail.text; }
    };
    window.addEventListener('tl-email-draft-update', handler);
    return () => window.removeEventListener('tl-email-draft-update', handler);
  }, []);

  // Esc to cancel draft generation
  useEffect(() => {
    if (!draftGenerating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && draftAbortRef.current) {
        draftAbortRef.current.abort();
        setDraftGenerating(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draftGenerating]);

  // ─── Send reply ───
  const handleSendReply = useCallback(async () => {
    if (!selected || !replyText.trim()) return;
    setSending(true);
    setSendError('');
    try {
      const cfgResp = await fetch('/api/email.getConfig');
      const cfgData = await cfgResp.json();
      const smtp = (cfgData.result?.data || []).find((c: any) => c.type === 'smtp');
      if (!smtp) { setSendError(tt2('emailPanel.sendError.noSmtp', lang)); setSending(false); return; }
      const cfg = JSON.parse(smtp.config);

      const r = await fetch('/api/email.sendEmail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.pass || cfg.password,
          tls: cfg.port === 587, from: cfg.user,
          to: sendCC ? `${sendTo}, ${sendCC}` : sendTo,
          cc: sendCC || undefined,
          subject: sendSubject,
          html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}th{background:#f5f5f5;font-weight:600}</style></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">${marked.parse(replyText)}</body></html>`,
        }),
      });
      const rd = await r.json();
      if (rd.result?.data?.ok) {
        // Mark as processed
        await fetch('/api/email.markProcessed', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selected.id }),
        });
        // If linked to issue, mark issue as done
        if (selected.issueId) {
          await api.issue.update({ id: selected.issueId, status: 'done' });
        }
        setSelected(null);
        fetchEmails();
      } else {
        const errMsg = rd.result?.data?.error || '';
        setSendError(translateSendError(errMsg, lang));
      }
    } catch (e: any) {
      const errMsg = e.message || '';
      setSendError(translateSendError(errMsg, lang));
    }
    setSending(false);
  }, [selected, replyText, sendTo, sendCC, sendSubject, fetchEmails]);

  // ─── Link Task (AI generates title + description) ───
  const [linkingTask, setLinkingTask] = useState(false);
  const [linkedIssue, setLinkedIssue] = useState<any>(null);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);

  useEffect(() => {
    if (selected?.issueId) {
      // Fetch linked task info
      api.issue.byId(selected.issueId).then((issue: any) => {
        if (issue) setLinkedIssue(issue);
      }).catch(() => {});
    } else {
      setLinkedIssue(null);
    }
  }, [selected?.id, selected?.issueId]);

  const handleLinkTask = useCallback(async () => {
    if (!selected) return;
    setLinkingTask(true);
    try {
      const r = await fetch('/api/email.createLinkedTask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smartEmailId: selected.id, lang }),
        signal: AbortSignal.timeout(15000),
      });
      const d = await r.json();
      if (d.result?.data?.ok) {
        const issue = d.result.data.issue;
        setLinkedIssue(issue);
        // Update selected in place
        setSelected({ ...selected, issueId: issue.id });
        // Refresh emails list so the table badge updates
        fetchEmails();
      }
    } catch { /* ignore */ }
    setLinkingTask(false);
  }, [selected, lang, fetchEmails]);

  const [unlinking, setUnlinking] = useState(false);
  const handleUnlinkTask = useCallback(async () => {
    if (!selected?.id) return;
    setUnlinking(true);
    try {
      const r = await fetch('/api/email.unlinkTask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smartEmailId: selected.id }),
        signal: AbortSignal.timeout(15000),
      });
      const d = await r.json();
      if (d.result?.data?.ok) {
        setLinkedIssue(null);
        setSelected({ ...selected, issueId: null });
        fetchEmails();
      }
    } catch { /* ignore */ }
    setUnlinking(false);
    setUnlinkConfirm(false);
  }, [selected, fetchEmails]);

  // ─── Open linked task in Tasks panel ───
  const openLinkedTask = useCallback(() => {
    if (!linkedIssue) return;
    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'tasks' }));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('tl-select-task', {
        detail: { id: linkedIssue.id, key: `TL-${linkedIssue.issueNumber}`, title: linkedIssue.title, status: linkedIssue.status, priority: linkedIssue.priority, editMode: true },
      }));
    }, 300);
  }, [linkedIssue]);

  // ─── Save draft on back ───
  const saveDraftAndBack = useCallback(async () => {
    if (selected && replyText !== lastSavedDraftRef.current) {
      try {
        await fetch('/api/email.saveDraft', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issueId: selected.issueId || undefined, smartEmailId: selected.id, draft: replyText }),
        });
      } catch { /* non-critical */ }
      lastSavedDraftRef.current = replyText;
    }
    setIsReplying(false);
    setSelected(null);
    setPendingBack(false);
  }, [selected, replyText]);

  // ─── Dirty tracking ───
  useEffect(() => {
    if (!selected || selected.status === 'done') return;
    const dirty = replyText !== lastSavedDraftRef.current;
    (window as any).__tl_unsaved = dirty ? 'email' : null;
    return () => { if ((window as any).__tl_unsaved === 'email') (window as any).__tl_unsaved = null; };
  }, [replyText, selected?.id]);

  // ─── Filtered emails ───
  const filteredByCategory = activeCategory
    ? emails.filter((e: any) => e.category === activeCategory)
    : emails;

  const filteredEmails = emailSearch
    ? filteredByCategory.filter((e: any) =>
        (e.subject || '').toLowerCase().includes(emailSearch.toLowerCase()) ||
        (e.fromAddr || '').toLowerCase().includes(emailSearch.toLowerCase()) ||
        (e.summary || '').toLowerCase().includes(emailSearch.toLowerCase())
      )
    : filteredByCategory;

  const categoryCounts = {
    all: emails.length,
    1: emails.filter((e: any) => e.category === 1).length,
    2: emails.filter((e: any) => e.category === 2).length,
    3: emails.filter((e: any) => e.category === 3).length,
    4: emails.filter((e: any) => e.category === 4).length,
  };

  // Per-category stats for summary cards
  const categoryStats = [1, 2, 3, 4].map(cat => {
    const catEmails = emails.filter((e: any) => e.category === cat);
    const needsReply = catEmails.filter((e: any) => cat <= 2 && !e.isReplied && !e.issueId).length;
    const unread = catEmails.filter((e: any) => !e.isRead).length;
    const total = catEmails.length;
    return { cat, total, unread, needsReply, emails: catEmails };
  });

  // ─── AI Topic grouping per category ───
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await fetchEmails(); await fetchStatus(); } finally { setRefreshing(false); }
  }, [fetchEmails, fetchStatus]);

  return {
    // State
    emails, filteredEmails, selected, setSelected, activeCategory, setActiveCategory,
    replyText, setReplyText, isReplying, sendTo, setSendTo, sendCC, setSendCC, sendSubject, setSendSubject, lastSavedDraftRef, draftGenerating, sending, sendError, setSendError,
    emailFullBody, setEmailFullBody, emailLoading, connected, configLoaded,
    userEmail, refreshing, dismissTarget, setDismissTarget, dismissing, pendingBack, setPendingBack,
    emailSearch, setEmailSearch, expandedCategory, setExpandedCategory, expandedGroup, setExpandedGroup,
    subGroups, subGroupLoading, loadSubGroups,
    selectedIds, setSelectedIds, toggleSelect, selectAllInView, batchDismiss, batchDismissing,
    categoryCounts, categoryStats,
    // Handlers
    t, fetchEmails, refresh,
    selectEmail, dismissEmail, handleReadFullEmail,
    startDraftGeneration, startManualReply, handleSendReply,
    handleLinkTask, handleUnlinkTask, openLinkedTask, linkingTask, linkedIssue, unlinkConfirm, setUnlinkConfirm, unlinking,
    emailSortKey, emailSortDir, toggleEmailSort, emailSortArrow,
    saveDraftAndBack,
  };
}
