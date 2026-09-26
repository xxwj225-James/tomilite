// ═══ Global search verification — fusion, ranking and snippets ═══
//
//   npx tsx scripts/test-search.mts
//
// Two halves. Sections [1]-[4] are pure: no database, no server, no embedding model.
// That is the whole reason lib/searchFusion.ts exists as a separate module from
// lib/searchCore.ts — the ranking rules are the part that is easy to get subtly wrong
// and impossible to eyeball, and this is the only place they can be asserted directly.
//
// Section [5] is the opposite: it drives the real globalSearch() against a COPY of the
// live corpus, because the pure half cannot tell whether the pipeline is actually wired
// up. It skips cleanly when there is no snapshot, so the pure checks still run anywhere.
// Nothing ever touches the live database — contrast scripts/test-fts.mts, which needs
// the same snapshot for a different reason (tokenizer behaviour against real rows).
//
// Like test-fts.mts, this file is covered by lint but by no tsconfig, so the types are
// spelled out rather than inferred from a build.

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

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

const F = (await import(pathToFileURL(`${REPO}/apps/api/src/lib/searchFusion.ts`).href)) as {
  RRF_K: number;
  SEMANTIC_WEIGHT: number;
  PER_LIST_KEYWORD: number;
  MAX_PER_KIND: number;
  fuseRrf(keywordIds: string[], semanticLists: string[][]): Array<{
    id: string;
    score: number;
    match: string;
    keywordRank?: number;
    semanticRank?: number;
  }>;
  applyKindCap<T extends { id: string }>(e: T[], kindOf: (x: T) => string, limit: number, max?: number): T[];
  firstIndexOfAny(text: string, terms: string[]): number;
  windowSnippet(body: string, terms: string[]): string;
};

const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

// ═══ [1] The weighting invariant ═══
console.log('\n[1] keyword block strictly precedes the semantic block');

check('SEMANTIC_WEIGHT is consistent with PER_LIST_KEYWORD', () => {
  // The proof encoded as an assertion. If either constant is edited alone, the
  // separation breaks and the result list silently starts alternating — which no
  // visual inspection of the palette would reveal. Fail here instead.
  const lastKeyword = 1 / (F.RRF_K + F.PER_LIST_KEYWORD);
  const firstSemantic = F.SEMANTIC_WEIGHT / (F.RRF_K + 1);
  console.log(
    `       last keyword = ${lastKeyword.toFixed(6)}  first semantic = ${firstSemantic.toFixed(6)}`,
  );
  assert(
    firstSemantic < lastKeyword,
    `SEMANTIC_WEIGHT=${F.SEMANTIC_WEIGHT} with PER_LIST_KEYWORD=${F.PER_LIST_KEYWORD} does not separate the lists`,
  );
});

check('every keyword hit outranks every semantic hit, over a full-length list', () => {
  const fused = F.fuseRrf(ids(F.PER_LIST_KEYWORD, 'k'), [ids(F.PER_LIST_KEYWORD, 's')]);
  const lastKeywordScore = fused.filter((e) => e.keywordRank !== undefined).map((e) => e.score).sort((a, b) => a - b)[0];
  const firstSemanticScore = fused.filter((e) => e.match === 'semantic').map((e) => e.score).sort((a, b) => b - a)[0];
  assert(firstSemanticScore < lastKeywordScore, 'a semantic hit outranked a keyword hit');
  // And the consequence the UI depends on: the semantic run is contiguous.
  const firstSemanticAt = fused.findIndex((e) => e.match === 'semantic');
  const tainted = fused.slice(firstSemanticAt).some((e) => e.match !== 'semantic');
  assert(!tainted, 'the semantic block is not contiguous — the boundary separator would be wrong');
});

check('an id found by both lists scores above the same rank found by one', () => {
  const onlyKeyword = F.fuseRrf(['a'], [])[0];
  const onlySemantic = F.fuseRrf([], [['a']])[0];
  const both = F.fuseRrf(['a'], [['a']])[0];
  eq(both.match, 'both', 'match source');
  assert(both.score > onlyKeyword.score, 'both did not beat keyword-only');
  assert(both.score > onlySemantic.score, 'both did not beat semantic-only');
});

