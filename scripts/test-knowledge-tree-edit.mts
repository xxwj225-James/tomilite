// ═══ Verifying the topic edits the user makes by hand ═══
//
//   npx tsx scripts/test-knowledge-tree-edit.mts
//
// Exercises `editTree()` in `apps/api/src/lib/knowledgeTree.ts`. Follows the conventions of
// `scripts/test-proxy.mts`: `check` wrapping one assertion, helpers that record instead of
// throwing, a non-zero exit at the end.
//
// ─── Why this runs outside the app ───
//
// `editTree` is pure — no database, no model, no clock — so it is the only part of this
// feature that can be pinned without a build and a corpus. The rest of it (the three tRPC
// procedures, the menu, the dialogs) can only be looked at.
//
// ─── What is worth asserting, and why ───
//
// A tree edit that loses a note still renders. Every topic has leaves, every leaf opens a
// real note, and the note is simply absent from the map — the same silent corruption the
// header of `knowledgeTree.ts` is built around, one layer up. So every case below asserts
// the leaf multiset as well as the structure it was asked about: "the edit did what was
// asked" and "nothing else changed" are two different claims and only the second one is
// hard.
//
// The cases that are here because they were wrong while this was being written:
//
//   **Merge must detach, not dissolve.** `dissolve` re-homes a node's notes into its
//   parent; but a merge has already copied them into the destination, so dissolving a
//   merged source would place every one of its notes twice. A `Set` comparison does not
//   catch that — the set is unchanged — which is why the assertion is a multiset.
//
//   **Deleting a second top-level topic must reuse the "Unfiled" row.** The reader labels
//   every `unfiled` node with the same word, so a second one is the same row printed
//   twice, with a note in the wrong copy of it.
import { editTree, treeLeaves, type MapNode, type MapNodeKind } from '../apps/api/src/lib/knowledgeTree.ts';

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

// ── Fixtures ────────────────────────────────────────────────────────────────────
//
// The shape that started this: a top-level topic with a sub-topic, and beside it a bucket
// whose name is a conjunction of its two unrelated notes. Nothing here is real data —
// titles are short on purpose so a failure reads as a diff.

const node = (name: string, notes: string[] = [], children: MapNode[] = [], kind: MapNodeKind = 'topic'): MapNode => ({
  name,
  kind,
  notes,
  children,
});

/** A tree with a `topic`, a nested `topic`, a junk bucket and the root `unfiled` row. */
const tree = (): MapNode[] => [
  node('产品与推广', ['n1', 'n2'], [node('产品定位与架构', ['n3'])]),
  node('知识地图与目录', ['n4', 'n5']),
  node('', ['n9'], [], 'unfiled'),
];

const leaves = (nodes: MapNode[]) => treeLeaves(nodes).slice().sort().join(',');
const kindsOf = (nodes: MapNode[], kind: MapNodeKind) => nodes.filter((n) => n.kind === kind).length;

/** The claim every edit has to satisfy, whatever else it was asked to do. */
function sameLeaves(label: string, before: MapNode[], after: MapNode[]) {
  eq(leaves(after), leaves(before), `${label}: leaves changed —`);
}

// ── Addressing ──────────────────────────────────────────────────────────────────

