// ═══ Global search — the retrieval pipeline ═══
//
// Three stages, feeding one fused list:
//
//   1. keyword   — FTS5 over global_fts, plus an ADDITIVE LIKE pass for terms the
//                  trigram tokenizer structurally cannot serve (<3 characters, which
//                  in Chinese is every two-character word)
//   2. semantic  — cosine over the stored vectors of notes and reports ONLY
//   3. fusion    — RRF, in lib/searchFusion.ts, which is pure and unit-tested
//
// ─── Coverage is six kinds, but the index holds seven ═══
//
// global_fts also carries `git` commits, which the agent's search_local_data tool
// reads. They are filtered out HERE rather than dropped from the index: this list is
// what the palette shows, and commits are not one of its kinds.
//
// ─── The semantic path is a recall EXPANDER, and that is a deliberate trade ═══
//
// Only KnowledgePage and Report have a `vector` column. Tasks, chats, meetings and
// emails have none, so for those, keywords are the only way in — the semantic list
// has nothing to say about them.
//
// For notes and reports this repository has measured that NO usable similarity
// threshold exists (agent/core/knowledgeRecall.ts, docs/architecture.md §6.4.1): the
// cosine list fills to its cap even for a query with no relevant note anywhere. So a
// nonsense query returns real notes. That is the accepted cost of the property that
// makes cross-lingual and two-character CJK queries work at all, and it is why every
// hit carries a `match` field the UI is required to render — a row found only by
// meaning must be labelled as such, or the user cannot tell why it is there.
//
// ─── Never await the embedding model here ═══
//
// Loading the ONNX session takes 11-13 s. isEmbedLoaded() is synchronous and never
// blocks, so the gate below is a plain check: on a cold process the semantic lists
// are empty and the response says 'warming'. Making the vector path wait would turn
// a search box into a 12-second spinner.

import { prisma } from '@tomilite/database';
import { ftsTerms, toFtsMatch, unsearchableTerms } from './fts.js';
import { issueKey } from './taskScope.js';
import {
  cosineSimilarity,
  decodeVector,
  embedQuery,
  isEmbedDisabled,
  isEmbedLoaded,
  isModelInstalled,
} from './embed/index.js';
import { DEFAULT_PROJECT_ID } from '../agent/utils/constants.js';
import {
  type FusedEntry,
  type SearchHit,
  type SearchKind,
  type SearchResponse,
  applyKindCap,
  fuseRrf,
  windowSnippet,
} from './searchFusion.js';

/** The kinds the palette shows, as the `type` values stored in global_fts. */
const PALETTE_TYPES = ['issue', 'note', 'email', 'report', 'chat', 'meeting'] as const;

/** global_fts.type → the kind the UI names. Only `issue` differs; `task` is the UI's word. */
const KIND_OF_TYPE: Record<string, SearchKind> = {
  issue: 'task',
  note: 'note',
  email: 'email',
  report: 'report',
  chat: 'chat',
  meeting: 'meeting',
};

/** Per table: how many rows the LIKE pass may contribute, so it can never become a scan. */
const LIKE_PER_TABLE = 4;
const LIKE_TOTAL_CAP = 20;
const PER_LIST_KEYWORD = 60;
const CANDIDATES_INTERACTIVE = 300;
const PER_LIST_SEMANTIC = 60;

/**
 * A query needs at least this many characters to be worth running.
 *
 * NOT a similarity threshold — this design has none, by decision. It is a floor on
 * "is this a query at all", and 2 is chosen to equal the shortest Chinese word so
 * "迁移" still works. Without it a stray keystroke pulls 60 arbitrary notes in.
 */
const MIN_QUERY_CHARS = 2;

/** What one keyword row already knows about itself. */
interface KeywordRow {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string;
}

/** A semantic list plus the kind of every id in it. */
interface CosineList {
  kind: SearchKind;
  ids: string[];
}

/** Why the semantic list is empty, in the terms the UI needs to explain itself. */
function semanticAvailability(): SearchResponse['semantic'] {
  if (isEmbedDisabled() || !isModelInstalled()) return 'unavailable';
  return isEmbedLoaded() ? 'ready' : 'warming';
}

const meetingBody = (m: { minutes?: string | null; summary?: string | null; transcript?: string | null }) =>
  [m.minutes, m.summary, m.transcript].filter(Boolean).join(' ');

// ─── Stage 1: keywords ───

/**
 * The keyword list. Rows arrive carrying their snippet, plus a flag for whether the
 * LIKE pass had to contribute — which is all `degraded` records.
 */
