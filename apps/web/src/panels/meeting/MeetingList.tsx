import type { CSSProperties } from 'react';
import { t } from '@/lib/i18n';
import type { MeetingRow, MeetingState } from './useMeetingState';
import { EmptyState } from '@/components/EmptyState';

// ═══ Meeting library ═══
//
// Rows answer one question — "what did this meeting turn into?" — so the status
// chip and the action-item count lead, and the audio size does not.

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso.replace(' ', 'T')).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / 86_400_000);
}

function StatusChip({ m, lang }: { m: MeetingRow; lang: string }) {
  const base: CSSProperties = {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 999,
    border: '1px solid var(--edge)',
    whiteSpace: 'nowrap',
  };

  if (m.status === 'recording') {
    return (
      <span style={{ ...base, color: 'var(--red)', borderColor: 'var(--red)' }}>
        ● {t('meeting.status.recording', lang)}
      </span>
    );
  }
  if (m.transcribeStatus === 'running' || m.transcribeStatus === 'queued') {
    return (
      <span style={{ ...base, color: 'var(--brand)' }}>
        {t('meeting.status.running', lang, { pct: m.transcribeProgress ?? 0 })}
      </span>
    );
  }
  if (m.transcribeStatus === 'failed') {
    return <span style={{ ...base, color: 'var(--red)' }}>{t('meeting.status.failed', lang)}</span>;
  }
  if (m.transcribeStatus === 'cancelled') {
    return <span style={{ ...base, color: 'var(--muted)' }}>{t('meeting.status.cancelled', lang)}</span>;
  }
  if (m.minutesStatus === 'sent') {
    return <span style={{ ...base, color: 'var(--green)' }}>{t('meeting.status.sent', lang)}</span>;
  }
  if (m.aiStatus === 'running') {
    return <span style={{ ...base, color: 'var(--brand)' }}>{t('meeting.status.aiRunning', lang)}</span>;
  }
  if (m.aiStatus === 'done') {
    return <span style={{ ...base, color: 'var(--green)' }}>{t('meeting.status.aiDone', lang)}</span>;
  }
  if (m.aiStatus === 'failed') {
    return <span style={{ ...base, color: 'var(--red)' }}>{t('meeting.status.aiFailed', lang)}</span>;
  }
  if (m.transcribeStatus === 'done') {
    return <span style={{ ...base, color: 'var(--ink)' }}>{t('meeting.status.done', lang)}</span>;
  }
  return <span style={{ ...base, color: 'var(--muted)' }}>{t('meeting.status.recorded', lang)}</span>;
}

function RetentionBadge({ m, lang }: { m: MeetingRow; lang: string }) {
  if (m.audioDeletedAt) return <span className="text-ink-muted">{t('meeting.retention.deleted', lang)}</span>;
  if (m.retentionDays === 0) return <span className="text-ink-muted">{t('meeting.retention.forever', lang)}</span>;
  const days = daysUntil(m.audioExpiresAt);
  if (days === null) return null;
  return <span className="text-ink-muted">{t('meeting.retention.inDays', lang, { days: Math.max(0, days) })}</span>;
}

export function MeetingList({ s }: { s: MeetingState }) {
  const lang = s.lang;
  const rows = s.meetings;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '8px 8px 4px' }}>
        <input
          className="form-input"
          type="search"
          value={s.search}
          placeholder={t('meeting.search', lang)}
          onChange={(e) => {
            s.setSearch(e.target.value);
            void s.fetchList(e.target.value);
          }}
          style={{ fontSize: 12 }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {s.loading && rows.length === 0 && (
          <p className="text-ink-muted" style={{ fontSize: 11, padding: 12 }}>
            {t('meeting.loading', lang)}
          </p>
        )}

        {!s.loading &&
          rows.length === 0 &&
          // A search that matched nothing gets one line; an empty library gets
          // the explanation and the button that fills it.
          (s.search ? (
            <div className="text-ink-muted" style={{ padding: 20, textAlign: 'center', fontSize: 'var(--text-sm)' }}>
              {t('meeting.noResults', lang)}
            </div>
          ) : (
            <EmptyState
              icon="🎙️"
              title={t('meeting.empty', lang)}
              hint={t('meeting.emptyHint', lang)}
              actionLabel={t('meeting.emptyAction', lang)}
              // `requestStart`, not a direct capture call: it is the same entry
              // point the recorder bar uses, so the consent prompt that meeting
              // recording requires is not bypassed from this button. The source
              // matches the recorder bar's default (`mic+system`) — capturing
              // only the microphone would silently drop the other side of the
              // call, which is the half that matters in a meeting.
              onAction={() => void s.requestStart('mic+system')}
            />
          ))}

        {rows.map((m) => (
          <div
            key={m.id}
            className="list-row"
            role="button"
            tabIndex={0}
            onClick={() => s.selectMeeting(m.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                s.selectMeeting(m.id);
              }
            }}
            style={{
              padding: '8px 10px',
              cursor: 'pointer',
              borderBottom: '1px solid var(--edge)',
              background: s.selectedId === m.id ? 'var(--brand-soft)' : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  color: 'var(--ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.title}
              </span>
              <StatusChip m={m} lang={lang} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
              <span className="text-ink-muted" style={{ fontSize: 10 }}>
                {m.createdAt?.slice(0, 16)}
              </span>
              {m.durationMs > 0 && (
                <span className="text-ink-muted" style={{ fontSize: 10 }}>
                  {s.fmtClock(m.durationMs)}
                </span>
              )}
              {m.source === 'mic' && (
                <span className="text-ink-muted" style={{ fontSize: 10 }}>
                  {t('meeting.source.mic', lang)}
                </span>
              )}
              {/* The action clause is dropped rather than shown as "0 action
                  items": a count of nothing is not a fact about the meeting, and
                  in a row that already carries four other pieces of metadata it
                  is pure noise. */}
              <span className="text-ink-muted" style={{ fontSize: 10 }}>
                {m.actionItemCount > 0
                  ? t('meeting.counts', lang, { segments: m.segmentCount, actions: m.actionItemCount })
                  : t('meeting.countsNoActions', lang, { segments: m.segmentCount })}
              </span>
            </div>
            <div style={{ fontSize: 10, marginTop: 2 }}>
              <RetentionBadge m={m} lang={lang} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
