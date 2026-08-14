import { useState, useEffect } from "react";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useLang } from "@/stores/useLang";

export function GitTab() {
  const lang = useLang();
  const [workDirs, setWorkDirs] = useState<any[]>([]);
  const [newPath, setNewPath] = useState('');
  const [homeDir, setHomeDir] = useState('');
  const [repos, setRepos] = useState<any[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [commitTotal, setCommitTotal] = useState(0);
  const [commitPage, setCommitPage] = useState(0);
  const PAGE_SIZE = 30;
  const [scanning, setScanning] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message: string } | null>(null);

  const fetchData = () => {
    fetch('/api/system.getHomeDir').then(function (r) { return r.json(); }).then(function (d) {
      if (d.result?.data?.path) setHomeDir(d.result.data.path);
    }).catch(function () {});
    fetch('/api/git.listWorkDirs').then(r => r.json()).then(d => setWorkDirs(d.result?.data || [])).catch(() => {});
    fetch('/api/git.listRepos').then(r => r.json()).then(d => setRepos(d.result?.data || [])).catch(() => {});
    fetch(`/api/git.recentCommits?input=${encodeURIComponent(JSON.stringify({ limit: PAGE_SIZE, offset: commitPage * PAGE_SIZE }))}`).then(r => r.json()).then(d => { const r = d.result?.data; setCommits(r?.commits || []); setCommitTotal(r?.total || 0); }).catch(() => {});
  };
  useEffect(() => { fetchData(); }, [commitPage]);

  const addDir = async () => {
    if (!newPath.trim() || workDirs.length >= 5) return;
    await fetch('/api/git.addWorkDir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: newPath.trim() }) });
    setNewPath('');
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
    if (data.error) { setDialog({ title: t('gitTab.scanError', lang), message: data.error?.includes('Git not found') ? t('gitTab.gitNotFound', lang) : data.error }); return; }
    if (!data.reposFound && !data.commitsFound) {
      setDialog({ title: t('gitTab.scanComplete', lang), message: t('gitTab.noReposFoundDialog', lang) });
    } else {
      setDialog({ title: t('gitTab.scanComplete', lang), message: t('gitTab.scanResult', lang).replace('{repos}', String(data.reposFound || 0)).replace('{commits}', String(data.commitsFound || 0)) });
    }
    fetchData();
  };

  const totalPages = Math.ceil(commitTotal / PAGE_SIZE);

  return (
    <div>
      <div className="card"><div className="card-hd">{t('gitTab.workDirs', lang)} <span className="text-ink-muted">({workDirs.length}/5)</span></div><div className="card-bd">
        <p className="text-xs text-ink-muted mb-2">{t('gitTab.workDirsDesc', lang)}</p>
        {workDirs.map((d: any) => (
          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
            <span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{d.path}</span>
            <button className="btn-ghost btn-xs" style={{ color: 'var(--brand)' }} onClick={() => removeDir(d.id)}>✕</button>
          </div>
        ))}
        {workDirs.length < 5 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input className="form-input" style={{ flex: 1, fontSize: 12 }} value={newPath} onChange={e => setNewPath(e.target.value)} placeholder={homeDir || 'C:\\Users\\yourname'} onKeyDown={e => { if (e.key === 'Enter') addDir(); }} />
            <button className="btn btn-brand btn-sm" onClick={addDir}>{t('gitTab.add', lang)}</button>
          </div>
        )}
      </div></div>

      <div className="card" style={{ marginTop: 8 }}><div className="card-hd">{t('gitTab.discoveredRepos', lang)} <span className="text-ink-muted">{repos.length}</span></div>
        {repos.length === 0 ? <div className="card-bd text-xs text-ink-muted">{t('gitTab.noReposFound', lang)}</div> : (
          <div className="card-bd" style={{ maxHeight: 200, overflow: 'auto' }}>
            {repos.map((r: any) => (
              <div key={r.id} style={{ fontSize: 11, padding: '3px 0', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 500 }}>{r.name}</span>
                <span style={{ color: 'var(--muted)', fontSize: 9 }}>{r.lastScannedAt ? t('gitTab.lastScan', lang) + r.lastScannedAt?.replace('T', ' ')?.substring(0, 16) : t('gitTab.notScanned', lang)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 8, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}><div className="card-hd">{t('gitTab.recentCommits', lang)} <span className="text-ink-muted">{commitTotal}</span>
        <button className="btn btn-xs" style={{ background: 'var(--surface2)', fontSize: 10 }} onClick={scan} disabled={scanning}>{scanning ? t('gitTab.scanning', lang) : <span style={{display:'inline-flex',alignItems:'center',gap:3}}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>{t('gitTab.scanNow', lang)}</span>}</button>
      </div>
        {commits.length === 0 ? <div className="card-bd text-xs text-ink-muted">{t('gitTab.noCommits', lang)}</div> : (
          <div className="card-bd" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {commits.map((c: any) => (
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
        {commitTotal > PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 11, borderTop: '1px solid var(--edge)' }}>
            <button className="btn btn-xs" style={{ background: 'var(--surface2)' }} disabled={commitPage === 0} onClick={() => setCommitPage(p => Math.max(0, p - 1))}>
              ← {t('gitTab.prev', lang)}
            </button>
            <span style={{ color: 'var(--muted)' }}>
              {t('gitTab.pageNum', lang).replace('{n}', String(commitPage + 1)).replace('{m}', String(totalPages))}
            </span>
            <button className="btn btn-xs" style={{ background: 'var(--surface2)' }} disabled={(commitPage + 1) * PAGE_SIZE >= commitTotal} onClick={() => setCommitPage(p => p + 1)}>
              {t('gitTab.next', lang)} →
            </button>
          </div>
        )}
      </div>
      {dialog && (
        <div className="modal-overlay" onClick={() => setDialog(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-hd">{dialog.title}</div>
            <div className="modal-bd" style={{ whiteSpace: 'pre-wrap' }}>{dialog.message}</div>
            <div style={{ padding: '8px 18px 14px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-brand btn-sm" onClick={() => setDialog(null)}>{t('dialog.ok', lang)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
