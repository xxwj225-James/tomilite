import { prisma } from '@tomatolite/database';
import { getWorkspaceRoots, refreshWorkspaceRoots } from '../utils/shell.js';

/** List recent git commits tracked by TomiLite */
export async function listGitCommits(args: Record<string, any>): Promise<Array<{ hash: string; author: string; message: string; timestamp: string; repo: string; files: number; adds: number; dels: number }>> {
  const sinceDate = args.since ? new Date(args.since).toISOString() : new Date().toISOString().substring(0, 10);
  const commits = await prisma.gitCommit.findMany({
    where: { timestamp: { gte: sinceDate }, archived: false },
    orderBy: { timestamp: 'desc' },
    include: { repo: { select: { name: true } } },
    take: args.limit || 20,
  });
  return commits.map(c => ({ hash: c.hash?.substring(0, 7), author: c.author, message: c.message?.substring(0, 120), timestamp: c.timestamp, repo: c.repo?.name, files: c.filesChanged || 0, adds: c.additions || 0, dels: c.deletions || 0 }));
}

/** Get git work directories and repos */
export async function listWorkspaces(_args: Record<string, any>): Promise<{ workDirectories: string[]; repos: Array<{ name: string; path: string; branch: string | null; lastScanned: string | null }> }> {
  await refreshWorkspaceRoots();
  const roots = getWorkspaceRoots();
  const repos = await prisma.gitRepo.findMany({ where: { enabled: true } });
  return {
    workDirectories: roots.slice(1),
    repos: repos.map(r => ({ name: r.name, path: r.localPath, branch: r.branch, lastScanned: r.lastScannedAt })),
  };
}
