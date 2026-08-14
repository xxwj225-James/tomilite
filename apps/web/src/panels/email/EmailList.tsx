import { useRef, useEffect, useState } from 'react';
import { tt } from '@/i18n/translations';
import { t as tt2 } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';

// ═══ Email Mindmap View — category cards → tree lines → topic groups → email table ═══

type EmailItem = { id: string; subject: string; fromAddr: string; summary: string; date: string; category: number; isRead: boolean; isReplied: boolean; issueId?: string };
type CatStats = { cat: number; total: number; unread: number; needsReply: number; emails: EmailItem[] };

const CAT_META: Record<number, { icon: string; label: string; color: string; bg: string }> = {
  1: { icon: '🔴', label: 'Urgent', color: '#e74c3c', bg: '#fef0ef' },
  2: { icon: '🟡', label: 'Action Required', color: '#f39c12', bg: '#fef9e7' },
  3: { icon: '🔔', label: 'Notifications', color: '#8e44ad', bg: '#f5eef8' },
  4: { icon: '🔵', label: 'Other', color: '#7f8c8d', bg: '#f4f6f7' },
};
const CAT_LABEL_CLEAN: Record<number, Record<string, string>> = {
  1: { zh: '紧急', en: 'Urgent' },
  2: { zh: '需处理', en: 'Action Required' },
  3: { zh: '通知', en: 'Notifications' },
  4: { zh: '其他', en: 'Other' },
};

function fromDisplay(addr: string) {
  if (!addr) return '—';
  // Extract display name if present: "Name" <email> → Name, or just email
  const nameMatch = addr.match(/"?([^"<]*)"?\s*<[^>]+>/);
  if (nameMatch && nameMatch[1].trim()) return nameMatch[1].trim().substring(0, 30);
  // Fallback: just the raw address, strip angle brackets
  return addr.replace(/[<>]/g, '').trim().substring(0, 30);
}
function dateDisplay(d: string) { return (d || '').substring(5, 16); }

// ─── SVG connecting lines ───
function TreeLines({ lines }: { lines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }> }) {
  if (lines.length === 0) return null;
  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}>
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
      ))}
    </svg>
  );
}

