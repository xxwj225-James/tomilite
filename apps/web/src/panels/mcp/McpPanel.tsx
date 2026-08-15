import { useState, useEffect } from 'react';
import { t as tt2 } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';

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
