# Knowledge Map — AI-named topic tree + bidirectional link cards

> Status: IMPLEMENTED. Replaces the previous 3-sentence LLM summary (`knowledge.generate`
> + `KnowledgeCache`), which was retired in the same change.

## Context

The old card had no structural relationship to the knowledge base. It fed the _titles_ of
20 tasks, 10 notes and 5 reports to a model and asked for prose (Core Domains / Strengths /
Learning Path), cached it under `KnowledgeCache` by content hash for 2 hours, and wrapped
technical words in `km-badge` spans with a hardcoded 28-word regex. The real library is
`KnowledgePage`, rendered by the notes panel as a flat paginated list with no hierarchy
beyond `category` and no links at all — on the reference corpus, **0 of 39 notes contained
a `[[link]]`** and **all 39 had a null `vector`**. So the "map" reflected the model's
prose, not the library.

The map now shows two complementary structures: a **tree** gives hierarchy and a place to
stand, **link cards** let a note belong to more than one place, and each covers the other's
weakness — the tree imposes a single parent, the cards have no bird's-eye view.

Nothing in the map is prose the user cannot open. Every leaf is a real note.

## 1. The tree

### Storage — ids only, in `SystemConfig`

`SystemConfig['knowledge.map.v1']` holds `{ key, generatedAt, model, topics, unplaced }`.
**Zero schema change**: no new column, no `SCHEMA_VERSION` bump, no migration.

- **The tree stores note ids and nothing else.** Titles, excerpts and counts are joined
  against live `KnowledgePage` rows on every read. Two consequences that are the whole
  reason: deleting a note cannot leave a dangling title in the tree, and a stored tree whose
  notes have since changed degrades to a partial one (`loose`) rather than lying.
- **Nothing reads the old `KnowledgeCache` rows.** They are left in place — the OTA rule is
  add-only and deleting them would benefit no reader.
- **Why not a `kind` column on `KnowledgeCache`**: with the Markdown summary gone there is
  no reader for those rows, so the column would buy nothing; and this repo has twice
  refused an additive column for exactly this class of data, on the grounds that the
  migration path never retries a failure and never takes a backup.

### Invalidation — note-id set, not content hash

`mapKey(notes, lang)` = `sha1(lang + sorted note ids)`, truncated to 32 chars, stored inside
the blob and compared at read time. Selecting a new set of note ids is what forces a
regeneration; **editing a note's body does not**.

A content hash would rename and reshuffle the whole tree on every save. A map that moves
every time you use it is worse than no map, because the user has learned where things are.

### Regeneration sticks to the previous placement

`organize` passes the previous topic names back into the prompt, with the instruction that
new topics may be added but existing ones must not be renamed, and notes whose
title+excerpt are unchanged keep their previous path. The tree grows; it does not churn.

### What the model sees

Notes are sent **numbered** (`[n] title — category — first 80 chars`), and the model
answers with **numbers only**. A hallucinated title is therefore not a failure mode to be
caught — it is one that cannot occur. The prompt states the note list is data, not
instructions. Requests carry `response_format: { type: 'json_object' }`, and
`finish_reason === 'length'` is treated as failure: **a truncated tree is never accepted**.
`maxTokensFor(n)` scales the budget with the corpus and caps at 8000.

### Validity — the checks that make the tree trustworthy

`validateAndNormalize()` in `apps/api/src/lib/knowledgeTree.ts` runs all of these **before**
anything is stored, and a failure falls back to a category-derived tree (`degraded`) rather
than showing the user an error:

