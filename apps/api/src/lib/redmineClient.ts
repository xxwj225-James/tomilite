// ═══ Redmine REST client ═══
//
// One job: turn a base URL + API key + query into Redmine's JSON, and turn every way
// that can fail into a sentence the settings panel can show. The sync algorithm lives
// in `routers/redmine.ts`; nothing in here knows what an Issue row looks like.
//
// Error shape follows `routers/hosted.ts`: HTTP failures come back as data
// (`{ status, data }`) rather than exceptions, because the renderer's `api.ts` throws on
// a non-2xx and would replace Redmine's own message with a generic one. Only network
// failures — DNS, refused connection, timeout — throw.

import { fetchWithProxyFallback } from '../agent/utils/proxy.js';

/** Redmine's own maximum. Asking for more gets you 100. */
export const PAGE_SIZE = 100;

/**
 * Wider than `hosted.ts`'s 15 s because the target here is a company Redmine behind a
 * reverse proxy, often on a VPN, and a first sync pulls up to 5000 rows through it.
 */
const TIMEOUT_MS = 30_000;

export interface RedmineResponse {
  status: number;
  data: any;
}

/**
 * A base URL the user typed, or `null` if it cannot be one.
 *
 * Deliberately permissive about the path — `http://host/redmine` is a normal deployment
 * and the API lives under it — and strict about everything else, because this string is
 * concatenated with a path and handed to `fetch`. Rejecting a query, fragment or
 * embedded credentials keeps a pasted browser URL (`.../issues?query_id=3`) from
 * silently becoming a base whose every request 404s.
 */
export function normalizeBaseUrl(raw: string): string | null {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.search || u.hash) return null;
  if (u.username || u.password) return null;
  return trimmed;
}

/**
 * What to tell the user about an HTTP status.
 *
 * The interesting case is 403. A Redmine administrator can switch the whole REST API
 * off (`Administration → Settings → API → Enable REST web service`), and the server then
 * answers API requests with **403 and an HTML login page** rather than JSON. So a 403
 * here usually does not mean "your key lacks permission for this resource" — it means
 * there is no API to talk to. Saying so out loud is the difference between a user
 * checking their key forever and a user asking their admin to tick a box.
 */
export function describeStatus(status: number, data: any): string {
  const body = typeof data?.raw === 'string' && data.raw ? ` — ${data.raw.slice(0, 160).replace(/\s+/g, ' ')}` : '';
  if (status === 401) return 'Redmine rejected the API key (HTTP 401). Check that the key is current and belongs to this server.';
  if (status === 403)
    return 'Redmine refused the request (HTTP 403). The REST API is often disabled server-wide — an administrator has to enable it in Settings → API.';
  if (status === 404) return 'Redmine has no such endpoint (HTTP 404). Check the base URL — it should be the server root, such as http://redmine.example.com.';
  if (status === 422) return `Redmine rejected the query (HTTP 422)${body}`;
  if (status >= 500) return `Redmine returned a server error (HTTP ${status})${body}`;
  return `Redmine returned HTTP ${status}${body}`;
}

/** True for the errors `fetch` raises when the request never reached a server. */
export function isNetworkError(e: unknown): boolean {
  const msg = String((e as any)?.message || e).toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('abort') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('certificate')
  );
}

// ═══ Proxy ═══
//
// Corporate Redmines are frequently only reachable through the system proxy, so leaving
// it out is not a missing nicety: for those users the connector does not work at all.
// The registry read and the `ProxyAgent` are both cached inside `utils/proxy.ts` — one
// sync is up to 50 pages, and 50 process spawns is a visible stall.
//
// A self-hosted Redmine on `localhost` or `127.0.0.1` is the other half of this: it is
// on the system bypass list, and going through a proxy to reach the machine's own
// service cannot work. Both directions are `fetchWithProxyFallback`'s job now.


/**
 * One GET. Throws only if the request never completed; an HTTP error status is a
 * successful call with a bad answer, and comes back in the result.
 *
 * Non-JSON bodies are kept as `{ raw }` — see `describeStatus` for why 403 is expected
 * to arrive as HTML.
 */
export async function apiGet(
  baseUrl: string,
  apiKey: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<RedmineResponse> {
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  const resp = await fetchWithProxyFallback(url.toString(), TIMEOUT_MS, {
    method: 'GET',
    headers: {
      'X-Redmine-API-Key': apiKey,
      Accept: 'application/json',
    },
  });
  const text = await resp.text().catch(() => '');
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 300).replace(/\s+/g, ' ') };
    }
  }
  return { status: resp.status, data: data ?? {} };
}

// ═══ The calls ═══
//
// Each returns `{ ok: true, … }` or `{ ok: false, error }`, so the caller never has to
// remember which status codes matter for which endpoint.

type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string };

