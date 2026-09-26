// ═══ System proxy detection (Windows registry) ═══
//
// Three registry values together answer one question — may this request go through the
// system proxy? — and this module used to read only the middle one:
//
//   ProxyEnable    whether the proxy is switched on
//   ProxyServer    its address, possibly per-scheme (`http=…;https=…`)
//   ProxyOverride  the bypass list (`localhost;127.*;…;<local>`)
//
// Reading `ProxyServer` alone is what produced "the agent answers but cannot search".
// When a user turns their proxy off, Windows sets `ProxyEnable` to 0 and **leaves
// `ProxyServer` behind** — so a stale `127.0.0.1:9674` stayed readable forever. Every
// `web_search` was posted into a port with nothing listening and came back `fetch
// failed` with an empty result list, which in the chat reads as "no matches" rather than
// as "the network is unreachable". The DeepSeek call kept working throughout because it
// is not proxied at all, which is exactly why the symptom looked like a search bug.
//
// The other two values were missing for the same reason and cost the same kind of
// failure: `ProxyOverride` was ignored, so a *working* proxy was ALSO applied to hosts
// the user had explicitly excluded (a local Redmine, TomiHub, `localhost`); and with no
// retry, a proxy that was enabled but not actually listening took the request down with
// it instead of being retried directly.
//
// One `reg query` reads all three — the query without `/v` dumps the whole key, so the
// values are matched out of one dump instead of paying for three spawns. Measured at
// 105–144 ms per spawn on the development machine, and that is why the read is cached: a
// Redmine sync paginates up to 50 requests, and 50 spawns is a visible stall. The TTL is
// short because this is a checkbox the user can flip while the app runs, and a stale
// "off" is only a missed optimisation while a stale "on" is the bug above. Same shape and
// same reasoning as the hosted-session cache in `lib/gateway.ts`.
// A static import, not the lazy `require` this used to be. `node:child_process` is a
// builtin and cannot fail to load, so the try/catch around it bought nothing — while the
// `require` itself made this file throwable from anything that loads it as ESM (the test
// below), which is one more way for a registry read to fail invisibly.
import { execSync } from 'node:child_process';
import { agentLog } from './logger.js';

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const CACHE_TTL_MS = 30_000;

export interface SystemProxy {
  /** Windows says the proxy is on. */
  enabled: boolean;
  /** Resolved address (`http://host:port`) — present only when enabled and configured. */
  url?: string;
  /** Lowercased `ProxyOverride` entries. `*` is a wildcard; `<local>` means "no dot". */
  bypass: string[];
}

let cache: { at: number; value: SystemProxy } | null = null;

/**
 * Pull the three values out of one `reg query` dump. Pure, so the shapes that share this
 * output — the key's own header, its subkey paths, and the unrelated value types in it
 * (`REG_QWORD`, `REG_BINARY`) — are pinned in `scripts/test-proxy.mts` rather than
 * assumed to be absent.
 */
export function parseRegistryDump(raw: string): { enable?: string; server?: string; override?: string } {
  // Anchored per line, so the header and the subkey paths cannot match a value name.
  const value = (name: string): string | undefined =>
    raw.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'im'))?.[1]?.trim();
  return { enable: value('ProxyEnable'), server: value('ProxyServer'), override: value('ProxyOverride') };
}

/** Read the three proxy values off this machine. Never throws. */
function readRegistry(): { enable?: string; server?: string; override?: string } {
  if (process.platform !== 'win32') return {};
  try {
    const raw = execSync(`reg query "${REG_KEY}" 2>nul`, { encoding: 'utf8', timeout: 3000, windowsHide: true });
    return parseRegistryDump(raw);
  } catch {
    return {}; // no reg.exe, no hive access, or the query timed out
  }
}

