import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type DistillCandidates, type DistillKind, type DistillProposal } from '@/lib/api';
import { t, type I18NKey } from '@/lib/i18n';
import { formatDbDateTime } from '@/lib/dbTime';

// ═══ Harvest — free list, paid proposals, free write ═══
//
// Three server calls, in this order, and the order is the design:
//
//   1. `distillCandidates` — free. How many sources there are, and why the others are not
//      on offer. Run on open and again whenever the scope changes, so the number on screen
//      is the number the paid call will work from.
//   2. `suggestDistill` — spends. One model call per candidate, returning prose the user
//      has not seen yet. **Writes nothing.**
//   3. `applyDistill` — free. Writes exactly the text reviewed, never asking a model again.
//      Re-deriving here would let the set reviewed and the set written differ, which is the
//      one thing a confirmation step must not allow. Same split as `LinksReviewDialog`.
//
// The first call is the reason this dialog has three phases instead of two. Without it the
// first thing the feature does is charge for a decision the user was never shown — and the
// rest of this router holds to "reading is free; generating costs money" (`knowledge.ts`).
//
// Unlike the link dialog, an unticked row is still a *decision*: the server records it, so
// the next press does not re-ask. That is what the "re-harvest everything" box is for.

type Phase = 'idle' | 'listing' | 'listing-ready' | 'loading' | 'ready' | 'applying' | 'done';

/** Per-row edits. Keyed by `refId`, since a kind+refId pair is unique within one run. */
type Draft = { title: string; content: string };

const scroll: React.CSSProperties = { maxHeight: 340, overflowY: 'auto', paddingRight: 4 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 6, padding: '2px 0' };

const ALL_KINDS: DistillKind[] = ['task', 'report', 'meeting'];
/** The server's own default, offered rather than assumed. */
const SINCE_CHOICES: Array<number | null> = [30, 90, 365, null];

/** Reason codes → the line that explains them. A `Record` rather than a template-literal
 *  `t(\`distill.why.${why}\`)`, because `why` is the server's string and a key built from an
 *  arbitrary string is not a key the type system can check. */
const WHY_KEYS: Record<string, I18NKey> = {
  'open-in-editor': 'distill.why.open-in-editor',
  'no-material': 'distill.why.no-material',
  'nothing-durable': 'distill.why.nothing-durable',
  truncated: 'distill.why.truncated',
  parse: 'distill.why.parse',
  'llm-error': 'distill.why.llm-error',
  'source-missing': 'distill.why.source-missing',
  'note-changed': 'distill.why.note-changed',
};

