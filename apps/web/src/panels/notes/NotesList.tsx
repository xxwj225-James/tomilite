import { useState, useEffect, useRef } from 'react';
import { tt } from '@/i18n/translations';
import { t as tt2 } from '@/lib/i18n';
import { categoryLabel, sourceBadgeKey } from '@/lib/noteCategory';
import { formatDbDate } from '@/lib/dbTime';
import { EmptyState } from '@/components/EmptyState';
import { useLang } from '@/stores/useLang';
import { ImportNotesDialog } from './ImportNotesDialog';
import { noteMatchesSearch } from './useNotesState';

// ═══ Notes List View — search, sort, select, export ═══

interface Props {
  notes: any[];
  noteSearch: string;
  setNoteSearch: (v: string) => void;
  selectedIds: Set<string>;
  sortKey: string;
  sortDir: string;
  toggleSort: (k: any) => void;
  sortArrow: (k: string) => any;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  handleExport: (format: string) => void;
  fetchNotes: () => void;
  setLinkDialogOpen: (v: boolean) => void;
  /** Opens the batch-delete confirm. The dialog itself is mounted by `NotesPanel`. */
  setBatchDeleteOpen: (v: boolean) => void;
  setSelected: (n: any) => void;
  setTitle: (t: string) => void;
  setContent: (c: string) => void;
  setCategory: (c: string) => void;
  onEditingNote?: (n: any) => void;
}

