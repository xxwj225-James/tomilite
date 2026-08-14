import { MarkdownEditor } from '@/components/MarkdownEditor';
import { tr } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { marked } from 'marked';
import { sanitizeHtml } from '@/lib/sanitize';

// ═══ Tasks Editor View — task detail + edit form ═══

function typeLabel(type: string) {
  const labels: Record<string, string> = { task: '✅ Task', bug: '🐛 Bug', story: '📖 Story' };
  return labels[type] || type;
}

function statusBadge(status: string) {
  const labels: Record<string, string> = { todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' };
  const colors: Record<string, string> = { todo: 'var(--muted)', in_progress: 'var(--amber)', in_review: 'var(--brand)', done: 'var(--green)' };
  return <span className="badge" style={{ color: colors[status] || 'var(--muted)' }}>{labels[status] || status}</span>;
}

export function TasksEditor(p: Record<string, unknown>) {
  const lang = useLang();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--edge)', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', background: 'linear-gradient(180deg, var(--surface), var(--surface2))' }}>
        <button className="btn-ghost btn-xs" onClick={() => {
          const dirty = !(p.selected as any)?.id && ((p.editTitle as string).trim() || (p.editDesc as string).trim());
          if (dirty) { (window as any).__tl_unsaved = 'tasks'; (p.setPendingBack as (v: boolean) => void)(true); (p.setTitleError as (v: boolean) => void)(false); } else { (window as any).__tl_unsaved = null; (p.setSelected as (v: null) => void)(null); (p.setEditing as (v: boolean) => void)(false); }
        }}>{tr(lang,'← 返回','← 戻る','← กลับ','← Hoki','← Назад','← Back')}</button>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{(p.selected as any)?.id ? `TL-${(p.selected as any).issueNumber}` : (tr(lang,'新任务','新規タスク','งานใหม่','Mahi Hou','Новая задача','New Task'))}</span>
        {(p.selected as any)?.id && (p.selected as any)?.status !== 'done' && <button className="btn btn-brand btn-xs" onClick={() => { const next = !p.editing; (p.setEditing as (v: boolean) => void)(next); if (next) { const s = p.selected as any; const ot = p.onEditingTask as ((t: Record<string, unknown>) => void) | undefined; ot?.({ issueNumber: s.issueNumber, id: s.id, title: s.title, description: s.description || '', status: s.status, priority: s.priority, storyPoints: s.storyPoints || 0 }); } else { const ot = p.onEditingTask as ((t: null) => void) | undefined; ot?.(null); } }}>{p.editing ? (tr(lang,'取消','キャンセル','ยกเลิก','Whakakore','Отмена','Cancel')) : <span style={{display:'inline-flex',alignItems:'center',gap:2}}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>{tr(lang,' 编辑',' 編集',' แก้ไข',' Whakatika',' Правка',' Edit')}</span>}</button>}
        {(!(p.selected as any)?.id || p.editing) && <button className="btn btn-brand btn-xs" onClick={p.handleSave as () => void} disabled={!!(p as any).saving || !(p.editTitle as string)?.trim()}>{(p as any).saving ? (tr(lang,'保存中...','保存中...','กำลังบันทึก...','Kei te Tiaki...','Сохранение...','Saving...')) : <span style={{display:'inline-flex',alignItems:'center',gap:3}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>{tr(lang,' 保存',' 保存',' บันทึก',' Tiaki',' Сохранить',' Save')}</span>}</button>}
        {(p.selected as any)?.id && <button className="btn-ghost btn-xs" disabled={!!(p as any).deleting} style={{ color: (p as any).deleting ? 'var(--muted)' : 'var(--brand)' }} onClick={() => (p.handleDelete as (id: string) => void)((p.selected as any).id as string)}>{(p as any).deleting ? (tr(lang,'删除中...','削除中...','กำลังลบ...','Kei te Mukua...','Удаление...','Deleting...')) : (tr(lang,'删除','削除','ลบ','Mukua','Удалить','Delete'))}</button>}
      </div>
      <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 10 }}>
        {p.editing || !(p.selected as any)?.id ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 10 }}>
            {/* ── Title Card ── */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
              <div className="form-grp"><label className="form-label" style={p.titleError ? { color: 'var(--brand)' } : {}}>{tr(lang,'标题','タイトル','ชื่อเรื่อง','Taitara','Заголовок','Title')}{p.titleError ? <span style={{ marginLeft: 4, fontSize: 11 }}>{tr(lang,'（必填）','（必須）',' (จำเป็น)',' (hiahia)',' (обяз.)',' (required)')}</span> : null}</label><input className="form-input" ref={p.titleRef as React.RefObject<HTMLInputElement>} value={p.editTitle as string} onChange={e => { (p.setEditTitle as (v: string) => void)(e.target.value); if (p.titleError && e.target.value.trim()) (p.setTitleError as (v: boolean) => void)(false); }} style={p.titleError ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 2px rgba(239,68,68,0.2)' } : {}} /></div>
            </div>
            {/* ── Metadata Card ── */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div className="form-grp" style={{ flex: '1 1 100px', minWidth: 90 }}>
                  <label className="form-label">{tr(lang,'类型','タイプ','ประเภท','Momo','Тип','Type')}</label>
                  <select className="form-select" value={p.editType as string} onChange={e => (p.setEditType as (v: string) => void)(e.target.value)}>
                    <option value="task">{tr(lang,'✅ 任务','✅ タスク','✅ งาน','✅ Mahi','✅ Задача','✅ Task')}</option><option value="bug">{tr(lang,'🐛 缺陷','🐛 バグ','🐛 บั๊ก','🐛 Hapa','🐛 Баг','🐛 Bug')}</option><option value="story">{tr(lang,'📖 故事','📖 ストーリー','📖 สตอรี่','📖 Pūrākau','📖 История','📖 Story')}</option>
                  </select>
                </div>
                <div className="form-grp" style={{ flex: '1 1 100px', minWidth: 90 }}>
                  <label className="form-label">{tr(lang,'优先级','優先度','ลำดับ','Mātāmua','Приоритет','Priority')}</label>
                  <select className="form-select" value={p.editPriority as string} onChange={e => (p.setEditPriority as (v: string) => void)(e.target.value)}>
                    <option value="low">{tr(lang,'低','低','ต่ำ','Iti','Низкий','Low')}</option><option value="medium">{tr(lang,'中','中','กลาง','Waenga','Средний','Medium')}</option><option value="high">{tr(lang,'高','高','สูง','Nui','Высокий','High')}</option><option value="critical">{tr(lang,'严重','緊急','วิกฤต','Mātāmua','Критичный','Critical')}</option>
                  </select>
                </div>
                <div className="form-grp" style={{ flex: '1 1 100px', minWidth: 90 }}>
                  <label className="form-label">{tr(lang,'状态','Status','Status','Status','Status','Status')}</label>
                  <select className="form-select" value={p.editStatus as string} onChange={e => (p.setEditStatus as (v: string) => void)(e.target.value)}>
                    <option value="todo">{tr(lang,'待办','未着手','Todo','Todo','Todo','Todo')}</option><option value="in_progress">{tr(lang,'进行中','進行中','กำลังทำ','Kei te Haere','В процессе','In Progress')}</option><option value="done">{tr(lang,'完成','完了','เสร็จ','Kua Oti','Готово','Done')}</option>
                  </select>
                </div>
                <div className="form-grp" style={{ flex: '1 1 100px', minWidth: 90 }}>
                  <label className="form-label">{tr(lang,'截止日','Due','Due','Due','Due','Due')}</label>
                  <input className="form-input" type="date" value={(p.editDueDate as string) || ''} onChange={e => (p.setEditDueDate as (v: string) => void)(e.target.value)} />
                </div>
                <div className="form-grp" style={{ width: 55 }}>
                  <label className="form-label">SP</label>
                  <input className="form-input" type="number" min={0} max={100} value={(p.editSP as number) || ''} onChange={e => (p.setEditSP as (v: number) => void)(parseInt(e.target.value) || 0)} />
                </div>
              </div>
            </div>
            {/* ── Description Card ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
              <div className="form-grp" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}><label className="form-label">{tr(lang,'描述','説明','คำอธิบาย','Whakaahuatanga','Описание','Description')}</label><MarkdownEditor value={p.editDesc as string} onChange={v => { (p.setEditDesc as (v: string) => void)(v); if (p.taskReady) (p.taskEditedRef as { current: boolean }).current = true; }} placeholder={tr(lang,'描述（支持 Markdown）','Description (Markdown supported)','Description (Markdown supported)','Description (Markdown supported)','Description (Markdown supported)','Description (Markdown supported)')} height="calc(100% - 22px)" /></div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{(p.selected as any).title as string}</div>
              <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                <span className="badge">{typeLabel((p.selected as any).type as string)}</span>
                <span className="badge">{tr(lang,'优先级: ','Priority: ','Priority: ','Priority: ','Priority: ','Priority: ')}{(p.selected as any).priority as string}</span>
                {statusBadge((p.selected as any).status as string)}
                <span className="badge">{(p.selected as any).storyPoints ? `${(p.selected as any).storyPoints}sp` : '—'}</span>
                {(p.selected as any).dueDate && <span className="badge">📅 {(p.selected as any).dueDate as string}</span>}
              </div>
            </div>
            <div className="md-preview" style={{ background: 'var(--surface)', border: '1px solid var(--edge)', borderRadius: 'var(--radius-md)', padding: '14px 16px', lineHeight: 1.7 }}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml((marked.parse(((p.selected as any).description as string) || (lang === 'zh' ? '暂无描述。' : lang === 'ja' ? '説明なし。' : 'No description.')) as string)) }} />
          </div>
        )}
      </div>
    </div>
  );
}
