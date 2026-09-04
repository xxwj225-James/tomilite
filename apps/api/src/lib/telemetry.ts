// ═══ Anonymous usage telemetry (opt-in only) ═══
//
// Helps the author understand how many real users run TomiLite and which
// features they actually use — for product decisions. It NEVER leaves the
// machine until the user opts in, and it only sends anonymous aggregates:
// app version, OS, UI language, which panels/tools were used, how many
// issues/notes/reports/… were produced, focus minutes. No chat text, no
// file content, no email bodies, no file names, no code, no API keys, no
// personal identifiers.
//
// Consent lives in SystemConfig `telemetry.consent` ('yes' | 'no' | unset).
// Events buffer to a single NDJSON file in the data dir so revoking consent
// is a one-file delete; nothing is stored in the app database.
//
// Endpoint can be overridden with TL_TELEMETRY_URL (useful for self-hosting
// or local testing with a mock receiver).
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { prisma } from '@tomilite/database';

const DATA_DIR = process.env.TL_USER_DATA || join(homedir(), '.tomilite');
const BUFFER_FILE = join(DATA_DIR, 'telemetry.ndjson');
const ENDPOINT = process.env.TL_TELEMETRY_URL || 'https://tomatovector.com/api/telemetry/batch';

const MAX_BUFFER_LINES = 2000; // drop oldest beyond this (flush-failure protection)
const MAX_SEND_EVENTS = 300; // events per request
const CACHE_TTL_MS = 30_000; // consent cache lifetime
const CONSENT_KEY = 'telemetry.consent';
const INSTALL_KEY = 'telemetry.installId';
const LAST_DAILY_KEY = 'telemetry.lastDaily'; // localtime string 'YYYY-MM-DD HH:MM:SS'
const LAST_FLUSH_KEY = 'telemetry.lastFlush'; // ISO timestamp
const BEACON_IF_IDLE_MS = 36 * 3600_000; // send an active-install beacon at least ~daily

let cachedConsent: boolean | null = null;
let cachedAt = 0;
let flushing = false;

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function localDay(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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
    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  } catch {}
}

/** True only when the user explicitly opted in (unset = opted out). Cached 30s. */
export async function getConsent(): Promise<boolean> {
  const now = Date.now();
  if (cachedConsent !== null && now - cachedAt < CACHE_TTL_MS) return cachedConsent;
  const v = await getCfg(CONSENT_KEY);
  cachedConsent = v === 'yes';
  cachedAt = now;
  return cachedConsent;
}

/** Create a stable per-install id on first use (local only; sent only when consenting). */
export async function getInstallId(): Promise<string> {
  let id = await getCfg(INSTALL_KEY);
  if (!id) {
    id = randomUUID();
    await setCfg(INSTALL_KEY, id);
  }
  return id;
}

/** User flipped the switch. 'no' → drop the local buffer & stop. 'yes' → resume. */
export async function onConsentChanged(value: string) {
  cachedConsent = value === 'yes';
  cachedAt = Date.now();
  if (value !== 'yes') {
    purge();
    return;
  }
  await recordAppLaunch();
}