export function NotesList(p: Props) {
  const lang = useLang();
  const t = (key: string, vars?: Record<string, string>) => tt(lang, key, vars);
  const [showExportDialog, setShowExportDialog] = useState(false);
  // Both entry points into the import dialog live in this component, so the open flag
  // does too — nothing outside the list needs to know it exists.
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  // Title and notebook only. `wiki.list` no longer carries `content` — see its comment
  // in the API router — so this filter cannot see note bodies any more. Searching the
  // body is the one thing that went away with the projection, and the alternative was
  // shipping every note's full text (base64 images included) to the renderer so that a
  // keystroke could look at it.
  //
  // Shared with `selectAll` rather than written twice: the header checkbox selects
  // everything this filter keeps, and two expressions answering "which notes does the
  // search keep" is how the checkbox and the list drift apart.
  const sorted = [...p.notes].filter((n: any) => noteMatchesSearch(n, p.noteSearch)).sort((a: any, b: any) => {
    const av = a[p.sortKey] || '',
      bv = b[p.sortKey] || '';
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return p.sortDir === 'asc' ? cmp : -cmp;
  });
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageNotes = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => {
    setPage(0);
  }, [sorted.length]);

  // Header checkbox. `indeterminate` is a property and not an attribute, so it cannot be
  // passed as a prop — it has to be assigned to the node. It reads the *current page*
  // while `selectAll` takes the whole filtered set: the box belongs to the table it sits
  // on, and a box that claims "all" while a later page is unselected would be lying.
  const allRef = useRef<HTMLInputElement>(null);
  const pageAllSelected = pageNotes.length > 0 && pageNotes.every((n: any) => p.selectedIds.has(n.id));
  const pageSomeSelected = pageNotes.some((n: any) => p.selectedIds.has(n.id));
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = pageSomeSelected && !pageAllSelected;
  }, [pageSomeSelected, pageAllSelected]);

  // A blank editor is "new note" here — the editor creates on save. Named
  // because the empty state needs the same reset as any other entry point.
  const handleNew = () => {
    p.setSelected({});
    p.setTitle('');
    p.setContent('');
    p.setCategory('general');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--edge)',
          display: 'flex',
          gap: 6,
          alignItems: 'center',
        }}
      >
        <button className="btn-ghost btn-xs" onClick={p.fetchNotes} title={t('btn.refreshList')}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
        </button>
        {/* Backfill entry point. `tt2` and not the local `t` above: that one reads the
            legacy dictionary, which would render this as the bare key string. */}
        <button
          className="btn-ghost btn-xs"
          onClick={() => p.setLinkDialogOpen(true)}
          title={tt2('notes.findLinks', lang)}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            {tt2('notes.findLinks', lang)}
          </span>
        </button>
        {/* Icon only, with the label in `title`: this toolbar does not wrap
            (`flexWrap` is set on the tasks list, not here), so a fourth labelled
            button squeezes the search field, which is the only thing that flexes. */}
        <button
          className="btn-ghost btn-xs"
          onClick={() => setImportOpen(true)}
          title={tt2('notes.import.button', lang)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3v12" />
            <polyline points="7 11 12 16 17 11" />
            <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
        </button>
        {/* Icon only, and only when there is something to delete. Same reasoning as the
            import button above: no `flexWrap` here, and a selection already brings the
            labelled export button in beside the search field. `tt2` again — the local `t`
            reads the legacy dictionary and would render the bare key.
            Not `btn.delete`: that string carries a 🗑 emoji that would sit next to this
            SVG as a second icon. */}
        {p.selectedIds.size > 0 && (
          <button
            className="btn-ghost btn-xs"
            onClick={() => p.setBatchDeleteOpen(true)}
            title={tt2('notes.deleteSelected', lang, { n: String(p.selectedIds.size) })}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </button>
        )}
        <input
          className="form-input"
          autoComplete="off"
          style={{ flex: 1, fontSize: 12 }}
          placeholder={t('notes.search')}
          value={p.noteSearch}
          onChange={(e) => p.setNoteSearch(e.target.value)}
        />
        {p.selectedIds.size > 0 && (
          <button
            className="btn btn-brand btn-xs"
            onClick={() => setShowExportDialog(true)}
            title={t('btn.exportSelected')}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t('btn.export')}
            </span>
            ({p.selectedIds.size})
          </button>
        )}
        {/* Export format dialog */}
        {showExportDialog && (
          <>
            <div
              className="menu-overlay"
              style={{ display: 'block', zIndex: 100 }}
              onClick={() => setShowExportDialog(false)}
            />
            <div
              style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%,-50%)',
                zIndex: 101,
                background: 'var(--surface)',
                borderRadius: 12,
                border: '1px solid var(--edge)',
                boxShadow: 'var(--shadow-lg)',
                padding: 24,
                minWidth: 280,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{tt2('export.title', lang)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                  onClick={() => {
                    setShowExportDialog(false);
                    p.handleExport('xlsx');
                  }}
                >
                  {tt2('export.excel', lang)}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                  onClick={() => {
                    setShowExportDialog(false);
                    p.handleExport('docx');
                  }}
                >
                  {tt2('export.word', lang)}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                  onClick={() => {
                    setShowExportDialog(false);
                    p.handleExport('html');
                  }}
                >
                  {tt2('export.html', lang)}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                  onClick={() => {
                    setShowExportDialog(false);
                    p.handleExport('md');
                  }}
                >
                  {tt2('export.markdown', lang)}
                </button>
              </div>
              <button
                className="btn-ghost btn-xs"
                style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)' }}
                onClick={() => setShowExportDialog(false)}
              >
                {tt2('export.cancel', lang)}
              </button>
            </div>
          </>
        )}
        <button
          className="btn btn-brand btn-xs"
          onClick={() => {
            p.setSelected({});
            p.setTitle('');
            p.setContent('');
            p.setCategory('general');
            p.onEditingNote?.({ title: '', content: '', category: 'general' });
          }}
        >
          {t('btn.new')}
        </button>
      </div>
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--edge)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          fontSize: 11,
          color: 'var(--muted)',
          fontWeight: 600,
        }}
      >
        <span style={{ width: 18, flexShrink: 0 }}>
          <input
            ref={allRef}
            type="checkbox"
            checked={pageAllSelected}
            onChange={() => (pageAllSelected ? p.clearSelection() : p.selectAll())}
            title={tt2('notes.selectAll', lang)}
            style={{ margin: 0, accentColor: 'var(--brand)', cursor: 'pointer', width: 18 }}
          />
        </span>
        <span
          style={{ flex: 1, cursor: 'pointer', userSelect: 'none' }}
          onClick={() => p.toggleSort('title')}
          title={t('notes.clickToSort')}
        >
          {t('notes.title')}
          {p.sortArrow('title')}
        </span>
        <span
          style={{ width: 100, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => p.toggleSort('category')}
          title={t('notes.clickToSort')}
        >
          {t('notes.category')}
          {p.sortArrow('category')}
        </span>
        <span
          style={{ width: 100, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => p.toggleSort('updatedAt')}
          title={t('notes.clickToSort')}
        >
          {t('notes.updated')}
          {p.sortArrow('updatedAt')}
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 80 }}>
        {pageNotes.map((n: any) => (
          <div
            key={n.id}
            className="list-row"
            style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
            onClick={() => {
              // Routed through `tl-select-note` rather than setting state here. The list
              // row carries no body any more — see the projection's comment in the API
              // router — and the listener for this event is already the one place that
              // fetches the full note before opening it (`useNotesState`). Giving the
              // click its own second fetch-and-open path is how the two drift: the
              // knowledge-map card crosses panels through the same event.
              window.dispatchEvent(new CustomEvent('tl-select-note', { detail: { id: n.id } }));
            }}
          >
            <input
              type="checkbox"
              checked={p.selectedIds.has(n.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => p.toggleSelect(n.id)}
              style={{ margin: 0, accentColor: 'var(--brand)', cursor: 'pointer', flexShrink: 0, width: 18 }}
            />
            <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {n.title || t('notes.untitled')}
              </span>
              {/* Where a note came from — imports only. This badge used to fire on any
                  non-empty `source`, which claimed a chat summary was imported; the harvest
                  adds three more sources that are the user's own work, and the category
                  column beside this already names where each came from. `sourceBadgeKey`
                  has the reasoning. */}
              {(() => {
                const badge = sourceBadgeKey(n.source);
                return badge ? (
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 9,
                      lineHeight: '14px',
                      padding: '0 5px',
                      borderRadius: 7,
                      border: '1px solid var(--edge)',
                      background: 'var(--surface2)',
                      color: 'var(--muted)',
                    }}
                  >
                    {tt2(badge, lang)}
                  </span>
                ) : null;
              })()}
            </span>
            <span style={{ width: 100, fontSize: 11, textAlign: 'center', color: 'var(--muted)', flexShrink: 0 }}>
              {/* Shared with the map card. The inline `category === 'chat' ? … : category`
                  this replaces printed the raw value for every other category — including
                  the three the harvest writes, which the map renders in the reader's own
                  language. Two screens, one column, one table. */}
              {categoryLabel(n.category, lang)}
            </span>
            <span style={{ width: 100, fontSize: 11, textAlign: 'right', color: 'var(--muted)', flexShrink: 0 }}>
              {formatDbDate(n.updatedAt)}
            </span>
          </div>
        ))}
        {/* Two different nothings. An empty library needs to say what a note is
            for; a search that matched nothing needs one line and no advice. The
            old code showed the library message for both. */}
        {p.notes.length === 0 ? (
          <EmptyState
            icon="📝"
            title={tt2('empty.notes.title', lang)}
            hint={tt2('empty.notes.hint', lang)}
            actionLabel={tt2('empty.notes.action', lang)}
            onAction={handleNew}
          >
            {/* Second entry into the import dialog, and the one that matters most: a
                library that is empty because it was never filled is exactly the state
                in which someone has notes elsewhere. */}
            <button
              className="btn-ghost btn-xs"
              style={{ marginTop: 'var(--space-2)', color: 'var(--brand)' }}
              onClick={() => setImportOpen(true)}
            >
              {tt2('empty.notes.import', lang)}
            </button>
          </EmptyState>
        ) : (
          sorted.length === 0 && (
            <div className="text-ink-muted text-sm" style={{ padding: 20, textAlign: 'center' }}>
              {tt2('empty.noResults', lang)}
            </div>
          )
        )}
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            borderTop: '1px solid var(--edge)',
            background: 'var(--surface2)',
            flexShrink: 0,
          }}
        >
          <button
            className="btn-ghost btn-xs"
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            style={{ opacity: page === 0 ? 0.4 : 1, cursor: page === 0 ? 'default' : 'pointer' }}
          >
            ◀
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {page + 1} / {totalPages} ({sorted.length} {lang === 'zh' ? '条' : 'total'})
          </span>
          <button
            className="btn-ghost btn-xs"
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            style={{
              opacity: page >= totalPages - 1 ? 0.4 : 1,
              cursor: page >= totalPages - 1 ? 'default' : 'pointer',
            }}
          >
            ▶
          </button>
        </div>
      )}

      <ImportNotesDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={p.fetchNotes}
      />
    </div>
  );
}
