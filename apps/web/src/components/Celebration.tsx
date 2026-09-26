import { useEffect, useMemo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { t, type I18NKey } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { useCelebrationStore } from '@/stores/celebrationStore';
import { CELEBRATION_MS, type Milestone } from '@/lib/achievements';
import { prefersReducedMotion } from '@/lib/motion';

// ═══ Celebration — a confetti burst and one line ═══
//
// Shown when a milestone is crossed, at most once per milestone for the life of the
// install. The decision is `lib/achievements.ts` (pure) and the ledger is
// `stores/celebrationStore.ts`; this file only paints what the store hands it.
//
// No dependency and no canvas: 24 spans with different inline custom properties and one
// keyframe. A particle library would be a runtime and an animation loop in a bundle whose
// only animation today is a spinning refresh icon.

/**
 * The theme's own hues. Deliberately not a rainbow: `--red` is this app's failure colour
 * (`--red-soft` is the error tint) and a celebration in it would read as a warning, and
 * `--muted` is grey. Five is a vocabulary these four themes already speak in.
 */
const TOKENS = ['var(--brand)', 'var(--green)', 'var(--amber)', 'var(--purple)', 'var(--blue)'];

/** 24 reads as a burst on a normal window without becoming a particle system. The whole
 *  thing is 24 DOM nodes for about 1.8 seconds, then unmounted. */
const PIECES = 24;

function copyKey(m: Milestone): I18NKey {
  // The first task gets its own line because "{n} tasks done" renders as "1 tasks done".
  if (m.family === 'tasks') return m.rung === 0 ? 'celebrate.tasksFirst' : 'celebrate.tasks';
  if (m.family === 'notes') return 'celebrate.notes';
  return 'celebrate.excellent';
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

interface Piece {
  id: number;
  dx: number;
  dy: number;
  up: number;
  rot: number;
  delay: number;
  w: number;
  h: number;
  color: string;
}

function buildPieces(): Piece[] {
  return Array.from({ length: PIECES }, (_, i) => ({
    id: i,
    dx: rand(-160, 160),
    dy: rand(40, 160),
    up: rand(-110, -40),
    rot: rand(-540, 540),
    delay: rand(0, 140),
    w: rand(5, 8),
    h: rand(8, 14),
    // Assigned by position rather than by random draw: `Math.random()` on the colour alone
    // produces runs of one colour, and the five tokens are what make the burst look like it
    // belongs to the active theme instead of like a generic confetti asset.
    color: TOKENS[i % TOKENS.length],
  }));
}

function CelebrationLayer({ milestone, lang, reduced }: { milestone: Milestone; lang: string; reduced: boolean }) {
  // Built once per mount, and a mount is one celebration — the host keys this component on
  // the celebration's id, so a replacement is a new instance with a fresh random set rather
  // than the old one continuing mid-flight. `Math.random()` in render is impure; React 19's
  // StrictMode double-invoke in dev discards the second result, and there is no state here
  // for it to corrupt.
  const pieces = useMemo(buildPieces, []);

  return (
    <div className="celebration-layer" style={{ '--celebration-ms': `${CELEBRATION_MS}ms` } as CSSProperties}>
      {/* Skipped rather than shortened. The global `prefers-reduced-motion` block collapses
          every animation to 1ms, and both of these end on `opacity: 0` — so a "fast" version
          would draw nothing at all. The CSS says the same thing again for the pieces, which
          is the belt to this braces. */}
      {!reduced && (
        <div className="celebration-burst" aria-hidden="true">
          {pieces.map((p) => (
            <span
              key={p.id}
              className="celebration-piece"
              style={
                {
                  '--dx': `${p.dx}px`,
                  '--dy': `${p.dy}px`,
                  '--up': `${p.up}px`,
                  '--rot': `${p.rot}deg`,
                  '--delay': `${p.delay}ms`,
                  '--piece-color': p.color,
                  '--piece-w': `${p.w}px`,
                  '--piece-h': `${p.h}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      <div className="celebration-line" role="status">
        {t(copyKey(milestone), lang, { n: milestone.value })}
      </div>
    </div>
  );
}

/**
 * Mounted once, next to the other app-wide overlays. Renders nothing until a milestone
 * crosses, and nothing at all while the setting is off.
 */
export function CelebrationHost() {
  const lang = useLang();
  const enabled = useCelebrationStore((s) => s.enabled);
  const current = useCelebrationStore((s) => s.current);
  const advance = useCelebrationStore((s) => s.advance);
  const seq = current?.seq;

  // The deadline belongs to the milestone on screen, not to the feature: a second
  // celebration arriving mid-flight has to restart the clock, otherwise it inherits what is
  // left of the first one's and flashes for whatever remains.
  useEffect(() => {
    if (seq === undefined) return;
    const id = window.setTimeout(advance, CELEBRATION_MS);
    return () => window.clearTimeout(id);
  }, [seq, advance]);

  // `enabled` gates the paint, not the reading: the store still consumes rungs and drains
  // its queue while this is off, so nothing is waiting to surprise the user later.
  if (!enabled || !current) return null;

  return createPortal(
    <CelebrationLayer key={current.seq} milestone={current} lang={lang} reduced={prefersReducedMotion()} />,
    document.body,
  );
}
