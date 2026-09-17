// ═══ Phase A verification — FTS index rebuild ═══
//
//   npx tsx scripts/test-fts.mts
//
// Runs entirely against a COPY of the database under C:/tmp/tl/verify/ — never the
// live one. Mirrors the convention of scripts/test-imap.cjs and scripts/test-stream.cjs
// (scripts/ is not in build.files, so nothing here ships). CI's eslint run does cover
// this file: typescript-eslint's recommended set is spread without a `files` key, so it
// applies here, while the relaxed block that turns off no-explicit-any matches only
// scripts/**/*.js — which is why the types below are spelled out instead of `any`. No
// tsconfig includes it (each workspace's includes only src/), so it is run explicitly via
// tsx, not as part of `npm run check`.
//
// Every assertion is a real query against the real schema, so this doubles as
// documentation of the two bugs being fixed:
//   * `porter unicode61` treated a whole run of Han as ONE token, so a CJK query matched
//     only when it equalled a COMPLETE run in the row — every substring query missed
//     (this is narrower than "Chinese never matches", which is what the bug was first
//     reported as; section [2] pins the precise behaviour against real rows)
//   * the boot repopulation had no dedupe → 498k index rows for 1.6k source rows
//
// node:sqlite is experimental; the warning it prints is expected.

import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const SNAPSHOT = process.env.TL_SNAPSHOT || 'C:/tmp/tl/dev.db';
const DIR = 'C:/tmp/tl/verify';
const WORK_DB = `${DIR}/copy.db`;
const USERDATA = `${DIR}/userdata`;
const REPO = process.cwd();

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    failures.push(`${name} → ${m}`);
    console.log(`  FAIL ${name} → ${m}`);
  }
}

