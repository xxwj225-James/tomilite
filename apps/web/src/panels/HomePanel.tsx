/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { marked } from 'marked';
import { sanitizeHtml } from '@/lib/sanitize';
import { t, tr } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DashboardPanel() {
  const [issues, setIssues] = useState<any[]>([]);
  const [board, setBoard] = useState<any>(null);

  useEffect(() => {
    fetch('/api/issue.list?input=%7B%22projectId%22%3A%22proj-default%22%7D')
      .then(r => r.json()).then(d => setIssues(d.result?.data || [])).catch(() => {});
    fetch('/api/board.getBoard?input=%7B%22projectId%22%3A%22proj-default%22%7D')
      .then(r => r.json()).then(d => setBoard(d.result?.data)).catch(() => {});
  }, []);

  const todo = issues.filter((i: any) => i.status === 'todo').length;
  const inProgress = issues.filter((i: any) => ['in_progress','in_review'].includes(i.status)).length;
  const done = issues.filter((i: any) => i.status === 'done').length;
  const rate = issues.length > 0 ? Math.round((done / issues.length) * 100) : 0;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Left sidebar — stats */}
      <div style={{ width: 80, borderRight: '1px solid var(--edge)', padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        <div style={{ textAlign: 'center', padding: '4px 0', borderBottom: '1px solid var(--edge)' }}>
          <div className="stat-val" style={{ color: 'var(--brand)', fontSize: 22 }}>{todo}</div>
          <div className="stat-lbl">Todo</div>
        </div>
        <div style={{ textAlign: 'center', padding: '4px 0', borderBottom: '1px solid var(--edge)' }}>
          <div className="stat-val" style={{ color: 'var(--amber)', fontSize: 22 }}>{inProgress}</div>
          <div className="stat-lbl">Active</div>
        </div>
        <div style={{ textAlign: 'center', padding: '4px 0', borderBottom: '1px solid var(--edge)' }}>
          <div className="stat-val" style={{ color: 'var(--green)', fontSize: 22 }}>{done}</div>
          <div className="stat-lbl">Done</div>
        </div>
        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          <div className="stat-val" style={{ color: 'var(--blue)', fontSize: 22 }}>{rate}%</div>
          <div className="stat-lbl">Done%</div>
        </div>
      </div>
      {/* Kanban board — takes remaining space */}
      {board?.columns && (
        <div className="kanban" style={{ flex: 1 }}>
          {board.columns.map((col: any) => {
            const cards = (col.cards || []).map((c: any) => c.issue).filter(Boolean);
            return (
              <div key={col.id} className="kanban-col">
                <div className="kanban-col-hd"><span>{col.name}</span><span className="badge">{cards.length}</span></div>
                <div className="kanban-col-bd">
                  {cards.map((issue: any) => (
                    <div key={issue.id} className="kanban-card">
                      <div className="kanban-card-key">TL-{issue.issueNumber}</div>
                      <div>{issue.title}</div>
                      <div className="text-ink-muted" style={{ fontSize: 9, marginTop: 2 }}>{issue.priority} · {issue.storyPoints || '-'}sp</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function HomePanel() {
  const lang = useLang();
  const [health, setHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [motto, setMotto] = useState('');
  const [mottoRefreshing, setMottoRefreshing] = useState(false);

  const refreshMotto = async () => {
    setMottoRefreshing(true);
    try {
      const resp = await fetch('/api/system.generateMotto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) });
      const d = await resp.json();
      const text = d.result?.data?.text || '';
      if (text) setMotto(text);
    } catch {}
    setMottoRefreshing(false);
  };
  const [knowledgeMap, setKnowledgeMap] = useState('');
  const [mapLoading, setMapLoading] = useState(false);
  const [mapGeneratedAt, setMapGeneratedAt] = useState('');
  const [healthGeneratedAt, setHealthGeneratedAt] = useState('');
  const [taskStats, setTaskStats] = useState<any>(null);

  const fetchTaskStats = async () => {
    try {
      const r = await fetch('\api\health.taskStats');
      const d = await r.json();
      setTaskStats(d.result?.data || null);
    } catch {}
  };

  const formatGenTime = (t: string) => { if (!t) return ''; const d = t.replace('T',' ').substring(0,16); return d; };

  const fetchHealth = async (force = false) => {
    setHealthLoading(true);
    try {
      const r = await fetch(`/api/health.personalHealth?input=${encodeURIComponent(JSON.stringify({ lang, force }))}`);
      const d = await r.json();
      const data = d.result?.data;
      setHealth(data || null);
      if (data?.generatedAt) setHealthGeneratedAt(formatGenTime(data.generatedAt));
    } catch {}
    setHealthLoading(false);
  };

  const fetchKnowledge = async (forceRefresh = false) => {
    setMapLoading(true);
    setKnowledgeMap(''); // clear old content immediately, show loading
    try {
      const r = await fetch('/api/knowledge.generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, force: forceRefresh }) });
      const d = await r.json();
      const genData = d.result?.data;
      setKnowledgeMap(genData?.content || (tr(lang,'无法生成。尝试点击刷新。','Unable to generate. Try clicking refresh.','Unable to generate. Try clicking refresh.','Unable to generate. Try clicking refresh.','Unable to generate. Try clicking refresh.','Unable to generate. Try clicking refresh.')));
      if (genData?.generatedAt) setMapGeneratedAt(formatGenTime(genData.generatedAt));
    } catch { setKnowledgeMap(tr(lang,'无法生成。请稍后再试。','Unable to generate. Try again later.','Unable to generate. Try again later.','Unable to generate. Try again later.','Unable to generate. Try again later.','Unable to generate. Try again later.')); }
    setMapLoading(false);
  };

  useEffect(() => {
    // Daily motto: check cache first, generate only if not cached today
    fetch(`/api/system.getMotto?input=${encodeURIComponent(JSON.stringify({lang}))}`).then(r => r.json()).then(async d => {
      if (d.result?.data) { setMotto(d.result.data); return; }
      const fallback = tr(lang,'每一天的代码，都在塑造未来的自己。','すべてのコードがあなたの未来を形作る。','Every line of code shapes your future.');
      setMotto(fallback);
      try {
        const resp = await fetch('/api/system.generateMotto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) });
        const d2 = await resp.json();
        const motto = d2.result?.data?.text || '';
        if (motto) { setMotto(motto); } else { setMotto(fallback); }
      } catch {}
    }).catch(() => { setMotto(tr(lang,'每一天的代码，都在塑造未来的自己。','すべてのコードがあなたの未来を形作る。','Every line of code shapes your future.')); });
  }, [lang]);

  useEffect(() => {
    fetchHealth(true);
    fetchKnowledge(true);
    fetchTaskStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchers recreated per render; [lang] is the real trigger
  }, [lang]);

  // Auto-refresh health + knowledge map every 2 hours
  useEffect(() => {
    const timer = setInterval(() => { fetchHealth(); fetchKnowledge(); }, 2 * 3600000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchers recreated per render; timer registered once
  }, []);

  const dimLabels: Record<string, string> = { completion: t('home.completion', lang), velocity: t('home.velocity', lang), git_activity: t('home.git', lang), staleness: t('home.freshness', lang) };
  const dimColors: Record<string, string> = { completion: 'var(--green)', velocity: 'var(--blue)', git_activity: 'var(--amber)', staleness: 'var(--muted)' };

  return (
    <div className="p-2" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', gap: 10, paddingBottom: 80 }}>
      {motto && (
        <div onClick={refreshMotto} title={lang === 'zh' ? '点击刷新' : lang === 'ja' ? 'クリックで更新' : 'Click to refresh'} style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, var(--brand), var(--brand-hover))', textAlign: 'center', cursor: 'pointer', opacity: mottoRefreshing ? 0.6 : 1, transition: 'opacity 0.2s' }}>
          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5, fontStyle: 'italic', color: '#fff' }}>{mottoRefreshing ? (lang === 'zh' ? '⏳ ...' : lang === 'ja' ? '⏳ ...' : '⏳ ...') : motto}</div>
        </div>
      )}
{/* Task Statistics */}
      {taskStats && taskStats.total > 0 && (
        <div className="card" style={{ flexShrink: 0 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--edge)' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{t('home.taskStats', lang)}</span>
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
              {[
                { label: t('home.total', lang), val: taskStats.total, color: 'var(--muted)' },
                { label: t('home.done', lang), val: taskStats.done, color: 'var(--green)' },
                { label: t('home.rate', lang), val: taskStats.completionRate + '%', color: 'var(--brand)' },
                { label: t('home.7dDone', lang), val: taskStats.recentlyDone, color: 'var(--amber)' },
              ].map((s, i) => (
                <div key={i} style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>{t('home.priority', lang)}</div>
              {(Object.entries(taskStats.byPriority || {}) as [string, number][]).map(([p, n]) => (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 10, width: 52, color: p === 'critical' ? 'var(--brand)' : p === 'high' ? 'var(--amber)' : p === 'medium' ? 'var(--blue)' : 'var(--muted)', fontWeight: 500 }}>{lang === 'zh' ? (p === 'critical' ? '紧急' : p === 'high' ? '高' : p === 'medium' ? '中' : '低') : p}</span>
                  <div style={{ flex: 1, height: 14, background: 'var(--surface2)', borderRadius: 7, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (taskStats.total > 0 ? Math.round((n as number / taskStats.total) * 100) : 0) + '%', background: p === 'critical' ? 'var(--brand)' : p === 'high' ? 'var(--amber)' : p === 'medium' ? 'var(--blue)' : 'var(--muted)', borderRadius: 7, minWidth: n > 0 ? 8 : 0, transition: 'width .3s' }} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--muted)', width: 18, textAlign: 'right' }}>{n as number}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* My Health Score */}
      <div className="card" style={{ flexShrink: 0 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--edge)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{t('home.healthScore', lang)}</span>
            <button className="btn-ghost btn-xs" onClick={() => fetchHealth(true)} disabled={healthLoading}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={healthLoading ? {animation:'spin 1s linear infinite'} as any : {}}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button>
          </div>
          {healthGeneratedAt && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{healthGeneratedAt}</div>}
        </div>
        {health && (
          <div style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: `conic-gradient(var(--brand) ${health.score}%, var(--surface2) 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--brand)' }}>{health.score}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>{health.level}</div>
                <div style={{ fontSize: 11, color: 'var(--ink)', lineHeight: 1.5, marginTop: 2 }}>{health.summary?.split('\n')[0]}</div>
              </div>
            </div>
            {/* Detailed AI analysis */}
            {health.summary && health.summary.length > 80 && (
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 11, lineHeight: 1.6 }}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(health.summary) as string) }} />
            )}
            {health.dimensions && Object.entries(health.dimensions).map(([key, val]: [string, any]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, width: 60, color: 'var(--muted)' }}>{dimLabels[key] || key}</span>
                <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${val}%`, background: dimColors[key] || 'var(--brand)', borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, width: 30, textAlign: 'right' }}>{val}</span>
              </div>
            ))}
            {health.recommendations?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--amber)' }}>💡 {health.recommendations[0]}</div>
            )}
            {/* Trend mini-dashboard */}
            {health.trend?.history?.length > 0 && (
              <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4 }}>{t('home.trend', lang)}</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, marginBottom: 8, height: 32 }}>
                  {health.trend.history.map((s: number, i: number) => {
                    const isLast = i === health.trend.history.length - 1;
                    return (
                      <div key={i} style={{ flex: 1, height: `${Math.max(8, s)}%`, background: s >= 60 ? 'var(--green)' : s >= 40 ? 'var(--amber)' : 'var(--brand)', borderRadius: '2px 2px 0 0', opacity: isLast ? 1 : 0.5, minWidth: 4, transition: 'opacity .2s' }} title={`${s}/100`} />
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink)', fontWeight: 500 }}>
                  {health.trend.direction === 'up' ? t('health.trend.up', lang)
                    : health.trend.direction === 'down' ? t('health.trend.down', lang)
                    : health.trend.steady ? t('health.trend.steady', lang)
                    : t('health.trend.steady', lang)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Knowledge Map */}
      <div className="card" style={{ flexShrink: 0 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--edge)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{t('home.knowledgeMap', lang)}</span>
            <button className="btn-ghost btn-xs" onClick={() => fetchKnowledge(true)} disabled={mapLoading} title={t('btn.refresh', lang)}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={mapLoading ? {animation:'spin 1s linear infinite'} as any : {}}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button>
          </div>
          {mapGeneratedAt && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{mapGeneratedAt}</div>}
        </div>
        <div style={{ padding: '0 14px 8px', fontSize: 9, color: 'var(--muted)' }}>
          {t('home.aiGenerated', lang)}
        </div>
        <div style={{ padding: 12 }}>
          {knowledgeMap ? (
            <div className="km-content" style={{ fontSize: 11, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml((marked.parse(knowledgeMap.replace(/^# [^\n]+\n?/, '').replace(/^## [^\n]+\n?/, '')) as string).replace(/\b(LLM|Agent|API|DeepSeek|OpenAI|Claude|GPT|RAG|MCP|Function Calling|Tool Use|Prompt Engineering|Transformer|Embedding|Tokenization|C方案|回归测试|去重|微服务|Docker|K8s|CI\/CD|Git|TypeScript|React|Node\.js|Prisma|SQLite|Vite|Electron)\b/gi, '<span class="km-badge">$&</span>')) }} />
          ) : (
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 16 }}>{t('misc.loading', lang)}</div>
          )}
        </div>
      </div>

    </div>
  );
}

