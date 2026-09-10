import { useEffect, useState, type CSSProperties } from 'react';
import { marked } from 'marked';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { t } from '@/lib/i18n';
import type { ActionItem, MeetingState } from './useMeetingState';

// ═══ Meeting detail — transcript | minutes | action items ═══
//
// The transcript tab is the one place the honesty requirement is visible, so it
// is worth restating: the server derives `Speaker 1 / Speaker 2` from pauses
// alone, and the roles the model suggests are labelled as guesses. No name ever
// appears next to a speaker label, because nothing here identified a voice.

const chipStyle: CSSProperties = {
  fontSize: 10,
  padding: '0 5px',
  borderRadius: 999,
  border: '1px solid var(--edge)',
  color: 'var(--muted)',
  whiteSpace: 'nowrap',
};

const tabBtn = (active: boolean): CSSProperties => ({
  fontSize: 11,
  padding: '4px 10px',
  border: 'none',
  borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent',
  background: 'transparent',
  color: active ? 'var(--brand)' : 'var(--muted)',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
});

// ─── Transcript ───

function TranscriptTab({ s }: { s: MeetingState }) {
  const lang = s.lang;
  const roleGuesses: Array<{ label: string; inferredRole: string }> = s.meeting?.speakers || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '6px 8px 0' }}>
        <input
          className="form-input"
          type="search"
          value={s.segSearch}
          placeholder={t('meeting.searchTranscript', lang)}
          onChange={(e) => void s.runSegSearch(e.target.value)}
          style={{ fontSize: 11 }}
        />
        <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 4 }}>
          {t('meeting.speakers.disclaimer', lang)}
        </p>
        {roleGuesses.length > 0 && (
          <p style={{ fontSize: 10, lineHeight: 1.6, marginTop: 2, fontStyle: 'italic', color: 'var(--muted)' }}>
            {roleGuesses
              .map((r) => `${r.label} — ${t('meeting.speakers.roleGuess', lang, { role: r.inferredRole })}`)
              .join(' · ')}
          </p>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '6px 8px 12px' }}>
        {s.visibleSegments.length === 0 && (
          <p className="text-ink-muted" style={{ fontSize: 11 }}>
            {s.transcribing
              ? t('meeting.status.running', lang, { pct: s.transcribePct ?? 0 })
              : t('meeting.minutes.empty', lang)}
          </p>
        )}
        {s.visibleSegments.map((seg) => (
          <div
            key={seg.id}
            style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--edge)' }}
          >
            <span
              style={{
                fontFamily: 'ui-monospace, Consolas, monospace',
                fontSize: 10,
                color: 'var(--muted)',
                width: 44,
                flexShrink: 0,
                paddingTop: 2,
              }}
            >
              {s.fmtClock(seg.startMs)}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span style={{ ...chipStyle, marginRight: 6 }}>{seg.speaker || 'Speaker 1'}</span>
              <span style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--ink)' }}>{seg.text}</span>
            </div>
          </div>
        ))}
        {s.canLoadMore && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => s.setSegmentLimit(s.segmentLimit + 200)}
          >
            {t('meeting.transcribe.showMore', lang, {
              n: Math.min(200, (s.detail?.totalSegments || 0) - s.segmentLimit),
            })}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Minutes ───

