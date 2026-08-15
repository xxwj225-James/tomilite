#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script */
// TomiLite Uninstaller — removes all local data and git hooks

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('TomiLite Uninstaller\n');

const toRemove = [];

// 1. SQLite database (user data directory)
const dbPath = path.join(os.homedir(), '.tomilite', 'dev.db');
if (fs.existsSync(dbPath)) toRemove.push(dbPath);

// 2. Database journal/WAL files
const dbJournal = dbPath + '-journal';
if (fs.existsSync(dbJournal)) toRemove.push(dbJournal);
const dbWal = dbPath + '-wal';
if (fs.existsSync(dbWal)) toRemove.push(dbWal);
const dbShm = dbPath + '-shm';
if (fs.existsSync(dbShm)) toRemove.push(dbShm);

// 3. Data directory
const dataDir = path.join(os.homedir(), '.tomilite');
if (fs.existsSync(dataDir)) toRemove.push(dataDir);

if (toRemove.length === 0) {
  console.log('No TomiLite data found.');
  process.exit(0);
}

console.log('The following will be removed:');
toRemove.forEach(f => console.log(`  • ${f}`));
console.log('');

rl.question('Proceed? (y/N) ', (answer) => {
  if (answer.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    rl.close();
    process.exit(0);
  }

  for (const f of toRemove) {
    try {
      fs.rmSync(f, { recursive: true, force: true });
      console.log(`✅ Removed: ${f}`);
    } catch (e) {
      console.error(`❌ Failed to remove ${f}: ${e.message}`);
    }
  }

  // Remove git hooks installed by tomat init
  const hookSearch = (dir) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === '.git' && e.isDirectory()) {
          const hookFile = path.join(dir, '.git', 'hooks', 'post-commit');
          if (fs.existsSync(hookFile)) {
            const content = fs.readFileSync(hookFile, 'utf-8');
            if (content.includes('tomilite') || content.includes('3091/api/git')) {
              // Remove just the TomiLite section
              const cleaned = content.replace(/# ─── TomiLite Git Hook ───[\s\S]*?&\s*\n?/g, '').trim();
              if (cleaned) {
                fs.writeFileSync(hookFile, cleaned + '\n');
                console.log(`✅ Cleaned git hook: ${hookFile}`);
              } else {
                fs.unlinkSync(hookFile);
                console.log(`✅ Removed git hook: ${hookFile}`);
              }
            }
          }
        }
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
          hookSearch(path.join(dir, e.name));
        }
      }
    } catch {}
  };

  // Search home dir for git repos (depth 2)
  const homeDir = os.homedir();
  console.log('\nChecking for git hooks in ~/projects...');
  const projectsDir = path.join(homeDir, 'projects');
  if (fs.existsSync(projectsDir)) hookSearch(projectsDir);

  console.log('\n✅ Uninstall complete.');
  console.log('   Electron app can be uninstalled via Control Panel (Windows) or dragging to Trash (macOS).');
  rl.close();
});
