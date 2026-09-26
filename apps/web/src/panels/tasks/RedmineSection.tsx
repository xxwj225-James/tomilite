import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { api } from '@/lib/api';

// ═══ Redmine connection ═══
//
// The body of the tasks panel's import dialog, not a tab of its own: what a sync produces
// is tasks, and a tenth top-level settings tab for a connector most users never configure
// costs more navigation than it earns. It is still a separate file from the dialog because
// its state model has nothing in common with the note importer's — the work here happens
// server-side and is polled, while that one runs in the renderer and reports as it goes.
//
// ## Polling: two different speeds, on purpose
//
// While a sync is running the user is watching this panel and wants to see it finish, so
// it polls every 5 s. The rest of the time the answer rarely changes and the panel polls
// every 30 s — the same reasoning as McpServerTab, which polls at 15 s for a status that
// is cheaper to compute and matters more often.
//
// Every call here returns `{ok:false, error}` instead of throwing, so failures arrive as
// text rather than as a rejected promise — see the `redmine` block in lib/api.ts.

type Config = {
  configured: boolean;
  hasKey: boolean;
  baseUrl?: string;
  enabled?: boolean;
  projectId?: number | null;
  projectName?: string;
  userName?: string;
  lastSyncAt?: string | null;
  lastSync?: Summary | null;
};

type Summary = {
  ok: boolean;
  error?: string;
  fetched: number;
  created: number;
  updated: number;
  pages: number;
  complete: boolean;
  hasMore: boolean;
};

type Status = {
  syncing: boolean;
  mirrored: number;
  lastSyncAt: string | null;
  lastSync: Summary | null;
  cursor: string | null;
  projectName: string;
  userName: string;
};

/** A plain `http://` connection sends the API key in the clear. Say so. */
function isPlainHttp(url: string): boolean {
  return /^http:\/\//i.test(url.trim());
}

/**
 * `onChanged` is how the task list behind the dialog learns that its rows moved: a sync
 * creates and updates mirrored tasks, and a disconnect keeps, detaches or deletes them.
 * Not called for anything that only touches this panel's own configuration.
 */
