import { ConfirmDialog } from '@tomatolite/shared-ui/components/ConfirmDialog';
import { useLang } from '@/stores/useLang';
import { tr } from '@/lib/i18n';
import { useTaskState } from './useTaskState';
import { TasksList } from './TasksList';
import { TasksEditor } from './TasksEditor';

// ═══ Tasks Panel — thin shell: hook → list | editor ═══

interface TaskEditPayload {
  issueNumber?: number;
  id?: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  storyPoints?: number;
}

export function TasksPanel({ onEditingTask, appliedTaskEdit, taskRefresh, active }: {
  onEditingTask?: (task: TaskEditPayload | null) => void;
  appliedTaskEdit?: Record<string, unknown> | null;
  taskRefresh?: number;
  active?: boolean;
}) {
  const lang = useLang();
  const s = useTaskState(onEditingTask, appliedTaskEdit, taskRefresh, active);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {!s.selected ? <TasksList {...s} /> : <TasksEditor {...s} />}
      <ConfirmDialog open={s.pendingBack as boolean} title={tr(lang as string,'未保存的更改','Unsaved Changes','Unsaved Changes','Unsaved Changes','Unsaved Changes','Unsaved Changes')} message={tr(lang as string,'要保存后退出吗？','Save before leaving?','Save before leaving?','Save before leaving?','Save before leaving?','Save before leaving?')} lang={lang as string} confirmLabel={<span style={{display:'inline-flex',alignItems:'center',gap:3}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>{tr(lang as string,' 保存',' 保存',' บันทึก',' Tiaki',' Сохранить',' Save')}</span>} cancelLabel={tr(lang as string,'退出','Exit','Exit','Exit','Exit','Exit')} onConfirm={async () => {
        (s.setPendingBack as (v: boolean) => void)(false);
        if (!(s.editTitle as string)?.trim()) { (s.setTitleError as (v: boolean) => void)(true); return; }
        const ok = await (s.handleSaveWithResult as () => Promise<boolean>)();
        if (ok) { (window as unknown as Record<string, unknown>).__tl_unsaved = null; (s.setSelected as (v: null) => void)(null); (s.setEditing as (v: boolean) => void)(false); }
      }} onCancel={() => { (s.setPendingBack as (v: boolean) => void)(false); (window as unknown as Record<string, unknown>).__tl_unsaved = null; (s.setSelected as (v: null) => void)(null); (s.setEditing as (v: boolean) => void)(false); }} />
      <ConfirmDialog open={!!s.deleteTarget} title={tr(lang as string,'删除任务','タスク削除','ลบงาน','Mukua Mahi','Удалить задачу','Delete Task')} message={tr(lang as string,'删除此任务？此操作无法撤销。','このタスクを削除しますか？元に戻せません。','ลบงานนี้? ไม่สามารถยกเลิกได้','Mukua tēnei mahi? Kāore e taea te whakakore.','Удалить задачу? Это необратимо.','Delete this task? This action cannot be undone.')} lang={lang as string} confirmLabel={lang === 'zh' ? '删除' : lang === 'ja' ? '削除' : 'Delete'} cancelLabel={tr(lang as string,'取消','キャンセル','ยกเลิก','Whakakore','Отмена','Cancel')} onConfirm={s.executeDelete as () => void} onCancel={() => (s.setDeleteTarget as (v: null) => void)(null)} />
      <ConfirmDialog open={s.batchDeleteOpen as boolean} title={tr(lang as string,'批量删除','一括削除','ลบเป็นชุด','Mukua Rōpū','Массовое удаление','Batch Delete')} message={lang === 'zh' ? `删除 ${(s.selectedIds as Set<string>).size} 个选中任务？此操作无法撤销。` : `Delete ${(s.selectedIds as Set<string>).size} selected task(s)? This action cannot be undone.`} lang={lang as string} confirmLabel={tr(lang as string,'删除','削除','ลบ','Mukua','Удалить','Delete')} cancelLabel={tr(lang as string,'取消','キャンセル','ยกเลิก','Whakakore','Отмена','Cancel')} onConfirm={s.executeBatchDelete as () => void} onCancel={() => (s.setBatchDeleteOpen as (v: boolean) => void)(false)} />
      <ConfirmDialog
        open={!!s.deletedNotify}
        variant="alert"
        title={tr(lang as string,'提示','通知','แจ้ง','Whakamōhio','Уведомление','Notice')}
        message={s.deletedNotify as string}
        lang={lang as string}
        onConfirm={() => (s.setDeletedNotify as (v: null) => void)(null)}
        onCancel={() => (s.setDeletedNotify as (v: null) => void)(null)}
      />
    </div>
  );
}
