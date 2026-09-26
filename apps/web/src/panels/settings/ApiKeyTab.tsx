import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useLang } from '@/stores/useLang';
import { t } from '@/lib/i18n';
import { ConfirmDialog } from '@tomilite/shared-ui/components/ConfirmDialog';
import { formatDbDate } from '@/lib/dbTime';

/**
 * The MCP setup instructions. What this tab used to show could not work:
 *
 *   "type": "http" with a "body": { "api_key": … } field
 *
 * `body` is not a field of the StreamableHTTP transport — no client reads it — and the
 * URL pointed at `/api/mcp.execute`, a tRPC mutation that answers a plain JSON POST and
 * knows nothing of `initialize`. It also told users to create `.claude/mcp.json`, which
 * Claude Code never reads (the file is `.mcp.json`, in the project root). Anyone who
 * followed it got a client that would not connect and no idea why.
 *
 * Both paths below are DETECTED by the API (`mcp.transportInfo`) rather than written
 * down here, because the installer lets the user choose its own directory.
 */
interface TransportInfo {
  apiPort: string;
  appVersion: string;
  exePath: string | null;
  shimPath: string;
  shimBuilt: boolean;
  ready: boolean;
}

const PRE_STYLE: React.CSSProperties = {
  background: 'var(--bg)',
  padding: '6px 10px',
  borderRadius: 4,
  fontSize: 9,
  marginTop: 2,
  overflow: 'auto',
  color: 'var(--muted)',
  userSelect: 'text',
  whiteSpace: 'pre',
};

