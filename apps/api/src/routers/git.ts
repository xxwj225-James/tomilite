import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomatolite/database';

// ─── Shared scanning logic — used by periodic interval in server.ts ───
export async function scanGitWorkDirs() {
  const { execSync } = await import('node:child_process');
  const { existsSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');

  // Check git availability once
  let gitAvailable = false;
  try { execSync('git --version', { stdio: 'pipe', timeout: 5000 }); gitAvailable = true; } catch (_) {}
  if (!gitAvailable) return { reposFound: 0, commitsFound: 0, error: 'Git not found. Install Git and ensure it is in system PATH.' };

  const workDirs = await prisma.gitWorkDir.findMany({ where: { enabled: true } });
  if (workDirs.length === 0) return { reposFound: 0, commitsFound: 0, error: 'No work directories configured. Go to Settings → Git and add at least one directory.' };

  let reposFound = 0, commitsFound = 0;

  // Recursively find .git dirs up to maxDepth levels
  function findGitRepos(basePath: string, maxDepth: number): string[] {
    const results: string[] = [];
    function scan(dir: string, depth: number) {
      if (depth > maxDepth) return;
      if (existsSync(join(dir, '.git'))) { results.push(dir); return; }
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.')) continue;
          scan(join(dir, e.name), depth + 1);
        }
      } catch (_) {}
    }
    scan(basePath, 0);
    return results;
  }

  for (const wd of workDirs) {
    console.log('[GitScan] dir:', wd.path, 'exists:', existsSync(wd.path));
    if (!existsSync(wd.path)) { console.log('[GitScan] path missing, skip'); continue; }
    try {
      const repoPaths = findGitRepos(wd.path, 3);
      console.log('[GitScan] found repos:', repoPaths.length);

      for (const repoPath of repoPaths) {
        // Strip trailing slash/backslash to avoid shell escaping issues
        const cleanPath = repoPath.replace(/[\\/]+$/, '');
        const repoName = cleanPath.split(/[\\/]/).pop() || cleanPath;

        // Register repo if new (store clean path)
        let repo = await prisma.gitRepo.findFirst({ where: { localPath: cleanPath } });
        if (!repo) {
          repo = await prisma.gitRepo.create({
            data: { workDirId: wd.id, name: repoName, localPath: cleanPath },
          });
        }
        reposFound++;

        // Get new commits since last scan
        const since = repo.lastScannedAt
          ? `--since="${repo.lastScannedAt}"`
          : '--since="24 hours ago"';
        try {
          const output = execSync(
            `git -C "${cleanPath}" log --all ${since} --format="%H|%an|%ae|%aI|%s" --shortstat`,
            { timeout: 15000, stdio: 'pipe', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }
          ).toString();

          const lines = output.split('\n');
          let hash = '', author = '', email = '', timestamp = '', message = '';
          let files = 0, adds = 0, dels = 0;

          for (const line of lines) {
            const parts = line.split('|');
            if (parts.length === 5 && /^[a-f0-9]{40}$/.test(parts[0])) {
              if (hash) {
                await saveCommit(repo.id, hash, author, email, message, timestamp, files, adds, dels);
                commitsFound++;
              }
              [hash, author, email, timestamp, message] = parts;
              files = 0; adds = 0; dels = 0;
            } else if (line.includes('file changed')) {
              const fm = line.match(/(\d+)\s+files?\s+changed/);
              const am = line.match(/(\d+)\s+insertions?\(\+\)/);
              const dm = line.match(/(\d+)\s+deletions?\(-\)/);
              files = fm ? parseInt(fm[1]) : 0;
              adds = am ? parseInt(am[1]) : 0;
              dels = dm ? parseInt(dm[1]) : 0;
            }
          }
          if (hash) {
            await saveCommit(repo.id, hash, author, email, message, timestamp, files, adds, dels);
            commitsFound++;
          }
        } catch (_) { /* git log failed, skip repo */ }

        await prisma.gitRepo.update({
          where: { id: repo.id }, data: { lastScannedAt: new Date().toISOString() },
        });
      }
    } catch (_) { /* scan failed */ }
  }
  return { reposFound, commitsFound };
}

