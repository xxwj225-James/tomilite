import { ConfirmDialog } from '@tomatolite/shared-ui/components/ConfirmDialog';
import { useLang } from '@/stores/useLang';
import { useNotesState } from './useNotesState';
import { NotesList } from './NotesList';
import { NotesEditor } from './NotesEditor';

// ═══ Notes Panel — state hook → List | Editor routing ═══

export function NotesPanel({ onEditingNote, onNoteAction, noteRefresh, appliedEdit, active }: { onEditingNote?: (note: { id?: string; title: string; content: string; category: string } | null) => void; onNoteAction?: (action: string) => void; noteRefresh?: number; appliedEdit?: { title?: string; content?: string; category?: string } | null; active?: boolean }) {
  const lang = useLang();
  const s = useNotesState(onEditingNote, onNoteAction, noteRefresh, appliedEdit, active);
  const { editing } = s;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {!editing ? <NotesList {...s} /> : <NotesEditor {...s} />}
      <ConfirmDialog open={!!s.exportMsg} variant="alert" title={lang === 'zh' ? '导出' : 'Export'} message={(s.exportMsg as string) || ''} lang={lang} onConfirm={() => (s.setExportMsg as (v: null) => void)(null)} onCancel={() => (s.setExportMsg as (v: null) => void)(null)} />
      <ConfirmDialog open={!!s.overwriteMsg} variant="confirm" title={lang === 'zh' ? '覆盖确认' : 'Overwrite'} message={(s.overwriteMsg as string) || ''} lang={lang} confirmLabel={lang === 'zh' ? '覆盖' : 'Overwrite'} cancelLabel={lang === 'zh' ? '取消' : 'Cancel'} onConfirm={() => (s.resolveOverwrite as (ok: boolean) => void)(true)} onCancel={() => (s.resolveOverwrite as (ok: boolean) => void)(false)} />
      <ConfirmDialog
        open={!!(s as any).deletedNotify}
        variant="alert"
        title={lang === 'zh' ? '提示' : 'Notice'}
        message={(s as any).deletedNotify as string}
        lang={lang}
        onConfirm={() => ((s as any).setDeletedNotify as (v: null) => void)(null)}
        onCancel={() => ((s as any).setDeletedNotify as (v: null) => void)(null)}
      />
    </div>
  );
}
