import { createPortal } from 'react-dom';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';

// ═══ First-run anonymous-telemetry consent (shown once until answered) ═══
// Opt-in only: nothing is captured until the user presses "Agree". Decline is
// remembered (SystemConfig telemetry.consent = 'no'); the dialog is asked
// again on next launch only if the user closes without answering.

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(3px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};
const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--edge)',
  borderRadius: 16,
  width: '100%',
  maxWidth: 520,
  maxHeight: '86vh',
  overflow: 'auto',
  boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
  padding: '24px 24px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--ink)',
  lineHeight: 1.3,
};
const leadStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--muted)',
  lineHeight: 1.6,
};
const secTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--ink)',
  textTransform: 'uppercase',
  letterSpacing: '.04em',
  marginBottom: 4,
};
const ul: React.CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.7 };
const fineStyle: React.CSSProperties = { fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 };
const row: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  marginTop: 10,
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
};
const btnBase: React.CSSProperties = {
  borderRadius: 8,
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  transition: 'all .15s',
};
const btnSecondary: React.CSSProperties = {
  ...btnBase,
  background: 'var(--surface2)',
  color: 'var(--ink)',
  border: '1px solid var(--edge)',
};
const btnPrimary: React.CSSProperties = { ...btnBase, background: 'var(--brand)', color: 'var(--on-accent)' };

export function TelemetryConsentDialog({
  open,
  onAgree,
  onDecline,
}: {
  open: boolean;
  onAgree: () => void;
  onDecline: () => void;
}) {
  const lang = useLang();
  if (!open) return null;
  const collectLines = t('telemetry.collected', lang).split('\n');
  return createPortal(
    <div style={overlay} onClick={onDecline}>
      <div style={card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={titleStyle}>{t('telemetry.dialogTitle', lang)}</div>
        <div style={leadStyle}>{t('telemetry.dialogLead', lang)}</div>

        <div>
          <div style={secTitle}>{t('telemetry.collectedTitle', lang)}</div>
          <ul style={ul}>
            {collectLines.map((ln: string, i: number) => (
              <li key={i}>{ln}</li>
            ))}
          </ul>
        </div>

        <div>
          <div style={secTitle}>{t('telemetry.neverTitle', lang)}</div>
          <div style={{ fontSize: 12.5, color: 'var(--brand)', lineHeight: 1.6, fontWeight: 600 }}>
            {t('telemetry.never', lang)}
          </div>
        </div>

        <div style={fineStyle}>{t('telemetry.dest', lang)}</div>
        <div style={fineStyle}>{t('telemetry.manage', lang)}</div>

        <div style={row}>
          <button style={btnSecondary} onClick={onDecline}>
            {t('telemetry.decline', lang)}
          </button>
          <button style={btnPrimary} onClick={onAgree} autoFocus>
            {t('telemetry.agree', lang)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
