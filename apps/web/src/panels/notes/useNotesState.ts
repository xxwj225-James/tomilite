import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { t, tr } from '@/lib/i18n';
import { nowDbUtc } from '@/lib/dbTime';
import { useLang } from '@/stores/useLang';

// ═══ Notes State Hook — all state + business logic for NotesPanel ═══

/**
 * Which notes a search term keeps — the one answer to that question.
 *
 * It lives here, exported, because two callers need it and they must not drift:
 * `NotesList` decides what to *draw*, and `selectAll` decides what "select all" means
 * over that same drawing. They were two separate expressions until the select-all
 * checkbox existed, and the second one was wrong: it filtered on `content`, which
 * `wiki.list` stopped carrying when the list projection was trimmed (see the comment in
 * `NotesList`), so a search matching a note's **category** would have shown the note and
 * silently left it out of "select all".
 *
 * Title and category are what the list renders and what it can therefore filter on.
 * Matching the body is the one thing that went away with the projection.
 */
export function noteMatchesSearch(note: any, search: string): boolean {
  if (!search) return true;
  const s = search.toLowerCase();
  return !!note?.title?.toLowerCase().includes(s) || !!note?.category?.toLowerCase().includes(s);
}

export function useNotesState(
  onEditingNote?: (n: any) => void,
  onNoteAction?: (a: string) => void,
  noteRefresh?: number,
  appliedEdit?: any,
  active?: boolean,
) {
  const lang = useLang();
  // ─── Core state ───
  const [notes, setNotes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ─── UI state ───
  const [noteSearch, setNoteSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [overwriteMsg, setOverwriteMsg] = useState<string | null>(null);
  const [deletedNotify, setDeletedNotify] = useState<string | null>(null);
  /** Batch delete. The dialog is mounted by `NotesPanel`; the list only opens it. */
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const overwriteResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const resolveOverwrite = (ok: boolean) => {
    overwriteResolveRef.current?.(ok);
    overwriteResolveRef.current = null;
    setOverwriteMsg(null);
  };
  const [pendingBack, setPendingBack] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Backfill dialog. Opened from the list toolbar; mounted by NotesPanel. */
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [sortKey, setSortKey] = useState<'title' | 'category' | 'updatedAt'>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // ─── Dirty tracking ───
  const [noteReady, setNoteReady] = useState(false);
  const noteEditedRef = useRef(false);

  // ─── Derived ───
  const editing = !!(selected || (!selected && title));
  // The note the editor is holding, if any. A backfill is a blind write into a note's
  // tail, while the editor holds a load-time snapshot of the whole body that `handleSave`
  // writes back wholesale — so writing under an open editor loses the link section on the
  // next save. The button only exists in the list view, but `tl-select-note` (a chat card
  // or a knowledge-map card) can populate `selected` while the dialog is open.
  const linkDialogExcludeIds = editing && selected?.id ? [selected.id] : [];

  // ─── Fetch ───
  const fetchNotes = async () => {
    try {
      const data = await api.wiki.list('proj-default');
      setNotes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('fetchNotes error:', e);
    }
  };
  useEffect(() => {
    fetchNotes();
  }, []);
  useEffect(() => {
    if (noteRefresh && noteRefresh > 0) fetchNotes();
  }, [noteRefresh]);
  useEffect(() => {
    if (active) fetchNotes();
  }, [active]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as any).detail;
      fetchNotes();
      // Fetch full note from DB — chat card data may be incomplete
      const apply = (full: any) => {
        const f = full || d;
        setSelected({ id: f.id || d.id, title: f.title || d.title, content: f.content || d.content || '' });
        setTitle(f.title || d.title);
        setContent(f.content || d.content || '');
        onEditingNote?.({
          id: f.id || d.id,
          title: f.title || d.title,
          content: f.content || d.content || '',
          category: f.category || d.category || 'general',
        });
      };
      if (d.id) {
        api.wiki
          .byId(d.id)
          .then((full) => {
            if (full) apply(full);
            else
              setDeletedNotify(
                tr(
                  lang,
                  '该笔记已被删除。',
                  'このノートは削除されました。',
                  'บันทึกนี้ถูกลบแล้ว',
                  'Kua Mukua tēnei Tuhipoka',
                  'Эта заметка удалена.',
                  'This note has been deleted.',
                ),
              );
          })
          .catch(() => apply(null));
      } else {
        apply(null);
      }
    };
    const onCloseEditor = () => {
      setSelected(null);
      onEditingNote?.(null);
    };
    window.addEventListener('tl-select-note', h);
    window.addEventListener('tl-close-note-editor', onCloseEditor);
    // Consume pending note selection from chat card (avoids race with panel mount)
    const consumePending = () => {
      const pending = (window as any).__tl_pendingNoteSelect;
      if (pending) {
        (window as any).__tl_pendingNoteSelect = null;
        h({ detail: pending } as any);
      }
    };
    consumePending();
    return () => {
      window.removeEventListener('tl-select-note', h);
      window.removeEventListener('tl-close-note-editor', onCloseEditor);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listeners registered once; lang/onEditingNote recreated per render
  }, []);
  // Clear App.tsx editingNote when editor closes (returns to note list)
  const skipFetchRef = useRef(false);
  const prevSelectedRef = useRef<any>(null);
  useEffect(() => {
    const wasEditing = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (wasEditing && !selected && !skipFetchRef.current) fetchNotes();
    skipFetchRef.current = false;
    if (!selected) (onEditingNote as any)?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchNotes/onEditingNote recreated per render; [selected] is the real trigger
  }, [selected]);
  // Re-check pending selection when panel becomes active (panel stays mounted via lazy-mount)
  useEffect(() => {
    if (!active) return;
    const pending = (window as any).__tl_pendingNoteSelect;
    if (pending) {
      (window as any).__tl_pendingNoteSelect = null;
      window.dispatchEvent(new CustomEvent('tl-select-note', { detail: pending }));
    }
  }, [active]);
  useEffect(() => {
    if (noteRefresh && noteRefresh > 0) {
      fetchNotes();
      if (selected?.id) {
        api.wiki
          .byId(selected.id)
          .then((u: any) => {
            if (u) {
              setTitle(u.title || '');
              setContent(u.content || '');
              setCategory(u.category || 'general');
            }
          })
          .catch(() => {});
      }
    }
    // The directive has to sit on the dependency array, which is where the rule
    // reports. It used to sit on the `useEffect(` line, so it suppressed nothing
    // and was itself reported as unused.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchNotes is recreated per render; [noteRefresh] is the real trigger.
  }, [noteRefresh]);
  useEffect(() => {
    if (appliedEdit) {
      if (appliedEdit.title) setTitle(appliedEdit.title);
      if (appliedEdit.content !== undefined) setContent(appliedEdit.content);
      if (appliedEdit.category) setCategory(appliedEdit.category);
    }
  }, [appliedEdit]);

  // Re-sync editingNote when panel becomes active — it was cleared on panel exit
  useEffect(() => {
    if (active && selected?.id) onEditingNote?.({ id: selected.id, title, content, category });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- [active] only; throttled sync effect below covers field changes
  }, [active]);
  // Keep App.tsx editingNote in sync (throttled — fire at most every 800ms to avoid per-keystroke re-renders)
  const noteSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selected) return;
    if (noteSyncTimerRef.current) clearTimeout(noteSyncTimerRef.current);
    noteSyncTimerRef.current = setTimeout(() => {
      onEditingNote?.({ id: selected.id, title, content, category });
    }, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onEditingNote recreated per render; debounce keyed on [title, content]
  }, [title, content]);

  // ─── Dirty tracking ───
  useEffect(() => {
    noteEditedRef.current = false;
    setNoteReady(false);
    const t = setTimeout(() => setNoteReady(true), 1000);
    return () => clearTimeout(t);
  }, [selected?.id]);
  const onNoteContent = (val: string) => {
    setContent(val);
    if (noteReady) noteEditedRef.current = true;
  };
  const onNoteTitle = (e: any) => {
    setTitle(e.target.value);
    if (noteReady) noteEditedRef.current = true;
  };
  const onNoteCategory = (e: any) => {
    setCategory(e.target.value);
    if (noteReady) noteEditedRef.current = true;
  };
  useEffect(() => {
    const dirty = editing && noteReady && noteEditedRef.current;
    (window as any).__tl_unsaved = dirty ? 'notes' : null;
    return () => {
      if ((window as any).__tl_unsaved === 'notes') (window as any).__tl_unsaved = null;
    };
  }, [editing, title, content, category, noteReady, selected?.id]);

  // ─── Sort ───
  const toggleSort = (key: 'title' | 'category' | 'updatedAt') => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };
  const sortArrow = (key: string) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  // ─── Selection ───
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const selectAll = () => {
    const f = notes.filter((n: any) => noteMatchesSearch(n, noteSearch));
    setSelectedIds(new Set(f.map((n: any) => n.id)));
  };
  const clearSelection = () => setSelectedIds(new Set());

  // ─── CRUD ───
  const handleSave = async () => {
    if (!content.trim() && !title.trim()) return;
    setSaving(true);
    try {
      const data = { title: title.trim() || (lang === 'zh' ? '无标题笔记' : 'Untitled Note'), content, category };
      if (selected?.id) {
        await api.wiki.update({ id: selected.id, ...data });
        setSelected({ ...selected, ...data });
        setNotes((prev) => prev.map((n) => (n.id === selected.id ? { ...n, ...data } : n)));
      } else {
        const created = await api.wiki.create({ projectId: 'proj-default', ...data });
        setSelected({ id: (created as any).id, title: data.title, content, category });
        setNotes((prev) => [{ ...data, id: (created as any).id, updatedAt: nowDbUtc() }, ...prev]);
      }
      noteEditedRef.current = false;
      onNoteAction?.(lang === 'zh' ? `保存了笔记《${data.title}》` : `Saved note "${data.title}"`);
    } catch {
      setSaveError(
        lang === 'zh' ? '保存失败，请检查 API 服务器是否运行。' : 'Save failed. Check if the API server is running.',
      );
    }
    setSaving(false);
  };
  const handleDelete = (id: string) => setDeleteTarget(id);
  const executeDelete = async () => {
    if (!deleteTarget) return;
    const deletedTitle = title;
    setDeleting(true);
    setDeleteTarget(null);
    if (selected?.id === deleteTarget) skipFetchRef.current = true;
    try {
      await api.wiki.delete(deleteTarget);
      setNotes((prev) => prev.filter((n: any) => n.id !== deleteTarget));
      if (selected?.id === deleteTarget) {
        setSelected(null);
        setTitle('');
        setContent('');
        onEditingNote?.(null);
      }
      onNoteAction?.(
        lang === 'zh' ? `删除了笔记《${deletedTitle || '未命名'}》` : `Deleted note "${deletedTitle || 'Untitled'}"`,
      );
    } catch {
      alert(lang === 'zh' ? '❌ 删除失败。' : '❌ Delete failed.');
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  /**
   * Delete every selected note, one call each.
   *
   * A loop and not a batch endpoint, because `wiki.delete` is already a bare
   * `knowledgePage.delete` with nothing to cascade: the `global_fts` and `embed_queue`
   * rows are removed by SQLite triggers on delete (`lib/ftsIndex.ts`), and the knowledge
   * map has no edge table — its links are derived from `[[Title]]` in note bodies at read
   * time. So there is no per-note application cost to amortise and no API surface worth
   * adding.
   *
   * **Failures are counted, not swallowed.** The tasks panel's (now removed) version did
   * `.catch(() => {})` and then reported success, which on a partial failure is a lie
   * about someone's data. What actually went is tracked by its own set rather than
   * inferred from the failure count, so the local list removal below matches the server.
   */
  const executeBatchDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBatchDeleting(true);
    setBatchProgress({ done: 0, total: ids.length });
    const gone = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      try {
        await api.wiki.delete(ids[i]);
        gone.add(ids[i]);
      } catch {
        // Counted below. One unreachable note must not abandon the other twenty-nine.
      }
      setBatchProgress({ done: i + 1, total: ids.length });
    }
    const failed = ids.length - gone.size;
    setNotes((prev) => prev.filter((n: any) => !gone.has(n.id)));
    // Deleting the note the editor is holding: same two moves as the single-note path
    // above, for the same reasons — clear what is no longer there, and suppress the
    // refetch that the editor-closing effect would otherwise trigger, since the local
    // list is already correct.
    if (selected?.id && gone.has(selected.id)) {
      skipFetchRef.current = true;
      setSelected(null);
      setTitle('');
      setContent('');
      onEditingNote?.(null);
    }
    clearSelection();
    setBatchDeleting(false);
    setBatchDeleteOpen(false);
    // A failure notice is the more important message when both happened.
    if (failed) setDeletedNotify(t('notes.batchDeleteFailed', lang, { n: String(failed) }));
    else onNoteAction?.(t('notes.batchDeleted', lang, { n: String(ids.length) }));
  };

  // ─── Export ───
  const mergeNoteContent = (ns: any[]) =>
    ns
      .map(
        (n) =>
          `# ${n.title || 'Untitled'}\n\n> Category: ${n.category || 'general'} | Updated: ${n.updatedAt || ''}\n\n${n.content || ''}\n`,
      )
      .join('\n\n---\n\n');

  const handleExport = async (format: string) => {
    const toExport = notes.filter((n: any) => selectedIds.has(n.id));
    if (!toExport.length) return;
    const ea = (window as any).electronAPI;
    const mergedMd = mergeNoteContent(toExport);

    if (format === 'md') {
      if (toExport.length === 1) {
        const fname = `${(toExport[0].title || 'untitled').replace(/[<>:"/\\|?*]/g, '_')}.md`;
        const fp = await ea.pickSaveFile(fname, [{ name: 'Markdown', extensions: ['md'] }]);
        if (!fp) return;
        ea.saveFile(fp, mergedMd);
        setExportMsg(`✅ ${fp}`);
      } else {
        const dp = await ea.pickDirectory();
        if (!dp) return;
        for (const n of toExport) {
          const fname = `${(n.title || 'untitled').replace(/[<>:"/\\|?*]/g, '_')}.md`;
          ea.saveFile(dp + '\\' + fname, mergeNoteContent([n]));
        }
        setExportMsg(`✅ Exported ${toExport.length} notes.`);
      }
      clearSelection();
      return;
    }

    // For Excel/Word/HTML: export each note as a separate file
    const extMap: Record<string, string> = { xlsx: 'Excel', docx: 'Word', html: 'HTML' };
    try {
      if (toExport.length === 1) {
        // Single note: pick save file
        const resp = await fetch(
          `/api/wiki.exportNote?input=${encodeURIComponent(JSON.stringify({ noteId: toExport[0].id, format }))}`,
        );
        const d = await resp.json();
        if (!d.result?.data?.ok) return;
        const { filePath, filename } = d.result.data;
        const savePath = await ea.pickSaveFile(filename, [{ name: extMap[format], extensions: [format] }]);
        if (!savePath) return;
        await ea.copyFile(savePath, filePath);
        setExportMsg(`✅ ${savePath}`);
      } else {
        // Multiple notes: pick directory, save each as separate file
        const dp = await ea.pickDirectory();
        if (!dp) return;
        let count = 0;
        for (const n of toExport) {
          const resp = await fetch(
            `/api/wiki.exportNote?input=${encodeURIComponent(JSON.stringify({ noteId: n.id, format }))}`,
          );
          const d = await resp.json();
          if (!d.result?.data?.ok) continue;
          const { filePath } = d.result.data;
          const fname = `${(n.title || 'untitled').replace(/[<>:"/\\|?*]/g, '_')}.${format}`;
          await ea.copyFile(dp + '\\' + fname, filePath);
          count++;
        }
        setExportMsg(`✅ Exported ${count} notes.`);
      }
      clearSelection();
    } catch (e) {
      console.error('[Export] failed:', e);
    }
  };

  // ─── Link backfill ───
  // Re-reads rather than patching rows locally: the server wrote `[[Title]]` into note
  // bodies, and the list's `updatedAt` and the FTS queue both moved as a result.
  const onLinksApplied = (written: number) => {
    fetchNotes();
    onNoteAction?.(
      lang === 'zh' ? `为 ${written} 篇笔记补上了链接` : `Added links to ${written} note${written === 1 ? '' : 's'}`,
    );
  };

  return {
    notes,
    selected,
    setSelected,
    title,
    setTitle,
    content,
    setContent,
    category,
    setCategory,
    saving,
    noteSearch,
    setNoteSearch,
    selectedIds,
    deleteTarget,
    setDeleteTarget,
    exportMsg,
    setExportMsg,
    overwriteMsg,
    resolveOverwrite,
    pendingBack,
    setPendingBack,
    saveError,
    setSaveError,
    deletedNotify,
    setDeletedNotify,
    sortKey,
    sortDir,
    noteReady,
    noteEditedRef,
    editing,
    linkDialogOpen,
    setLinkDialogOpen,
    linkDialogExcludeIds,
    onLinksApplied,
    fetchNotes,
    onNoteContent,
    onNoteTitle,
    onNoteCategory,
    toggleSort,
    sortArrow,
    toggleSelect,
    selectAll,
    clearSelection,
    handleSave,
    handleDelete,
    executeDelete,
    deleting,
    batchDeleteOpen,
    setBatchDeleteOpen,
    batchDeleting,
    batchProgress,
    executeBatchDelete,
    handleExport,
    onEditingNote,
    onNoteAction,
  };
}