check('the order is deterministic for identical input', () => {
  const a = F.fuseRrf(ids(20, 'k'), [ids(20, 's')]).map((e) => e.id);
  const b = F.fuseRrf(ids(20, 'k'), [ids(20, 's')]).map((e) => e.id);
  eq(a.join(','), b.join(','), 'two identical fusions disagreed');
});

check('OR semantics: an id absent from every list is simply absent', () => {
  eq(F.fuseRrf([], []).length, 0, 'empty fusion');
  eq(F.fuseRrf(['a', 'b'], []).length, 2, 'keyword-only fusion');
});

// ═══ [2] match-source labelling ═══
console.log('\n[2] match source');

check('semantic-only rows are labelled and carry no keyword rank', () => {
  const fused = F.fuseRrf(['k1'], [['s1']]);
  const sem = fused.find((e) => e.id === 's1');
  eq(sem?.match, 'semantic', 'match source');
  eq(sem?.keywordRank, undefined, 'keywordRank on a semantic-only row');
  eq(sem?.semanticRank, 1, 'semanticRank');
});

check('a semantic-only row can still outrank a low keyword row', () => {
  // It cannot — and that is the point of the weight. Rank 59 of the keyword list must
  // still beat semantic rank 1, so a row cannot be pulled above a verbatim match.
  const fused = F.fuseRrf(ids(60, 'k'), [['s1']]);
  const semAt = fused.findIndex((e) => e.id === 's1');
  eq(semAt, 60, 'the semantic row should sit after all 60 keyword rows');
});

// ═══ [3] Per-kind cap ═══
console.log('\n[3] per-kind cap');

check('the cap promotes the rare kind into the visible window', () => {
  // 20 chat rows ahead of 5 note rows, limit 20. Uncapped, every note sits at position
  // 21-25 — beyond the cut, so a note-heavy question would show no notes at all.
  const entries = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, kind: 'chat' })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, kind: 'note' })),
  ];
  const capped = F.applyKindCap(entries, (e) => e.kind, 20, 8);
  const lastNoteAt = capped.map((e) => e.kind).lastIndexOf('note');
  console.log(`       last note at position ${lastNoteAt} of ${capped.length}`);
  assert(lastNoteAt < 20, `a note fell outside the limit at position ${lastNoteAt}`);
  eq(capped.length, 20, 'the list should still fill to the limit');
});

check('the second pass refills rather than shortening the list', () => {
  // Deliberate, and worth pinning: with 30 of one kind and a limit of 25, the cap alone
  // would return 8. Reporting 8 results when 30 matched would misrepresent the corpus,
  // and there is no per-kind filter for the user to recover the rest with. So the cap
  // reorders within the window; it does not truncate.
  const entries = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, kind: 'chat' }));
  eq(F.applyKindCap(entries, (e) => e.kind, 25, 8).length, 25, 'the list was shortened by the cap');
});

check('no cap fires when the corpus is balanced', () => {
  const entries = [
    ...Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, kind: 'chat' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `n${i}`, kind: 'note' })),
  ];
  const capped = F.applyKindCap(entries, (e) => e.kind, 6, 8);
  eq(capped.length, 6, 'length');
});

// ═══ [4] Snippets ═══
console.log('\n[4] snippet windowing');

check('a match deep inside a long body is windowed around, not truncated from the head', () => {
  const body = `${'前言 '.repeat(40)}数据库迁移${' 后记'.repeat(40)}`;
  const s = F.windowSnippet(body, ['数据库迁移']);
  assert(s.includes('数据库迁移'), `the match is missing from the snippet: ${s}`);
  assert(s.length < 260, `the snippet was not windowed: ${s.length} chars`);
  assert(s.startsWith('…'), 'a window taken from the middle should be marked with a leading ellipsis');
});

check('a body with no match falls back to its head', () => {
  const s = F.windowSnippet('无匹配的正文', ['数据库']);
  eq(s, '无匹配的正文', 'fallback snippet');
  const long = F.windowSnippet('x'.repeat(400), []);
  assert(long.endsWith('…'), 'a truncated head should be marked');
  assert(long.length <= 181, `unexpected head length: ${long.length}`);
});

