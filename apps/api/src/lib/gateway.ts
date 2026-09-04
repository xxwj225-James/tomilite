// ═══ Hosted LLM gateway (optional third-state: ② free trial / ③ Pro) ═══
//
// The app normally talks directly to a model provider with the user's own API
// key (BYOK). When the user logs in with email + one-time code to the official
// gateway (tomatovector.com) the app instead routes LLM traffic through that
// gateway with a server-issued session token: no provider key is stored here,
// the gateway meters usage in ¥ and enforces trial/Pro state server-side.
//
// Design invariants (keep them):
//  - The gateway session token NEVER reaches the renderer; it lives only in
//    this process, stored AES-encrypted in SystemConfig (local DB).
//  - A session stays active only while `hosted.enabled` = '1' — "switch back
//    to BYOK" flips that flag and keeps the token so the user can return with
//    one click. `logout` deletes everything.
//  - BYOK users are completely unaffected: resolveLLM() returns the classic
//    active-provider config whenever no hosted session is enabled.
//  - No schema change: all state is SystemConfig KV.
import { prisma } from '@tomilite/database';
import { decrypt, encrypt } from './crypto.js';

export const HOSTED_TOKEN_KEY = 'hosted.token'; // AES ciphertext
export const HOSTED_EMAIL_KEY = 'hosted.email';
export const HOSTED_ENABLED_KEY = 'hosted.enabled'; // '1' | '0'

const GATEWAY_DEFAULT = 'https://tomatovector.com';
const CACHE_TTL_MS = 30_000;

// Hosted mode always locks DeepSeek — these two model names are on the gateway
// whitelist (deepseek-v4-flash / deepseek-v4-pro / -flash-vision-exp).
export const HOSTED_FLASH_MODEL = 'deepseek-v4-flash';
export const HOSTED_PRO_MODEL = 'deepseek-v4-pro';

/** Base origin of the LLM gateway (override for local testing / self-hosting). */
export function gatewayOrigin(): string {
  return (process.env.TL_LLM_GATEWAY_ORIGIN || GATEWAY_DEFAULT).replace(/\/+$/, '');
}

/** Chat-completions base URL used for hosted traffic (code appends '/chat/completions'). */
export function gatewayChatBase(): string {
  return gatewayOrigin() + '/api/llm/v1';
}

/** True when an endpoint behaves like DeepSeek (BYOK deepseek OR the gateway). */
export function isDeepseekEndpoint(baseUrl?: string | null): boolean {
  if (!baseUrl) return false;
  return (
    baseUrl.includes('deepseek') ||
    baseUrl.startsWith(gatewayChatBase()) ||
    baseUrl.startsWith(gatewayOrigin() + '/api/llm')
  );
}

// ─── Session cache ───
let sessionCache: { token: string; email: string; enabled: boolean } | null = null;
let sessionCachedAt = 0;

async function getCfg(key: string): Promise<string | null> {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key } });
    return cfg?.value ?? null;
  } catch {
    return null;
  }
}

async function setCfg(key: string, value: string) {
  try {
    await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  } catch {}
}

async function delCfg(key: string) {
  try {
    await prisma.systemConfig.deleteMany({ where: { key } });
  } catch {}
}

/** Force the in-memory session cache to refresh on the next read. */
export function invalidateHostedCache() {
  sessionCache = null;
  sessionCachedAt = 0;
}

async function readSession(): Promise<{ token: string; email: string; enabled: boolean } | null> {
  const now = Date.now();
  if (sessionCache && now - sessionCachedAt < CACHE_TTL_MS) return sessionCache;
  const [tokenCipher, email, enabled] = await Promise.all([
    getCfg(HOSTED_TOKEN_KEY),
    getCfg(HOSTED_EMAIL_KEY),
    getCfg(HOSTED_ENABLED_KEY),
  ]);
  if (!tokenCipher) {
    sessionCache = null;
    sessionCachedAt = now;
    return null;
  }
  let token = tokenCipher;
  try {
    const decrypted = await decrypt(tokenCipher);
    if (decrypted && decrypted !== tokenCipher && /^[0-9a-f]{40,80}$/.test(decrypted)) token = decrypted;
  } catch {}
  sessionCache = { token, email: email || '', enabled: enabled !== '0' };
  sessionCachedAt = now;
  return sessionCache;
}

/** Full cached session (decrypted token + email + enabled). Exposed for routers. */
export async function getHostedSession(): Promise<{ token: string; email: string; enabled: boolean } | null> {
  return readSession();
}

/** Is a hosted session present AND enabled (i.e. LLM traffic currently goes to the gateway)? */
export async function isHostedActive(): Promise<boolean> {
  const s = await readSession();
  return !!s?.token && s.enabled;
}

/** Store a freshly verified session and enable hosted mode immediately. */
export async function setHostedSession(token: string, email: string) {
  const cipher = await encrypt(token);
  await Promise.all([
    setCfg(HOSTED_TOKEN_KEY, cipher),
    setCfg(HOSTED_EMAIL_KEY, email),
    setCfg(HOSTED_ENABLED_KEY, '1'),
  ]);
  invalidateHostedCache();
}

/** '1' = route through gateway; '0' = back to BYOK (token kept for one-click return). */
export async function setHostedEnabled(enabled: boolean) {
  await setCfg(HOSTED_ENABLED_KEY, enabled ? '1' : '0');
  invalidateHostedCache();
}

export async function clearHostedSession() {
  await Promise.all([delCfg(HOSTED_TOKEN_KEY), delCfg(HOSTED_EMAIL_KEY), delCfg(HOSTED_ENABLED_KEY)]);
  invalidateHostedCache();
}

export interface LLMAccess {
  mode: 'hosted' | 'byok';
  baseUrl: string;
  /** Secret for Authorization: either the decrypted BYOK key or the gateway session token. */
  apiKey: string;
  /** Fast/classification model. Hosted → deepseek-v4-flash. */
  flashModel: string;
  /** Deep/main model. Hosted → deepseek-v4-pro. */
  proModel: string;
}

/**
 * Single seam for "which endpoint should this LLM call hit right now?"
 * Returns null when nothing is configured (no hosted session and no BYOK key) —
 * callers keep their existing "not configured" error handling.
 */
export async function resolveLLM(): Promise<LLMAccess | null> {
  const s = await readSession();
  if (s?.token && s.enabled) {
    return {
      mode: 'hosted',
      baseUrl: gatewayChatBase(),
      apiKey: s.token,
      flashModel: HOSTED_FLASH_MODEL,
      proModel: HOSTED_PRO_MODEL,
    };
  }

  // BYOK path — replicate the historical active-provider read exactly.
  try {
    const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
    if (!provider?.apiKey) return null;
    const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
    const cfg = await prisma.llmConfig.findFirst();
    const apiKey = await decrypt(provider.apiKey);
    if (!apiKey) return null;
    return {
      mode: 'byok',
      baseUrl: master?.apiBaseUrl || '',
      apiKey,
      flashModel: cfg?.flashModel || '',
      proModel: cfg?.proModel || cfg?.flashModel || '',
    };
  } catch {
    return null;
  }
}
