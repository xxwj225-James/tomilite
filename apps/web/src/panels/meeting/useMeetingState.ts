import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { useMeetingStore } from '@/stores/meetingStore';
import { captureSupported, startRecording, type Recorder, type RecorderLevels } from '@/lib/recorder';

// ═══ Meeting state — all state + business logic for MeetingPanel ═══
//
// The panel is a thin shell over this hook, same shape as useReportsState.
//
// Two things here are load-bearing and easy to undo by accident:
//
//  • `levels` is throttled to ~10fps on the way into React state. The recorder
//    fires at 20fps; re-rendering the panel at that rate for a cosmetic meter is
//    pure churn.
//  • Only the transcribe stage is started automatically. The AI stage is
//    explicitly triggered, because it costs the user money.

export type MeetingTab = 'transcript' | 'minutes' | 'actions';

export interface MeetingRow {
  id: string;
  title: string;
  status: string;
  source: string;
  durationMs: number;
  audioBytes: number;
  whisperModel: string;
  lang: string;
  transcribeStatus: string;
  transcribeProgress: number;
  transcribeError: string | null;
  aiStatus: string;
  minutesStatus: string;
  segmentCount: number;
  actionItemCount: number;
  retentionDays: number;
  sentAt: string | null;
  createdAt: string;
  audioExpiresAt: string | null;
  audioDeletedAt: string | null;
}

export interface ActionItem {
  id: string;
  idx: number;
  text: string;
  owner: string | null;
  dueDate: string | null;
  priority: string | null;
  status: string;
  issueId: string | null;
}

export interface Decision {
  id: string;
  idx: number;
  text: string;
  /** Why it was decided — null unless the transcript actually said so. */
  rationale: string | null;
  /** YYYY-MM-DD, or null when the meeting doesn't pin it down. */
  decidedAt: string | null;
  status: string;
}

export interface Segment {
  id: string;
  idx: number;
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
}

export interface MeetingDetail {
  meeting: any;
  segments: Segment[];
  decisions: Decision[];
  actionItems: ActionItem[];
  totalSegments: number;
}

const LEVEL_THROTTLE_MS = 100;
const SEGMENT_PAGE = 200;

function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Map a server-side failure code onto a dictionary key. */
function transcribeErrorKey(code: string): string {
  if (code === 'no_binary') return 'meeting.transcribe.noBinary';
  if (code === 'no_model') return 'meeting.transcribe.noModel';
  if (code === 'busy') return 'meeting.transcribe.busy';
  if (code === 'no_audio') return 'meeting.transcribe.noAudioFile';
  return '';
}

