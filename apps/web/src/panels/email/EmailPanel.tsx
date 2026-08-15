import { ConfirmDialog } from '@tomilite/shared-ui/components/ConfirmDialog';
import { useLang } from '@/stores/useLang';
import { tr, t as tt2 } from '@/lib/i18n';
import { useEmailState } from './useEmailState';
import { EmailList } from './EmailList';
import { EmailDetail } from './EmailDetail';

// ═══ Email Panel — thin shell: hook → list | detail ═══

export function EmailPanel({ emailRefresh, active }: {
  emailRefresh?: number;
  active?: boolean;
}) {
  const lang = useLang();
  const s = useEmailState(emailRefresh, active);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {!s.selected ? <EmailList {...s} /> : <EmailDetail {...s} />}

      {/* Dismiss confirm */}
      <ConfirmDialog
        open={!!s.dismissTarget}
        title={s.t('dismiss')}
        message={s.t('dismissConfirm')}
        lang={lang}
        loading={s.dismissing as boolean}
        confirmLabel={s.dismissing ? tt2('emailPanel.processing', lang) : s.t('dismiss')}
        cancelLabel={tr(lang, '取消', 'キャンセル', 'ยกเลิก', 'Whakakore', 'Отмена', 'Cancel')}
        onConfirm={() => { if (s.dismissTarget) s.dismissEmail(s.dismissTarget); }}
        onCancel={() => s.setDismissTarget(null)}
      />

      {/* Unsaved draft confirm */}
      <ConfirmDialog
        open={s.pendingBack as boolean}
        title={tt2('emailPanel.unsavedTitle', lang)}
        message={tt2('emailPanel.unsavedMessage', lang)}
        lang={lang}
        confirmLabel={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> {tt2('emailPanel.save', lang)}</span>}
        cancelLabel={tt2('emailPanel.exit', lang)}
        onConfirm={s.saveDraftAndBack}
        onCancel={() => { s.setPendingBack(false); s.setSelected(null); }}
      />

      {/* Unlink task confirm */}
      <ConfirmDialog
        open={s.unlinkConfirm as boolean}
        title={tt2('emailPanel.unlinkTitle', lang)}
        message={tt2('emailPanel.unlinkMessage', lang)}
        lang={lang}
        loading={s.unlinking as boolean}
        confirmLabel={s.unlinking ? tt2('emailPanel.deleting', lang) : tt2('emailPanel.deleteTask', lang)}
        cancelLabel={tr(lang, '取消', 'キャンセル', 'Cancel', 'Cancel', 'Cancel', 'Cancel')}
        onConfirm={s.handleUnlinkTask}
        onCancel={() => s.setUnlinkConfirm(false)}
      />
    </div>
  );
}
