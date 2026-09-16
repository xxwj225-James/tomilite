// ═══ Phase B verification — local embeddings ═══
//
//   npx tsx scripts/test-embed.mts
//
// Runs against a COPY of the database and a private model directory under
// C:/tmp/tl/embed/ — never the live database and never ~/.tomilite. Mirrors the
// conventions of scripts/test-fts.mts (same fixture shape, same check/eq/assert
// helpers) and of scripts/test-imap.cjs. scripts/ is not in build.files, so nothing
// here ships; it is not covered by eslint or any tsconfig and is run explicitly.
//
// ─── One assertion deliberately departs from the plan ───
//
// The plan's Phase B section asks for `cos(pair) > cos(control) + 0.10` — an absolute
// margin of 0.10 between the correct pairing and a control. That number is not
// achievable and the measure is wrong. Measured on this model (2026-09-12), e5 vectors
// are strongly anisotropic: an unrelated pair still scores 0.75-0.85, because every
// vector shares a large common component. Margins over a wrong pairing measured
// 0.0097 / 0.0371 / 0.0686 / 0.0302 / 0.0101 across five probes — all far below 0.10,
// and yet the correct document ranked #1 for every one of them.
//
// So the gate here is RANK, which is what retrieval actually consumes, and the margins
// are printed for the record rather than asserted against a threshold. A cosine
// threshold in source code would be worse than useless: 0.5 (the value the old
// semanticRank used) is true for every query and silently selects the wrong branch.
//
// node:sqlite is experimental; the warning it prints is expected.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const REPO = process.cwd();
const ROOT = 'C:/tmp/tl/embed';
const SNAPSHOT = process.env.TL_SNAPSHOT || 'C:/tmp/tl/dev.db';
/** Where the model was fetched to during development; copied in so the harness is
 *  offline and deterministic. The install path itself is still exercised (section 1
 *  asserts the copy is complete and recognised), just not the 135 MB download. */
const MODEL_SRC = process.env.TL_EMBED_MODEL_SRC || 'C:/tmp/tl/models/Xenova/multilingual-e5-small';

const USERDATA = `${ROOT}/userdata`;
const MODEL_DEST = `${USERDATA}/models/embed/Xenova/multilingual-e5-small`;
const WORK_DB = `${ROOT}/copy.db`;
const EMPTY_USERDATA = `${ROOT}/empty-userdata`;
const TSX = join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// Env must be set BEFORE any import that reaches lib/meeting/paths.ts, which reads
// TL_USER_DATA at module scope.
process.env.TL_USER_DATA = USERDATA;
process.env.DATABASE_URL = `file:${WORK_DB}`;
delete process.env.TL_EMBED_DISABLE;
delete process.env.TL_EMBED_MODEL;

