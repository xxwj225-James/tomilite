import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';

// ═══ Settings → Meetings ═══
//
// The privacy block is the reason this tab exists at anything beyond "download a
// model". Three separate lines, because a single sentence saying "local-first"
// would be read as "nothing leaves my machine", and the transcript *does* go to
// an LLM. Saying so plainly here is worth more than any amount of marketing copy.
//
// Defaults persist through the existing SystemConfig KV — same mechanism as the
// telemetry toggle, a single JSON blob under `meeting.defaults`.

const CONFIG_KEY = 'meeting.defaults';

/** Mirrors `TextScript` in `apps/api/src/lib/meeting/script.ts`. */
export type TextScript = 'source' | 'simplified' | 'traditional';

export interface MeetingDefaults {
  source: 'mic' | 'mic+system';
  lang: string;
  /** Which script Chinese transcripts are written in. Default: `simplified`. */
  textScript: TextScript;
  retentionDays: number;
  /** Windows toast when an action item falls due / a meeting is still open. */
  remindersEnabled: boolean;
  /** Days after a meeting before the "still open" review reminder fires. */
  followUpReminderDays: number;
}

const DEFAULTS: MeetingDefaults = {
  source: 'mic+system',
  lang: 'auto',
  textScript: 'simplified',
  retentionDays: 30,
  remindersEnabled: true,
  followUpReminderDays: 3,
};

const card: CSSProperties = { marginBottom: 10 };
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' };
const label: CSSProperties = { fontSize: 12, color: 'var(--ink)', minWidth: 150 };

