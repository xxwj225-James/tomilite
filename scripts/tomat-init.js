#!/usr/bin/env node
// tomat init — Install git post-commit hook to auto-link commits to TomiLite
// Usage: node scripts/tomat-init.js [--repo /path/to/repo]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_URL = process.env.TOMAT_API || 'http://localhost:3091';
const repoPath = process.argv.includes('--repo')
  ? path.resolve(process.argv[process.argv.indexOf('--repo') + 1])
  : process.cwd();

const hooksDir = path.join(repoPath, '.git', 'hooks');
const hookFile = path.join(hooksDir, 'post-commit');

// Verify this is a git repo
if (!fs.existsSync(path.join(repoPath, '.git'))) {
  console.error(`❌ Not a git repository: ${repoPath}`);
  process.exit(1);
}

// Create hooks dir if needed
if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

// Check if hook already exists
if (fs.existsSync(hookFile)) {
  const existing = fs.readFileSync(hookFile, 'utf-8');
  if (existing.includes('tomilite') || existing.includes('3091/api/git')) {
    console.log(`✅ TomiLite hook already installed in ${repoPath}`);
    process.exit(0);
  }
  console.log(`⚠️  Existing post-commit hook found. Appending TomiLite hook...`);
}

const hookScript = `
# ─── TomiLite Git Hook ───
# Auto-sends commit info to TomiLite for issue linking
COMMIT_HASH=$(git rev-parse HEAD)
COMMIT_MSG=$(git log -1 --format=%B)
REPO_PATH=$(pwd)

curl -s -X POST ${API_URL}/api/git.handleHook \\
  -H "Content-Type: application/json" \\
  -d "{\\"path\\":\\"${REPO_PATH}\\",\\"hash\\":\\"${COMMIT_HASH}\\",\\"message\\":\\"${COMMIT_MSG//\\"/\\\\\\"}\\"}" \\
  > /dev/null 2>&1 &
`;

const fullHook = fs.existsSync(hookFile)
  ? fs.readFileSync(hookFile, 'utf-8') + '\n' + hookScript
  : `#!/bin/sh\n${hookScript}`;

fs.writeFileSync(hookFile, fullHook);
fs.chmodSync(hookFile, '755');

console.log(`✅ TomiLite hook installed!`);
console.log(`   Repo: ${repoPath}`);
console.log(`   API:  ${API_URL}`);
console.log(`   Now every commit auto-links to your issues.`);
console.log(``);
console.log(`   Try it: git commit -m "fix #1"  → auto-closes TL-1`);