async function keywordList(
  query: string,
  limit: number,
): Promise<{ rows: KeywordRow[]; degraded: SearchResponse['degraded'] }> {
  const terms = ftsTerms(query);
  const rows: KeywordRow[] = [];
  const seen = new Set<string>();
  const add = (r: KeywordRow): boolean => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    rows.push(r);
    return true;
  };

  // ── FTS5 ──
  //
  // `type IN (...)` is a post-filter on an UNINDEXED column, not a MATCH term — the
  // same shape agent/utils/search.ts already uses. snippet() with a negative column
  // index picks whichever column matched best, which is what makes a chat hit produce
  // a real snippet: its text lives in `body` while its `title` is empty, so the old
  // `body.substring(0,150)`-style handling would have shown nothing useful.
  const match = toFtsMatch(query);
  if (match) {
    try {
      const placeholders = PALETTE_TYPES.map(() => '?').join(',');
      const raw = await prisma.$queryRawUnsafe<
        Array<{ type: string; ref_id: string; title: string; body: string; snip: string | null }>
      >(
        `SELECT type, ref_id, title, body, snippet(global_fts, -1, '', '', '…', 12) AS snip
           FROM global_fts
          WHERE global_fts MATCH ? AND type IN (${placeholders})
          ORDER BY rank LIMIT ?`,
        match,
        ...PALETTE_TYPES,
        PER_LIST_KEYWORD,
      );
      for (const r of raw) {
        const kind = KIND_OF_TYPE[r.type];
        if (!kind) continue;
        add({
          kind,
          id: r.ref_id,
          title: r.title ?? '',
          // snippet() can come back empty when the match was in a column it did not
          // choose, so fall back to windowing the body here rather than rendering a
          // row with no context at all.
          snippet: r.snip || windowSnippet(r.body ?? '', terms),
        });
      }
    } catch (e) {
      console.error('[Search] FTS5 failed:', (e as Error).message);
    }
  }

  // ── LIKE, additively ──
  //
  // The old router used this only when FTS returned NOTHING. For a mixed query like
  // "数据库 迁移" that is wrong: FTS serves 数据库, and 迁移 — being two characters —
  // can never match the trigram index, so it would contribute nothing at all. Running
  // the pass per unsearchable term and appending the hits keeps both halves.
  const uns = unsearchableTerms(query);
  let likeAdded = 0;
  for (const t of uns) {
    if (likeAdded >= LIKE_TOTAL_CAP) break;
    try {
      for (const hit of await likeHitsFor(t)) {
        if (likeAdded >= LIKE_TOTAL_CAP) break;
        if (add(hit)) likeAdded++;
      }
    } catch (e) {
      // The last resort by definition — it must never be why a search fails.
      console.error('[Search] LIKE fallback failed:', (e as Error).message);
    }
  }

  return { rows: rows.slice(0, Math.max(limit, PER_LIST_KEYWORD)), degraded: likeAdded > 0 ? 'like' : 'none' };
}

/** One term against all six kinds' text columns, newest first, capped per table. */
async function likeHitsFor(term: string): Promise<KeywordRow[]> {
  const contains = { contains: term };
  const out: KeywordRow[] = [];
  const push = (kind: SearchKind, id: string, title: string, body: string) =>
    out.push({ kind, id, title, snippet: windowSnippet(body, [term]) });

  const [issues, notes, emails, reports, chats, meetings] = await Promise.all([
    prisma.issue.findMany({
      where: { OR: [{ title: contains }, { description: contains }] },
      orderBy: { updatedAt: 'desc' },
      take: LIKE_PER_TABLE,
    }),
    prisma.knowledgePage.findMany({
      where: { projectId: DEFAULT_PROJECT_ID, status: 'active', OR: [{ title: contains }, { content: contains }] },
      orderBy: { updatedAt: 'desc' },
      take: LIKE_PER_TABLE,
    }),
    prisma.smartEmail.findMany({
      where: { OR: [{ subject: contains }, { bodySnapshot: contains }, { summary: contains }] },
      orderBy: { date: 'desc' },
      take: LIKE_PER_TABLE,
    }),
    prisma.report.findMany({
      where: { archived: false, OR: [{ title: contains }, { content: contains }] },
      orderBy: { generatedAt: 'desc' },
      take: LIKE_PER_TABLE,
    }),
    prisma.chatMessage.findMany({
      where: { text: contains },
      orderBy: { createdAt: 'desc' },
      take: LIKE_PER_TABLE,
    }),
    prisma.meeting.findMany({
      where: {
        archived: false,
        OR: [{ title: contains }, { summary: contains }, { minutes: contains }, { transcript: contains }],
      },
      orderBy: { createdAt: 'desc' },
      take: LIKE_PER_TABLE,
    }),
  ]);

  for (const i of issues) push('task', i.id, `${issueKey(i)}: ${i.title}`, i.description ?? '');
  for (const n of notes) push('note', n.id, n.title, n.content ?? '');
  for (const e of emails) push('email', e.id, e.subject, e.bodySnapshot || e.summary || '');
  for (const r of reports) push('report', r.id, r.title, r.content);
  for (const c of chats) push('chat', c.id, '', c.text);
  for (const m of meetings) push('meeting', m.id, m.title, meetingBody(m));
  return out;
}