check('case-insensitive for ASCII, exact for CJK', () => {
  eq(F.firstIndexOfAny('Hello World', ['world']), 6, 'ascii case fold');
  eq(F.firstIndexOfAny('数据库迁移', ['迁移']), 3, 'cjk index');
  eq(F.firstIndexOfAny('abc', ['zzz']), -1, 'missing term');
});

check('the earliest of several terms wins', () => {
  eq(F.firstIndexOfAny('数据库迁移方案', ['迁移', '数据库']), 0, 'earliest term');
});

check('a length-changing case fold does not shift the window', () => {
  // 'İ'.toLowerCase() expands to two code points. If the helper trusted the lowercased
  // haystack unconditionally, every index after it would be off by one and the snippet
  // would window the wrong text — silently, and only for certain inputs.
  const text = 'İstanbul 数据库';
  eq(F.firstIndexOfAny(text, ['数据库']), text.indexOf('数据库'), 'index after an expanding fold');
});

// ═══ [5] End to end — globalSearch() over a copy of the real corpus ═══
//
// Sections [1]-[4] prove the ranking RULES. This one proves the pipeline is WIRED: a
// term lifted out of a real row of each of the six source tables has to come back out
// of globalSearch() as that row, with the kind, the id and the parent context a deep
// link needs. Nothing is hardcoded about the corpus — every probe is derived from the
// snapshot at run time, so the assertions cannot drift out of date with the data.
//
// It needs a snapshot, so it skips cleanly without one. The copy is never the live DB.
console.log('\n[5] globalSearch() over the real corpus');

// Defaults to the LIVE dev database, not C:/tmp/tl/dev.db (which scripts/test-fts.mts
// uses): that one is a snapshot from Sep 12 carrying schema v23, before `Issue` gained
// `source`/`sourceId`. Prisma validates `enrich()`'s select against the client's schema,
// so a pre-v26 corpus fails with "The column main.Issue.source does not exist" — a
// failure of the fixture, not of the code. This install runs journal_mode=delete, so a
// plain copy is atomic; the sidecars are copied too in case an install is in WAL mode.
const SNAPSHOT = process.env.TL_SNAPSHOT || `${homedir()}/.tomilite/dev.db`;
const DIR = 'C:/tmp/tl/verify';
const WORK_DB = `${DIR}/search.db`;

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    failures.push(`${name} → ${m}`);
    console.log(`  FAIL ${name} → ${m}`);
  }
}

