import { useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import { ConfirmDialog } from '@tomilite/shared-ui/components/ConfirmDialog';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { t } from '@/lib/i18n';
import { useMeetingState } from './useMeetingState';
import { MeetingList } from './MeetingList';
import { MeetingEditor } from './MeetingEditor';
import { RecorderBar } from './RecorderBar';

// ═══ Meeting Panel — thin shell: hook → list | editor ═══
//
// Two dialogs here are not ConfirmDialog, because both need structure rather
// than a paragraph: the consent gate (a checkbox the user must actually see and
// tick) and the send-minutes form (recipients + an editable body). Both render
// through a portal so they sit above the panel, same as the shared one.

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 999,
  background: 'rgba(0,0,0,0.5)',
  backdropFilter: 'blur(2px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modal: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--edge)',
  borderRadius: 14,
  minWidth: 360,
  maxWidth: 520,
  maxHeight: '84vh',
  overflowY: 'auto',
  boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
  padding: '22px 22px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const titleStyle: CSSProperties = { fontSize: 15, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.3 };
const bodyStyle: CSSProperties = { fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 };
const btnRow: CSSProperties = { display: 'flex', gap: 10, marginTop: 4, justifyContent: 'flex-end' };

function Modal({ open, children }: { open: boolean; children: ReactNode }) {
  if (!open) return null;
  return createPortal(
    <div style={overlay}>
      <div style={modal}>{children}</div>
    </div>,
    document.body,
  );
}

// ─── Consent gate ───

function ConsentDialog({ s }: { s: ReturnType<typeof useMeetingState> }) {
  const lang = s.lang;
  const [checked, setChecked] = useState(false);
  return (
    <Modal open={s.consentOpen}>
      <div style={titleStyle}>{t('meeting.consent.title', lang)}</div>
      <p style={bodyStyle}>{t('meeting.consent.body', lang)}</p>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 12 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span style={{ color: 'var(--ink)', lineHeight: 1.6 }}>{t('meeting.consent.check', lang)}</span>
      </label>
      <div style={btnRow}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => s.setConsentOpen(false)}>
          {t('meeting.consent.cancel', lang)}
        </button>
        <button
          type="button"
          className="btn btn-brand btn-sm"
          disabled={!checked}
          onClick={() => {
            setChecked(false);
            void s.acceptConsent();
          }}
        >
          {t('meeting.consent.continue', lang)}
        </button>
      </div>
    </Modal>
  );
}

// ─── Send minutes ───

function SendDialog({ s }: { s: ReturnType<typeof useMeetingState> }) {
  const lang = s.lang;
  const [body, setBody] = useState('');
  const m = s.meeting;

  // Seed the editable body when the dialog opens, from the generated minutes.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (s.sendOpen && m && seededFor !== m.id + ':' + String(s.sendOpen)) {
    setSeededFor(m.id + ':' + String(s.sendOpen));
    setBody(m.minutes || m.summary || '');
  }
  if (!s.sendOpen && seededFor) setSeededFor(null);

  const submit = async () => {
    const html = await marked.parse(body || '', { async: true });
    const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}th{background:#f5f5f5;font-weight:600}</style></head><body style="font-family:sans-serif"><div style="max-width:600px;margin:0 auto;padding:20px">${html}</div></body></html>`;
    await s.sendMinutes(wrapped);
  };

  return (
    <Modal open={s.sendOpen}>
      <div style={titleStyle}>{t('meeting.minutes.send', lang)}</div>
      <label className="form-label">{t('meeting.minutes.to', lang)}</label>
      <input
        className="form-input"
        value={s.sendTo}
        onChange={(e) => s.setSendTo(e.target.value)}
        style={{ fontSize: 12 }}
      />
      <label className="form-label">{t('meeting.minutes.cc', lang)}</label>
      <input
        className="form-input"
        value={s.sendCc}
        onChange={(e) => s.setSendCc(e.target.value)}
        style={{ fontSize: 12 }}
      />
      <label className="form-label">{t('meeting.minutes.subject', lang)}</label>
      <input
        className="form-input"
        value={s.sendSubject}
        onChange={(e) => s.setSendSubject(e.target.value)}
        style={{ fontSize: 12 }}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
        <input type="checkbox" checked={s.sendAttach} onChange={(e) => s.setSendAttach(e.target.checked)} />
        {t('meeting.minutes.attachTranscript', lang)}
      </label>
      <MarkdownEditor value={body} onChange={setBody} height="220px" />
      <div style={btnRow}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => s.setSendOpen(false)}>
          {t('meeting.minutes.cancel', lang)}
        </button>
        <button type="button" className="btn btn-brand btn-sm" disabled={s.sending} onClick={() => void submit()}>
          {s.sending ? t('meeting.minutes.sending', lang) : t('meeting.minutes.send', lang)}
        </button>
      </div>
    </Modal>
  );
}