export function ApiKeyTab() {
  const lang = useLang();
  const [keys, setKeys] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [hitlMode, setHitlMode] = useState('manual');
  const [genResult, setGenResult] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [info, setInfo] = useState<TransportInfo | null>(null);
  const [toolCount, setToolCount] = useState(0);

  const fetchKeys = () => {
    fetch('/api/apikey.list')
      .then((r) => r.json())
      .then((d) => setKeys((d.result?.data || []).filter((k: any) => k.isActive !== false)))
      .catch(() => {});
  };
  useEffect(() => {
    fetchKeys();
    fetch('/api/mcp.transportInfo')
      .then((r) => r.json())
      .then((d) => setInfo(d.result?.data || null))
      .catch(() => {});
    // Read the count from the catalogue rather than restating it here: a number written
    // into a sentence is a number that goes stale.
    fetch('/api/mcp.listTools')
      .then((r) => r.json())
      .then((d) => setToolCount((d.result?.data?.tools || []).length))
      .catch(() => {});
  }, []);

  const generate = async () => {
    if (!newName.trim()) return;
    const resp = await fetch('/api/apikey.generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), hitlMode, expiresDays: 90 }),
    });
    const json = await resp.json();
    setGenResult(json.result?.data?.key || '');
    setNewName('');
    fetchKeys();
  };

  const doRevoke = () => {
    if (!revokeTarget) return;
    api.apikey
      .revoke(revokeTarget)
      .then(() => {
        fetchKeys();
        setRevokeTarget(null);
      })
      .catch((e: any) => {
        console.error('[revoke]', e);
        alert(t('apikey.revokeFailed', lang, { msg: e?.message || '' }));
        setRevokeTarget(null);
      });
  };

  // Built with JSON.stringify so Windows backslashes are escaped correctly — hand-written
  // snippets here are how the last ones ended up wrong.
  //
  // `API_PORT` is spelled out because the shim's own default (3192, the packaged app's
  // port) is not the API's default (3091) — a developer running the API directly would
  // otherwise get "the app does not appear to be running" from a shim aimed at the wrong
  // port while the app is running fine. In the packaged app the two agree and this is
  // simply redundant.
  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        tomilite: {
          command: info?.exePath || '<…>\\TomiLite.exe',
          args: [info?.shimPath || '<…>\\resources\\app\\apps\\api\\dist\\mcp-stdio.cjs'],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            TL_MCP_API_KEY: 'tl_xxxxxxxxxxxx',
            ...(info?.apiPort ? { API_PORT: info.apiPort } : {}),
          },
        },
      },
    },
    null,
    2,
  );

  const httpConfig = JSON.stringify(
    {
      mcpServers: {
        tomilite: {
          type: 'http',
          url: `http://127.0.0.1:${window.location.port || info?.apiPort || '3192'}/api/mcp`,
          headers: { 'X-Api-Key': 'tl_xxxxxxxxxxxx' },
        },
      },
    },
    null,
    2,
  );

  return (
    <div>
      <div className="card">
        <div className="card-hd">{t('apikey.generateTitle', lang)}</div>
        <div className="card-bd">
          <div className="form-grp">
            <label className="form-label">{t('apikey.nameLabel', lang)}</label>
            <input
              className="form-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('apikey.namePlaceholder', lang)}
            />
          </div>
          <div className="form-grp">
            <label className="form-label">{t('apikey.hitlLabel', lang)}</label>
            <select className="form-select" value={hitlMode} onChange={(e) => setHitlMode(e.target.value)}>
              <option value="manual">{t('apikey.hitlManual', lang)}</option>
              <option value="auto">{t('apikey.hitlAuto', lang)}</option>
            </select>
          </div>
          <button className="btn btn-brand btn-sm" onClick={generate} disabled={!newName.trim()}>
            {t('apikey.generate', lang)}
          </button>

          <div className="text-xs text-ink-muted mt-3" style={{ lineHeight: 1.6 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>{t('apikey.usageTitle', lang)}</p>

            {info && !info.ready && (
              <p style={{ color: 'var(--red)' }}>{t('apikey.devWarning', lang)}</p>
            )}

            <p className="mt-1">
              <strong>{t('apikey.stdioTitle', lang)}</strong>
            </p>
            <p>{t('apikey.stdioLead', lang)}</p>
            <pre style={PRE_STYLE}>{stdioConfig}</pre>
            <p className="mt-1">{t('apikey.keyNote', lang)}</p>

            <p className="mt-1">
              <strong>{t('apikey.httpTitle', lang)}</strong>
            </p>
            <p>{t('apikey.httpLead', lang)}</p>
            <pre style={PRE_STYLE}>{httpConfig}</pre>

            {/* Hidden until the count arrives: the sentence reads "All 0 tools are
                available" while the fetch is in flight, which is worse than silence. */}
            {toolCount > 0 && (
              <>
                <p className="mt-1">
                  <strong>{t('apikey.toolsTitle', lang)}</strong>
                </p>
                <p>{t('apikey.toolsLead', lang, { count: toolCount })}</p>
              </>
            )}

            <p className="mt-1">{t('apikey.hitlNote', lang)}</p>
            <p className="mt-1">{t('apikey.hashNote', lang)}</p>
          </div>

          {genResult && (
            <div
              className="mt-3"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--brand)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div className="text-xs mb-1" style={{ color: 'var(--brand)' }}>
                {t('apikey.generated', lang)}
              </div>
              <code className="text-sm text-ink-primary" style={{ wordBreak: 'break-all', userSelect: 'text' }}>
                {genResult}
              </code>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          {t('apikey.listTitle', lang)} <span className="text-ink-muted">{keys.length}</span>
        </div>
        <div>
          {keys.map((k: any) => (
            <div key={k.id} className="list-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{k.name}</div>
                <div className="text-ink-muted">
                  {k.scopes} · {k.hitlMode} · {t('apikey.usedTimes', lang, { count: k.useCount ?? 0 })}
                </div>
                {/* Two clocks on one line, on purpose. `createdAt` is born from the
                    column default (`datetime('now','localtime')`) and is read raw.
                    `expiresAt` is written as an ISO `Z` instant, so slicing its first
                    10 chars would print the UTC date — a day early for anyone west of
                    Greenwich. `formatDbDate` renders it in the viewer's zone. */}
                <div className="text-ink-muted" style={{ fontSize: 9 }}>
                  {t('apikey.created', lang)} {k.createdAt?.substring(0, 10)} · {t('apikey.expires', lang)}{' '}
                  {formatDbDate(k.expiresAt)}
                </div>
              </div>
              <button
                className="btn-ghost btn-xs"
                style={{ color: 'var(--brand)' }}
                onClick={() => setRevokeTarget(k.id)}
              >
                {t('apikey.revoke', lang)}
              </button>
            </div>
          ))}
          {keys.length === 0 && (
            <div className="text-ink-muted text-sm" style={{ padding: 12, textAlign: 'center' }}>
              {t('apikey.empty', lang)}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!revokeTarget}
        title={t('apikey.revokeTitle', lang)}
        message={t('apikey.revokeMessage', lang)}
        lang={lang}
        confirmLabel={t('apikey.revoke', lang)}
        cancelLabel={t('apikey.cancel', lang)}
        onConfirm={doRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