/**
 * `ProxyServer` may hold one address or one per scheme (`http=…;https=…`), which is why
 * splitting on `;` is not enough — the first entry can be the `socks=` one, which this
 * app cannot use. Prefer what this app actually speaks: https first, then http, then a
 * bare address. A `socks=`-only configuration resolves to nothing and the request goes
 * direct, which is the honest outcome for a proxy we cannot talk to.
 */
function pickServer(raw: string): string | undefined {
  const entries = raw
    .split(';')
    .map((e) => e.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  const schemeOf = (e: string) => (/^([a-z0-9]+)=/i.exec(e)?.[1] || '').toLowerCase();
  const strip = (e: string) => e.replace(/^[a-z0-9]+=/i, '');
  const chosen =
    entries.find((e) => schemeOf(e) === 'https') ??
    entries.find((e) => schemeOf(e) === 'http') ??
    entries.find((e) => !schemeOf(e));
  if (!chosen || schemeOf(chosen) === 'socks') return undefined;
  const value = strip(chosen);
  if (!value) return undefined;
  return /^https?:\/\//i.test(value) ? value : 'http://' + value;
}

/** The effective proxy, from the environment or the registry. Cached for `CACHE_TTL_MS`. */
export function systemProxy(): SystemProxy {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  // An explicit env var is the developer's own override and outranks the registry. It is
  // also the only source off Windows, where there is no registry to read.
  const env = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (env) {
    cache = { at: now, value: { enabled: true, url: /^https?:\/\//i.test(env) ? env : 'http://' + env, bypass: [] } };
    return cache.value;
  }

  cache = { at: now, value: proxyFromRegistry(readRegistry()) };
  return cache.value;
}

/**
 * The decision, pure: a parsed registry dump → the proxy to use.
 *
 * Exported so the exact regression this file exists for — `ProxyEnable` reads `0x0` while
 * `ProxyServer` still holds an address — is asserted in a test, instead of being left to
 * whoever happens to own the machine running it.
 */
export function proxyFromRegistry(reg: { enable?: string; server?: string; override?: string }): SystemProxy {
  // `ProxyEnable` is a REG_DWORD: `0x1` when on, `0x0` when off. Missing reads as off,
  // which is the safe direction — a direct request is what a proxy-less machine wants.
  const enabled = Number.parseInt(reg.enable ?? '0', 16) === 1;
  const url = enabled && reg.server ? pickServer(reg.server) : undefined;
  const bypass = (reg.override ?? '')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return { enabled: !!url, url, bypass };
}

/** Does `host:port` match one `ProxyOverride` entry? */
function matchesBypass(host: string, port: string, entry: string): boolean {
  if (!entry) return false;
  // `<local>` is not a hostname — it is Windows' shorthand for "any name with no dot in
  // it", which is how an intranet host is told apart from an internet one.
  if (entry === '<local>') return !host.includes('.');

  // A port may be appended to an entry, and is compared only when the entry carries one.
  // The `]` guard keeps an IPv6 literal's colons out of it.
  let pattern = entry;
  let entryPort = '';
  const colon = entry.lastIndexOf(':');
  if (colon > entry.lastIndexOf(']')) {
    const tail = entry.substring(colon + 1);
    if (/^\d+$/.test(tail)) {
      pattern = entry.substring(0, colon);
      entryPort = tail;
    }
  }
  if (entryPort && entryPort !== port) return false;
  if (pattern === host) return true;
  // An entry with no wildcard also covers subdomains, which is what a user typing
  // `corp.example.com` means by it.
  if (!pattern.includes('*') && host.endsWith('.' + pattern)) return true;
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(host);
}

/**
 * Should a request to `targetUrl` skip the proxy? Pure — the matching rules below are
 * the fiddly part of this file, so they are exported to be tested directly
 * (`scripts/test-proxy.mts`) rather than only through a live registry.
 */
export function bypassesProxy(targetUrl: string, bypass: string[]): boolean {
  let host: string;
  let port: string;
  try {
    const u = new URL(targetUrl);
    host = u.hostname.toLowerCase();
    // The scheme's default port, so an entry written as `example.com:80` matches
    // `http://example.com/` — which is what a user means by it, and what Windows does.
    port = u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '');
  } catch {
    return false; // unparseable target: leave the decision as it was before
  }

  // Loopback is never proxied, whatever the override list says. `localhost;127.*;<local>`
  // is Windows' default and covers this, but an empty list must not be able to send a
  // request to this machine's own service out through a remote proxy.
  if (host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host)) return true;

  return bypass.some((entry) => matchesBypass(host, port, entry));
}

/**
 * Proxy to use for `targetUrl`, or `undefined` to go direct.
 *
 * With no argument the target's host is not consulted — callers that already gate on the
 * provider (the OpenAI/Anthropic branches) only need the "is a proxy on at all" answer.
 */
export function getProxyUrl(targetUrl?: string): string | undefined {
  const p = systemProxy();
  if (!p.url) return undefined;
  if (targetUrl && bypassesProxy(targetUrl, p.bypass)) return undefined;
  return p.url;
}

// ─── Requests ───

let agentCache: { url: string; agent: unknown } | null = null;

/** A `ProxyAgent` for `proxyUrl`, reused so one socket pool serves every request. */
function proxyAgentFor(proxyUrl: string): unknown {
  if (agentCache?.url === proxyUrl) return agentCache.agent;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional dep loaded lazily
    const { ProxyAgent } = require('undici');
    agentCache = { url: proxyUrl, agent: new ProxyAgent(proxyUrl) };
    return agentCache.agent;
  } catch {
    // undici unavailable. The request is sent anyway and fails loudly rather than
    // silently ignoring a proxy the user asked for.
    return null;
  }
}