let passed = 0;
const failures: string[] = [];
const notes: string[] = [];

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok   ${name}`);
    })
    .catch((e) => {
      const m = e instanceof Error ? e.message : String(e);
      failures.push(`${name} → ${m}`);
      console.log(`  FAIL ${name} → ${m}`);
    });
}
function eq(actual: unknown, expected: unknown, what = '') {
  if (actual !== expected)
    throw new Error(`${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function near(actual: number, expected: number, tol: number, what: string) {
  if (!(Math.abs(actual - expected) <= tol))
    throw new Error(`${what}: expected ${expected} ±${tol}, got ${actual}`);
}
function section(title: string) {
  console.log(`\n[${title}]`);
}

// ─── Fixture ───
for (const d of [ROOT, USERDATA, EMPTY_USERDATA]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
for (const f of [WORK_DB, `${WORK_DB}-wal`, `${WORK_DB}-shm`]) rmSync(f, { force: true });
if (!existsSync(MODEL_SRC)) throw new Error(`model not found: ${MODEL_SRC} (set TL_EMBED_MODEL_SRC)`);

console.log('=== Phase B: local embeddings ===');
console.log(`db       ${WORK_DB}  (from ${SNAPSHOT})`);
console.log(`userdata ${USERDATA}`);

// Copy the model in, replacing whatever a previous run left behind: presence has to be
// earned by the copy, not inherited.
rmSync(MODEL_DEST, { recursive: true, force: true });
mkdirSync(join(MODEL_DEST, 'onnx'), { recursive: true });
cpSync(MODEL_SRC, MODEL_DEST, { recursive: true });
console.log(`model    copied ${(statSync(join(MODEL_DEST, 'onnx/model_quantized.onnx')).size / 1e6).toFixed(0)} MB`);

if (!existsSync(WORK_DB)) {
  console.log(`Copying snapshot (${(statSync(SNAPSHOT).size / 1e6).toFixed(0)} MB)…`);
  cpSync(SNAPSHOT, WORK_DB);
}

// ─── Imports (after env) ───
const { MODEL_FILES, EMBED_DIMS, embedModelId, embedModelDir, isModelInstalled, missingFiles, installEmbedModel } =
  await import('../apps/api/src/lib/embed/modelFiles.js');
const embed = await import('../apps/api/src/lib/embed/index.js');
const { encodeVector, decodeVector, cosineSimilarity, embedQuery, embedPassage, embedPassages, embedModelStatus } =
  embed;
const { enqueueAllStale, drainEmbedQueue, embedBootSweep } = await import('../apps/api/src/lib/embed/queue.js');
const { ensureSearchIndexes } = await import('../apps/api/src/lib/ftsIndex.js');
const { searchNotesSemantic } = await import('../apps/api/src/agent/utils/search.js');
const { prisma } = await import('@tomilite/database');

const db = new DatabaseSync(WORK_DB);
db.exec('PRAGMA busy_timeout = 15000');
const one = (sql: string, ...p: unknown[]) => {
  const row = db.prepare(sql).get(...(p as never[]));
  return row ? Number(Object.values(row)[0]) : 0;
};
const queueDepth = () => {
  try {
    return one('SELECT count(*) FROM embed_queue');
  } catch {
    return -1; // table absent
  }
};

// ═══ [1] Model installation ═══
section('1. model installation');

await check('manifest matches the files on disk byte for byte', async () => {
  const missing = missingFiles();
  eq(missing.length, 0, 'missing file count');
  assert(await embedModelStatus() === 'ready', 'status should be ready');
  for (const f of MODEL_FILES) {
    const p = `${MODEL_DEST}/${f.rel}`;
    assert(existsSync(p), `${f.rel} missing`);
    eq(statSync(p).size, f.bytes, `${f.rel} size`);
  }
});

await check('a truncated file is reported as missing, not as installed', async () => {
  const p = `${MODEL_DEST}/config.json`;
  const good = readFileSync(p);
  writeFileSync(p, Buffer.concat([good, Buffer.from(' ')])); // right content, wrong size
  const missing = missingFiles();
  eq(missing.length, 1, 'missing count after truncation');
  eq(missing[0].rel, 'config.json', 'which file');
  assert(!isModelInstalled(), 'isModelInstalled must be false');
  writeFileSync(p, good); // restore
  eq(missingFiles().length, 0, 'restored');
});

await check('re-installing a complete model downloads nothing', async () => {
  const res = await installEmbedModel({ onProgress: () => {} });
  assert(res.ok, `install should succeed: ${res.error}`);
  eq(res.downloaded.length, 0, 'files downloaded');
});

await check('no .part residue anywhere under the model root', async () => {
  // A `.part` left behind means a download was interrupted and never renamed; the
  // presence check must not have counted it.
  const found = readdirSync(embedModelDir(), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.part'));
  eq(found.length, 0, `stray .part files: ${found.join(', ')}`);
});

await check('model dir layout is what env.localModelPath expects', async () => {
  eq(embedModelId(), 'Xenova/multilingual-e5-small', 'model id');
  eq(embedModelDir().replace(/\\/g, '/'), MODEL_DEST, 'model dir');
  eq(EMBED_DIMS, 384, 'dims');
});

// ═══ [2] Cold vs warm ═══
section('2. session build cost (singleton)');

let coldMs = 0;
let warmMs = 0;
await check('the second call reuses the loaded session', async () => {
  const t0 = Date.now();
  const v1 = await embedQuery('数据库迁移');
  coldMs = Date.now() - t0;
  assert(v1 !== null, 'cold embedQuery returned null');
  const t1 = Date.now();
  const v2 = await embedQuery('数据库迁移');
  warmMs = Date.now() - t1;
  assert(v2 !== null, 'warm embedQuery returned null');
  // First call pays the ONNX session build; every later call is inference only.
  assert(warmMs * 5 < coldMs, `warm ${warmMs}ms is not ≥5x faster than cold ${coldMs}ms`);
  notes.push(`session build ${coldMs} ms, steady-state inference ${warmMs} ms`);
});

await check('vectors are unit-length and finite (pooling + normalize really ran)', async () => {
  const v = (await embedQuery('数据库迁移'))!;
  eq(v.length, EMBED_DIMS, 'dims');
  assert(
    v.every((x) => Number.isFinite(x)),
    'non-finite component — feature-extraction returned token-level output',
  );
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  near(norm, 1, 1e-4, 'L2 norm');
});

// ═══ [3] Cross-lingual retrieval (ranked, see the header note) ═══
section('3. cross-lingual ranking');

const PASSAGES = [
  'How to run a database migration on the production server, including the backup step',
  '番茄炒蛋的做法：先炒鸡蛋，再放番茄，最后加葱花',
  'Semantic search over note embeddings using cosine similarity and a vector index',
  'Quarterly budget review meeting notes and follow-up action items',
];
const passageVecs = (await embedPassages(PASSAGES)).map((v) => v!);
const rankOf = async (query: string) => {
  const qv = (await embedQuery(query))!;
  const scored = passageVecs
    .map((v, i) => ({ i, score: cosineSimilarity(qv, v) }))
    .sort((a, b) => b.score - a.score);
  return { top: scored[0].i, margin: scored[0].score - scored[1].score, scores: scored.map((s) => s.score) };
};

await check('Chinese query finds the English passage (the case that motivated Phase B)', async () => {
  const r = await rankOf('数据库迁移');
  eq(r.top, 0, `ranked #${r.top}, scores ${r.scores.map((s) => s.toFixed(4)).join(' ')}`);
  notes.push(`cross-lingual 数据库迁移 → English migration passage, margin ${r.margin.toFixed(4)}`);
});

await check('Chinese query finds the Chinese passage', async () => {
  const r = await rankOf('番茄炒蛋怎么做');
  eq(r.top, 1, `ranked #${r.top}`);
});

await check('English query finds the English vector-search passage', async () => {
  const r = await rankOf('how does vector similarity search work');
  eq(r.top, 2, `ranked #${r.top}`);
});

await check('an unrelated query still produces a stable, sane ordering', async () => {
  // Not a correctness claim — just that nothing degenerates (all-equal scores, NaN,
  // or an exception) on input the model has no good answer for.
  const r = await rankOf('zzzz qqqq 1234567');
  assert(r.scores.every((s) => Number.isFinite(s)), 'non-finite score');
  assert(r.margin > 0 || r.margin === 0, 'margin should not be negative');
  notes.push(`unrelated-query margin ${r.margin.toFixed(4)} (no threshold is asserted on it)`);
});

// ═══ [4] Prefix asymmetry ═══
section('4. query:/passage: prefixes');

await check('embedQuery and embedPassage disagree on the same text', async () => {
  // The prefixes are welded in, so the only thing a black-box test can pin is that the
  // asymmetry exists and changes the vector. That the prefixed form also retrieves
  // better was measured out-of-band (margin over a wrong pairing: 0.0354 prefixed vs
  // 0.0212 unprefixed); the harness cannot reproduce it without bypassing the module.
  const t = '数据库迁移';
  const asQuery = (await embedQuery(t))!;
  const asPassage = (await embedPassage(t))!;
  const c = cosineSimilarity(asQuery, asPassage);
  assert(c < 0.999, `the two paths produced the same vector (cos=${c}) — a prefix is missing`);
  notes.push(`query: vs passage: on identical text, cos ${c.toFixed(4)} (must be < 1)`);
});

await check('embedPassage and embedPassages agree', async () => {
  const a = (await embedPassage('hello world'))!;
  const b = (await embedPassages(['hello world']))[0]!;
  near(cosineSimilarity(a, b), 1, 1e-6, 'cos between the two passage paths');
});

await check('empty input yields null, not a zero vector', async () => {
  eq(await embedQuery(''), null, 'empty query');
  eq(await embedQuery('   '), null, 'whitespace query');
  eq((await embedPassages(['']))[0], null, 'empty passage');
  // The prefix must not defeat the emptiness check: 'query: ' + '' is not empty, so this
  // only holds if the check happens before the prefix is applied.
  eq(await embedQuery('\n'), null, 'newline-only query');
  eq(await embedPassage('\t '), null, 'whitespace-only passage');
});

// ═══ [5] Stored-vector envelope ═══
section('5. {v,m} envelope');

await check('round-trip preserves the vector within the stored precision', async () => {
  const v = (await embedQuery('round trip'))!;
  const back = decodeVector(encodeVector(v));
  assert(back !== null, 'decode returned null for our own envelope');
  eq(back.length, v.length, 'dims');
  for (let i = 0; i < v.length; i++) near(back[i], v[i], 1e-4, `component ${i}`);
});

await check('every foreign or malformed shape decodes to null', async () => {
  const v = (await embedQuery('x'))!;
  eq(decodeVector(null), null, 'null');
  eq(decodeVector(''), null, 'empty string');
  eq(decodeVector('not json'), null, 'garbage');
  eq(decodeVector(JSON.stringify([1, 2, 3])), null, 'bare array (the removed remote shape)');
  eq(decodeVector(JSON.stringify({ v: [1, 2, 3], m: 'Xenova/multilingual-e5-small@q8' })), null, 'wrong length');
  eq(decodeVector(JSON.stringify({ v: v, m: 'other/model@q8' })), null, 'other model');
  eq(decodeVector(JSON.stringify({ v: v, m: 'Xenova/multilingual-e5-small@fp32' })), null, 'other quantization');
  const bad = JSON.stringify({ v: v.map((x, i) => (i === 3 ? 'x' : x)), m: 'Xenova/multilingual-e5-small@q8' });
  eq(decodeVector(bad), null, 'non-numeric component');
  const nan = JSON.stringify({ v: v.map((x, i) => (i === 3 ? null : x)), m: 'Xenova/multilingual-e5-small@q8' });
  eq(decodeVector(nan), null, 'null component');
});

// ═══ [6] Queue, triggers, backfill ═══
section('6. embed_queue and triggers');

const ensured = await ensureSearchIndexes();
console.log(`  (ensureSearchIndexes → ${ensured})`);

await check('the queue table and its six triggers exist', async () => {
  eq(one("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='embed_queue'"), 1, 'embed_queue');
  eq(one("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'embed_%'"), 6, 'embed triggers');
  eq(one("SELECT count(*) FROM sqlite_master WHERE type='index' AND name='embed_queue_queuedAt_idx'"), 1, 'index');
  eq(queueDepth(), 0, 'queue starts empty');
});

const NOTE_ID = 'tl-embed-probe-note';
await check('INSERTing a note enqueues it (no writer was modified to do this)', async () => {
  db.prepare('DELETE FROM KnowledgePage WHERE id = ?').run(NOTE_ID);
  db.prepare('DELETE FROM embed_queue WHERE id = ?').run(`note:${NOTE_ID}`);
  db.prepare(
    `INSERT INTO KnowledgePage (id, projectId, title, content, category, status, createdAt, updatedAt)
     VALUES (?, (SELECT id FROM Project LIMIT 1), ?, ?, 'general', 'active', datetime('now'), datetime('now'))`,
  ).run(NOTE_ID, '数据库迁移 runbook', '在生产服务器上执行数据库迁移，先备份。');
  eq(queueDepth(), 1, 'queue depth after insert');
  eq(one('SELECT count(*) FROM embed_queue WHERE id = ?', `note:${NOTE_ID}`), 1, 'our row');
});

await check('UPDATE of content re-enqueues; UPDATE of a status-only field does not', async () => {
  // Drain first, so the queue is empty and the next assertion is unambiguous.
  await drainEmbedQueue(5);
  eq(queueDepth(), 0, 'queue drained');

  db.prepare("UPDATE KnowledgePage SET status = 'archived' WHERE id = ?").run(NOTE_ID);
  eq(queueDepth(), 0, 'a status-only update must NOT enqueue (AFTER UPDATE OF title, content)');
  db.prepare("UPDATE KnowledgePage SET status = 'active' WHERE id = ?").run(NOTE_ID);
  eq(queueDepth(), 0, 'restoring status must not enqueue either');

  db.prepare('UPDATE KnowledgePage SET content = ? WHERE id = ?').run('改过的正文：迁移步骤更新了。', NOTE_ID);
  eq(queueDepth(), 1, 'a content update MUST enqueue');
});

await check('draining writes a decodable vector and empties the queue', async () => {
  const res = await drainEmbedQueue(5);
  eq(res.failed, 0, 'failures');
  assert(res.done >= 1, `expected at least one row drained, got ${res.done}`);
  eq(queueDepth(), 0, 'queue after drain');
  const raw = db.prepare('SELECT vector FROM KnowledgePage WHERE id = ?').get(NOTE_ID) as { vector: string };
  const v = decodeVector(raw.vector);
  assert(v !== null, `stored vector did not decode: ${String(raw.vector).slice(0, 60)}`);
  eq(v.length, EMBED_DIMS, 'dims');
});

await check('re-embedding after a content change produces a different vector', async () => {
  const before = (db.prepare('SELECT vector FROM KnowledgePage WHERE id = ?').get(NOTE_ID) as { vector: string }).vector;
  db.prepare('UPDATE KnowledgePage SET content = ? WHERE id = ?').run('完全不同的内容：番茄炒蛋的做法。', NOTE_ID);
  await drainEmbedQueue(5);
  const after = (db.prepare('SELECT vector FROM KnowledgePage WHERE id = ?').get(NOTE_ID) as { vector: string }).vector;
  assert(before !== after, 'the vector did not change after the content changed');
  assert(decodeVector(after) !== null, 'the new vector does not decode');
});

await check('DELETING a note removes its queue row', async () => {
  db.prepare('UPDATE KnowledgePage SET content = ? WHERE id = ?').run('再次修改以入队。', NOTE_ID);
  assert(queueDepth() > 0, 'expected a queued row before the delete');
  db.prepare('DELETE FROM KnowledgePage WHERE id = ?').run(NOTE_ID);
  eq(one('SELECT count(*) FROM embed_queue WHERE id = ?', `note:${NOTE_ID}`), 0, 'orphan queue row');
});

await check('the backfill is gate-stamped and covers both source tables', async () => {
  const queued = await enqueueAllStale(true);
  const notes_ = one("SELECT count(*) FROM embed_queue WHERE kind = 'note'");
  const reports = one("SELECT count(*) FROM embed_queue WHERE kind = 'report'");
  eq(notes_, one('SELECT count(*) FROM KnowledgePage'), 'note rows queued');
  eq(reports, one('SELECT count(*) FROM Report'), 'report rows queued');
  assert(queued === notes_ + reports, `enqueueAllStale returned ${queued}, expected ${notes_ + reports}`);
  // Second call is a no-op because the stamp is set.
  eq(await enqueueAllStale(false), 0, 'second un-forced call');
});

// ═══ [7] The drain guard (in a child process: module state) ═══
section('7. drain refuses to run without a usable model');

/** Run a snippet in a fresh process with the same fixture, so module-level state
 *  (the cached extractor, the disabled flag) starts clean. */
const QUEUE_URL = `file:///${REPO.replace(/\\/g, '/')}/apps/api/src/lib/embed/queue.ts`;
const EMBED_URL = `file:///${REPO.replace(/\\/g, '/')}/apps/api/src/lib/embed/index.ts`;

function runChild(name: string, body: string, env: Record<string, string>) {
  const file = `${ROOT}/child-${name}.mts`;
  writeFileSync(
    file,
    `process.env.TL_USER_DATA = ${JSON.stringify(env.TL_USER_DATA)};
process.env.DATABASE_URL = ${JSON.stringify(env.DATABASE_URL)};
${env.TL_EMBED_DISABLE ? `process.env.TL_EMBED_DISABLE = ${JSON.stringify(env.TL_EMBED_DISABLE)};` : ''}
${body}
`,
  );
  try {
    return execFileSync(process.execPath, [TSX, file], {
      cwd: REPO,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    rmSync(file, { force: true });
  }
}

const queueBefore = queueDepth();
assert(queueBefore > 0, 'the guard tests need a non-empty queue');

await check('TL_EMBED_DISABLE=1 → drain is skipped and consumes nothing', async () => {
  const out = runChild(
    'disabled',
    `const { drainEmbedQueue } = await import(${JSON.stringify(QUEUE_URL)});
const { embedQuery, embedModelStatus } = await import(${JSON.stringify(EMBED_URL)});
const vec = await embedQuery('x');
const r = await drainEmbedQueue(5);
console.log('RESULT ' + JSON.stringify({ r, vec, status: await embedModelStatus() }));`,
    { TL_USER_DATA: USERDATA, DATABASE_URL: `file:${WORK_DB}`, TL_EMBED_DISABLE: '1' },
  );
  const m = /RESULT (.*)/.exec(out);
  assert(m !== null, `no RESULT line in child output:\n${out}`);
  const r = JSON.parse(m[1]);
  eq(r.vec, null, 'embedQuery must return null when disabled');
  eq(r.status, 'disabled', 'status');
  eq(r.r.skipped, 'disabled', 'drain result');
  eq(r.r.done, 0, 'rows drained');
  eq(queueDepth(), queueBefore, 'the queue must be byte-identical after a skip');
});

await check('model absent → drain is skipped and consumes nothing', async () => {
  // The important half of the guard. Without it, five "model not there yet" drains
  // would drive every row to MAX_ATTEMPTS and delete the whole queue permanently.
  const out = runChild(
    'absent',
    `const { drainEmbedQueue } = await import(${JSON.stringify(QUEUE_URL)});
const { embedQuery, embedModelStatus } = await import(${JSON.stringify(EMBED_URL)});
const vec = await embedQuery('x');
const r = await drainEmbedQueue(5);
console.log('RESULT ' + JSON.stringify({ r, vec, status: await embedModelStatus() }));`,
    { TL_USER_DATA: EMPTY_USERDATA, DATABASE_URL: `file:${WORK_DB}` },
  );
  const m = /RESULT (.*)/.exec(out);
  assert(m !== null, `no RESULT line in child output:\n${out}`);
  const r = JSON.parse(m[1]);
  eq(r.vec, null, 'embedQuery must return null with no model');
  eq(r.status, 'absent', 'status');
  eq(r.r.skipped, 'absent', 'drain result');
  eq(r.r.done, 0, 'rows drained');
  eq(queueDepth(), queueBefore, 'the queue must be untouched');
});

// ═══ [8] Poison pill ═══
section('8. poison pill');

await check('an orphaned row (source deleted, trigger missed) is dropped without burning attempts', async () => {
  // Not a failure path — a deliberate one. The AFTER DELETE trigger normally removes the
  // row; this covers the case where it never ran.
  const ghost = 'note:does-not-exist';
  db.prepare('DELETE FROM embed_queue WHERE id = ?').run(ghost);
  // Oldest first, so a small LIMIT always reaches it — the queue is ordered by queuedAt
  // and the backfill rows all share the same second.
  db.prepare("INSERT INTO embed_queue (id, kind, ref_id, attempts, queuedAt) VALUES (?, 'note', 'does-not-exist', 0, '0001-01-01')").run(
    ghost,
  );
  const r = await drainEmbedQueue(50);
  eq(r.failed, 0, 'an orphan is not a failure');
  eq(one('SELECT count(*) FROM embed_queue WHERE id = ?', ghost), 0, 'the orphan should be gone');
});

await check('a row that can never succeed is dropped after MAX_ATTEMPTS, and the drain continues', async () => {
  // A natural poison pill: a note with no title and no content has nothing to embed —
  // embedTextFor() returns '' and embedPassage('') is null by contract, so it fails on
  // every attempt. That makes the retry ceiling reachable without mocking anything.
  const POISON = 'tl-embed-poison-note';
  db.prepare('DELETE FROM embed_queue WHERE id = ?').run(`note:${POISON}`);
  db.prepare('DELETE FROM KnowledgePage WHERE id = ?').run(POISON);
  db.prepare(
    `INSERT INTO KnowledgePage (id, projectId, title, content, category, status, createdAt, updatedAt)
     VALUES (?, (SELECT id FROM Project LIMIT 1), '', NULL, 'general', 'active', datetime('now'), datetime('now'))`,
  ).run(POISON);
  // The trigger queued it with `datetime('now')`, like every backfill row; move it to the
  // front so LIMIT always reaches it regardless of how many rows the fixture has.
  db.prepare("UPDATE embed_queue SET queuedAt = '0001-01-01' WHERE id = ?").run(`note:${POISON}`);

  let sawFailure = false;
  const attemptLog: number[] = [];
  for (let i = 0; i < 8; i++) {
    const r = await drainEmbedQueue(50);
    if (r.failed > 0) sawFailure = true;
    const left = one('SELECT count(*) FROM embed_queue WHERE id = ?', `note:${POISON}`);
    attemptLog.push(left);
    if (left === 0) break;
  }
  assert(sawFailure, 'the poison row never reported a failure');
  eq(one('SELECT count(*) FROM embed_queue WHERE id = ?', `note:${POISON}`), 0, 'the poison row should be gone');
  // It survived MAX_ATTEMPTS-1 drains before being dropped, i.e. it really was retried.
  assert(attemptLog.includes(1), `the row was not retained across retries: ${attemptLog.join(',')}`);
  notes.push(`poison row attempts: ${attemptLog.join(' → ')} queued (MAX_ATTEMPTS = 5)`);
  db.prepare('DELETE FROM KnowledgePage WHERE id = ?').run(POISON);
  eq(one('SELECT count(*) FROM embed_queue WHERE id = ?', `note:${POISON}`), 0, 'queue after cleanup');
});

await check('a row with an unknown kind is dropped, not retried forever', async () => {
  db.prepare("INSERT OR REPLACE INTO embed_queue (id, kind, ref_id, attempts, queuedAt) VALUES ('weird:1', 'weird', '1', 0, datetime('now'))")
    .run();
  await drainEmbedQueue(50);
  eq(one("SELECT count(*) FROM embed_queue WHERE id = 'weird:1'"), 0, 'unknown-kind row');
});

// ═══ [9] Hybrid search ═══
section('9. searchNotesSemantic (RRF fusion)');

await check('a semantically related note is found and comes back with its id', async () => {
  // Drain everything first so the corpus is fully embedded.
  for (let i = 0; i < 40; i++) {
    const r = await drainEmbedQueue(50);
    if (r.done === 0 && r.failed === 0) break;
  }
  assert(queueDepth() === 0, `queue not drained: ${queueDepth()} left`);

  assert(one('SELECT count(*) FROM KnowledgePage') > 0, 'fixture has no notes to search');
  const results = await searchNotesSemantic('数据库迁移', 5);
  assert(Array.isArray(results), 'searchNotesSemantic did not return an array');
  for (const r of results) {
    assert(typeof r.id === 'string' && r.id.length > 0, `result is missing an id: ${JSON.stringify(r)}`);
    assert(one('SELECT count(*) FROM KnowledgePage WHERE id = ?', r.id) === 1, `result id ${r.id} is not a real note`);
    assert(typeof r.title === 'string', 'result is missing a title');
    assert(!('vector' in r), 'the vector must not leak into the agent-visible result');
  }
  notes.push(`searchNotesSemantic('数据库迁移') → ${results.length} result(s)`);
});

await check('an unsearchable 2-character query still returns something via the embedding list', async () => {
  // "迁移" is two characters: trigram cannot serve it, so toFtsMatch returns null and
  // the FTS list is empty. Any result here came from the embedding list.
  const results = await searchNotesSemantic('迁移', 5);
  assert(Array.isArray(results), 'not an array');
  notes.push(`searchNotesSemantic('迁移') → ${results.length} result(s) (FTS cannot serve 2-char CJK)`);
});

await check('a query matching nothing returns well-formed rows rather than throwing', async () => {
  // NOT asserted as empty, and that is the honest expectation: the embedding list fills
  // to PER_LIST whenever any vector exists, because no score cut-off can tell a nonsense
  // query from a real one on this model (see the measurement in knowledgeRecall.ts).
  const results = await searchNotesSemantic('zzzzzzzzqqqqqqqq', 5);
  assert(Array.isArray(results), 'not an array');
  for (const r of results) assert(typeof r.id === 'string' && r.id.length > 0, 'malformed row');
  notes.push(`nonsense query → ${results.length} result(s) (embedding list always fills; no threshold is possible)`);
});

await check('hostile input never throws', async () => {
  for (const q of ['id-1', 'a"b', '""', '   ', '-', '*', 'NEAR(', '数据库 迁移']) {
    await searchNotesSemantic(q, 3);
  }
});

// ═══ [10] Boot sweep idempotence ═══
section('10. boot sweep');

await check('embedBootSweep drains the backlog and is safe to repeat', async () => {
  await prisma.systemConfig.deleteMany({ where: { key: 'embed.backfillVersion' } });
  await embedBootSweep();
  eq(queueDepth(), 0, 'queue after sweep');
  const embedded = one('SELECT count(*) FROM KnowledgePage WHERE vector IS NOT NULL');
  assert(embedded > 0, 'no note carries a vector after the sweep');
  await embedBootSweep(); // re-run: already stamped, nothing queued, model present
  eq(queueDepth(), 0, 'queue after a second sweep');
  eq(one('SELECT count(*) FROM KnowledgePage WHERE vector IS NOT NULL'), embedded, 'vectors changed on a no-op sweep');
});

// ─── Result ───
db.close();
await prisma.$disconnect();

console.log('\n─── measurements ───');
for (const n of notes) console.log(`  · ${n}`);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
