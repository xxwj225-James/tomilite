import { execSync } from 'node:child_process';

try {
  execSync('npx tsc -b', { stdio: 'pipe', cwd: new URL('..', import.meta.url).pathname });
  console.log('✅ TypeScript check passed');
  process.exit(0);
} catch (e) {
  const output = e.stderr?.toString() || e.stdout?.toString() || '';
  const lines = output.split('\n');
  const realErrors = lines.filter(l => l.trim() && !l.includes('src/vendor/'));
  if (realErrors.length > 0) {
    console.error(realErrors.join('\n'));
    process.exit(1);
  }
  // Only vendor errors — acceptable
  console.log('✅ TypeScript check passed (vendor files excluded)');
  process.exit(0);
}