function MinutesTab({ s }: { s: MeetingState }) {
  const lang = s.lang;
  const m = s.meeting;
  const [summary, setSummary] = useState('');
  const [minutes, setMinutes] = useState('');
  const [subject, setSubject] = useState('');

  useEffect(() => {
    setSummary(m?.summary || '');
    setMinutes(m?.minutes || '');
    setSubject(m?.minutesSubject || m?.title || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed when the meeting or its AI output changes
  }, [m?.id, m?.aiStatus, m?.summary, m?.minutes]);

  const decisions: string[] = Array.isArray(m?.decisions) ? m.decisions : [];
  const attendees: string[] = Array.isArray(m?.attendees) ? m.attendees : [];
  const generated = m?.aiStatus === 'done';

  if (!generated && !m?.summary) {
    return (
      <div style={{ padding: 16 }}>
        <p className="text-ink-muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
          {t('meeting.minutes.empty', lang)}
        </p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 8 }}>
      <div className="card">
        <div className="card-hd">{t('meeting.minutes.summary', lang)}</div>
        <div className="card-bd">
          <MarkdownEditor
            value={summary}
            onChange={(v) => {
              setSummary(v);
              // Saved on blur rather than per keystroke — every save is a round
              // trip and the text can be long.
            }}
            height="220px"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 6 }}
            onClick={() => void s.saveMinutes({ summary })}
          >
            {t('meeting.settings.saved', lang)}
          </button>
        </div>
      </div>

      {decisions.length > 0 && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-hd">{t('meeting.minutes.decisions', lang)}</div>
          <div className="card-bd">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.8 }}>
              {decisions.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 8 }}>
        <div className="card-hd">{t('meeting.tab.minutes', lang)}</div>
        <div className="card-bd">
          <MarkdownEditor value={minutes} onChange={setMinutes} height="300px" />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void s.saveMinutes({ minutes })}>
              {t('meeting.settings.saved', lang)}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                s.setNotice({
                  title: t('meeting.minutes.summary', lang),
                  message: String(marked.parse(minutes || '')).slice(0, 400),
                })
              }
            >
              ⤢
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 8 }}>
        <div className="card-hd">{t('meeting.minutes.speakers', lang)}</div>
        <div className="card-bd">
          <input
            className="form-input"
            value={attendees.join(', ')}
            placeholder={t('meeting.actions.unassigned', lang)}
            onChange={(e) => setAttendeesLocal(e.target.value, (list) => void s.saveMinutes({ attendees: list }))}
            style={{ fontSize: 11 }}
          />
          <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 4 }}>
            {t('meeting.speakers.disclaimer', lang)}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 8, marginBottom: 12 }}>
        <div className="card-hd">{t('meeting.minutes.subject', lang)}</div>
        <div className="card-bd">
          <input
            className="form-input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={() => void s.saveMinutes({ minutesSubject: subject })}
            style={{ fontSize: 11 }}
          />
          <button
            type="button"
            className="btn btn-brand btn-sm"
            style={{ marginTop: 6 }}
            onClick={s.openSend}
            disabled={!s.emailConfigured}
          >
            {t('meeting.minutes.send', lang)}
          </button>
          {!s.emailConfigured && (
            <div style={{ fontSize: 10, lineHeight: 1.6, marginTop: 6, color: 'var(--amber)' }}>
              {t('meeting.minutes.notConfigured', lang)}{' '}
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => {
                  (window as any).__tl_settingsTab = 'email';
                  window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' }));
                }}
              >
                {t('meeting.minutes.goConfigure', lang)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Attendees are a comma-separated free-text field; empty entries never persist. */
function setAttendeesLocal(raw: string, persist: (list: string[]) => void) {
  const list = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  persist(list);
}

// ─── Action items ───

function ActionsTab({ s }: { s: MeetingState }) {
  const lang = s.lang;
  const items = s.detail?.actionItems || [];

  if (items.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <p className="text-ink-muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
          {t('meeting.actions.empty', lang)}
        </p>
      </div>
    );
  }

  const th: CSSProperties = {
    textAlign: 'left',
    fontSize: 10,
    color: 'var(--muted)',
    fontWeight: 600,
    padding: '4px 6px',
    borderBottom: '1px solid var(--edge)',
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 8 }}>
      <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>{t('meeting.actions.text', lang)}</th>
            <th style={th}>{t('meeting.actions.owner', lang)}</th>
            <th style={th}>{t('meeting.actions.due', lang)}</th>
            <th style={th}>{t('meeting.actions.priority', lang)}</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {items.map((item: ActionItem) => {
            const busy = s.busy === 'task:' + item.id;
            const dismissed = item.status === 'dismissed';
            return (
              <tr key={item.id} style={{ opacity: dismissed ? 0.5 : 1 }}>
                <td style={{ fontSize: 12, lineHeight: 1.6, padding: '6px' }}>{item.text}</td>
                <td style={{ ...chipStyle, fontSize: 11 }}>{item.owner || t('meeting.actions.none', lang)}</td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {item.dueDate || t('meeting.actions.none', lang)}
                </td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{item.priority || 'medium'}</td>
                <td style={{ whiteSpace: 'nowrap', padding: '6px' }}>
                  {item.issueId ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => s.openTask(item.issueId as string)}
                    >
                      {t('meeting.actions.openTask', lang)}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-brand btn-xs"
                      disabled={busy}
                      onClick={() => void s.createTask(item)}
                    >
                      {busy ? t('meeting.actions.creating', lang) : t('meeting.actions.createTask', lang)}
                    </button>
                  )}{' '}
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => void s.setActionStatus(item, dismissed ? 'open' : 'dismissed')}
                  >
                    {dismissed ? t('meeting.actions.reopen', lang) : t('meeting.actions.dismiss', lang)}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Shell ───

export function MeetingEditor({ s }: { s: MeetingState }) {
  const lang = s.lang;
  const m = s.meeting;
  const busyAi = s.busy === 'ai' || !!s.aiStage;

  if (!m) {
    return (
      <div style={{ padding: 16 }}>
        <p className="text-ink-muted" style={{ fontSize: 11 }}>
          {t('meeting.loading', lang)}
        </p>
      </div>
    );
  }

  const est: any = s.estimate;
  const canGenerate = m.transcribeStatus === 'done' || (s.detail?.totalSegments ?? 0) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ─── Header ─── */}
      <div style={{ padding: '8px 8px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => s.selectMeeting(null)}>
          ← {t('meeting.back', lang)}
        </button>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {m.title}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => s.setDeleteTarget(s.meetings.find((x) => x.id === m.id) || null)}
        >
          🗑
        </button>
      </div>

      {/* ─── Transcribe progress / failures ─── */}
      {s.transcribing && (
        <div style={{ padding: '6px 8px 0' }}>
          <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                width: `${s.transcribePct ?? 0}%`,
                height: '100%',
                background: 'var(--brand)',
                transition: 'width var(--transition-base)',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--brand)' }}>
              {t('meeting.status.running', lang, { pct: s.transcribePct ?? 0 })}
            </span>
            <span className="text-ink-muted" style={{ fontSize: 10 }}>
              {t('meeting.transcribe.slowHint', lang)}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => void s.cancelTranscribe()}>
              {t('meeting.transcribe.cancel', lang)}
            </button>
          </div>
        </div>
      )}

      {(s.jobError || m.transcribeStatus === 'failed') && (
        <div
          style={{
            margin: '6px 8px 0',
            padding: '6px 8px',
            fontSize: 10,
            lineHeight: 1.6,
            color: 'var(--red)',
            background: 'var(--red-soft)',
            borderRadius: 6,
          }}
        >
          {s.jobError ? t(s.jobError.key as any, lang, s.jobError.params) : String(m.transcribeError || '')}
          {s.jobError?.key === 'meeting.ai.quotaExhausted' && (
            <>
              {' '}
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => {
                  (window as any).__tl_settingsTab = 'llm';
                  window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' }));
                }}
              >
                {t('meeting.ai.upgrade', lang)}
              </button>
            </>
          )}
          {/* A missing engine or model is not an error the user can retry away —
              it needs a place to go, or this message is a dead end. */}
          {(s.jobError?.key === 'meeting.transcribe.noModel' || s.jobError?.key === 'meeting.transcribe.noBinary') && (
            <>
              {' '}
              <button type="button" className="btn btn-secondary btn-xs" onClick={s.openModelSettings}>
                {t('meeting.transcribe.installModel', lang)}
              </button>
            </>
          )}
          {/* The line below promises the recording was kept, so there has to be a
              way to use it. Installing a missing model fixes the cause but does
              not re-run the job — and `finalizeRecording` only auto-transcribes
              once, so without this button a meeting that failed on first run is
              stuck forever with audio nobody can transcribe.

              Always `force`: the failure may have left a partial segment set
              behind, and a retry that re-uses it would be silently wrong. */}
          {((m.audioBytes ?? 0) > 0 || !!s.detail?.totalSegments) && !m.audioDeletedAt && (
            <>
              {' '}
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                disabled={s.busy === 'transcribe'}
                onClick={() => void s.startTranscribe(true)}
              >
                {t('meeting.transcribe.retry', lang)}
              </button>
            </>
          )}
          <div className="text-ink-muted" style={{ marginTop: 4 }}>
            {t('meeting.transcribe.keepSafe', lang)}
          </div>
        </div>
      )}

      {/* ─── AI generate row ─── */}
      {canGenerate && (
        <div style={{ padding: '6px 8px 0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-brand btn-sm"
            disabled={busyAi}
            onClick={() => void s.requestSummarize(m.aiStatus === 'done')}
          >
            {busyAi
              ? t('meeting.status.aiRunning', lang)
              : m.aiStatus === 'done'
                ? t('meeting.ai.regenerate', lang)
                : t('meeting.ai.generate', lang)}
          </button>
          {s.aiStage?.stage === 'map' && s.aiStage.n ? (
            <span className="text-ink-muted" style={{ fontSize: 10 }}>
              {t('meeting.ai.mapStage', lang, { i: s.aiStage.i || 1, n: s.aiStage.n })}
            </span>
          ) : s.aiStage ? (
            <span className="text-ink-muted" style={{ fontSize: 10 }}>
              {t('meeting.ai.synthStage', lang)}
            </span>
          ) : (
            est && (
              <span className="text-ink-muted" style={{ fontSize: 10 }}>
                {t('meeting.ai.byokNote', lang, {
                  tokens: est.estInputTokens ?? 0,
                  model: est.hostedTrial ? est.synthModel : est.synthModel,
                })}
              </span>
            )
          )}
        </div>
      )}

      {canGenerate && (
        <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, padding: '4px 8px 0' }}>
          {t('meeting.ai.estimateHint', lang)}
        </p>
      )}

      {/* ─── Tabs ─── */}
      <div style={{ display: 'flex', gap: 2, padding: '6px 8px 0', borderBottom: '1px solid var(--edge)' }}>
        {(['transcript', 'minutes', 'actions'] as const).map((k) => (
          <button key={k} type="button" style={tabBtn(s.tab === k)} onClick={() => s.setTab(k)}>
            {t(`meeting.tab.${k}` as any, lang)}
            {k === 'actions' && s.openItems.length > 0 ? ` (${s.openItems.length})` : ''}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {s.tab === 'transcript' && <TranscriptTab s={s} />}
        {s.tab === 'minutes' && <MinutesTab s={s} />}
        {s.tab === 'actions' && <ActionsTab s={s} />}
      </div>
    </div>
  );
}