/**
 * Codes that mean "nothing was listening" or "the name did not resolve" — the class of
 * failure a dead proxy produces and a direct retry can fix.
 *
 * Deliberately NOT included: a timeout. `AbortSignal.timeout` surfaces as a
 * `TimeoutError` DOMException rather than a `TypeError`, and OS-level connect timeouts
 * are longer than the budget every caller here passes, so a *slow* proxy can never be
 * mistaken for a dead one and retried — which would silently double the wait.
 */
const CONNECTION_FAILURES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
]);

export function isConnectionFailure(e: unknown): boolean {
  const code = (e as { cause?: { code?: unknown }; code?: unknown })?.cause?.code ?? (e as { code?: unknown })?.code;
  return typeof code === 'string' && CONNECTION_FAILURES.has(code);
}

/**
 * One request, through the system proxy when one applies to `url`, and once more without
 * it if that attempt never reached anyone.
 *
 * Used by the tools that fetch an arbitrary host on the user's behalf. Those are the
 * calls whose failure is otherwise invisible — an empty result list reads as "no
 * matches", not as "the network is unreachable" — so they are the ones that must not be
 * taken down by a proxy the user is no longer running.
 *
 * `timeoutMs` is this function's business and not the caller's: one budget covers the
 * whole call, so a retry cannot double how long a dead proxy can hang a turn.
 */
export async function fetchWithProxyFallback(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  // `any` for the same reason the other fetch sites in this repo use it: `dispatcher` is
  // undici's own extension to `RequestInit`, so it has no type in the standard library.
  const opts: any = { ...init, signal: AbortSignal.timeout(timeoutMs) };
  const proxyUrl = getProxyUrl(url);
  const dispatcher = proxyUrl ? proxyAgentFor(proxyUrl) : null;
  if (!dispatcher) return fetch(url, opts);
  try {
    return await fetch(url, { ...opts, dispatcher });
  } catch (e) {
    if (!isConnectionFailure(e)) throw e;
    const code = (e as { cause?: { code?: string } })?.cause?.code ?? '';
    agentLog('[proxy] unreachable', proxyUrl, code, '— retrying direct');
    // `opts` carries no dispatcher, so this attempt is a plain direct request.
    return fetch(url, opts);
  }
}
