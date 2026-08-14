// Remove non-Windows Prisma engine binaries to shrink installer (~120MB savings)
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// Patterns to remove: darwin (macOS), linux, and temp files
const patterns = [
  /query_engine-(darwin|linux|linux-arm)/,
  /libquery_engine-(darwin|linux)/,
  /schema-engine-(darwin|linux)/,
  /\.tmp\d+$/,
  /\.node\.tmp/,
];

const dirs = [
  path.join(root, 'node_modules', '.prisma', 'client'),
  path.join(root, 'node_modules', '@prisma', 'engines'),
];

let removed = 0;
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (patterns.some(p => p.test(file))) {
      const filePath = path.join(dir, file);
      try {
        fs.unlinkSync(filePath);
        removed++;
        console.log('  ✂ Removed:', file);
      } catch (e) {
        console.warn('  ⚠ Failed to remove:', file);
      }
    }
  }
}

if (removed > 0) {
  console.log(`  ✅ Cleaned ${removed} non-Windows engine(s) — smaller installer`);
} else {
  console.log('  ✅ No non-Windows engines to clean');
}
