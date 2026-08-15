import { useState, useEffect, useRef } from "react";
import { t } from "@/lib/i18n";
import { useLang } from "@/stores/useLang";

const PRESETS: Record<string, { imap: { host: string; port: string }; smtp: { host: string; port: string }; guide: { en: string[]; zh: string[]; ja: string[] } }> = {
  'QQ': {
    imap: { host: 'imap.qq.com', port: '993' }, smtp: { host: 'smtp.qq.com', port: '587' },
    guide: {
      en: ['Open mail.qq.com → Settings → Account', 'Enable "POP3/IMAP/SMTP service"', 'Click "Generate Authorization Code"', 'Copy the code and paste here'],
      zh: ['打开 mail.qq.com → 设置 → 账户', '开启 "POP3/IMAP/SMTP服务"', '点击 "生成授权码"', '复制授权码粘贴到这里'],
      ja: ['mail.qq.com → 設定 → アカウントを開く', '「POP3/IMAP/SMTPサービス」を有効化', '「認証コードを生成」をクリック', 'コードをコピーして貼り付け'],
    },
  },
  '163': {
    imap: { host: 'imap.163.com', port: '993' }, smtp: { host: 'smtp.163.com', port: '465' },
    guide: {
      en: ['Open mail.163.com → Settings → POP3/SMTP/IMAP', 'Enable "IMAP/SMTP service"', 'Click "Add Authorization Code"', 'Copy the code and paste here'],
      zh: ['打开 mail.163.com → 设置 → POP3/SMTP/IMAP', '开启 "IMAP/SMTP服务"', '点击 "新增授权码"', '复制授权码粘贴到这里'],
      ja: ['mail.163.com → 設定 → POP3/SMTP/IMAPを開く', '「IMAP/SMTPサービス」を有効化', '「認証コードを追加」をクリック', 'コードをコピーして貼り付け'],
    },
  },
  '126': {
    imap: { host: 'imap.126.com', port: '993' }, smtp: { host: 'smtp.126.com', port: '465' },
    guide: {
      en: ['Open mail.126.com → Settings → POP3/SMTP/IMAP', 'Enable "IMAP/SMTP service"', 'Click "Add Authorization Code"', 'Copy the code and paste here'],
      zh: ['打开 mail.126.com → 设置 → POP3/SMTP/IMAP', '开启 "IMAP/SMTP服务"', '点击 "新增授权码"', '复制授权码粘贴到这里'],
      ja: ['mail.126.com → 設定 → POP3/SMTP/IMAPを開く', '「IMAP/SMTPサービス」を有効化', '「認証コードを追加」をクリック', 'コードをコピーして貼り付け'],
    },
  },
  'Gmail': {
    imap: { host: 'imap.gmail.com', port: '993' }, smtp: { host: 'smtp.gmail.com', port: '587' },
    guide: {
      en: ['Open myaccount.google.com → Security', 'Enable "2-Step Verification" first', 'Search for "App Passwords"', 'Select "Mail" + "Windows Computer" → Generate', 'Copy the 16-char password and paste here'],
      zh: ['打开 myaccount.google.com → 安全', '先开启 "两步验证"', '搜索 "应用专用密码"', '选择 "邮件" + "Windows 计算机" → 生成', '复制 16 位密码粘贴到这里'],
      ja: ['myaccount.google.com → セキュリティを開く', 'まず「2段階認証」を有効化', '「アプリパスワード」を検索', '「メール」+「Windows パソコン」→ 生成', '16文字のパスワードをコピーして貼り付け'],
    },
  },
  'Outlook': {
    imap: { host: 'outlook.office365.com', port: '993' }, smtp: { host: 'smtp.office365.com', port: '587' },
    guide: {
      en: ['Open account.microsoft.com → Security', 'Enable "Two-step verification"', 'Go to "App passwords"', 'Create a new app password', 'Copy and paste here'],
      zh: ['打开 account.microsoft.com → 安全', '开启 "双重验证"', '进入 "应用密码"', '创建新的应用密码', '复制粘贴到这里'],
      ja: ['account.microsoft.com → セキュリティを開く', '「2段階認証」を有効化', '「アプリパスワード」へ', '新しいアプリパスワードを作成', 'コピーして貼り付け'],
    },
  },
};

const PROVIDER_COLORS: Record<string, string> = {
  QQ: '#12B7F5', '163': '#E53E3E', '126': '#DD4A48', Gmail: '#EA4335', Outlook: '#0078D4',
};

