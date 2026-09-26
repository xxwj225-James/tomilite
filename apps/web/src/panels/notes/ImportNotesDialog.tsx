import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { api } from '@/lib/api';
import { IMPORT_ACCEPT, bucketOf } from '@/lib/import/buckets';
import { importPickedFiles, type ImportOutcome, type ImportProgress } from '@/lib/import/runImport';

// ═══ Bringing an existing library of notes in ═══
//
// This was half of the Settings → Import tab. It lives in the notes panel now because
// what it produces is notes: the person who wants it has this panel open, and Settings is
// where a user looks for configuration rather than for an action.
//
// Parsing and writing both happen here — see the note at the top of
// `lib/import/runImport.ts` for why the work happens in the renderer and not in the API.
// What that means for this component is that everything it shows is local state: there is
// no job id to poll, no status column, and nothing left running if it is closed.
//
// **One button, whatever the format.** There were four sections, each with its own hidden
// input and its own explanation of the same four facts — four buttons the user had to know
// the difference between before they could start, when the file's own name already says
// what it is. The extension now picks the importer (`lib/import/buckets.ts`), and the
// picker's filter is built from that same list, so what can be picked and what can be
// imported cannot come apart.
//
// **Picking and importing are two steps.** Picking used to start the run the moment the
// file dialog closed, which is the one order that makes a wrong pick unrecoverable: the
// selection is the last chance to see what is about to be parsed and written, and it was
// the one moment with nothing on screen. The pick now only stages — the files are listed,
// each one labelled with the importer its extension selects, and `import.confirm` starts the
// run. The file picker itself cannot be reopened on a staging mistake, so the list stays
// visible next to the summary when a run stops or fails and the same files can be sent
// again; already-imported notes are skipped, which makes that a resume rather than a
// duplicate.
//
// The dialog unmounts when closed rather than hiding (see `ImportNotesDialog`), so a
// second visit starts from a blank form and no summary left over from the previous run.

/** `routers/knowledge.ts` — past this the map is built from categories, not by the LLM. */
const MAX_NOTES_FOR_AI = 400;

const PROJECT = 'proj-default';

/** How many staged file names the listing spells out. The selection is shown to be read,
 *  not to be scrolled: past a handful of names the only question left is "how many", which
 *  the count above the list already answers. */
const LIST_CAP = 8;

/** Counts worth a line in the summary. Zero rows are omitted rather than shown as 0 —
 *  a wall of zeroes buries the two numbers that are not zero. */
const TALLY_ROWS: Array<[keyof ImportOutcome['tally'], string]> = [
  ['created', 'import.row.created'],
  ['updated', 'import.row.updated'],
  ['skipped', 'import.row.skipped'],
  ['images', 'import.row.images'],
  ['dropped', 'import.row.dropped'],
  ['attachments', 'import.row.attachments'],
  ['unreadable', 'import.row.unreadable'],
  ['empty', 'import.row.empty'],
];

export function ImportNotesDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  /** The notes list should refetch. Called only when an import actually wrote something. */
  onImported: () => void;
}) {
  // No hooks in this component on purpose: an early return is only safe in one that has
  // none. The body below wants a fresh mount on every open, which is exactly what this
  // gives it.
  if (!open) return null;
  return <NotesImportBody onClose={onClose} onImported={onImported} />;
}

