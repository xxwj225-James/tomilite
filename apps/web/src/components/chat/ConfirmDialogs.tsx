import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import { ConfirmDialog } from '@tomilite/shared-ui/components/ConfirmDialog';
import type { ChatCard } from '@/types/chat';

// ═══ Confirm dialogs — leave/compress/delete/stop-download ═══
export function ConfirmDialogs({ leaveTarget, compressConfirm, compressMsg, deleteTarget, deleting, saveResult, stopDownloadConfirm, updateAvailable, onLeaveConfirm, onLeaveCancel, onCompressConfirm, onCompressCancel, onCompressMsgClose, onDeleteConfirm, onDeleteCancel, onDeletingClose, onSaveResultClose, onStopDownloadConfirm, onStopDownloadCancel }: {
  leaveTarget: { type: 'close' | 'menu'; key?: string } | null;
  compressConfirm: boolean;
  compressMsg: string;
  deleteTarget: ChatCard | null;
  deleting: boolean;
  saveResult: { ok: boolean; message: string } | null;
  stopDownloadConfirm: boolean;
  updateAvailable: any;
  onLeaveConfirm: () => void;
  onLeaveCancel: () => void;
  onCompressConfirm: () => void;
  onCompressCancel: () => void;
  onCompressMsgClose: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onDeletingClose: () => void;
  onSaveResultClose: () => void;
  onStopDownloadConfirm: () => void;
  onStopDownloadCancel: () => void;
}) {
  const lang = useLang();
  return (
    <>
      <ConfirmDialog
        open={!!leaveTarget}
        title={t('dialog.unsavedChanges', lang)}
        message={t('dialog.unsavedMessage', lang)}
        lang={lang}
        confirmLabel={t('btn.leave', lang)}
        cancelLabel={t('btn.cancel', lang)}
        onConfirm={onLeaveConfirm}
        onCancel={onLeaveCancel}
      />
      <ConfirmDialog
        open={compressConfirm}
        title={t('chat.compressTitle', lang)}
        message={t('chat.compressMessage', lang)}
        lang={lang}
        onConfirm={onCompressConfirm}
        onCancel={onCompressCancel}
      />
      <ConfirmDialog
        open={!!compressMsg}
        variant="alert"
        title={compressMsg}
        message=""
        lang={lang}
        onConfirm={onCompressMsgClose}
        onCancel={onCompressMsgClose}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('btn.delete', lang)}
        message={t('dialog.deleteConfirm', lang, { title: deleteTarget?.title || '' })}
        lang={lang}
        confirmLabel={t('btn.delete', lang)}
        cancelLabel={t('btn.cancel', lang)}
        onConfirm={onDeleteConfirm}
        onCancel={onDeleteCancel}
      />
      <ConfirmDialog
        open={deleting}
        variant="alert"
        loading
        message={t('dialog.deleting', lang)}
        lang={lang}
        onConfirm={onDeletingClose}
        onCancel={onDeletingClose}
      />
      <ConfirmDialog
        open={!!saveResult}
        variant="alert"
        message={saveResult?.message || ''}
        lang={lang}
        onConfirm={onSaveResultClose}
        onCancel={onSaveResultClose}
      />
      <ConfirmDialog
        open={stopDownloadConfirm}
        title={t('dialog.stopDownload', lang)}
        message={t('dialog.stopDownloadMessage', lang, { version: updateAvailable?.version || '' })}
        lang={lang}
        confirmLabel={t('dialog.stop', lang)}
        cancelLabel={t('btn.cancel', lang)}
        onConfirm={onStopDownloadConfirm}
        onCancel={onStopDownloadCancel}
      />
    </>
  );
}
