// ═══ Phase verification — "which sources get distilled, and when are they re-asked?" ═══
//
//   npx tsx scripts/test-distill.mts
//
// Exercises `apps/api/src/lib/distillCandidates.ts`. Follows the conventions of
// `scripts/test-proxy.mts` and `scripts/test-fts.mts`: `check` wrapping one assertion,
// helpers that record instead of throwing, a non-zero exit at the end.
//
// ─── Why these assertions and not others ───
//
// The module is pure, so everything downstream of it — the model call, the review dialog,
// the note write — is already visible when it is wrong. What is NOT visible is the part
// where a wrong answer looks like a right one:
//
//   A watermark that never changes makes the button do nothing forever, and the screen
//   says "already reviewed", which reads as success. A month key off by one merges two
//   months' notes into one, and the note looks fine. A per-run cap applied before the
//   reviewed-skip spends every slot on sources the user already answered about, and the
//   only symptom is a button that appears to be broken.
//
// None of those throw and none are in a screenshot, which is why they are here.
//
// ─── What is deliberately NOT asserted ───
//
// Nothing about the *contents* of a proposal, and nothing about the prompt's wording.
// The prompt's clauses are checked for the property that matters — that the three kinds
// differ only in the source clause, so a shared rule cannot drift between them — and not
// for their text, which would make every wording fix a test failure.
import {
  MAX_MATERIAL_CHARS,
  buildDistillPrompt,
  clipMaterial,
  isReAsk,
  meetingRef,
  monthKeyOf,
  parseDistillVerdict,
  reportRefs,
  selectCandidates,
  taskRef,
  unitKey,
  type DistillRef,
  type MeetingInput,
  type ReportInput,
  type ReviewedEntry,
  type TaskInput,
} from '../apps/api/src/lib/distillCandidates.ts';
import { replaceLinkSection, splitLinkSection, parseLinks } from '../apps/api/src/lib/noteLinks.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures.push(`${name} — ${e instanceof Error ? e.message : String(e)}`);
    console.log(`  FAIL ${name}`);
  }
}