export function useMeetingState(active?: boolean, refreshKey?: number) {
  const lang = useLang();

  // ─── Library ───
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);

  // ─── Detail ───
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [tab, setTab] = useState<MeetingTab>('transcript');
  const [segmentLimit, setSegmentLimit] = useState(SEGMENT_PAGE);
  const [segSearch, setSegSearch] = useState('');
  const [segHits, setSegHits] = useState<Segment[] | null>(null);

  // ─── Job progress (SSE) ───
  const [transcribePct, setTranscribePct] = useState<number | null>(null);
  const [aiStage, setAiStage] = useState<{ stage: string; percent: number; i?: number; n?: number } | null>(null);
  const [jobError, setJobError] = useState<{ key: string; params?: Record<string, string | number> } | null>(null);

  // ─── Recorder ───
  const [levels, setLevels] = useState<RecorderLevels>({ mic: -100, system: -100, mix: -100, clipping: false });
  const [deadMs, setDeadMs] = useState(0);
  const [degraded, setDegraded] = useState(false);
  const [recError, setRecError] = useState<string>('');
  const [stopping, setStopping] = useState(false);
  const [starting, setStarting] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const recorderRef = useRef<Recorder | null>(null);
  // Guards live in refs, not state: two clicks in the same tick both see the
  // pre-render value of a state flag, which is exactly how a double-press
  // started two captures.
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const levelAtRef = useRef(0);

  // Recording state is mirrored into a global store so the shell can show an
  // indicator on every panel, not just this one.
  const recState = useMeetingStore();
  const recordingId = recState.meetingId;

  // ─── Speech engine + models ───
  const [bin, setBin] = useState<any>(null);
  const [modelState, setModelState] = useState<any>(null);

  // ─── AI ───
  const [estimate, setEstimate] = useState<any>(null);
  const [estimating, setEstimating] = useState(false);
  const [confirmAi, setConfirmAi] = useState(false);
  // Which kind of run the user asked for, held across the confirm dialog so the
  // confirmation executes the action that was requested rather than a default.
  const [confirmForce, setConfirmForce] = useState(false);
  const [busy, setBusy] = useState('');

  // ─── Email ───
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendCc, setSendCc] = useState('');
  const [sendSubject, setSendSubject] = useState('');
  const [sendAttach, setSendAttach] = useState(false);
  const [sending, setSending] = useState(false);

  // ─── Dialogs ───
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MeetingRow | null>(null);

  const nowStr = useCallback(
    (k: string, params?: Record<string, string | number>) => t(k as any, lang, params),
    [lang],
  );

  // ─── Fetch ───
  const fetchList = useCallback(
    async (q?: string) => {
      try {
        const rows = await api.meeting.list(q ?? search);
        setMeetings(Array.isArray(rows) ? rows : []);
        const st = await api.meeting.stats();
        setStats(st);
      } catch {
        /* the panel stays usable with a stale list */
      } finally {
        setLoading(false);
      }
    },
    [search],
  );

  const fetchDetail = useCallback(async (id: string, limit = SEGMENT_PAGE) => {
    try {
      const d = (await api.meeting.get(id, limit, 0)) as MeetingDetail | null;
      setDetail(d);
    } catch {
      /* keep the previous detail on screen */
    }
  }, []);

  useEffect(() => {
    void fetchList('');
    api.meeting
      .binStatus()
      .then(setBin)
      .catch(() => {});
    api.meeting
      .listModels()
      .then(setModelState)
      .catch(() => {});
    api.meeting
      .emailStatus()
      .then((r: any) => setEmailConfigured(!!r?.configured))
      .catch(() => {});
    api.meeting
      .consent()
      .then((r: any) => setConsentChecked(!!r?.acknowledgedAt))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const h = () => void fetchList('');
    window.addEventListener('meeting-refresh', h);
    return () => window.removeEventListener('meeting-refresh', h);
  }, [fetchList]);

  // App-level nudge (agent created a meeting, another panel linked a task).
  useEffect(() => {
    if (refreshKey) void fetchList('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- [refreshKey] is the trigger
  }, [refreshKey]);

  // Settings → Meetings can send the user back through the consent notice.
  useEffect(() => {
    const h = () => setConsentChecked(false);
    window.addEventListener('meeting-consent-reset', h);
    return () => window.removeEventListener('meeting-consent-reset', h);
  }, []);

  useEffect(() => {
    if (selectedId) void fetchDetail(selectedId, segmentLimit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on id change only
  }, [selectedId]);

  // ─── SSE: one stream per selected meeting, carrying every stage ───
  useEffect(() => {
    if (!selectedId || !active) return;
    const es = new EventSource(`/api/meeting/stream?meetingId=${encodeURIComponent(selectedId)}`);
    let closed = false;

    es.addEventListener('progress', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (d.stage === 'transcribe') setTranscribePct(typeof d.percent === 'number' ? d.percent : null);
    });

    es.addEventListener('transcribe:done', () => {
      setTranscribePct(null);
      void fetchDetail(selectedId, segmentLimit);
      void fetchList();
    });

    es.addEventListener('transcribe:error', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setTranscribePct(null);
      const key = transcribeErrorKey(d.error);
      setJobError(key ? { key } : { key: 'meeting.status.failed' });
      void fetchDetail(selectedId, segmentLimit);
      void fetchList();
    });

    es.addEventListener('ai:progress', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setAiStage({ stage: d.stage, percent: d.percent ?? 0, i: d.i, n: d.n });
    });

    es.addEventListener('ai:done', () => {
      setAiStage(null);
      setJobError(null);
      void fetchDetail(selectedId, segmentLimit);
      void fetchList();
    });

    es.addEventListener('ai:error', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setAiStage(null);
      setJobError(
        d.code === 'quota_exhausted' ? { key: 'meeting.ai.quotaExhausted' } : { key: 'meeting.status.aiFailed' },
      );
      void fetchDetail(selectedId, segmentLimit);
      void fetchList();
    });

    // The stream is server-sent; EventSource reconnects on its own, so a network
    // blip must not tear the panel down.
    es.onerror = () => {
      if (closed) es.close();
    };

    return () => {
      closed = true;
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resubscribe on id change only
  }, [selectedId, active]);

  // ─── Recorder controls ───
  const applyLevels = (l: RecorderLevels) => {
    const now = performance.now();
    if (now - levelAtRef.current < LEVEL_THROTTLE_MS) return;
    levelAtRef.current = now;
    setLevels(l);
  };

  const beginRecording = useCallback(
    async (source: 'mic' | 'mic+system') => {
      setRecError('');
      setDegraded(false);
      setDeadMs(0);
      setStarting(true);
      let createdId = '';
      try {
        const created = await api.meeting.create({ source, lang: 'auto' });
        if (!created?.ok) {
          setRecError(nowStr('meeting.record.uploadFailed'));
          return;
        }
        createdId = created.id;
        const rec = await startRecording({
          meetingId: created.id,
          source,
          onLevels: applyLevels,
          onDeadStream: (s) => setDeadMs(s.active ? s.silentMs : 0),
          onDegraded: () => setDegraded(true),
          onError: (code) => {
            setRecError(
              code === 'mic_denied'
                ? nowStr('meeting.record.micDenied')
                : code === 'upload_failed'
                  ? nowStr('meeting.record.uploadFailed')
                  : nowStr('meeting.record.uploadFailed'),
            );
          },
        });
        recorderRef.current = rec;
        useMeetingStore.getState().start(created.id, created.title);
        if (rec.source === 'mic') setDegraded(true);
        void fetchList('');
      } catch {
        // startRecording already reported the specific reason via onError. Clear
        // the placeholder row it left behind: the meeting never captured a byte,
        // and a click that "did nothing" must not leave a row in the library.
        if (createdId) {
          void api.meeting.delete(createdId).catch(() => {});
          void fetchList('');
        }
      } finally {
        setStarting(false);
        startingRef.current = false;
      }
    },
    [nowStr, fetchList],
  );

  const requestStart = useCallback(
    (source: 'mic' | 'mic+system') => {
      if (!consentChecked) {
        setConsentOpen(true);
        return;
      }
      // Setting up capture takes seconds (permission checks, the display-media
      // grant, the audio graph). Without this the button looks dead for that
      // whole window, and every impatient second click used to start a *second*
      // capture — leaving the first one recording with nothing pointing at it.
      if (startingRef.current || stoppingRef.current || useMeetingStore.getState().meetingId) return;
      startingRef.current = true;
      void beginRecording(source);
    },
    [consentChecked, beginRecording],
  );

  const acceptConsent = useCallback(async () => {
    try {
      await api.meeting.acknowledgeConsent();
    } catch {
      /* the gate is local UX; the server stamp is best-effort */
    }
    setConsentChecked(true);
    setConsentOpen(false);
  }, []);

  const togglePause = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.paused) {
      rec.resume();
      useMeetingStore.getState().resume();
    } else {
      rec.pause();
      useMeetingStore.getState().pause();
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const rec = recorderRef.current;
    const id = useMeetingStore.getState().meetingId;
    setStopping(true);
    try {
      let durationMs = 0;
      if (rec) {
        const out = await rec.stop();
        durationMs = Math.round(out.seconds * 1000);
        recorderRef.current = null;
      }
      useMeetingStore.getState().stop();
      setLevels({ mic: -100, system: -100, mix: -100, clipping: false });
      setDeadMs(0);
      if (id) {
        // Transcription starts server-side right after the WAV header is closed.
        const r = await api.meeting.finalizeRecording(id, true, durationMs);
        setSelectedId(id);
        setTab('transcript');
        if (r && r.transcribeStarted === false && r.error) {
          const key = transcribeErrorKey(r.error);
          setJobError(key ? { key } : { key: 'meeting.transcribe.noAudio' });
        }
        void fetchList('');
      }
    } catch {
      setRecError(nowStr('meeting.record.uploadFailed'));
    } finally {
      setStopping(false);
      stoppingRef.current = false;
    }
  }, [fetchList, nowStr]);

  // ─── Transcription ───
  const startTranscribe = useCallback(
    async (force = false) => {
      if (!selectedId) return;
      setJobError(null);
      setBusy('transcribe');
      try {
        const r: any = await api.meeting.transcribe(selectedId, force);
        if (r && r.ok === false && r.error) {
          const key = transcribeErrorKey(r.error);
          setJobError(key ? { key } : { key: 'meeting.status.failed' });
        } else {
          setTranscribePct(0);
        }
      } catch {
        setJobError({ key: 'meeting.status.failed' });
      } finally {
        setBusy('');
        void fetchList('');
      }
    },
    [selectedId, fetchList],
  );

  const cancelTranscribe = useCallback(async () => {
    if (!selectedId) return;
    await api.meeting.cancelTranscribe(selectedId).catch(() => {});
    setTranscribePct(null);
    void fetchList('');
  }, [selectedId, fetchList]);

  // ─── AI ───
  const runSummarize = useCallback(
    async (force: boolean, confirmHosted: boolean) => {
      if (!selectedId) return;
      setConfirmAi(false);
      setJobError(null);
      setBusy('ai');
      setAiStage({ stage: 'map', percent: 2, i: 0, n: 0 });
      try {
        const r: any = await api.meeting.summarize(selectedId, force, confirmHosted);
        if (r && r.ok === false) {
          if (r.error === 'confirm_required') {
            setConfirmAi(true);
          } else if (r.error === 'no_transcript') {
            setJobError({ key: 'meeting.minutes.empty' });
          } else {
            setJobError({ key: 'meeting.status.aiFailed' });
          }
        }
      } catch {
        setJobError({ key: 'meeting.status.aiFailed' });
      } finally {
        setAiStage(null);
        setBusy('');
        void fetchDetail(selectedId, segmentLimit);
        void fetchList('');
      }
    },
    [selectedId, fetchDetail, segmentLimit, fetchList],
  );

  /**
   * Generate is a two-step dance. The estimate exists so a hosted trial can ask
   * first: the gateway charges per token, and a button that silently spends the
   * user's credit is the one failure this panel must not have.
   */
  const requestSummarize = useCallback(
    async (force: boolean) => {
      if (!selectedId) return;
      setEstimating(true);
      const est: any = await api.meeting.estimate(selectedId).catch(() => null);
      setEstimate(est);
      setEstimating(false);
      if (est?.hostedTrial) {
        setConfirmForce(force);
        setConfirmAi(true);
      } else {
        void runSummarize(force, false);
      }
    },
    [selectedId, runSummarize],
  );

  /** Runs the request the confirm dialog was raised for. */
  const confirmSummarize = useCallback(() => {
    void runSummarize(confirmForce, true);
  }, [confirmForce, runSummarize]);

  // ─── Minutes editing ───
  const saveMinutes = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!selectedId) return;
      await api.meeting.update({ id: selectedId, ...patch }).catch(() => {});
    },
    [selectedId],
  );

  const openSend = useCallback(() => {
    if (!detail) return;
    const m = detail.meeting;
    setSendTo(m.sendTo || '');
    setSendCc(m.sendCc || '');
    setSendSubject(m.followUpSubject || m.minutesSubject || m.title || '');
    setSendAttach(false);
    setSendOpen(true);
  }, [detail]);

  const sendMinutes = useCallback(
    async (html: string) => {
      if (!selectedId || !detail) return;
      if (!sendTo.trim()) {
        setNotice({ title: nowStr('meeting.minutes.send'), message: nowStr('meeting.minutes.noRecipients') });
        return;
      }
      setSending(true);
      try {
        const r: any = await api.meeting.sendMinutes({
          id: selectedId,
          to: sendTo.trim(),
          cc: sendCc.trim() || undefined,
          subject: sendSubject,
          html,
          attachTranscript: sendAttach,
        });
        if (r?.ok) {
          setSendOpen(false);
          setNotice({ title: nowStr('meeting.minutes.send'), message: nowStr('meeting.minutes.sent') });
        } else if (r?.code === 'smtp_not_configured' || r?.code === 'smtp_incomplete') {
          setSendOpen(false);
          setEmailConfigured(false);
        } else {
          setNotice({
            title: nowStr('meeting.minutes.send'),
            message: nowStr('meeting.minutes.sendFailed', { error: String(r?.error || '') }),
          });
        }
      } catch (e: any) {
        setNotice({
          title: nowStr('meeting.minutes.send'),
          message: nowStr('meeting.minutes.sendFailed', { error: e?.message || 'network' }),
        });
      } finally {
        setSending(false);
        void fetchDetail(selectedId, segmentLimit);
        void fetchList('');
      }
    },
    [selectedId, detail, sendTo, sendCc, sendSubject, sendAttach, fetchDetail, segmentLimit, fetchList, nowStr],
  );

  // ─── Action item → Task ───
  const createTask = useCallback(
    async (item: ActionItem) => {
      setBusy('task:' + item.id);
      try {
        const r: any = await api.meeting.createTaskFromActionItem(item.id, lang);
        if (r?.ok) {
          setDetail((d) =>
            d
              ? {
                  ...d,
                  actionItems: d.actionItems.map((a) =>
                    a.id === item.id ? { ...a, issueId: r.issue.id, status: 'created' } : a,
                  ),
                }
              : d,
          );
          setNotice({
            title: nowStr('meeting.actions.taskCreated'),
            message: `TL-${r.issue.issueNumber} ${r.issue.title}`,
          });
          void fetchList('');
        } else if (r?.error === 'already_linked') {
          setNotice({ title: nowStr('meeting.actions.taskCreated'), message: nowStr('meeting.actions.alreadyLinked') });
        } else {
          setNotice({
            title: nowStr('meeting.actions.createTask'),
            message: nowStr('meeting.actions.createFailed', { error: String(r?.error || '') }),
          });
        }
      } catch (e: any) {
        setNotice({
          title: nowStr('meeting.actions.createTask'),
          message: nowStr('meeting.actions.createFailed', { error: e?.message || 'network' }),
        });
      } finally {
        setBusy('');
      }
    },
    [lang, fetchList, nowStr],
  );

  const openTask = useCallback((issueId: string) => {
    // Same hand-off EmailPanel uses for a linked task.
    (window as any).__tl_pendingTaskSelect = { id: issueId };
    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'tasks' }));
  }, []);

  const setActionStatus = useCallback(async (item: ActionItem, status: 'open' | 'created' | 'dismissed') => {
    await api.meeting.setActionItemStatus(item.id, status).catch(() => {});
    setDetail((d) =>
      d ? { ...d, actionItems: d.actionItems.map((a) => (a.id === item.id ? { ...a, status } : a)) } : d,
    );
  }, []);

  const setDecisionStatus = useCallback(async (item: Decision, status: 'active' | 'dismissed' | 'superseded') => {
    await api.meeting.setDecisionStatus(item.id, status).catch(() => {});
    setDetail((d) => (d ? { ...d, decisions: d.decisions.map((x) => (x.id === item.id ? { ...x, status } : x)) } : d));
  }, []);

  const [followUpBusy, setFollowUpBusy] = useState(false);

  const regenerateFollowUp = useCallback(async () => {
    if (!selectedId) return;
    setFollowUpBusy(true);
    try {
      const r: any = await api.meeting.generateFollowUp(selectedId, true);
      if (r?.ok) {
        setDetail((d) =>
          d
            ? {
                ...d,
                meeting: {
                  ...d.meeting,
                  followUpSubject: r.subject,
                  followUpBody: r.body,
                  followUpStatus: 'ready',
                },
              }
            : d,
        );
      } else {
        setNotice({
          title: t('meeting.followup.title', lang),
          message: t('meeting.followup.failed', lang, { error: r?.error || 'error' }),
        });
      }
    } finally {
      setFollowUpBusy(false);
    }
  }, [selectedId, lang]);

  const dismissFollowUp = useCallback(async () => {
    if (!selectedId) return;
    await api.meeting.dismissFollowUp(selectedId).catch(() => {});
    setDetail((d) => (d ? { ...d, meeting: { ...d.meeting, followUpStatus: 'dismissed' } } : d));
  }, [selectedId]);

  // ─── Deletion ───
  const executeDelete = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    try {
      await api.meeting.delete(target.id);
      if (selectedId === target.id) {
        setSelectedId(null);
        setDetail(null);
      }
      void fetchList('');
    } catch (e: any) {
      setNotice({
        title: nowStr('meeting.delete.title'),
        message: nowStr('meeting.delete.failed', { error: e?.message || 'network' }),
      });
    }
  }, [deleteTarget, selectedId, fetchList, nowStr]);

  // ─── Model download (streamed over the synthetic 'model-download' channel) ───
  const [download, setDownload] = useState<any>(null);
  const startDownload = useCallback(async (name: string) => {
    setDownload({ name, percent: 0, received: 0, total: 0, error: '' });
    const es = new EventSource('/api/meeting/stream?meetingId=model-download');
    const close = () => {
      es.close();
      setDownload(null);
    };
    es.addEventListener('model:progress', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (d.name !== name) return;
      setDownload({ name, percent: d.percent ?? 0, received: d.received ?? 0, total: d.total ?? 0, error: '' });
    });
    es.addEventListener('model:done', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (d.name !== name) return;
      close();
      api.meeting
        .listModels()
        .then(setModelState)
        .catch(() => {});
    });
    es.addEventListener('model:error', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (d.name !== name) return;
      setDownload({ name, percent: 0, received: 0, total: 0, error: String(d.error || '') });
      es.close();
    });
    try {
      const r: any = await api.meeting.downloadModel(name);
      if (r && r.ok === false) {
        setDownload({ name, percent: 0, received: 0, total: 0, error: String(r.error || '') });
        es.close();
      }
    } catch (e: any) {
      setDownload({ name, percent: 0, received: 0, total: 0, error: e?.message || 'network' });
      es.close();
    }
  }, []);

  const cancelDownload = useCallback(async () => {
    await api.meeting.cancelDownload().catch(() => {});
    setDownload(null);
  }, []);

  const deleteModel = useCallback(async (name: string) => {
    await api.meeting.deleteModel(name).catch(() => {});
    api.meeting
      .listModels()
      .then(setModelState)
      .catch(() => {});
  }, []);

  const refreshModels = useCallback(() => {
    api.meeting
      .listModels()
      .then(setModelState)
      .catch(() => {});
    api.meeting
      .binStatus()
      .then(setBin)
      .catch(() => {});
  }, []);

  /**
   * Settings → Meetings, where models are downloaded and deleted.
   *
   * Without this the "no speech model" message is a dead end: the panel says
   * transcription is unavailable and offers nowhere to go. Same mechanism the
   * email and quota deep links use.
   */
  const openModelSettings = useCallback(() => {
    (window as any).__tl_settingsTab = 'meeting';
    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' }));
  }, []);

  // ─── Derived ───
  const meeting = detail?.meeting ?? null;
  // `active` is the list of models actually present on disk. null modelState
  // means "not loaded yet" — not "none installed", or the warning would flash
  // on every open before the first fetch lands.
  const noModel = !!modelState && (modelState.active?.length ?? 0) === 0;
  const visibleSegments = segHits ?? (detail ? detail.segments.slice(0, segmentLimit) : []);
  const canLoadMore = !segHits && !!detail && detail.totalSegments > visibleSegments.length;
  const openItems = (detail?.actionItems || []).filter((a) => a.status !== 'dismissed');
  const transcribing = meeting
    ? meeting.transcribeStatus === 'running' || meeting.transcribeStatus === 'queued'
    : false;
  const pct = transcribePct ?? (transcribing ? (meeting?.transcribeProgress ?? 0) : null);

  const runSegSearch = useCallback(
    async (q: string) => {
      setSegSearch(q);
      if (!selectedId) return;
      if (!q.trim()) {
        setSegHits(null);
        return;
      }
      const hits = await api.meeting.searchSegments(selectedId, q).catch(() => []);
      setSegHits(Array.isArray(hits) ? hits : []);
    },
    [selectedId],
  );

  return {
    lang,
    // library
    meetings,
    loading,
    search,
    setSearch,
    stats,
    fetchList,
    // detail
    selectedId,
    selectMeeting: (id: string | null) => {
      setSelectedId(id);
      setSegHits(null);
      setSegSearch('');
      setSegmentLimit(SEGMENT_PAGE);
      setJobError(null);
      setTranscribePct(null);
      setAiStage(null);
      setDetail(null);
    },
    detail,
    meeting,
    tab,
    setTab,
    segmentLimit,
    setSegmentLimit,
    canLoadMore,
    visibleSegments,
    segSearch,
    segHits,
    runSegSearch,
    openItems,
    transcribing,
    transcribePct: pct,
    aiStage,
    jobError,
    setJobError,
    fmtClock,
    fmtBytes,
    nowStr,
    // recorder
    recState,
    recordingId,
    levels,
    deadMs,
    degraded,
    recError,
    stopping,
    starting,
    requestStart,
    togglePause,
    stopRecording,
    captureSupported: captureSupported(),
    consentOpen,
    setConsentOpen,
    consentChecked,
    acceptConsent,
    // engine
    bin,
    modelState,
    noModel,
    openModelSettings,
    download,
    startDownload,
    cancelDownload,
    deleteModel,
    refreshModels,
    // ai
    estimate,
    estimating,
    confirmAi,
    setConfirmAi,
    busy,
    requestSummarize,
    runSummarize,
    confirmSummarize,
    // minutes
    saveMinutes,
    emailConfigured,
    sendOpen,
    setSendOpen,
    sendTo,
    setSendTo,
    sendCc,
    setSendCc,
    sendSubject,
    setSendSubject,
    sendAttach,
    setSendAttach,
    sending,
    openSend,
    sendMinutes,
    // action items
    createTask,
    openTask,
    setActionStatus,
    // decisions & follow-up
    setDecisionStatus,
    regenerateFollowUp,
    dismissFollowUp,
    followUpBusy,
    // delete
    deleteTarget,
    setDeleteTarget,
    executeDelete,
    // dialogs
    notice,
    setNotice,
    startTranscribe,
    cancelTranscribe,
  };
}

export type MeetingState = ReturnType<typeof useMeetingState>;
