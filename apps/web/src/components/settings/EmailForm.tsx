import { useState, useEffect } from 'react';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';

interface Props {
  onSave?: (config: Record<string, unknown>) => void;
  standalone?: boolean;
}

const SMTP_PRESETS = [
  { name: 'Gmail', host: 'smtp.gmail.com', port: '587', tls: true },
  { name: 'Outlook', host: 'smtp.office365.com', port: '587', tls: true },
  { name: 'QQ Mail', host: 'smtp.qq.com', port: '587', tls: true },
  { name: '163 Mail', host: 'smtp.163.com', port: '465', tls: false },
];

export function EmailForm({ onSave, standalone = false }: Props) {
  const lang = useLang();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState('TomiLite');
  const [tls, setTls] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/email.getConfig').then(r => r.json()).then(d => {
      const cfgs = d.result?.data || [];
      const smtp = cfgs.find((c: any) => c.type === 'smtp');
      if (smtp?.config) {
        try {
          const c = JSON.parse(smtp.config);
          if (c.host) setHost(c.host);
          if (c.port) setPort(String(c.port));
          if (c.user) setUser(c.user);
          if (c.pass || c.password) setPass(c.pass || c.password);
          if (c.starttls !== undefined) setTls(c.starttls);
          if (c.fromName) setFrom(c.fromName);
        } catch {}
      }
    }).catch(() => {});
  }, []);

  const saveConfig = () => ({ host: host.trim(), port: parseInt(port), user: user.trim(), pass, starttls: tls, fromName: from.trim() });

  const testConn = async () => {
    setTesting(true); setTestMsg('');
    try {
      const r = await fetch('/api/email.testSmtp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host.trim(), port: parseInt(port), user: user.trim(), pass, starttls: tls }),
      });
      const data = await r.json();
      setTestMsg(data.result?.data?.ok ? t('emailForm.connected', lang) : t('emailForm.failed', lang));
    } catch { setTestMsg(t('emailForm.failed', lang)); }
    setTesting(false);
  };

  const handleSave = async () => {
    if (!host.trim()) return;
    setSaving(true); setTestMsg('');
    try {
      const r = await fetch('/api/email.testSmtp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: host.trim(), port: parseInt(port), user: user.trim(), pass, starttls: tls }) });
      const data = await r.json();
      if (!data.result?.data?.ok) { setTestMsg(t('emailForm.connFailed', lang)); setSaving(false); return; }
      setTestMsg(t('emailForm.connected', lang));
    } catch { setTestMsg(t('emailForm.failed', lang)); setSaving(false); return; }
    await fetch('/api/email.saveConfig', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'smtp', config: JSON.stringify(saveConfig()) }) });
    setSaving(false);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    onSave?.(saveConfig());
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {SMTP_PRESETS.map(p => (
          <button key={p.name} className="btn btn-xs" style={{ background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--edge)' }}
            onClick={() => { setHost(p.host); setPort(p.port); setTls(p.tls); }}>{p.name}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="form-grp" style={{ flex: 2 }}><label className="form-label">{t('emailForm.smtpHost', lang)}</label><input className="form-input" value={host} onChange={e => setHost(e.target.value)} placeholder="smtp.gmail.com" /></div>
        <div className="form-grp" style={{ flex: 1 }}><label className="form-label">{t('emailForm.port', lang)}</label><input className="form-input" value={port} onChange={e => setPort(e.target.value)} placeholder="587" /></div>
      </div>
      <div className="form-grp"><label className="form-label">{t('emailForm.email', lang)}</label><input className="form-input" value={user} onChange={e => setUser(e.target.value)} placeholder="you@gmail.com" /></div>
      <div className="form-grp"><label className="form-label">{t('emailForm.password', lang)}</label><input className="form-input" type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder={t('emailTab.appPasswordHint', lang)} /></div>
      <div className="form-grp"><label className="form-label">{t('emailForm.fromName', lang)}</label><input className="form-input" value={from} onChange={e => setFrom(e.target.value)} placeholder="TomiLite" /></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 8 }}>
        <input type="checkbox" checked={tls} onChange={e => setTls(e.target.checked)} /> {t('emailForm.useStarttls', lang)}
      </label>
      {testMsg && <p style={{ fontSize: 12, marginBottom: 6, color: testMsg.includes('✅') ? 'var(--green)' : 'var(--brand)' }}>{testMsg}</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" style={{ background: 'var(--brand)', color: '#fff', border: 'none' }} onClick={testConn} disabled={testing || !host.trim()}>{testing ? t('emailForm.testing', lang) : t('emailForm.testConnection', lang)}</button>
        {standalone && <button className="btn btn-brand btn-sm" onClick={handleSave} disabled={saving}>{saving ? t('emailForm.testing', lang) : saved ? t('emailForm.saved', lang) : t('emailForm.saveChanges', lang)}</button>}
      </div>
    </div>
  );
}
