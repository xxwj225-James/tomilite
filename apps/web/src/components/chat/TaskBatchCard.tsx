import { t, type I18NKey } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import type { ChatCard } from '@/types/chat';

// Status → label key + colour, mirroring the task list (TasksList.tsx:11-13).
const STATUS_META: Record<string, { key: I18NKey; color: string }> = {
  todo: { key: 'tasks.status.todo', color: 'var(--muted)' },
  in_progress: { key: 'tasks.status.inProgress', color: 'var(--amber)' },
  in_review: { key: 'tasks.status.inReview', color: 'var(--brand)' },
  done: { key: 'tasks.status.done', color: 'var(--green)' },
};

function priorityColor(priority?: string) {
  if (priority === 'critical') return 'var(--brand)';
  if (priority === 'high') return 'var(--amber)';
  return 'var(--muted)';
}

const CELL = {
  padding: '4px 6px',
  borderBottom: '1px solid var(--edge)',
  verticalAlign: 'middle',
} as const;

const HEAD_CELL = {
  ...CELL,
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--muted)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
} as const;

/**
 * One table for every task the agent created in a single turn.
 *
 * Each row is a normal single 'task' ChatCard, so its buttons just re-fire the
 * same window events the single-card markup uses (Msg.tsx:416/437/458) with
 * `detail` set to THAT row — useChatCardActions.ts needs no change.
 */
export function TaskBatchCard({ card, thinking }: { card: ChatCard; thinking?: boolean }) {
  const lang = useLang();
  const items = card.items || [];

  return (
    <div
      style={{
        margin: '8px 0',
        padding: 10,
        background: 'var(--surface)',
        borderRadius: 8,
        border: '2px solid var(--brand)',
        fontSize: 'var(--text-sm)',
        maxWidth: '100%',
        cursor: 'default',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--ink)', marginBottom: 6 }}>
        {t('chat.batchCreated', lang, { n: items.length })}
        {thinking ? ' …' : ''}
      </div>
      {/* The chat column can be ~320px wide — scroll the table rather than
          squashing five columns into it. */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 360 }}>
          <thead>
            <tr>
              <th style={HEAD_CELL}>{t('chat.batchKey', lang)}</th>
              <th style={HEAD_CELL}>{t('tasks.title', lang)}</th>
              <th style={HEAD_CELL}>{t('tasks.priority', lang)}</th>
              <th style={HEAD_CELL}>{t('tasks.status', lang)}</th>
              <th style={{ ...HEAD_CELL, textAlign: 'right' }}>{t('chat.batchActions', lang)}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const deleted = item.disabled || item.status === 'deleted';
              const statusMeta = STATUS_META[item.status || 'todo'];
              return (
                <tr key={item.id || item.key || i} style={deleted ? { opacity: 0.5 } : undefined}>
                  <td
                    style={{
                      ...CELL,
                      fontSize: 'var(--text-xs)',
                      fontWeight: 700,
                      color: 'var(--brand)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.key || item.id?.substring(0, 8)}
                  </td>
                  <td style={{ ...CELL, maxWidth: 0 }}>
                    <div
                      title={item.title}
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {item.title}
                    </div>
                  </td>
                  <td
                    style={{
                      ...CELL,
                      fontSize: 'var(--text-xs)',
                      fontWeight: 600,
                      color: priorityColor(item.priority),
                    }}
                  >
                    {item.priority || ''}
                  </td>
                  <td
                    style={{
                      ...CELL,
                      fontSize: 'var(--text-xs)',
                      fontWeight: 600,
                      color: statusMeta?.color || 'var(--muted)',
                    }}
                  >
                    {statusMeta ? t(statusMeta.key, lang) : item.status || 'todo'}
                  </td>
                  <td style={{ ...CELL, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {deleted ? (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                        🗑️ {t('chat.rowDeleted', lang)}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-brand btn-xs"
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('tl-open-card', { detail: item }));
                          }}
                        >
                          {t('btn.view', lang)}
                        </button>
                        <button
                          className="btn btn-xs"
                          style={{
                            background: 'var(--surface2)',
                            color: 'var(--ink)',
                            border: '1px solid var(--edge)',
                          }}
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('tl-edit-card', { detail: item }));
                          }}
                        >
                          {t('btn.edit', lang)}
                        </button>
                        <button
                          className="btn-ghost btn-xs"
                          style={{ color: 'var(--muted)' }}
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('tl-delete-card', { detail: item }));
                          }}
                        >
                          {t('btn.delete', lang)}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