const ProviderLogo = ({ name, size = 24 }: { name: string; size?: number }) => {
  const s = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const env = <><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,8 12,14 22,8"/></>;
  switch (name) {
    case 'Gmail':
      return <svg {...s} viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8l10 7 10-7" stroke="#fff" fill="none"/><path d="M6 18l4-5M18 18l-4-5" stroke="#fff" fill="none"/></svg>;
    case 'Outlook':
      return <svg {...s} viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,8 12,14 22,8"/><circle cx="12" cy="12" r="3"/></svg>;
    case 'QQ':
      return <svg {...s} viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,8 12,14 22,8"/><path d="M9 16c0 2 1.5 3 3 3s3-1 3-3"/></svg>;
    case '163':
      return <svg {...s} viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,8 12,14 22,8"/><circle cx="10" cy="14" r="3"/></svg>;
    case '126':
      return <svg {...s} viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,8 12,14 22,8"/><line x1="8" y1="12" x2="16" y2="16"/></svg>;
    default:
      return <svg {...s} viewBox="0 0 24 24">{env}</svg>;
  }
};

export function EmailTab() {
  const lang = useLang();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [fromName, setFromName] = useState('TomiLite');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [pollSeconds, setPollSeconds] = useState('60');
  const [provider, setProvider] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [imapError, setImapError] = useState('');
  const connectingRef = useRef(false);
  const initialConfigRef = useRef<{ email: string; pass: string; imap: string; smtp: string; fromName: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/email.getConfig', { signal: ac.signal }).then(r => r.json()).then(d => {
      if (!mountedRef.current) return;
      const cfgs = d.result?.data || [];
      const imap = cfgs.find((c: any) => c.type === 'imap');
      const smtp = cfgs.find((c: any) => c.type === 'smtp');
      try {
        let loadedEmail = '', loadedPass = '', loadedImap = '', loadedSmtp = '', loadedFrom = 'TomiLite';
        if (imap?.config) { const c = JSON.parse(imap.config); if (c.host) { setImapHost(c.host); loadedImap = c.host + ':' + (c.port || '993'); } if (c.port) setImapPort(String(c.port)); if (c.user) { setEmail(c.user); loadedEmail = c.user; } if (c.password) { setPass(c.password); loadedPass = c.password; } if (c.pollIntervalSeconds) setPollSeconds(String(c.pollIntervalSeconds)); }
        if (smtp?.config) { const c = JSON.parse(smtp.config); if (c.host) { setSmtpHost(c.host); loadedSmtp = c.host + ':' + (c.port || '465'); } if (c.port) setSmtpPort(String(c.port)); if (c.user && !loadedEmail) { setEmail(c.user); loadedEmail = c.user; } if ((c.pass || c.password) && !loadedPass) { setPass(c.pass || c.password); loadedPass = c.pass || c.password; } if (c.fromName) { setFromName(c.fromName); loadedFrom = c.fromName; } }
        const curImap = loadedImap.split(':')[0];
        const curSmtp = loadedSmtp.split(':')[0];
        for (const [name, p] of Object.entries(PRESETS)) {
          if (p.imap.host === curImap && p.smtp.host === curSmtp) { setProvider(name); break; }
        }
        if (!initialConfigRef.current) {
          initialConfigRef.current = { email: loadedEmail, pass: loadedPass, imap: loadedImap, smtp: loadedSmtp, fromName: loadedFrom };
        }
      } catch {}
    }).catch(() => {});
    fetch('/api/email.imapStatus', { signal: ac.signal }).then(r => r.json()).then(d => {
      if (mountedRef.current) setConnected(Object.values(d.result?.data || {}).some((x: any) => x.connected));
    }).catch(() => {});
    fetch('/api/system.getConfig?input=' + encodeURIComponent(JSON.stringify({key:'imapLastError'})), { signal: ac.signal }).then(r => r.json()).then(d => {
      if (mountedRef.current && d.result?.data) setImapError(d.result.data);
    }).catch(() => {});
    return () => ac.abort();
  }, []);

  const selectProvider = (name: string) => {
    const p = PRESETS[name];
    if (!p) return;
    setProvider(name);
    setImapHost(p.imap.host); setImapPort(p.imap.port);
    setSmtpHost(p.smtp.host); setSmtpPort(p.smtp.port);
    setStatus('');
  };

  const handleSaveAndConnect = async () => {
    if (!email.trim() || !pass.trim() || (!imapHost.trim() && !smtpHost.trim())) return;
    setSaving(true);
    if (smtpHost.trim()) {
      setStatus(t('emailTab.testingSmtp', lang));
      try {
        const tr = await fetch('/api/email.testSmtp', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: smtpHost.trim(), port: parseInt(smtpPort), user: email.trim(), pass: pass.trim(), starttls: smtpPort !== '465' }),
        });
        const td = await tr.json();
        if (!td.result?.data?.ok) { setStatus(t('emailTab.smtpFailed', lang) + (td.result?.data?.error || t('emailTab.checkSettings', lang))); setSaving(false); return; }
      } catch { setStatus(t('emailTab.smtpConnFailed', lang)); setSaving(false); return; }
    }
    setStatus(t('emailTab.saving', lang));
    try {
      if (imapHost.trim()) {
        await fetch('/api/email.saveIMAP', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: imapHost.trim(), port: parseInt(imapPort), user: email.trim(), password: pass.trim(), tls: imapPort === '993', mailbox: 'INBOX', pollIntervalSeconds: parseInt(pollSeconds) || 60 }),
        });
      }
      if (smtpHost.trim()) {
        await fetch('/api/email.saveConfig', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'smtp', config: JSON.stringify({ host: smtpHost.trim(), port: parseInt(smtpPort), user: email.trim(), pass: pass.trim(), starttls: smtpPort !== '465', fromName: fromName.trim() || 'TomiLite' }) }),
        });
      }
    } catch { setStatus(t('emailTab.saveFailed', lang)); setSaving(false); return; }
    const prev = initialConfigRef.current;
    const curImap = imapHost.trim() ? `${imapHost.trim()}:${imapPort}` : '';
    const curSmtp = smtpHost.trim() ? `${smtpHost.trim()}:${smtpPort}` : '';
    const configChanged = !prev
      || prev.email !== email.trim()
      || prev.pass !== pass.trim()
      || prev.imap !== curImap
      || prev.smtp !== curSmtp
      || prev.fromName !== fromName.trim();
    if (configChanged) {
      initialConfigRef.current = { email: email.trim(), pass: pass.trim(), imap: curImap, smtp: curSmtp, fromName: fromName.trim() };
    }
    setSaving(false);
    if (!connectingRef.current) {
      connectingRef.current = true;
      setStatus(t('emailTab.connecting', lang));
      fetch('/api/email.connectIMAP', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .then(r => r.json())
        .then(d => {
          if (!mountedRef.current) return;
          if (d.result?.data?.ok) { setConnected(true); setStatus(t('emailTab.connectedOk', lang)); }
          else { setStatus(`❌ ${d.result?.data?.error || t('emailTab.imapConnectFailed', lang)}`); }
        })
        .catch((e) => { if (mountedRef.current) setStatus(`❌ ${e?.message || t('emailTab.networkError', lang)}`); })
        .finally(() => { connectingRef.current = false; });
    }
  };

  const handleDisconnect = async () => {
    setSaving(true); setStatus(t('emailTab.disconnecting', lang));
    try {
      await fetch('/api/email.disconnectIMAP', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      setStatus(t('emailTab.disconnected', lang)); setConnected(false);
    } catch { setStatus(t('emailTab.saveFailed', lang)); }
    setSaving(false);
  };

  const guide = provider ? PRESETS[provider]?.guide : null;

  return (
    <div className="card">
      <div className="card-hd" style={{justifyContent:'flex-start',gap:8}}>
        <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L13.5 11.5a2 2 0 01-2.27.07L11 11.5 2 4"/></svg>
          {t('settings.email', lang)}
        </span>
        {connected && <span style={{fontSize:10,color:'var(--green)',fontWeight:600,marginLeft:4,border:'1px solid var(--green)',borderRadius:10,padding:'1px 8px'}}>{t('emailTab.connected', lang)}</span>}
      </div>
      <div className="card-bd">
        {/* ─── Provider cards ─── */}
        <div style={{marginBottom:12}}>
          <p style={{fontSize:11,color:'var(--muted)',marginBottom:6,fontWeight:500}}>{t('emailTab.chooseProvider', lang)}</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:4}}>
            {Object.keys(PRESETS).map(name => (
              <button key={name} onClick={() => selectProvider(name)}
                style={{
                  padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: provider === name ? '1.5px solid var(--brand)' : '1.5px solid var(--edge)',
                  background: provider === name ? 'var(--brand-soft)' : 'var(--surface2)', transition: 'all var(--transition-fast)',
                  display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
                }}>
                <span style={{width:28,height:28,borderRadius:7,background:PROVIDER_COLORS[name],display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><ProviderLogo name={name} size={16} /></span>
                <span style={{fontSize:10,fontWeight:600,color:'var(--ink)'}}>{name}</span>
              </button>
            ))}
            <button onClick={() => { setProvider(''); setShowAdvanced(true); }}
              style={{
                padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: !provider ? '1.5px solid var(--brand)' : '1.5px solid var(--edge)',
                background: !provider ? 'var(--brand-soft)' : 'var(--surface2)', transition: 'all var(--transition-fast)',
                display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
              }}>
              <span style={{width:28,height:28,borderRadius:7,background:'var(--muted)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:600,flexShrink:0}}>+</span>
              <span style={{fontSize:10,fontWeight:600,color:'var(--ink)'}}>{t('emailTab.custom', lang)}</span>
            </button>
          </div>
        </div>

        {/* ─── Basic fields ─── */}
        <div className="form-grp">
          <label className="form-label">{t('emailTab.emailAddress', lang)}</label>
          <input className="form-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="form-grp">
          <label className="form-label">{t('emailTab.passwordAuthCode', lang)}</label>
          <input className="form-input" type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder={t('emailTab.appPasswordHint', lang)} />
          {/* ─── Auth code guide ─── */}
          {guide && (
            <div style={{marginTop:6,padding:'8px 12px',background:'var(--surface2)',borderRadius:'var(--radius-sm)',fontSize:10,color:'var(--muted)',lineHeight:1.7}}>
              <p style={{fontWeight:600,color:'var(--amber)',marginBottom:4}}>🔑 {t('emailTab.howToGetAuthCode', lang).replace('{provider}', provider)}</p>
              <ol style={{paddingLeft:16,margin:0}}>
                {(guide[lang as keyof typeof guide] || guide.en).map((step, i) => <li key={i}>{step}</li>)}
              </ol>
            </div>
          )}
        </div>
        <div className="form-grp">
          <label className="form-label">{t('emailTab.fromName', lang)}</label>
          <input className="form-input" value={fromName} onChange={e => setFromName(e.target.value)} placeholder="TomiLite" />
        </div>

        {/* ─── Advanced toggle ─── */}
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          style={{background:'none',border:'none',fontSize:11,color:'var(--ink)',cursor:'pointer',padding:'4px 0',display:'flex',alignItems:'center',gap:4,fontFamily:'inherit',fontWeight:500}}>
          <span style={{transform:showAdvanced?'rotate(90deg)':'rotate(0deg)',transition:'transform .15s',fontSize:9}}>▸</span>
          {t('emailTab.advancedSettings', lang)}
        </button>
        {showAdvanced && (
          <div style={{display:'flex',gap:8,marginTop:4}}>
            <div className="form-grp" style={{flex:1}}>
              <label className="form-label">IMAP ({t('emailTab.incoming', lang)})</label>
              <input className="form-input" style={{fontSize:11}} value={imapHost ? `${imapHost}:${imapPort}` : ''} onChange={e => { const [h, p] = e.target.value.split(':'); setImapHost(h || ''); setImapPort(p || '993'); }} placeholder="imap.example.com:993" />
            </div>
            <div className="form-grp" style={{flex:'0 0 auto',minWidth:70}}>
              <label className="form-label" style={{whiteSpace:'nowrap'}}>{t('emailTab.pollSeconds', lang)}</label>
              <input className="form-input" style={{fontSize:11,textAlign:'center',width:60}} value={pollSeconds} onChange={e => setPollSeconds(e.target.value.replace(/\D/g, ''))} placeholder="60" />
            </div>
            <div className="form-grp" style={{flex:1}}>
              <label className="form-label">SMTP ({t('emailTab.outgoing', lang)})</label>
              <input className="form-input" style={{fontSize:11}} value={smtpHost ? `${smtpHost}:${smtpPort}` : ''} onChange={e => { const [h, p] = e.target.value.split(':'); setSmtpHost(h || ''); setSmtpPort(p || '465'); }} placeholder="smtp.example.com:465" />
            </div>
          </div>
        )}

        {/* ─── Status & Actions ─── */}
        {status && <p style={{fontSize:11,margin:'8px 0 4px',color:status.includes('✅')?'var(--green)':status.includes('❌')?'var(--red)':'var(--muted)'}}>{status}</p>}
        {imapError && <p style={{fontSize:10,margin:'4px 0',color:'var(--red)'}}>❌ IMAP: {imapError}</p>}
        <div style={{display:'flex',gap:8,alignItems:'center',justifyContent:'flex-end',marginTop:8}}>
          <button className="btn btn-brand btn-sm" onClick={connected ? handleDisconnect : handleSaveAndConnect} disabled={saving || !email.trim() || !pass.trim()}>
            {saving ? t('emailTab.saving', lang) : connected ? t('emailTab.disconnect', lang) : t('emailTab.saveAndConnect', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