function fmtBytes(n: number): string {
  if (!n) return '0';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function MeetingTab() {
  const lang = useLang();
  const [defaults, setDefaults] = useState<MeetingDefaults>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [bin, setBin] = useState<any>(null);
  const [models, setModels] = useState<any>(null);
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [download, setDownload] = useState<any>(null);
  const saveTimer = useRef(0);

  useEffect(() => {
    fetch('/api/system.getConfig?input=' + encodeURIComponent(JSON.stringify({ key: CONFIG_KEY })))
      .then((r) => r.json())
      .then((d) => {
        // `system.getConfig` returns the stored string itself, not `{value}` —
        // reading `.value` off it yielded undefined, so this card rendered
        // DEFAULTS forever and every `persist({...defaults, x})` wrote those
        // defaults back over whatever the other fields had been set to.
        const raw = d?.result?.data;
        if (typeof raw === 'string' && raw) setDefaults({ ...DEFAULTS, ...JSON.parse(raw) });
      })
      .catch(() => {});
    api.meeting
      .binStatus()
      .then(setBin)
      .catch(() => {});
    api.meeting
      .listModels()
      .then(setModels)
      .catch(() => {});
    api.meeting
      .consent()
      .then((r: any) => setConsentAt(r?.acknowledgedAt ?? null))
      .catch(() => {});
  }, []);

  const persist = (next: MeetingDefaults) => {
    setDefaults(next);
    fetch('/api/system.setConfig', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: CONFIG_KEY, value: JSON.stringify(next) }),
    }).catch(() => {});
    setSaved(true);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => setSaved(false), 1500);
  };

  // ─── Model download, streamed over the synthetic channel ───
  const startDownload = async (name: string) => {
    setDownload({ name, percent: 0, received: 0, total: 0, error: '' });
    const es = new EventSource('/api/meeting/stream?meetingId=model-download');
    es.addEventListener('model:progress', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (d.name !== name) return;
      setDownload({ name, percent: d.percent ?? 0, received: d.received ?? 0, total: d.total ?? 0, error: '' });
    });
    es.addEventListener('model:done', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (d.name !== name) return;
      es.close();
      setDownload(null);
      api.meeting
        .listModels()
        .then(setModels)
        .catch(() => {});
    });
    es.addEventListener('model:error', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (d.name !== name) return;
      es.close();
      setDownload({ name, percent: 0, received: 0, total: 0, error: String(d.error || '') });
    });
    const r: any = await api.meeting.downloadModel(name).catch((e: any) => ({ ok: false, error: e?.message }));
    if (r && r.ok === false) {
      es.close();
      // `busy` with the same name means a download we already streamed is fine.
      if (r.error !== 'busy') setDownload({ name, percent: 0, received: 0, total: 0, error: String(r.error) });
    }
  };

  const cancelDownload = async () => {
    await api.meeting.cancelDownload().catch(() => {});
    setDownload(null);
  };

  const removeModel = async (name: string) => {
    await api.meeting.deleteModel(name).catch(() => {});
    api.meeting
      .listModels()
      .then(setModels)
      .catch(() => {});
  };

  const catalog: any[] = models?.models || [];
  const installed: string[] = models?.active || [];
  // The app's one model. Looked up in the catalog rather than assumed, so this row
  // shows the real size and still renders if the catalog ever renames it.
  const base = catalog.find((m) => m.name === 'base');
  // Anything else on disk: an older version's download, or one made when choosing
  // was possible. Still used as a fallback, so it must not be deleted silently —
  // but it must be visible, or a 488 MB file becomes undeletable.
  const leftover = installed.filter((n) => n !== 'base');
  const sizeOf = (name: string) => catalog.find((m) => m.name === name)?.bytes || 0;
  const labelOf = (name: string) => catalog.find((m) => m.name === name)?.label || name;

  return (
    <div className="settings-content" style={{ padding: 12, overflowY: 'auto', height: '100%' }}>
      {/* ═══ Privacy — three separate claims, not one slogan ═══ */}
      <div className="card" style={card}>
        <div className="card-hd">{t('meeting.privacy.title', lang)}</div>
        <div className="card-bd" style={{ fontSize: 12, lineHeight: 1.8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
            <span>
              <strong>{t('meeting.privacy.audio', lang)}</strong> — {t('meeting.privacy.audioDetail', lang)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
            <span>
              <strong>{t('meeting.privacy.transcript', lang)}</strong> — {t('meeting.privacy.transcriptDetail', lang)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <span style={{ color: 'var(--amber)', fontWeight: 700 }}>⚠</span>
            <span style={{ color: 'var(--ink)' }}>
              <strong>{t('meeting.privacy.ai', lang)}</strong> — {t('meeting.privacy.aiDetail', lang)}
            </span>
          </div>
        </div>
      </div>

      {/* ═══ Local engine ═══ */}
      <div className="card" style={card}>
        <div className="card-hd">{t('meeting.settings.engine', lang)}</div>
        <div className="card-bd" style={{ fontSize: 12 }}>
          {bin?.ok ? (
            <span style={{ color: 'var(--green)' }}>
              {t('meeting.settings.engineOk', lang, { bytes: fmtBytes(bin.bytes), threads: bin.threads })}
            </span>
          ) : bin ? (
            <span style={{ color: 'var(--red)' }}>
              {t('meeting.settings.engineMissing', lang, { files: (bin.missing || []).join(', ') || '—' })}
            </span>
          ) : (
            <span className="text-ink-muted">{t('meeting.loading', lang)}</span>
          )}
        </div>
      </div>

      {/* ═══ Speech models ═══ */}
      <div className="card" style={card}>
        <div className="card-hd">{t('meeting.settings.models', lang)}</div>
        <div className="card-bd">
          <p className="text-ink-muted" style={{ fontSize: 11, lineHeight: 1.7, margin: '0 0 10px' }}>
            {t('meeting.settings.modelGuide', lang)}
          </p>
          {/* One row, because there is one model. No picker, no "best" badge, no
              "currently selected" highlight: all three existed to compare choices
              the user is not asked to make. */}
          {base && (
            <div style={{ ...row, padding: '6px 10px', marginLeft: -10, marginRight: -10 }}>
              <span style={{ ...label, minWidth: 110 }}>{base.label || base.name}</span>
              <span className="text-ink-muted" style={{ fontSize: 11, minWidth: 52 }}>
                {fmtBytes(base.bytes)}
              </span>
              <span className="text-ink-muted" style={{ fontSize: 10, flex: 1, minWidth: 200 }}>
                {t('meeting.settings.modelNote.base', lang)}
              </span>
              {installed.includes('base') ? (
                <>
                  <span style={{ fontSize: 11, color: 'var(--green)' }}>
                    ✓ {t('meeting.settings.modelInstalled', lang)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={!!download}
                    onClick={() => void removeModel('base')}
                  >
                    {t('meeting.settings.modelDelete', lang)}
                  </button>
                </>
              ) : download?.name === 'base' ? (
                <button type="button" className="btn btn-secondary btn-xs" onClick={() => void cancelDownload()}>
                  {t('meeting.settings.downloadCancel', lang)}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  disabled={!!download}
                  onClick={() => void startDownload('base')}
                >
                  {t('meeting.settings.modelDownload', lang)}
                </button>
              )}
            </div>
          )}

          {installed.length === 0 && (
            <p style={{ fontSize: 10, lineHeight: 1.7, color: 'var(--amber)', margin: '8px 0 0' }}>
              {t('meeting.settings.modelNoneWarn', lang)}
            </p>
          )}

          {/* ═══ Leftovers from when a model could be chosen ═══
              Listed so they can be deleted, not so they can be picked. Nothing
              here changes what runs: `base` is used whenever it is on disk. */}
          {leftover.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--edge)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
                {t('meeting.settings.modelsUnused', lang)}
              </div>
              <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.7, margin: '0 0 6px' }}>
                {t('meeting.settings.modelsUnusedNote', lang)}
              </p>
              {leftover.map((name) => (
                <div key={name} style={{ ...row, padding: '4px 10px', marginLeft: -10, marginRight: -10 }}>
                  <span style={{ ...label, minWidth: 110 }}>{labelOf(name)}</span>
                  <span className="text-ink-muted" style={{ fontSize: 11, minWidth: 52 }}>
                    {fmtBytes(sizeOf(name))}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={!!download}
                    onClick={() => void removeModel(name)}
                  >
                    {t('meeting.settings.modelDelete', lang)}
                  </button>
                </div>
              ))}
            </div>
          )}

          {download && !download.error && (
            <div style={{ marginTop: 6 }}>
              <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${download.percent}%`,
                    height: '100%',
                    background: 'var(--brand)',
                    transition: 'width var(--transition-base)',
                  }}
                />
              </div>
              <div className="text-ink-muted" style={{ fontSize: 10, marginTop: 3 }}>
                {t('meeting.settings.downloading', lang, { name: download.name, pct: download.percent })}
                {' · '}
                {t('meeting.settings.speed', lang, {
                  done: fmtBytes(download.received),
                  total: fmtBytes(download.total),
                })}
              </div>
            </div>
          )}

          {download?.error && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--red)' }}>
              {t('meeting.settings.downloadFailed', lang, { error: download.error })}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Recording defaults ═══ */}
      <div className="card" style={card}>
        <div className="card-hd">{t('meeting.settings.defaults', lang)}</div>
        <div className="card-bd">
          <div style={row}>
            <span style={label}>{t('meeting.settings.defaultSource', lang)}</span>
            <select
              className="form-select"
              value={defaults.source}
              onChange={(e) => persist({ ...defaults, source: e.target.value as MeetingDefaults['source'] })}
              style={{ fontSize: 12, maxWidth: 240 }}
            >
              <option value="mic+system">{t('meeting.source.both', lang)}</option>
              <option value="mic">{t('meeting.source.mic', lang)}</option>
            </select>
          </div>

          <div style={row}>
            <span style={label}>{t('meeting.settings.defaultLang', lang)}</span>
            <select
              className="form-select"
              value={defaults.lang}
              onChange={(e) => persist({ ...defaults, lang: e.target.value })}
              style={{ fontSize: 12, maxWidth: 240 }}
            >
              <option value="auto">auto</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </div>

          <div style={row}>
            <span style={label}>{t('meeting.settings.textScript', lang)}</span>
            <select
              className="form-select"
              value={defaults.textScript}
              onChange={(e) => persist({ ...defaults, textScript: e.target.value as TextScript })}
              style={{ fontSize: 12, maxWidth: 240 }}
            >
              <option value="simplified">{t('meeting.settings.script.simplified', lang)}</option>
              <option value="traditional">{t('meeting.settings.script.traditional', lang)}</option>
              <option value="source">{t('meeting.settings.script.source', lang)}</option>
            </select>
          </div>

          <div style={row}>
            <span style={label}>{t('meeting.settings.retention', lang)}</span>
            <input
              className="form-input"
              type="number"
              min={0}
              max={3650}
              value={defaults.retentionDays}
              onChange={(e) => persist({ ...defaults, retentionDays: Math.max(0, Number(e.target.value) || 0) })}
              style={{ fontSize: 12, maxWidth: 120 }}
            />
          </div>

          <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.7 }}>
            {t('meeting.settings.textScriptNote', lang)}
          </p>

          <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.7 }}>
            {t('meeting.settings.retentionNote', lang)}
          </p>

          <div style={{ ...row, marginTop: 10 }}>
            <span style={label}>{t('meeting.settings.reminders', lang)}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={defaults.remindersEnabled !== false}
                onChange={(e) => persist({ ...defaults, remindersEnabled: e.target.checked })}
              />
              {t('meeting.settings.remindersOn', lang)}
            </label>
          </div>

          {/* Only meaningful while reminders are on — leaving it editable would
              suggest a setting that does nothing. */}
          {defaults.remindersEnabled !== false && (
            <div style={row}>
              <span style={label}>{t('meeting.settings.followUpDays', lang)}</span>
              <input
                className="form-input"
                type="number"
                min={1}
                max={90}
                value={defaults.followUpReminderDays ?? 3}
                onChange={(e) =>
                  persist({ ...defaults, followUpReminderDays: Math.max(1, Number(e.target.value) || 1) })
                }
                style={{ fontSize: 12, maxWidth: 120 }}
              />
            </div>
          )}

          <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.7 }}>
            {t('meeting.settings.remindersNote', lang)}
          </p>

          {saved && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ {t('meeting.settings.saved', lang)}</span>}
        </div>
      </div>

      {/* ═══ Consent record ═══ */}
      <div className="card" style={card}>
        <div className="card-hd">{t('meeting.settings.consentSection', lang)}</div>
        <div className="card-bd" style={{ fontSize: 12 }}>
          <p style={{ lineHeight: 1.7, color: 'var(--ink)' }}>
            {consentAt
              ? t('meeting.settings.consentAt', lang, { date: consentAt.slice(0, 19).replace('T', ' ') })
              : t('meeting.settings.consentNever', lang)}
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 6 }}
            onClick={async () => {
              // The stored row is the real state — the date above and the recorder's
              // gate both read `SystemConfig`. Clearing in-memory only, as this used to,
              // was undone by the next read: the button looked dead because the date
              // never changed and a reload brought it back.
              await api.meeting.resetConsent().catch(() => {});
              const r: any = await api.meeting.consent().catch(() => null);
              setConsentAt(r?.acknowledgedAt ?? null);
              // Still worth telling the meeting panel, so an already-open recorder
              // hides its acknowledgement without waiting for a refetch.
              window.dispatchEvent(new CustomEvent('meeting-consent-reset'));
            }}
          >
            {t('meeting.settings.consentReset', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
