import { useState, useEffect } from 'react';
import { tt } from '@/i18n/translations';
import { t as tt2 } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';

// ═══ Notes List View — search, sort, select, export ═══

interface Props {
  notes: any[]; noteSearch: string; setNoteSearch: (v: string) => void;
  selectedIds: Set<string>; sortKey: string; sortDir: string;
  toggleSort: (k: any) => void; sortArrow: (k: string) => any;
  toggleSelect: (id: string) => void; selectAll: () => void; clearSelection: () => void;
  handleExport: (format: string) => void; fetchNotes: () => void;
  setSelected: (n: any) => void; setTitle: (t: string) => void;
  setContent: (c: string) => void; setCategory: (c: string) => void;
  onEditingNote?: (n: any) => void;
}

export function NotesList(p: Props) {
  const lang = useLang();
  const t = (key: string, vars?: Record<string, string>) => tt(lang, key, vars);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const filter = (n: any) => !p.noteSearch || n.title?.toLowerCase().includes(p.noteSearch.toLowerCase()) || n.content?.toLowerCase().includes(p.noteSearch.toLowerCase());
  const sorted = [...p.notes].filter(filter).sort((a: any, b: any) => {
    const av = a[p.sortKey]||'', bv = b[p.sortKey]||'';
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return p.sortDir === 'asc' ? cmp : -cmp;
  });
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageNotes = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => { setPage(0); }, [sorted.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--edge)', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn-ghost btn-xs" onClick={p.fetchNotes} title={t('btn.refreshList')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button>
        <input className="form-input" autoComplete="off" style={{ flex: 1, fontSize: 12 }} placeholder={t('notes.search')} value={p.noteSearch} onChange={e => p.setNoteSearch(e.target.value)} />
        {p.selectedIds.size > 0 && (
          <button className="btn btn-brand btn-xs" onClick={() => setShowExportDialog(true)} title={t('btn.exportSelected')}><span style={{display:'inline-flex',alignItems:'center',gap:2}}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>{t('btn.export')}</span>({p.selectedIds.size})</button>
        )}
        {/* Export format dialog */}
        {showExportDialog && (
          <><div className="menu-overlay" style={{ display: 'block', zIndex: 100 }} onClick={() => setShowExportDialog(false)} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 101, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--edge)', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', padding: 24, minWidth: 280, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{tt2('export.title', lang)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" style={{ justifyContent: 'center' }} onClick={() => { setShowExportDialog(false); p.handleExport('xlsx'); }}>{tt2('export.excel', lang)}</button>
              <button className="btn btn-secondary btn-sm" style={{ justifyContent: 'center' }} onClick={() => { setShowExportDialog(false); p.handleExport('docx'); }}>{tt2('export.word', lang)}</button>
              <button className="btn btn-secondary btn-sm" style={{ justifyContent: 'center' }} onClick={() => { setShowExportDialog(false); p.handleExport('html'); }}>{tt2('export.html', lang)}</button>
              <button className="btn btn-secondary btn-sm" style={{ justifyContent: 'center' }} onClick={() => { setShowExportDialog(false); p.handleExport('md'); }}>{tt2('export.markdown', lang)}</button>
            </div>
            <button className="btn-ghost btn-xs" style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)' }} onClick={() => setShowExportDialog(false)}>{tt2('export.cancel', lang)}</button>
          </div></>
        )}
        <button className="btn btn-brand btn-xs" onClick={() => { p.setSelected({}); p.setTitle(''); p.setContent(''); p.setCategory('general'); p.onEditingNote?.({ title: '', content: '', category: 'general' }); }}>{t('btn.new')}</button>
      </div>
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--edge)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
        <span style={{ width: 18, flexShrink: 0 }} />
        <span style={{ flex: 1, cursor: 'pointer', userSelect: 'none' }} onClick={() => p.toggleSort('title')} title={t('notes.clickToSort')}>{t('notes.title')}{p.sortArrow('title')}</span>
        <span style={{ width: 100, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }} onClick={() => p.toggleSort('category')} title={t('notes.clickToSort')}>{t('notes.category')}{p.sortArrow('category')}</span>
        <span style={{ width: 100, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => p.toggleSort('updatedAt')} title={t('notes.clickToSort')}>{t('notes.updated')}{p.sortArrow('updatedAt')}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 80 }}>
        {pageNotes.map((n: any) => (
          <div key={n.id} className="list-row" style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
            onClick={() => { p.setSelected(n); p.setTitle(n.title); p.setContent(n.content||''); p.setCategory(n.category||'general'); p.onEditingNote?.({ id: n.id, title: n.title, content: n.content||'', category: n.category||'general' }); }}>
            <input type="checkbox" checked={p.selectedIds.has(n.id)} onClick={e => e.stopPropagation()} onChange={() => p.toggleSelect(n.id)}
              style={{ margin: 0, accentColor: 'var(--brand)', cursor: 'pointer', flexShrink: 0, width: 18 }} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title || t('notes.untitled')}</span>
            <span style={{ width: 100, fontSize: 11, textAlign: 'center', color: 'var(--muted)', flexShrink: 0 }}>{n.category || 'general'}</span>
            <span style={{ width: 100, fontSize: 11, textAlign: 'right', color: 'var(--muted)', flexShrink: 0 }}>{n.updatedAt?.substring(0, 10)}</span>
          </div>
        ))}
        {p.notes.length === 0 && <div className="text-ink-muted text-sm" style={{ padding: 20, textAlign: 'center' }}>{t('notes.noNotes')}</div>}
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '6px 14px', borderTop: '1px solid var(--edge)', background: 'var(--surface2)', flexShrink: 0 }}>
          <button className="btn-ghost btn-xs" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
            style={{ opacity: page === 0 ? 0.4 : 1, cursor: page === 0 ? 'default' : 'pointer' }}>◀</button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{page + 1} / {totalPages} ({sorted.length} {lang === 'zh' ? '条' : 'total'})</span>
          <button className="btn-ghost btn-xs" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
            style={{ opacity: page >= totalPages - 1 ? 0.4 : 1, cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>▶</button>
        </div>
      )}
    </div>
  );
}
