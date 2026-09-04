import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useLang } from '@/stores/useLang';
import { t, type I18NKey } from '@/lib/i18n';

// ═══ Hosted gateway account panel (P3 login / P5 quota; P6 deferred → subscription-intent survey) ═══
// Rendered inside Settings → LLM when the user picks the "托管试用" segment.
// All calls go through the local API (hosted.*) — the gateway token never
// reaches the renderer.

export interface HostedStatus {
  active: boolean;
  loggedIn: boolean;
  email: string;
  enabled: boolean;
}

interface Props {
  status: HostedStatus;
  /** Re-query the session from the backend after login/logout/enable/disable. */
  onChanged: () => void;
  /** Parent switches the segmented view back to BYOK. */
  onSwitchToByok: () => void;
}

const fmt = (n: number | null | undefined): string => '¥' + Number(n || 0).toFixed(2);
const planKey = (plan: string) => (plan === 'pro' ? 'hosted.planPro' : 'hosted.planTrial');
// Gateway error code → localized copy (mirrors the chat-side mapping in useSendMessage).
const GW_CODE_KEY: Record<string, I18NKey> = {
  feature_closed: 'hosted.errFeatureClosed',
  account_disabled: 'hosted.errAccountDisabled',
  model_not_allowed: 'hosted.errModelNotAllowed',
  not_configured: 'hosted.errNotConfigured',
  quota_exhausted: 'hosted.quotaExhausted',
};
const gwMsg = (lang: any, code?: string): string | null =>
  code && GW_CODE_KEY[code] ? t(GW_CODE_KEY[code], lang) : null;
type IntentAnswer = 'yes' | 'price' | 'undecided' | 'no';
const INTENT_OPTIONS: IntentAnswer[] = ['yes', 'price', 'undecided', 'no'];
const INTENT_LABEL: Record<IntentAnswer, I18NKey> = {
  yes: 'hosted.intentYes',
  price: 'hosted.intentPrice',
  undecided: 'hosted.intentUndecided',
  no: 'hosted.intentNo',
};