if (!existsSync(SNAPSHOT)) {
  console.log(`  skip  no snapshot at ${SNAPSHOT} (set TL_SNAPSHOT to include this section)`);
} else {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  for (const f of [WORK_DB, `${WORK_DB}-wal`, `${WORK_DB}-shm`]) rmSync(f, { force: true });
  copyFileSync(SNAPSHOT, WORK_DB);
  for (const side of ['-wal', '-shm']) {
    if (existsSync(`${SNAPSHOT}${side}`)) copyFileSync(`${SNAPSHOT}${side}`, `${WORK_DB}${side}`);
  }
  process.env.DATABASE_URL = `file:${WORK_DB}`;

  // DERIVED, not chosen: `MatchSource` is asserted by value, so the strings are typed
  // out here rather than imported — this file is covered by no tsconfig.
  interface CoreHit {
    kind: string;
    id: string;
    title: string;
    snippet: string;
    match: string;
    highlights: string[];
    sessionId?: string;
    messageRole?: string;
    segmentQuery?: string;
  }
  interface CoreResponse {
    hits: CoreHit[];
    semantic: string;
    keywordHits: number;
    degraded: string;
  }
  const core = (await import(pathToFileURL(`${REPO}/apps/api/src/lib/searchCore.ts`).href)) as {
    globalSearch(query: string, limit?: number): Promise<CoreResponse>;
  };
  const ftsIndex = (await import(pathToFileURL(`${REPO}/apps/api/src/lib/ftsIndex.ts`).href)) as {
    ensureSearchIndexes(): Promise<string>;
  };

  const sql = new DatabaseSync(WORK_DB);
  const all = (s: string) => sql.prepare(s).all() as Array<Record<string, unknown>>;
  const scalar = (s: string) => {
    const r = sql.prepare(s).get();
    return r ? String(Object.values(r)[0]) : '';
  };

  /** The longest run of ≥6 Han, else of ≥6 alphanumerics, in a row's indexed text. */
  /** LIKE needs the wildcards in a term escaped \u2014 a probe is data, not a pattern. */
  const esc = (t: string) => t.replace(/[\\%_]/g, '\\$&');

  /**
   * How many index rows contain `term` as a substring.
   *
   * This is the fixture's whole selection rule: a probe is usable only when it occurs in
   * EXACTLY ONE row. A term found in fifty rows makes "the row did not come back" say
   * nothing \u2014 it was outranked past the limit, which is the ranking working, not the
   * pipeline failing. That distinction is the difference between a test and a coin flip:
   * an earlier version of this section lifted the word "Meeting" out of a meeting's
   * title and then blamed the code for the noise it had asked for.
   */
  const indexHits = (term: string) => {
    const r = sql
      .prepare("SELECT count(*) n FROM global_fts WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'")
      .get(`%${esc(term)}%`, `%${esc(term)}%`);
    return Number(r?.n ?? 0);
  };

  /**
   * Probe terms lifted out of a row, best first.
   *
   * Han runs first: in this corpus they are the distinctive ones. A word like "Meeting"
   * or "Update" is not, which is why the ASCII branch requires a digit \u2014 what it
   * proposes should be an identifier, not a dictionary word.
   */
  const candidates = (text: unknown): string[] => {
    const s = String(text ?? '');
    return [
      ...(s.match(/[\u4e00-\u9fff]{6,}/g) ?? []).map((m) => m.slice(0, 8)),
      ...(s.match(/[A-Za-z0-9_.-]{6,}/g) ?? []).filter((m) => /\d/.test(m)).map((m) => m.slice(0, 8)),
    ];
  };

  // The columns below are the ones the INDEX holds (lib/ftsIndex.ts SOURCES), not merely
  // the ones the tables have: a probe lifted from a column the index never saw would
  // only be findable through LIKE, and would prove nothing about the FTS path.
  // `SmartEmail.summary` is deliberately absent — the indexed body is
  // COALESCE(bodySnapshot, summary), so summary alone is not reachable.
  const TABLES: Array<{ kind: string; table: string; cols: string[] }> = [
    { kind: 'note', table: 'KnowledgePage', cols: ['title', 'content'] },
    { kind: 'task', table: 'Issue', cols: ['title', 'description'] },
    { kind: 'email', table: 'SmartEmail', cols: ['subject', 'bodySnapshot'] },
    { kind: 'report', table: 'Report', cols: ['title', 'content'] },
    { kind: 'chat', table: 'ChatMessage', cols: ['text'] },
    { kind: 'meeting', table: 'Meeting', cols: ['title', 'minutes', 'summary', 'transcript'] },
  ];

  /** The newest row of a table that yields a unique probe, and that probe. */
  const pick = (t: (typeof TABLES)[number]) => {
    for (const r of all(`SELECT * FROM ${t.table} ORDER BY rowid DESC LIMIT 60`)) {
      for (const c of t.cols) {
        for (const term of candidates(r[c])) {
          if (indexHits(term) === 1) return { id: String(r.id), term };
        }
      }
    }
    return null;
  };

  /** The first unique probe in a piece of text, or null when there is none. */
  const unique = (text: unknown): string | null => candidates(text).find((t) => indexHits(t) === 1) ?? null;

  /**
   * A note whose Han run is unique both in full and in its first two characters.
   *
   * Both halves matter: the unique 8-character form proves the FTS path, and the 2-char
   * prefix — below the trigram width, so unreachable by MATCH — proves the LIKE path
   * finds the SAME row. Two unrelated probes would leave open the possibility that the
   * LIKE row was simply some other note that happened to share the word.
   */
  const pickTwoChar = () => {
    for (const r of all('SELECT id, title, content FROM KnowledgePage ORDER BY rowid DESC LIMIT 60')) {
      for (const run of `${r.title ?? ''} ${r.content ?? ''}`.match(/[一-鿿]{6,}/g) ?? []) {
        const eight = run.slice(0, 8);
        const two = run.slice(0, 2);
        if (indexHits(eight) === 1 && indexHits(two) === 1) return { id: String(r.id), term: two, full: eight };
      }
    }
    return null;
  };

  const status = await ftsIndex.ensureSearchIndexes();
  console.log(`       ensureSearchIndexes() → ${status}`);

  const picks = new Map(TABLES.map((t) => [t.kind, pick(t)]));
  const pair = pickTwoChar();

  await checkAsync('every one of the six kinds is reachable by a term from its own row', async () => {
    for (const t of TABLES) {
      const p = picks.get(t.kind);
      if (!p) {
        console.log(`       (no probe for ${t.kind} — table has no text of the required shape)`);
        continue;
      }
      const res = await core.globalSearch(p.term, 20);
      const hit = res.hits.find((h) => h.id === p.id);
      assert(hit, `${t.kind}: ${JSON.stringify(p.term)} did not return its own row ${p.id}`);
      eq(hit?.kind, t.kind, `${t.kind} kind`);
    }
  });

  await checkAsync('no kind outside the six leaks in (git is indexed but not returned)', async () => {
    const ALLOWED = ['chat', 'note', 'task', 'meeting', 'email', 'report'];
    for (const t of TABLES) {
      const p = picks.get(t.kind);
      if (!p) continue;
      const res = await core.globalSearch(p.term, 20);
      const odd = res.hits.filter((h) => !ALLOWED.includes(h.kind));
      eq(odd.length, 0, `unexpected kinds for ${t.kind}: ${odd.map((h) => h.kind).join(',')}`);
    }
  });

  await checkAsync('a trigram-searchable term takes the FTS path, not the LIKE fallback', async () => {
    const p = picks.get('note')!;
    const res = await core.globalSearch(p.term, 20);
    eq(res.degraded, 'none', 'degraded');
    assert(res.keywordHits > 0, 'keywordHits');
  });

  await checkAsync('a 2-character CJK term is served by the LIKE fallback (trigram cannot)', async () => {
    // The structural limit lib/fts.ts documents: a 2-character Chinese word is below the
    // trigram width, so MATCH returns nothing and LIKE is the only way in. Not a corner
    // case in Chinese — and `degraded: 'like'` is the signal that the fallback answered.
    assert(pair, 'this corpus has no Han run whose 8-char form and 2-char prefix are both unique');
    const res = await core.globalSearch(pair!.term, 20);
    console.log(
      `       ${JSON.stringify(pair!.term)} (of ${JSON.stringify(pair!.full)}) → ` +
        `${res.keywordHits} keyword rows, degraded=${res.degraded}`,
    );
    eq(res.degraded, 'like', 'degraded');
    assert(res.keywordHits > 0, `LIKE fallback returned nothing for ${pair!.term}`);
    assert(
      res.hits.some((h) => h.id === pair!.id),
      'the note the term was cut from is missing from the LIKE results',
    );
  });

  await checkAsync('a 1-character query is refused rather than answered with noise', async () => {
    // Deliberately a fixed character, not one lifted from a row: the floor is a property
    // of the query, so the check must not depend on what the corpus happens to contain.
    const res = await core.globalSearch('周', 20);
    eq(res.hits.length, 0, 'hits');
    eq(res.keywordHits, 0, 'keywordHits');
    eq(res.degraded, 'none', 'degraded');
  });

  await checkAsync('the semantic path is skipped, not awaited, on a cold process', async () => {
    // Nothing in this script ever loads the ONNX session, so the gate must report one of
    // the two not-ready states and no hit may be labelled 'semantic'. If a future change
    // makes globalSearch await the model, this fails instead of turning a search box
    // into a 12-second spinner.
    const p = picks.get('note')!;
    const res = await core.globalSearch(p.term, 20);
    assert(
      ['warming', 'unavailable'].includes(res.semantic),
      `expected the vector path to be cold, got ${res.semantic}`,
    );
    eq(res.hits.filter((h) => h.match === 'semantic').length, 0, 'semantic-only hits');
  });

  await checkAsync('highlights are empty exactly when a row was found only by meaning', async () => {
    // The invariant the row renderer leans on. With the semantic path cold and every
    // hit therefore a keyword hit, "no highlights" must be impossible.
    for (const t of TABLES) {
      const p = picks.get(t.kind);
      if (!p) continue;
      const res = await core.globalSearch(p.term, 20);
      for (const h of res.hits) {
        eq(h.match === 'semantic', h.highlights.length === 0, `${t.kind} row ${h.id} highlight/match`);
        assert(h.highlights.length > 0, `${t.kind} row ${h.id} has no highlights`);
      }
    }
  });

  await checkAsync('a chat hit carries the session it must switch to, and a real title', async () => {
    const p = picks.get('chat')!;
    const res = await core.globalSearch(p.term, 20);
    const hit = res.hits.find((h) => h.id === p.id)!;
    const sessionId = scalar(`SELECT sessionId FROM ChatMessage WHERE id='${p.id}'`);
    eq(hit.sessionId, sessionId, 'sessionId');
    // The index stores an empty title for chat on purpose; the display title is the
    // SESSION's, resolved at read time. An empty one here means that join was lost.
    assert(hit.title.length > 0, 'a chat hit rendered without a session title');
    assert(['user', 'assistant'].includes(hit.messageRole ?? ''), `messageRole=${hit.messageRole}`);
    assert(hit.snippet.length > 0, 'a chat hit rendered with no snippet');
  });

  await checkAsync('a task hit carries the key the rest of the app shows', async () => {
    const p = picks.get('task')!;
    const res = await core.globalSearch(p.term, 20);
    const hit = res.hits.find((h) => h.id === p.id)!;
    const title = scalar(`SELECT title FROM Issue WHERE id='${p.id}'`);
    assert(hit.title.endsWith(title), `"${hit.title}" does not end with the issue title "${title}"`);
    assert(hit.title !== title, 'the issue key prefix is missing');
  });

  await checkAsync('a meeting matched in its transcript seeds the panel search, a title match does not', async () => {
    // segmentQuery exists so the panel can pre-filter its own transcript. Setting it for
    // a term that is not in the transcript filters the transcript to nothing, and
    // omitting it for one that is leaves the user scrolling — so both directions matter.
    let seeded = 0;
    let suppressed = 0;
    for (const m of all('SELECT id, title FROM Meeting ORDER BY rowid DESC')) {
      const body = all(
        `SELECT minutes, summary, transcript FROM Meeting WHERE id='${String(m.id)}'`,
      )[0];
      const fromBody = unique(`${body?.minutes ?? ''} ${body?.summary ?? ''} ${body?.transcript ?? ''}`);
      if (!fromBody || String(m.title ?? '').includes(fromBody)) continue;
      const res = await core.globalSearch(fromBody, 20);
      const hit = res.hits.find((h) => h.id === String(m.id));
      if (!hit) continue;
      eq(hit.segmentQuery, fromBody, 'segmentQuery on a transcript match');
      seeded++;
      break;
    }
    for (const m of all("SELECT id, title FROM Meeting WHERE title IS NOT NULL AND title <> '' ORDER BY rowid DESC")) {
      const term = unique(m.title);
      if (!term) continue;
      const res = await core.globalSearch(term, 20);
      const hit = res.hits.find((h) => h.id === String(m.id));
      if (!hit) continue;
      eq(hit.segmentQuery, undefined, 'segmentQuery on a title match');
      suppressed++;
      break;
    }
    console.log(`       transcript match seeded=${seeded}, title match suppressed=${suppressed}`);
    assert(seeded === 1 && suppressed === 1, 'could not construct both meeting cases from this corpus');
  });

  await checkAsync('the same query twice returns the same rows in the same order', async () => {
    const p = picks.get('note')!;
    const a = (await core.globalSearch(p.term, 20)).hits.map((h) => h.id);
    const b = (await core.globalSearch(p.term, 20)).hits.map((h) => h.id);
    eq(a.join(','), b.join(','), 'two identical searches disagreed');
    assert(a.length > 0, 'the probe returned nothing at all');
  });

  await checkAsync('limit is respected', async () => {
    const p = picks.get('note')!;
    const res = await core.globalSearch(p.term, 5);
    assert(res.hits.length <= 5, `asked for 5, got ${res.hits.length}`);
  });

  sql.close();
}

// ═══ Summary ═══
console.log(`\n${'─'.repeat(64)}`);
if (failures.length === 0) {
  console.log(`ALL ${passed} CHECKS PASSED`);
  process.exit(0);
} else {
  console.log(`${passed} passed, ${failures.length} FAILED:`);
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
