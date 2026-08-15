import { useState } from 'react';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { ConfirmDialog } from '@tomilite/shared-ui/components/ConfirmDialog';

export function FeedbackPanel() {
  const lang = useLang();
  const [type, setType] = useState('bug');
  const [title, setTitle2] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message: string } | null>(null);

  const ISSUES_URL = 'https://github.com/xxwj225-James/tomilite/issues/new';

  const submit = async () => {
    if (!title.trim() || !body.trim()) return;
    // Open a pre-filled GitHub Issue in the browser
    const issueBody = `**Type:** ${type}\n**Contact:** ${email.trim() || '(not provided)'}\n\n${body.trim()}`;
    const params = new URLSearchParams({
      title: `[${type}] ${title.trim()}`,
      body: issueBody,
    });
    try {
      const ea = (window as any).electronAPI;
      if (ea?.openExternal) {
        await ea.openExternal(`${ISSUES_URL}?${params.toString()}`);
      } else {
        window.open(`${ISSUES_URL}?${params.toString()}`, '_blank');
      }
      setSent(true);
      setTitle2(''); setBody(''); setEmail('');
    } catch {
      setDialog({ title: t('misc.error', lang), message: t('feedback.sendFailed', lang) });
    }
  };

  if (sent) {
    return (
      <div style={{ padding: 20 }}>
        <div className="card" style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('feedback.thankYou', lang)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('feedback.sentTo', lang)}</div>
          <button className="btn btn-brand btn-sm" style={{ marginTop: 14 }} onClick={() => setSent(false)}>{t('btn.submitNewFeedback', lang)}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14, height: '100%', overflow: 'auto', paddingBottom: 80 }}>
      <div className="card">
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--edge)', fontSize: 13, fontWeight: 700 }}>{t('feedback.title', lang)}</div>
        <div style={{ padding: 14 }}>
          <div className="form-grp">
            <label className="form-label">{t('feedback.type', lang)}</label>
            <select className="form-select" value={type} onChange={e => setType(e.target.value)}>
              <option value="bug">{t('feedback.bugReport', lang)}</option>
              <option value="feature">{t('feedback.featureRequest', lang)}</option>
              <option value="general">{t('feedback.otherFeedback', lang)}</option>
            </select>
          </div>
          <div className="form-grp">
            <label className="form-label">{t('feedback.titleLabel', lang)}</label>
            <input className="form-input" placeholder={t('feedback.titlePlaceholder', lang)} value={title} onChange={e => setTitle2(e.target.value)} />
          </div>
          <div className="form-grp">
            <label className="form-label">{t('feedback.bodyLabel', lang)}</label>
            <textarea className="form-textarea" style={{ minHeight: 100 }} placeholder={t('feedback.bodyPlaceholder', lang)} value={body} onChange={e => setBody(e.target.value)} />
          </div>
          <div className="form-grp">
            <label className="form-label">{t('feedback.contact', lang)}</label>
            <input className="form-input" placeholder={t('feedback.contactPlaceholder', lang)} value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button className="btn btn-brand btn-sm" disabled={sending || !title.trim() || !body.trim()} onClick={submit}>
              {sending ? t('feedback.submitting', lang) : (
                <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  {t('feedback.submit', lang)}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>{t('feedback.footer', lang)}</div>

      <ConfirmDialog
        open={!!dialog}
        variant="alert"
        title={dialog?.title || ''}
        message={dialog?.message || ''}
        onConfirm={() => setDialog(null)}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
