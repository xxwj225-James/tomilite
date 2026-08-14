import { useState, useEffect, useCallback } from 'react';
import { useLang } from '@/stores/useLang';

interface McpServer {
  id: string; name: string; url: string; hasApiKey: boolean;
  keyMasked?: string | null;
  enabled: boolean; transport: string; hasHeaders: boolean;
  status: string; lastError?: string; lastConnectedAt?: string;
  toolCount: number; hitlMode: string; hitlConfirmUrl?: string;
  createdAt: string; updatedAt?: string;
}

type FormData = {
  name: string; url: string; apiKey: string; transport: string;
  headers: string; hitlMode: string; hitlConfirmUrl: string;
};

const emptyForm: FormData = { name: '', url: '', apiKey: '', transport: 'http', headers: '', hitlMode: 'none', hitlConfirmUrl: '' };

export function McpServerTab() {
  const lang = useLang();
  const t = (zh: string, ja: string, en: string) => lang === 'zh' ? zh : lang === 'ja' ? ja : en;

  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [editingHasKey, setEditingHasKey] = useState(false);
  const [keyChanged, setKeyChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [error, setError] = useState('');

  const fetchServers = useCallback(async () => {
    try {
      const resp = await fetch('/api/mcpServer.list');
      const data = await resp.json();
      setServers(data?.result?.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchServers(); }, [fetchServers]);
  // Periodic refresh for status updates
  useEffect(() => {
    const iv = setInterval(fetchServers, 15000);
    return () => clearInterval(iv);
  }, [fetchServers]);

  const NEW_SENTINEL = '__new__';
  const isNew = (id: string | null) => id === NEW_SENTINEL || !id;

  const startEdit = (s?: McpServer) => {
    if (s) {
      setEditId(s.id);
      setEditingHasKey(s.hasApiKey);
      setKeyChanged(false);
      setForm({
        name: s.name, url: s.url, apiKey: s.keyMasked || '',
        transport: s.transport || 'http',
        headers: '', hitlMode: s.hitlMode || 'none',
        hitlConfirmUrl: s.hitlConfirmUrl || '',
      });
    } else {
      setEditId(NEW_SENTINEL);
      setEditingHasKey(false);
      setKeyChanged(false);
      setForm(emptyForm);
    }
    setError('');
    setTestResult(null);
  };

  const cancelEdit = () => { setEditId(null); setForm(emptyForm); setEditingHasKey(false); setKeyChanged(false); setError(''); setTestResult(null); };

  const saveServer = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      setError('Name and URL are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: any = {
        name: form.name.trim(), url: form.url.trim(),
        transport: form.transport, hitlMode: form.hitlMode,
        hitlConfirmUrl: form.hitlConfirmUrl.trim() || undefined,
      };
      if (keyChanged && form.apiKey) body.apiKey = form.apiKey;
      if (form.headers.trim()) body.headers = form.headers.trim();

      const endpoint = isNew(editId) ? '/api/mcpServer.create' : '/api/mcpServer.update';
      const resp = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew(editId) ? body : { id: editId, ...body }),
      });
      const data = await resp.json();
      if (data?.error) { setError(data.error.message || 'Failed to save'); return; }
      if (data?.result?.data?.error) { setError(data.result.data.error); return; }

      cancelEdit();
      fetchServers();
    } catch (e: any) {
      setError(e.message || 'Network error');
    }
    setSaving(false);
  };

  const deleteServer = async (id: string) => {
    if (!confirm(t('确定要删除这个 MCP 服务器连接吗？', 'このMCPサーバー接続を削除しますか？', 'Delete this MCP server connection?'))) return;
    await fetch('/api/mcpServer.delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchServers();
  };

  const toggleEnabled = async (s: McpServer) => {
    await fetch('/api/mcpServer.update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, enabled: !s.enabled }),
    });
    fetchServers();
  };

  const testServer = async (id: string) => {
    setTesting(id);
    setTestResult(null);
    try {
      const resp = await fetch('/api/mcpServer.test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await resp.json();
      setTestResult(data?.result?.data || data);
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
    }
    setTesting(null);
  };

  const statusDot = (status: string) => {
    const colors: Record<string, string> = {
      online: 'var(--green)', offline: 'var(--red)', error: 'var(--amber)',
      unknown: 'var(--muted)',
    };
    return <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: colors[status] || 'var(--muted)',
      marginRight: 6, flexShrink: 0,
    }} />;
  };

  const transportLabel = (t: string) => {
    if (t === 'http' || t === 'auto') return 'HTTP';
    if (t === 'jsonrpc') return 'JSON-RPC';
    if (t === 'legacy') return 'Legacy';
    return t;
  };

  if (loading) return <div style={{ padding: 16, color: 'var(--muted)', fontSize: 13 }}>...</div>;

  return (
    <div style={{ padding: '12px 0' }}>
      {/* ─── Server List ─── */}
      {servers.length === 0 && editId === null && (
        <div style={{ padding: '20px 16px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
          {t('还没有连接任何 MCP 服务器。添加一个来让 AI 使用外部工具。', 'MCPサーバーが接続されていません。追加してAIに外部ツールを使わせましょう。', 'No MCP servers connected. Add one to let AI use external tools.')}
        </div>
      )}

      {servers.map(s => (
        <div key={s.id} style={{
          padding: '10px 14px', marginBottom: 8, borderRadius: 8,
          background: 'var(--surface)', border: '1px solid var(--edge)',
          opacity: s.enabled ? 1 : 0.5,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              {statusDot(s.status)}
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{s.name}</span>
              {s.toolCount > 0 && (
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--surface2)', color: 'var(--muted)' }}>
                  {s.toolCount} tools
                </span>
              )}
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{transportLabel(s.transport)}</span>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button className="btn btn-xs" onClick={() => testServer(s.id)} disabled={testing === s.id}
                style={{ background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--edge)' }}>
                {testing === s.id ? '...' : t('测试', 'テスト', 'Test')}
              </button>
              <button className="btn btn-xs" onClick={() => startEdit(s)}
                style={{ background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--edge)' }}>
                {t('编辑', '編集', 'Edit')}
              </button>
              <button className="btn btn-xs" onClick={() => toggleEnabled(s)}
                style={{ background: 'var(--surface2)', color: s.enabled ? 'var(--amber)' : 'var(--green)', border: '1px solid var(--edge)' }}>
                {s.enabled ? t('禁用', '無効', 'Disable') : t('启用', '有効', 'Enable')}
              </button>
              <button className="btn btn-xs" onClick={() => deleteServer(s.id)}
                style={{ background: 'var(--surface2)', color: 'var(--red)', border: '1px solid var(--edge)' }}>
                {t('删除', '削除', 'Del')}
              </button>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
            {s.url}
            {s.lastConnectedAt && <span> · {t('最后连接:', '最終接続:', 'Last: ')}{s.lastConnectedAt}</span>}
            {s.lastError && <span style={{ color: 'var(--amber)' }}> · ⚠ {s.lastError.substring(0, 80)}</span>}
          </div>
        </div>
      ))}

      {/* ─── Test Result ─── */}
      {testResult && (
        <div style={{
          padding: '10px 14px', marginBottom: 8, borderRadius: 8,
          background: testResult.ok ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
          border: `1px solid ${testResult.ok ? 'var(--green)' : 'var(--red)'}`,
        }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: testResult.ok ? 'var(--green)' : 'var(--red)' }}>
            {testResult.ok ? `✅ ${t('连接成功！发现', '接続成功！', 'Connected! Found')} ${testResult.toolCount} tools (${testResult.latencyMs}ms)`
              : `❌ ${testResult.error || t('连接失败', '接続失敗', 'Connection failed')}`}
          </div>
          {testResult.tools?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {testResult.tools.map((tool: any) => (
                <span key={tool.name} style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: 'var(--surface2)', color: 'var(--ink)',
                  border: '1px solid var(--edge)',
                }} title={tool.description}>
                  {tool.name}
                  {tool.risk && <span style={{ color: 'var(--muted)', marginLeft: 4 }}>[{tool.risk}]</span>}
                </span>
              ))}
            </div>
          )}
          <button className="btn btn-xs" onClick={() => setTestResult(null)} style={{ marginTop: 6, color: 'var(--muted)' }}>
            {t('关闭', '閉じる', 'Close')}
          </button>
        </div>
      )}

      {/* ─── Add/Edit Form ─── */}
      {editId === null ? (
        <button className="btn btn-brand btn-sm" onClick={() => startEdit()}
          style={{ marginTop: 8, width: '100%' }}>
          {t('添加 MCP 服务器', 'MCPサーバーを追加', 'Add MCP Server')}
        </button>
      ) : (
        <div style={{
          padding: 14, borderRadius: 8, background: 'var(--surface)',
          border: '2px solid var(--brand)', marginTop: 8,
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: 'var(--ink)' }}>
            {isNew(editId) ? t('添加 MCP 服务器', 'MCPサーバーを追加', 'Add MCP Server') : t('编辑 MCP 服务器', 'MCPサーバーを編集', 'Edit MCP Server')}
          </div>

          {error && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 8 }}>{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 2 }}>{t('名称', '名前', 'Name')} *</label>
              <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder={t('例如: TomiHub', '例: TomiHub', 'e.g. TomiHub')}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--edge)', background: 'var(--surface2)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 2 }}>URL *</label>
              <input className="input" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}
                placeholder={t('例如: http://localhost/api/v1/mcp', '例: http://localhost/api/v1/mcp', 'e.g. http://localhost/api/v1/mcp')}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--edge)', background: 'var(--surface2)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 2 }}>
                API Key
                {editingHasKey && !keyChanged && <span style={{ color: 'var(--green)', fontSize: 10, marginLeft: 4 }}>{t('(已设置)', '(設定済み)', '(set)')}</span>}
              </label>
              <input className="input" type="password" value={form.apiKey} onChange={e => { setForm({ ...form, apiKey: e.target.value }); setKeyChanged(true); }}
                placeholder={isNew(editId) ? t('输入 API Key', 'APIキーを入力', 'Enter API Key') : t('输入新 Key 替换，留空保持不变', '新しいキーを入力すると置き換え、空白のままは保持', 'Enter to replace, leave blank to keep')}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--edge)', background: 'var(--surface2)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 2 }}>{t('协议', 'プロトコル', 'Protocol')}</label>
              <select value={form.transport} onChange={e => setForm({ ...form, transport: e.target.value })}
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--edge)', background: 'var(--surface2)', color: 'var(--ink)' }}>
                <option value="http">HTTP (Auto-detect)</option>
                <option value="jsonrpc">JSON-RPC</option>
                <option value="legacy">Legacy (/tools/call)</option>
              </select>
            </div>
          </div>

          {/* Advanced: extra headers */}
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>{t('高级设置', '詳細設定', 'Advanced')}</summary>
            <div style={{ marginTop: 6 }}>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 2 }}>{t('额外 Headers (JSON)', '追加ヘッダー (JSON)', 'Extra Headers (JSON)')}</label>
              <input className="input" value={form.headers} onChange={e => setForm({ ...form, headers: e.target.value })}
                placeholder='{"X-Custom-Header": "value"}'
                style={{ width: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--edge)', background: 'var(--surface2)', color: 'var(--ink)', fontFamily: 'monospace' }} />
            </div>
          </details>

          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <button className="btn btn-brand btn-sm" onClick={saveServer} disabled={saving}>
              {saving ? '...' : isNew(editId) ? t('创建', '作成', 'Create') : t('更新', '更新', 'Update')}
            </button>
            <button className="btn btn-sm" onClick={cancelEdit}
              style={{ background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--edge)' }}>
              {t('取消', 'キャンセル', 'Cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
