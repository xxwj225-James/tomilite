import { useState, useEffect } from 'react';
import { useLang } from '@/stores/useLang';

// ═══ Reports List View — toolbar + list with pagination ═══

export function ReportsList(p: Record<string, unknown>) {
  const lang = useLang();
  const t = (zh: string, ja: string, en: string) => lang === 'zh' ? zh : lang === 'ja' ? ja : en;
  const reports = p.reports as Array<Record<string, unknown>>;
  const reportSearch = p.reportSearch as string;
  const content = p.content as string;
  const selected = p.selected as Record<string, unknown> | null;

  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const filtered = reports.filter((r: Record<string, unknown>) => !reportSearch || (r.title as string)?.toLowerCase().includes(reportSearch.toLowerCase()));
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageReports = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => { setPage(0); }, [filtered.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--edge)', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn-ghost btn-xs" onClick={p.fetchReports as () => void} title={t('刷新','更新','Refresh')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button>
        <input className="form-input" autoComplete="off" style={{ flex: 1, fontSize: 12 }} placeholder={t('🔍 搜索报告...','🔍 レポートを検索...','🔍 Search reports...')} value={reportSearch} onChange={e => (p.setReportSearch as (v: string) => void)(e.target.value)} />
        <button className="btn btn-brand btn-xs" onClick={() => { (p.setSelected as (v: Record<string, unknown>) => void)({}); (p.setTitle as (v: string) => void)(''); (p.setContent as (v: string) => void)(''); (p.setReportType as (v: string) => void)('daily'); (p.setCurrentReportId as (v: null) => void)(null); }}>{t('+ 新建','+ 新規作成','+ Create')}</button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', padding: '6px 12px', borderBottom: '1px solid var(--edge)' }}>
        💡 {t('已发送的报告保留 30 天后自动清除，草稿不受影响。','送信済みレポートは30日後に自動削除されます。下書きは保持されます。','Sent reports kept for 30 days. Drafts are permanent.')}
      </div>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 80 }}>
        {pageReports.map((r: Record<string, unknown>) => (
          <div key={r.id as string} className="list-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: r.status === 'sent' ? 'var(--green)' : 'var(--amber)', width: 52, whiteSpace: 'nowrap' }}>{r.status === 'sent' ? (t('📤 已发送','📤 送信済み','📤 Sent')) : (t('📝 草稿','📝 下書き','📝 Draft'))}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title as string}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)' }}>{(r.generatedAt as string || r.createdAt as string)?.substring(0, 10)} · {r.reportType as string}</div>
            </div>
            <button className="btn btn-xs" style={{ background: 'var(--surface2)', fontSize: 10 }} onClick={() => {
              if (content && content !== r.content && selected) { (p.setUnsavedTarget as (v: Record<string, unknown>) => void)(r); return; }
              (p.setSelected as (v: Record<string, unknown>) => void)(r); (p.setTitle as (v: string) => void)(r.title as string); (p.setContent as (v: string) => void)((r.content as string) || ''); (p.setReportType as (v: string) => void)((r.reportType as string) || 'daily');
              (p.setCurrentReportId as (v: string | null) => void)(r.status === 'draft' ? r.id as string : null);
            }}>{t('查看','表示','View')}</button>
          </div>
        ))}
        {reports.length === 0 && <div className="text-ink-muted text-sm" style={{ padding: 20, textAlign: 'center' }}>{t('暂无报告','レポートがありません','No reports yet.')}</div>}
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '6px 14px', borderTop: '1px solid var(--edge)', background: 'var(--surface2)', flexShrink: 0 }}>
          <button className="btn-ghost btn-xs" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
            style={{ opacity: page === 0 ? 0.4 : 1, cursor: page === 0 ? 'default' : 'pointer' }}>◀</button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{page + 1} / {totalPages} ({filtered.length} {lang === 'zh' ? '条' : 'total'})</span>
          <button className="btn-ghost btn-xs" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
            style={{ opacity: page >= totalPages - 1 ? 0.4 : 1, cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>▶</button>
        </div>
      )}
    </div>
  );
}