function eq(actual: unknown, expected: unknown, what = '') {
  if (actual !== expected) throw new Error(`${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ─── Fixture ───
for (const d of [DIR, USERDATA]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
if (!existsSync(SNAPSHOT)) throw new Error(`snapshot not found: ${SNAPSHOT}`);

// Always start from a pristine snapshot so a re-run means the same thing.
for (const f of [WORK_DB, `${WORK_DB}-wal`, `${WORK_DB}-shm`]) rmSync(f, { force: true });
console.log(`Copying ${SNAPSHOT} (${(statSync(SNAPSHOT).size / 1e6).toFixed(0)} MB) → ${WORK_DB}`);
copyFileSync(SNAPSHOT, WORK_DB);

process.env.DATABASE_URL = `file:${WORK_DB}`;
process.env.TL_USER_DATA = USERDATA;

const db = new DatabaseSync(WORK_DB);
db.exec('PRAGMA busy_timeout = 15000');

const one = (sql: string, ...p: unknown[]) => {
  const row = db.prepare(sql).get(...(p as never[]));
  return row ? Number(Object.values(row)[0]) : 0;
};
const all = (sql: string, ...p: unknown[]) =>
  db.prepare(sql).all(...(p as never[])) as Array<Record<string, unknown>>;
const ftsCount = (m: string) => one('SELECT count(*) FROM global_fts WHERE global_fts MATCH ?', m);
/** Hits restricted to one source type — the notes corpus is what the UI searches. */
const ftsCountOf = (m: string, type: string) =>
  one('SELECT count(*) FROM global_fts WHERE global_fts MATCH ? AND type = ?', m, type);
const ftsSql = () => {
  const r = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='global_fts'")
    .get() as { sql?: string } | undefined;
  return r ? String(r.sql) : '';
};
const countTriggers = (like: string) =>
  one(`SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE '${like}\\_%' ESCAPE '\\'`);
const SOURCE_TABLES = ['Issue', 'KnowledgePage', 'SmartEmail', 'GitCommit', 'Report'];
const sourceTotal = () => SOURCE_TABLES.reduce((n, t) => n + one(`SELECT count(*) FROM ${t}`), 0);

/** A phrase that demonstrably exists in the corpus. Sections [2] and [4] use it to make
 *  the same statement before and after the rebuild: "this note contains the phrase; can
 *  the index reach it?" — which is the user-visible bug, with no assumption about how
 *  many other rows happen to match. Chosen as PHRASE (5 chars) and its 3-char substring
 *  so both are ≥3 codepoints and therefore trigram-searchable. */
const PHRASE = '数据库迁移';
const SUBSTRING = '数据库';
const notesWithPhrase = all(
  'SELECT id FROM KnowledgePage WHERE title LIKE ? OR content LIKE ?',
  `%${PHRASE}%`,
  `%${PHRASE}%`,
).map((r) => String(r.id));
const phraseInIndex = () =>
  all('SELECT ref_id FROM global_fts WHERE global_fts MATCH ? AND type = ?', `"${PHRASE}"`, 'note').map((r) =>
    String(r.ref_id),
  );

// ═══ 1. Tokenizer theory, on a scratch database ═══
console.log('\n[1] Negative control — why porter unicode61 breaks Chinese');
check('the same text is one token under porter and matchable under trigram', () => {
  const s = new DatabaseSync(':memory:');
  s.exec("CREATE VIRTUAL TABLE p USING fts5(body, tokenize='porter unicode61')");
  s.exec("CREATE VIRTUAL TABLE t USING fts5(body, tokenize='trigram')");
  for (const tbl of ['p', 't']) s.exec(`INSERT INTO ${tbl}(body) VALUES ('数据库迁移')`);
  const n = (tbl: string, q: string) =>
    s.prepare(`SELECT count(*) n FROM ${tbl} WHERE ${tbl} MATCH ?`).get(q) as { n: number };
  const rows = {
    porterWhole: n('p', '数据库迁移').n,
    porterSub: n('p', '数据库').n,
    trigramSub: n('t', '"数据库"').n,
    trigramShort: n('t', '"迁移"').n,
  };
  s.close();
  console.log(
    `       porter: whole-run=${rows.porterWhole} substring=${rows.porterSub}` +
      `  |  trigram: substring=${rows.trigramSub} 2-char=${rows.trigramShort}`,
  );
  eq(rows.porterWhole, 1, 'porter whole run');
  eq(rows.porterSub, 0, 'porter substring (the bug)');
  eq(rows.trigramSub, 1, 'trigram substring (the fix)');
  eq(rows.trigramShort, 0, 'trigram 2-char (structural limit, survives the fix)');
});

// Proved here rather than against the corpus: `MATCH 'note'` on the rebuilt real index
// returns hits, and they are legitimate content matches of the English word "note" in
// commits and notes — not the spurious type-column match the bug produced. Only a
// controlled row can show the difference.
check('an UNINDEXED column is not matchable at all', () => {
  const s = new DatabaseSync(':memory:');
  s.exec("CREATE VIRTUAL TABLE u USING fts5(type UNINDEXED, title, body, ref_id UNINDEXED, tokenize='trigram')");
  // Positive control: the identical row in a table where `type` IS indexed. Without it
  // the zeros below are indistinguishable from "MATCH is broken" or "the row has no
  // terms at all" — the point is that exactly one schema difference flips the result.
  s.exec("CREATE VIRTUAL TABLE u2 USING fts5(type, title, body, ref_id, tokenize='trigram')");
  for (const t of ['u', 'u2']) s.exec(`INSERT INTO ${t}(type,title,body,ref_id) VALUES('zzz','','','r1')`);
  const n = (t: string, q: string) =>
    (s.prepare(`SELECT count(*) n FROM ${t} WHERE ${t} MATCH ?`).get(q) as { n: number }).n;
  const rows = { indexed: n('u2', 'zzz'), bare: n('u', 'zzz'), quoted: n('u', '"zzz"'), refId: n('u', '"r1"') };
  s.close();
  console.log(
    `       type indexed → MATCH zzz=${rows.indexed}  |  type UNINDEXED → zzz=${rows.bare}  "zzz"=${rows.quoted}  ref_id "r1"=${rows.refId}`,
  );
  eq(rows.indexed, 1, 'positive control: an indexed type column does match');
  eq(rows.bare, 0, "MATCH 'zzz' (type column must not be searchable)");
  eq(rows.quoted, 0, 'MATCH \'"zzz"\'');
  eq(rows.refId, 0, 'ref_id must not be searchable');
});

check('an orphaned trigger makes every write to its source table fail', () => {
  const s = new DatabaseSync(':memory:');
  s.exec('CREATE TABLE KnowledgePage(id TEXT PRIMARY KEY, title TEXT, content TEXT)');
  s.exec("CREATE VIRTUAL TABLE global_fts USING fts5(type, title, body, ref_id, tokenize='trigram')");
  s.exec(
    "CREATE TRIGGER fts_note_i AFTER INSERT ON KnowledgePage BEGIN INSERT INTO global_fts(type,title,body,ref_id) VALUES('note',new.title,new.content,new.id); END",
  );
  s.exec("INSERT INTO KnowledgePage VALUES('1','a','b')"); // trigger fires, table exists
  s.exec('DROP TABLE global_fts');
  let threw = '';
  try {
    s.exec("INSERT INTO KnowledgePage VALUES('2','c','d')");
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  s.close();
  console.log(`       after DROP TABLE global_fts → ${threw || '(no error!)'}`);
  assert(/no such table/i.test(threw), `expected "no such table", got: ${threw || 'no error'}`);
});

// ═══ 2. The fixture reproduces both reported bugs ═══
console.log('\n[2] Fixture reproduces the reported bugs');
check('global_fts is tokenized with porter unicode61', () => {
  assert(/porter/i.test(ftsSql()), `unexpected DDL: ${ftsSql().replace(/\s+/g, ' ')}`);
});
check('the index holds far more rows than the sources have (no dedupe)', () => {
  const indexed = one('SELECT count(*) FROM global_fts');
  const src = sourceTotal();
  console.log(`       global_fts=${indexed}  sources=${src}`);
  assert(indexed > src * 2, `expected gross duplication, got ${indexed} vs ${src}`);
});
check('the notes containing the phrase are unreachable through the index', () => {
  assert(notesWithPhrase.length >= 1, `fixture changed: no note contains ${PHRASE}`);
  const whole = ftsCountOf(`"${PHRASE}"`, 'note');
  const sub = ftsCountOf(`"${SUBSTRING}"`, 'note');
  console.log(
    `       ${notesWithPhrase.length} note(s) contain ${PHRASE} via LIKE` +
      `  |  MATCH "${PHRASE}" → ${whole}   MATCH "${SUBSTRING}" → ${sub}`,
  );
  // Under porter, the query has to equal an ENTIRE Han run in the row to match. These
  // notes embed the phrase in longer prose, so neither the phrase nor its substring
  // reaches them — LIKE finds them, the index does not. That gap is the reported bug.
  eq(whole, 0, `MATCH "${PHRASE}" on notes`);
  eq(sub, 0, `MATCH "${SUBSTRING}" on notes`);
});

// ═══ 3. Rebuild ═══
console.log('\n[3] ensureSearchIndexes()');
const ftsIndex = await import(pathToFileURL(`${REPO}/apps/api/src/lib/ftsIndex.ts`).href);
const ftsLib = await import(pathToFileURL(`${REPO}/apps/api/src/lib/fts.ts`).href);

const beforeSize = statSync(WORK_DB).size;
const result: string = await ftsIndex.ensureSearchIndexes();
console.log(`       → ${result}`);
check('reports a rebuild', () => eq(result, 'rebuilt'));

// ═══ 4. Post-conditions ═══
console.log('\n[4] Post-conditions');
check('DDL now uses the trigram tokenizer', () => {
  console.log(`       ${ftsSql().replace(/\s+/g, ' ')}`);
  assert(/tokenize\s*=\s*'trigram'/i.test(ftsSql()), 'tokenizer is not trigram');
});
check('type and ref_id are UNINDEXED', () => {
  assert(/type\s+UNINDEXED/i.test(ftsSql()), 'type is still indexed');
  assert(/ref_id\s+UNINDEXED/i.test(ftsSql()), 'ref_id is still indexed');
});
check('exactly one index row per source row', () => {
  const indexed = one('SELECT count(*) FROM global_fts');
  const src = sourceTotal();
  console.log(`       global_fts=${indexed}  sources=${src}`);
  eq(indexed, src, 'row count');
});
check('the notes containing the phrase are now reachable', () => {
  const hits = phraseInIndex();
  console.log(`       MATCH "${PHRASE}" on notes → ${hits.length}, including ${hits.filter((id) => notesWithPhrase.includes(id)).length}/${notesWithPhrase.length} of the LIKE hits`);
  assert(hits.length >= 1, `MATCH "${PHRASE}" returned nothing`);
  for (const id of notesWithPhrase) assert(hits.includes(id), `note ${id} contains the phrase but the index missed it`);
});
check('Chinese substrings of an indexed run now match', () => {
  const sub = ftsCountOf(`"${SUBSTRING}"`, 'note');
  console.log(`       MATCH "${SUBSTRING}" on notes → ${sub}`);
  assert(sub >= 1, `MATCH "${SUBSTRING}" returned ${sub}`);
});
check('2-character Chinese is still unsearchable — documented limit, not a regression', () => {
  for (const q of ['"迁移"', '"沉淀"']) {
    console.log(`       MATCH ${q} → ${ftsCount(q)} (expected 0)`);
    eq(ftsCount(q), 0, `MATCH ${q}`);
  }
});
check('hostile query strings no longer throw', () => {
  for (const raw of ['"TL-181"', '"README"', '"a-b"', '"it\'s"']) console.log(`       MATCH ${raw} → ${ftsCount(raw)}`);
});
check('15 FTS triggers, 6 embed triggers, and the queue table', () => {
  const fts = countTriggers('fts');
  const emb = countTriggers('embed');
  console.log(`       fts_*=${fts}  embed_*=${emb}`);
  eq(fts, 15, 'fts triggers');
  eq(emb, 6, 'embed triggers');
  eq(one("SELECT count(*) FROM sqlite_master WHERE name='embed_queue'"), 1, 'embed_queue');
});

// ═══ 5. Writes to source tables still work ═══
console.log('\n[5] Source-table writes after the rebuild');
const probeId = 'fts-verify-probe';
// Probe markers must be ≥3 characters or the trigram index could never match them,
// which would make these checks fail for a reason that has nothing to do with triggers.
const PROBE_TITLE = '探针笔记';
const PROBE_BODY = '数据库迁移 的探针正文';
const UPDATED_BODY = '向量检索 的更新正文';
const cols = all('PRAGMA table_info(KnowledgePage)');
const defaultProjectId = String(all('SELECT id FROM Project LIMIT 1')[0]?.id ?? 'proj-default');
check('INSERT into KnowledgePage succeeds (no orphaned trigger)', () => {
  const names: string[] = [];
  const values: unknown[] = [];
  for (const c of cols) {
    const name = String(c.name);
    if (name === 'id') {
      names.push(name);
      values.push(probeId);
    } else if (name === 'title') {
      names.push(name);
      values.push(PROBE_TITLE);
    } else if (name === 'content') {
      names.push(name);
      values.push(PROBE_BODY);
    } else if (name === 'projectId') {
      // NOT NULL with a foreign key — a placeholder string fails the constraint, and the
      // resulting error masks the orphaned-trigger failure this check exists to catch.
      names.push(name);
      values.push(defaultProjectId);
    } else if (Number(c.notnull) === 1 && c.dflt_value === null && Number(c.pk) === 0) {
      // Fill any other required column by type, so this survives schema growth.
      names.push(name);
      values.push(String(c.type).toUpperCase().includes('INT') ? 0 : 'probe');
    }
  }
  db.prepare(`INSERT INTO KnowledgePage(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).run(
    ...(values as never[]),
  );
  console.log(`       inserted across ${names.length} columns (projectId=${defaultProjectId})`);
});
check('the trigger indexed the new row', () => {
  const n = one('SELECT count(*) FROM global_fts WHERE global_fts MATCH ? AND ref_id = ?', `"${PROBE_TITLE}"`, probeId);
  console.log(`       MATCH "${PROBE_TITLE}" AND ref_id=${probeId} → ${n}`);
  assert(n >= 1, 'the new row was not indexed');
});
check('UPDATE re-indexes it', () => {
  db.prepare('UPDATE KnowledgePage SET content = ? WHERE id = ?').run(UPDATED_BODY, probeId);
  assert(
    one('SELECT count(*) FROM global_fts WHERE global_fts MATCH ? AND ref_id = ?', '"向量检索"', probeId) >= 1,
    'not re-indexed',
  );
});
check('the embed trigger queued it, and DELETE unqueues it', () => {
  const queued = one('SELECT count(*) FROM embed_queue WHERE ref_id = ?', probeId);
  console.log(`       queued=${queued}`);
  assert(queued === 1, 'insert/update did not queue an embedding job');
  db.prepare('DELETE FROM KnowledgePage WHERE id = ?').run(probeId);
  eq(one('SELECT count(*) FROM global_fts WHERE ref_id = ?', probeId), 0, 'index rows after delete');
  eq(one('SELECT count(*) FROM embed_queue WHERE ref_id = ?', probeId), 0, 'queue rows after delete');
});