// ─── Panel ───

export function MeetingPanel({ active, refreshKey }: { active?: boolean; refreshKey?: number }) {
  const s = useMeetingState(active, refreshKey);
  const lang = s.lang;

  // A broken engine outranks a missing model — it is the more fundamental
  // problem, and both are fixed on the same settings tab.
  const engineWarning =
    s.bin?.ok === false ? 'meeting.settings.binMissingWarn' : s.noModel ? 'meeting.panel.noModelHint' : '';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <RecorderBar s={s} />

      {/* The panel stays usable with no speech model: recording and emailing do
          not depend on transcription, and hiding the whole feature behind an
          installed model would be a worse first run. But the notice has to lead
          somewhere — "no model installed" with no way to install one is a dead
          end, and the user only finds out when their first transcription fails. */}
      {engineWarning && (
        <div
          style={{
            margin: '6px 8px 0',
            padding: '6px 8px',
            fontSize: 10,
            lineHeight: 1.6,
            color: 'var(--amber)',
            background: 'var(--surface2)',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{t(engineWarning as any, lang)}</span>
          <button type="button" className="btn btn-secondary btn-xs" onClick={s.openModelSettings}>
            {t('meeting.transcribe.installModel', lang)}
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {s.selectedId ? <MeetingEditor s={s} /> : <MeetingList s={s} />}
      </div>

      {/* ─── Dialogs ─── */}
      <ConsentDialog s={s} />
      <SendDialog s={s} />

      <ConfirmDialog
        open={s.confirmAi}
        title={t('meeting.ai.confirmTitle', lang)}
        message={t('meeting.ai.confirmBody', lang, {
          tokens: s.estimate?.estInputTokens ?? 0,
          model: s.estimate?.synthModel ?? 'LLM',
          balance: s.estimate?.balanceCny ?? '-',
          total: s.estimate?.totalCny ?? '-',
        })}
        lang={lang}
        confirmLabel={t('meeting.ai.confirmOk', lang)}
        cancelLabel={t('meeting.ai.cancel', lang)}
        onConfirm={s.confirmSummarize}
        onCancel={() => s.setConfirmAi(false)}
      />

      <ConfirmDialog
        open={!!s.notice}
        variant="alert"
        title={s.notice?.title}
        message={s.notice?.message || ''}
        lang={lang}
        onConfirm={() => s.setNotice(null)}
        onCancel={() => s.setNotice(null)}
      />

      <ConfirmDialog
        open={!!s.deleteTarget}
        title={t('meeting.delete.title', lang)}
        message={t('meeting.delete.message', lang, { title: s.deleteTarget?.title || '' })}
        lang={lang}
        confirmLabel={t('meeting.delete.ok', lang)}
        cancelLabel={t('meeting.delete.cancel', lang)}
        onConfirm={() => void s.executeDelete()}
        onCancel={() => s.setDeleteTarget(null)}
      />
    </div>
  );
}