export function HostedPanel({ status, onChanged, onSwitchToByok }: Props) {
  const lang = useLang();
  // ─── Remote gateway config (feature switch + trial credit + QR) ───
  const [cfg, setCfg] = useState<any>(null);
  const [cfgErr, setCfgErr] = useState('');
  // ─── Usage / quota ───
  const [usage, setUsage] = useState<any>(null);
  const [usageErr, setUsageErr] = useState('');
  // ─── Login form ───
  const [email, setEmail] = useState(status.email || '');
  const [code, setCode] = useState('');
  const [resendSec, setResendSec] = useState(0);
  const [busy, setBusy] = useState('');
  const [formErr, setFormErr] = useState('');
  // ─── Future-subscription intent survey (P6 deferred — no signup/payment yet) ───
  const [intentSel, setIntentSel] = useState(''); // last submitted option
  const [intentBusy, setIntentBusy] = useState(''); // option currently in flight
  const [intentMsg, setIntentMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadConfig = async () => {
    const r: any = await api.hosted.config().catch(() => ({ ok: false, error: '' }));
    if (r?.ok) {
      setCfg(r.data);
      setCfgErr('');
    } else if (r?.error) {
      setCfgErr(r.error);
    }
  };

  const loadUsage = async (silent = false) => {
    const r: any = await api.hosted.usage().catch(() => ({ ok: false, error: '' }));
    if (r?.ok) {
      setUsage(r.data);
      setUsageErr('');
      return r.data;
    }
    if (r?.expired) {
      setFormErr(t('hosted.expired', lang));
      onChanged(); // session auto-cleared server-side → show login
      return null;
    }
    if (!silent && r?.error) setUsageErr(r.error);
    return null;
  };

  useEffect(() => {
    loadConfig();
    if (status.active) loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resendSec <= 0) return;
    const iv = setInterval(() => setResendSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(iv);
  }, [resendSec]);

  const sendCode = async () => {
    if (!email.trim()) return;
    setBusy('code');
    setFormErr('');
    const r: any = await api.hosted.sendCode(email.trim()).catch(() => ({ ok: false, error: '' }));
    if (r?.ok) {
      setResendSec(Math.max(r.resendAfterSec ?? 60, 30));
      setFormErr('');
    } else {
      setFormErr(gwMsg(lang, r?.code) || r?.error || t('hosted.networkError', lang));
    }
    setBusy('');
  };

  const login = async () => {
    if (!email.trim() || !/^\d{6}$/.test(code.trim())) {
      setFormErr('...');
      return;
    }
    setBusy('login');
    setFormErr('');
    const r: any = await api.hosted.verify(email.trim(), code.trim()).catch(() => ({ ok: false, error: '' }));
    if (r?.ok) {
      setCode('');
      setFormErr('');
      await onChanged();
      loadUsage();
    } else {
      setFormErr(gwMsg(lang, r?.code) || r?.error || t('hosted.networkError', lang));
    }
    setBusy('');
  };

  const enable = async () => {
    setBusy('enable');
    setFormErr('');
    const r: any = await api.hosted.enable().catch(() => ({ ok: false, error: '' }));
    if (r?.ok) {
      await onChanged();
      loadUsage();
    } else setFormErr(r?.error || '');
    setBusy('');
  };

  const disable = async () => {
    setBusy('disable');
    await api.hosted.disable().catch(() => {});
    setBusy('');
    onChanged();
    onSwitchToByok();
  };

  const logout = async () => {
    setBusy('logout');
    await api.hosted.logout().catch(() => {});
    setBusy('');
    onChanged(); // parent flips to byok too
    onSwitchToByok();
  };

  const submitIntent = async (answer: IntentAnswer) => {
    setIntentBusy(answer);
    setIntentMsg(null);
    const r: any = await api.hosted.submitIntent(answer).catch(() => ({ ok: false, error: '' }));
    if (r?.ok) {
      setIntentSel(answer);
      setIntentMsg({ ok: true, text: t('hosted.intentDone', lang) });
    } else {
      setIntentMsg({ ok: false, text: gwMsg(lang, r?.code) || r?.error || t('hosted.networkError', lang) });
    }
    setIntentBusy('');
  };

  const plan = usage?.plan || (status.active ? 'trial' : '');
  const planLabel = t(planKey(plan || 'trial'), lang);
  const trialCredit =
    cfg?.trialCreditCny != null ? t('hosted.trialCredit', lang, { n: fmt(cfg.trialCreditCny).replace('¥', '') }) : '';

  // ─── Not logged in → login form ───
  if (!status.loggedIn) {
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <b>{t('hosted.loginTitle', lang)}</b>
          {cfg?.featureOpen === false && (
            <span className="text-xs" style={{ color: 'var(--amber)' }}>
              {cfg?.upgradeNote || t('hosted.closedSettings', lang)}
            </span>
          )}
          {trialCredit && (
            <span className="text-xs" style={{ color: 'var(--brand)' }}>
              {trialCredit}
            </span>
          )}
        </div>
        <p className="text-xs text-ink-muted" style={{ marginBottom: 10 }}>
          {t('hosted.loginDesc', lang)}
        </p>
        {cfgErr && (
          <p className="text-xs" style={{ color: 'var(--amber)', marginBottom: 6 }}>
            {cfgErr}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="form-grp" style={{ flex: 2 }}>
            <label className="form-label">{t('hosted.emailLabel', lang)}</label>
            <input
              className="form-input"
              type="email"
              value={email}
              placeholder={t('hosted.emailPlaceholder', lang)}
              onChange={(e) => {
                setEmail(e.target.value);
                setFormErr('');
              }}
            />
          </div>
          <button
            className="btn btn-sm"
            style={{ background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--edge)' }}
            onClick={sendCode}
            disabled={busy === 'code' || resendSec > 0 || !email.trim()}
          >
            {resendSec > 0
              ? t('hosted.resendIn', lang, { n: String(resendSec) })
              : busy === 'code'
                ? '…'
                : t('hosted.sendCode', lang)}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="form-grp" style={{ flex: 1 }}>
            <label className="form-label">{t('hosted.codeLabel', lang)}</label>
            <input
              className="form-input"
              value={code}
              placeholder={t('hosted.codePlaceholder', lang)}
              maxLength={6}
              inputMode="numeric"
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                setFormErr('');
              }}
            />
          </div>
          <button
            className="btn btn-brand btn-sm"
            onClick={login}
            disabled={busy === 'login' || !/^\d{6}$/.test(code.trim())}
          >
            {busy === 'login' ? '…' : t('hosted.login', lang)}
          </button>
        </div>
        {formErr && (
          <p className="text-xs" style={{ color: 'var(--brand)', marginTop: 6 }}>
            {formErr}
          </p>
        )}
      </div>
    );
  }

  // ─── Logged in but not routing → offer to re-enable ───
  if (!status.enabled) {
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <b>{t('hosted.activeTitle', lang)}</b>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {status.email}
          </span>
        </div>
        <p className="text-xs text-ink-muted" style={{ marginBottom: 10 }}>
          {t('hosted.signedInBanner', lang, { email: status.email })}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-brand btn-sm" onClick={enable} disabled={busy === 'enable'}>
            {t('hosted.useHosted', lang)}
          </button>
          <button className="btn btn-sm" onClick={logout} disabled={busy === 'logout'}>
            {t('hosted.logout', lang)}
          </button>
        </div>
      </div>
    );
  }

  // ─── Active hosted account → quota + subscription-intent survey ───
  const isPro = plan === 'pro';
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <b>{t('hosted.activeTitle', lang)}</b>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {status.email}
        </span>
        <span
          className="badge"
          style={{
            background: isPro ? 'var(--brand)' : 'var(--surface2)',
            color: isPro ? 'var(--on-accent)' : 'var(--ink)',
            padding: '1px 8px',
            borderRadius: 10,
            fontSize: 11,
          }}
        >
          {planLabel}
        </span>
      </div>
      {cfg?.featureOpen === false && (
        <p className="text-xs" style={{ color: 'var(--amber)', marginBottom: 8 }}>
          {t('hosted.closedSettings', lang)}
        </p>
      )}

      <div className="form-grp" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
        {!isPro && (
          <div>
            <div className="form-label" style={{ margin: 0, color: 'var(--muted)' }}>
              {t('hosted.balance', lang)}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{fmt(usage?.remainingCny ?? cfg?.trialCreditCny)}</div>
          </div>
        )}
        <div>
          <div className="form-label" style={{ margin: 0, color: 'var(--muted)' }}>
            {t('hosted.used', lang)}
          </div>
          <div style={{ fontSize: 18 }}>{fmt(usage?.usedCny)}</div>
        </div>
        <div>
          <div className="form-label" style={{ margin: 0, color: 'var(--muted)' }}>
            {t('hosted.totalCost', lang)}
          </div>
          <div style={{ fontSize: 18 }}>{fmt(usage?.totalCostCny)}</div>
        </div>
        <div>
          <div className="form-label" style={{ margin: 0, color: 'var(--muted)' }}>
            {t('hosted.requests', lang)}
          </div>
          <div style={{ fontSize: 18 }}>{usage?.requestCount ?? '…'}</div>
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
        {t('hosted.tokens', lang)}:{' '}
        {usage?.promptTokens != null
          ? `${usage.promptTokens.toLocaleString()} / ${(usage.completionTokens || 0).toLocaleString()}`
          : '…'}
      </div>
      {usageErr && (
        <p className="text-xs" style={{ color: 'var(--amber)', marginBottom: 6 }}>
          {usageErr}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          className="btn btn-sm"
          style={{ background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--edge)' }}
          onClick={() => {
            setUsageErr('');
            loadUsage();
          }}
        >
          {t('hosted.refresh', lang)}
        </button>
        <button
          className="btn btn-sm"
          onClick={disable}
          disabled={busy === 'disable'}
          title={t('hosted.switchToByok', lang)}
        >
          {t('hosted.switchToByok', lang)}
        </button>
        <button className="btn btn-sm" onClick={logout} disabled={busy === 'logout'}>
          {t('hosted.logout', lang)}
        </button>
      </div>

      {!isPro && (
        <div style={{ borderTop: '1px solid var(--edge)', paddingTop: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('hosted.intentTitle', lang)}</div>
          <p className="text-xs text-ink-muted" style={{ marginBottom: 8 }}>
            {t('hosted.intentDesc', lang)}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            {INTENT_OPTIONS.map((a) => {
              const sel = intentSel === a;
              return (
                <button
                  key={a}
                  className="btn btn-sm"
                  disabled={!!intentBusy}
                  onClick={() => submitIntent(a)}
                  style={
                    sel
                      ? { background: 'var(--brand)', color: 'var(--on-accent)', border: '1px solid var(--brand)' }
                      : { background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--edge)' }
                  }
                >
                  {t(INTENT_LABEL[a], lang)}
                </button>
              );
            })}
          </div>
          {intentMsg && (
            <p className="text-xs" style={{ color: intentMsg.ok ? 'var(--green)' : 'var(--amber)', marginTop: 6 }}>
              {intentMsg.text}
            </p>
          )}
        </div>
      )}

      {formErr && (
        <p className="text-xs" style={{ color: 'var(--brand)', marginTop: 6 }}>
          {formErr}
        </p>
      )}
    </div>
  );
}
