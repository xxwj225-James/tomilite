import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { t } from '@/lib/i18n';
import { meetingElapsedSec } from '@/stores/meetingStore';
import type { MeetingState } from './useMeetingState';

// ═══ Recorder bar ═══
//
// Three things here are deliberate and shouldn't be "tidied up":
//
//  1. The timer is aria-live="polite"; the level meters are aria-hidden with a
//     role="meter" percentage. Without that split a screen reader announces
//     twenty times a second for the length of the meeting.
//  2. The meters carry a text label, not just a colour — colour alone would
//     make the recorder unusable for a colour-blind user.
//  3. The dead-stream banner is not dismissible. It is the one warning whose
//     whole value is that it is still on screen at minute 40.

/** -60dB floor → 0%, 0dB → 100%. A dB scale reads far better than linear
 *  amplitude for speech, which usually sits between -30 and -20dB. */
function meterPct(db: number): number {
  if (db <= -60) return 0;
  if (db >= 0) return 100;
  return Math.round(((db + 60) / 60) * 100);
}

function Meter({ label, db, tone }: { label: string; db: number; tone: string }) {
  const pct = meterPct(db);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: 'var(--muted)', width: 46, flexShrink: 0 }}>{label}</span>
      <div
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        style={{ flex: 1, height: 6, minWidth: 40, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: tone,
            borderRadius: 3,
            transition: 'width var(--transition-fast)',
          }}
        />
      </div>
    </div>
  );
}

const bannerStyle = (color: string): CSSProperties => ({
  marginTop: 8,
  padding: '6px 8px',
  fontSize: 10,
  lineHeight: 1.6,
  color,
  background: 'var(--surface2)',
  borderRadius: 6,
});

export function RecorderBar({ s }: { s: MeetingState }) {
  const lang = s.lang;
  const [source, setSource] = useState<'mic' | 'mic+system'>('mic+system');
  const [, setTick] = useState(0);
  const rec = s.recState;
  const recording = !!rec.meetingId;

  // One 1s timer drives the readout. Nothing here has sub-second precision, so
  // there is no reason to re-render faster than the display can change.
  const timerRef = useRef(0);
  useEffect(() => {
    if (!recording) return;
    timerRef.current = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timerRef.current);
  }, [recording]);

  const elapsed = meetingElapsedSec(rec);
  const clock = s.fmtClock(elapsed * 1000);

  const openMicSettings = () => {
    const ea = (window as any).electronAPI;
    if (ea?.openExternal) void ea.openExternal('ms-settings:privacy-microphone');
  };

  return (
    <div
      className="card"
      style={{ margin: '8px 8px 0', padding: 10, borderColor: recording ? 'var(--red)' : 'var(--edge)' }}
    >
      {/* ─── Status line ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {recording ? (
          <>
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: rec.paused ? 'var(--muted)' : 'var(--red)',
                flexShrink: 0,
              }}
            />
            <span aria-live="polite" style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>
              ● {rec.paused ? t('meeting.record.pause', lang) : t('meeting.status.recording', lang)}
            </span>
            <span style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 18, color: 'var(--ink)' }}>
              {clock}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
            {t('meeting.recorder.title', lang)}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {!recording && (
          <select
            className="form-select"
            value={source}
            onChange={(e) => setSource(e.target.value as 'mic' | 'mic+system')}
            style={{ fontSize: 11, maxWidth: 220 }}
            aria-label={t('meeting.settings.defaultSource', lang)}
          >
            <option value="mic+system">{t('meeting.source.both', lang)}</option>
            <option value="mic">{t('meeting.source.mic', lang)}</option>
          </select>
        )}

        {recording ? (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={s.togglePause}>
              {rec.paused ? t('meeting.record.resume', lang) : t('meeting.record.pause', lang)}
            </button>
            <button
              type="button"
              className="btn btn-brand btn-sm"
              onClick={() => void s.stopRecording()}
              disabled={s.stopping}
            >
              {s.stopping ? t('meeting.record.uploading', lang) : t('meeting.record.stopAndTranscribe', lang)}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-brand btn-sm"
            onClick={() => s.requestStart(source)}
            disabled={!s.captureSupported || s.starting}
          >
            {/* Starting capture takes seconds. Showing that here is what stops
                the user concluding the button is broken and pressing again. */}
            {s.starting ? t('meeting.record.starting', lang) : t('meeting.record.start', lang)}
          </button>
        )}
      </div>

      {/* ─── Meters ─── */}
      {recording && (
        <div
          aria-hidden="true"
          style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <div style={{ flex: 1, minWidth: 160 }}>
            <Meter label={t('meeting.level.mic', lang)} db={s.levels.mic} tone="var(--green)" />
          </div>
          {!s.degraded && (
            <div style={{ flex: 1, minWidth: 160 }}>
              <Meter label={t('meeting.level.system', lang)} db={s.levels.system} tone="var(--brand)" />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 160 }}>
            <Meter label={t('meeting.level.mix', lang)} db={s.levels.mix} tone="var(--muted)" />
          </div>
          {s.levels.clipping && (
            <span className="text-red" style={{ fontSize: 10, fontWeight: 600 }}>
              ! {t('meeting.record.clipping', lang)}
            </span>
          )}
        </div>
      )}

      {/* ─── Dead-stream banner (P0 — the whole point of the detector) ─── */}
      {recording && s.deadMs > 0 && (
        <div
          role="alert"
          style={{
            ...bannerStyle('var(--red)'),
            background: 'var(--red-soft)',
            border: '1px solid var(--red)',
          }}
        >
          {t('meeting.record.deadStream', lang, { sec: Math.round(s.deadMs / 1000) })}
        </div>
      )}

      {/* ─── Loopback unavailable: recording continues mic-only ─── */}
      {recording && s.degraded && <div style={bannerStyle('var(--amber)')}>{t('meeting.record.degraded', lang)}</div>}

      {s.recError && (
        <div role="alert" style={{ marginTop: 8, fontSize: 10, lineHeight: 1.6, color: 'var(--red)' }}>
          {s.recError}{' '}
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            style={{ marginLeft: 6 }}
            onClick={openMicSettings}
          >
            {t('meeting.record.openWindowsSettings', lang)}
          </button>
        </div>
      )}

      {!recording && (
        <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 6 }}>
          {t('meeting.record.hint', lang)}
        </p>
      )}
    </div>
  );
}
