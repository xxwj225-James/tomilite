// ═══ Anonymous usage telemetry client (opt-in only) ═══
//
// Renderer events (which panels were opened, which export formats were used)
// POST to the local backend route /api/telemetry/event. The backend decides
// consent again before buffering — the module-level flag here is just the
// first gate so we do no work at all when the user opted out.
//
// Nothing is sent for opted-out users; revoking consent in About flips this
// flag off immediately.

let consent = false;

export function setConsent(v: boolean) {
  consent = v;
}

export function isConsent() {
  return consent;
}

/** Fire-and-forget. name ≤ 64 chars; p is a small flat object (no content). */
export function track(name: string, p?: Record<string, unknown>) {
  if (!consent) return;
  if (typeof name !== 'string' || !name || name.length > 64) return;
  fetch('/api/telemetry/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, p: p ?? undefined }),
    keepalive: true,
  }).catch(() => {});
}
