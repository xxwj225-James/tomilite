// Simple fetch-based API client for tRPC
const BASE = '/api';

// ─── API token (URL fragment, stripped immediately after read) ───
let _token = '';
try {
  _token = window.location.hash.replace('#tl_token=', '');
  if (_token) history.replaceState(null, '', window.location.pathname + window.location.search);
} catch {}

function authHeaders(): Record<string, string> {
  return _token ? { 'x-tl-token': _token } : {};
}

async function trpcCall(route: string, input?: any): Promise<any> {
  const [router, procedure] = route.split('.');
  const url = `${BASE}/${router}.${procedure}${!input ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`;

  const resp = await fetch(url, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  const json = await resp.json();

  // tRPC wraps in { result: { data: ... } }
  if (json.result?.data !== undefined) return json.result.data;
  return json;
}

async function trpcMutate(route: string, input: any): Promise<any> {
  const [router, procedure] = route.split('.');
  const url = `${BASE}/${router}.${procedure}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
    body: JSON.stringify(input),
  });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  const json = await resp.json();
  if (json.result?.data !== undefined) return json.result.data;
  return json;
}

// ─── Knowledge map shapes ───
//
// Mirrors `routers/knowledge.ts`. The map carries ids and nothing else about a note's
// contents — titles and excerpts come from `notes`, which is keyed by id so a node's leaf
// list stays small. Neither `content` nor `vector` ever crosses this boundary.
export type MapNodeKind = 'topic' | 'category' | 'unfiled' | 'new';

export interface MapNode {
  name: string;
  kind: MapNodeKind;
  notes: string[];
  children: MapNode[];
}

export interface MapNote {
  id: string;
  title: string;
  category: string;
  excerpt: string;
  source: string | null;
}

export interface MapLink {
  from: string;
  raw: string;
  title: string;
  /** Resolved target, or null when no note carries that title. */
  to: string | null;
  /** 0 = unresolved, 1 = exact, >1 = several notes share the title. */
  matches: number;
}

export interface KnowledgeMapResponse {
  generatedAt: string | null;
  lang: string;
  /** The note set changed since the tree was built; the additions are in `loose`. */
  stale: boolean;
  /** No tree stored at all — show the empty state, not an error. */
  needsOrganize: boolean;
  degraded: 'no-llm' | 'invalid' | 'categories' | null;
  /** Machine code for why. Translated by the card, never shown raw. */
  detail: string | null;
  model: string | null;
  topics: MapNode[];
  notes: Record<string, MapNote>;
  /** Note ids in no topic — synthesized into the 「新笔记」 node at render time. */
  loose: string[];
  stats: Record<string, number> | null;
  /** Only notes with at least one edge appear. */
  links: Record<string, { out: MapLink[]; back: MapLink[] }>;
}

/**
 * A hand edit to one topic in the map. `map` comes back on the failure paths too, so the
 * card has a single way to put the screen on the server's real state.
 *
 * The path is positional — `[2, 0]` is the first sub-topic of the third top-level topic —
 * because a `MapNode` has no id. `expect` / `intoExpect` carry the name the card drew at
 * that path: a path names the same node only as long as the tree does, and renaming the
 * wrong topic is worse than refusing. See `editTree` in `apps/api/src/lib/knowledgeTree.ts`.
 */
export interface TopicMutationResult {
  ok: boolean;
  reason?: string;
  map: KnowledgeMapResponse;
}

export type KnowledgeNeighbors =
  | { ok: true; items: Array<{ id: string; title: string; category: string; score: number }> }
  /** `no-vector` = this note has none; `no-peers` = no other note has one. */
  | { ok: false; reason: 'note-missing' | 'no-vector' | 'no-peers' };

export interface KnowledgeSuggestions {
  ok: boolean;
  reason?: string;
  batches?: Array<{
    noteId: string;
    title: string;
    suggestions: Array<{ targetId: string; targetTitle: string; reason: string }>;
  }>;
  skipped?: Array<{ noteId: string; title: string; why: string }>;
  /** Titles carried by more than one note — they cannot be link targets. */
  unlinkable?: Array<{ title: string; count: number }>;
  model?: string;
  tokens?: number;
  failures?: string[];
}

/** A source old enough and substantial enough to be worth folding into a note. */
export type DistillKind = 'task' | 'report' | 'meeting';

export interface DistillCandidate {
  kind: DistillKind;
  refId: string;
  label: string;
  watermark: string;
  items: number;
  /** The note this source already rolls into, if it has been harvested before. */
  existingNoteId: string | null;
}

export interface DistillCandidates {
  candidates: DistillCandidate[];
  /**
   * Sources that exist but are not on offer, with a machine reason. Kept rather than
   * counted, because the five states behind this list look identical on screen:
   * `no-material` means there is nothing here, `already-reviewed` means there is and you
   * have seen it, `not-done` means come back later.
   */
  excluded: Array<{ label: string; why: string }>;
  /** In scope and unanswered, but over this run's ceiling — the next press starts here. */
  deferred: number;
}

export interface DistillProposal {
  kind: DistillKind;
  refId: string;
  label: string;
  watermark: string;
  existingNoteId: string | null;
  /** Re-read at apply time; a note edited since this review is refused, not overwritten. */
  existingUpdatedAt: string | null;
  title: string;
  content: string;
  items: number;
  /** The source was longer than the material budget — the note may be missing its tail. */
  truncated: boolean;
}

export interface DistillSuggestions {
  ok: boolean;
  reason?: 'no-sources' | 'no-llm' | 'paused';
  /** When `reason` is `'paused'`: the stamp spending resumes. Read from the account-level
   *  brake the background chat distillation also writes. */
  pausedUntil?: string;
  proposals: DistillProposal[];
  /** The model read it and said there was nothing durable in it. A success, not a failure. */
  skipped: Array<{ label: string; why: string }>;
  failures: Array<{ label: string; why: string }>;
  model?: string;
  tokens: number;
  deferred: number;
}

// ─── Global search shapes ───
//
// Mirrors `lib/searchFusion.ts`. The web app cannot import from the api package (its
// tsconfig maps only `@/` and `@tomilite/shared-ui/*`), so the contract is restated
// here — the same convention the knowledge-map shapes above follow. Keep the two in
// step by hand; `scripts/test-search.mts` is what pins the server side.
export type SearchKind = 'chat' | 'note' | 'task' | 'meeting' | 'email' | 'report';

/** How a row earned its place. `both` means two independent lists found it. */
export type SearchMatch = 'keyword' | 'semantic' | 'both';

export interface SearchHit {
  kind: SearchKind;
  /** ChatMessage.id for chat, Issue.id for task, and so on. */
  id: string;
  /** Chat → the session title; task → "TL-181: <title>"; else the indexed title. */
  title: string;
  /** Windowed around the first matched term. Safe to render as plain text. */
  snippet: string;
  /** Never rendered — kept for logging and stable ordering. */
  score: number;
  match: SearchMatch;
  /**
   * Empty exactly when the row was found only by meaning. That invariant is what
   * makes "nothing to highlight" a usable signal in the row renderer.
   */
  highlights: string[];
  keywordRank?: number;
  semanticRank?: number;
  /** chat only — what a deep link needs to switch session and scroll. */
  sessionId?: string;
  messageRole?: 'user' | 'assistant';
  /** meeting only — seeds the panel's in-transcript search when the match was in the body. */
  segmentQuery?: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  /** Why the semantic list is empty — the palette says so rather than implying it is complete. */
  semantic: 'ready' | 'warming' | 'unavailable';
  /** Keyword rows before fusion. 0 is what makes a "no keyword match" banner honest. */
  keywordHits: number;
  degraded: 'none' | 'like';
}

// ─── API methods ───
export const api = {
  issue: {
    list: (projectId: string) => trpcCall('issue.list', { projectId }),
    /** Tab badges — counted server-side over the whole set, not over a page of rows. */
    taskCounts: (projectId: string) => trpcCall('issue.taskCounts', { projectId }),
    byId: (id: string) => trpcCall('issue.byId', { id }),
    create: (data: any) => trpcMutate('issue.create', data),
    update: (data: any) => trpcMutate('issue.update', data),
    delete: (id: string) => trpcMutate('issue.delete', { id }),
    /**
     * Turn a mirrored row into an ordinary local task. The only escape from the
     * read-only rule: without it a row imported from Redmine can be neither edited nor
     * deleted, so noise from a sync would be permanent. It comes back on the next sync
     * if the ticket is still inside the cursor window — the UI says so.
     */
    detach: (id: string) => trpcMutate('issue.detach', { id }),
    children: (parentId: string) => trpcCall('issue.children', { parentId }),
    updateRank: (id: string, beforeId?: string, afterId?: string) =>
      trpcMutate('issue.updateRank', { id, beforeId, afterId }),
  },
  board: {
    get: (projectId: string) => trpcCall('board.getBoard', { projectId }),
    moveCard: (cardId: string, columnId: string, position: number) =>
      trpcMutate('board.moveCard', { cardId, columnId, position }),
  },
  wiki: {
    list: (projectId: string, category?: string) => trpcCall('wiki.list', { projectId, category }),
    byId: (id: string) => trpcCall('wiki.byId', { id }),
    create: (data: any) => trpcMutate('wiki.create', data),
    update: (data: any) => trpcMutate('wiki.update', data),
    delete: (id: string) => trpcMutate('wiki.delete', { id }),
    /** How many notes exist, so the import dialog can warn before an import rather than after. */
    count: (projectId: string) => trpcCall('wiki.count', { projectId }),
    /** One batch of a note import — one batch is one `source`, so a pick spanning formats
     *  arrives as several calls. The caller batches and parses; this writes what it is
     *  given and knows nothing of formats. */
    importNotes: (data: any) => trpcMutate('wiki.importNotes', data),
  },
  /**
   * The Redmine connector. Every procedure answers `{ok:false, error}` rather than
   * throwing, so a failed call is a normal return — which matters here because the
   * errors are the feature: "the REST API is switched off server-wide" is something the
   * user has to read and act on, and `trpcCall` above turns a throwing procedure into
   * `API error: 500`, losing the sentence.
   */
  redmine: {
    getConfig: () => trpcCall('redmine.getConfig'),
    saveConfig: (data: any) => trpcMutate('redmine.saveConfig', data),
    testConnection: (data: any) => trpcMutate('redmine.testConnection', data),
    vocabularies: (data: any) => trpcMutate('redmine.vocabularies', data),
    preview: (data: any) => trpcMutate('redmine.preview', data),
    sync: (data?: any) => trpcMutate('redmine.sync', data ?? {}),
    status: () => trpcCall('redmine.status'),
    disconnect: (tasks: 'keep' | 'detach' | 'delete') => trpcMutate('redmine.disconnect', { tasks }),
  },
  git: {
    listRepos: () => trpcCall('git.listRepos'),
    addRepo: (data: any) => trpcMutate('git.addRepo', data),
    removeRepo: (id: string) => trpcMutate('git.removeRepo', { id }),
    recentRefs: (limit?: number) => trpcCall('git.recentRefs', { limit: limit || 20 }),
  },
  focus: {
    status: () => trpcCall('focus.status'),
    heartbeat: (data: any) => trpcMutate('focus.heartbeat', data),
  },
  system: {
    checkUpdate: () =>
      trpcCall('system.checkUpdate') as Promise<{
        latest?: { isNewer?: boolean; version?: string; releaseNotes?: string; downloadUrl?: string };
      }>,
    currentVersion: () => trpcCall('system.currentVersion') as Promise<{ version: string }>,
    notifyCount: () => trpcCall('system.notifyCount') as Promise<{ count: number }>,
    clearNotifications: () => trpcMutate('system.clearNotifications', {}),
    getConfig: (key: string) => trpcCall('system.getConfig', { key }),
    setConfig: (data: { key: string; value: string }) => trpcMutate('system.setConfig', data),
    isSetupCompleted: () => trpcCall('system.isSetupCompleted'),
    markSetupCompleted: () => trpcMutate('system.markSetupCompleted', {}),
    /** Why the semantic half of the map is empty, when it is. */
    embedStatus: () =>
      trpcCall('system.embedStatus') as Promise<{
        status: 'ready' | 'absent' | 'failed' | 'downloading' | 'disabled';
        modelId: string;
        dims: number;
        downloaded: boolean;
        pending: number;
        embedded: number;
        lastError: string | null;
      }>,
    /** The retry. Releases a cached ONNX load failure before re-queueing. */
    reembed: () => trpcMutate('system.reembed', {}) as Promise<{ ok: boolean; queued: number }>,
  },
  knowledge: {
    /** Read-only. Never calls a model, so it is safe to call on every panel activation. */
    map: (lang: string) => trpcCall('knowledge.map', { lang }) as Promise<KnowledgeMapResponse>,
    /** The only call in this block that spends tokens. Bound to a button. */
    organize: (lang: string) =>
      trpcMutate('knowledge.organize', { lang }) as Promise<{
        ok: boolean;
        reason?: string;
        /** false when a previous fallback map was replaced — see `storeFallbackIfNothingBetter`. */
        kept?: boolean;
        map: KnowledgeMapResponse;
      }>,
    neighbors: (noteId: string, limit = 3) =>
      trpcCall('knowledge.neighbors', { noteId, limit }) as Promise<KnowledgeNeighbors>,
    suggestLinks: (lang: string, excludeIds: string[], force = false) =>
      trpcMutate('knowledge.suggestLinks', { lang, excludeIds, force }) as Promise<KnowledgeSuggestions>,
    applyLinks: (lang: string, items: Array<{ noteId: string; targetIds: string[] }>, excludeIds: string[]) =>
      trpcMutate('knowledge.applyLinks', { lang, items, excludeIds }) as Promise<{
        ok: boolean;
        written: Array<{ noteId: string; title: string; added: string[]; refused: string[] }>;
        skipped: Array<{ noteId: string; why: string }>;
        unchanged: number;
      }>,
    /** Free. Lists what could be harvested and why the rest cannot — so the user sees a
     *  count before they see a bill. */
    distillCandidates: (scope: { kinds: DistillKind[]; force: boolean; sinceDays: number | null }) =>
      trpcCall('knowledge.distillCandidates', scope) as Promise<DistillCandidates>,
    /** Spends tokens, writes nothing. One model call per candidate. */
    suggestDistill: (
      scope: { kinds: DistillKind[]; force: boolean; sinceDays: number | null },
      lang: string,
      excludeIds: string[],
    ) => trpcMutate('knowledge.suggestDistill', { ...scope, lang, excludeIds }) as Promise<DistillSuggestions>,
    /** Free. Writes exactly the text that was reviewed. */
    applyDistill: (
      lang: string,
      items: Array<{
        kind: DistillKind;
        refId: string;
        title: string;
        content: string;
        watermark: string;
        existingUpdatedAt: string | null;
      }>,
    ) =>
      trpcMutate('knowledge.applyDistill', { lang, items }) as Promise<{
        written: Array<{ kind: DistillKind; refId: string; noteId: string; action: 'created' | 'updated'; title: string }>;
        skipped: Array<{ refId: string; why: string }>;
        unchanged: number;
      }>,
    /** Free, local, no model: the three ways to fix a topic the map got wrong. */
    renameTopic: (lang: string, path: number[], expect: string, name: string) =>
      trpcMutate('knowledge.renameTopic', { lang, path, expect, name }) as Promise<TopicMutationResult>,
    deleteTopic: (lang: string, path: number[], expect: string) =>
      trpcMutate('knowledge.deleteTopic', { lang, path, expect }) as Promise<TopicMutationResult>,
    mergeTopics: (lang: string, path: number[], expect: string, intoPath: number[], intoExpect: string) =>
      trpcMutate('knowledge.mergeTopics', { lang, path, expect, intoPath, intoExpect }) as Promise<TopicMutationResult>,
  },
  health: {
    personalHealth: (lang: string, force?: boolean) => trpcCall('health.personalHealth', { lang, force }),
    taskStats: () => trpcCall('health.taskStats'),
  },
  standup: {
    getMorningBrief: (lang: string) => trpcCall('standup.getMorningBrief', { lang }),
    getMorningStatus: () => trpcCall('standup.getMorningStatus'),
    getEveningReport: (lang: string) => trpcMutate('standup.getEveningReport', { lang }),
    getEveningStatus: () => trpcCall('standup.getEveningStatus'),
    getSettings: () => trpcCall('standup.getSettings'),
    saveSettings: (data: { morning: boolean; morningTime?: string; evening: boolean; eveningTime?: string }) =>
      trpcMutate('standup.saveSettings', data),
  },
  llm: {
    getConfig: () => trpcCall('llm.getConfig'),
    saveConfig: (data: any) => trpcMutate('llm.saveConfig', data),
    saveProvider: (data: any) => trpcMutate('llm.saveProvider', data),
    testConnection: (data: any) => trpcMutate('llm.testConnection', data),
  },
  hosted: {
    status: () =>
      trpcCall('hosted.status') as Promise<{ active: boolean; loggedIn: boolean; email: string; enabled: boolean }>,
    config: () => trpcCall('hosted.config') as Promise<{ ok: boolean; data?: any; error?: string }>,
    sendCode: (email: string) =>
      trpcMutate('hosted.sendCode', { email }) as Promise<{
        ok: boolean;
        code?: string;
        error?: string;
        resendAfterSec?: number;
      }>,
    verify: (email: string, code: string) =>
      trpcMutate('hosted.verify', { email, code }) as Promise<{
        ok: boolean;
        code?: string;
        error?: string;
        plan?: string;
        creditCny?: number;
        models?: any[];
      }>,
    usage: () =>
      trpcCall('hosted.usage') as Promise<{
        ok: boolean;
        data?: any;
        error?: string;
        expired?: boolean;
        code?: string;
      }>,
    enable: () => trpcMutate('hosted.enableHosted', {}),
    disable: () => trpcMutate('hosted.disableHosted', {}),
    logout: () => trpcMutate('hosted.logout', {}),
    submitIntent: (answer: 'yes' | 'price' | 'undecided' | 'no') =>
      trpcMutate('hosted.submitIntent', { answer }) as Promise<{
        ok: boolean;
        answer?: string;
        code?: string;
        error?: string;
      }>,
  },
  agent: {
    chat: (data: any) => trpcMutate('agent.chat', data),
    classifyIntent: (data: any) => trpcMutate('agent.classifyIntent', data),
  },
  apikey: {
    list: () => trpcCall('apikey.list'),
    create: (data: any) => trpcMutate('apikey.generate', data),
    revoke: (id: string) => trpcMutate('apikey.revoke', { id }),
  },
  email: {
    // Whole row, for global search's deep link — the panel's own list is filtered to
    // unprocessed mail, so a search hit is usually not in it.
    byId: (id: string) => trpcCall('email.byId', { id }),
    listInbox: (limit?: number) => trpcCall('email.listInbox', { limit: limit || 50 }),
    listDrafts: () => trpcCall('email.listDrafts'),
    saveDraft: (data: any) => trpcMutate('email.saveDraft', data),
    getConfig: () => trpcCall('email.getConfig'),
    saveConfig: (data: any) => trpcMutate('email.saveConfig', data),
    saveIMAP: (data: any) => trpcMutate('email.saveIMAP', data),
    connectIMAP: () => trpcMutate('email.connectIMAP', {}),
    stats: () => trpcCall('email.stats'),
    sendReport: (data: any) => trpcMutate('email.sendReport', data),
    subGroupByCategory: (emailIds: string[], category: number, lang: string) =>
      trpcMutate('email.subGroupByCategory', { emailIds, category, lang }),
  },
  meeting: {
    list: (search?: string) => trpcCall('meeting.list', { search: search || '', limit: 200 }),
    get: (id: string, segmentLimit = 200, segmentOffset = 0) =>
      trpcCall('meeting.get', { id, segmentLimit, segmentOffset }),
    stats: () => trpcCall('meeting.stats'),
    create: (data: { title?: string; source?: string; lang?: string; retentionDays?: number }) =>
      trpcMutate('meeting.create', data),
    finalizeRecording: (id: string, autoTranscribe = true, durationMs?: number) =>
      trpcMutate('meeting.finalizeRecording', { id, autoTranscribe, durationMs }),
    transcribe: (id: string, force = false) => trpcMutate('meeting.transcribe', { id, force }),
    cancelTranscribe: (id: string) => trpcMutate('meeting.cancelTranscribe', { id }),
    update: (data: Record<string, unknown>) => trpcMutate('meeting.update', data),
    setActionItemStatus: (id: string, status: 'open' | 'created' | 'dismissed') =>
      trpcMutate('meeting.setActionItemStatus', { id, status }),
    setDecisionStatus: (id: string, status: 'active' | 'dismissed' | 'superseded') =>
      trpcMutate('meeting.setDecisionStatus', { id, status }),
    generateFollowUp: (id: string, confirmHosted = false) =>
      trpcMutate('meeting.generateFollowUp', { id, confirmHosted }),
    dismissFollowUp: (id: string) => trpcMutate('meeting.dismissFollowUp', { id }),
    delete: (id: string) => trpcMutate('meeting.delete', { id }),
    searchSegments: (id: string, q: string) => trpcCall('meeting.searchSegments', { id, q }),
    estimate: (id: string) => trpcCall('meeting.estimate', { id }),
    summarize: (id: string, force = false, confirmHosted = false) =>
      trpcMutate('meeting.summarize', { id, force, confirmHosted }),
    emailStatus: () => trpcCall('meeting.emailStatus'),
    sendMinutes: (data: {
      id: string;
      to: string;
      cc?: string;
      subject: string;
      html: string;
      attachTranscript?: boolean;
    }) => trpcMutate('meeting.sendMinutes', data),
    createTaskFromActionItem: (actionItemId: string, lang: string) =>
      trpcMutate('meeting.createTaskFromActionItem', { actionItemId, lang }),
    binStatus: () => trpcCall('meeting.binStatus'),
    listModels: () => trpcCall('meeting.listModels'),
    downloadModel: (name: string) => trpcMutate('meeting.downloadModel', { name }),
    cancelDownload: () => trpcMutate('meeting.cancelDownload', {}),
    deleteModel: (name: string) => trpcMutate('meeting.deleteModel', { name }),
    consent: () => trpcCall('meeting.consent'),
    acknowledgeConsent: () => trpcMutate('meeting.acknowledgeConsent', {}),
    resetConsent: () => trpcMutate('meeting.resetConsent', {}),
  },
  report: {
    list: (limit?: number) => trpcCall('report.list', { limit: limit || 50 }),
    save: (data: { reportType: string; title: string; content: string; id?: string }) =>
      trpcMutate('report.save', data),
    delete: (id: string) => trpcMutate('report.delete', { id }),
    byId: (id: string) => trpcCall('report.byId', { id }),
    markSent: (id: string) => trpcMutate('report.markSent', { id }),
  },
  feedback: {
    list: () => trpcCall('feedback.list'),
    create: (data: { type: string; title: string; body: string; email?: string }) =>
      trpcMutate('feedback.create', data),
    updateStatus: (id: string, status: string) => trpcMutate('feedback.updateStatus', { id, status }),
    delete: (id: string) => trpcMutate('feedback.delete', { id }),
  },
  chat: {
    listSessions: () => trpcCall('chat.listSessions'),
    createSession: (title?: string) => trpcMutate('chat.createSession', { title: title || 'New Chat' }),
    renameSession: (id: string, title: string) => trpcMutate('chat.renameSession', { id, title }),
    deleteSession: (id: string) => trpcMutate('chat.deleteSession', { id }),
    getMessages: (sessionId: string, threadId?: string | null) => {
      const params: any = { sessionId };
      if (threadId !== undefined) params.threadId = threadId ?? null;
      return trpcCall('chat.getMessages', params);
    },
    addMessage: (data: {
      id?: string;
      sessionId: string;
      role: 'user' | 'assistant';
      text: string;
      tool?: string;
      staged?: string;
      card?: string;
      reasoningContent?: string;
      pinnable?: boolean;
      threadId?: string | null;
    }) => trpcMutate('chat.addMessage', data),
    updateMessage: (data: { id: string; card?: string; staged?: string; text?: string }) =>
      trpcMutate('chat.updateMessage', data),
    clearMessages: (sessionId: string, threadId?: string | null) =>
      trpcMutate('chat.clearMessages', { sessionId, threadId: threadId ?? null }),
    listThreads: (sessionId: string) => trpcCall('chat.listThreads', { sessionId }),
  },
  search: {
    /** Six kinds, one fused ranked list. See lib/searchCore.ts. */
    query: (query: string, limit = 20): Promise<SearchResponse> =>
      trpcCall('search.search', { query, limit }),
  },
};
