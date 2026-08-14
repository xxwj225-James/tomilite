// Obfuscate built API server code
// Run after tsc/esbuild: node scripts/obfuscate.js
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const config = require('../obfuscator.config.js');
const API_DIST = path.resolve(__dirname, '../apps/api/dist');
const EXCLUDE_PATTERNS = config.exclude.map(p => p.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));

function shouldExclude(filePath) {
  const relative = path.relative(API_DIST, filePath).replace(/\\/g, '/');
  return EXCLUDE_PATTERNS.some(pattern => {
    const regex = new RegExp('^' + pattern + '$');
    return regex.test(relative);
  });
}

function shouldLightObfuscate(filePath) {
  const relative = path.relative(API_DIST, filePath).replace(/\\/g, '/');
  const lightPatterns = config.lightFiles.map(p => p.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
  return lightPatterns.some(pattern => {
    const regex = new RegExp('^' + pattern + '$');
    return regex.test(relative);
  });
}

function walkDir(dir, callback) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(fullPath, callback);
    else if (entry.name.endsWith('.js')) callback(fullPath);
  });
}

let totalObfuscated = 0;
let totalSkipped = 0;

console.log('🔒 TomiLite — Obfuscating API server...\n');

walkDir(API_DIST, (filePath) => {
  const relative = path.relative(API_DIST, filePath).replace(/\\/g, '/');

  if (shouldExclude(filePath)) {
    console.log(`  ⏭️  SKIP (public API): ${relative}`);
    totalSkipped++;
    return;
  }

  const source = fs.readFileSync(filePath, 'utf-8');
  const useLight = shouldLightObfuscate(filePath);
  const obfuscationOpts = useLight ? config.light : config.default;

  try {
    const result = JavaScriptObfuscator.obfuscate(source, {
      ...obfuscationOpts,
      inputFileName: path.basename(filePath),
    });
    fs.writeFileSync(filePath, result.getObfuscatedCode());
    const label = useLight ? 'LIGHT' : 'FULL';
    console.log(`  🔒 ${label}: ${relative} (${source.length} → ${result.getObfuscatedCode().length} bytes)`);
    totalObfuscated++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${relative} — ${err.message}`);
  }
});

console.log(`\n✅ Done. ${totalObfuscated} files obfuscated, ${totalSkipped} kept readable.`);
// Frontend obfuscation is handled by vite-plugin-obfuscator.js during build.
// Double-obfuscating the same chunks breaks Milkdown editor (ProseMirror internals).
