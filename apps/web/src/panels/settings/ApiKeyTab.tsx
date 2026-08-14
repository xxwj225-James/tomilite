import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/stores/useLang";
import { ConfirmDialog } from "@tomatolite/shared-ui/components/ConfirmDialog";

export function ApiKeyTab() {
  const lang = useLang();
  const t = (zh: string, ja: string, en: string) => lang === 'zh' ? zh : lang === 'ja' ? ja : en;
  const [keys, setKeys] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [hitlMode, setHitlMode] = useState('manual');
  const [genResult, setGenResult] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const fetchKeys = () => { fetch('/api/apikey.list').then(r => r.json()).then(d => setKeys((d.result?.data || []).filter((k: any) => k.isActive !== false))).catch(() => {}); };
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

  const doRevoke = () => {
    if (!revokeTarget) return;
    api.apikey.revoke(revokeTarget).then(() => { fetchKeys(); setRevokeTarget(null); }).catch((e: any) => { console.error('[revoke]', e); alert(t('撤销失败: ' + (e?.message || ''), '失効失敗: ' + (e?.message || ''), 'Revoke failed: ' + (e?.message || ''))); setRevokeTarget(null); });
  };

  return (
    <div>
      <div className="card"><div className="card-hd">{t('生成 API 密钥', 'APIキーを生成', 'Generate API Key')}</div><div className="card-bd">
        <div className="form-grp">
          <label className="form-label">{t('密钥名称', 'キー名', 'Key Name')}</label>
          <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('例如: cursor-mcp', '例: cursor-mcp', 'e.g. cursor-mcp')} />
        </div>
        <div className="form-grp">
          <label className="form-label">HITL {t('模式', 'モード', 'Mode')}</label>
          <select className="form-select" value={hitlMode} onChange={e => setHitlMode(e.target.value)}>
            <option value="manual">{t('手动（读取以外需确认）', '手動（読み取り以外は確認が必要）', 'Manual (all writes require confirmation)')}</option>
            <option value="auto">{t('自动（自动批准所有操作）', '自動（すべての操作を自動承認）', 'Auto (auto-approve all operations)')}</option>
          </select>
        </div>
        <button className="btn btn-brand btn-sm" onClick={generate} disabled={!newName.trim()}>{t('生成密钥', 'APIキーを生成', 'Generate Key')}</button>
        <div className="text-xs text-ink-muted mt-3" style={{ lineHeight: 1.6 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>{t('使用方法', '使用方法', 'Usage')}</p>
          <p className="mt-1"><strong>{t('Claude Code 配置', 'Claude Code セットアップ', 'Claude Code Setup')}</strong></p>
          <p>{t('将以下内容添加到项目根目录的 .claude/mcp.json：', '以下をプロジェクトルートの .claude/mcp.json に追加してください：', 'Add this to .claude/mcp.json in your project root:')}</p>
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
          <p className="mt-1">{t('将 tl_xxxxxxxxxxxx 替换为下方生成的完整密钥。api_key 字段为必填。', 'tl_xxxxxxxxxxxx を生成されたキーに置き換えてください。api_key フィールドは必須です。', 'Replace tl_xxxxxxxxxxxx with the full key generated below. The api_key field is required.')}</p>
          <p className="mt-1"><strong>{t('请求格式', 'リクエスト形式', 'Request Format')}</strong></p>
          <pre style={{ background: 'var(--bg)', padding: '6px 10px', borderRadius: 4, fontSize: 9, marginTop: 2, overflow: 'auto', color: 'var(--muted)' }}>{`POST http://localhost:${window.location.port || '3192'}/api/mcp.execute
Content-Type: application/json

{
  "tool": "create_note",
  "arguments": { "title": "...", "content": "..." },
  "api_key": "tl_xxxxxxxxxxxx"
}`}</pre>
          <p className="mt-1">{t('tool 支持: create_note, update_note, create_issue, update_issue, list_issues, create_report, update_report, delete_issue, search_notes, get_project_stats, get_focus_status。使用 tools/list 查看完整列表。', '対応ツール: create_note, update_note, create_issue, update_issue, list_issues, create_report, update_report, delete_issue, search_notes, get_project_stats, get_focus_status。tools/list で全リストを確認。', 'Supported tools: create_note, update_note, create_issue, update_issue, list_issues, create_report, update_report, delete_issue, search_notes, get_project_stats, get_focus_status. Use tools/list for the full list.')}</p>
          <p className="mt-1"><strong>HITL {t('模式', 'モード', 'Mode')}</strong></p>
          <p>{t('• <strong>手动</strong> — 写操作需在本应用 MCP审批 面板中人工批准', '• <strong>手動</strong> — 書き込み操作は MCP承認 パネルで手動承認が必要', '• <strong>Manual</strong> — writes require human approval in the MCP Approve panel')}</p>
          <p>{t('• <strong>自动</strong> — 所有操作自动执行（适用于受信任的本地工具）', '• <strong>自動</strong> — すべての操作を自動実行（信頼されたローカルツール向け）', '• <strong>Auto</strong> — all operations auto-executed (for trusted local tools)')}</p>
          <p className="mt-1">{t('密钥存储前经 SHA-256 哈希处理，原始密钥仅显示一次。', 'キーは保存前に SHA-256 でハッシュ化されます。生のキーは一度だけ表示されます。', 'Keys are SHA-256 hashed before storage. Raw key shown only once.')}</p>
        </div>
        {genResult && (
          <div className="mt-3" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: 12 }}>
            <div className="text-xs text-green mb-1">{t('✅ 密钥已生成 — 立即复制，不会再次显示：', '✅ キーが生成されました — 今すぐコピーしてください。再表示されません：', "✅ Key generated — copy now, won't be shown again:")}</div>
            <code className="text-sm text-ink-primary" style={{ wordBreak: 'break-all' }}>{genResult}</code>
          </div>
        )}
      </div></div>

      <div className="card"><div className="card-hd">{t('API 密钥', 'APIキー', 'API Keys')} <span className="text-ink-muted">{keys.length}</span></div>
        <div>
          {keys.map((k: any) => (
            <div key={k.id} className="list-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{k.name}</div>
                <div className="text-ink-muted">{k.scopes} · {k.hitlMode} · used {k.useCount}x</div>
                <div className="text-ink-muted" style={{ fontSize: 9 }}>Created {k.createdAt?.substring(0,10)} · Expires {k.expiresAt?.substring(0,10)}</div>
              </div>
              <button className="btn-ghost btn-xs" style={{ color: 'var(--brand)' }} onClick={() => setRevokeTarget(k.id)}>{t('撤销', '失効', 'Revoke')}</button>
            </div>
          ))}
          {keys.length === 0 && <div className="text-ink-muted text-sm" style={{ padding: 12, textAlign: 'center' }}>{t('暂无 API 密钥。', 'APIキーはまだありません。', 'No API keys yet.')}</div>}
        </div>
      </div>

      <ConfirmDialog
        open={!!revokeTarget}
        title={t('撤销 API 密钥', 'APIキーを失効', 'Revoke API Key')}
        message={t('撤销后该密钥将立即失效，使用该密钥的 MCP 客户端将无法连接。确定要撤销吗？', 'このキーは直ちに失効し、このキーを使用する MCP クライアントは接続できなくなります。よろしいですか？', 'This key will be revoked immediately. MCP clients using this key will be unable to connect. Are you sure?')}
        lang={lang}
        confirmLabel={t('撤销', '失効', 'Revoke')}
        cancelLabel={t('取消', 'キャンセル', 'Cancel')}
        onConfirm={doRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