function purge() {
  try {
    if (existsSync(BUFFER_FILE)) unlinkSync(BUFFER_FILE);
  } catch {}
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** Append one event line. Called from the renderer route and internal capture points. */
export async function track(name: string, p?: Record<string, unknown>) {
  if (typeof name !== 'string' || !name || name.length > 64) return;
  if (!(await getConsent())) return;
  try {
    ensureDir();
    appendFileSync(
      BUFFER_FILE,
      JSON.stringify({ id: randomUUID(), name, ts: new Date().toISOString(), p: p ?? {} }) + '\n',
      'utf-8',
    );
    trimBuffer();
  } catch {}
}

/** Drop oldest lines when the buffer outgrows MAX_BUFFER_LINES. */
function trimBuffer() {
  try {
    if (!existsSync(BUFFER_FILE)) return;
    const lines = readFileSync(BUFFER_FILE, 'utf-8').split('\n').filter(Boolean);
    if (lines.length <= MAX_BUFFER_LINES) return;
    writeFileSync(BUFFER_FILE, lines.slice(lines.length - MAX_BUFFER_LINES).join('\n') + '\n', 'utf-8');
  } catch {}
}

function readEvents(): Array<{ id: string; name: string; ts: string; p?: Record<string, unknown> }> {
  try {
    if (!existsSync(BUFFER_FILE)) return [];
    return readFileSync(BUFFER_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function clearBuffer() {
  try {
    if (existsSync(BUFFER_FILE)) unlinkSync(BUFFER_FILE);
  } catch {}
}

/** Append app_launch on boot (only when already opted in). */
export async function recordAppLaunch() {
  if (!(await getConsent())) return;
  await track('app_launch');
}

/** Server boot hook: make sure install id exists; log one app_launch if opted in. */
export async function init() {
  await getInstallId();
  await recordAppLaunch();
}

// ─── DB-derived daily counters (no per-click instrumentation) ───
// All row timestamps are SQLite localtime strings ('YYYY-MM-DD HH:MM:SS'),
// so a plain string range works. Every lookup is individually guarded so one
// failing table never blocks the flush.
async function countWhere(model: any, where: any): Promise<number> {
  try {
    return await model.count({ where });
  } catch {
    return 0;
  }
}

export async function buildDailyCounts(since: string): Promise<Record<string, number>> {
  const [
    issuesCreated,
    issuesDone,
    notesCreated,
    reportsCreated,
    emailsProcessed,
    chatSessions,
    chatUserMsgs,
    focusSessions,
    gitCommits,
    mcpExecs,
  ] = await Promise.all([
    countWhere(prisma.issue, { createdAt: { gt: since } }),
    countWhere(prisma.issue, { status: 'done', updatedAt: { gt: since } }),
    countWhere(prisma.knowledgePage, { createdAt: { gt: since } }),
    countWhere(prisma.report, { createdAt: { gt: since } }),
    countWhere(prisma.smartEmail, { isProcessed: true, processedAt: { gt: since } }),
    countWhere(prisma.chatSession, { createdAt: { gt: since } }),
    countWhere(prisma.chatMessage, { role: 'user', createdAt: { gt: since } }),
    countWhere(prisma.focusSession, { startTime: { gt: since } }),
    countWhere(prisma.gitCommit, { createdAt: { gt: since } }),
    countWhere(prisma.mcpAuditLog, { status: 'executed', createdAt: { gt: since } }),
  ]);
  let focusMinutes = 0;
  try {
    const agg: any = await prisma.focusSession.aggregate({
      where: { startTime: { gt: since } },
      _sum: { totalMinutes: true },
    });
    focusMinutes = agg?._sum?.totalMinutes ?? 0;
  } catch {}
  return {
    issuesCreated,
    issuesDone,
    notesCreated,
    reportsCreated,
    emailsProcessed,
    chatSessionsCreated: chatSessions,
    chatUserMessages: chatUserMsgs,
    focusSessions,
    focusMinutes,
    gitCommits,
    mcpToolExecs: mcpExecs,
  };
}

// ─── Flush ───
export async function flush() {
  if (flushing) return;
  if (!(await getConsent())) return;
  flushing = true;
  try {
    const events = readEvents();
    const since = (await getCfg(LAST_DAILY_KEY)) || nowLocal();
    const lastFlushIso = await getCfg(LAST_FLUSH_KEY);
    const idleMs = lastFlushIso ? Date.now() - new Date(lastFlushIso).getTime() : Number.POSITIVE_INFINITY;
    const counts = await buildDailyCounts(since);
    const hasCounts = Object.values(counts).some((n) => n > 0);
    // Send when there are buffered events, or ~daily as a lightweight
    // "still active" beacon even on a quiet day.
    if (events.length === 0 && !hasCounts && idleMs < BEACON_IF_IDLE_MS) return;

    const installId = await getInstallId();
    let lang = 'en';
    try {
      const ui = await prisma.systemConfig.findUnique({ where: { key: 'uiLanguage' } });
      if (ui?.value) lang = ui.value;
    } catch {}

    const payload = {
      schema: 1,
      installId,
      appVersion: process.env.TL_APP_VERSION || '',
      platform: process.platform,
      arch: process.arch,
      lang,
      ts: new Date().toISOString(),
      events: events.slice(-MAX_SEND_EVENTS),
      daily: { date: localDay(), counts },
    };

    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      console.warn(`[Telemetry] server returned ${resp.status} — will retry later`);
      return;
    }
    // Success → clear the buffer and advance the daily window.
    clearBuffer();
    await setCfg(LAST_DAILY_KEY, nowLocal());
    await setCfg(LAST_FLUSH_KEY, new Date().toISOString());
  } catch (e: any) {
    // Network offline / endpoint not deployed yet — keep buffer, retry next tick.
    if (String(e?.message || e).includes('fetch failed')) {
      // quiet: expected when offline or before the receiver exists
    } else {
      console.warn('[Telemetry] flush error:', e?.message || e);
    }
  } finally {
    flushing = false;
  }
}