// ─── Stage 2: semantics ───

/**
 * The cosine lists, one per vector-bearing corpus.
 *
 * Kept separate rather than concatenated because notes and reports are different
 * corpora: a row can only appear in one, so nothing is double-counted. Each list
 * carries its kind, which is how a semantic-only id — one that appears in no keyword
 * row and therefore has no metadata anywhere else — is later identified.
 *
 * The candidate select is deliberately narrower than searchNotesSemantic's: that one
 * fetches `content` for 500 notes to build its own snippets, which is megabytes per
 * keystroke for an interactive palette. Snippets come from the keyword stage here, so
 * only the fields the ranking needs are read.
 */
async function cosineLists(query: string): Promise<CosineList[]> {
  const qv = await embedQuery(query);
  if (!qv) return [];

  const [notes, reports] = await Promise.all([
    prisma.knowledgePage.findMany({
      where: { projectId: DEFAULT_PROJECT_ID, status: 'active' },
      orderBy: { updatedAt: 'desc' },
      take: CANDIDATES_INTERACTIVE,
      select: { id: true, vector: true },
    }),
    prisma.report.findMany({
      where: { archived: false },
      orderBy: { generatedAt: 'desc' },
      take: CANDIDATES_INTERACTIVE,
      select: { id: true, vector: true },
    }),
  ]);

  // `score > 0` means "has a usable vector", not "is related": decodeVector returns
  // null for a vector built by a different model, and cosineSimilarity maps that to 0.
  const rank = (rows: Array<{ id: string; vector: string | null }>): CosineList['ids'] =>
    rows
      .map((r) => ({ id: r.id, score: cosineSimilarity(qv, decodeVector(r.vector)) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_LIST_SEMANTIC)
      .map((s) => s.id);

  return [
    { kind: 'note' as const, ids: rank(notes) },
    { kind: 'report' as const, ids: rank(reports) },
  ].filter((l) => l.ids.length > 0);
}

// ─── Stage 3: enrichment ───

/**
 * Attach everything the UI needs to render a row and to navigate to it.
 *
 * Three batched queries, each issued only when the fused list actually contains that
 * kind. Most of what a row displays came out of the index already; this fills the
 * gaps the index cannot know:
 *   * chat  — its display title is the SESSION title (the index deliberately stores
 *             an empty title for chat), and scrolling needs the sessionId.
 *   * task  — the "TL-181: " prefix the rest of the app shows.
 *   * a semantic-only note or report — it appeared in no keyword row, so it has no
 *             title or snippet anywhere yet.
 */
async function enrich(
  fused: FusedEntry[],
  meta: Map<string, KeywordRow>,
  semanticKind: Map<string, SearchKind>,
  query: string,
  terms: string[],
): Promise<SearchHit[]> {
  const idToKind = (id: string) => meta.get(id)?.kind ?? semanticKind.get(id);
  const idsOf = (kind: SearchKind) => fused.filter((e) => idToKind(e.id) === kind).map((e) => e.id);

  const chatIds = idsOf('chat');
  const taskIds = idsOf('task');
  const meetingIds = idsOf('meeting');
  const docIds = fused.filter((e) => !meta.has(e.id)).map((e) => e.id);
  const docNoteIds = docIds.filter((id) => semanticKind.get(id) === 'note');
  const docReportIds = docIds.filter((id) => semanticKind.get(id) === 'report');

  const [chats, issues, docNotes, docReports, meetings] = await Promise.all([
    chatIds.length
      ? prisma.chatMessage.findMany({
          where: { id: { in: chatIds } },
          select: { id: true, sessionId: true, role: true, text: true, session: { select: { title: true } } },
        })
      : Promise.resolve([]),
    taskIds.length
      ? prisma.issue.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, title: true, issueNumber: true, source: true, sourceId: true, description: true },
        })
      : Promise.resolve([]),
    docNoteIds.length
      ? prisma.knowledgePage.findMany({
          where: { id: { in: docNoteIds } },
          select: { id: true, title: true, content: true },
        })
      : Promise.resolve([]),
    docReportIds.length
      ? prisma.report.findMany({ where: { id: { in: docReportIds } }, select: { id: true, title: true, content: true } })
      : Promise.resolve([]),
    meetingIds.length
      ? prisma.meeting.findMany({
          where: { id: { in: meetingIds } },
          select: { id: true, title: true, minutes: true, summary: true, transcript: true },
        })
      : Promise.resolve([]),
  ]);

  // A meeting's text, keyed by id. Note this is NOT `docById`: that map only ever holds
  // semantic-only notes and reports, and no meeting has a vector column — so reading the
  // meeting body from there is what made `segmentQuery` unreachable until this test
  // caught it (the expression below always saw an empty body and returned undefined).
  const meetingBodyById = new Map(meetings.map((m) => [m.id, meetingBody(m)]));
  const chatById = new Map(chats.map((c) => [c.id, c]));
  const issueById = new Map(issues.map((i) => [i.id, i]));
  const docById = new Map(
    [...docNotes, ...docReports].map((d) => [d.id, { title: d.title, content: (d as { content?: string | null }).content ?? '' }]),
  );

  const hits: SearchHit[] = [];
  for (const e of fused) {
    const kind = idToKind(e.id);
    if (!kind) continue; // an id from no known source — drop rather than render a blank row
    const row = meta.get(e.id);
    const doc = docById.get(e.id);
    const base = { score: e.score, match: e.match, keywordRank: e.keywordRank, semanticRank: e.semanticRank };
    // The invariant the UI leans on: highlights is empty exactly when the row was
    // found only by meaning, so "no <mark> anywhere in this row" is itself the signal.
    const highlights = e.keywordRank === undefined ? [] : terms;

    if (kind === 'chat') {
      const c = chatById.get(e.id);
      // A chat row whose message has since been deleted by a compress has nothing to
      // show and nowhere to scroll — dropped rather than rendered untitled.
      if (!c) continue;
      hits.push({
        ...base,
        kind: 'chat',
        id: e.id,
        title: c.session?.title || '',
        snippet: windowSnippet(c.text, terms),
        highlights,
        sessionId: c.sessionId,
        messageRole: c.role === 'assistant' ? 'assistant' : 'user',
      });
      continue;
    }

    const title = row?.title ?? doc?.title ?? '';
    const body = doc?.content ?? '';
    const snippet = row?.snippet || (body ? windowSnippet(body, terms) : '');

    if (kind === 'task') {
      const i = issueById.get(e.id);
      if (!i) continue;
      hits.push({
        ...base,
        kind: 'task',
        id: e.id,
        title: `${issueKey(i)}: ${i.title}`,
        snippet: windowSnippet(i.description ?? '', terms),
        highlights,
      });
      continue;
    }

    hits.push({
      ...base,
      kind,
      id: e.id,
      title,
      snippet,
      highlights,
      // Seed the panel's own transcript search only when the match was NOT in the
      // title — filtering a transcript for a term that is not in it is pure noise.
      segmentQuery:
        kind === 'meeting' && !title.includes(query) && (meetingBodyById.get(e.id) ?? '').includes(query)
          ? query
          : undefined,
    });
  }
  return hits;
}

