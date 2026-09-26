// ═══ Phase verification — which importer owns a picked file ═══
//
//   npx tsx scripts/test-import-pick.mts
//
// Exercises `apps/web/src/lib/import/buckets.ts`, the module that decides which of the
// three importers a file from a single-button pick belongs to. Follows the conventions of
// `scripts/test-import-mime.mts`: same `check/eq/assert` helpers, explicit `.ts` module
// URL, script under `scripts/` so nothing here ships.
//
// ─── Why this is testable at all ───
//
// `buckets.ts` imports nothing, and `bucketPickedFiles` is generic over `{ name }` rather
// than `File`, so this runs under plain Node: no DOM, no `@/` alias, no Electron. The rest
// of the import path (`runImport.ts`) reaches for `@/lib/api` and cannot be run here — the
// dispatch loop is covered by the manual checks in the plan instead.
//
// ─── What is actually at stake ───
//
// Every failure mode in this module is **silent**. A file the picker offers but no bucket
// claims, an extension missing from `IMPORT_ACCEPT` so the picker never offers a format the
// importers support, a bucket missing from `IMPORT_ORDER` so its files are collected and
// then never dispatched — none of these throws, none of them shows up as an error, and all
// of them end as a note the user selected that never arrived. So the assertions below are
// mostly about *agreement between two lists* rather than about one function's output.