export function DistillDialog({
  open,
  lang,
  excludeIds,
  onClose,
  onApplied,
}: {
  open: boolean;
  lang: string;
  /** Notes the editor is holding. The server refuses them rather than let a later save from
   *  the editor clobber the body this dialog just wrote. */
  excludeIds: string[];
  onClose: () => void;
  onApplied: (written: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [kinds, setKinds] = useState<DistillKind[]>(ALL_KINDS);
  const [sinceDays, setSinceDays] = useState<number | null>(90);
  const [force, setForce] = useState(false);
  const [list, setList] = useState<DistillCandidates | null>(null);
  const [proposals, setProposals] = useState<DistillProposal[]>([]);
  const [skipped, setSkipped] = useState<Array<{ label: string; why: string }>>([]);
  const [failures, setFailures] = useState<Array<{ label: string; why: string }>>([]);
  const [tokens, setTokens] = useState(0);
  const [deferred, setDeferred] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pausedUntil, setPausedUntil] = useState<string | null>(null);
  const [nothingDurable, setNothingDurable] = useState(false);
  const [result, setResult] = useState<{ written: number; unchanged: number; reasons: string[] } | null>(null);

  // A fresh dialog each time it opens. Setters are stable, so `open` is the whole
  // dependency list — same shape as `LinksReviewDialog`.
  useEffect(() => {
    if (!open) return;
    setPhase('idle');
    setKinds(ALL_KINDS);
    setSinceDays(90);
    setForce(false);
    setList(null);
    setProposals([]);
    setSkipped([]);
    setFailures([]);
    setTokens(0);
    setDeferred(0);
    setChecked(new Set());
    setDrafts({});
    setEditing(null);
    setNotice(null);
    setPausedUntil(null);
    setNothingDurable(false);
    setResult(null);
  }, [open]);

  const scope = { kinds, force, sinceDays };

  // The free pass. Runs whenever the scope changes *or* the dialog opens, so the count on
  // screen is always the count the paid button will be applied to. That is the whole reason
  // this is a separate server call rather than a line the paid one computes.
  const relist = useCallback(async () => {
    if (!open) return;
    setPhase('listing');
    setList(null);
    try {
      const res = await api.knowledge.distillCandidates(scope);
      setList(res);
      setPhase('listing-ready');
    } catch {
      setNotice(t('distill.failed', lang, { why: t('distill.network', lang) }));
      setPhase('idle');
    }
    // `scope` is rebuilt on every render; its three fields are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lang, kinds, force, sinceDays]);

  useEffect(() => {
    if (open && (phase === 'idle' || phase === 'listing-ready')) void relist();
    // Deliberately not depending on `phase`: including it would re-run the free call every
    // time the phase advances, which is a request loop for a value that did not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lang, kinds, force, sinceDays]);

  if (!open) return null;

  const busy = phase === 'listing' || phase === 'loading' || phase === 'applying';
  const candidates = list?.candidates ?? [];
  const countBy = (why: string) => (list?.excluded ?? []).filter((e) => e.why === why).length;

  const toggleKind = (k: DistillKind) => setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const draftOf = (p: DistillProposal): Draft => drafts[p.refId] ?? { title: p.title, content: p.content };

  const runSuggest = async () => {
    if (!kinds.length) {
      setNotice(t('distill.noSources', lang));
      return;
    }
    setPhase('loading');
    setNotice(null);
    setNothingDurable(false);
    setPausedUntil(null);
    try {
      const res = await api.knowledge.suggestDistill(scope, lang, excludeIds);
      if (!res.ok) {
        // Each reason needs a different action from the user, so they are not collapsed
        // into one "failed".
        if (res.reason === 'paused') {
          setPausedUntil(res.pausedUntil ?? '');
        } else if (res.reason === 'no-llm') {
          setNotice(t('distill.noLlm', lang));
        } else if (res.reason === 'no-sources') {
          setNotice(t('distill.none.everything', lang));
        } else {
          setNotice(t('distill.failed', lang, { why: res.reason || t('distill.network', lang) }));
        }
        setPhase('listing-ready');
        return;
      }
      setProposals(res.proposals ?? []);
      setSkipped(res.skipped ?? []);
      setFailures(res.failures ?? []);
      setTokens(res.tokens ?? 0);
      setDeferred(res.deferred ?? 0);
      // Everything proposed starts ticked, and the draft is the proposal's own text until
      // the user edits it. The risk worth guarding against is writing the *wrong* note, not
      // writing a note.
      setChecked(new Set((res.proposals ?? []).map((p) => p.refId)));
      setDrafts({});
      setEditing(null);
      setNothingDurable((res.proposals ?? []).length === 0 && (res.skipped ?? []).some((s) => s.why === 'nothing-durable'));
      // A run can pause *part way through* — the quota ran out on the fourth of twelve —
      // and those first four proposals are still worth showing. So the brake is reported
      // alongside them rather than as a failure that throws the partial work away.
      if (res.reason === 'paused') setPausedUntil(res.pausedUntil ?? '');
      setPhase('ready');
    } catch {
      setNotice(t('distill.failed', lang, { why: t('distill.network', lang) }));
      setPhase('listing-ready');
    }
  };

  const runApply = async () => {
    // Built from the tick set *and* the drafts: the server writes exactly this text and
    // nothing else. A row with no tick is left out entirely.
    const items = proposals
      .filter((p) => checked.has(p.refId))
      .map((p) => {
        const d = draftOf(p);
        return {
          kind: p.kind,
          refId: p.refId,
          title: d.title.trim() || p.label,
          content: d.content,
          watermark: p.watermark,
          existingUpdatedAt: p.existingUpdatedAt,
        };
      });
    if (!items.length) return;

    setPhase('applying');
    setNotice(null);
    try {
      const res = await api.knowledge.applyDistill(lang, items);
      const written = res.written?.length ?? 0;
      setResult({
        written,
        unchanged: res.unchanged ?? 0,
        // Apply-time refusals, kept apart from the model-time skips above: they mean "this
        // note could not be written", which is a different sentence.
        reasons: (res.skipped ?? []).map((s) => s.why),
      });
      setPhase('done');
      if (written) onApplied(written);
    } catch {
      setNotice(t('distill.failed', lang, { why: t('distill.network', lang) }));
      setPhase('ready');
    }
  };

  /** Machine code → sentence. A code this dialog has no line for is shown as itself rather
   *  than dropped: a reason the user cannot read still beats no reason at all. */
  const whyOf = (why: string) => {
    const key = WHY_KEYS[why];
    return key ? t(key, lang) : why;
  };

  const kindLabel = (k: DistillKind) => t(`distill.kind.${k}`, lang);

  return createPortal(
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" style={{ maxWidth: 680, minWidth: 520, width: '92vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">{t('distill.title', lang)}</div>

        <div className="modal-bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {phase === 'idle' && <div>{t('distill.lead', lang)}</div>}

          {/* The scope row stays visible in every phase before the write, because changing
              it re-runs the free listing — never the paid one. */}
          {(phase === 'idle' || phase === 'listing' || phase === 'listing-ready' || phase === 'loading') && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{t('distill.sources', lang)}</span>
                {ALL_KINDS.map((k) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleKind(k)} />
                    {kindLabel(k)}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{t('distill.sinceLabel', lang)}</span>
                <select
                  value={sinceDays === null ? 'all' : String(sinceDays)}
                  onChange={(e) => setSinceDays(e.target.value === 'all' ? null : Number(e.target.value))}
                >
                  {SINCE_CHOICES.map((d) => (
                    <option key={d ?? 'all'} value={d ?? 'all'}>
                      {d === null ? t('distill.sinceAll', lang) : t('distill.sinceDays', lang, { n: String(d) })}
                    </option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginLeft: 'auto' }}>
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                  {t('distill.force', lang)}
                </label>
              </div>
            </>
          )}

          {/* The number that must be read before the button that spends money. */}
          {phase === 'listing' && <div>{t('distill.running', lang)}</div>}

          {list && !busy && phase !== 'done' && (
            <div style={{ color: candidates.length ? 'var(--ink)' : 'var(--muted)' }}>
              {candidates.length
                ? t('distill.count', lang, { n: String(candidates.length) })
                : t('distill.none.everything', lang)}
            </div>
          )}

          {/* Five states that look the same on screen and need opposite responses. Each is
              a count plus a name, never a bare "no results". */}
          {list && !candidates.length && !busy && phase !== 'done' && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {countBy('no-material') > 0 && <div>{t('distill.none.noMaterial', lang, { n: String(countBy('no-material')) })}</div>}
              {countBy('not-done') > 0 && <div>{t('distill.none.notDone', lang, { n: String(countBy('not-done')) })}</div>}
              {countBy('no-decisions') > 0 && <div>{t('distill.none.noDecisions', lang, { n: String(countBy('no-decisions')) })}</div>}
              {countBy('out-of-scope') > 0 && <div>{t('distill.none.outOfScope', lang, { n: String(countBy('out-of-scope')) })}</div>}
              {countBy('already-reviewed') > 0 && (
                <>
                  <div>{t('distill.none.reviewed', lang, { n: String(countBy('already-reviewed')) })}</div>
                  {!force && <div>{t('distill.none.reviewedHint', lang)}</div>}
                </>
              )}
            </div>
          )}

          {notice && <div style={{ color: 'var(--amber)' }}>{notice}</div>}

          {pausedUntil && (
            <div style={{ color: 'var(--amber)' }}>
              {t('distill.paused', lang, { at: pausedUntil ? formatDbDateTime(pausedUntil) : '' })}
            </div>
          )}

          {phase === 'ready' && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              {t('distill.total', lang, { n: String(proposals.length), t: String(tokens) })}
            </div>
          )}

          {deferred > 0 && phase !== 'idle' && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              {t('distill.deferred', lang, { n: String(deferred) })}
            </div>
          )}

          {phase === 'ready' && proposals.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn-ghost btn-xs" onClick={() => setChecked(new Set(proposals.map((p) => p.refId)))}>
                {t('links.selectAll', lang)}
              </button>
              <button className="btn-ghost btn-xs" onClick={() => setChecked(new Set())}>
                {t('links.selectNone', lang)}
              </button>
            </div>
          )}

          {(phase === 'ready' || phase === 'applying' || phase === 'done') && proposals.length > 0 && (
            <div style={scroll}>
              {proposals.map((p) => {
                const d = draftOf(p);
                const isEditing = editing === p.refId;
                return (
                  <div key={p.refId} style={{ marginBottom: 12, borderBottom: '1px solid var(--edge)', paddingBottom: 8 }}>
                    <label style={{ ...rowStyle, fontWeight: 600, color: 'var(--ink)' }}>
                      <input
                        type="checkbox"
                        disabled={phase !== 'ready'}
                        checked={checked.has(p.refId)}
                        onChange={() =>
                          setChecked((prev) => {
                            const n = new Set(prev);
                            if (n.has(p.refId)) n.delete(p.refId);
                            else n.add(p.refId);
                            return n;
                          })
                        }
                      />
                      <span>{kindLabel(p.kind)}</span>
                    </label>
                    <div style={{ marginLeft: 18, fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>{p.label}</div>

                    {/* The note that this one rolls into. Said out loud because harvesting
                        the same source twice is a *merge*, and a user who expects a second
                        note would read the result as data loss. */}
                    {p.existingNoteId && (
                      <div style={{ marginLeft: 18, fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                        {t('distill.merges', lang, { title: p.label })}
                      </div>
                    )}

                    {/* Editable, and folded away by default. What a model writes about a
                        month of work is a first draft, not a decision — without this the
                        only available verdict is "discard the whole note". */}
                    {isEditing ? (
                      <div style={{ marginLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <input
                          className="input"
                          value={d.title}
                          placeholder={t('distill.titlePlaceholder', lang)}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [p.refId]: { ...d, title: e.target.value } }))}
                        />
                        <textarea
                          className="input"
                          rows={8}
                          maxLength={8000}
                          value={d.content}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [p.refId]: { ...d, content: e.target.value } }))}
                        />
                      </div>
                    ) : (
                      <div style={{ marginLeft: 18 }}>
                        <div style={{ fontWeight: 500 }}>{d.title}</div>
                        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--muted)', maxHeight: 120, overflow: 'hidden' }}>
                          {d.content.slice(0, 400)}
                          {d.content.length > 400 ? '…' : ''}
                        </div>
                      </div>
                    )}

                    {p.truncated && (
                      <div style={{ marginLeft: 18, fontSize: 'var(--text-xs)', color: 'var(--amber)' }}>
                        {t('distill.truncated', lang)}
                      </div>
                    )}

                    {phase === 'ready' && (
                      <button
                        className="btn-ghost btn-xs"
                        style={{ marginLeft: 18, marginTop: 2 }}
                        onClick={() => setEditing(isEditing ? null : p.refId)}
                      >
                        {t('distill.edit', lang)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {phase === 'ready' && !proposals.length && !notice && !pausedUntil && (
            <div>{nothingDurable ? t('distill.nothingDurable', lang) : t('links.none', lang)}</div>
          )}

          {phase === 'done' && result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ color: 'var(--ink)' }}>{t('distill.done', lang, { n: String(result.written) })}</div>
              {result.unchanged > 0 && <div>{t('distill.doneUnchanged', lang, { n: String(result.unchanged) })}</div>}
              {result.reasons.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)' }}>{[...new Set(result.reasons.map(whyOf))].join(' · ')}</div>
              )}
            </div>
          )}

          {/* What the run left out, and why. Named rather than counted: "the model found
              nothing durable" and "twelve calls failed" are the same silence otherwise. */}
          {skipped.length > 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              {t('distill.skippedCount', lang, { n: String(skipped.length) })} {[...new Set(skipped.map((s) => whyOf(s.why)))].join(' · ')}
            </div>
          )}

          {failures.length > 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--amber)' }}>
              {t('distill.partial', lang, { why: [...new Set(failures.map((f) => whyOf(f.why)))].join(', ') })}
            </div>
          )}
        </div>

        <div style={{ padding: '0 var(--space-5) var(--space-5)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-xs" onClick={onClose} disabled={phase === 'applying'}>
            {t('links.close', lang)}
          </button>
          {(phase === 'idle' || phase === 'listing-ready') && (
            <button className="btn btn-brand btn-xs" onClick={() => void runSuggest()} disabled={!candidates.length}>
              {candidates.length ? t('distill.start', lang) : t('distill.none.everything', lang)}
            </button>
          )}
          {(phase === 'listing' || phase === 'loading') && (
            <button className="btn btn-brand btn-xs" disabled>
              {t('distill.running', lang)}
            </button>
          )}
          {phase === 'ready' && (
            <button className="btn btn-brand btn-xs" onClick={() => void runApply()} disabled={!checked.size}>
              {t('distill.apply', lang, { n: String(checked.size) })}
            </button>
          )}
          {phase === 'applying' && (
            <button className="btn btn-brand btn-xs" disabled>
              {t('distill.applying', lang)}
            </button>
          )}
          {phase === 'done' && (
            <button className="btn btn-brand btn-xs" onClick={onClose}>
              {t('dialog.ok', lang)}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