/**
 * Search everything the palette can show, fused into one ranked list.
 */
export async function globalSearch(query: string, limit = 20): Promise<SearchResponse> {
  const q = query.trim();
  const semantic = semanticAvailability();
  if (q.length < MIN_QUERY_CHARS) return { hits: [], semantic, keywordHits: 0, degraded: 'none' };

  const terms = ftsTerms(q);
  const { rows, degraded } = await keywordList(q, limit);

  // The fusion works on ids alone, so everything the id alone cannot tell us is carried
  // alongside: `meta` for ids that came from a keyword row, `semanticKind` for ids that
  // came only from a vector list and would otherwise be unattributable.
  const meta = new Map(rows.map((r) => [r.id, r]));
  const lists = semantic === 'ready' ? await cosineLists(q) : [];
  const semanticKind = new Map<string, SearchKind>();
  for (const l of lists) for (const id of l.ids) semanticKind.set(id, l.kind);

  const fused = applyKindCap(
    fuseRrf(
      rows.map((r) => r.id),
      lists.map((l) => l.ids),
    ),
    (e) => meta.get(e.id)?.kind ?? semanticKind.get(e.id) ?? '',
    limit,
  );

  const hits = await enrich(fused, meta, semanticKind, q, terms);
  return { hits, semantic, keywordHits: rows.length, degraded };
}