async function get<T extends object>(
  baseUrl: string,
  apiKey: string,
  path: string,
  params: Record<string, string | number | undefined>,
  pick: (data: any) => T | null,
): Promise<Outcome<T>> {
  try {
    const { status, data } = await apiGet(baseUrl, apiKey, path, params);
    if (status !== 200) return { ok: false, error: describeStatus(status, data) };
    const picked = pick(data);
    if (!picked) return { ok: false, error: `Redmine's answer to ${path} was not in the expected shape.` };
    return { ok: true, ...picked };
  } catch (e) {
    return { ok: false, error: isNetworkError(e) ? `Could not reach ${baseUrl}. Check the address, the network, and any VPN.` : String((e as any)?.message || e) };
  }
}

/** The identity check: 200 proves both the address and the key. Used by testConnection. */
export function fetchCurrentUser(baseUrl: string, apiKey: string) {
  return get(baseUrl, apiKey, '/users/current.json', {}, (d) => (d?.user ? { user: d.user } : null));
}

/** Trackers and statuses are what decide a ticket's type and status — see redmineMap.ts. */
export function fetchTrackers(baseUrl: string, apiKey: string) {
  return get(baseUrl, apiKey, '/trackers.json', {}, (d) => (Array.isArray(d?.trackers) ? { trackers: d.trackers } : null));
}

export function fetchIssueStatuses(baseUrl: string, apiKey: string) {
  return get(baseUrl, apiKey, '/issue_statuses.json', {}, (d) =>
    Array.isArray(d?.issue_statuses) ? { statuses: d.issue_statuses } : null,
  );
}

/**
 * Priorities, which may legitimately not be readable.
 *
 * `/enumerations/issue_priorities.json` is admin-only on some Redmine versions and
 * configurations. That is not a reason to fail a sync: an unreadable priority just means
 * every ticket keeps Redmine's own default, which is exactly what `mapPriority`'s
 * fallback already does. Returning `[]` here turns a permissions problem into "all
 * tickets are normal priority" instead of "the connector does not work".
 */
export async function fetchPriorities(baseUrl: string, apiKey: string): Promise<{ ok: true; priorities: any[] } | { ok: false; error: string }> {
  const r = await get(baseUrl, apiKey, '/enumerations/issue_priorities.json', {}, (d) =>
    Array.isArray(d?.issue_priorities) ? { priorities: d.issue_priorities } : null,
  );
  return r.ok ? r : { ok: true, priorities: [] };
}

export function fetchProjects(baseUrl: string, apiKey: string) {
  return get(baseUrl, apiKey, '/projects.json', { limit: PAGE_SIZE }, (d) =>
    Array.isArray(d?.projects) ? { projects: d.projects, totalCount: d.total_count ?? d.projects.length } : null,
  );
}

export interface IssueQuery {
  projectId?: string | number;
  assignedToId?: string | number;
  /** Verbatim from the previous sync's cursor. Redmine requires `YYYY-MM-DDTHH:MM:SSZ`. */
  updatedSince?: string;
  offset?: number;
  limit?: number;
}

/**
 * One page of issues.
 *
 * ## `status_id=*` is not optional
 *
 * Redmine's issues index returns **open issues only** unless told otherwise. Without
 * this, every closed ticket on the server would be invisible to the sync — and since
 * closure is the one thing `mapStatus` trusts, the effect would be a task board where
 * nothing is ever finished and a completion rate pinned near zero. The parameter means
 * "every status", and it is also why the sync does not need to know the status
 * vocabulary in order to ask a complete question.
 *
 * ## `sort=updated_on:desc`, and why not ascending
 *
 * Paging by offset over a list that other people are editing is never perfectly stable;
 * the question is which way it breaks. Sorted **descending**, any ticket updated during
 * the pass moves toward the front — into the region already read — which pushes unread
 * tickets later. The failure mode is re-reading rows, and re-reading is free here: the
 * write is an upsert keyed on `(source, sourceId)`. Sorted ascending, the same edit
 * moves the ticket past the read cursor, and because the cursor is then set to the
 * pass's maximum `updated_on`, nothing would ever go back for it. **A duplicate costs
 * one HTTP request; a skip costs a ticket, permanently.**
 */
export function fetchIssuesPage(baseUrl: string, apiKey: string, q: IssueQuery) {
  return get(
    baseUrl,
    apiKey,
    '/issues.json',
    {
      status_id: '*',
      project_id: q.projectId,
      assigned_to_id: q.assignedToId,
      updated_since: q.updatedSince,
      sort: 'updated_on:desc',
      offset: q.offset ?? 0,
      limit: q.limit ?? PAGE_SIZE,
    },
    (d) =>
      Array.isArray(d?.issues)
        ? { issues: d.issues, totalCount: Number(d.total_count ?? d.issues.length), offset: Number(d.offset ?? 0), limit: Number(d.limit ?? PAGE_SIZE) }
        : null,
  );
}
