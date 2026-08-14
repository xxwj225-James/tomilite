import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { prisma } from '@tomatolite/database';
import { agentLog } from './logger.js';

// ─── Workspace roots ───
let WORKSPACE_ROOTS: string[] = [process.cwd()];

export async function refreshWorkspaceRoots(): Promise<void> {
  try {
    const dirs = await prisma.gitWorkDir.findMany({ where: { enabled: true } });
    WORKSPACE_ROOTS = [process.cwd(), ...dirs.map(d => d.path)];
  } catch (_) { /* best-effort */ }
}

export function initWorkspaceRoots(): void {
  refreshWorkspaceRoots();
  setInterval(refreshWorkspaceRoots, 5 * 60 * 1000);
}

export function getWorkspaceRoots(): string[] {
  return WORKSPACE_ROOTS;
}

// ─── Security ───
const READ_ONLY_WHITELIST = [
  /^git\s+(log|status|diff|show|branch|tag|rev-parse|config\s+--get|remote\s+-v)(\s|$)/,
  /^ls(\s|$)/, /^dir(\s|$)/, /^cat\s/, /^head\s/, /^tail\s/, /^wc\s/,
  /^grep\s/, /^find\s/, /^which\s/, /^pwd$/, /^echo\s/, /^type\s/,
  /^node\s+-e\s/, /^npx\s+claude\s/,
];

const BLOCKED_PROGRAMS = [
  /^(bash|sh|zsh|exec|eval|sudo|su|chmod|chown|rm|mv|cp|mkdir|touch|curl|wget)(\s|$)/,
  /^(base64|xxd|openssl)(\s|$)/,
];

const DANGEROUS_METACHARS = /[;&|`$(){}<>]/;

// ─── Command validation ───
export function validateCommand(cmd: string, requestedCwd?: string): string | null {
  if (DANGEROUS_METACHARS.test(cmd.replace(/^node\s+-e\s.*/, '').replace(/^npx\s+claude\s.*/, '').replace(/^echo\s.*/, '').replace(/^git\s+log\s.*/, '').replace(/^grep\s.*/, '')))
    return 'Command contains forbidden shell metacharacters.';
  if (!READ_ONLY_WHITELIST.some(r => r.test(cmd))) return 'Command not in read-only whitelist.';
  if (BLOCKED_PROGRAMS.some(r => r.test(cmd))) return 'Program not allowed.';
  if (requestedCwd && !WORKSPACE_ROOTS.some(r => requestedCwd.startsWith(r))) {
    return 'cwd must be within workspace. Allowed roots: ' + WORKSPACE_ROOTS.join(', ');
  }
  return null;
}

// ─── Command parsing ───
export function parseCommand(cmd: string): { program: string; args: string[] } {
  const tokens: string[] = [];
  let i = 0;
  while (i < cmd.length) {
    while (i < cmd.length && /\s/.test(cmd[i])) i++;
    if (i >= cmd.length) break;
    if (cmd[i] === '"') {
      i++;
      let tok = '';
      while (i < cmd.length && cmd[i] !== '"') { tok += cmd[i]; i++; }
      i++;
      tokens.push(tok);
    } else {
      let tok = '';
      while (i < cmd.length && !/\s/.test(cmd[i])) { tok += cmd[i]; i++; }
      tokens.push(tok);
    }
  }
  return { program: tokens[0] || '', args: tokens.slice(1) };
}

// ─── Shell execution ───
export async function shellExec(command: string, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const error = validateCommand(command, cwd);
  if (error) return { code: -1, stdout: '', stderr: '❌ ' + error };

  const targetCwd = cwd || WORKSPACE_ROOTS[0];
  if (!existsSync(targetCwd)) return { code: -1, stdout: '', stderr: '❌ Directory not found: ' + targetCwd };

  const { program, args } = parseCommand(command);

  return new Promise(resolve => {
    const proc = spawn(program, args, {
      cwd: targetCwd, timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) { /* best-effort */ }
      resolve({ code: -1, stdout: stdout.slice(0, 8000), stderr: '⏱ Timeout (30s)' });
    }, 30000);

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 2000) });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: err.message });
    });
  });
}
