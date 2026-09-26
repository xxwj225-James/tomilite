import { createPortal } from 'react-dom';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { RedmineSection } from './RedmineSection';

// ═══ The Redmine connection, opened from the task list ═══
//
// What it produces is tasks, so it belongs to the tasks panel: it used to be the other
// half of Settings → Import, which is where a user looks for configuration rather than
// for a way to bring work in.
//
// It is only a frame — the form, the polling and the three-way disconnect all live in
// `RedmineSection`, unchanged. The one thing this adds is that it unmounts when closed
// instead of hiding, which is what stops the poll: `RedmineSection` checks its status
// every 5 s while syncing and every 30 s otherwise, and a dialog left mounted behind a
// closed overlay would keep asking forever.
export function ImportTasksDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** A sync or a disconnect moved rows in the task list. */
  onChanged?: () => void;
}) {
  const lang = useLang();
  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{
          maxWidth: 620,
          width: '90vw',
          maxHeight: '84vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-hd">{t('redmine.groupTasks', lang)}</div>
        {/* `minHeight: 0` so the body is what scrolls when the form is taller than the
            window, and not the window itself. */}
        <div className="modal-bd" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <p className="text-ink-muted" style={{ fontSize: 11, lineHeight: 1.7, marginBottom: 'var(--space-3)' }}>
            {t('redmine.tasksLead', lang)}
          </p>
          <RedmineSection onChanged={onChanged} />
        </div>
        <div
          style={{
            padding: '0 var(--space-5) var(--space-5)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            {t('btn.close', lang)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