check('a resolvable path renames the topic it names', () => {
  const r = editTree(tree(), { op: 'rename', path: [0, 0], expect: '产品定位与架构', name: '定位' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  eq(r.topics[0].children[0].name, '定位');
  eq(r.topics[0].name, '产品与推广', 'the parent should be untouched —');
});

check('a path past the end of the tree does not resolve', () => {
  const r = editTree(tree(), { op: 'rename', path: [7], expect: 'x', name: 'y' });
  eq(r.ok, false);
  eq(r.ok === false && r.reason, 'not-found');
});

check('a path through a leaf does not resolve', () => {
  const r = editTree(tree(), { op: 'rename', path: [1, 0], expect: 'x', name: 'y' });
  eq(r.ok === false && r.reason, 'not-found');
});

// The path is positional, so it survives only as long as the tree does. Reusing it after
// the tree moved is exactly how the wrong topic gets renamed.
check('a name that does not match the path is refused', () => {
  const r = editTree(tree(), { op: 'rename', path: [0], expect: '知识地图与目录', name: 'y' });
  eq(r.ok === false && r.reason, 'tree-changed');
});

check('a category node is not the user to rename', () => {
  const cat = [node('Notes', ['n1'], [], 'category'), node('A', ['n2'])];
  const r = editTree(cat, { op: 'rename', path: [0], expect: 'Notes', name: '随便' });
  eq(r.ok === false && r.reason, 'not-a-topic');
});

check('the root unfiled row is not the user to rename', () => {
  const r = editTree(tree(), { op: 'rename', path: [2], expect: '', name: '随便' });
  eq(r.ok === false && r.reason, 'not-a-topic');
});

check('a delete on a path that does not resolve names the reason', () => {
  const r = editTree(tree(), { op: 'delete', path: [3], expect: 'x' });
  eq(r.ok === false && r.reason, 'not-found');
});

check('a merge to a destination that does not resolve names its own reason', () => {
  const r = editTree(tree(), { op: 'merge', path: [0], expect: '产品与推广', intoPath: [9], intoExpect: 'x' });
  eq(r.ok === false && r.reason, 'no-target');
});

// ── The name is sanitised, not merely accepted ──────────────────────────────────
//
// Stored names are rendered in the tree as-is and are fed back to the model verbatim on
// the next generation, so what goes in has to be a label rather than the string that was
// typed.

check('inline markdown is unwrapped out of a new name', () => {
  const r = editTree(tree(), { op: 'rename', path: [1], expect: '知识地图与目录', name: '**知识管理**' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  eq(r.topics[1].name, '知识管理');
});

check('leading numbering is stripped out of a new name', () => {
  const r = editTree(tree(), { op: 'rename', path: [1], expect: '知识地图与目录', name: '1. 知识管理' });
  eq(r.ok === true && r.topics[1].name, '知识管理');
});

check('a link bracket pair is stripped out of a new name', () => {
  const r = editTree(tree(), { op: 'rename', path: [1], expect: '知识地图与目录', name: '[[知识管理]]' });
  eq(r.ok === true && r.topics[1].name, '知识管理');
});

check('a name that sanitises to nothing is refused', () => {
  const r = editTree(tree(), { op: 'rename', path: [1], expect: '知识地图与目录', name: '   ' });
  eq(r.ok === false && r.reason, 'empty-name');
});

check('a rename keeps the notes under the topic', () => {
  const before = tree();
  const r = editTree(before, { op: 'rename', path: [1], expect: '知识地图与目录', name: '知识管理' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  sameLeaves('rename', before, r.topics);
  eq(r.topics[1].notes.join(','), 'n4,n5');
});

// ── Delete: the label goes, the notes do not ────────────────────────────────────

check('deleting a sub-topic hands its notes and its children to the parent', () => {
  const before = [node('A', ['n1'], [node('B', ['n2'], [node('C', ['n3'])])])];
  const r = editTree(before, { op: 'delete', path: [0, 0], expect: 'B' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  sameLeaves('delete nested', before, r.topics);
  eq(r.topics[0].notes.join(','), 'n1,n2', 'the notes should move up —');
  eq(r.topics[0].children.map((c) => c.name).join(','), 'C', 'the children should take its place —');
});

check('deleting a top-level topic moves its sub-topics up and its notes to unfiled', () => {
  const before = tree();
  const r = editTree(before, { op: 'delete', path: [1], expect: '知识地图与目录' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  sameLeaves('delete top-level', before, r.topics);
  eq(r.topics.length, 2, 'one fewer top-level topic —');
  eq(r.topics[0].name, '产品与推广');
  const unfiled = r.topics.find((n) => n.kind === 'unfiled');
  eq(unfiled?.notes.slice().sort().join(','), 'n4,n5,n9', 'the notes should join the existing unfiled row —');
});

check('deleting a top-level topic with no notes does not conjure an unfiled row', () => {
  const before = [node('A', [], [node('C', ['n1'])]), node('B', ['n2'])];
  const r = editTree(before, { op: 'delete', path: [0], expect: 'A' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  sameLeaves('delete empty top-level', before, r.topics);
  eq(kindsOf(r.topics, 'unfiled'), 0, 'nothing needed re-homing, so no row should appear —');
  eq(r.topics.map((n) => n.name).join(','), 'C,B', 'C should take the deleted position —');
});

check('two top-level deletions leave exactly one unfiled row', () => {
  const first = editTree([node('A', ['n1']), node('B', ['n2'])], { op: 'delete', path: [0], expect: 'A' });
  if (!first.ok) throw new Error(`refused: ${first.reason}`);
  const second = editTree(first.topics, { op: 'delete', path: [0], expect: 'B' });
  if (!second.ok) throw new Error(`refused: ${second.reason}`);
  eq(second.topics.length, 1, 'both topics are gone —');
  eq(kindsOf(second.topics, 'unfiled'), 1, 'and there is one unfiled row, not two —');
  eq(second.topics[0].notes.slice().sort().join(','), 'n1,n2');
});

check('a promoted unnamed sub-topic is folded into the existing unfiled row', () => {
  const before = [node('A', ['n1'], [node('', ['n2'], [], 'unfiled')]), node('', ['n9'], [], 'unfiled')];
  const r = editTree(before, { op: 'delete', path: [0], expect: 'A' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  sameLeaves('delete with a nested unnamed child', before, r.topics);
  eq(kindsOf(r.topics, 'unfiled'), 1, 'one unfiled row —');
  eq(r.topics[0].notes.slice().sort().join(','), 'n1,n2,n9');
});

// ── Merge ───────────────────────────────────────────────────────────────────────

check('a merge folds the whole source into the destination', () => {
  const before = tree();
  const r = editTree(before, { op: 'merge', path: [1], expect: '知识地图与目录', intoPath: [0], intoExpect: '产品与推广' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  sameLeaves('merge', before, r.topics);
  eq(r.topics.map((n) => n.name).join(','), '产品与推广,', 'the source should be gone —');
  eq(r.topics[0].notes.join(','), 'n1,n2,n4,n5');
  eq(r.topics[0].children.map((c) => c.name).join(','), '产品定位与架构');
});

// The duplicated-note bug: the source's notes are in the destination, and dissolving it
// afterwards would hand them to the parent as well.
check('a merge does not leave a note under both the destination and a parent', () => {
  const r = editTree(
    [node('A', ['n1']), node('B', ['n2'], [node('C', ['n3'])])],
    { op: 'merge', path: [1], expect: 'B', intoPath: [0], intoExpect: 'A' },
  );
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  eq(leaves(r.topics), 'n1,n2,n3', 'each note once —');
  eq(r.topics.length, 1, 'nothing was left at the root —');
});

check('a merge absorbs a same-named sub-topic instead of repeating it', () => {
  const before = [node('A', [], [node('X', ['n1'])]), node('B', [], [node('X', ['n2'])])];
  const r = editTree(before, { op: 'merge', path: [1], expect: 'B', intoPath: [0], intoExpect: 'A' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  sameLeaves('merge with a twin', before, r.topics);
  eq(r.topics[0].children.length, 1, 'one row named X, not two —');
  eq(r.topics[0].children[0].notes.slice().sort().join(','), 'n1,n2');
});

check('an unnamed child is never treated as a twin', () => {
  const before = [node('A', [], [node('', ['n1'], [], 'unfiled')]), node('B', [], [node('', ['n2'], [], 'unfiled')])];
  const r = editTree(before, { op: 'merge', path: [1], expect: 'B', intoPath: [0], intoExpect: 'A' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  sameLeaves('merge with two unnamed children', before, r.topics);
  eq(r.topics[0].children.length, 2, 'two anonymous rows are not one topic —');
});

check('merging a topic into itself is refused', () => {
  const r = editTree(tree(), { op: 'merge', path: [0], expect: '产品与推广', intoPath: [0], intoExpect: '产品与推广' });
  eq(r.ok === false && r.reason, 'same-node');
});

// The source is about to be carried off, so it cannot be the destination's container.
check('merging a topic into its own sub-topic is refused', () => {
  const r = editTree(tree(), {
    op: 'merge',
    path: [0],
    expect: '产品与推广',
    intoPath: [0, 0],
    intoExpect: '产品定位与架构',
  });
  eq(r.ok === false && r.reason, 'into-descendant');
});

check('merging into a non-topic is refused', () => {
  const r = editTree(tree(), { op: 'merge', path: [0], expect: '产品与推广', intoPath: [2], intoExpect: '' });
  eq(r.ok === false && r.reason, 'not-a-topic');
});

check('merging into a destination whose name does not match is refused', () => {
  const r = editTree(tree(), { op: 'merge', path: [1], expect: '知识地图与目录', intoPath: [0], intoExpect: '别的' });
  eq(r.ok === false && r.reason, 'tree-changed');
});

check('a merge does not depend on the source coming first', () => {
  const before = tree();
  const r = editTree(before, { op: 'merge', path: [0], expect: '产品与推广', intoPath: [1], intoExpect: '知识地图与目录' });
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  sameLeaves('merge backwards', before, r.topics);
  eq(r.topics.map((n) => n.name).join(','), '知识地图与目录,');
  eq(r.topics[0].notes.join(','), 'n4,n5,n1,n2');
});

// ── The two properties that hold for every edit ─────────────────────────────────

check('the input tree is not modified', () => {
  const before = tree();
  const snapshot = JSON.stringify(before);
  editTree(before, { op: 'rename', path: [1], expect: '知识地图与目录', name: '知识管理' });
  editTree(before, { op: 'delete', path: [1], expect: '知识地图与目录' });
  editTree(before, { op: 'merge', path: [1], expect: '知识地图与目录', intoPath: [0], intoExpect: '产品与推广' });
  eq(JSON.stringify(before), snapshot, 'the caller still holds the stored blob —');
});

check('no edit ever removes a note', () => {
  const before = leaves(tree());
  const edits = [
    { op: 'rename' as const, path: [1], expect: '知识地图与目录', name: '知识管理' },
    { op: 'rename' as const, path: [0, 0], expect: '产品定位与架构', name: '定位' },
    { op: 'delete' as const, path: [1], expect: '知识地图与目录' },
    { op: 'delete' as const, path: [0, 0], expect: '产品定位与架构' },
    { op: 'merge' as const, path: [1], expect: '知识地图与目录', intoPath: [0], intoExpect: '产品与推广' },
  ];
  for (const edit of edits) {
    const r = editTree(tree(), edit);
    if (!r.ok) throw new Error(`${edit.op} refused: ${r.reason}`);
    eq(leaves(r.topics), before, `after ${edit.op} at [${edit.path.join(',')}] —`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
