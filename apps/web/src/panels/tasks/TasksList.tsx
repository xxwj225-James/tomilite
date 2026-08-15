import { useState, useEffect, useRef } from 'react';
import { tt } from '@/i18n/translations';
import { t as tt2 } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { api } from '@/lib/api';

// ═══ Tasks List View — tabs + drag-to-status + compact columns ═══

const TABS = [
  { key: 'todo', labelKey: 'tasks.status.todo', color: 'var(--muted)' },
  { key: 'in_progress', labelKey: 'tasks.status.inProgress', color: 'var(--amber)' },
  { key: 'done', labelKey: 'tasks.status.done', color: 'var(--green)' },
];

const PRI_COLOR: Record<string, string> = {
  critical: 'var(--red)',
  high: 'var(--amber)',
  medium: 'var(--blue)',
  low: 'var(--muted)',
};
const PRI_KEY: Record<string, string> = {
  critical: 'tasks.priority.crit',
  high: 'tasks.priority.hi',
  medium: 'tasks.priority.med',
  low: 'tasks.priority.lo',
};
const TYPE_COLOR: Record<string, string> = { task: 'var(--brand)', bug: 'var(--amber)', story: 'var(--purple)' };
const TYPE_KEY: Record<string, string> = {
  task: 'tasks.type.taskAbbr',
  bug: 'tasks.type.bugAbbr',
  story: 'tasks.type.storyAbbr',
};
const STATUS_LABEL: Record<string, Record<string, string>> = {
  todo: { zh: '待办', ja: '未着手', en: 'Todo' },
  in_progress: { zh: '进行中', ja: '進行中', en: 'In Progress' },
  done: { zh: '完成', ja: '完了', en: 'Done' },
};

