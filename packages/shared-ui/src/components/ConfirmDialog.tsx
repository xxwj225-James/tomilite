import { createPortal } from 'react-dom';

const I18N: Record<string, Record<string, string>> = {
  cancel: { en: 'Cancel', zh: '取消', ja: 'キャンセル', th: 'ยกเลิก', mi: 'Whakakore', ru: 'Отмена' },
  confirm: { en: 'Confirm', zh: '确认', ja: '確認', th: 'ยืนยัน', mi: 'Whakaū', ru: 'Подтвердить' },
  ok: { en: 'OK', zh: '确定', ja: 'OK', th: 'ตกลง', mi: 'Āe', ru: 'OK' },
};

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 999,
  background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const modal: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--edge)',
  borderRadius: 14, minWidth: 340, maxWidth: 440,
  boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
  padding: '24px 24px 20px',
  display: 'flex', flexDirection: 'column', gap: 12,
};
const titleStyle: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.3,
};
const msgStyle: React.CSSProperties = {
  fontSize: 13, color: 'var(--muted)', lineHeight: 1.6,
};
const btnRow: React.CSSProperties = {
  display: 'flex', gap: 10, marginTop: 6, justifyContent: 'flex-end',
};
const btnBase: React.CSSProperties = {
  borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', border: 'none', transition: 'all .15s',
};
const btnCancel: React.CSSProperties = {
  ...btnBase, background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--edge)',
};
const btnConfirm: React.CSSProperties = {
  ...btnBase, background: 'var(--brand)', color: '#fff',
};

export function ConfirmDialog({ open, title, message, onConfirm, onCancel, variant, lang = 'en', confirmLabel, cancelLabel, loading }: {
  open: boolean; title?: string; message: string;
  onConfirm: () => void; onCancel: () => void;
  variant?: 'confirm' | 'alert';
  lang?: string;
  confirmLabel?: React.ReactNode;
  cancelLabel?: string;
  loading?: boolean;
}) {
  if (!open) return null;
  const isAlert = variant === 'alert';
  const t = (key: string) => I18N[key]?.[lang] || I18N[key]?.en || key;
  const confirmText = confirmLabel || (isAlert ? t('ok') : t('confirm'));
  const cancelText = cancelLabel || t('cancel');
  return createPortal(
    <div style={overlay}
      onClick={loading ? undefined : (isAlert ? onConfirm : onCancel)}
      onKeyDown={loading ? undefined : (e => { if (e.key === 'Escape') onCancel(); })}
    >
      <div style={{ ...modal, ...(loading ? { alignItems: 'center', justifyContent: 'center', textAlign: 'center' } : {}) }} onClick={e => e.stopPropagation()}>
        {title ? <div style={titleStyle}>{title}</div> : null}
        <div style={{ ...msgStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 10 }}>{loading && <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid var(--edge)', borderTop: '2px solid var(--brand)', borderRadius: '50%', animation: 'tl-spin 0.6s linear infinite' }} />}{message}</div><style>{"@keyframes tl-spin { to { transform: rotate(360deg); } }"}</style>
        <div style={{ ...btnRow, ...(loading ? { justifyContent: 'center' } : {}) }}>
          {!isAlert && !loading && <button style={btnCancel} onClick={onCancel}>{cancelText}</button>}
          <button style={{ ...btnConfirm, opacity: loading ? 0.6 : 1, cursor: loading ? 'default' : 'pointer' }} onClick={loading ? undefined : onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