// ─── Helper: save commit + parse issue references ───
async function saveCommit(repoId: string, hash: string, author: string, email: string, message: string, timestamp: string, filesChanged: number, additions: number, deletions: number) {
  const existing = await prisma.gitCommit.findFirst({ where: { hash } });
  if (existing) return existing;

  const commit = await prisma.gitCommit.create({
    data: { repoId, hash, author, email, message: message.substring(0, 500), timestamp, filesChanged, additions, deletions },
  });

  // Parse issue references (fix #3, close TL-5, etc.)
  const patterns = [
    /(?:fix|close|resolve|implement|ref)\s+#(\d+)/gi,
    /(?:fix|close|resolve|implement|ref)\s+([A-Z]+-(\d+))/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const key = match[1].toUpperCase();
      const numMatch = key.match(/(\d+)$/);
      const num = numMatch ? parseInt(numMatch[1]) : null;
      const projectKey = key.startsWith('#') ? 'TL' : key.split('-')[0];
      const project = await prisma.project.findFirst({ where: { key: projectKey } });
      let issue = null;
      if (project && num) {
        issue = await prisma.issue.findFirst({ where: { projectId: project.id, issueNumber: num } });
      }
      let action = 'ref';
      if (/close|fix|resolve/i.test(message)) action = 'close';
      else if (/implement/i.test(message)) action = 'implement';

      await prisma.gitCommitRef.create({
        data: { repoId, commitHash: hash, message: message.substring(0, 500), issueKey: key, action, issueId: issue?.id || null },
      });

      if (issue && (action === 'close' || action === 'fix')) {
        await prisma.issue.update({ where: { id: issue.id }, data: { status: 'done', remainingPoints: 0 } });
        await prisma.comment.create({
          data: { issueId: issue.id, body: `🤖 Auto-closed by commit \`${hash.substring(0, 8)}\`\n> ${message.substring(0, 200)}` },
        });
      } else if (issue && action === 'implement' && issue.status === 'todo') {
        await prisma.issue.update({ where: { id: issue.id }, data: { status: 'in_progress' } });
      }
    }
  }
  return commit;
}

// ─── Router ───
export const gitRouter = router({
  // ─── Work Directories (user-configured, max 5) ───
  listWorkDirs: publicProcedure.query(() =>
    prisma.gitWorkDir.findMany({ orderBy: { createdAt: 'desc' } })),

  addWorkDir: publicProcedure
    .input(z.object({ path: z.string() }))
    .mutation(async ({ input }) => {
      const count = await prisma.gitWorkDir.count();
      if (count >= 5) throw new Error('Maximum 5 work directories allowed');
      const cleanPath = input.path.replace(/[\\/]+$/, '');
      const result = await prisma.gitWorkDir.create({ data: { path: cleanPath } });
      // Auto-scan after adding
      scanGitWorkDirs().catch(() => {});
      return result;
    }),

  removeWorkDir: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => prisma.gitWorkDir.delete({ where: { id: input.id } })),

  // ─── Repos ───
  listRepos: publicProcedure.query(() =>
    prisma.gitRepo.findMany({ orderBy: { createdAt: 'desc' } })),

  addRepo: publicProcedure
    .input(z.object({ name: z.string(), localPath: z.string(), branch: z.string().default('main') }))
    .mutation(async ({ input }) => prisma.gitRepo.create({ data: input })),

  removeRepo: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => prisma.gitRepo.delete({ where: { id: input.id } })),

  // ─── Hook handler ───
  handleHook: publicProcedure
    .input(z.object({ path: z.string(), hash: z.string(), message: z.string() }))
    .mutation(async ({ input }) => {
      const repo = await prisma.gitRepo.findFirst({ where: { localPath: input.path, enabled: true } });
      if (!repo) return { processed: false, reason: 'repo not found' };
      await saveCommit(repo.id, input.hash, '', '', input.message, new Date().toISOString(), 0, 0, 0);
      return { processed: true };
    }),

  // ─── Scan ───
  scanWorkDirs: publicProcedure.mutation(async () => {
    return scanGitWorkDirs();
  }),

  // ─── Recent commits ───
  recentCommits: publicProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0), since: z.string().optional() }))
    .query(async ({ input }) => {
      const where: any = { archived: false };
      if (input.since) where.timestamp = { gte: input.since };
      const [commits, total] = await Promise.all([
        prisma.gitCommit.findMany({ where, orderBy: { timestamp: 'desc' }, take: input.limit, skip: input.offset, include: { repo: true } }),
        prisma.gitCommit.count({ where }),
      ]);
      return { commits, total };
    }),

  // ─── Daily commit summary ───
  dailyCommitSummary: publicProcedure
    .input(z.object({ date: z.string().optional() }))
    .query(async ({ input }) => {
      const date = input.date || new Date().toISOString().substring(0, 10);
      const commits = await prisma.gitCommit.findMany({
        where: { timestamp: { startsWith: date }, archived: false },
        orderBy: { timestamp: 'desc' },
      });
      const repoCount = new Set(commits.map(c => c.repoId)).size;
      let totalFiles = 0, totalAdds = 0, totalDels = 0;
      for (const c of commits) { totalFiles += c.filesChanged; totalAdds += c.additions; totalDels += c.deletions; }
      return { date, totalCommits: commits.length, repos: repoCount, totalFiles, totalAdds, totalDels, commits };
    }),

  // ─── Recent refs ───
  recentRefs: publicProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input }) =>
      prisma.gitCommitRef.findMany({
        orderBy: { createdAt: 'desc' }, take: input.limit, include: { repo: true },
      })),
});
