import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

// ═══ Links Review Dialog — dry-run, tick, then write ═══
//
// Two separate server calls, deliberately: `suggestLinks` reads and proposes, `applyLinks`
// writes the set that is ticked and never asks a model again. Re-deriving on apply would
// mean the proposals reviewed and the bytes written could differ, which is the one thing a
// confirmation step must not allow.
//
// Everything proposed starts ticked. The user already pressed Analyze and then this
// button; the risk worth guarding against is writing into the wrong notes, not writing at
// all, so the bulk path is one click and both directions have a select-all/clear.

type Suggestion = { targetId: string; targetTitle: string; reason: string };
type Batch = { noteId: string; title: string; suggestions: Suggestion[] };
type Skip = { noteId: string; title: string; why: string };

type Phase = 'idle' | 'loading' | 'ready' | 'applying' | 'done';

const key = (noteId: string, targetId: string) => `${noteId}\u0000${targetId}`;

const scroll: React.CSSProperties = { maxHeight: 320, overflowY: 'auto', paddingRight: 4 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 6, padding: '2px 0' };

export function LinksReviewDialog({
  open,
  lang,
  excludeIds,
  onClose,
  onApplied,
}: {
  open: boolean;
  lang: string;
  /** Notes the editor is holding. The server refuses them rather than let a later save
   *  from the editor clobber the link section this dialog just wrote. */
  excludeIds: string[];
  onClose: () => void;
  onApplied: (written: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [skipped, setSkipped] = useState<Skip[]>([]);
  const [unlinkable, setUnlinkable] = useState<Array<{ title: string; count: number }>>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [tokens, setTokens] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [force, setForce] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ written: number; unchanged: number; reasons: string[] } | null>(null);

  // A fresh dialog each time it opens. Setters are stable, so `open` is the whole
  // dependency list.
  useEffect(() => {
    if (!open) return;
    setPhase('idle');
    setBatches([]);
    setSkipped([]);
    setUnlinkable([]);
    setFailures([]);
    setTokens(0);
    setChecked(new Set());
    setNotice(null);
    setResult(null);
  }, [open]);

  // Only a batch that carries a proposal is worth a row: an empty suggestion list means
  // "nothing found for this note", which is not something the user can act on.
  const proposals = useMemo(() => batches.filter((b) => b.suggestions.length > 0), [batches]);
  const total = useMemo(() => proposals.reduce((n, b) => n + b.suggestions.length, 0), [proposals]);

  if (!open) return null;

  const busy = phase === 'loading' || phase === 'applying';
  const listVisible = (phase === 'ready' || phase === 'applying' || phase === 'done') && total > 0;

  const runAnalyze = async () => {
    setPhase('loading');
    setNotice(null);
    try {
      const res = await api.knowledge.suggestLinks(lang, excludeIds, force);
      if (!res.ok) {
        // The two reasons the server gives are both actionable: no notes to link, or no
        // model configured. Reported as what they are rather than as a generic failure.
        const why =
          res.reason === 'no-notes'
            ? t('kmap.needNotes', lang)
            : res.reason === 'no-llm'
              ? t('kmap.degraded.no-llm', lang)
              : res.reason || t('links.network', lang);
        setNotice(t('links.failed', lang, { why }));
        setPhase('idle');
        return;
      }
      const bs = res.batches ?? [];
      setBatches(bs);
      setSkipped(res.skipped ?? []);
      setUnlinkable(res.unlinkable ?? []);
      setFailures(res.failures ?? []);
      setTokens(res.tokens ?? 0);
      const next = new Set<string>();
      for (const b of bs) for (const s of b.suggestions) next.add(key(b.noteId, s.targetId));
      setChecked(next);
      setPhase('ready');
    } catch {
      setNotice(t('links.failed', lang, { why: t('links.network', lang) }));
      setPhase('idle');
    }
  };

  const toggleOne = (noteId: string, targetId: string) => {
    setChecked((prev) => {
      const n = new Set(prev);
      const k = key(noteId, targetId);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  const toggleBatch = (b: Batch) => {
    setChecked((prev) => {
      const n = new Set(prev);
      const all = b.suggestions.every((s) => n.has(key(b.noteId, s.targetId)));
      for (const s of b.suggestions) {
        if (all) n.delete(key(b.noteId, s.targetId));
        else n.add(key(b.noteId, s.targetId));
      }
      return n;
    });
  };
  const selectAll = () =>
    setChecked(new Set(proposals.flatMap((b) => b.suggestions.map((s) => key(b.noteId, s.targetId)))));

  const runApply = async () => {
    // Built from the tick set, not from `proposals`: the server writes exactly this and
    // nothing else. A note with no ticked target is left out entirely.
    const items = proposals
      .map((b) => ({
        noteId: b.noteId,
        targetIds: b.suggestions.filter((s) => checked.has(key(b.noteId, s.targetId))).map((s) => s.targetId),
      }))
      .filter((i) => i.targetIds.length);
    if (!items.length) return;

    setPhase('applying');
    setNotice(null);
    try {
      const res = await api.knowledge.applyLinks(lang, items, excludeIds);
      const written = res.written?.length ?? 0;
      setResult({
        written,
        unchanged: res.unchanged ?? 0,
        // Apply-time refusals, kept apart from the analyze-time skips above: they mean
        // "this tick could not be honoured", which is a different sentence.
        reasons: (res.skipped ?? []).map((s) => s.why),
      });
      setPhase('done');
      if (written) onApplied(written);
    } catch {
      setNotice(t('links.failed', lang, { why: t('links.network', lang) }));
      setPhase('ready');
    }
  };

  const reasonOf = (why: string) => {
    if (why === 'open-in-editor') return t('links.openInEditor', lang);
    if (why === 'note-missing') return t('links.missing', lang);
    return why;
  };
  const countBy = (why: string) => skipped.filter((s) => s.why === why).length;
  // `ambiguous-own-title` is *not* a skip: the server records it to mark a note whose title
  // cannot be a link target, and then analyzes the note anyway. Counting it as skipped told
  // the user 7 of their 39 notes were left out when all 39 were read — measured on the
  // reference corpus, where exactly those 7 shared one of 3 duplicated titles. The
  // `unlinkable` line below already names them, with counts.
  const otherSkips = skipped.filter(
    (s) => s.why !== 'open-in-editor' && s.why !== 'already-reviewed' && s.why !== 'ambiguous-own-title',
  ).length;

  return createPortal(
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" style={{ maxWidth: 620, minWidth: 480, width: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">{t('links.title', lang)}</div>

        <div className="modal-bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {phase === 'idle' && (
            <>
              <div>{t('links.lead', lang)}</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                {t('links.force', lang)}
              </label>
            </>
          )}

          {phase !== 'idle' && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              {t('links.total', lang, { n: String(proposals.length), m: String(total) })}
              {tokens ? ` · ${tokens} tokens` : ''}
            </div>
          )}

          {notice && <div style={{ color: 'var(--amber)' }}>{notice}</div>}

          {phase === 'ready' && total > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn-ghost btn-xs" onClick={selectAll}>
                {t('links.selectAll', lang)}
              </button>
              <button className="btn-ghost btn-xs" onClick={() => setChecked(new Set())}>
                {t('links.selectNone', lang)}
              </button>
            </div>
          )}

          {listVisible && (
            <div style={scroll}>
              {proposals.map((b) => (
                <div key={b.noteId} style={{ marginBottom: 10 }}>
                  <label style={{ ...rowStyle, fontWeight: 600, color: 'var(--ink)' }}>
                    <input
                      type="checkbox"
                      disabled={phase !== 'ready'}
                      checked={b.suggestions.every((s) => checked.has(key(b.noteId, s.targetId)))}
                      onChange={() => toggleBatch(b)}
                    />
                    {b.title}
                  </label>
                  {b.suggestions.map((s) => (
                    <label key={s.targetId} style={{ ...rowStyle, marginLeft: 18, color: 'var(--ink)' }}>
                      <input
                        type="checkbox"
                        disabled={phase !== 'ready'}
                        checked={checked.has(key(b.noteId, s.targetId))}
                        onChange={() => toggleOne(b.noteId, s.targetId)}
                      />
                      <span>
                        → {s.targetTitle}
                        {/* The reason is the model's own sentence, in the language it was
                            asked to answer in — shown verbatim, never re-worded here. */}
                        {s.reason && <span style={{ color: 'var(--muted)' }}> — {s.reason}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}

          {phase === 'ready' && total === 0 && !notice && <div>{t('links.none', lang)}</div>}

          {phase === 'done' && result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ color: 'var(--ink)' }}>{t('links.done', lang, { n: String(result.written) })}</div>
              {result.unchanged > 0 && <div>{t('links.doneUnchanged', lang, { n: String(result.unchanged) })}</div>}
              {result.reasons.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)' }}>
                  {[...new Set(result.reasons.map(reasonOf))].join(' · ')}
                </div>
              )}
            </div>
          )}

          {/* What the analysis left out, and why. Without this a run that skips most of
              the library reads as a run that found nothing. */}
          {phase !== 'idle' && skipped.length > 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              {countBy('open-in-editor') > 0 && (
                <div>{t('links.skippedOpen', lang, { n: String(countBy('open-in-editor')) })}</div>
              )}
              {countBy('already-reviewed') > 0 && (
                <div>{t('links.skippedReviewed', lang, { n: String(countBy('already-reviewed')) })}</div>
              )}
              {otherSkips > 0 && <div>{t('links.skippedOther', lang, { n: String(otherSkips) })}</div>}
            </div>
          )}

          {/* Titles carried by two notes can never be link targets — reported with the
              count so the user can go rename them and make those notes linkable. */}
          {unlinkable.length > 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--amber)' }}>
              {t('links.unlinkable', lang, {
                titles: unlinkable.map((u) => `${u.title} (${u.count})`).join(' · '),
              })}
            </div>
          )}

          {/* Batches the model failed or truncated on. Named, because "some notes were not
              analyzed" and "your notes are unrelated" look identical otherwise. */}
          {failures.length > 0 && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--amber)' }}>
              {t('links.partial', lang, { why: failures.join(', ') })}
            </div>
          )}
        </div>

        <div style={{ padding: '0 var(--space-5) var(--space-5)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-xs" onClick={onClose} disabled={busy}>
            {t('links.close', lang)}
          </button>
          {phase === 'idle' && (
            <button className="btn btn-brand btn-xs" onClick={runAnalyze}>
              {t('links.start', lang)}
            </button>
          )}
          {phase === 'loading' && (
            <button className="btn btn-brand btn-xs" disabled>
              {t('links.analyzing', lang)}
            </button>
          )}
          {phase === 'ready' && total > 0 && (
            <button className="btn btn-brand btn-xs" onClick={runApply} disabled={!checked.size}>
              {t('links.apply', lang, { n: String(checked.size) })}
            </button>
          )}
          {phase === 'applying' && (
            <button className="btn btn-brand btn-xs" disabled>
              {t('links.applying', lang)}
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