function eq(actual: unknown, expected: unknown, what = '') {
  if (actual !== expected) throw new Error(`${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function notEq(actual: unknown, expected: unknown, what = '') {
  if (actual === expected) throw new Error(`${what} expected something other than ${JSON.stringify(expected)}`);
}

// ─── Fixtures ───

function task(over: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 'issue-1',
    issueNumber: 437,
    title: 'Search goes silent when the proxy is off',
    description: 'Every web_search came back with an empty result list instead of an error.',
    type: 'task',
    status: 'done',
    labels: '',
    priority: 'high',
    source: null,
    sourceId: null,
    updatedAt: '2026-09-23 09:14:00',
    commentCount: 2,
    ...over,
  };
}

function report(over: Partial<ReportInput> = {}): ReportInput {
  return {
    id: 'report-1',
    title: '📋 Evening Report',
    reportType: 'evening',
    content: '# Today\n\nShipped the proxy fix.',
    generatedAt: '2026-09-22 22:00:00',
    archived: false,
    ...over,
  };
}

function meeting(over: Partial<MeetingInput> = {}): MeetingInput {
  return {
    id: 'meeting-1',
    title: 'Weekly sync',
    aiStatus: 'done',
    decisions: [
      { id: 'd1', status: 'active', at: '2026-09-21' },
      { id: 'd2', status: 'active', at: '2026-09-21' },
    ],
    ...over,
  };
}

/** One ref, asserting eligibility — a fixture that is silently ineligible makes the
 *  assertion after it about the wrong thing. */
function refOf(r: { ok: true; ref: DistillRef } | { ok: false; why: string }): DistillRef {
  if (!r.ok) throw new Error(`fixture is not eligible: ${r.why}`);
  return r.ref;
}

function reviewedOf(ref: DistillRef): Record<string, ReviewedEntry> {
  return { [unitKey(ref.kind, ref.refId)]: { at: '2026-09-23 11:02:00', watermark: ref.watermark } };
}

// ─── The month key ───
//
// The whole reason this is a string slice and not `new Date()`: a report generated at
// 23:30 UTC on the 30th is October locally at UTC+8, and the note it belongs to is the
// September one — because every other stamp in the schema is read as UTC too.

check('monthKeyOf slices the month out of a UTC stamp', () => {
  eq(monthKeyOf('2026-09-23 10:00:00'), '2026-09');
  eq(monthKeyOf('2026-09-30 23:00:00'), '2026-09', 'the last hours of a month do not roll over:');
  eq(monthKeyOf('2026-01-01 00:00:00'), '2026-01', 'a first-of-month stamp stays put:');
  eq(monthKeyOf('2026-12-31 23:59:59'), '2026-12');
});

check('monthKeyOf returns null rather than guessing a month', () => {
  eq(monthKeyOf(''), null, 'empty:');
  eq(monthKeyOf(null), null, 'null:');
  eq(monthKeyOf(undefined), null, 'undefined:');
  eq(monthKeyOf('not a date'), null, 'prose:');
  eq(monthKeyOf('2026'), null, 'bare year:');
  eq(monthKeyOf('2026-13-01 00:00:00'), null, 'month 13:');
  eq(monthKeyOf('2026-00-01 00:00:00'), null, 'month 0:');
});

check('a report with an unreadable stamp is counted, not bucketed', () => {
  const out = reportRefs([report(), report({ id: 'r2', generatedAt: 'garbage' })]);
  eq(out.filter((r) => r.ok).length, 1, 'months:');
  const bad = out.find((r) => !r.ok);
  eq(bad && !bad.ok ? bad.why : null, 'bad-timestamp');
});

// ─── Identity ───

check('a source id cannot collide across kinds', () => {
  // Both are spellable strings a user could type, which is why the join is not a colon.
  notEq(unitKey('task', '2026-09'), unitKey('report', '2026-09'), 'task vs report:');
  notEq(unitKey('report', 'x'), unitKey('meeting', 'x'), 'report vs meeting:');
  eq(unitKey('task', 'abc'), unitKey('task', 'abc'), 'and it is stable:');
});

// ─── Eligibility ───

check('a finished task with substance is a candidate, titled by its key', () => {
  const ref = refOf(taskRef(task()));
  eq(ref.kind, 'task');
  eq(ref.refId, 'issue-1');
  eq(ref.title, 'TL-437 Search goes silent when the proxy is off');
  eq(ref.own, true, 'written here:');
  eq(ref.items, 3, 'description + 2 comments:');
});

check('a task with neither a real description nor a comment is not', () => {
  eq(taskRef(task({ description: 'x'.repeat(39), commentCount: 0 })).ok, false, 'one char short:');
  eq(taskRef(task({ description: null, commentCount: 0 })).ok, false, 'no description at all:');
  const ok = taskRef(task({ description: 'x'.repeat(40), commentCount: 0 }));
  eq(ok.ok, true, 'exactly at the bar is enough:');
  eq(taskRef(task({ description: null, commentCount: 1 })).ok, true, 'one comment is enough on its own:');
});

check('only finished work is distilled', () => {
  eq(taskRef(task({ status: 'todo' })).ok, false, 'todo:');
  eq(taskRef(task({ status: 'in_progress' })).ok, false, 'in progress:');
  eq(taskRef(task({ status: 'in_review' })).ok, false, 'in review:');
  const cancelled = taskRef(task({ status: 'cancelled' }));
  eq(cancelled.ok ? null : cancelled.why, 'not-done', 'cancelled:');
});

check('mirrored mailbox rows are not tasks', () => {
  const r = taskRef(task({ type: 'email' }));
  eq(r.ok ? null : r.why, 'not-a-task');
});

check('a mirrored tracker row is a candidate, and ranks behind an own row', () => {
  const mirrored = refOf(taskRef(task({ source: 'redmine', sourceId: '1234' })));
  eq(mirrored.own, false, 'mirrored:');
  // Its number is the tracker's own — the one its commits and colleagues use.
  eq(mirrored.title, '#1234 Search goes silent when the proxy is off');
  eq(refOf(taskRef(task())).own, true, 'own:');
});

check('a month of reports is one candidate; a year is twelve', () => {
  const year = Array.from({ length: 12 }, (_, i) =>
    report({ id: `r${i}`, generatedAt: `2026-${String(i + 1).padStart(2, '0')}-15 22:00:00` }),
  );
  const refs = reportRefs(year).map((r) => refOf(r));
  eq(refs.length, 12);
  eq(refs.map((r) => r.refId).sort()[0], '2026-01');
  eq(refs[0].title, refs[0].refId, 'the month is the title, and it is not localized here:');
});

check('a month is re-opened by a new report, and NOT by archiving one', () => {
  const before = refOf(reportRefs([report(), report({ id: 'r2', generatedAt: '2026-09-20 22:00:00' })])[0]);

  const added = refOf(
    reportRefs([
      report(),
      report({ id: 'r2', generatedAt: '2026-09-20 22:00:00' }),
      report({ id: 'r3', generatedAt: '2026-09-23 22:00:00' }),
    ])[0],
  );
  notEq(added.watermark, before.watermark, 'a third report must re-open the month:');

  // The finding this assertion exists for: the hourly archiver flips `archived` at 90
  // days, and the month note is re-derived as model(existing + this month's reports). If
  // archiving re-opened the unit, that re-derivation would read the month without its
  // archived reports and rewrite the note from a smaller set — dropping knowledge the
  // user had already approved, with nothing on screen to say so.
  const archived = refOf(
    reportRefs([report({ archived: true }), report({ id: 'r2', generatedAt: '2026-09-20 22:00:00' })])[0],
  );
  eq(archived.watermark, before.watermark, 'archiving must NOT re-open the month:');

  // Byte-identical for identical input, or the reviewed-skip flaps and the user is
  // charged again for a month they already approved.
  const again = refOf(
    reportRefs([report(), report({ id: 'r2', generatedAt: '2026-09-20 22:00:00' })])[0],
  );
  eq(again.watermark, before.watermark, 'same input, same watermark:');
});

check('the newest report in a month decides when that month sorts', () => {
  const ref = refOf(reportRefs([report(), report({ id: 'r2', generatedAt: '2026-09-28 22:00:00' })])[0]);
  eq(ref.recency.startsWith('2026-09-30'), true, 'sorts at the end of its month:');
});

check('a meeting that decided nothing is not a candidate', () => {
  eq(meetingRef(meeting({ decisions: [] })).ok, false, 'no decisions:');
  const dead = meetingRef(
    meeting({ decisions: [{ id: 'd1', status: 'dismissed', at: '2026-09-21' }] }),
  );
  eq(dead.ok ? null : dead.why, 'no-decisions', 'every decision dismissed:');
  const mixed = meetingRef(
    meeting({
      decisions: [
        { id: 'd1', status: 'dismissed', at: '2026-09-21' },
        { id: 'd2', status: 'active', at: '2026-09-21' },
      ],
    }),
  );
  eq(mixed.ok, true, 'one survivor is enough:');
  eq(mixed.ok ? mixed.ref.items : 0, 1, 'and only the survivor counts:');
});

check('a regenerated meeting is re-opened, and its frozen clock does not matter', () => {
  const before = refOf(meetingRef(meeting()));

  // A regenerate deletes the rows and re-creates them with new uuids (pipeline.ts), which
  // `Meeting.updatedAt` would never reveal — it is frozen at creation, written by the
  // column's *local* default, and no code path ever bumps it.
  const regenerated = refOf(
    meetingRef(meeting({ decisions: [{ id: 'new-a', status: 'active', at: '2026-09-21' }] })),
  );
  notEq(regenerated.watermark, before.watermark, 'new decision ids:');

  const dismissed = refOf(
    meetingRef(
      meeting({
        decisions: [
          { id: 'd1', status: 'active', at: '2026-09-21' },
          { id: 'd2', status: 'dismissed', at: '2026-09-21' },
        ],
      }),
    ),
  );
  notEq(dismissed.watermark, before.watermark, 'a dismissal touches no clock, so the status must carry it:');

  // Row order cannot matter — a watermark that depended on it would flap on every read.
  const reordered = refOf(
    meetingRef(
      meeting({
        decisions: [
          { id: 'd2', status: 'active', at: '2026-09-21' },
          { id: 'd1', status: 'active', at: '2026-09-21' },
        ],
      }),
    ),
  );
  eq(reordered.watermark, before.watermark, 'same decisions, different order:');
});

// ─── Watermarks, per kind ───

check('a new comment re-opens a task even if its stamp did not move', () => {
  const before = refOf(taskRef(task()));
  const more = refOf(taskRef(task({ commentCount: 3 })));
  notEq(more.watermark, before.watermark, 'a comment-only writer would be invisible otherwise:');
  eq(refOf(taskRef(task())).watermark, before.watermark, 'same input, same watermark:');
});

// ─── The reviewed-skip ───

check('an unchanged source is not asked about again; a changed one is; force always is', () => {
  const ref = refOf(taskRef(task()));
  const reviewed = reviewedOf(ref);
  eq(isReAsk(ref, reviewed, false), false, 'just reviewed:');
  eq(isReAsk(ref, {}, false), true, 'never reviewed:');
  eq(isReAsk(refOf(taskRef(task({ commentCount: 9 }))), reviewed, false), true, 'moved since:');
  eq(isReAsk(ref, reviewed, true), true, 'force:');
  eq(isReAsk(ref, {}, true), true, 'force with nothing recorded:');
});

// ─── The cap ───

check('the per-run cap is spent on new sources, not on ones already answered about', () => {
  // The bug this exists for: 200 sources the user has already reviewed, 20 they have not,
  // and a cap of 12. If the cap is applied before the reviewed-skip, all 12 slots go to
  // answered sources and the run proposes nothing — no error, no proposal, just a button
  // that appears to do nothing.
  const old = Array.from({ length: 200 }, (_, i) =>
    refOf(taskRef(task({ id: `old-${i}`, updatedAt: '2026-01-01 00:00:00', commentCount: 1 }))),
  );
  const fresh = Array.from({ length: 20 }, (_, i) =>
    refOf(taskRef(task({ id: `new-${i}`, updatedAt: `2026-09-${String(i + 1).padStart(2, '0')} 10:00:00`, commentCount: 1 }))),
  );
  const reviewed: Record<string, ReviewedEntry> = {};
  for (const r of old) reviewed[unitKey(r.kind, r.refId)] = { at: '2026-02-01 00:00:00', watermark: r.watermark };

  const todo = [...old, ...fresh].filter((r) => isReAsk(r, reviewed, false));
  eq(todo.length, 20, 'candidates offered:');

  const { taken, deferred } = selectCandidates(todo, 12);
  eq(taken.length, 12);
  eq(deferred.length, 8);
  eq(
    taken.every((r) => r.refId.startsWith('new-')),
    true,
    'every slot is a new source:',
  );
});

check('the order is total, so a truncated run is reproducible', () => {
  const refs = [
    refOf(taskRef(task({ id: 'b', updatedAt: '2026-09-23 09:00:00' }))),
    refOf(taskRef(task({ id: 'a', updatedAt: '2026-09-23 09:00:00' }))),
  ];
  eq(selectCandidates(refs, 2).taken.map((r) => r.refId).join(','), 'a,b', 'ties break by id:');
  eq(selectCandidates([...refs].reverse(), 2).taken.map((r) => r.refId).join(','), 'a,b', 'and not by input order:');
});

check('own rows rank ahead of mirrored ones at the same recency', () => {
  const own = refOf(taskRef(task({ id: 'own', updatedAt: '2026-09-23 09:00:00' })));
  const mirrored = refOf(taskRef(task({ id: 'mirrored', updatedAt: '2026-09-23 09:00:00', source: 'redmine' })));
  eq(selectCandidates([mirrored, own], 2).taken.map((r) => r.refId).join(','), 'own,mirrored');
});

check('newer wins inside a group', () => {
  const newer = refOf(taskRef(task({ id: 'newer', updatedAt: '2026-09-23 10:00:00' })));
  const older = refOf(taskRef(task({ id: 'older', updatedAt: '2026-09-01 10:00:00' })));
  eq(selectCandidates([older, newer], 2).taken.map((r) => r.refId).join(','), 'newer,older');
});

// ─── Material clipping ───

check('over-budget material is cut and says so', () => {
  const short = clipMaterial('x'.repeat(10), 100);
  eq(short.truncated, false);
  eq(short.text.length, 10);

  const long = clipMaterial('x'.repeat(MAX_MATERIAL_CHARS + 1));
  eq(long.truncated, true, 'a silent cut reads as "there was nothing in the rest":');
  eq(long.text.length, MAX_MATERIAL_CHARS);
});

// ─── The verdict guard ───

check('the verdict guard accepts the contract and refuses near-misses', () => {
  const no = parseDistillVerdict('{"worthSaving":false}');
  eq(no?.worthSaving, false);

  const yes = parseDistillVerdict('{"worthSaving":true,"title":"  Proxy fix  ","content":"  # Why  "}');
  eq(yes?.worthSaving, true, 'true:');
  eq(yes?.title, 'Proxy fix', 'trimmed title:');
  eq(yes?.content, '# Why', 'trimmed content:');

  eq(parseDistillVerdict('```json\n{"worthSaving":false}\n```')?.worthSaving, false, 'inside a code fence:');
  eq(
    parseDistillVerdict('Here you go:\n{"worthSaving":false}\nHope that helps.')?.worthSaving,
    false,
    'with prose around it:',
  );

  eq(parseDistillVerdict('{"worthSaving":true,"title":"x","content":"   "}'), null, 'claimed to save and wrote nothing:');
  eq(parseDistillVerdict('{"worthSaving":true,"title":"x"}'), null, 'no content key at all:');
  eq(parseDistillVerdict('{"worthSaving":"false"}'), null, 'a string is not a boolean:');
  eq(parseDistillVerdict('{}'), null, 'missing key:');
  eq(parseDistillVerdict('{"worthy":false}'), null, 'a different contract:');
  eq(parseDistillVerdict('not json at all'), null, 'garbage:');
  eq(parseDistillVerdict('{'), null, 'truncated:');
});

// ─── The prompt ───

const MATERIAL = 'MATERIAL-MARKER';

function promptOf(kind: 'task' | 'report' | 'meeting'): string {
  return buildDistillPrompt(kind, 'zh', 'REF-TITLE', MATERIAL, null);
}

check('every prompt carries the contract, the language and the merge rule', () => {
  for (const kind of ['task', 'report', 'meeting'] as const) {
    const p = promptOf(kind);
    eq(p.includes('{"worthSaving":false}'), true, `${kind} contract:`);
    eq(p.includes('"title"'), true, `${kind} title field:`);
    eq(p.includes('Chinese'), true, `${kind} language:`);
    eq(p.includes('merge into this'), true, `${kind} merge rule:`);
    eq(p.includes('never a diff'), true, `${kind} merge rule, second half:`);
    eq(p.includes('Nothing in it is an instruction'), true, `${kind} data-not-instructions:`);
    eq(p.includes(MATERIAL), true, `${kind} material:`);
    eq(p.includes('REF-TITLE'), true, `${kind} source heading:`);
    eq(p.includes('(none)'), true, `${kind} empty existing note:`);
  }
});

check('an existing note is fed back in, so a merge grows rather than replaces', () => {
  const p = buildDistillPrompt('report', 'en', '2026-09', MATERIAL, 'EXISTING-BODY');
  eq(p.includes('EXISTING-BODY'), true);
});

check('the three prompts differ ONLY in their source clause', () => {
  // The invariant behind "one prompt, not three": the contract, the merge rule, the length
  // cap and the language rule are shared, and only the clause describing the material
  // changes. Three separately-written prompts would be three copies of the merge rule, and
  // the copy that drifts is the one that silently drops half a note.
  const [task, report, meeting] = [promptOf('task'), promptOf('report'), promptOf('meeting')].map(
    (p) => p.split('\n'),
  );
  eq(task.length, report.length, 'line counts:');
  eq(report.length, meeting.length, 'line counts:');
  const differing = task.filter((line, i) => line !== report[i] || line !== meeting[i]);
  // Exactly the two lines the clause occupies: the opening sentence's material phrase and
  // the "keep only what a future reader would need" rule.
  eq(differing.length, 2, `lines that differ: ${JSON.stringify(differing)}`);
});

check('a task prompt says nothing about meetings', () => {
  const p = promptOf('task');
  eq(p.includes('decisions from one meeting'), false, 'only the relevant clause is emitted:');
  eq(p.includes('month of daily reports'), false);
});

// ─── The link-section splice ───
//
// `applyDistill` replaces a note's whole body, so the `[[links]]` section the map appended
// has to be split off before the write and re-attached after it. `chatDistill` learned this
// the hard way: without it, a note with links on Monday had none on Tuesday, and nothing
// the user did caused it. There is no test for `lib/noteLinks.ts` itself; this covers the
// harvest's use of it without claiming to cover the module.

check('re-attaching the link section leaves the new body intact and each link once', () => {
  const existing = 'Old body\n\n<!-- tl-links:v1 -->\n## 关联\n- [[Alpha]]\n- [[Beta]]\n';
  const prior = parseLinks(splitLinkSection(existing).section).map((l) => l.title);
  eq(prior.join(','), 'Alpha,Beta', 'titles read out of the section:');

  const next = 'New body, merged.';
  const spliced = replaceLinkSection(next, prior, '## 关联');
  eq(splitLinkSection(spliced).body, next, 'the new body survives byte-for-byte:');

  const titles = parseLinks(splitLinkSection(spliced).section).map((l) => l.title);
  eq(titles.length, 2, 'each link appears exactly once:');
  eq(titles.join(','), 'Alpha,Beta');

  // Idempotent: re-applying the same set must rewrite the same bytes, or a no-op write
  // would bump `updatedAt` and make the map report itself stale for no change.
  eq(replaceLinkSection(spliced, prior, '## 关联'), spliced, 'idempotent:');
});

check('a note with no link section is stored exactly as written', () => {
  const body = 'No links here.';
  eq(splitLinkSection(body).section, null);
  eq(replaceLinkSection(body, [], '## 关联'), body, 'an empty list removes the section, leaving the body:');
});

// ─── Result ───

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