// Resizable column header
function ColHeader({
  w,
  col,
  label,
  sortKey,
  toggleSort,
  sortArrow,
  onResize,
  flex,
  center,
  right,
}: {
  w: number;
  col: string;
  label: string;
  sortKey?: string;
  toggleSort?: (k: string) => void;
  sortArrow?: (k: string) => string;
  onResize: (col: string, e: React.MouseEvent) => void;
  flex?: boolean;
  center?: boolean;
  right?: boolean;
}) {
  const align = center ? 'center' : right ? 'right' : 'left';
  return (
    <div
      style={{
        width: flex ? undefined : w,
        flex: flex ? 1 : undefined,
        minWidth: flex ? 120 : undefined,
        flexShrink: flex ? 1 : 0,
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      <span
        style={{
          flex: 1,
          cursor: sortKey ? 'pointer' : 'default',
          userSelect: 'none',
          textAlign: align,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        onClick={() => sortKey && toggleSort?.(sortKey)}
      >
        {label}
        {sortKey && sortArrow ? sortArrow(sortKey) : ''}
      </span>
      <div
        onMouseDown={(e) => onResize(col, e)}
        style={{
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          position: 'absolute',
          right: -3,
          top: 0,
          zIndex: 1,
          background: 'transparent',
        }}
      />
    </div>
  );
}

export function TasksList(p: Record<string, unknown>) {
  const get = (key: string): any => (p as Record<string, never>)[key];
  const lang = useLang();
  const t = (k: string, v?: Record<string, string>) => tt(lang, k, v);

  // ─── Column widths (resizable, persisted to localStorage) ───
  const defaultWidths = { num: 64, title: 220, priority: 52, type: 46, created: 68, due: 68, updated: 68 };
  const [colW, setColW] = useState<Record<string, number>>(() => {
    try {
      const s = localStorage.getItem('tl-task-cols');
      if (s) return { ...defaultWidths, ...JSON.parse(s) };
    } catch {}
    return defaultWidths;
  });
  const saveColW = (w: Record<string, number>) => {
    setColW(w);
    localStorage.setItem('tl-task-cols', JSON.stringify(w));
  };
  const startResize = (col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colW[col] || 60;
    const onMove = (ev: MouseEvent) => {
      const nw = Math.max(24, startW + ev.clientX - startX);
      saveColW({ ...colW, [col]: nw });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const activeTab = (get('statusFilter') as string) || 'todo';
  const setActiveTab = (v: string) => {
    (get('setStatusFilter') as (v: string) => void)(v === activeTab ? '' : v);
  };

  // ─── Custom mouse drag-to-status (avoids HTML5 drag + obfuscator issues) ───
  // Perf: drag ghost position is updated via ref + direct DOM style mutation,
  // so mousemove does NOT trigger React re-renders of the 200-row list.
  const [dragActive, setDragActive] = useState(false);
  const [dragTitle, setDragTitle] = useState('');
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const dragItemIdRef = useRef<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleMouseDown = (e: React.MouseEvent, issue: Record<string, unknown>) => {
    const issueId = issue.id as string;
    const title = issue.title as string;
    if (activeTab === 'done') return;
    if (e.button !== 0) return;
    e.preventDefault();
    dragItemIdRef.current = issueId;
    setDragTitle(title);
    setDragActive(true);
    // Position ghost immediately at the cursor (no re-render wait)
    if (dragGhostRef.current) {
      dragGhostRef.current.style.left = e.clientX - 80 + 'px';
      dragGhostRef.current.style.top = e.clientY - 12 + 'px';
    }

    const onMove = (ev: MouseEvent) => {
      const g = dragGhostRef.current;
      if (g) {
        g.style.left = ev.clientX - 80 + 'px';
        g.style.top = ev.clientY - 12 + 'px';
      }
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setDragActive(false);

      // Check if dropped on a drop zone
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const zone = el?.closest('[data-drop-zone]');
      if (zone && dragItemIdRef.current) {
        const newStatus = zone.getAttribute('data-drop-zone') ?? '';
        if (newStatus !== activeTab) {
          // DB-first: update DB, then re-render UI. On failure, UI stays unchanged.
          api.issue
            .update({ id: dragItemIdRef.current, status: newStatus })
            .then(() => {
              (get('fetchIssues') as () => void)();
              const label = (STATUS_LABEL[newStatus] || {})[lang] || newStatus;
              showToast(tt2('tasks.toast.statusChanged', lang).replace('{status}', label));
            })
            .catch(() => {
              showToast(tt2('tasks.toast.statusChangeFailed' as any, lang));
            });
        }
      }
      dragItemIdRef.current = null;
      setDragTitle('');
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Shared click handler to open task editor
  const openTaskEditor = (issue: Record<string, unknown>) => {
    (get('setSelected') as (v: Record<string, unknown>) => void)({ ...issue });
    (get('setEditTitle') as (v: string) => void)(issue.title as string);
    (get('setEditDesc') as (v: string) => void)((issue.description as string) || '');
    (get('setEditStatus') as (v: string) => void)(issue.status as string);
    (get('setEditPriority') as (v: string) => void)(issue.priority as string);
    (get('setEditType') as (v: string) => void)((issue.type as string) || 'task');
    (get('setEditSP') as (v: number) => void)((issue.storyPoints as number) || 0);
    (get('setEditDueDate') as (v: string) => void)((issue as any).dueDate || '');
    (get('setEditing') as (v: boolean) => void)(true);
    (get('onEditingTask') as ((t: Record<string, unknown>) => void) | undefined)?.({
      issueNumber: issue.issueNumber,
      id: issue.id,
      title: issue.title,
      description: issue.description || '',
      status: issue.status,
      priority: issue.priority,
      storyPoints: issue.storyPoints || 0,
    });
  };

  useEffect(() => {
    // No-op: drag listeners are now added per-event in handleMouseDown
  }, []);

  // ─── Filter & sort ───
  const tabIssues = ((get('issues') as Array<Record<string, unknown>>) || []).filter((i: Record<string, unknown>) => {
    if (i.type === 'email') return false;
    if (activeTab === 'todo' && i.status !== 'todo') return false;
    if (activeTab === 'in_progress' && !['in_progress', 'in_review'].includes(i.status as string)) return false;
    if (activeTab === 'done' && i.status !== 'done') return false;
    if (get('taskSearch')) {
      const q = (get('taskSearch') as string).toLowerCase();
      if (!(i.title as string)?.toLowerCase().includes(q) && !`tl-${i.issueNumber}`.includes(q)) return false;
    }
    if (get('typeFilter') && i.type !== get('typeFilter')) return false;
    if (get('priorityFilter') && i.priority !== get('priorityFilter')) return false;
    return true;
  });

  const sKey = (get('sortKey') as string) || 'createdAt';
  const sDir = (get('sortDir') as string) || 'desc';
  const sortedIssues = [...tabIssues].sort((a: any, b: any) => {
    const av = a[sKey] ?? '',
      bv = b[sKey] ?? '';
    const cmp = (av as string) < (bv as string) ? -1 : (av as string) > (bv as string) ? 1 : 0;
    return sDir === 'asc' ? cmp : -cmp;
  });

  // Pagination
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const totalPages = Math.ceil(sortedIssues.length / PAGE_SIZE);
  const pageIssues = sortedIssues.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => {
    setPage(0);
  }, [sortedIssues.length, activeTab]);

  // Counts
  const counts: Record<string, number> = { todo: 0, in_progress: 0, done: 0 };
  ((get('issues') as Array<Record<string, unknown>>) || []).forEach((i: any) => {
    if (i.type === 'email') return;
    if (i.status === 'todo') counts.todo++;
    else if (i.status === 'done') counts.done++;
    else counts.in_progress++;
  });

  // ─── Drag hint (always shown until user dismisses, persisted to localStorage) ───
  const [dragHintDismissed, setDragHintDismissed] = useState(() => localStorage.getItem('tl-task-drag-hint') === '1');
  const dismissDragHint = () => {
    setDragHintDismissed(true);
    localStorage.setItem('tl-task-drag-hint', '1');
  };

  const toggleSort = get('toggleSort') as (k: string) => void;
  const sortArrow = get('sortArrow') as (k: string) => string;

  const filterDropdown = (
    value: string,
    setter: (v: string) => void,
    options: { val: string; label: string }[],
    placeholder: string,
  ) => (
    <select
      className="form-select"
      style={{
        width: 'auto',
        fontSize: 10,
        padding: '2px 6px',
        background: value ? 'color-mix(in srgb, var(--brand) 8%, var(--surface2))' : 'var(--surface2)',
        fontWeight: value ? 700 : 500,
        color: value ? 'var(--brand)' : 'var(--muted)',
      }}
      value={value}
      onChange={(e) => setter(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.val} value={o.val}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--edge)',
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button
          className="btn-ghost btn-xs"
          style={{
            width: 24,
            textAlign: 'center',
            flexShrink: 0,
            animation: get('refreshing') ? 'spin 1s linear infinite' : 'none',
          }}
          onClick={async () => {
            (get('setRefreshing') as (v: boolean) => void)(true);
            try {
              await (get('fetchIssues') as () => Promise<void>)();
            } finally {
              (get('setRefreshing') as (v: boolean) => void)(false);
            }
          }}
          title={t('btn.refresh')}
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
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
        </button>
        <input
          className="form-input"
          autoComplete="off"
          style={{ flex: 1, fontSize: 12, minWidth: 100 }}
          placeholder={t('tasks.search')}
          value={get('taskSearch') as string}
          onChange={(e) => (get('setTaskSearch') as (v: string) => void)(e.target.value)}
        />
        {filterDropdown(
          get('typeFilter') as string,
          (v) => (get('setTypeFilter') as (v: string) => void)(v),
          [
            { val: 'task', label: t('tasks.type.task') },
            { val: 'bug', label: t('tasks.type.bug') },
            { val: 'story', label: t('tasks.type.story') },
          ],
          t('tasks.allTypes'),
        )}
        {filterDropdown(
          get('priorityFilter') as string,
          (v) => (get('setPriorityFilter') as (v: string) => void)(v),
          [
            { val: 'critical', label: t('tasks.priority.critical') },
            { val: 'high', label: t('tasks.priority.high') },
            { val: 'medium', label: t('tasks.priority.medium') },
            { val: 'low', label: t('tasks.priority.low') },
          ],
          t('tasks.allPriority'),
        )}
        <button
          className="btn btn-brand btn-xs"
          onClick={() => {
            (get('setSelected') as (v: Record<string, unknown>) => void)({});
            (get('setEditTitle') as (v: string) => void)('');
            (get('setEditDesc') as (v: string) => void)('');
            (get('setEditStatus') as (v: string) => void)('todo');
            (get('setEditPriority') as (v: string) => void)('medium');
            (get('setEditType') as (v: string) => void)('task');
            (get('setEditSP') as (v: number) => void)(0);
            (get('setEditDueDate') as (v: string) => void)('');
            (get('setEditing') as (v: boolean) => void)(true);
            const ot = get('onEditingTask') as ((t: Record<string, unknown>) => void) | undefined;
            ot?.({ issueNumber: undefined, title: '', description: '', status: 'todo', priority: 'medium' });
          }}
        >
          {t('btn.new')}
        </button>
      </div>

      {/* Tab bar + toast */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--edge)',
          background: 'var(--surface2)',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {TABS.map((tab) => (
          <div
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '10px 8px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: activeTab === tab.key ? 700 : 500,
              color: activeTab === tab.key ? tab.color : 'var(--muted)',
              borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : '2px solid transparent',
              transition: 'all .15s',
            }}
          >
            {t(tab.labelKey)} <span style={{ opacity: 0.6, fontSize: 11 }}>({counts[tab.key] || 0})</span>
          </div>
        ))}
        {/* Toast */}
        {toast && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginTop: 4,
              padding: '6px 16px',
              background: 'var(--brand)',
              color: 'var(--on-accent)',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              zIndex: 10,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            {toast}
          </div>
        )}
      </div>

      {/* Drag hint */}
      {!dragHintDismissed && (
        <div
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid var(--amber)',
            background: 'color-mix(in srgb, var(--amber) 8%, var(--surface2))',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 14 }}>👆</span>
          <span style={{ flex: 1, fontSize: 11, color: 'var(--ink)', lineHeight: 1.4 }}>
            {tt2('tasks.dragHint' as any, lang)}
          </span>
          <button
            className="btn-ghost btn-xs"
            style={{ color: 'var(--muted)', fontSize: 16, padding: '0 4px', cursor: 'pointer' }}
            onClick={dismissDragHint}
          >
            ×
          </button>
        </div>
      )}

      {/* Drag drop zones (always rendered, visibility toggled — React async state needs pre-existing DOM) */}
      <div
        style={{
          display: dragActive ? 'flex' : 'none',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--brand)',
          background: 'color-mix(in srgb, var(--brand) 6%, var(--surface))',
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => (
          <div
            key={tab.key}
            data-drop-zone={tab.key}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '12px 8px',
              borderRadius: 8,
              border: `2px dashed ${tab.color}`,
              background: 'var(--surface2)',
              fontSize: 11,
              fontWeight: 700,
              color: tab.color,
              transition: 'all .15s',
              opacity: activeTab === tab.key ? 0.4 : 1,
            }}
          >
            {t(tab.labelKey)}
          </div>
        ))}
      </div>

      {/* Column headers + list in scrollable container */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {/* Column headers */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '5px 12px',
            borderBottom: '1px solid var(--edge)',
            background: 'var(--surface)',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--muted)',
            gap: 0,
            minWidth: 570,
          }}
        >
          <ColHeader
            w={colW.num}
            col="num"
            label={'#'}
            sortKey="issueNumber"
            toggleSort={toggleSort}
            sortArrow={sortArrow}
            onResize={startResize}
          />
          <ColHeader
            w={colW.title}
            col="title"
            flex
            label={tt2('tasks.title' as any, lang)}
            sortKey="title"
            toggleSort={toggleSort}
            sortArrow={sortArrow}
            onResize={startResize}
          />
          <ColHeader
            w={colW.priority}
            col="priority"
            label={tt2('tasks.field.priority' as any, lang)}
            sortKey="priority"
            toggleSort={toggleSort}
            sortArrow={sortArrow}
            onResize={startResize}
            center
          />
          <ColHeader
            w={colW.type}
            col="type"
            label={tt2('tasks.field.type' as any, lang)}
            sortKey="type"
            toggleSort={toggleSort}
            sortArrow={sortArrow}
            onResize={startResize}
            center
          />
          <ColHeader
            w={colW.created}
            col="created"
            label={tt2('tasks.field.created' as any, lang)}
            sortKey="createdAt"
            toggleSort={toggleSort}
            sortArrow={sortArrow}
            onResize={startResize}
            right
          />
          <ColHeader
            w={colW.due}
            col="due"
            label={tt2('tasks.field.due' as any, lang)}
            sortKey="dueDate"
            toggleSort={toggleSort}
            sortArrow={sortArrow}
            onResize={startResize}
            right
          />
          <ColHeader
            w={colW.updated}
            col="updated"
            label={tt2('tasks.field.updated' as any, lang)}
            sortKey="updatedAt"
            toggleSort={toggleSort}
            sortArrow={sortArrow}
            onResize={startResize}
            right
          />
        </div>

        {/* Task list */}
        <div style={{ paddingBottom: totalPages > 1 ? 0 : 120 }}>
          {sortedIssues.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>—</div>
          ) : (
            pageIssues.map((card: Record<string, unknown>) => {
              const issue = card;
              const pr = ((issue.priority as string) || 'medium').toLowerCase();
              const tp = ((issue.type as string) || 'task').toLowerCase();
              const isSelected = (get('selected') as Record<string, unknown>)?.id === issue.id;
              return (
                <div
                  key={issue.id as string}
                  style={{
                    padding: '7px 12px',
                    borderBottom: '1px solid var(--edge)',
                    background: isSelected ? 'var(--surface2)' : 'var(--surface)',
                    fontSize: 11,
                    transition: 'background .15s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0,
                    minWidth: 570,
                    userSelect: 'none',
                  }}
                >
                  {/* # + Title: click → open detail */}
                  <span
                    onClick={() => openTaskEditor(issue)}
                    style={{
                      fontSize: 9,
                      width: colW.num,
                      flexShrink: 0,
                      color: 'var(--muted)',
                      paddingRight: 6,
                      cursor: 'pointer',
                    }}
                  >
                    TL-{issue.issueNumber as number}
                  </span>
                  <div
                    onClick={() => openTaskEditor(issue)}
                    style={{ flex: 1, minWidth: 120, paddingRight: 6, cursor: 'pointer' }}
                  >
                    <div style={{ fontWeight: 500, lineHeight: 1.3, wordBreak: 'break-word' }}>
                      {issue.title as string}
                    </div>
                  </div>
                  {/* Priority → Updated: drag to change status */}
                  <span
                    onMouseDown={(e) => handleMouseDown(e, issue)}
                    style={{
                      width: colW.priority,
                      textAlign: 'center',
                      flexShrink: 0,
                      paddingRight: 6,
                      cursor: activeTab !== 'done' ? 'grab' : 'default',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '1px 4px',
                        borderRadius: 3,
                        background: PRI_COLOR[pr] || 'var(--muted)',
                        color: 'var(--on-accent)',
                        lineHeight: '16px',
                        maxWidth: colW.priority - 8,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tt2(PRI_KEY[pr] || ('tasks.priority.med' as any), lang)}
                    </span>
                  </span>
                  {/* Type badge */}
                  <span
                    onMouseDown={(e) => handleMouseDown(e, issue)}
                    style={{
                      width: colW.type,
                      textAlign: 'center',
                      flexShrink: 0,
                      paddingRight: 6,
                      cursor: activeTab !== 'done' ? 'grab' : 'default',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '1px 4px',
                        borderRadius: 3,
                        background: TYPE_COLOR[tp] || 'var(--muted)',
                        color: 'var(--on-accent)',
                        lineHeight: '16px',
                        maxWidth: colW.type - 8,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tt2(TYPE_KEY[tp] || ('tasks.type.taskAbbr' as any), lang)}
                    </span>
                  </span>
                  {/* Created */}
                  <span
                    onMouseDown={(e) => handleMouseDown(e, issue)}
                    style={{
                      fontSize: 9,
                      width: colW.created,
                      textAlign: 'right',
                      flexShrink: 0,
                      color: 'var(--muted)',
                      paddingRight: 6,
                      cursor: activeTab !== 'done' ? 'grab' : 'default',
                    }}
                  >
                    {((issue.createdAt as string) || '').substring(0, 10)}
                  </span>
                  {/* Due */}
                  <span
                    onMouseDown={(e) => handleMouseDown(e, issue)}
                    style={{
                      fontSize: 9,
                      width: colW.due,
                      textAlign: 'right',
                      flexShrink: 0,
                      color: 'var(--muted)',
                      cursor: activeTab !== 'done' ? 'grab' : 'default',
                    }}
                  >
                    {!!(issue as any).dueDate
                      ? (() => {
                          const d = new Date(issue.dueDate as string);
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000);
                          return (
                            <span
                              style={{
                                color: diff < 0 ? 'var(--brand)' : diff === 0 ? 'var(--amber)' : 'var(--muted)',
                              }}
                            >
                              {diff < 0 ? '⚠' : '📅'}
                              {(issue.dueDate as string).substring(5)}
                            </span>
                          );
                        })()
                      : '—'}
                  </span>
                  {/* Updated */}
                  <span
                    onMouseDown={(e) => handleMouseDown(e, issue)}
                    style={{
                      fontSize: 9,
                      width: colW.updated,
                      textAlign: 'right',
                      flexShrink: 0,
                      color: 'var(--muted)',
                      cursor: activeTab !== 'done' ? 'grab' : 'default',
                    }}
                  >
                    {((issue.updatedAt as string) || (issue.createdAt as string) || '').substring(0, 10)}
                  </span>
                </div>
              );
            })
          )}
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
                {page + 1} / {totalPages} ({sortedIssues.length} {lang === 'zh' ? '条' : 'total'})
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
        </div>
      </div>
      {/* Drag ghost — position mutated via ref during mousemove (no re-renders) */}
      <div
        ref={dragGhostRef}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          zIndex: 9999,
          padding: '6px 14px',
          background: 'var(--brand)',
          color: 'var(--on-accent)',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          whiteSpace: 'nowrap',
          maxWidth: 300,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: dragActive ? 'block' : 'none',
        }}
      >
        {dragTitle}
      </div>
    </div>
  );
}