| check                          | why it exists                                                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minIndex === 1 && maxIndex === n` | The one silent multi-note corruption. A 0-based answer puts **every leaf's note one position off** while coverage checks pass perfectly. Rejected as `index-range`.                              |
| coverage before pruning         | Every note appears exactly once — re-asserted **after** pruning as well, since promotion must not change the leaf set.                                                                             |
| string-index coercion ratio ≤ 20% | `"12"` and `"note 12"` are accepted, but only as a minority. Above `maxCoercionRatio` we stop believing the output's shape at all.                                                              |
| first occurrence wins on duplicates | Recorded in `stats.duplicates` and shown, not silently dropped.                                                                                                                                |
| structural limits               | Depth ≤ 3, ≤ 12 children per node, an internal node has ≥ 2 children, 2 ≤ root topics ≤ `ceil(n/4)`. "Each note exactly once" alone is satisfied by putting all 39 notes in one bucket.             |
| prune **promotes**, never cascades | Emptying a node re-parents its surviving children to the grandparent, iterated to a fixed point. Losing a topic name is recoverable by regenerating; losing a note is not. If promotion would drop a leaf, the whole tree is rejected and the fallback applies. |

**No note can leave the tree.** Indices the model never mentions are appended to a
synthesized `unfiled` node; notes created after `generatedAt` are surfaced as a `new` node
at render time (never stored — its membership is derived).

### The prompt's language

`LANG_LABEL` names only the languages with a label; anything else is asked for in English.
The choice of language is the caller's `lang`, i.e. the UI language for this feature.

## 2. Links — `[[Title]]`

`apps/api/src/lib/noteLinks.ts` — pure functions, no DB and no React.

- **Syntax** is `[[Title]]`. `[[Title|noteId]]` was rejected: it leaks a UUID into the body,
  which survives export and is unreadable there.
- **Code is skipped.** Fenced blocks and inline code spans are blanked before scanning, so a
  note that documents the syntax does not link itself.
- **Duplicate titles are handled on both sides.** On the reference corpus 7 of 39 notes
  shared a title across 3 groups (`AI Panorama Complexity Badge` ×3, `AI reply` ×2,
  `Untitled Note` ×2), so a title is **not** a unique key:
  - _Read_: a link resolves to `{ raw, to, matches }`. `matches === 0` renders as plain text;
    `=== 1` renders as a chip; `> 1` renders as `Title (2)` and expands a candidate list.
    A backlink silently landing on the wrong one of two same-titled notes is a bug you
    would never diagnose.
  - _Write_: a backfill never proposes an ambiguous title as a target, and reports those
    titles in `unlinkable` so the user can rename them and make them linkable.
- **Backlinks are the inverse of the same graph** — computed by `resolveLinks`, not stored.
  `KnowledgeCard` obtains them from `knowledge.map`, which returns an edge map keyed by note
  id containing only notes with at least one edge.

### The link section

Written as an append-only tail behind a machine sentinel:

```
<!-- tl-links:v1 -->
## Related
- [[Title A]]
- [[Title B]]
```

The sentinel makes "does this note have links?" an exact test instead of a heuristic, which
in turn makes the operation **idempotent and re-runnable**: an existing section is rewritten
from the sentinel to EOF, and **not one byte above the sentinel is touched**. That boundary
is what separates a safe migration from a destructive one.

`applyLinks` **merges** rather than replaces, keeping titles already in the section, because
that section is ordinary text the user may have edited by hand. A backfill that silently
deleted a hand-written link would be worse than no backfill.

### Distillation isolation

7 of 39 notes were `chat_distill` rows, whose `title` and `content` are **overwritten whole**
on each distillation. `lib/chatDistill.ts` therefore strips the sentinel section before
feeding a note to the model and splices the original section back onto the result —
otherwise every link added to a chat summary would vanish on the next distillation pass.

## 3. Semantic neighbours

`knowledge.neighbors` (`{ noteId, limit ≤ 10 }`) returns the top-N notes by cosine
similarity for the selected note, using the stored `vector` column via `decodeVector`.

- **It is a separate procedure from `map`** because vectors are ~3 KB per row; `map` is read
  on every panel activation and must never carry them. Cost is paid only when a note is
  selected.
- **Scores are returned but never rendered.** Measured on a real 35-note corpus
  (`architecture.md` §6.4.1): a query for a topic the corpus does not contain scored
  **0.8606**, outscoring a real topic at **0.8391** and gibberish at 0.8486. There is no
  usable threshold, so the section is labelled "semantically closest" and not "related",
  and showing the number would invite exactly the inference the measurement rules out.
- **Availability is decided by `decodeVector(x) !== null`, never by the score.**
  `cosineSimilarity` returns `0` both for orthogonal vectors and for missing ones.
- **It reports a reason instead of an empty list**: `no-vector` (this note has none),
  `no-peers` (no other note has one), `note-missing`. The card then shows the reason, the
  live `system.embedStatus` state, the last error and a **Rebuild vectors** button calling
  `system.reembed`.

## 4. Backfilling links into existing notes

Two calls, deliberately split:

| procedure              | spends tokens | writes | contract                                                                                                       |
| ---------------------- | ------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `knowledge.suggestLinks` | yes           | **no** | Proposals only. Batched 8 source notes per call against a candidate index of all unambiguous titles; ≤ 4 proposals per note. |
| `knowledge.applyLinks`   | **no**        | yes    | Writes the ticked set verbatim, re-reading each target title as it is *today*.                                    |

`applyLinks` never re-derives. Even at `temperature: 0` determinism is not guaranteed across
providers, so re-running the model on apply would mean the set the user reviewed and the set
written could differ — the one thing a confirmation step must not allow. Targets are
re-resolved at write time: a title edited or duplicated since the proposal is refused and
reported per note (`refused`, `all-refused:…`) rather than written as a broken link.

**Notes open in the editor are excluded.** The editor holds a load-time snapshot of the whole
body, and `handleSave` writes that snapshot back wholesale, so writing a link section under
an open editor loses it on the next save. The client passes those ids as `excludeIds` and the
server reports `skipped: { why: 'open-in-editor' }`.

**Refusals are remembered** in `SystemConfig['knowledge.linksReviewed']` as
`{ noteId: { d, at, noteUpdatedAt } }`. A note is only re-asked once it has itself changed,
otherwise every run re-proposes the same rejected links. `force` overrides it.

**Partial failures are named.** A batch the model failed or truncated is dropped whole (a
half-read batch reads as "nothing related here" for the notes it did not reach) and listed
in `failures`, which the dialog renders instead of leaving an empty list to be
misinterpreted.

**Queue honesty.** Each write triggers the `AFTER UPDATE OF title, content` FTS trigger and
re-queues the row for embedding. The dialog reports the live `pending` count so a growing
backlog is not mistaken for damage this feature did.

## 5. Harvesting — tasks, report months and meetings into notes

The map's own invariant decides this section's whole shape. **A leaf is a note id**, and
every consumer hangs off one: the note card re-reads the row by id, `[[Title]]` resolves a
title to an id, `knowledge.neighbors` takes an id. So there is no way to put a task *in* the
tree — a task row would be a row the rest of the feature cannot walk. The answer is not a
second kind of leaf; it is to make the task **become a note**, at which point it inherits the
trigram FTS index, the embed queue, the link graph and a place in the tree without any of that
being written twice.

This is not a new mechanism. `chatDistill.ts` has folded chat sessions into one rolling note
per session since v2.6 (`docs/architecture.md` §6.14); this section is that same idea applied
to three more sources.

### The three sources, and what identifies each

| Source | `source` | `sourceId` | `category` | One note per |
| --- | --- | --- | --- | --- |
| Finished task | `'task_distill'` | `Issue.id` | `task` | task |
| Report month | `'report_distill'` | `'YYYY-MM'` | `report` | calendar month |
| Meeting | `'meeting_distill'` | `Meeting.id` | `meeting` | meeting |

All three ride the existing `@@index([source, sourceId])` from v23. **No schema change**, so
`SCHEMA_VERSION` does not move and the migration loop — the one that logs a failure and carries
on rather than retrying — is not involved at all.

### Eligibility — `lib/distillCandidates.ts`

A leaf is a note id, so a note is the *product*; what makes a source worth one is
`MIN_DESC_CHARS` (40) of description **or** at least one comment, and `status === 'done'`.
A task with a title and nothing else distils into a note with a title and nothing else, which
is noise in a library rather than knowledge. Mirrored Redmine rows (`source === 'redmine'`) are
**eligible**: the sync pulls `assigned_to_id=me`, so they are the user's own tickets, which is
the same reading `docs/tasks-panel.md` §10 uses for the counters. The filter is material, not
provenance.

A meeting qualifies on **≥1 non-dismissed decision**, and action items are excluded entirely.
The reason is that eligibility and material must read the same set: a meeting that qualified on
an action item but whose material pass read only decisions would spend a call to be told
nothing is there.

### Watermarks, and why each shape is what it is

The watermark is what stops a second press from paying to be told the same thing again. It must
be **the same for the same input** (or the skip flickers) and must change **whenever the source
changes** (or the skip hides real edits). Three sources, three shapes, and none of them
obvious:

- **Task — `` `${issue.updatedAt}|${commentCount}` ``.** `routers/issue.ts` writes `utcStamp()`
  on every update and every `comment.create` is paired with an `issue.update`, so `updatedAt`
  alone is live. The comment count is insurance for a future path that writes only a comment.
- **Report month — `` `${count}|${max(generatedAt)}` ``.** Deliberately **not** the id set and
  **not** `archived`: the hourly archiver flips `archived: true` at 90 days, and a month note
  is re-derived as `model(existing + material)` — so an `archived`-sensitive watermark would
  re-run after ~90 days with less material and **silently rewrite the note shorter**, dropping
  knowledge the user had already approved. Year-long behaviour, invisible in a day of testing.
- **Meeting — `` `${aiStatus}|${sorted(id + status of live decisions)}` ``.** No meeting clock
  is read at all. `Meeting.updatedAt` is frozen at creation (`meeting.create` never sets the
  stamps, so they take the column default `datetime('now','localtime')` — a local-time value
  in a UTC-stamped database), and the regeneration pipeline does not touch them either. What
  actually changes when a meeting is re-processed is the decision rows: old ones deleted, new
  ones inserted under new ids.

### The three procedures — two-stage, with a free pass in front

| Procedure | Model | Writes | Why it exists |
| --- | --- | --- | --- |
| `knowledge.distillCandidates` | no | no | How many sources there are, and why the rest are excluded. **Without it the first thing this feature does is charge for a decision the user was never shown.** |
| `knowledge.suggestDistill` | **yes** | no | One call per candidate → proposed note text, skip reasons, token count |
| `knowledge.applyDistill` | no | yes | Writes the text the user reviewed and possibly edited |

A third pass in front of the usual two is the whole point of the split. The router's own rule
is "reading is free; generating costs money", and a dialog that opened straight into a spending
call would break it on the first press.

`suggestDistill` fails **per unit, not per batch**: each candidate is its own call, so one bad
response costs that candidate and leaves the run intact — finer than `suggestLinks`, where a
batch *is* one call. A response with `finishReason === 'length'` is dropped whole and never
half-stored, because a merge cut off at the token limit would lose the tail of what the note
already said. `worthSaving: false` is a **success**, recorded as a decision, or the same
routine source would be re-charged on every run.

### The merge keys and the write

`SOURCE_OF` / `CATEGORY_OF` in `lib/distillCandidates.ts` are the single source of truth for
the table above. The write is a plain `prisma.knowledgePage` create/update — **no vector code**,
because `lib/ftsIndex.ts`'s six triggers put the row into `global_fts` and queue its embedding
automatically; `drainEmbedQueue` picks it up within a minute.

Three things the write does that are easy to lose and expensive to lose:

- **The `[[link]]` section is isolated before the prompt and re-attached after.** The model sees
  the note's prose only; `splitLinkSection` cuts the section off, and `replaceLinkSection` puts
  the same titles back around the new body. Without this, a link the user typed by hand (or the
  backfill added) disappears on the next harvest — a write they did not make, removing text
  they did write.
- **`note-changed` is refused, not overwritten.** The proposal carries `existingUpdatedAt`; if
  the row moved between the review and the press, the write is skipped and reported. This is
  **stricter than `applyLinks`**, and deliberately so: that one *merges* into a link section, so
  a concurrent edit survives it, while this one replaces the whole body. Refusing is the
  difference between a confirmation step and a data-loss window. (A row deleted in the meantime
  is *re-created* rather than refused: the user approved that content and it still belongs in
  the library.)
- **Byte-identical content is not written.** `updatedAt` bumping would mark the map stale and
  re-queue the note for embedding, for no change.

The watermark recorded is the one that travelled back from `suggest`, never a fresh derivation.
Re-deriving would let the set reviewed and the set recorded differ, which is the one thing a
confirmation step must not allow. **Unticked rows are recorded too** — an unticked box is still
a decision, and re-asking is how you train someone to stop reading the list; re-asking is
available but has to be asked for, which is what `force` is. This is a deliberate deviation from
`applyLinks`, which records only what it wrote.

### The brake

Quota exhaustion writes `distill.pausedUntil`, the **same key the background chat distillation
uses**, read as a pre-check before anything is spent. The brake is a fact about the account, not
about a feature: two keys would allow the state where one screen says spending is paused and
this button burns a quota that is already gone.

`distill.enabled === '0'` is deliberately **not** read. It is the switch for the *background*
job ("do not spend my money while I am not looking"), and pressing a button is the exact
opposite of that. Recorded here because the asymmetry looks like an oversight.

### Two judgements, recorded as judgements

- **A month is a product decision, not a property of the data.** `Report` has no month column;
  the month key is a string slice of `generatedAt`, which is a UTC `'YYYY-MM-DD HH:MM:SS'`.
  That means a report generated at 23:00 local on the last day of a month can land in the
  *next* UTC month. Months are UTC months here, deliberately and consistently — the alternative
  (`new Date()` locally) is the dual-clock bug `lib/dbTime.ts` exists to prevent. The
  granularity itself — one note per month rather than one per report — is chosen so a year of
  daily reports is twelve notes rather than 365 log entries. The current month is a candidate
  from its first report: pressing mid-month merges into the same note rather than opening a
  second one, because the note is `model(existing + material)`, not an append log.
- **Mirrored Redmine rows sort after the user's own tasks.** They are eligible (§5 above), but
  the per-run cap is 12 and a first sync can bring in hundreds of mirrored tickets; ordered by
  `updatedAt` alone they would take every slot and the user's own finished work would never be
  reached. `selectCandidates` therefore sorts own-first as the *primary* key, not as a
  tie-break — a tie-break only matters between equally-recent rows, which is exactly the case
  where the flood wins. Deterministic, so a truncated run is reproducible and the "N more are
  over this run's limit" line tells the user where the next press resumes.

### Rejected: asking the model for `[[links]]`

The map is entirely about links, so this is the first thing a reader will expect the prompt to
ask for. It does not. The model has no idea which titles exist in this library, so the links it
writes resolve to nothing — or, worse, to the wrong one of two same-titled notes, which is
exactly the collision `lib/noteLinks.ts` documents. There is already a purpose-built channel for
this, with a candidate index and its own review dialog (`suggestLinks`, §4), and it is the one
that knows what is in the library.

## 6. Surface

`apps/web/src/panels/home/KnowledgeCard.tsx`, in place of the old card — no new panel.

- **Connected to `active`.** The panel is kept mounted, so without this the card shows a map
  from hours ago.
- **Generation is a button, never automatic.** `organize` is a mutation that writes on a
  cache miss; the old code called the equivalent from a `[lang]` effect and a 2-hour timer,
  which meant **opening the home panel silently spent money**. Reading (`map`) is a pure
  query.
- **The tree navigates, and the three exceptions are all local.** Hovering a topic row reveals
  a 「⋯」 menu — rename / merge / delete — which is the only writing this card does that is not
  `organize`. None of them calls a model, spends a token or touches a note, which is why only
  delete asks for confirmation and the other two do not; the whole design is in §6 「Fixing a
  topic」. The right side is the selected note's card: title,
  category chip, excerpt, then outgoing links / backlinks / semantic neighbours, and an
  **Open note** button that crosses panels via the three-line bridge (set
  `__tl_pendingNoteSelect`, dispatch `tl-navigate`, dispatch `tl-select-note` — dispatching
  only the last one works when the notes panel is already mounted and loses the event on a
  first open).
- **Zero `dangerouslySetInnerHTML`.** The card renders structured data; the only Markdown in
  this feature is the link section, which is plain text in a note body.
- Empty, loading and failed are three distinct states.
- **Two buttons in the header, and each label names its own situation.** `Organize notes` /
  `Organize new notes` / `Re-organize` for the tree, and `Harvest knowledge` (`distill.open`)
  for §5 — bound to a dialog rather than to a strip of content under the tree, because the
  card's subject is the tree and a permanent block beneath it is what the removed project
  pulse got wrong. A separate refresh icon used to sit beside them and was removed: `map` is a
  pure read and the card already re-reads on every `active`, so the icon's only observable
  effect was to re-read the same tree — and the things that change a tree are buttons that
  name what they do (`organize`, and the 「⋯」 menu of §6 「Fixing a topic」).
- **The two reasons a stored tree no longer matches the request are rendered**, in the same
  `.kmap-banner` slot as the degraded notice: `stale` with loose notes → "N new notes are not
  in the map yet"; `map.lang !== lang` → "This map was generated in {language}". Both were
  computed by the server from the day the map was written and neither had ever been shown,
  which is why switching UI language and pressing the old refresh icon looked like a no-op —
  topic names are baked in at generation time, so nothing on screen changed and nothing said
  why.
- **A failed re-read is visible.** `load` keeps the previous `map` on failure (the only
  error UI needs `!map`), so this needed its own banner and inline retry rather than being
  silent — it is the one thing the removed refresh icon could be argued to have been for, and
  it is now the failure path's own retry instead of a second always-available button.
- **Folder state is per position path, and cleared when the tree is rebuilt.** Paths are
  `n0/1/2`, so after re-organizing the same path is a different topic; folds are dropped
  unless the run failed and `kept` the old tree, where the paths still name what they named.
- **Any node with a row under it folds, leaves included.** The rule used to be "has
  sub-topics", which left a topic holding a dozen notes and no children permanently open —
  the node with the most to hide.
- **The tree scrolls itself to the selected note.** Following a link chip moves the card to
  another note; the tree was left behind. It scrolls its own box by rect delta rather than
  `scrollIntoView`, which would also scroll the home panel.
- **The empty state carries the harvest button.** A map needs notes to draw, so the screen
  a user with an empty library lands on has to say where notes come from and be the shortest
  path to getting some. This used to be a strip of task counts under the tree — which meant
  an empty library still showed *something*, but the something described a project rather
  than any knowledge in it. Removing that strip without this button would have left an empty
  card with a button that cannot do anything yet.

### Fixing a topic — rename / merge / delete

Hovering a topic row reveals a 「⋯」 trigger; behind it are the three ways to correct the
tree by hand. All three are **local**: no model, no tokens, and no note is written or
removed. They are the first path in this feature that writes `knowledge.map.v1` without
calling a model — before them the only writers were `organize` and the category fallback.

**Why they exist.** `buildPrompt` hands the existing topic names back to the model with
`must be reused verbatim` and `Do not rename, reword or re-case an existing one`. That rule
is deliberate — without it the whole map reshuffles on every run — but it also means a bad
name is permanent. The one that started this: a bucket called 「知识地图与目录」 holding two
notes whose only shared feature was the word 「目录」 in both titles. It is not a bug; it is
what the model does when it has nothing to say about a pair of leaves, and there was no way
to correct it.

**Addressing is positional.** Nodes carry no id — `sanitizeTree` rebuilds every node as
`{name, kind, notes, children}` on each read, so any extra field would be discarded — and a
topic is therefore named by its path into `map.topics`, e.g. `[2, 0]`. Two consequences:

- The client keeps **two paths** and they are not interchangeable. `n0/1/2` indexes the
  rendered rows (and `collapsed`); the index path indexes the stored tree. The synthesized
  「新笔记」 row that `treeNodes` unshifts has no index path at all, because the server has
  never seen it. Mixing them up renames the topic above the one that was clicked.
- Every edit carries an `expect` name. A path is only meaningful while the tree holds still,
  and two open windows (or a generation in flight) can move a node out from under a clicked
  path — the same hazard as `note-changed` in §5, and the same answer: refuse rather than
  edit the wrong node.

**Only `kind: 'topic'` is editable.** A `category` node's name is a value of
`KnowledgePage.category` (and is translated again by `noteCategory.labelFor` on the way out),
so renaming one would be a lie that the next fallback write erases anyway; an `unfiled` row
has no name to edit. The guard is per node rather than per blob because a `degraded` map can
hold both kinds in one tree.

**Delete promotes, it does not remove.** The notes under a deleted topic move to its parent
along with the parent's own notes, and its sub-topics take its place in the list. A
*top-level* topic has no parent to hand them to, so its notes go to a root `unfiled` row —
reused if one exists, created only if there is something to re-home, so deleting two
top-level topics does not produce two 「未归类」 rows. `editTree` then compares the leaf
multiset before and after and returns `lost-notes` (writing nothing) if any note would have
disappeared: "no note may ever leave the tree" (§1) is the feature's first invariant, and a
tree edit is exactly the kind of surgery that could break it quietly.

**An edit is not a generation, so it touches one field.** Only `topics` is replaced; `v`,
`lang`, `key`, `generatedAt`, `degraded`, `detail`, `model` and `stats` are carried over
verbatim. Two of those are judgements rather than mechanics:

- `generatedAt` stays the moment the model produced this structure — that is what the card
  prints, and a renamed topic re-derived nothing.
- `key` still describes the note-id set, which an edit does not change (it moves notes
  around a tree). So an edit must **not** make the map report itself stale.

By the same argument the card clears `collapsed` after a delete or a merge — the removal
re-indexes everything below it — and deliberately does **not** clear it after a rename, which
moves nothing.

**A renamed topic may be renamed back by the next generation.** `priorTopicNames` feeds the
new name to the model as an existing name with the instruction to reuse it, which is what
gives a rename any persistence at all — but that is a request, not a guarantee. This is a
known limit (§7), not a defect in the edit.

**Rejected alternatives.** Giving nodes ids would mean touching `sanitizeTree`, `readBlob`'s
validation and the hand-mirrored client types in `apps/web/src/lib/api.ts` — where `tsc`
cannot see drift, because nothing in `apps/web/src` imports `AppRouter` — to replace a
positional scheme that already exists and is already load-bearing. A right-click menu has no
precedent anywhere in this app; the hover trigger matches the panel's other affordances.

### Imported notes — `source` gets a second writer

Until now `KnowledgePage.source` had exactly one non-null writer: `chatDistill.ts`, with
`source='chat_distill'`. Note import (the notes panel's import dialog) adds three more, and
the harvest (§5) adds three, and the same `@@index([source, sourceId])` from v23 carries them
all. Formats are listed by extension: what a user has in hand is a file, and an application
name in the `source` value would go stale the moment that application's export menu changed:

| Source | `source` | `sourceId` | `category` |
| --- | --- | --- | --- |
| Markdown / plain text | `'import:markdown'` | `file.webkitRelativePath \|\| file.name` | the notebook named in the dialog, else `imported` |
| Saved web page (`.html`) | `'import:html'` | the file's path (same value as Markdown) | the file name's `.notes` infix stripped, else the folder — see below |
| Web archive (`.mht`) | `'import:mht'` | `${notebook}\u0000${title}` | the file name's `.notes` infix stripped |
| Chat distillation | `'chat_distill'` | `ChatSession.id` | `chat` |
| Finished task (§5) | `'task_distill'` | `Issue.id` | `task` |
| Report month (§5) | `'report_distill'` | `'YYYY-MM'` | `report` |
| Meeting (§5) | `'meeting_distill'` | `Meeting.id` | `meeting` |

`'import:enex'` was a fourth until that importer was retired (architecture.md §6.16). The
value is still in the column on the rows it wrote, and nothing reads the list of sources as a
filter — so those notes are unaffected: they open, search and edit, and they earn the
"imported" badge below like any other `import:*` row. No new row can be written with it.

The `source` column is also what the notes list badges, and it took two attempts to get
right: the badge used to appear for **any** non-empty `source`, which claimed a chat summary
was imported. Only `import:*` earns it now — a distilled note is written here, from the
user's own work, and saying "imported" about it claims the opposite. `sourceBadgeKey` in
`apps/web/src/lib/noteCategory.ts` holds the rule, and it matches on the `import:` **prefix**
rather than on the values, which is why a retired source needs no change there.


**Two Markdown files with the same name are one note.** A multi-file pick carries no
directory, so the name *is* the identity — `Work/a.md` and `Personal/a.md` selected
together collapse. This is not fixed by changing the key (see the positional-id argument
below, which applies here with equal force), so `importMarkdownFiles` de-duplicates the
batch on `markdownKey` **before** writing, keeps the first, and reports the rest as a
counted warning. Left to the API's existence check the second file would come back as
`skipped` and the user would never learn a file they deliberately picked was not imported.

**Why the ids are derived, and why not positional.** None of the three formats carries a
note id — Markdown has the file, the two web formats have a file name — so identity is
derived from what is stable across exports, in exactly one place
(`apps/web/src/lib/import/sourceId.ts`). A **positional** id (`note 1`, `note 2`, …) would be
far simpler and is the wrong answer: delete one note, re-export, and every id after it shifts
by one, so the next import re-creates the entire library as duplicates.

**Why the two web formats reuse the shapes above rather than inventing a third.** The HTML
export takes the **path** as its key (`htmlSourceId`, which *is* `markdownSourceId`: the
wrapper exists so that splitting a single-page export later changes one place, and so the
sameness reads as a decision rather than a coincidence). The title is deliberately **not** in
it — a title is the field a user edits, and a key containing it turns "I fixed a typo in the
heading" into "this note is now a second note". `.mht` goes the other way and *does* include
the title, because a file pick hands over bare names with no directory and two notebooks can
each hold `Meeting.notes.mht`; the notebook alone would not tell them apart. What it excludes
is the container's own `Date:` header and the file's mtime — both record when the export ran,
so either one would change the key every time the file was copied, and a key that changes on
copy duplicates the library on the next import.

> ⚠️ **Neither web-format parser has been validated on more than one export.** The single
> sample behind both (2026-09-22) holds **one note**, which leaves two load-bearing
> questions open: whether the single-page shape really is one file per notebook (three
> independent signs say yes — the `.notes` infix in the name, a single divider anchor, a
> generic `<title>Evernote Export`), and where a per-note title would live if the export has
> one at all (the sample has none: no `<h1>`, no metadata comment, and a `<title>` that is
> the format's rather than the note's). So the HTML importer imports **one file as one
> note** and only *reports* how many note dividers it counted — a divider test that is wrong
> does not degrade the import, it shreds every note into fragments each carrying an invented
> title and id, and that is not something a user can undo. The `.mht` side is covered
> against the RFCs by `scripts/test-import-mime.mts` (148 assertions, including the folded
> and quoted `Content-Type` header a real exporter emits, and a decoded image compared
> byte-for-byte with the PNG on disk) — but "the RFCs" is not "every exporter's habits".
> Per-module assumption lists live at the top of `html.ts`, `htmlNote.ts`, `mht.ts`.

**One button for all three formats, and the cost it carries.** The import dialog used to hold
a section per format, each with its own hidden input; it now holds one
`<input type="file" multiple>` whose `accept` is built from the same table the bucketing uses
(`lib/import/buckets.ts`), because `wiki.importNotes` accepts **one `source` per batch** and
rejects an unknown one for the whole batch — so a mixed pick is split by extension and written
one format at a time, with the tallies, warnings and cancellation merged back into one
summary. The same table is what `markdown.ts` and `html.ts` ask for their own extension
tests, so a file the picker offers, a file the bucketer claims and a file an importer accepts
cannot come apart (the failure there is silent: the file simply never arrives).
`scripts/test-import-pick.mts` asserts that agreement. Picking and importing are separate
steps: the pick only stages the files, and the run starts on 「确认导入」 below the list. That
ordering exists because the selection is the last point at which a wrong pick can be caught,
and the version that ran on the pick's own `change` event gave it a screen with nothing on
it. The cost, accepted deliberately: a
file pick cannot see a folder, so a saved web page's `_files` images are unreachable and
become placeholder lines — reported, not hidden. `.mht` is unaffected, which makes it the
format to prefer when a note's images matter.

**Why there is no `@@unique([source, sourceId])`.** This will be proposed every time
someone reads the merge key, so the reasons are recorded here rather than re-argued:

1. **It protects nothing.** Both columns are nullable, and SQLite treats every `NULL` pair
   as distinct — so the constraint cannot fire on precisely the rows that do not need
   protecting, and the rows that do (`source` non-null) are already deduped by lookup.
2. **It breaks §4's rolling note.** `chatDistill.ts` does `findFirst` then rewrite; a
   unique index turns a benign re-run into a `P2002` on a background job that only logs.
3. **The wanted behaviour is "skip", not "raise".** A conflict error is not a skip.
4. **The migration loop would not survive it.** `server.ts`'s migration catch swallows only
   `duplicate column` / `already exists`, so a failed `CREATE UNIQUE INDEX` logs and
   continues — leaving `schema.prisma` and the live database contradicting each other.

The two holes it would have covered are closed in code instead: **in-batch dedup on
`sourceId`** (last wins) and a **module-level serialiser**, because two concurrent import
batches each miss the other's existence check and double-insert.

*If a unique index is ever genuinely wanted, the correct order is a dedup data repair first,
shipped as its own migration — not a constraint added on top of rows that already violate it.*

**A pre-import count is shown.** `wiki.count` exists so the import dialog can warn before a
batch of 400 notes is committed — with the FTS copy (§6.4) and the embed queue behind it,
the cost is real and the user should see it coming.

## 7. Known limits

- **`[[Title]]` renders as a clickable chip only inside the map card.** In the notes editor
  and in exports it is literal text. Editor-side `[[` autocomplete is a separate piece of
  work: the editor uses a hand-written Milkdown serializer whose round-trip of `[[X]]` has to
  be verified first.
- **Renaming a note breaks inbound links.** `chat_distill` notes take their title from the
  model on each distillation, so an inbound `[[old title]]` elsewhere stops resolving and
  renders as plain text (struck through in the card). The plan deliberately did not extend
  scope to rewriting inbound links on rename.
- **A topic name is a suggestion, not a taxonomy.** Regenerating may re-group notes; names
  are sticky but not frozen. A hand-renamed topic (§6 「Fixing a topic」) keeps its new name
  only as far as the model honours `must be reused verbatim` — the name is handed back as an
  existing one, which is what gives the rename any persistence at all, but the instruction is
  a request rather than a guarantee. If a rename survives the next `organize`, that is the
  prompt working; if it does not, the fix is to rename it again, not to file a bug.
- **No similarity threshold exists**, per §3 — the semantic section is ordered, not filtered.
- **The harvest is bounded per run, and takes several presses on a full library.** 12 sources
  per run, 12 000 characters of material per source. Both ceilings are in
  `lib/distillCandidates.ts` and both are reported rather than silently applied: the dialog
  says how many are over the limit and the note text says when a source was clipped. A first
  run over years of history is not one press, by design — 12 model calls is a cost a user can
  see and approve, 300 is not.
- **A harvested note's `[[links]]` are preserved but never proposed.** §5 has the argument; the
  short version is that the model does not know which titles exist in this library. Run
  `suggestLinks` (§4) after harvesting if the new notes should be linked.
- **Imported notes are ordinary notes to the map.** They are candidates for `organize` like
  any other, and their `category` is a folder or notebook name rather than one of the app's
  own categories — the tree groups by content, not by `category`, so the two coexist. Note
  that re-importing with a *different* folder layout changes `sourceId` for the moved files
  and produces copies; import is idempotent per source path, not per note content.
- **The editor's category `<select>` was fixed alongside import, and had to be.** It
  rendered only its four hardcoded `<option>`s, so any other `category` — `chat` from
  §6.14, or an imported folder name — showed as a **blank** selection while the real value
  sat in state. The note looked uncategorised and the next pick of any option silently
  moved it out of its notebook. An unknown value now renders as its own `<option>`
  (`NotesEditor.tsx`), so what is displayed is what is stored. This was a pre-existing
  defect that `chat_distill` already triggered; importing hundreds of notes with
  folder-name categories would have made it the normal case.
- **The card has a fixed height (380px) and the tree a fixed width (220px)**, both as custom
  properties on `.kmap-body`. Fixed rather than content-sized because the selection changes:
  a card that grew and shrank with each click would move the tree under the pointer. A long
  topic name is ellipsised, and both topic rows and leaves carry `title`, so the full name is
  one hover away; a tree taller than 380px scrolls.

## Files

| file                                        | role                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/api/src/lib/noteLinks.ts`              | `[[Title]]` parse / resolve / backlink inverse / sentinel section r/w     |
| `apps/api/src/lib/knowledgeTree.ts`          | tree schema, limits, `validateAndNormalize`, prompt, category fallback, `editTree` (pure) |
| `apps/api/src/routers/knowledge.ts`          | `map` `organize` `neighbors` `suggestLinks` `applyLinks` `distillCandidates` `suggestDistill` `applyDistill` `renameTopic` `deleteTopic` `mergeTopics` + `SystemConfig` |
| `apps/api/src/lib/chatDistill.ts`            | sentinel-section isolation                                               |
| `apps/api/src/lib/distillCandidates.ts`      | harvest rules, pure: eligibility, watermarks, caps, prompt, verdict parser |
| `apps/api/src/lib/knowledgeDistill.ts`       | harvest I/O: DB reads, the model calls, the note write                   |
| `apps/web/src/panels/home/KnowledgeCard.tsx` | tree + card + semantic section + the 「⋯」 topic menu                    |
| `apps/web/src/panels/home/DistillDialog.tsx` | free list → paid proposals → free write                                  |
| `apps/web/src/panels/home/TopicMergeDialog.tsx` | merge destination picker — every other topic, flat, source sub-tree excluded |
| `scripts/test-knowledge-tree-edit.mts`       | `editTree` assertions, `npx tsx` — the only part of this feature testable without a build |
| `apps/web/src/panels/notes/LinksReviewDialog.tsx` | dry-run / tick / write                                              |
| `apps/web/src/lib/noteCategory.ts`           | `categoryLabel` / `sourceBadgeKey` — one table for two screens           |
| `apps/web/src/lib/import/`                   | parsers, no runtime deps — `types` `refs` `buckets` `markdown` `html` `htmlNote` `mht` `text` `dom` `sourceId` `htmlToMarkdown` `runImport`; `buckets` and `text` import nothing, so `scripts/test-import-pick.mts` and `scripts/test-import-mime.mts` run them under plain Node. Neither web-format parser is validated on more than one export, see §6 |
| `apps/api/src/routers/wiki.ts`               | `importNotes` (dedup + serialiser), `count`, `byId`, projected `list` |

## Procedures

| procedure                  | type     | model | writes                       |
| -------------------------- | -------- | ----- | ---------------------------- |
| `knowledge.map`            | query    | no    | no                           |
| `knowledge.organize`       | mutation | yes   | `knowledge.map.v1`           |
| `knowledge.neighbors`      | query    | no    | no                           |
| `knowledge.suggestLinks`   | mutation | yes   | no                           |
| `knowledge.applyLinks`     | mutation | no    | note bodies + `linksReviewed` |
| `knowledge.distillCandidates` | query | no    | no                           |
| `knowledge.suggestDistill` | mutation | yes   | no                           |
| `knowledge.applyDistill`   | mutation | no    | `KnowledgePage` + `distillReviewed` |
| `knowledge.renameTopic`    | mutation | no    | `knowledge.map.v1` (`topics` only) |
| `knowledge.deleteTopic`    | mutation | no    | `knowledge.map.v1` (`topics` only) |
| `knowledge.mergeTopics`    | mutation | no    | `knowledge.map.v1` (`topics` only) |
| `wiki.importNotes`         | mutation | no    | `KnowledgePage` (skip by default, `overwrite` to replace) |

`search.knowledgeMap` was an older, uncalled fetch to the chat-completions endpoint that
generated the same 3-sentence summary. The map stopped reading it, and it has since been
removed outright — `search.*` now holds only `search.search`, which serves the global
search palette and returns ranked hits across six kinds (see `lib/searchCore.ts`).
