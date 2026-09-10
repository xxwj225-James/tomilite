import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { t } from '@/lib/i18n';

// ═══ Note TOC — a 目次 generated from the note's markdown headings ═══
//
// One row per heading: a dot threaded onto a vertical line, and the heading's
// own text beside it. The dot column never moves and never indents, so the
// thread reads as a single line; depth is carried by the *label's* indent
// instead, which is what keeps a deeply nested note legible.
//
// There are two sources of truth here and they must not be confused:
//
//   · the *labels* come from the markdown (`content`), which is what React
//     re-renders on and what survives a save/reload;
//   · the *positions* come from the live editor DOM, because only ProseMirror
//     knows where a heading actually landed after paragraph wrapping, images and
//     table resizes.
//
// They are index-aligned. If they ever disagreed the rail would still be honest,
// because nothing here ever reads a position from the markdown — a dot whose
// element is missing is simply inert rather than pointing at the wrong place.

interface TocHeading {
  level: number;
  text: string;
}

/** Strip inline markup so the tooltip reads as prose, not as markdown source. */
function plainInline(s: string): string {
  return s
    .replace(/<[^>]+>/g, '') // the raw <span style> the colour marks serialise to
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/_([^_]*)_/g, '$1')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ATX headings outside fenced code, in document order.
 *
 * Fences matter: a `# comment` inside a bash block is not a heading, and
 * ProseMirror will not render one either — counting it would put the rail one
 * dot out of step with the document for the rest of the note.
 */
function extractHeadings(md: string): TocHeading[] {
  const out: TocHeading[] = [];
  // Not a boolean: a fence is closed only by a bare run of the *same* character
  // at least as long as the one that opened it. A note that documents markdown
  // (a ```` block containing ``` examples) would otherwise leave the fence toggled
  // the wrong way and report every heading after it wrongly.
  let fence: { ch: string; len: number } | null = null;
  for (const line of (md || '').split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (f) {
      if (!fence) fence = { ch: f[1][0], len: f[1].length };
      else if (f[1][0] === fence.ch && f[1].length >= fence.len && !f[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    // ` {0,3}` and the space before a closing run of #s are both what CommonMark
    // requires; without them a 4-space-indented `# x` (a code block) and a
    // heading titled `C#` would each be read wrongly.
    const m = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (!m) continue;
    const text = plainInline(m[2]);
    if (text) out.push({ level: m[1].length, text });
  }
  return out;
}

/** Label indent per level, in px. The dot column stays put; only this moves. */
const INDENT_PER_LEVEL = 9;

/** How wide the whole rail is. Wide enough for a readable label, narrow enough
 *  that the note body keeps the majority of the panel. */
const RAIL_WIDTH = 172;

export function NoteToc({
  content,
  containerRef,
  lang,
}: {
  content: string;
  /** The element that wraps the editor; the scroll root is found inside it. */
  containerRef: RefObject<HTMLElement | null>;
  lang: string;
}) {
  const headings = useMemo(() => extractHeadings(content), [content]);
  const [active, setActive] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);

  // Keep the current row inside the rail. `nearest` is what makes this safe to
  // run on every change: it does nothing unless the row is actually out of view,
  // so it never fights a user who has scrolled the rail themselves.
  useEffect(() => {
    const row = railRef.current?.firstElementChild?.children[active] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Queried fresh on every call rather than captured into state: subscribing and
  // unsubscribing the scroll listener on each keystroke would drop it for the
  // duration of every re-render, and the header list changes as the user types.
  const getHeaders = () => {
    const root = containerRef.current?.querySelector('[data-milkdown-root]');
    return root ? (Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[]) : null;
  };

  useEffect(() => {
    let root: HTMLElement | null = null;

    const onScroll = () => {
      const hdrs = getHeaders();
      if (!hdrs?.length) return;
      const box = root?.getBoundingClientRect();
      if (!box) return;
      // "Current" is the last heading that has crossed a reading line a third of
      // the way down the viewport. A heading counts as read when it reaches the
      // top edge, which is where the eye already is by the time it gets there.
      // Measured from rects, not offsetTop: the offsetParent chain here is not
      // ours to reason about.
      const line = box.top + box.height * 0.33;
      let idx = 0;
      for (let i = 0; i < hdrs.length; i++) {
        if (hdrs[i].getBoundingClientRect().top <= line) idx = i;
        else break;
      }
      setActive(idx);
    };

    // Milkdown builds its DOM after mount, so the first ticks have no scroll
    // container at all — poll rather than guess a delay, and keep polling,
    // because the interval also has to notice the layout shifts that follow an
    // image loading or a table resize.
    const iv = window.setInterval(() => {
      const next = (containerRef.current?.querySelector('[data-milkdown-root]') as HTMLElement | null) ?? null;
      if (next !== root) {
        root?.removeEventListener('scroll', onScroll);
        root = next;
        root?.addEventListener('scroll', onScroll, { passive: true });
      }
      onScroll();
    }, 400);
    return () => {
      window.clearInterval(iv);
      root?.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getHeaders reads through the ref each call
  }, [containerRef]);

  const jump = (i: number) => {
    const el = getHeaders()?.[i];
    if (!el) return;
    setActive(i); // answer the click now; the scroll handler will confirm it
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  };

  if (!headings.length) return null;

  // Indent from the shallowest heading present, not from h1 — a note written
  // entirely in h2/h3 should not start already indented.
  const baseLevel = Math.min(...headings.map((h) => h.level));

  return (
    <div
      ref={railRef}
      role="navigation"
      aria-label={t('notes.toc', lang)}
      style={{
        width: RAIL_WIDTH,
        flexShrink: 0,
        alignSelf: 'stretch',
        // A long note has more headings than the rail is tall. Scroll it rather
        // than shrink the rows below a clickable size.
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Centred by an auto margin on the child, not by justify-content on this
          one: a centred flex container cannot be scrolled back to its first
          item once the content overflows, which would strand the top of a long
          note's rail off-screen. */}
      <div
        style={{ display: 'flex', flexDirection: 'column', margin: 'auto 0', width: '100%', padding: '4px 8px 4px 0' }}
      >
        {headings.map((h, i) => {
          const on = i === active;
          return (
            <button
              key={`${i}:${h.text}`}
              type="button"
              className="toc-item"
              data-on={on ? '1' : undefined}
              title={h.text}
              aria-label={h.text}
              aria-current={on ? 'true' : undefined}
              onClick={() => jump(i)}
            >
              <span className="toc-mark" aria-hidden="true">
                {headings.length > 1 && (
                  <span
                    className="toc-line"
                    style={{ top: i === 0 ? '50%' : 0, bottom: i === headings.length - 1 ? '50%' : 0 }}
                  />
                )}
                <span className="toc-k" />
              </span>
              <span className="toc-label" style={{ paddingLeft: (h.level - baseLevel) * INDENT_PER_LEVEL }}>
                {h.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