export function EmailList(p: Record<string, unknown>) {
  const get = (key: string): any => (p as Record<string, never>)[key];
  const lang = useLang();
  const _tt = (k: string, v?: Record<string,string>) => tt(lang, k, v);
  // Legacy inline t() — keep for email-specific keys not yet in translations
  const t = get('t') as (k: string) => string;

  const stats = get('categoryStats') as CatStats[];
  const counts = get('categoryCounts') as Record<string, number>;
  const searchTerm = (get('emailSearch') as string) || '';

  const containerRef = useRef<HTMLDivElement>(null);
  const [lineData, setLineData] = useState<Array<{ x1: number; y1: number; x2: number; y2: number; color: string }>>([]);

  // Recalculate mindmap connecting lines on expand/collapse
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }> = [];
    const rect = container.getBoundingClientRect();

    [1, 2, 3, 4].forEach(cat => {
      const color = CAT_META[cat]?.color || '#999';
      const catCard = container.querySelector(`[data-cat-card="${cat}"]`);
      const catArea = container.querySelector(`[data-cat-area="${cat}"]`);
      if (!catCard || !catArea) return;

      const cr = catCard.getBoundingClientRect();
      const ar = catArea.getBoundingClientRect();
      const stemX = cr.left + cr.width / 2 - rect.left;
      const stemY1 = cr.bottom - rect.top;
      const stemY2 = ar.top - rect.top;

      // Vertical stem from category card to its content area
      lines.push({ x1: stemX, y1: stemY1, x2: stemX, y2: stemY2, color });

      // Find topic cards within this category area
      const topicCards = catArea.querySelectorAll('[data-topic-card]');
      if (topicCards.length > 0) {
        const firstTC = topicCards[0].getBoundingClientRect();
        const lastTC = topicCards[topicCards.length - 1].getBoundingClientRect();
        const branchY = firstTC.top - rect.top - 8;

        // Short vertical from stem end to branch level
        lines.push({ x1: stemX, y1: stemY2, x2: stemX, y2: branchY, color });

        // Horizontal branch line spanning all topic cards
        lines.push({ x1: firstTC.left + firstTC.width / 2 - rect.left, y1: branchY, x2: lastTC.left + lastTC.width / 2 - rect.left, y2: branchY, color });

        // Vertical drops from branch to each topic card
        topicCards.forEach(tc => {
          const tcr = tc.getBoundingClientRect();
          const tx = tcr.left + tcr.width / 2 - rect.left;
          lines.push({ x1: tx, y1: branchY, x2: tx, y2: tcr.top - rect.top, color });

          // From topic card to its email items
          const emailItems = tc.querySelectorAll('[data-email-item]');
          emailItems.forEach(ei => {
            const er = ei.getBoundingClientRect();
            lines.push({ x1: tx, y1: tcr.bottom - rect.top, x2: er.left + er.width / 2 - rect.left, y2: er.top - rect.top, color });
          });
        });
      } else {
        // No topic cards: stem goes directly to email table
        const emailItem = catArea.querySelector('[data-email-item]');
        if (emailItem) {
          const er = emailItem.getBoundingClientRect();
          lines.push({ x1: stemX, y1: stemY2, x2: er.left + er.width / 2 - rect.left, y2: er.top - rect.top, color });
        }
      }
    });
    setLineData(lines);
  }, [stats, get('expandedGroup'), get('expandedCategory'), get('emails')?.length]);

  // Build lookup: cat -> CatStats
  const statMap: Record<number, CatStats> = {};
  stats.forEach(s => { statMap[s.cat] = s; });

  const filterEmails = (emails: EmailItem[]) => {
    if (!searchTerm) return emails;
    const s = searchTerm.toLowerCase();
    return emails.filter(e => (e.subject || '').toLowerCase().includes(s) || (e.fromAddr || '').toLowerCase().includes(s));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--edge)', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-ghost btn-xs" style={{ width: 24, textAlign: 'center', flexShrink: 0, animation: get('refreshing') ? 'spin 1s linear infinite' : 'none' }}
          onClick={() => get('refresh')()} title={t('refresh')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        </button>
        {get('configLoaded') && (
          get('connected') ? (
            <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600, padding: '2px 8px', borderRadius: 10, border: '1px solid var(--green)' }}>{t('connected')}</span>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 600, padding: '2px 8px', borderRadius: 10, border: '1px solid var(--amber)' }}>{t('disconnected')}</span>
          )
        )}
        <input className="form-input" autoComplete="off" style={{ flex: 1, fontSize: 11, minWidth: 100 }}
          placeholder={_tt('emailPanel.search')}
          value={searchTerm}
          onChange={e => get('setEmailSearch')(e.target.value)} />
        <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{counts.all} {lang === 'zh' ? '封' : lang === 'ja' ? '通' : ''}</span>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative', paddingBottom: 80 }} ref={containerRef}>
        <TreeLines lines={lineData} />

        {!get('configLoaded') ? (
          <div style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📧</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>{tt2('emailList.noConfigTitle', lang)}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, maxWidth: 280, lineHeight: 1.6 }}>
              {tt2('emailList.noConfigDesc', lang)}
            </div>
            <button className="btn btn-brand btn-sm" style={{ fontSize: 13, padding: '8px 20px' }} onClick={() => {
              (window as any).__tl_settingsTab = 'email';
              window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' }));
            }}>{tt2('emailList.goToSettings', lang)}</button>
          </div>
        ) : (
          <div style={{ padding: '12px 16px', position: 'relative', zIndex: 1 }}>
            {/* ─── Row 1: ALL 3 category cards (always visible, even with 0) ─── */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'nowrap', marginBottom: 8 }}>
              {[1, 2, 3, 4].map(cat => {
                const st = statMap[cat] || { cat, total: 0, unread: 0, needsReply: 0, emails: [] as EmailItem[] };
                const meta = CAT_META[cat];
                const isExpanded = get('expandedCategory') === cat;
                return (
                  <div key={cat} data-cat-card={cat} style={{ flex: '1 1 0', minWidth: 0 }}>
                    <div
                      onClick={() => {
                        if (st.total === 0) return;
                        get('setExpandedCategory')(isExpanded ? null : cat);
                      }}
                      style={{
                        width: '100%', padding: '14px 6px',
                        cursor: st.total > 0 ? 'pointer' : 'default',
                        background: isExpanded ? meta.bg : `color-mix(in srgb, ${meta.color} 6%, var(--surface2))`,
                        borderRadius: 12, border: `2px solid ${isExpanded ? meta.color : 'var(--edge)'}`,
                        textAlign: 'center', transition: 'all .2s',
                        boxShadow: isExpanded ? `0 2px 12px ${meta.color}33` : 'none',
                        opacity: st.total > 0 ? 1 : 0.5,
                      }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: meta.color, marginBottom: 4 }}>
                        {cat === 1 ? t('tabUrgent') : cat === 2 ? t('tabAction') : cat === 3 ? t('tabNotify') : t('tabLow')}
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>{st.total}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', justifyContent: 'center', gap: 8 }}>
                        {st.unread > 0 && <span style={{ color: 'var(--amber)', fontWeight: 600 }}>{st.unread} {lang === 'zh' ? '未読' : lang === 'ja' ? '未読' : 'unread'}</span>}
                        {st.needsReply > 0 && <span style={{ color: meta.color, fontWeight: 600 }}>{st.needsReply} {lang === 'zh' ? '要返信' : lang === 'ja' ? '要返信' : 'reply'}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ─── Row 2+: Expanded content (below cards) ─── */}
            {[1, 2, 3, 4].map(cat => {
              if (get('expandedCategory') !== cat) return null;
              const st = statMap[cat] || { total: 0, unread: 0, needsReply: 0, emails: [] as EmailItem[] };
              if (st.total === 0) return null;
              const meta = CAT_META[cat];

              const catDescKeys: Record<number, string> = { 1: 'emailList.cat1Desc', 2: 'emailList.cat2Desc', 3: 'emailList.cat3Desc', 4: 'emailList.cat4Desc' };

              return (
                <div key={`area-${cat}`} data-cat-area={cat} style={{ marginTop: 8 }}>
                  <div data-cat-desc={cat} style={{
                    padding: '8px 14px', marginBottom: 10,
                    background: `color-mix(in srgb, ${meta.color} 6%, var(--surface2))`,
                    borderRadius: 8,
                    fontSize: 11, color: 'var(--muted)', lineHeight: 1.5,
                  }}>
                    <span style={{ fontWeight: 600, color: meta.color }}>{CAT_LABEL_CLEAN[cat]?.[lang] || CAT_LABEL_CLEAN[cat]?.en}</span>
                    <span style={{ marginLeft: 8 }}>{tt2(catDescKeys[cat] as any, lang)}</span>
                  </div>
                  {/* Sub-group cards: Cat 1/2 use rules, Cat 3/4 use LLM flash model */}
                  {(() => {
                    const all = filterEmails(st.emails);
                    const groups: { label: string; emails: EmailItem[]; icon: string }[] = [];

                    // Icon map by groupKey (LLM output)
                    const KEY_ICONS: Record<string, string> = {
                      incident: '🚨', escalation: '📈', review: '👀', task: '✅', question: '💬',
                      security: '🔒', system: '🔔', report: '📊',
                      promo: '💰', digest: '📰',
                      other: '📁',
                    };

                    // ── LLM-based sub-grouping (all categories) ──
                    const llmGroups = (get('subGroups') as Record<number, Array<{ groupKey: string; label: string; emailIds: string[] }>>)?.[cat];
                    const isLoading = (get('subGroupLoading') as Record<number, boolean>)?.[cat];

                    // Trigger LLM on first expand
                    if (!llmGroups && !isLoading) {
                      const ids = all.map(e => e.id);
                      setTimeout(() => (get('loadSubGroups') as (cat: number, ids: string[]) => void)(cat, ids), 0);
                    }

                    if (llmGroups && llmGroups.length > 0) {
                      // Use LLM groups — display label via i18n keyed by groupKey
                      const emailMap = new Map(all.map(e => [e.id, e]));
                      // Map groupKey to i18n key suffix (digest→Newsletter for historical key name)
                      const i18nSuffix: Record<string, string> = { digest: 'Newsletter' };
                      for (const g of llmGroups) {
                        const matched = (g.emailIds || []).map((id: string) => emailMap.get(id)).filter(Boolean) as EmailItem[];
                        if (matched.length > 0) {
                          const gk = g.groupKey || 'other';
                          const suffix = i18nSuffix[gk] || gk.charAt(0).toUpperCase() + gk.slice(1);
                          const i18nKey = ('emailList.group' + suffix) as any;
                          groups.push({ label: tt2(i18nKey, lang), emails: matched, icon: KEY_ICONS[gk] || '📁' });
                        }
                      }
                    } else if (isLoading) {
                      // Show loading indicator while LLM runs
                      return (
                        <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}>
                          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
                          <span style={{ marginLeft: 8 }}>{tt2('emailList.groupingWithAI', lang)}</span>
                        </div>
                      );
                    }
                    // Fallback: if LLM returned nothing → show flat table
                    if (groups.length === 0) return <EmailTable emails={all} color={meta.color} get={get} lang={lang} />;
                    return (
                      <>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                          {groups.map((g, gi) => {
                            const isOpen = get('expandedGroup') === `${cat}-${gi}`;
                            return (
                              <div key={gi} data-topic-card data-cat={cat}
                                onClick={() => get('setExpandedGroup')(isOpen ? null : `${cat}-${gi}`)}
                                style={{
                                  padding: '10px 14px', cursor: 'pointer',
                                  background: isOpen ? `color-mix(in srgb, ${meta.color} 10%, var(--surface))` : `color-mix(in srgb, ${meta.color} 5%, var(--surface2))`,
                                  borderRadius: 10, border: `2px solid ${isOpen ? meta.color : 'var(--edge)'}`,
                                  minWidth: 110, textAlign: 'center', transition: 'all .15s',
                                  boxShadow: isOpen ? `0 2px 8px ${meta.color}33` : 'none',
                                }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: meta.color, marginBottom: 2 }}>{g.icon}</div>
                                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink)' }}>{g.label}</div>
                                <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>{g.emails.length} {lang === 'zh' ? '封' : lang === 'ja' ? '通' : 'emails'}</div>
                              </div>
                            );
                          })}
                        </div>
                        {groups.map((g, gi) => {
                          if (get('expandedGroup') !== `${cat}-${gi}`) return null;
                          return <EmailTable key={gi} emails={g.emails} color={meta.color} get={get} lang={lang} />;
                        })}
                      </>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Email Table with pagination ───
function EmailTable({ emails, color: _color, get, lang }: { emails: EmailItem[]; color: string; get: (k: string) => any; lang: string }) {
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;

  const sortKey = (get('emailSortKey') as string) || 'date';
  const sortDir = (get('emailSortDir') as string) || 'desc';
  const toggleSort = get('toggleEmailSort') as (key: string) => void;
  const sortArrow = get('emailSortArrow') as (key: string) => string;

  const sorted = [...emails].sort((a, b) => {
    const av = (a[sortKey] || '').toString().toLowerCase();
    const bv = (b[sortKey] || '').toString().toLowerCase();
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageEmails = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [sorted.length]);

  // Simple rule-based sub-groups
  const groups: { label: string; emails: EmailItem[] }[] = [];
  const personal: EmailItem[] = [];
  const notify: EmailItem[] = [];
  const other: EmailItem[] = [];
  for (const e of emails) {
    const from = (e.fromAddr || '').toLowerCase();
    if (/noreply|no-reply|donotreply|service@|notification@|alert@|billing@/i.test(from)) {
      notify.push(e);
    } else if (from.includes('@')) {
      personal.push(e);
    } else {
      other.push(e);
    }
  }
  const personalLabel = lang === 'zh' ? '📨 个人' : lang === 'ja' ? '📨 個人' : '📨 Personal';
  const notifyLabel = lang === 'zh' ? '📢 通知' : lang === 'ja' ? '📢 通知' : '📢 Notifications';
  const otherLabel = lang === 'zh' ? '📁 其他' : lang === 'ja' ? '📁 その他' : '📁 Other';
  if (personal.length > 0) groups.push({ label: `${personalLabel} (${personal.length})`, emails: personal });
  if (notify.length > 0) groups.push({ label: `${notifyLabel} (${notify.length})`, emails: notify });
  if (other.length > 0) groups.push({ label: `${otherLabel} (${other.length})`, emails: other });

  const selectedIds = get('selectedIds') as Set<string>;
  const allPageSelected = pageEmails.length > 0 && pageEmails.every((e: any) => selectedIds.has(e.id));

  if (emails.length === 0) return <div style={{ textAlign: 'center', padding: 12, color: 'var(--muted)', fontSize: 12 }}>—</div>;
  return (
    <div>
      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div style={{ padding: '6px 14px', marginBottom: 6, background: 'color-mix(in srgb, var(--amber) 8%, var(--surface2))', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--ink)', fontWeight: 600 }}>
            {tt2('emailDetail.selected', lang).replace('{n}', String(selectedIds.size))}
          </span>
          <button className="btn btn-brand btn-xs" onClick={() => get('batchDismiss')()} disabled={get('batchDismissing') as boolean}>
            {get('batchDismissing') ? tt2('emailDetail.batchDismissing', lang) : tt2('emailDetail.batchDismiss', lang)}
          </button>
          <button className="btn-ghost btn-xs" style={{ color: 'var(--muted)', fontSize: 10, opacity: get('batchDismissing') ? 0.4 : 1 }} disabled={!!get('batchDismissing')} onClick={() => get('setSelectedIds')(new Set())}>
            {tt2('emailDetail.clearSelection', lang)}
          </button>
        </div>
      )}
      <div style={{ width: '100%', margin: '0 auto', border: '1px solid var(--edge)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', background: 'var(--surface2)', borderBottom: '1px solid var(--edge)', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
        <span style={{ width: 28 }}>
          <input type="checkbox" style={{ margin: 0, cursor: 'pointer', accentColor: 'var(--brand)' }} checked={allPageSelected} disabled={!!get('batchDismissing')} onChange={() => get('selectAllInView')(pageEmails.map((e: any) => e.id))} />
        </span>
        <span style={{ width: '32%', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('from')}>
          {tt2('emailList.colFrom', lang)}{sortArrow('from')}
        </span>
        <span style={{ width: '18%', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('date')}>
          {tt2('emailList.colTime', lang)}{sortArrow('date')}
        </span>
        <span style={{ flex: 1, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('subject')}>
          {tt2('emailList.colSubject', lang)}{sortArrow('subject')}
        </span>
        <span style={{ width: 50 }} />
      </div>
      {/* Rows */}
      {pageEmails.map((email, i) => (
        <div key={email.id} data-email-item
          style={{
            display: 'flex', alignItems: 'center', padding: '9px 14px', cursor: 'pointer',
            background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)',
            borderBottom: i < pageEmails.length - 1 || totalPages > 1 ? '1px solid var(--edge)' : 'none',
            fontSize: 13, transition: 'background .1s',
          }}>
          <span style={{ width: 28 }} onClick={e => e.stopPropagation()}>
            <input type="checkbox" style={{ margin: 0, cursor: 'pointer', accentColor: 'var(--brand)' }} checked={selectedIds.has(email.id)} disabled={!!get('batchDismissing')} onChange={() => get('toggleSelect')(email.id)} />
          </span>
          <span onClick={() => get('selectEmail')(email)} title={email.fromAddr || ''} style={{ width: '32%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            {fromDisplay(email.fromAddr)}
          </span>
          <span onClick={() => get('selectEmail')(email)} style={{ width: '18%', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer' }}>
            {dateDisplay(email.date)}
          </span>
          <span onClick={() => get('selectEmail')(email)} title={email.subject || ''} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: 'var(--ink)', fontSize: 13, cursor: 'pointer' }}>
            {!email.isRead && <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 3, background: 'var(--amber)', marginRight: 6, verticalAlign: 'middle' }} />}
            {email.subject || '(no subject)'}
          </span>
          <span style={{ width: 50, textAlign: 'right', flexShrink: 0 }}>
            {email.isReplied && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>{lang === 'zh' ? '已回' : '✓'}</span>}
            {email.issueId && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: `color-mix(in srgb, var(--green) 15%, transparent)`, color: 'var(--green)', fontWeight: 600, marginLeft: 4 }}>TL</span>}
          </span>
        </div>
      ))}
      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: '1px solid var(--edge)', background: 'var(--surface2)' }}>
          <button className="btn-ghost btn-xs" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
            style={{ opacity: page === 0 ? 0.4 : 1, cursor: page === 0 ? 'default' : 'pointer' }}>
            ◀
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {page + 1} / {totalPages} ({emails.length} {lang === 'zh' ? '封' : 'total'})
          </span>
          <button className="btn-ghost btn-xs" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
            style={{ opacity: page >= totalPages - 1 ? 0.4 : 1, cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>
            ▶
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
