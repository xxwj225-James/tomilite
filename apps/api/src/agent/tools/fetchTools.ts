import { agentLog } from '../utils/logger.js';

// ═══ fetch_url — read one page ═══
//
// There was no way to open a URL at all: `web_search` queries Bing and returns
// {title, url, snippet} without ever fetching a result, and `curl`/`wget` are in
// the shell tool's BLOCKED_PROGRAMS. So "read what this link says" — the most
// ordinary request a chat assistant gets — was unanswerable, and the agent spent
// its turns guessing at `ls` / `grep` instead.
//
// Read-only, and deliberately narrow:
//   • http/https only
//   • local and private addresses refused, on every redirect hop, not just the
//     first URL — the API exempts localhost from its token check, so a page that
//     told the model to fetch http://127.0.0.1:3192/api/... would reach this
//     app's own tRPC surface. That is the one thing this must not enable.
//   • one URL per call, a 15s deadline, and both download and returned-text caps
//
// The response is data, never instruction. A fetched page can contain text that
// looks like an order to the model; that is why the tool description says so out
// loud and why nothing here auto-executes anything.

const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
/** Stop reading the body past this — a 4 GB file must not land in memory. */
const RAW_CAP = 800_000;
/** What the model actually receives. A README or doc page fits; a novel does not. */
const TEXT_CAP = 40_000;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/**
 * Literal-address and local-name check. A hostname that resolves to a private
 * address through DNS still gets through — undici resolves it again after this
 * runs, so a pre-check cannot be made sound without pinning the resolved IP.
 * This catches the realistic cases (an injected localhost/192.168 URL, a
 * redirect to one) and the comment says so rather than implying more.
 */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '::' || h === '::1' || h === '0.0.0.0') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost') || h.endsWith('.home.arpa')) {
    return true;
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  return false;
}

// ─── GitHub ───
//
// github.com serves repo, blob and tree pages client-side: the HTML contains
// GitHub's own navigation and neither the README body nor the file list (measured
// — searching the stripped text of a repo page for the README's first sentence
// finds nothing). Fetching those URLs as-is returns 15 KB of chrome, which is
// exactly as useless as not fetching them. So they are rewritten to endpoints
// that do return content.

interface GithubTarget {
  url: string;
  /** raw = a file's bytes; api = a directory listing as JSON; page = leave it alone */
  kind: 'raw' | 'api' | 'page';
  owner?: string;
  repo?: string;
  ref?: string;
  /** Path of the file within the repo, for resolving relative links. */
  path?: string;
}

export function githubTarget(u: URL): GithubTarget | null {
  if (u.hostname.replace(/^www\./, '').toLowerCase() !== 'github.com') return null;
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg.length < 2) return null;
  const [owner, repo, kind, ref, ...rest] = seg;

  // github.com/<owner>/<repo> → the README, which is the page a repo link means.
  if (!kind) {
    return {
      url: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`,
      kind: 'raw',
      owner,
      repo,
      ref: 'HEAD',
      path: 'README.md',
    };
  }
  if (kind === 'blob' || kind === 'raw') {
    if (!ref || !rest.length) return { url: u.toString(), kind: 'page' };
    const path = rest.join('/');
    return {
      url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
      kind: 'raw',
      owner,
      repo,
      ref,
      path,
    };
  }
  if (kind === 'tree') {
    const path = rest.join('/');
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return {
      url: `https://api.github.com/repos/${owner}/${repo}/contents/${path}${q}`,
      kind: 'api',
      owner,
      repo,
      ref: ref || 'HEAD',
      path,
    };
  }
  return { url: u.toString(), kind: 'page' };
}

/**
 * Make relative markdown links absolute. A README says `[How meetings
 * work](docs/meetings.md)`; passed back to fetch_url verbatim that becomes
 * `https://docs/meetings.md`, so the one link that answers the question is the
 * one link that cannot be followed. `baseDir` is the directory of the file the
 * markdown came from, since a nested README resolves against its own folder.
 */
export function absolutizeLinks(md: string, owner: string, repo: string, ref: string, baseDir: string): string {
  const base = `https://github.com/${owner}/${repo}/blob/${ref}/`;
  const dir = baseDir ? baseDir.replace(/\/+$/, '') + '/' : '';
  return md.replace(/\]\(([^)\s]+)\)/g, (whole, href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return whole;
    const abs = href.startsWith('/') ? `https://github.com${href}` : base + dir + href;
    return `](${abs})`;
  });
}

/** The contents API answers with JSON; a model reads a list far better than it reads `[{...}]`. */
function formatGithubListing(json: unknown, path: string, ref: string): string {
  const head = `GitHub directory listing: ${path || '/'} @${ref}`;
  if (Array.isArray(json)) {
    const lines = json.map((e: Record<string, unknown>) => {
      const name = String(e.name ?? '');
      if (e.type === 'dir') return `dir   ${name}/`;
      const size = Number(e.size ?? 0);
      return `file  ${name}  (${size < 1024 ? size + ' B' : (size / 1024).toFixed(1) + ' KB'})`;
    });
    return `${head}\n${lines.join('\n')}`;
  }
  const msg = (json as Record<string, unknown>)?.message;
  return `${head}\n${msg ? String(msg) : JSON.stringify(json)}`;
}

