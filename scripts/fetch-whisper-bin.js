/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS build script */
/**
 * Fetch the vendored whisper-cli binary into packages/whisper-bin/bin/.
 *
 * Runs at pack time (and on demand during development). The binaries are
 * gitignored — see packages/whisper-bin/README.md for the rationale.
 *
 * Idempotent: if bin/ already matches the pinned version, this is a no-op.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const JSZip = require('jszip');

const VERSION = 'b4938';
const URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${VERSION}/whisper-bin-x64.zip`;
// Pinned so a compromised/replaced release asset can't reach the installer.
const ZIP_SHA256 = 'c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d';

// Files inside the zip's Release/ folder that the CLI actually needs.
// whisper-cli.exe is a thin shell: whisper.dll + ggml.dll + ggml-base.dll do the
// work. All nine ggml-cpu-* variants ship because ggml selects one at runtime
// based on the host CPU microarchitecture.
const KEEP_PREFIXES = ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll'];
const KEEP_PATTERNS = [/^ggml-cpu-.*\.dll$/];

// Linked in but absent from the upstream zip — without these a clean machine
// fails with STATUS_DLL_NOT_FOUND (0xC0000135).
const MSVC_RUNTIME = ['vcomp140.dll', 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];

const root = path.resolve(__dirname, '..');
const destDir = path.join(root, 'packages', 'whisper-bin', 'bin');
const markerPath = path.join(destDir, '.fetched.json');

function log(msg) {
  console.log('  ' + msg);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isWanted(name) {
  return KEEP_PREFIXES.includes(name) || KEEP_PATTERNS.some((p) => p.test(name));
}

function download(url, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 5;
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'tomilite-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          return resolve(download(res.headers.location, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        }
        const chunks = [];
        let received = 0;
        res.on('data', (c) => {
          chunks.push(c);
          received += c.length;
          if (received % (2 * 1024 * 1024) < c.length) {
            log(`↓ ${(received / 1048576).toFixed(1)} MB`);
          }
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Already populated at the pinned version? */
function alreadyFetched() {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    if (marker.version !== VERSION) return false;
    for (const name of Object.keys(marker.files)) {
      const p = path.join(destDir, name);
      if (!fs.existsSync(p)) return false;
      if (sha256(fs.readFileSync(p)) !== marker.files[name]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (alreadyFetched()) {
    log(`✅ whisper-cli ${VERSION} already present — skipping fetch`);
    return;
  }

  log(`Fetching whisper-cli ${VERSION}...`);
  const zipBuf = await download(URL);

  const actual = sha256(zipBuf);
  if (actual !== ZIP_SHA256) {
    throw new Error(`SHA-256 mismatch for ${URL}\n  expected ${ZIP_SHA256}\n  actual   ${actual}`);
  }
  log('✓ zip SHA-256 verified');

  const zip = await JSZip.loadAsync(zipBuf);
  const wanted = Object.keys(zip.files).filter((n) => isWanted(path.basename(n)));
  if (wanted.length < 5) {
    throw new Error(`Only ${wanted.length} expected files in the release zip — layout changed?`);
  }

  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  const files = {};
  for (const entry of wanted) {
    const name = path.basename(entry);
    const buf = await zip.files[entry].async('nodebuffer');
    fs.writeFileSync(path.join(destDir, name), buf);
    files[name] = sha256(buf);
  }
  log(`✓ extracted ${wanted.length} files from the zip`);

  // MSVC runtime — from the build machine's System32. Copying them next to the
  // exe keeps Windows' DLL search in the application directory.
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  for (const name of MSVC_RUNTIME) {
    const src = path.join(sys32, name);
    if (!fs.existsSync(src)) {
      throw new Error(
        `${name} not found in ${sys32}.\n` +
          '  whisper-cli links against the MSVC runtime, which the upstream release zip does not ship.\n' +
          '  Install the Microsoft Visual C++ Redistributable (x64) on this build machine and retry.',
      );
    }
    const buf = fs.readFileSync(src);
    // PE magic check — guards against picking up a stub or a corrupted file.
    if (buf.length < 64 || buf.readUInt16LE(0) !== 0x5a4d) {
      throw new Error(`${src} is not a valid PE image`);
    }
    fs.writeFileSync(path.join(destDir, name), buf);
    files[name] = sha256(buf);
  }
  log(`✓ copied ${MSVC_RUNTIME.length} MSVC runtime DLLs from System32`);

  fs.writeFileSync(markerPath, JSON.stringify({ version: VERSION, url: URL, files }, null, 2));

  const total = fs
    .readdirSync(destDir)
    .filter((f) => f !== '.fetched.json')
    .reduce((n, f) => n + fs.statSync(path.join(destDir, f)).size, 0);

  log(`✅ whisper-cli ${VERSION} ready — ${Object.keys(files).length} files, ${(total / 1048576).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error('\n❌ fetch-whisper-bin failed:\n  ' + (e && e.message ? e.message : e) + '\n');
  process.exit(1);
});