function NotesImportBody({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const lang = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState('');
  const [library, setLibrary] = useState<number | null>(null);

  const refreshLibrary = () => {
    api.wiki
      .count(PROJECT)
      .then((r: any) => setLibrary(typeof r?.total === 'number' ? r.total : null))
      // A count that cannot be read is not worth an error state: it drives one warning
      // line and nothing else.
      .catch(() => setLibrary(null));
  };
  useEffect(refreshLibrary, []);

  const run = async (picked: File[]) => {
    if (!picked.length) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError('');
    setOutcome(null);
    setProgress(null);
    let wrote = false;
    try {
      const opts = {
        overwrite,
        // Empty means "no answer", not "a notebook called nothing" — the importer reads
        // an absent value as the fallback the path would have given.
        category: category.trim() || undefined,
        signal: ac.signal,
        onProgress: setProgress,
      };
      // One call, whatever was picked: the extension decides which importer each file
      // goes to, and `runImport` reports the whole pick as one run.
      const result = await importPickedFiles(PROJECT, picked, opts);
      setOutcome(result);
      wrote = result.tally.created + result.tally.updated > 0;
      // The staged list survives a failure and a stop, and only a run that reached the end
      // clears it. Both of the surviving cases are ones where the run did not do what it
      // was asked: the files are still the answer, and re-picking them by hand is the only
      // way back to it, because a file dialog cannot be reopened onto the same selection.
      if (!result.error && !result.cancelled) setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // `setBusy` and the library count are no-ops if the dialog was closed mid-import.
      // `onImported` is not: the panel behind it is still mounted and still showing the
      // list these rows belong to. It runs here rather than on the close path so that it
      // lands *after* `importFiles` has flushed its last batch.
      setBusy(false);
      abortRef.current = null;
      refreshLibrary();
      if (wrote) onImported();
    }
  };

  /** Stage the pick; `import.confirm` is what runs it. The input is cleared either way so that
   *  choosing the same files again still fires `change` — which is what a user does when a
   *  pick came out wrong. An empty selection means the dialog was cancelled, and that
   *  leaves whatever was staged before it untouched rather than wiping it. */
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length) setFiles(picked);
  };

  /** Closing mid-import stops it. What the API already wrote stays written, which is why
   *  the refresh in `run`'s `finally` is not conditional on still being open. */
  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  return createPortal(
    <div className="modal-overlay" onClick={busy ? undefined : handleClose}>
      <div
        className="modal"
        style={{
          maxWidth: 620,
          width: '90vw',
          maxHeight: '84vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-hd">{t('notes.import.title', lang)}</div>
        {/* `minHeight: 0` because a scrolling flex child will not shrink below its
            content without it, which is what turns `maxHeight` into a scrollbar. */}
        <div className="modal-bd" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <p className="text-ink-muted" style={{ fontSize: 11, lineHeight: 1.7, marginBottom: 'var(--space-4)' }}>
            {t('import.notesLead', lang)}
          </p>

          <Section title={t('import.filesTitle', lang)}>
            <p className="text-ink-muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
              {t('import.filesLead', lang)}
            </p>
            {/* One input for every format, and `accept` comes from the same list the
                bucketing does — so a file the picker filters for is a file some importer
                claims. `accept` is a filter on the dialog, not a guarantee: on Windows the
                listing can be switched to "All files", which is why the dispatcher counts
                what falls outside. */}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={IMPORT_ACCEPT}
              style={{ display: 'none' }}
              onChange={onPick}
            />
            <button
              className="btn btn-brand btn-sm"
              style={{ marginTop: 'var(--space-3)' }}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {t('import.chooseFiles', lang)}
            </button>
            <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 'var(--space-2)' }}>
              {t('import.confirmHint', lang)}
            </p>
            {/* What was picked, before it is parsed. The unsupported mark is the same
                answer the dispatcher gives (`bucketOf`), so a file the picker let through
                under "All files" is named here instead of disappearing into a count in the
                summary afterwards. */}
            {files.length > 0 && (
              <div
                style={{
                  marginTop: 'var(--space-3)',
                  background: 'var(--surface2)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-3)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                    {t('import.selected', lang, { n: files.length })}
                  </span>
                  <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => setFiles([])}>
                    {t('import.clear', lang)}
                  </button>
                </div>
                <ul
                  style={{
                    margin: 'var(--space-2) 0 0',
                    paddingLeft: 16,
                    fontSize: 10,
                    lineHeight: 1.8,
                    color: 'var(--muted)',
                    wordBreak: 'break-all',
                  }}
                >
                  {files.slice(0, LIST_CAP).map((f, i) => (
                    <li key={i}>
                      {f.name}
                      {bucketOf(f.name) === null && <span> — {t('import.unsupported', lang)}</span>}
                    </li>
                  ))}
                  {files.length > LIST_CAP && <li>{t('import.moreFiles', lang, { n: files.length - LIST_CAP })}</li>}
                </ul>
              </div>
            )}
            {/* The one cost of a file pick over a folder pick. Said here rather than
                discovered in the summary afterwards, and not softened: a note whose images
                went missing is a note that lost something. */}
            <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 'var(--space-3)' }}>
              {t('import.filesImages', lang)}
            </p>
            <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 'var(--space-2)' }}>
              {t('import.filesLimits', lang)}
            </p>
          </Section>

          <Section title={t('import.options', lang)}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: busy ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                checked={overwrite}
                disabled={busy}
                onChange={(e) => setOverwrite(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{t('import.overwrite', lang)}</span>
            </label>
            <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 'var(--space-2)' }}>
              {t('import.overwriteHint', lang)}
            </p>
            {/* The notebook used to come from the folder a note sat in. A file pick cannot
                see folders, so it is asked for here — for the whole batch at once, because
                one level of grouping is all a notebook ever was. It sits in Options rather
                than next to the button because it applies to one of the three formats, and
                its own hint says which. */}
            <div className="form-grp" style={{ marginTop: 'var(--space-4)' }}>
              <label className="form-label">{t('import.category', lang)}</label>
              <input
                className="form-input"
                value={category}
                disabled={busy}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 'var(--space-2)' }}>
              {t('import.categoryHint', lang)}
            </p>
          </Section>

          {busy && (
            <Section title={t('import.working', lang)}>
              <ProgressLine lang={lang} progress={progress} />
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 'var(--space-3)' }}
                onClick={() => abortRef.current?.abort()}
              >
                {t('import.stop', lang)}
              </button>
            </Section>
          )}

          {error && (
            <Section title={t('import.failed', lang)} danger>
              <p style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--ink)' }}>{error}</p>
            </Section>
          )}

          {outcome && !busy && <Summary lang={lang} outcome={outcome} />}

          <Section title={t('import.library', lang)}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
              {library === null ? t('import.libraryUnknown', lang) : t('import.libraryCount', lang, { n: library })}
            </p>
            {library !== null && library > MAX_NOTES_FOR_AI && (
              <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.7, marginTop: 'var(--space-2)' }}>
                {t('import.libraryWarn', lang, { max: MAX_NOTES_FOR_AI })}
              </p>
            )}
          </Section>
        </div>

        <div
          style={{
            padding: '0 var(--space-5) var(--space-5)',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          {/* Closing while it runs stops it — this is a note in case the label reads as
              "leave it going". The stop button above does the same thing and stays. */}
          {busy && (
            <span className="text-ink-muted" style={{ fontSize: 'var(--text-xs)' }}>
              {t('import.working', lang)}
            </span>
          )}
          <button className="btn btn-secondary btn-sm" onClick={handleClose}>
            {t('btn.close', lang)}
          </button>
          {/* The run starts here and nowhere else. Disabled with nothing staged, which is
              also what it reads as after a run that finished and cleared the list. */}
          <button
            className="btn btn-brand btn-sm"
            disabled={busy || !files.length}
            onClick={() => void run(files)}
          >
            {t('import.confirm', lang)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A heading and its block. The dialog itself is the frame, so the sections inside it
 *  are headings rather than `.card`s — a card in a modal draws two borders around one
 *  piece of content. */
function Section({ title, danger, children }: { title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          color: danger ? 'var(--red)' : 'var(--ink)',
          marginBottom: 'var(--space-2)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function ProgressLine({ lang, progress }: { lang: string; progress: ImportProgress | null }) {
  if (!progress) {
    return <p style={{ fontSize: 11, color: 'var(--muted)' }}>{t('import.starting', lang)}</p>;
  }
  const pct = progress.fileTotal ? Math.round((progress.files / progress.fileTotal) * 100) : 0;
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--ink)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {progress.label || t('import.starting', lang)}
      </div>
      <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: 'var(--brand)', transition: 'width .2s' }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
        {t('import.progress', lang, { done: progress.files, total: progress.fileTotal, n: progress.notes })}
      </div>
    </div>
  );
}

function Summary({ lang, outcome }: { lang: string; outcome: ImportOutcome }) {
  const rows = TALLY_ROWS.filter(([key]) => outcome.tally[key] > 0);
  return (
    <Section
      title={
        outcome.error
          ? t('import.failed', lang)
          : outcome.cancelled
            ? t('import.stopped', lang)
            : t('import.finished', lang)
      }
      danger={!!outcome.error}
    >
      {outcome.error && <p style={{ fontSize: 11, color: 'var(--ink)', marginBottom: 'var(--space-3)' }}>{outcome.error}</p>}
      {rows.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--muted)' }}>{t('import.nothing', lang)}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px var(--space-3)', fontSize: 11 }}>
          {rows.map(([key, label]) => (
            <Row key={key} label={t(label as any, lang)} value={outcome.tally[key]} />
          ))}
        </div>
      )}
      {outcome.warnings.length > 0 && (
        <>
          <p className="text-ink-muted" style={{ fontSize: 10, marginTop: 'var(--space-3)', marginBottom: 4 }}>
            {t('import.details', lang)}
          </p>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10, lineHeight: 1.8, color: 'var(--muted)', wordBreak: 'break-all' }}>
            {outcome.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </>
  );
}
