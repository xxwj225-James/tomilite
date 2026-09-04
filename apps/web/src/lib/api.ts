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

// ─── API methods ───
export const api = {
  issue: {
    list: (projectId: string) => trpcCall('issue.list', { projectId }),
    byId: (id: string) => trpcCall('issue.byId', { id }),
    create: (data: any) => trpcMutate('issue.create', data),
    update: (data: any) => trpcMutate('issue.update', data),
    delete: (id: string) => trpcMutate('issue.delete', { id }),
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
};