export function RedmineSection({ onChanged }: { onChanged?: () => void }) {
  const lang = useLang();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [projects, setProjects] = useState<Array<{ id: number; name: string }>>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [confirmDisc, setConfirmDisc] = useState(false);
  const seeded = useRef(false);

  const loadConfig = useCallback(async () => {
    const c: Config = await api.redmine.getConfig();
    setCfg(c);
    // The form's fields are seeded once. Re-seeding on every poll would type over
    // whatever the user is in the middle of entering.
    if (!seeded.current && c.configured) {
      seeded.current = true;
      setBaseUrl(c.baseUrl || '');
      setEnabled(c.enabled ?? true);
      setProjectId(c.projectId ?? null);
    }
    return c;
  }, []);

  useEffect(() => {
    loadConfig().catch(() => {});
  }, [loadConfig]);

  // Poll fast while a sync is in flight, slowly otherwise. The interval is torn down and
  // rebuilt when `syncing` flips, which is the only way to change a period.
  const syncing = status?.syncing ?? false;
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api.redmine
        .status()
        .then((s: Status) => {
          if (alive) setStatus(s);
        })
        .catch(() => {});
    tick();
    const id = setInterval(tick, syncing ? 5000 : 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [syncing]);

  const save = async () => {
    setBusy('save');
    setMsg(null);
    try {
      const r = await api.redmine.saveConfig({ baseUrl, apiKey, enabled, projectId, projectName: cfg?.projectName || '' });
      if (!r.ok) setMsg({ kind: 'err', text: r.error });
      else {
        setApiKey('');
        await loadConfig();
        setMsg({ kind: 'ok', text: t('redmine.saved', lang) });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    setMsg(null);
    try {
      const r = await api.redmine.testConnection({ baseUrl, apiKey });
      setMsg(r.ok ? { kind: 'ok', text: t('redmine.testOk', lang, { user: r.userName || r.login }) } : { kind: 'err', text: r.error });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };

  const loadProjects = async () => {
    setBusy('projects');
    setMsg(null);
    try {
      const r = await api.redmine.vocabularies({ baseUrl, apiKey });
      if (!r.ok) setMsg({ kind: 'err', text: r.error });
      else {
        setProjects(r.projects || []);
        if (!r.projects?.length) setMsg({ kind: 'err', text: t('redmine.noProjects', lang) });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };

  const doPreview = async () => {
    setBusy('preview');
    setMsg(null);
    try {
      const r = await api.redmine.preview({ projectId });
      if (!r.ok) setMsg({ kind: 'err', text: r.error });
      else setPreview(r);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };

  const doSync = async (full: boolean) => {
    setBusy('sync');
    setMsg(null);
    setPreview(null);
    try {
      const r: Summary = await api.redmine.sync({ full });
      if (!r.ok) setMsg({ kind: 'err', text: r.error || t('redmine.syncFailed', lang) });
      else {
        setMsg({
          kind: 'ok',
          text: r.hasMore ? t('redmine.syncPartial', lang, { fetched: r.fetched, created: r.created }) : t('redmine.syncDone', lang, { fetched: r.fetched, created: r.created, updated: r.updated }),
        });
        // A partial sync still wrote rows, so this is on `ok` and not on `complete`.
        onChanged?.();
      }
      await loadConfig();
      setStatus(await api.redmine.status());
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };

  const disconnect = async (tasks: 'keep' | 'detach' | 'delete') => {
    setBusy('disc');
    setMsg(null);
    try {
      const r = await api.redmine.disconnect(tasks);
      setConfirmDisc(false);
      seeded.current = false;
      setBaseUrl('');
      setApiKey('');
      setProjects([]);
      setPreview(null);
      await loadConfig();
      setStatus(await api.redmine.status());
      setMsg({ kind: 'ok', text: t('redmine.disconnected', lang, { n: r.affected }) });
      // Every one of the three choices moves rows the task list is showing: kept and
      // detached ones lose their mirror badge, deleted ones disappear.
      onChanged?.();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };

  const noKeyYet = !cfg?.hasKey && !apiKey.trim();
  const canSave = !!baseUrl.trim() && !noKeyYet;

  return (
    <div className="card">
      <div className="card-hd">{t('redmine.title', lang)}</div>
      <div className="card-bd">
        <p className="text-ink-muted" style={{ fontSize: 11, lineHeight: 1.7, marginBottom: 'var(--space-3)' }}>
          {t('redmine.lead', lang)}
        </p>

        {/* ─── Where it stands ─── */}
        {cfg?.configured && (
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.8, marginBottom: 'var(--space-3)' }}>
            <div>
              {status?.syncing ? t('redmine.syncing', lang) : t('redmine.idle', lang)}
              {status?.mirrored ? ' · ' + t('redmine.mirrored', lang, { n: status.mirrored }) : ''}
            </div>
            <div>
              {t('redmine.lastSync', lang, { when: status?.lastSyncAt || t('redmine.never', lang) })}
              {cfg.userName ? ` · ${cfg.userName}` : ''}
            </div>
          </div>
        )}

        {/* ─── Address ─── */}
        <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{t('redmine.address', lang)}</label>
        <input
          className="form-input"
          style={{ width: '100%', fontSize: 12, marginBottom: 4 }}
          placeholder="http://redmine.example.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6 }}>
          {t('redmine.addressHint', lang)}
        </p>

        {/* ─── Key ─── */}
        <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', margin: 'var(--space-3) 0 4px' }}>
          {t('redmine.apiKey', lang)}
        </label>
        <input
          className="form-input"
          type="password"
          autoComplete="off"
          style={{ width: '100%', fontSize: 12 }}
          placeholder={cfg?.hasKey ? t('redmine.apiKeyKeep', lang) : ''}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 4 }}>
          {t('redmine.apiKeyHint', lang)}
        </p>

        {/* A credential crossing a plain connection deserves to be said out loud, once,
            next to the field. Intranet Redmines are routinely http-only, so this is a
            warning and not a block. */}
        {isPlainHttp(baseUrl) && (
          <p style={{ fontSize: 10, lineHeight: 1.6, marginTop: 4, color: 'var(--amber)' }}>{t('redmine.plainHttp', lang)}</p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={test}>
            {busy === 'test' ? t('redmine.working', lang) : t('redmine.test', lang)}
          </button>
          <button className="btn btn-brand btn-sm" disabled={!!busy || !canSave} onClick={save}>
            {busy === 'save' ? t('redmine.working', lang) : t('redmine.save', lang)}
          </button>
        </div>

        {/* ─── Project ─── */}
        <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', margin: 'var(--space-3) 0 4px' }}>
          {t('redmine.project', lang)}
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="form-input"
            style={{ flex: 1, minWidth: 160, fontSize: 12 }}
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
            disabled={!projects.length}
          >
            <option value="">{projects.length ? t('redmine.projectPick', lang) : t('redmine.projectNone', lang)}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={loadProjects}>
            {busy === 'projects' ? t('redmine.working', lang) : t('redmine.loadProjects', lang)}
          </button>
        </div>
        <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 4 }}>
          {t('redmine.projectHint', lang)}
        </p>

        {/* ─── Enabled ─── */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)', cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16 }} />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{t('redmine.enabled', lang)}</span>
        </label>
        <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 4 }}>
          {t('redmine.enabledHint', lang)}
        </p>

        {/* ─── Do it ─── */}
        {cfg?.configured && (
          <>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={doPreview}>
                {busy === 'preview' ? t('redmine.working', lang) : t('redmine.preview', lang)}
              </button>
              <button className="btn btn-brand btn-sm" disabled={!!busy || syncing} onClick={() => doSync(false)}>
                {busy === 'sync' ? t('redmine.working', lang) : t('redmine.syncNow', lang)}
              </button>
              <button className="btn btn-secondary btn-sm" disabled={!!busy || syncing} onClick={() => doSync(true)} title={t('redmine.fullHint', lang)}>
                {t('redmine.full', lang)}
              </button>
            </div>
            <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 4 }}>
              {t('redmine.readOnlyNote', lang)}
            </p>
          </>
        )}

        {/* ─── Preview, which writes nothing ─── */}
        {preview && (
          <div style={{ marginTop: 'var(--space-3)', fontSize: 11, lineHeight: 1.8 }}>
            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{t('redmine.previewTitle', lang)}</div>
            <div className="text-ink-muted">
              {t('redmine.previewTotal', lang, { n: preview.totalCount, sampled: preview.sampled })}
            </div>
            <div style={{ color: 'var(--ink)' }}>
              {t('redmine.previewWould', lang, { created: preview.wouldCreate, updated: preview.wouldUpdate })}
            </div>
            <div className="text-ink-muted">
              {Object.entries(preview.byStatus as Record<string, number>)
                .map(([k, v]) => `${k} ${v}`)
                .join(' · ')}
            </div>
            <div className="text-ink-muted">
              {Object.entries(preview.byType as Record<string, number>)
                .map(([k, v]) => `${k} ${v}`)
                .join(' · ')}
            </div>
            {preview.sample?.length > 0 && (
              <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 10, color: 'var(--muted)' }}>
                {preview.sample.map((s: any) => (
                  <li key={s.sourceId}>
                    #{s.sourceId} {s.title} — {s.status}/{s.type}/{s.priority}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {msg && (
          <p style={{ fontSize: 11, lineHeight: 1.7, marginTop: 'var(--space-3)', color: msg.kind === 'ok' ? 'var(--green)' : 'var(--red)' }}>{msg.text}</p>
        )}

        {/* ─── Disconnect ─── */}
        {cfg?.configured && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            {!confirmDisc ? (
              <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => setConfirmDisc(true)}>
                {t('redmine.disconnect', lang)}
              </button>
            ) : (
              <div>
                <p style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--ink)', marginBottom: 'var(--space-2)' }}>{t('redmine.disconnectHint', lang)}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {/* Detach is listed first because it is the middle path: the rows survive
                      as ordinary editable tasks. The other two either strand them
                      read-only with nothing left to refresh them, or throw them away. */}
                  <button className="btn btn-brand btn-sm" disabled={!!busy} onClick={() => disconnect('detach')}>
                    {t('redmine.discDetach', lang)}
                  </button>
                  <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, margin: '-4px 0 4px' }}>
                    {t('redmine.discDetachHint', lang)}
                  </p>
                  <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => disconnect('delete')}>
                    {t('redmine.discDelete', lang)}
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => disconnect('keep')}>
                    {t('redmine.discKeep', lang)}
                  </button>
                  <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, margin: '-4px 0 4px' }}>
                    {t('redmine.discKeepHint', lang)}
                  </p>
                  <button className="btn-ghost btn-xs" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirmDisc(false)}>
                    {t('redmine.cancel', lang)}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
