import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { tr } from '@/lib/i18n';
import { nowDbUtc } from '@/lib/dbTime';
import { useLang } from '@/stores/useLang';

// ═══ Task State Hook — all state + handlers for TasksPanel ═══

export function useTaskState(
  onEditingTask?: (t: any) => void,
  appliedTaskEdit?: Record<string, unknown> | null,
  taskRefresh?: number,
  active?: boolean,
) {
  const lang = useLang();
  // ─── Core state ───
  const [issues, setIssues] = useState<any[]>([]);
  // Tab badges come from the server, counted over every task — `issues` above is a
  // capped page, so counting it made the badges shrink once the table outgrew the
  // cap while the Home card kept counting everything.
  const [taskCounts, setTaskCounts] = useState<{
    total: number;
    todo: number;
    inProgress: number;
    done: number;
  } | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editType, setEditType] = useState('task');
  const [editSP, setEditSP] = useState<number>(0);
  const [editDueDate, setEditDueDate] = useState('');

  // ─── Filter/sort state (persisted to DB) ───
  const [taskSearch, setTaskSearch] = useState('');
  const [sortKey, setSortKey] = useState<
    'issueNumber' | 'title' | 'type' | 'priority' | 'storyPoints' | 'createdAt' | 'dueDate' | 'updatedAt'
  >('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Load persisted sort/filter preferences
  useEffect(() => {
    fetch('/api/system.getConfig?input=' + encodeURIComponent(JSON.stringify({ key: 'taskSort' })))
      .then((r) => r.json())
      .then((d) => {
        if (d.result?.data)
          try {
            const v = JSON.parse(d.result.data);
            setSortKey(v.key || 'createdAt');
            setSortDir(v.dir || 'desc');
          } catch {}
      })
      .catch(() => {});
    fetch('/api/system.getConfig?input=' + encodeURIComponent(JSON.stringify({ key: 'taskFilter' })))
      .then((r) => r.json())
      .then((d) => {
        if (d.result?.data)
          try {
            const v = JSON.parse(d.result.data);
            setTypeFilter(v.type || '');
            setPriorityFilter(v.priority || '');
          } catch {}
      })
      .catch(() => {});
  }, []);

  // Save sort preference on change
  useEffect(() => {
    fetch('/api/system.setConfig', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'taskSort', value: JSON.stringify({ key: sortKey, dir: sortDir }) }),
    }).catch(() => {});
  }, [sortKey, sortDir]);

  // Save filter preference on change
  useEffect(() => {
    fetch('/api/system.setConfig', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'taskFilter',
        value: JSON.stringify({ type: typeFilter, priority: priorityFilter }),
      }),
    }).catch(() => {});
  }, [typeFilter, priorityFilter]);

  // ─── Kanban state ───
  const DEFAULT_COLLAPSED = ['task', 'bug', 'story'];
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(() => {
    try {
      const s = localStorage.getItem('tl-kanban-collapsed');
      if (s) return new Set(JSON.parse(s));
    } catch {}
    return new Set(DEFAULT_COLLAPSED);
  });
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // ─── UI state ───
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [pendingBack, setPendingBack] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletedNotify, setDeletedNotify] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // const showDragHint = false;

  // ─── Dirty tracking ───
  const [taskReady, setTaskReady] = useState(false);
  const taskEditedRef = useRef(false);

  // ─── Column visibility ───
  const ALL_COLUMNS = [
    { field: 'issueNumber', label: '#', width: 40, defaultVisible: true, sortable: true },
    {
      field: 'title',
      label: tr(lang, '标题', 'Title', 'Title', 'Title', 'Title', 'Title'),
      width: 0,
      defaultVisible: true,
      sortable: true,
    },
    {
      field: 'type',
      label: tr(lang, '类型', 'Type', 'Type', 'Type', 'Type', 'Type'),
      width: 70,
      defaultVisible: true,
      sortable: true,
    },
    {
      field: 'priority',
      label: tr(lang, '优先级', 'Priority', 'Priority', 'Priority', 'Priority', 'Priority'),
      width: 70,
      defaultVisible: true,
      sortable: true,
    },
    {
      field: 'status',
      label: tr(lang, '状态', 'Status', 'Status', 'Status', 'Status', 'Status'),
      width: 80,
      defaultVisible: true,
      sortable: true,
    },
    { field: 'storyPoints', label: 'SP', width: 36, defaultVisible: false, sortable: true },
    {
      field: 'createdAt',
      label: tr(lang, '创建时间', 'Created', 'Created', 'Created', 'Created', 'Created'),
      width: 80,
      defaultVisible: false,
      sortable: true,
    },
  ];
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    () => new Set(ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.field)),
  );

  // ─── i18n helper ───
  const t = (key: string) => key;

  // ─── Data fetching ───
  /**
   * Rows and tab badges together.
   *
   * Every mutation in this hook calls this one function, which is why the two
   * requests live inside it rather than beside it: a badge fetched on its own
   * schedule would trail the list it labels.
   *
   * It returns a promise that settles when both have, because callers await it —
   * the refresh button spins for its duration. Returning nothing would leave that
   * spinner flashing for zero frames.
   */
  const refreshTasks = (): Promise<void> =>
    Promise.all([
      api.issue
        .list('proj-default')
        .then((data) => {
          setIssues(Array.isArray(data) ? data : []);
        })
        .catch((err) => console.error('refreshTasks error', err)),
      api.issue
        .taskCounts('proj-default')
        .then((d: any) => setTaskCounts(d || null))
        .catch((err: any) => console.error('fetchTaskCounts error', err)),
    ]).then(() => undefined);
  useEffect(() => {
    refreshTasks();
  }, []);
  useEffect(() => {
    if (taskRefresh && taskRefresh > 0) {
      refreshTasks();
    }
  }, [taskRefresh]);
  useEffect(() => {
    if (active) refreshTasks();
  }, [active]);

  // Re-sync editingTask when panel becomes active — it was cleared on panel exit
  useEffect(() => {
    if (active && selected)
      onEditingTask?.({
        issueNumber: selected.issueNumber,
        id: selected.id,
        title: selected.title,
        description: selected.description || '',
        status: selected.status || 'todo',
        priority: selected.priority || 'medium',
        source: (selected as { source?: string | null }).source ?? null,
        sourceId: (selected as { sourceId?: string | null }).sourceId ?? null,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- [active] only; sync effect at line 157 covers field changes
  }, [active]);

  // ─── Event listeners ───
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as any).detail;
      const num = d.key ? parseInt(d.key.replace('TL-', '')) : 0;
      // Guard on the id, not the display key. The key is a formatting detail of the
      // payload, while the id is the thing being selected — a caller that knows only an
      // id (a global-search hit, or the meeting panel's `__tl_pendingTaskSelect`) is
      // still a legitimate selection, and requiring it to invent a "TL-…" string would
      // make the event silently no-op. Everything downstream already prefers the fetched
      // row's own `issueNumber` over `num`.
      if (!d.id) {
        refreshTasks();
        return;
      }
      refreshTasks();
      // Fetch full issue from DB — chat card data may be incomplete (e.g. missing description)
      const apply = (full: any) => {
        const f = full || d;
        setSelected({
          id: f.id || d.id,
          issueNumber: f.issueNumber || num,
          title: f.title || d.title,
          status: f.status || d.status || 'todo',
          priority: f.priority || d.priority || 'medium',
          type: f.type || 'task',
          description: f.description || d.description || '',
          storyPoints: f.storyPoints ?? d.storyPoints ?? 0,
        });
        setEditTitle(f.title || d.title);
        setEditDesc(f.description || d.description || '');
        setEditStatus(f.status || d.status || 'todo');
        setEditPriority(f.priority || d.priority || 'medium');
        setEditType(f.type || 'task');
        setEditSP(f.storyPoints ?? d.storyPoints ?? 0);
        setEditDueDate(f.dueDate || d.dueDate || '');
        const editFlag = !!d.editMode;
        setEditing(editFlag); // explicitly enter/exit edit mode based on intent
        onEditingTask?.({
          issueNumber: f.issueNumber || num,
          id: f.id || d.id,
          title: f.title || d.title,
          description: f.description || d.description || '',
          status: f.status || d.status || 'todo',
          priority: f.priority || d.priority || 'medium',
          editing: editFlag,
          // Fetched row first, event payload second. A deep link from global search only
          // knows an id, and a mirrored row rendered from the payload alone would look like
          // an ordinary local task — losing the "unlink from source" affordance, which is
          // the only way back out of the read-only rule.
          source: (f as { source?: string | null }).source ?? (d as { source?: string | null }).source ?? null,
          sourceId: (f as { sourceId?: string | null }).sourceId ?? (d as { sourceId?: string | null }).sourceId ?? null,
        });
      };
      if (d.id) {
        api.issue
          .byId(d.id)
          .then((full) => {
            if (full) apply(full);
            else
              setDeletedNotify(
                tr(
                  lang,
                  '该任务已被删除。',
                  'このタスクは削除されました。',
                  'งานนี้ถูกลบแล้ว',
                  'Kua Mukua tēnei Mahi',
                  'Эта задача удалена.',
                  'This task has been deleted.',
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
      setEditing(false);
    };
    window.addEventListener('tl-select-task', h);
    window.addEventListener('tl-close-task-editor', onCloseEditor);
    // Consume pending task selection from chat card (avoids race with panel mount)
    const consumePending = () => {
      const pending = (window as any).__tl_pendingTaskSelect;
      if (pending) {
        (window as any).__tl_pendingTaskSelect = null;
        h({ detail: pending } as any);
      }
    };
    consumePending();
    return () => {
      window.removeEventListener('tl-select-task', h);
      window.removeEventListener('tl-close-task-editor', onCloseEditor);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listeners registered once; lang/refreshTasks/onEditingTask recreated per render
  }, []);
  // Re-check pending selection when panel becomes active (panel stays mounted via lazy-mount)
  useEffect(() => {
    if (!active) return;
    const pending = (window as any).__tl_pendingTaskSelect;
    if (pending) {
      (window as any).__tl_pendingTaskSelect = null;
      window.dispatchEvent(new CustomEvent('tl-select-task', { detail: pending }));
    }
  }, [active]);

  // ─── Agent edits ───
  useEffect(() => {
    if (appliedTaskEdit) {
      const a = appliedTaskEdit as any;
      if (a.title) {
        setEditTitle(a.title);
        if (titleRef.current) titleRef.current.value = a.title;
      }
      if (a.description !== undefined) {
        setEditDesc(a.description);
        if (descRef.current) descRef.current.value = a.description;
      }
      if (a.status) setEditStatus(a.status);
      if (a.priority) setEditPriority(a.priority);
      if (a.storyPoints != null) setEditSP(a.storyPoints);
      if (a.dueDate !== undefined) setEditDueDate(a.dueDate || '');
    }
  }, [appliedTaskEdit]);
  // Sync editDueDate from selected task (when viewing from kanban card)
  useEffect(() => {
    setEditDueDate(selected?.dueDate || '');
  }, [selected?.id, selected?.dueDate]);

  // ─── Dirty tracking ───
  // The parent recreates `onEditingTask` on every render, so it cannot be a dependency
  // of the effects below without them firing on every render; the ref carries the
  // current callback instead. `selected` is read the same way, which keeps these two
  // effects firing exactly when they did before — on the `editing` toggle and on
  // deselection — rather than also on every change of the selected task.
  //
  // This replaces two `eslint-disable-next-line` comments that were sitting on the
  // `useEffect` line while the rule reports on the dependency array two lines down, so
  // they suppressed nothing and lint kept all four problems.
  const onEditingTaskRef = useRef(onEditingTask);
  const selectedRef = useRef(selected);
  useEffect(() => {
    onEditingTaskRef.current = onEditingTask;
    selectedRef.current = selected;
  });
  // Sync editing flag back to App.tsx when user toggles View→Edit or Edit→View
  useEffect(() => {
    const task = selectedRef.current;
    if (task?.issueNumber) onEditingTaskRef.current?.({ ...task, editing });
  }, [editing]);
  // Clear App.tsx editingTask when editor closes (returns to task list)
  useEffect(() => {
    if (!selected) onEditingTaskRef.current?.(null);
  }, [selected]);
  useEffect(() => {
    if (!editing) {
      setTaskReady(false);
      return;
    }
    const timer = setTimeout(() => setTaskReady(true), 800);
    return () => clearTimeout(timer);
  }, [editing]);
  useEffect(() => {
    if (!editing) taskEditedRef.current = false;
  }, [editing]);
  useEffect(() => {
    const dirty = editing && taskReady && taskEditedRef.current;
    if (!pendingBack) (window as any).__tl_unsaved = dirty ? 'tasks' : null;
    return () => {
      if ((window as any).__tl_unsaved === 'tasks') (window as any).__tl_unsaved = null;
    };
  }, [editTitle, editDesc, editStatus, editPriority, editSP, taskReady, selected?.id, editing, pendingBack]);

  // ─── Drag & drop ───
  const handleDragStart = (e: React.DragEvent, issueId: string, currentStatus: string) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: issueId, fromStatus: currentStatus }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = async (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.fromStatus !== targetStatus) {
        // Optimistic update: move card immediately in local state
        setIssues((prev) => prev.map((i) => (i.id === data.id ? { ...i, status: targetStatus } : i)));
        // Fire API in background — don't await
        api.issue.update({ id: data.id, status: targetStatus }).catch(() => {
          refreshTasks();
        });
      }
    } catch {
      /* ignore */
    }
  };

  // ─── Save/Delete ───
  const handleSave = async () => {
    if (!editTitle.trim()) return;
    setSaving(true);
    const desc = descRef.current?.value ?? editDesc;
    const payload = {
      title: editTitle.trim(),
      description: desc,
      status: editStatus,
      priority: editPriority,
      type: editType,
      storyPoints: editSP,
      dueDate: editDueDate || null,
    };
    try {
      if (selected?.id) {
        await api.issue.update({ id: selected.id, ...payload });
        setSelected({ ...selected, ...payload });
        setIssues((prev) => prev.map((i) => (i.id === selected.id ? { ...i, ...payload } : i)));
      } else {
        const created = await api.issue.create({ projectId: 'proj-default', ...payload });
        setSelected({ ...selected, ...payload, id: created.id, issueNumber: created.issueNumber });
        setIssues((prev) => [
          // Same shape the server stores, not toISOString() — the list renders this the
          // moment it lands, before any refetch replaces it.
          { ...payload, id: created.id, issueNumber: created.issueNumber, createdAt: nowDbUtc() },
          ...prev,
        ]);
      }
      taskEditedRef.current = false;
      setEditing(false);
      refreshTasks();
    } catch {
    } finally {
      setSaving(false);
    }
  };
  const handleSaveWithResult = async (): Promise<boolean> => {
    if (!editTitle.trim()) return false;
    const desc = descRef.current?.value ?? editDesc;
    const payload = {
      title: editTitle.trim(),
      description: desc,
      status: editStatus,
      priority: editPriority,
      type: editType,
      storyPoints: editSP,
      dueDate: editDueDate || null,
    };
    try {
      if (selected?.id) {
        await api.issue.update({ id: selected.id, ...payload });
      } else {
        await api.issue.create({ projectId: 'proj-default', ...payload });
      }
      setEditing(false);
      refreshTasks();
      return true;
    } catch {
      return false;
    }
  };
  const handleDelete = (id: string) => setDeleteTarget(id);
  const executeDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget;
    setDeleteTarget(null);
    setDeleting(true);
    await api.issue.delete(targetId);
    setDeleting(false);
    setSelected(null);
    refreshTasks();
  };

  // ─── Sort/Filter helpers ───
  const toggleColumn = (field: string) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };
  const visibleColDefs = ALL_COLUMNS.filter((c) => visibleColumns.has(c.field));
  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };
  const sortArrow = (key: string) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  // ─── Derived ───
  const filteredIssues = issues
    .filter(
      (i) =>
        (!typeFilter || i.type === typeFilter) &&
        (!priorityFilter || i.priority === priorityFilter) &&
        (!statusFilter || i.status === statusFilter) &&
        (!taskSearch || i.title?.toLowerCase().includes(taskSearch.toLowerCase())),
    )
    .sort((a, b) => {
      const av = a[sortKey] || '',
        bv = b[sortKey] || '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  const KANBAN_COLS = [
    { status: 'todo', label: 'TODO' },
    { status: 'in_progress', label: 'IN PROGRESS' },
    { status: 'done', label: 'DONE' },
  ];

  return {
    // State
    issues,
    taskCounts,
    selected,
    setSelected,
    editing,
    setEditing,
    editTitle,
    setEditTitle,
    editDesc,
    setEditDesc,
    editStatus,
    setEditStatus,
    editPriority,
    setEditPriority,
    editType,
    setEditType,
    editSP,
    setEditSP,
    editDueDate,
    setEditDueDate,
    taskSearch,
    setTaskSearch,
    sortKey,
    sortDir,
    typeFilter,
    setTypeFilter,
    priorityFilter,
    setPriorityFilter,
    statusFilter,
    setStatusFilter,
    collapsedTypes,
    setCollapsedTypes,
    expandedCardId,
    setExpandedCardId,
    deleteTarget,
    setDeleteTarget,
    deleting,
    saving,
    colPickerOpen,
    setColPickerOpen,
    pendingBack,
    setPendingBack,
    titleError,
    setTitleError,
    deletedNotify,
    setDeletedNotify,
    taskReady,
    taskEditedRef,
    // Refs
    titleRef,
    descRef,
    // Helpers
    t,
    refreshTasks,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleSave,
    handleSaveWithResult,
    handleDelete,
    executeDelete,
    toggleColumn,
    visibleColDefs,
    toggleSort,
    sortArrow,
    refreshing,
    setRefreshing,
    // Derived
    filteredIssues,
    KANBAN_COLS,
    ALL_COLUMNS,
    DEFAULT_COLLAPSED,
    // Passthrough
    onEditingTask,
  };
}
