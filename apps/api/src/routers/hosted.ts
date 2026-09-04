// ═══ Hosted gateway account router (P3/P5 client surface; P6 deferred → subscription-intent survey) ═══
//
// Thin proxy between the renderer and the official LLM gateway
// (https://tomatovector.com/api/llm/*). The renderer has no direct internet and
// never sees the gateway token — everything flows through the local API, which
// holds the session (see lib/gateway.ts).
//
// All procedures return {ok:true,...} / {ok:false, code?, error} instead of
// throwing tRPC errors: the renderer's api.ts throws on non-2xx and would drop
// the server message, so remote failures travel back as data.
import { router, publicProcedure, z } from '../trpc';
import {
  gatewayOrigin,
  isHostedActive,
  getHostedSession,
  setHostedSession,
  setHostedEnabled,
  clearHostedSession,
  invalidateHostedCache,
} from '../lib/gateway.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONFIG_CACHE_MS = 60_000;
let configCache: { data: any; at: number; origin: string } | null = null;

interface RemoteResult {
  status: number;
  data: any;
}

async function remote(
  path: string,
  opts: { method?: string; json?: unknown; token?: string } = {},
): Promise<RemoteResult> {
  const url = gatewayOrigin() + path;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
  const resp = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
    signal: AbortSignal.timeout(15_000),
  });
  let data: any = null;
  const text = await resp.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 300) };
    }
  }
  return { status: resp.status, data: data || {} };
}

function errResult(e: any): { ok: false; error: string } {
  const msg = String(e?.message || e);
  const offline = msg.includes('fetch failed') || msg.includes('timed out') || msg.includes('abort');
  return { ok: false, error: offline ? 'Unable to reach the hosted gateway. Check your network and try again.' : msg };
}

/** Public gateway config (feature switch, models, trial credit, QR/upgrade copy). Cached 60s. */
async function fetchConfig(): Promise<{ ok: boolean; data?: any; error?: string }> {
  const origin = gatewayOrigin();
  const now = Date.now();
  if (configCache && now - configCache.at < CONFIG_CACHE_MS && configCache.origin === origin) {
    return { ok: true, data: configCache.data };
  }
  try {
    const { status, data } = await remote('/api/llm/config');
    if (status !== 200 || !data) return { ok: false, error: data?.error || `Gateway config HTTP ${status}` };
    configCache = { data, at: now, origin };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: errResult(e).error };
  }
}

export const hostedRouter = router({
  /** Local session presence (no network). loggedIn = a session token exists (even if routing disabled). */
  status: publicProcedure.query(async () => {
    const active = await isHostedActive();
    const s = await getHostedSession();
    return { active, loggedIn: !!s?.token, email: s?.email || '', enabled: s?.enabled ?? false };
  }),

  /** Gateway /api/llm/config (feature switch + models + QR copy). */
  config: publicProcedure.query(async () => {
    const r = await fetchConfig();
    return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
  }),

  sendCode: publicProcedure.input(z.object({ email: z.string() })).mutation(async ({ input }) => {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 120) return { ok: false, error: 'Invalid email address' };
    try {
      const { status, data } = await remote('/api/llm/account/send-code', { method: 'POST', json: { email } });
      if (status === 200) return { ok: true, resendAfterSec: data?.resendAfterSec ?? 60 };
      return {
        ok: false,
        code: data?.code,
        resendAfterSec: data?.resendAfterSec,
        error: data?.error || `Gateway send-code HTTP ${status}`,
      };
    } catch (e) {
      return errResult(e);
    }
  }),

  verify: publicProcedure.input(z.object({ email: z.string(), code: z.string() })).mutation(async ({ input }) => {
    const email = input.email.trim().toLowerCase();
    const code = input.code.trim();
    if (!EMAIL_RE.test(email) || email.length > 120) return { ok: false, error: 'Invalid email address' };
    if (!/^\d{6}$/.test(code)) return { ok: false, code: 'invalid_code', error: 'Verification code must be 6 digits' };
    try {
      const { status, data } = await remote('/api/llm/account/verify', { method: 'POST', json: { email, code } });
      if (status === 200 && data?.token) {
        await setHostedSession(String(data.token), email);
        return { ok: true, plan: data.plan || 'trial', creditCny: data.creditCny, models: data.models || [] };
      }
      return {
        ok: false,
        code: data?.code,
        attemptsLeft: data?.attemptsLeft,
        error: data?.error || `Gateway verify HTTP ${status}`,
      };
    } catch (e) {
      return errResult(e);
    }
  }),

  /** Live quota/status from the gateway. Auto-drops the session when it expired (401). */
  usage: publicProcedure.query(async () => {
    const s = await getHostedSession();
    if (!s?.token) return { ok: false, error: 'Not logged in' };
    try {
      const { status, data } = await remote('/api/llm/account/usage', { token: s.token });
      if (status === 200) return { ok: true, data };
      if (status === 401) {
        await clearHostedSession();
        return { ok: false, expired: true, error: data?.error || 'Session expired — please log in again.' };
      }
      return { ok: false, code: data?.code, error: data?.error || `Gateway usage HTTP ${status}` };
    } catch (e) {
      // keep session on network failure — it may be a transient blip
      return errResult(e);
    }
  }),

  /** Re-enable hosted routing without re-login (token kept). */
  enableHosted: publicProcedure.mutation(async () => {
    const s = await getHostedSession();
    if (!s?.token) return { ok: false, error: 'Not logged in' };
    await setHostedEnabled(true);
    return { ok: true };
  }),

  /** Switch back to BYOK. Token is kept so the user can return with one click. */
  disableHosted: publicProcedure.mutation(async () => {
    await setHostedEnabled(false);
    invalidateHostedCache();
    return { ok: true };
  }),

  /** Forget the account entirely (clears token + email + enabled). */
  logout: publicProcedure.mutation(async () => {
    await clearHostedSession();
    return { ok: true };
  }),

  /** Record a future-subscription willingness vote (one per account, re-vote overwrites). */
  submitIntent: publicProcedure
    .input(z.object({ answer: z.enum(['yes', 'price', 'undecided', 'no']) }))
    .mutation(async ({ input }) => {
      const s = await getHostedSession();
      if (!s?.token) return { ok: false, error: 'Not logged in' };
      try {
        const { status, data } = await remote('/api/llm/intent', {
          method: 'POST',
          json: { answer: input.answer },
          token: s.token,
        });
        if (status === 200) return { ok: true, answer: data?.answer || input.answer };
        return { ok: false, code: data?.code, error: data?.error || `Gateway intent HTTP ${status}` };
      } catch (e) {
        return errResult(e);
      }
    }),
});
