import { useState, useEffect, useRef } from 'react';
import { tr, t as tt2 } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { ConfirmDialog } from '@tomatolite/shared-ui/components/ConfirmDialog';

export function McpPanel() {
  const lang = useLang();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const si: Record<string,string> = { executed:'✓', approved:'✓', denied:'✗', expired:'⏰', pending:'⏳' };
  const sb: Record<string,string> = { executed:'rgba(34,197,94,.12)', approved:'rgba(34,197,94,.12)', denied:'rgba(239,68,68,.12)', expired:'rgba(136,136,136,.12)', pending:'rgba(245,158,11,.15)' };
  const sc: Record<string,string> = { executed:'var(--green)', approved:'var(--green)', denied:'var(--red)', expired:'var(--muted)', pending:'var(--amber)' };

  const fetchData = () => {
    fetch('/api/mcp.listAuditLogs?input=%7B%22limit%22%3A100%7D').then(r => r.json()).then(d => { setLogs(d.result?.data||[]); setLoading(false); }).catch(()=>setLoading(false));
  };
  useEffect(()=>{ fetchData(); const iv=setInterval(fetchData,10000); return ()=>clearInterval(iv); },[]);

  const [actionResult, setActionResult] = useState('');
  const approve = async (item: any) => {
    const taskId = item._taskId || item.id;
    const r = await fetch('/api/mcp.confirmById',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId})});
    const d = await r.json().catch(() => ({}));
    setActionResult(d.result?.data?.error ? `❌ ${d.result.data.error}` : d.result?.data?.ok ? tt2('mcp.approved', lang) : tt2('mcp.actionFailed', lang));
    fetchData();
    setTimeout(() => setActionResult(''), 3000);
  };
  const deny = async (item: any) => {
    const taskId = item._taskId || item.id;
    const r = await fetch('/api/mcp.deny',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId,reason:'Denied by user'})});
    const d = await r.json().catch(() => ({}));
    setActionResult(d.result?.data?.error ? `❌ ${d.result.data.error}` : tt2('mcp.denied', lang));
    fetchData();
    setTimeout(() => setActionResult(''), 3000);
  };

  const filtered = logs.filter((l:any) => {
    if (statusFilter!=='All' && l.status!==statusFilter) return false;
    if (search && !(l.toolName||'').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      {actionResult && <div style={{padding:'6px 12px',margin:'4px 0',borderRadius:6,fontSize:12,background:actionResult.includes('✅')?'rgba(34,197,94,.12)':actionResult.includes('❌')?'rgba(239,68,68,.12)':'var(--surface2)',color:actionResult.includes('✅')?'var(--green)':actionResult.includes('❌')?'var(--brand)':'var(--ink)'}}>{actionResult}</div>}
      <div style={{display:'flex',gap:6,margin:'6px 0'}}>
        <input className="form-input" placeholder={tt2('mcp.searchPlaceholder', lang)} style={{flex:1,maxWidth:180}} value={search} onChange={e=>setSearch(e.target.value)} />
        <select className="form-select" style={{width:'auto'}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="All">{tt2('mcp.filterAll', lang)}</option><option value="pending">{tt2('mcp.filterPending', lang)}</option><option value="approved">{tt2('mcp.filterApproved', lang)}</option><option value="executed">{tt2('mcp.filterExecuted', lang)}</option><option value="denied">{tt2('mcp.filterDenied', lang)}</option>
        </select>
        <span style={{flex:1}}/>
        <span className="text-ink-muted" style={{fontSize:10,alignSelf:'center'}}>{filtered.length} {tt2('mcp.entries', lang)}</span>
      </div>
      {loading ? <div className="text-ink-muted text-sm" style={{padding:20,textAlign:'center'}}>{tt2('mcp.loading', lang)}</div>
      : filtered.length===0 ? <div className="text-ink-muted text-sm" style={{padding:20,textAlign:'center'}}>{tt2('mcp.empty', lang)}</div>
      : filtered.map((item:any) => {
        const isPending = item.status==='pending';
        return (
          <div key={item.id} style={{padding:'10px 14px',borderBottom:'1px solid var(--edge)',borderLeft:isPending?'3px solid var(--amber)':'3px solid transparent',background:isPending?'rgba(245,158,11,.04)':'transparent'}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
              <span style={{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0,background:sb[item.status]||'var(--surface2)',color:sc[item.status]||'var(--muted)'}}>{si[item.status]||'?'}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600}}>{item.agentName || tt2('mcp.external', lang)} → <span style={{fontWeight:400}}>{item.toolName}</span></div>
                <div className="text-ink-muted" style={{fontSize:10,marginTop:2}}>{item.arguments?.substring(0,100)}</div>
                {isPending && <div style={{display:'flex',gap:6,marginTop:6}}><button className="btn btn-brand btn-xs" onClick={()=>approve(item)}>{tt2('mcp.approve', lang)}</button><button className="btn-ghost btn-xs" style={{color:'var(--brand)'}} onClick={()=>deny(item)}>{tt2('mcp.deny', lang)}</button></div>}
                {!isPending && item.result && <div className="text-ink-muted" style={{fontSize:9,marginTop:2}}>{tt2('mcp.result', lang)} {item.result?.substring(0,80)}</div>}
              </div>
              <span className="text-ink-muted" style={{fontSize:9,whiteSpace:'nowrap'}}>{item.createdAt?.substring(0,19)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══ API Key Tab ═══
function ApiKeyTab({ lang = 'en' }: { lang?: string }) {
  const [keys, setKeys] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [hitlMode, setHitlMode] = useState('manual');
  const [genResult, setGenResult] = useState<string | null>(null);
  const fetchKeys = () => { fetch('/api/apikey.list').then(r => r.json()).then(d => setKeys(d.result?.data || [])).catch(() => {}); };
  useEffect(() => { fetchKeys(); }, []);

  const generate = async () => {
    if (!newName.trim()) return;
    const resp = await fetch('/api/apikey.generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), hitlMode, expiresDays: 90 }),
    });
    const json = await resp.json();
    setGenResult(json.result?.data?.key || '');
    setNewName('');
    fetchKeys();
  };

  return (
    <div>
      <div className="card"><div className="card-hd">{tr(lang,'生成 API 密钥','Generate API Key','Generate API Key','Generate API Key','Generate API Key','Generate API Key')}</div><div className="card-bd">
        <div className="form-grp">
          <label className="form-label">{tr(lang,'密钥名称','Key Name','Key Name','Key Name','Key Name','Key Name')}</label>
          <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder={lang === 'zh' ? '例如: cursor-mcp' : lang === 'ja' ? '例: cursor-mcp' : 'e.g. cursor-mcp'} />
        </div>
        <div className="form-grp">
          <label className="form-label">HITL {tr(lang,'模式','Mode','Mode','Mode','Mode','Mode')}</label>
          <select className="form-select" value={hitlMode} onChange={e => setHitlMode(e.target.value)}>
            <option value="manual">{tr(lang,'手动（读取以外需确认）','Manual (all writes require confirmation)','Manual (all writes require confirmation)','Manual (all writes require confirmation)','Manual (all writes require confirmation)','Manual (all writes require confirmation)')}</option>
            <option value="auto">{tr(lang,'自动（自动批准所有操作）','Auto (auto-approve all operations)','Auto (auto-approve all operations)','Auto (auto-approve all operations)','Auto (auto-approve all operations)','Auto (auto-approve all operations)')}</option>
          </select>
        </div>
        <button className="btn btn-brand btn-sm" onClick={generate} disabled={!newName.trim()}>{tr(lang,'生成密钥','Generate Key','Generate Key','Generate Key','Generate Key','Generate Key')}</button>
        <div className="text-xs text-ink-muted mt-3" style={{ lineHeight: 1.6 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>{tr(lang,'使用方法','Usage','Usage','Usage','Usage','Usage')}</p>
          <p className="mt-1"><strong>{tr(lang,'Claude Code 配置','Claude Code Setup','Claude Code Setup','Claude Code Setup','Claude Code Setup','Claude Code Setup')}</strong></p>
          <p>{tr(lang,'将以下内容添加到项目根目录的 .claude/mcp.json：','Add this to .claude/mcp.json in your project root:','Add this to .claude/mcp.json in your project root:','Add this to .claude/mcp.json in your project root:','Add this to .claude/mcp.json in your project root:','Add this to .claude/mcp.json in your project root:')}</p>
          <pre style={{ background: 'var(--bg)', padding: '6px 10px', borderRadius: 4, fontSize: 9, marginTop: 2, overflow: 'auto', color: 'var(--muted)' }}>{`{
  "mcpServers": {
    "tomiLite": {
      "type": "http",
      "url": "http://localhost:${window.location.port || '3192'}/api/mcp.execute",
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "api_key": "tl_xxxxxxxxxxxx"
      }
    }
  }
}`}</pre>
          <p className="mt-1">{tr(lang,'将 tl_xxxxxxxxxxxx 替换为下方生成的完整密钥。api_key 字段为必填。','Replace tl_xxxxxxxxxxxx with the full key generated below. The api_key field is required.','Replace tl_xxxxxxxxxxxx with the full key generated below. The api_key field is required.','Replace tl_xxxxxxxxxxxx with the full key generated below. The api_key field is required.','Replace tl_xxxxxxxxxxxx with the full key generated below. The api_key field is required.','Replace tl_xxxxxxxxxxxx with the full key generated below. The api_key field is required.')}</p>
          <p className="mt-1"><strong>{tr(lang,'请求格式','Request Format','Request Format','Request Format','Request Format','Request Format')}</strong></p>
          <pre style={{ background: 'var(--bg)', padding: '6px 10px', borderRadius: 4, fontSize: 9, marginTop: 2, overflow: 'auto', color: 'var(--muted)' }}>{`POST http://localhost:${window.location.port || '3192'}/api/mcp.execute
Content-Type: application/json

{
  "tool": "create_note",
  "arguments": { "title": "...", "content": "..." },
  "api_key": "tl_xxxxxxxxxxxx"
}`}</pre>
          <p className="mt-1">{tr(lang,'tool 支持: create_note, update_note, create_issue, update_issue, list_issues, create_report, update_report, delete_issue, search_notes, list_notes, get_report, get_project_stats, get_focus_status。使用 tools/list 查看完整列表。','Supported tools: create_note, update_note, create_issue, update_issue, list_issues, create_report, update_report, delete_issue, search_notes, list_notes, get_report, get_project_stats, get_focus_status. Use tools/list for the full list.','Supported tools: create_note, update_note, create_issue, update_issue, list_issues, create_report, update_report, delete_issue, search_notes, list_notes, get_report, get_project_stats, get_focus_status. Use tools/list for the full list.','Supported tools: create_note, update_note, create_issue, update_issue, list_issues, create_report, update_report, delete_issue, search_notes, list_notes, get_report, get_project_stats, get_focus_status. Use tools/list for the full list.','Supported tools: create_note, update_note, create_issue, update_issue, list_issues, create_report, update_report, delete_issue, search_notes, list_notes, get_report, get_project_stats, get_focus_status. Use tools/list for the full list.','Supported tools: create_note, update_note, create_issue, update_issue, list_issues, create_report, update_report, delete_issue, search_notes, list_notes, get_report, get_project_stats, get_focus_status. Use tools/list for the full list.')}</p>
          <p className="mt-1"><strong>HITL {tr(lang,'模式','Mode','Mode','Mode','Mode','Mode')}</strong></p>
          <p>{tr(lang,'• <strong>手动</strong> — 写操作需在本应用 MCP审批 面板中人工批准','• <strong>Manual</strong> — writes require human approval in the MCP Approve panel','• <strong>Manual</strong> — writes require human approval in the MCP Approve panel','• <strong>Manual</strong> — writes require human approval in the MCP Approve panel','• <strong>Manual</strong> — writes require human approval in the MCP Approve panel','• <strong>Manual</strong> — writes require human approval in the MCP Approve panel')}</p>
          <p>{tr(lang,'• <strong>自动</strong> — 所有操作自动执行（适用于受信任的本地工具）','• <strong>Auto</strong> — all operations auto-executed (for trusted local tools)','• <strong>Auto</strong> — all operations auto-executed (for trusted local tools)','• <strong>Auto</strong> — all operations auto-executed (for trusted local tools)','• <strong>Auto</strong> — all operations auto-executed (for trusted local tools)','• <strong>Auto</strong> — all operations auto-executed (for trusted local tools)')}</p>
          <p className="mt-1">{tr(lang,'密钥存储前经 SHA-256 哈希处理，原始密钥仅显示一次。','Keys are SHA-256 hashed before storage. Raw key shown only once.','Keys are SHA-256 hashed before storage. Raw key shown only once.','Keys are SHA-256 hashed before storage. Raw key shown only once.','Keys are SHA-256 hashed before storage. Raw key shown only once.','Keys are SHA-256 hashed before storage. Raw key shown only once.')}</p>
        </div>
        {genResult && (
          <div className="mt-3" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: 12 }}>
            <div className="text-xs text-green mb-1">{lang === 'zh' ? '✅ 密钥已生成 — 立即复制，不会再次显示：' : lang === 'ja' ? '✅ キーを生成しました — 今すぐコピーしてください。再表示されません：' : "✅ Key generated — copy now, won't be shown again:"}</div>
            <code className="text-sm text-ink-primary" style={{ wordBreak: 'break-all' }}>{genResult}</code>
          </div>
        )}
      </div></div>

      <div className="card"><div className="card-hd">{tr(lang,'API 密钥','API Keys','API Keys','API Keys','API Keys','API Keys')} <span className="text-ink-muted">{keys.length}</span></div>
        <div>
          {keys.map((k: any) => (
            <div key={k.id} className="list-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{k.name}</div>
                <div className="text-ink-muted">{k.scopes} · {k.hitlMode} · used {k.useCount}x</div>
                <div className="text-ink-muted" style={{ fontSize: 9 }}>Created {k.createdAt?.substring(0,10)} · Expires {k.expiresAt?.substring(0,10)}</div>
              </div>
              <button className="btn-ghost btn-xs" style={{ color: 'var(--brand)' }} onClick={() => { fetch(`/api/apikey.revoke?id=${k.id}`, { method: 'POST' }).then(fetchKeys); }}>{tr(lang,'撤销','廃棄','Revoke','Revoke','Revoke','Revoke')}</button>
            </div>
          ))}
          {keys.length === 0 && <div className="text-ink-muted text-sm" style={{ padding: 12, textAlign: 'center' }}>{tr(lang,'暂无 API 密钥。','No API keys yet.','No API keys yet.','No API keys yet.','No API keys yet.','No API keys yet.')}</div>}
        </div>
      </div>
    </div>
  );
}

// ═══ Email Tab ═══
function EmailTab({ lang }: { lang: string }) {
  const t = (key: string) => ({ en: { email: 'Email', authCode: 'Password / Auth Code', authCodeHint: '163/QQ: use Auth Code. Gmail/Outlook: use App Password.', fromName: 'From Name', imap: 'IMAP (Incoming)', smtp: 'SMTP (Outgoing)', saveConnect: 'Save & Connect', disconnect: 'Disconnect', testing: 'Testing...', testingSmtp: 'Testing SMTP...', saving: 'Saving...', connecting: 'Connecting IMAP...', connected: '✅ Connected', saved: '✅ Saved', savedButImap: '⚠️ Saved but IMAP:', smtpFail: '❌ SMTP failed', smtpConnFail: '❌ SMTP connection failed', saveFail: '❌ Save failed', disconnectOk: 'Disconnected', disconnecting: 'Disconnecting...', placeholder: 'you@example.com', passPlaceholder: 'Email password / auth code', imapPlaceholder: 'imap.163.com:993', smtpPlaceholder: 'smtp.163.com:465', fromPlaceholder: 'TomiLite' }, zh: { email: '邮箱', authCode: '密码 / 授权码', authCodeHint: '163/QQ邮箱使用授权码，Gmail/Outlook使用应用专用密码。', fromName: '发件人名称', imap: 'IMAP（收件）', smtp: 'SMTP（发件）', saveConnect: '保存并连接', disconnect: '断开连接', testing: '测试中...', testingSmtp: '正在测试 SMTP...', saving: '保存中...', connecting: '正在连接 IMAP...', connected: '✅ 已连接', saved: '✅ 已保存', savedButImap: '⚠️ 已保存但 IMAP:', smtpFail: '❌ SMTP 连接失败', smtpConnFail: '❌ SMTP 连接失败', saveFail: '❌ 保存失败', disconnectOk: '已断开', disconnecting: '断开中...', placeholder: 'you@example.com', passPlaceholder: '邮箱密码或授权码', imapPlaceholder: 'imap.163.com:993', smtpPlaceholder: 'smtp.163.com:465', fromPlaceholder: 'TomiLite' } } as Record<string, Record<string, string>>)[lang]?.[key] || key;

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [fromName, setFromName] = useState('TomiLite');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [pollSeconds, setPollSeconds] = useState('60');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [imapError, setImapError] = useState('');
  const connectingRef = useRef(false); // guard against duplicate connectIMAP
  const initialConfigRef = useRef<{ email: string; pass: string; imap: string; smtp: string; fromName: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const PRESETS: Record<string, { imap: { host: string; port: string }; smtp: { host: string; port: string } }> = {
    'QQ':    { imap: { host: 'imap.qq.com', port: '993' },  smtp: { host: 'smtp.qq.com', port: '587' } },
    '163':   { imap: { host: 'imap.163.com', port: '993' }, smtp: { host: 'smtp.163.com', port: '465' } },
    '126':   { imap: { host: 'imap.126.com', port: '993' }, smtp: { host: 'smtp.126.com', port: '465' } },
    'Gmail': { imap: { host: 'imap.gmail.com', port: '993' }, smtp: { host: 'smtp.gmail.com', port: '587' } },
    'Outlook': { imap: { host: 'outlook.office365.com', port: '993' }, smtp: { host: 'smtp.office365.com', port: '587' } },
  };

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/email.getConfig', { signal: ac.signal }).then(r => r.json()).then(d => {
      if (!mountedRef.current) return; // F8: don't overwrite if unmounted
      const cfgs = d.result?.data || [];
      const imap = cfgs.find((c: any) => c.type === 'imap');
      const smtp = cfgs.find((c: any) => c.type === 'smtp');
      try {
        let loadedEmail = '', loadedPass = '', loadedImap = '', loadedSmtp = '', loadedFrom = 'TomiLite';
        if (imap?.config) { const c = JSON.parse(imap.config); if (c.host) { setImapHost(c.host); loadedImap = c.host + ':' + (c.port || '993'); } if (c.port) setImapPort(String(c.port)); if (c.user) { setEmail(c.user); loadedEmail = c.user; } if (c.password) { setPass(c.password); loadedPass = c.password; } if (c.pollIntervalSeconds) setPollSeconds(String(c.pollIntervalSeconds)); }
        if (smtp?.config) { const c = JSON.parse(smtp.config); if (c.host) { setSmtpHost(c.host); loadedSmtp = c.host + ':' + (c.port || '465'); } if (c.port) setSmtpPort(String(c.port)); if (c.user && !loadedEmail) { setEmail(c.user); loadedEmail = c.user; } if ((c.pass || c.password) && !loadedPass) { setPass(c.pass || c.password); loadedPass = c.pass || c.password; } if (c.fromName) { setFromName(c.fromName); loadedFrom = c.fromName; } }
        // F8: only set initial ref if save hasn't already run (prevents stale overwrite)
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

  const handleSaveAndConnect = async () => {
    // F10: require email+pass + at least one of IMAP or SMTP host
    if (!email.trim() || !pass.trim() || (!imapHost.trim() && !smtpHost.trim())) return;
    setSaving(true);
    // Step 1: Test SMTP (only when SMTP host is configured)
    if (smtpHost.trim()) {
      setStatus(t('testingSmtp'));
      try {
        const tr = await fetch('/api/email.testSmtp', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: smtpHost.trim(), port: parseInt(smtpPort), user: email.trim(), pass: pass.trim(), starttls: smtpPort !== '465' }),
        });
        const td = await tr.json();
        if (!td.result?.data?.ok) { setStatus(`❌ SMTP failed: ${td.result?.data?.error || 'check settings'}`); setSaving(false); return; }
      } catch { setStatus(t('smtpConnFail')); setSaving(false); return; }
    }
    // Step 2: Save IMAP + SMTP
    setStatus(t('saving'));
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
    } catch { setStatus(t('saveFail')); setSaving(false); return; }
    // Step 3: Fire-and-forget IMAP connect only if config changed (don't block save completion)
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
      setStatus(tr(lang,'连接中...','Connecting...','Connecting...','Connecting...','Connecting...','Connecting...'));
      fetch('/api/email.connectIMAP', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .then(r => r.json())
        .then(d => {
          if (!mountedRef.current) return;
          if (d.result?.data?.ok) { setConnected(true); setStatus(t('connected')); }
          else { setStatus(`❌ ${d.result?.data?.error || (tr(lang,'IMAP 连接失败','IMAP connect failed','IMAP connect failed','IMAP connect failed','IMAP connect failed','IMAP connect failed'))}`); }
        })
        .catch((e) => { if (mountedRef.current) setStatus(`❌ ${e?.message || (tr(lang,'网络错误','Network error','Network error','Network error','Network error','Network error'))}`); })
        .finally(() => { connectingRef.current = false; });
    }
  };

  const handleDisconnect = async () => {
    setSaving(true); setStatus(t('disconnecting'));
    try {
      await fetch('/api/email.disconnectIMAP', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      setStatus(t('disconnectOk')); setConnected(false);
    } catch { setStatus(t('saveFail')); }
    setSaving(false);
  };

  return (
    <div className="card">
      <div className="card-hd"><span style={{display:'inline-flex',alignItems:'center',gap:4}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L13.5 11.5a2 2 0 01-2.27.07L11 11.5 2 4"/></svg> {t('email')}</span></div>
      <div className="card-bd">
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {Object.keys(PRESETS).map(name => (
            <button key={name} className="btn btn-xs" style={{ background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--edge)' }}
              onClick={() => { const p = PRESETS[name]; setImapHost(p.imap.host); setImapPort(p.imap.port); setSmtpHost(p.smtp.host); setSmtpPort(p.smtp.port); setStatus(''); }}>{name}</button>
          ))}
        </div>
        <div className="form-grp"><label className="form-label">{t('email')}</label><input className="form-input" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('placeholder')} /></div>
        <div className="form-grp"><label className="form-label">{t('authCode')}</label><p style={{fontSize:10,color:'var(--muted)',marginBottom:4,lineHeight:1.5}}>{t('authCodeHint')}</p><input className="form-input" type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder={t('passPlaceholder')} /></div>
        <div className="form-grp"><label className="form-label">{t('fromName')}</label><input className="form-input" value={fromName} onChange={e => setFromName(e.target.value)} placeholder={t('fromPlaceholder')} /></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <div className="form-grp" style={{ flex: 1 }}><label className="form-label">{t('imap')}</label><input className="form-input" style={{ fontSize: 11 }} value={imapHost ? `${imapHost}:${imapPort}` : ''} onChange={e => { const [h, p] = e.target.value.split(':'); setImapHost(h || ''); setImapPort(p || '993'); }} placeholder={t('imapPlaceholder')} /></div>
          <div className="form-grp" style={{ width: 70, flexShrink: 0 }}><label className="form-label">{tr(lang,'轮询(秒)','Poll(s)','Poll(s)','Poll(s)','Poll(s)','Poll(s)')}</label><input className="form-input" style={{ fontSize: 11, textAlign: 'center' }} value={pollSeconds} onChange={e => setPollSeconds(e.target.value.replace(/\D/g, ''))} placeholder="60" /></div>
            <div className="form-grp" style={{ flex: 1 }}><label className="form-label">{t('smtp')}</label><input className="form-input" style={{ fontSize: 11 }} value={smtpHost ? `${smtpHost}:${smtpPort}` : ''} onChange={e => { const [h, p] = e.target.value.split(':'); setSmtpHost(h || ''); setSmtpPort(p || '465'); }} placeholder={t('smtpPlaceholder')} /></div>
        </div>
        {status && <p style={{ fontSize: 12, margin: '8px 0 4px', color: status.includes('✅') ? 'var(--green)' : status.includes('❌') ? 'var(--brand)' : 'var(--muted)' }}>{status}</p>}
        {imapError && <p style={{ fontSize: 11, margin: '4px 0', color: 'var(--brand)' }}>❌ IMAP: {imapError}</p>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-brand btn-sm" onClick={connected ? handleDisconnect : handleSaveAndConnect} disabled={saving || !email.trim() || !pass.trim()}>{saving ? t('saving') : connected ? t('disconnect') : t('saveConnect')}</button>
        </div>
      </div>
    </div>
  );
}

// ═══ Git Tab ═══
function GitTab({ lang = 'en' }: { lang?: string }) {
  const [workDirs, setWorkDirs] = useState<any[]>([]);
  const [newPath, setNewPath] = useState('');
  const [homeDir, setHomeDir] = useState('');
  const [repos, setRepos] = useState<any[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message: string } | null>(null);

  const t = (key: string) => {
    const map: Record<string, Record<string, string>> = {
      scanError: { zh: '扫描错误', en: 'Scan Error' },
      scanComplete: { zh: '扫描完成', en: 'Scan Complete' },
      noReposFound: { zh: '未发现仓库。请确认：\n1) 已添加工作目录\n2) 目录路径正确\n3) Git 已安装且在 PATH 中', en: 'No repos found.\nCheck:\n1) Work directory added\n2) Path is correct\n3) Git installed and in PATH' },
      scanResult: { zh: '发现 ${repos} 个仓库，${commits} 条新提交', en: 'Found ${repos} repos, ${commits} new commits' },
    };
    return map[key]?.[lang] || map[key]?.en || key;
  };

  const fetchData = () => {
    fetch('/api/system.getHomeDir').then(function (r) { return r.json(); }).then(function (d) {
      if (d.result?.data?.path) setHomeDir(d.result.data.path);
    }).catch(function () {});
    fetch('/api/git.listWorkDirs').then(r => r.json()).then(d => setWorkDirs(d.result?.data || [])).catch(() => {});
    fetch('/api/git.listRepos').then(r => r.json()).then(d => setRepos(d.result?.data || [])).catch(() => {});
    fetch('/api/git.recentCommits?input=%7B%7D').then(r => r.json()).then(d => setCommits(d.result?.data || [])).catch(() => {});
  };
  useEffect(() => { fetchData(); }, []);

  const addDir = async () => {
    if (!newPath.trim() || workDirs.length >= 5) return;
    await fetch('/api/git.addWorkDir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: newPath.trim() }) });
    setNewPath('');
    // Auto-scan after adding
    setScanning(true);
    await fetch('/api/git.scanWorkDirs', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    setScanning(false);
    fetchData();
  };

  const removeDir = async (id: string) => {
    await fetch('/api/git.removeWorkDir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    fetchData();
  };

  const scan = async () => {
    setScanning(true);
    const r = await fetch('/api/git.scanWorkDirs', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const d = await r.json();
    setScanning(false);
    const data = d.result?.data || {};
    if (data.error) { setDialog({ title: t('scanError'), message: data.error }); setScanning(false); return; }
    if (!data.reposFound && !data.commitsFound) {
      setDialog({ title: t('scanComplete'), message: t('noReposFound') });
    } else {
      setDialog({ title: t('scanComplete'), message: t('scanResult').replace('${repos}', String(data.reposFound || 0)).replace('${commits}', String(data.commitsFound || 0)) });
    }
    fetchData();
  };

  return (
    <div>
      <div className="card"><div className="card-hd">{tr(lang,'工作目录','Work Directories','Work Directories','Work Directories','Work Directories','Work Directories')} <span className="text-ink-muted">({workDirs.length}/5)</span></div><div className="card-bd">
        <p className="text-xs text-ink-muted mb-2">{tr(lang,'添加目录以扫描 Git 仓库和提交记录。每 10 分钟自动轮询。','Add directories to scan for Git repos and commits. Auto-polled every 10 minutes.','Add directories to scan for Git repos and commits. Auto-polled every 10 minutes.','Add directories to scan for Git repos and commits. Auto-polled every 10 minutes.','Add directories to scan for Git repos and commits. Auto-polled every 10 minutes.','Add directories to scan for Git repos and commits. Auto-polled every 10 minutes.')}</p>
        {workDirs.map((d: any) => (
          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
            <span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{d.path}</span>
            <button className="btn-ghost btn-xs" style={{ color: 'var(--brand)' }} onClick={() => removeDir(d.id)}>✕</button>
          </div>
        ))}
        {workDirs.length < 5 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input className="form-input" style={{ flex: 1, fontSize: 12 }} value={newPath} onChange={e => setNewPath(e.target.value)} placeholder={homeDir || 'C:\\Users\\yourname'} onKeyDown={e => { if (e.key === 'Enter') addDir(); }} />
            <button className="btn btn-brand btn-sm" onClick={addDir}>{tr(lang,'+ 添加','+ Add','+ Add','+ Add','+ Add','+ Add')}</button>
          </div>
        )}
      </div></div>

      <div className="card" style={{ marginTop: 8 }}><div className="card-hd">{tr(lang,'发现的仓库','Discovered Repos','Discovered Repos','Discovered Repos','Discovered Repos','Discovered Repos')} <span className="text-ink-muted">{repos.length}</span></div>
        {repos.length === 0 ? <div className="card-bd text-xs text-ink-muted">{tr(lang,'尚未发现仓库。请添加工作目录并扫描。','No repos found yet. Add a work directory and scan.','No repos found yet. Add a work directory and scan.','No repos found yet. Add a work directory and scan.','No repos found yet. Add a work directory and scan.','No repos found yet. Add a work directory and scan.')}</div> : (
          <div className="card-bd" style={{ maxHeight: 200, overflow: 'auto' }}>
            {repos.map((r: any) => (
              <div key={r.id} style={{ fontSize: 11, padding: '3px 0', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 500 }}>{r.name}</span>
                <span style={{ color: 'var(--muted)', fontSize: 9 }}>{r.lastScannedAt ? (tr(lang,'上次扫描: ','Last scan: ','Last scan: ','Last scan: ','Last scan: ','Last scan: ')) + r.lastScannedAt?.substring(0, 16) : (tr(lang,'未扫描','Not scanned','Not scanned','Not scanned','Not scanned','Not scanned'))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 8 }}><div className="card-hd">{tr(lang,'最近提交','Recent Commits','Recent Commits','Recent Commits','Recent Commits','Recent Commits')} <span className="text-ink-muted">{commits.length}</span>
        <button className="btn btn-xs" style={{ background: 'var(--surface2)', fontSize: 10 }} onClick={scan} disabled={scanning}>{scanning ? (tr(lang,'扫描中...','Scanning...','Scanning...','Scanning...','Scanning...','Scanning...')) : <span style={{display:'inline-flex',alignItems:'center',gap:3}}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>{tr(lang,' 立即扫描',' Scan Now',' Scan Now',' Scan Now',' Scan Now',' Scan Now')}</span>}</button>
      </div>
        {commits.length === 0 ? <div className="card-bd text-xs text-ink-muted">{tr(lang,'暂无提交记录。请添加工作目录并开始扫描。','No commits recorded yet. Add a work directory and start scanning.','No commits recorded yet. Add a work directory and start scanning.','No commits recorded yet. Add a work directory and start scanning.','No commits recorded yet. Add a work directory and start scanning.','No commits recorded yet. Add a work directory and start scanning.')}</div> : (
          <div className="card-bd" style={{ maxHeight: 300, overflow: 'auto' }}>
            {commits.slice(0, 30).map((c: any) => (
              <div key={c.id} style={{ fontSize: 10, padding: '4px 0', borderBottom: '1px solid var(--edge)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--brand)', fontWeight: 600, fontFamily: 'monospace' }}>{c.hash?.substring(0, 8)}</span>
                  <span style={{ color: 'var(--muted)' }}>{c.timestamp?.replace('T', ' ')?.substring(0, 16)} · {c.repo?.name}</span>
                </div>
                <div style={{ color: 'var(--ink)', marginTop: 1 }}>{c.message?.substring(0, 100)}</div>
                <div style={{ color: 'var(--muted)', fontSize: 9 }}>{c.author} · {c.filesChanged || 0}f +{c.additions || 0} -{c.deletions || 0}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {dialog && (
        <ConfirmDialog
          open={!!dialog}
          title={dialog.title}
          message={dialog.message}
          variant="alert"
          onConfirm={() => setDialog(null)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
