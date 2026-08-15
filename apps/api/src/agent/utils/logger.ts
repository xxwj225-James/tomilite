// TODO: replace appendFileSync with async fs.promises.appendFile
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { LOG_DIR, LOG_FILE, DEBUG_FLAG } from './constants.js';

const IS_DEBUG = existsSync(DEBUG_FLAG);
try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* dir exists */ }

/** Write to agent.log. Silently skipped in production (no debug.flag). */
export function agentLog(...args: unknown[]): void {
  if (!IS_DEBUG) return;
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  try { appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`); } catch { /* best-effort */ }
}