// ─── HTML → text ───

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/** Structure-preserving strip: block ends become newlines, list items become "- ". */
function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim());
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|pre|blockquote|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return { title, text: decodeEntities(text) };
}

/** Collapse the whitespace the tag strip leaves behind. */
function tidy(s: string): string {
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readBounded(resp: Response, cap: number): Promise<{ raw: string; truncated: boolean }> {
  const reader = resp.body?.getReader();
  if (!reader) return { raw: '', truncated: false };
  const decoder = new TextDecoder();
  let raw = '';
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    if (raw.length >= cap) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  raw += decoder.decode();
  return { raw: truncated ? raw.slice(0, cap) : raw, truncated };
}

/** JSON, but only if it really is JSON — a 404 page is HTML and must not blow up here. */
function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function fetchUrl(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const input = String(args.url ?? '').trim();
  if (!input) return { error: 'fetch_url requires a url.' };
  // A bare "github.com/x/y" is a URL in every sense but the parser's.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;

  let requested: URL;
  try {
    requested = new URL(withScheme);
  } catch {
    return { error: `Not a valid URL: ${withScheme}` };
  }
  const gh = githubTarget(requested);
  // Only the first URL is rewritten; a redirect target is followed as given (and
  // still checked for a private address on the way in).
  let target = gh ? gh.url : requested.toString();

  // One deadline for the whole chain, so five redirects cannot add up to 75s.
  const deadline = Date.now() + TIMEOUT_MS;

  try {
    for (let hop = 0; ; hop++) {
      let u: URL;
      try {
        u = new URL(target);
      } catch {
        return { error: `Not a valid URL: ${target}` };
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { error: `Only http and https are supported (got ${u.protocol.replace(':', '')}).` };
      }
      if (isLocalHost(u.hostname)) {
        return { error: `Refusing to fetch a local or private address (${u.hostname}).` };
      }

      const resp = await fetch(u, {
        redirect: 'manual',
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,application/json,*/*',
        },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });

      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location');
        await resp.body?.cancel().catch(() => {});
        if (!loc) return { error: `HTTP ${resp.status} redirect with no Location header.` };
        if (hop >= MAX_REDIRECTS) return { error: `More than ${MAX_REDIRECTS} redirects.` };
        target = new URL(loc, u).toString();
        continue;
      }

      const contentType = (resp.headers.get('content-type') || '').toLowerCase();
      const { raw, truncated: rawTruncated } = await readBounded(resp, RAW_CAP);

      let body: string;
      let title = '';
      if (gh?.kind === 'api') {
        body = formatGithubListing(tryJson(raw), gh.path || '', gh.ref || 'HEAD');
      } else if (gh?.kind === 'raw' && gh.owner && gh.repo) {
        const baseDir = (gh.path || '').split('/').slice(0, -1).join('/');
        body = absolutizeLinks(raw, gh.owner, gh.repo, gh.ref || 'HEAD', baseDir);
      } else {
        const isHtml = contentType.includes('html') || /^\s*<(?:!doctype|html)/i.test(raw);
        const parsed = isHtml ? htmlToText(raw) : { title: '', text: raw };
        title = parsed.title;
        body = parsed.text;
      }

      const full = tidy(body);
      const truncated = rawTruncated || full.length > TEXT_CAP;
      const notes = [
        // An HTTP error can still carry a useful page (a 404 page explains itself),
        // so it is returned rather than thrown away — with the status spelled out.
        resp.ok ? '' : `The server answered HTTP ${resp.status}.`,
        truncated ? `Content truncated to ${TEXT_CAP} characters.` : '',
        gh && gh.url !== requested.toString()
          ? `Fetched ${u.toString()} instead — ${requested.hostname} renders that page in the browser, so its HTML has no content in it.`
          : '',
      ].filter(Boolean);

      agentLog(
        '[fetch_url]',
        u.hostname,
        resp.status,
        contentType.split(';')[0],
        'chars=' + full.length,
        gh ? `gh=${gh.kind}` : '',
      );

      return {
        ok: resp.ok,
        url: requested.toString(),
        status: resp.status,
        contentType: contentType.split(';')[0] || 'unknown',
        title,
        chars: full.length,
        truncated,
        text: truncated ? full.slice(0, TEXT_CAP) : full,
        ...(notes.length ? { note: notes.join(' ') } : {}),
      };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      error: /abort|timeout/i.test(msg) ? `Fetch timed out after ${TIMEOUT_MS / 1000}s.` : `Fetch failed: ${msg}`,
    };
  }
}
