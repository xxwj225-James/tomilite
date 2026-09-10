import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { meetingElapsedSec, useMeetingStore } from '@/stores/meetingStore';
import { useLang } from '@/stores/useLang';

// ═══ Global recording indicator ═══
//
// Rendered by the shell, not by the Meeting panel, so it stays on screen when
// the user switches to Tasks or Notes. An app that quietly records system audio
// with no visible indicator is indistinguishable from spyware — this is the
// one piece of the feature that must never depend on which panel is open.
//
// Deliberately not dismissible: a banner the user can close is a banner that is
// not there at minute 40 of the meeting.

function fmt(sec: number): string {
  const s = Math.floor(sec);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function MeetingIndicator({ onOpen }: { onOpen: () => void }) {
  const lang = useLang();
  const rec = useMeetingStore();
  const [, setTick] = useState(0);
  const active = !!rec.meetingId;

  useEffect(() => {
    if (!active) return;
    const iv = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(iv);
  }, [active]);

  if (!active) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        margin: '0 12px 8px',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11,
        textAlign: 'left',
        color: 'var(--red)',
        background: 'var(--red-soft)',
        border: '1px solid var(--red)',
        borderRadius: 8,
        cursor: 'pointer',
        width: 'calc(100% - 24px)',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', flexShrink: 0 }}
      />
      <span
        aria-live="polite"
        style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {t('meeting.indicator.recording', lang, { title: rec.title })}
      </span>
      <span style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{fmt(meetingElapsedSec(rec))}</span>
      <span style={{ textDecoration: 'underline' }}>{t('meeting.indicator.open', lang)}</span>
    </button>
  );
}
