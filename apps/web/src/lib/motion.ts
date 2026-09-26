// ═══ Motion preference — the app's one read of it ═══
//
// There are two places that have to know: the note table-of-contents (because
// `scrollIntoView`'s `behavior` option is unreachable from CSS, so only JS can
// turn a smooth jump into an instant one) and the celebration overlay (because
// the particles are not degraded under reduced motion, they are gone — see the
// rule in `styles/index.css`). A third inline copy of the media query is how
// those two drift apart, so both call this.

/**
 * A function rather than a module constant: `matchMedia(...).matches` is a
 * snapshot, and a constant would be taken at import time and would not notice
 * the user changing the setting until the next app start. The cost is one media
 * query per call, and this is called once per celebration and once per
 * table-of-contents jump — never per frame.
 *
 * `?.` is deliberate: a runtime without `matchMedia` answers `undefined` (which
 * is falsy) rather than throwing during render.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
