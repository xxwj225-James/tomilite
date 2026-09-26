import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type SearchHit, type SearchKind, type SearchResponse } from '@/lib/api';
import { t, type I18NKey } from '@/lib/i18n';
import { ICONS } from '@/components/icons';
import { splitOnTerms } from '@/lib/highlight';
import { cn } from '@/lib/cn';
import { useLang } from '@/stores/LangContext';

// ═══ Global search — the Ctrl/⌘+K palette ═══
//
// One list, six kinds, ranked together by the server (lib/searchCore.ts). This component
// owns three things and nothing else: the debounce, the keyboard model, and the honest
// labelling of how each row was found.
//
// ─── Why the debounce is not optional ───
//
// Every keystroke is a round trip that runs an FTS query, up to six LIKE scans and a
// cosine pass over the note and report vectors. The meeting panel's own search fires on
// every key with no debounce; that was tolerable for one table and is not tolerable here.
// The counter alongside it is the part that is easy to forget: debouncing alone does not
// stop a slow early response from landing after a fast later one and overwriting it, so
// each request carries an increasing id and only the newest one is allowed to set state.
//
// ─── Why the vector path is not awaited ───
//
// The server reports `semantic: 'warming'` while the ONNX session is loading (11-13 s)
// and answers keyword-only. The footer says so rather than letting the user conclude
// that a note does not exist. Same reason each row carries its own `match`: a row that
// arrived only by meaning is labelled, because this repository has measured that there
// is no usable similarity threshold to filter them with — so they ARE sometimes wrong,
// and the user is the only one who can tell.
export function SearchPalette({
  open,
  onClose,
  onOpenHit,
}: {
  open: boolean;
  onClose: () => void;
  /** Deep-link into whatever panel holds this row. Owned by App — see the note there. */
  onOpenHit: (hit: SearchHit) => void;
}) {
  const lang = useLang();
  const [query, setQuery] = useState('');
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  /** Restored on close: without it, focus lands on <body> and the panel behind is dead
   *  to the keyboard until the user clicks something. */
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Monotonic request id — the debounce cannot order responses, this does. */
  const seqRef = useRef(0);

  const hits = res?.hits ?? [];
  // The list shrinks under the cursor as results change — e.g. from 20 rows to 3 while
  // the user is holding ArrowDown. Clamped on read rather than reset on write, so a
  // still-valid index is never thrown away.
  const safeActive = Math.min(active, Math.max(0, hits.length - 1));
  const activeHit = hits[safeActive];
  // Every row found only by meaning — the case the "no exact match" banner explains.
  const semanticOnly = hits.length > 0 && hits.every((h) => h.match === 'semantic');

  // ─── The open/close lifecycle ───
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    // Cleared on open rather than on close so a re-open never shows the previous
    // session's results for a frame.
    setQuery('');
    setRes(null);
    setFailed(false);
    setActive(0);
    // Two frames: the portal has to be in the DOM before focus can move into it.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Esc has to be handled here and nowhere else — but not because of this listener.
  // Two other features listen for Escape on `window` (useEmailState while a draft is
  // streaming, KnowledgeCard unconditionally). stopImmediatePropagation only orders
  // listeners on the SAME node, so a capture-phase listener here cannot suppress them.
  // The flag below is read by those two, and that is the whole mechanism.
  useEffect(() => {
    (window as unknown as { __tl_paletteOpen?: boolean }).__tl_paletteOpen = open;
    return () => {
      (window as unknown as { __tl_paletteOpen?: boolean }).__tl_paletteOpen = false;
    };
  }, [open]);

  // ─── The global shortcut ───
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // `metaKey` for macOS, `ctrlKey` elsewhere. The repo has no shortcut registry —
      // this is the first global one, so it registers its own listener.
      if ((e.ctrlKey || e.metaKey) && k === 'k') {
        // Chromium binds Ctrl+K in some contexts (and Electron inherits that), so the
        // default has to be stopped as well as the event consumed.
        e.preventDefault();
        if (open) onClose();
        else window.dispatchEvent(new CustomEvent('tl-open-search'));
        return;
      }
      // isComposing: never close on the Escape that dismisses an IME candidate window.
      if (e.key === 'Escape' && open && !e.isComposing) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const run = useCallback(async (q: string) => {
    const seq = ++seqRef.current;
    setLoading(true);
    setFailed(false);
    try {
      const r: SearchResponse = await api.search.query(q, 20);
      if (seq !== seqRef.current) return; // a newer keystroke already answered
      setRes(r);
      setActive(0);
    } catch {
      if (seq !== seqRef.current) return;
      setRes(null);
      setFailed(true);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  // ─── Debounced search ───
  useEffect(() => {
    if (!open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (q.length < 2) {
      // The same floor the server applies. Returning the empty state here rather than
      // asking keeps a one-character query from clearing the list for a round trip.
      seqRef.current++;
      setRes(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    timerRef.current = setTimeout(() => void run(q), 180);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, open, run]);

  // ─── The keyboard model ───
  const onListKey = (e: React.KeyboardEvent) => {
    if (hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); // else the caret jumps inside the input
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeHit) onOpenHit(activeHit);
    }
  };

  const kindIcon = useMemo(
    () => ({
      chat: ICONS.chat,
      note: ICONS.notes,
      task: ICONS.tasks,
      meeting: ICONS.meeting,
      email: ICONS.email,
      report: ICONS.reports,
    }) as Record<SearchKind, React.ReactNode>,
    [],
  );
  const kindLabel = (k: SearchKind) => t(`search.kind${k[0].toUpperCase()}${k.slice(1)}` as I18NKey, lang);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-overlay"
      // Top-aligned rather than centred, unlike the other six users of this class: a
      // result list grows downward, and a centred box would jump as it fills. Inline
      // because `.modal` is `max-width: 440px`, which is too narrow for a two-line row.
      style={{ alignItems: 'flex-start', paddingTop: '12vh' }}
      onClick={onClose}
    >
      <div
        className="modal search-palette"
        style={{ maxWidth: 640, minWidth: 420, width: '92vw', padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="search-input-row">
          <span className="search-input-icon" aria-hidden="true">
            {ICONS.search}
          </span>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            value={query}
            placeholder={t('search.placeholder', lang)}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onListKey}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="search-hit-list"
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span className="search-spinner">{t('search.searching', lang)}</span>}
        </div>

        <div className="search-results">
          {/* The banner sits outside the listbox: a listbox may only contain options,
              and a div in there is invalid ARIA that screen readers read as a row. */}
          {!failed && semanticOnly && res?.keywordHits === 0 && (
            <div className="search-banner">{t('search.noKeyword', lang)}</div>
          )}
          {failed ? (
            <div className="search-empty">{t('search.failed', lang)}</div>
          ) : query.trim().length < 2 ? (
            <div className="search-empty">{t('search.hint', lang)}</div>
          ) : hits.length === 0 ? (
            <div className="search-empty">
              {loading ? t('search.searching', lang) : t('empty.noResults', lang)}
            </div>
          ) : (
            <div id="search-hit-list" role="listbox">
              {hits.map((h, i) => (
                <div
                  key={`${h.kind}:${h.id}`}
                  role="option"
                  aria-selected={i === safeActive}
                  aria-label={kindLabel(h.kind)}
                  className={cn('search-hit', i === safeActive && 'search-hit--active')}
                  onMouseMove={() => setActive(i)}
                  onClick={() => onOpenHit(h)}
                >
                  <span className="search-hit-icon" aria-hidden="true">
                    {kindIcon[h.kind]}
                  </span>
                  <span className="search-hit-body">
                    <span className="search-hit-title">{h.title || h.snippet}</span>
                    {h.title && h.snippet && (
                      <span className="search-hit-snippet">
                        {/* Pieces, not HTML: a chat message or an email body is user
                            content and must never reach innerHTML. */}
                        {splitOnTerms(h.snippet, h.highlights).map((p, j) =>
                          p.hit ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>,
                        )}
                      </span>
                    )}
                  </span>
                  {h.match === 'semantic' && <span className="search-hit-badge">{t('search.semanticHit', lang)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="search-foot">
          <span>{t('search.footer', lang)}</span>
          <span>
            {hits.length > 0 && t('search.count', lang, { n: hits.length })}
            {res?.semantic === 'warming' && hits.length > 0 && ` · ${t('search.warming', lang)}`}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The sidebar's search button — styled as a search box, but it is a button that opens the
 * palette above. A real input here would have to duplicate the palette's debounce, its
 * request ordering and its keyboard model, and would then show its own results.
 */
export function SidebarSearchButton({ onOpen, lang }: { onOpen: () => void; lang: string }) {
  return (
    <button type="button" className="session-search-btn" onClick={onOpen}>
      <span className="session-search-icon" aria-hidden="true">
        {ICONS.search}
      </span>
      <span className="session-search-label">{t('search.open', lang)}</span>
      <kbd className="session-search-kbd">{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}

/** Read once at module load: `platform` is deprecated but remains the only synchronous
 *  check, and the hint is cosmetic — a wrong label costs nothing. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