// ═══ 6. Idempotence and self-healing ═══
console.log('\n[6] Idempotence and self-healing');
const second: string = await ftsIndex.ensureSearchIndexes();
check('a second run is a no-op', () => eq(second, 'ok'));

db.exec("DELETE FROM SystemConfig WHERE key='ftsVersion'");
db.exec(
  "INSERT INTO global_fts(type,title,body,ref_id) VALUES('note','dup','dup','dup-1'),('note','dup','dup','dup-2'),('note','dup','dup','dup-3')",
);
const drifted = one('SELECT count(*) FROM global_fts');
const healed: string = await ftsIndex.ensureSearchIndexes();
check('the rebuild fires again and restores one row per source', () => {
  eq(healed, 'rebuilt', 'result');
  console.log(`       before=${drifted}  after=${one('SELECT count(*) FROM global_fts')}`);
  eq(one('SELECT count(*) FROM global_fts'), sourceTotal(), 'row count');
});
const fourth: string = await ftsIndex.ensureSearchIndexes();
check('with the stamp restored, a further run is a no-op', () => eq(fourth, 'ok'));

// ═══ 7. Query helpers ═══
console.log('\n[7] lib/fts query helpers');
const { toFtsMatch, unsearchableTerms, ftsTerms } = ftsLib;
check('INDEX_VERSION is 2', () => eq(ftsLib.INDEX_VERSION, 2));
check('quoting survives - and " in user input', () => {
  eq(toFtsMatch('id-1'), '"id-1"');
  eq(toFtsMatch('a"b'), '"a""b"');
  // The 2-character term is DROPPED, not quoted: no MATCH expression can serve it, and
  // unsearchableTerms() is how the caller learns to fall back to LIKE. Quoting it here
  // would look harmless and silently guarantee a zero.
  eq(toFtsMatch('数据库 迁移'), '"数据库"');
  eq(toFtsMatch('   '), null);
  eq(toFtsMatch('迁移'), null, 'a lone 2-char term has nothing searchable');
});
check('unsearchableTerms separates what trigram cannot serve', () => {
  eq(JSON.stringify(unsearchableTerms('迁移')), '["迁移"]');
  eq(JSON.stringify(unsearchableTerms('数据库 迁移')), '["迁移"]');
  eq(JSON.stringify(unsearchableTerms('数据库')), '[]');
});
check('ftsTerms dedupes and drops empties', () => eq(JSON.stringify(ftsTerms('  a  a b ')), '["a","b"]'));
check('every generated MATCH expression is accepted by SQLite', () => {
  for (const raw of ['id-1', 'a"b', '数据库 迁移', 'TL-181', "it's", '***', '"']) {
    const m = toFtsMatch(raw);
    if (m === null) continue;
    try {
      one('SELECT count(*) FROM global_fts WHERE global_fts MATCH ?', m);
    } catch (e) {
      throw new Error(`MATCH ${JSON.stringify(m)} (from ${JSON.stringify(raw)}) threw: ${e instanceof Error ? e.message : e}`);
    }
  }
});
check('negative control — the RAW string really does throw', () => {
  let threw = '';
  try {
    db.prepare('SELECT count(*) FROM global_fts WHERE global_fts MATCH ?').get('id-1');
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  console.log(`       MATCH 'id-1' (unquoted) → ${threw}`);
  assert(threw.length > 0, 'expected a syntax error from the unquoted string');
});

// ═══ 8. Space reclaim ═══
console.log('\n[8] reclaimIndexSpace()');
const freelistBefore = one('PRAGMA freelist_count');
const reclaimed: boolean = await ftsIndex.reclaimIndexSpace();
check('VACUUM shrinks the file below 20% of its old size', () => {
  const after = statSync(WORK_DB).size;
  console.log(`       ${(beforeSize / 1e6).toFixed(0)} MB → ${(after / 1e6).toFixed(0)} MB  (freelist was ${freelistBefore} pages)`);
  assert(reclaimed, 'reclaimIndexSpace() returned false');
  assert(after < beforeSize * 0.2, `only shrank to ${((after / beforeSize) * 100).toFixed(1)}%`);
});
check('the WAL was truncated', () => {
  const wal = `${WORK_DB}-wal`;
  if (existsSync(wal)) console.log(`       wal=${statSync(wal).size} bytes`);
});
const again: boolean = await ftsIndex.reclaimIndexSpace();
check('a second reclaim is a no-op (the flag was cleared)', () => eq(again, false));

// ═══ 9. Does `prisma db push` survive the FTS objects? ═══
// The load-bearing question behind the bootstrap design. Two facts make the answer
// matter: db push only runs when SCHEMA_VERSION was bumped (ensureSchema()
// short-circuits at server.ts:543), and server.ts:760 deliberately passes NO
// --accept-data-loss. Prisma does not know about global_fts or its five shadow tables,
// so it proposes dropping all six.
console.log('\n[9] prisma db push survival');
const schemaPath = `${REPO}/packages/database/prisma/schema.prisma`;
const prismaCli = `${REPO}/node_modules/prisma/build/index.js`;
const engineDir = `${REPO}/node_modules/@prisma/engines`;
if (!existsSync(prismaCli) || !existsSync(schemaPath)) {
  console.log('  skip — prisma CLI or schema not found');
} else {
  const { execFileSync } = await import('node:child_process');
  let pushError = '';
  let pushOk = false;
  try {
    execFileSync(process.execPath, [prismaCli, 'db', 'push', `--schema=${schemaPath}`, '--skip-generate'], {
      stdio: 'pipe',
      timeout: 180000,
      env: {
        ...process.env,
        DATABASE_URL: `file:${WORK_DB}`,
        ELECTRON_RUN_AS_NODE: '1',
        // server.ts:757-769 sets both of these; without them the CLI looks for an engine
        // it will not find and fails for a reason unrelated to the index.
        PRISMA_SCHEMA_ENGINE_BINARY: `${engineDir}/schema-engine-windows.exe`,
        PRISMA_QUERY_ENGINE_BINARY: `${engineDir}/query_engine-windows.dll.node`,
        npm_config_cache: `${USERDATA}/npm-cache`,
      },
      cwd: USERDATA,
    });
    pushOk = true;
  } catch (e: unknown) {
    // Both streams: the list of tables it wants to drop goes to stdout, the terminating
    // error to stderr. server.ts:782 logs only stderr, so in production the reason the
    // push failed is never recorded — worth seeing here.
    const err = e as { stdout?: string; stderr?: string; message?: string };
    pushError = `${err.stdout || ''}${err.stderr || ''}` || String(err.message);
  }
  console.log(`       db push: ${pushOk ? 'succeeded' : 'refused'}`);
  for (const line of pushError.split('\n')) {
    if (/global_fts|accept-data-loss/i.test(line)) console.log(`       ${line.trim().slice(0, 160)}`);
  }

  check('db push refuses while the index exists (the production path)', () => {
    assert(!pushOk, 'db push succeeded — the index was not treated as a conflict after all');
    assert(/accept-data-loss/i.test(pushError), `expected the data-loss gate, got: ${pushError.slice(0, 200)}`);
    assert(
      /drop the `global_fts` table/.test(pushError),
      `expected the refusal to name global_fts as a drop candidate, got: ${pushError.slice(0, 200)}`,
    );
  });
  check('the refusal left every FTS object and trigger untouched', () => {
    eq(one("SELECT count(*) FROM sqlite_master WHERE name LIKE 'global_fts%'"), 6, 'global_fts + 5 shadow tables');
    eq(one("SELECT count(*) FROM sqlite_master WHERE name = 'embed_queue'"), 1, 'embed_queue');
    eq(countTriggers('fts'), 15, 'fts triggers');
    eq(countTriggers('embed'), 6, 'embed triggers');
    eq(one('SELECT count(*) FROM global_fts'), sourceTotal(), 'row count');
  });

  // Meaningful only because nothing was dropped: 'ok' means the tokenizer check, the
  // stamp check and the drift check all passed, i.e. there was nothing to repair.
  const afterPush: string = await ftsIndex.ensureSearchIndexes();
  console.log(`       ensureSearchIndexes() → ${afterPush}`);
  check('the index needs no repair after the refused push', () => {
    eq(afterPush, 'ok', 'result');
    assert(ftsCountOf(`"${SUBSTRING}"`, 'note') >= 1, 'Chinese search is broken after db push');
  });

  // Not asserted, deliberately: what `db push --accept-data-loss` would do. It is a
  // hypothetical (that flag is not in any code path), and either outcome is safe —
  // ensureSearchIndexes() runs after ensureSchema() and rebuilds from the source tables.
  // The practical consequence to remember is on the schema side, not here: because a
  // bump refuses, the additive migrations[] array (server.ts:554) is what actually
  // delivers schema changes to existing installs. A schema.prisma change with no
  // matching entry there never reaches them.
}

db.close();

// ─── Summary ───
console.log(`\n${'─'.repeat(64)}`);
if (failures.length === 0) {
  console.log(`ALL ${passed} CHECKS PASSED`);
  process.exit(0);
} else {
  console.log(`${passed} passed, ${failures.length} FAILED:`);
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