import {
  IMPORT_ACCEPT,
  IMPORT_ORDER,
  BUCKET_EXTS,
  bucketOf,
  bucketPickedFiles,
  type ImportBucket,
} from '../apps/web/src/lib/import/buckets.ts';

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
function eqList(actual: readonly unknown[], expected: readonly unknown[], what = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what} expected ${b}, got ${a}`);
}
function section(title: string) {
  console.log(`\n[${title}]`);
}

/** The extensions of a bucket, with the leading dot, as the test names them. */
const EXTS: Record<ImportBucket, readonly string[]> = BUCKET_EXTS;

// ─── Every extension, and the bucket it has to land in ───
//
// Written out rather than derived from `BUCKET_EXTS`, because a test that reads its
// expectations from the thing under test asserts nothing. If a bucket's list changes, this
// table has to change too — which is the point.

section('each extension lands in its own bucket');
const OWNER: Array<[string, ImportBucket]> = [
  ['a.md', 'markdown'],
  ['a.markdown', 'markdown'],
  ['a.txt', 'markdown'],
  ['a.html', 'html'],
  ['a.htm', 'html'],
  ['a.mht', 'mht'],
  ['a.mhtml', 'mht'],
];
for (const [name, bucket] of OWNER) {
  check(`${name} → ${bucket}`, () => eq(bucketOf(name), bucket));
}

// ─── Case ───
//
// `accept` is matched against the extension without regard to case, so the picker offers
// `.MD` and it has to have an owner. A case-sensitive comparison here would collect the
// file into no bucket at all, and the dispatcher would report it as "not a format this
// imports" while the picker's own filter said otherwise.

section('the comparison is case-insensitive');
for (const name of ['A.MD', 'A.Markdown', 'A.TXT', 'A.HTML', 'A.HTM', 'A.MHT', 'A.MHTML']) {
  check(`${name} has an owner`, () => assert(bucketOf(name) !== null, 'no bucket claimed it'));
}
check('.MD and .md agree', () => eq(bucketOf('A.MD'), bucketOf('a.md')));
check('.HTML and .html agree', () => eq(bucketOf('A.HTML'), bucketOf('a.html')));
check('.Mht and .mht agree', () => eq(bucketOf('A.Mht'), bucketOf('a.mht')));

// ─── What must not be claimed ───
//
// A false positive here is the worse direction: the file is pulled into a bucket, the
// importer's own filter then rejects it, and it is counted nowhere — not imported, not
// reported.

section('files no importer claims');
for (const name of [
  'a.png',
  'a.pdf',
  'a.docx',
  'a', // no extension at all
  'a.', // a trailing dot is not an extension
  'a.md.bak', // ends in .bak, which is not a format
]) {
  check(`${name} → no bucket`, () => eq(bucketOf(name), null));
}
// The *last* dot-segment decides, exactly as the OS and the picker's own filter read a
// file's type. Stated as its own assertion because it is a reading rather than an accident:
// `a.html.txt` is a text file, whatever the earlier segments look like.
check('a.html.txt is a text file, not a page', () => eq(bucketOf('a.html.txt'), 'markdown'));
check('a.markdown.md is a markdown file', () => eq(bucketOf('a.markdown.md'), 'markdown'));

// ─── The two lists cannot disagree ───
//
// The load-bearing assertion of this file. `IMPORT_ACCEPT` is what the picker filters for;
// `BUCKET_EXTS` is what the bucketer claims. A file the user is offered but no importer
// owns is a file that vanishes; a format with a bucket but no `accept` entry is a format
// nobody can pick.

section('accept and the buckets are the same set');
check('IMPORT_ACCEPT covers every extension of every bucket', () => {
  const accepted = new Set(IMPORT_ACCEPT.split(','));
  for (const bucket of IMPORT_ORDER) {
    for (const ext of EXTS[bucket]) assert(accepted.has(ext), `${ext} is in BUCKET_EXTS but not in accept`);
  }
});
check('every accepted extension lands in a bucket', () => {
  for (const ext of IMPORT_ACCEPT.split(',')) {
    assert(ext.startsWith('.'), `${ext} is not an extension`);
    assert(bucketOf(`x${ext}`) !== null, `accept offers ${ext} and no bucket claims it`);
  }
});
check('accept has no duplicates', () => {
  const list = IMPORT_ACCEPT.split(',');
  eqList(Array.from(new Set(list)).sort(), [...list].sort());
});

// ─── The buckets are a partition ───
//
// Two buckets claiming one extension would make `IMPORT_ORDER` decide the owner, which is
// not a decision anyone should inherit by accident.

section('the buckets do not overlap');
check('no extension appears in two buckets', () => {
  const all = IMPORT_ORDER.flatMap((b) => [...EXTS[b]]);
  eqList(Array.from(new Set(all)).sort(), [...all].sort());
});
check('IMPORT_ORDER covers every bucket', () => {
  // A bucket the order does not visit is collected by `bucketPickedFiles` and then never
  // dispatched: its files are missing from the import and from every count in the summary.
  eqList([...IMPORT_ORDER].sort(), (Object.keys(BUCKET_EXTS) as ImportBucket[]).sort());
});
check('IMPORT_ORDER has no repeats', () => {
  eqList(Array.from(new Set(IMPORT_ORDER)), [...IMPORT_ORDER]);
});

// ─── The split itself ───

section('one pick, split');
const picked = bucketPickedFiles([
  { name: 'note.md' },
  { name: 'page.html' },
  { name: 'archive.mht' },
  { name: 'README.txt' },
  { name: 'photo.png' },
  { name: 'SECOND.MD' },
]);
check('markdown gets .md, .txt and the upper-case .MD alike', () =>
  eqList(picked.markdown.map((f) => f.name), ['note.md', 'README.txt', 'SECOND.MD']));
check('html gets the page', () => eqList(picked.html.map((f) => f.name), ['page.html']));
check('mht gets the archive', () => eqList(picked.mht.map((f) => f.name), ['archive.mht']));
check('unknown gets the one nothing claims', () => eqList(picked.unknown.map((f) => f.name), ['photo.png']));
check('every file is in exactly one bucket', () => {
  const n = picked.markdown.length + picked.html.length + picked.mht.length + picked.unknown.length;
  eq(n, 6);
});

section('the split is a pure read');
check('the input is left alone and its objects are reused, not copied', () => {
  const input = [{ name: 'note.md' }, { name: 'photo.png' }];
  const out = bucketPickedFiles(input);
  eq(input.length, 2, 'input length changed:');
  eq(out.markdown.length, 1);
  eq(out.unknown.length, 1);
  assert(out.markdown[0] === input[0], 'the bucketer copied the object instead of passing it through');
  assert(out.unknown[0] === input[1], 'the bucketer copied the object instead of passing it through');
});
check('running it twice gives the same answer', () => {
  const input = [{ name: 'a.md' }, { name: 'b.mht' }];
  const first = bucketPickedFiles(input);
  const second = bucketPickedFiles(input);
  eqList(first.markdown.map((f) => f.name), second.markdown.map((f) => f.name));
  eqList(first.mht.map((f) => f.name), second.mht.map((f) => f.name));
  eqList(first.unknown.map((f) => f.name), second.unknown.map((f) => f.name));
});
check('an empty pick gives four empty buckets, not undefined', () => {
  const out = bucketPickedFiles([]);
  for (const bucket of IMPORT_ORDER) eq(out[bucket].length, 0, `${bucket}:`);
  eq(out.unknown.length, 0);
});
check('order within a bucket is the pick order', () => {
  const out = bucketPickedFiles([{ name: 'c.md' }, { name: 'a.mht' }, { name: 'b.md' }]);
  eqList(out.markdown.map((f) => f.name), ['c.md', 'b.md']);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
