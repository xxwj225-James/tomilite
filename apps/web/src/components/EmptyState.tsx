import type { ReactNode } from 'react';

// ═══ EmptyState — what a panel says when it has nothing to show ═══
//
// Four panels had grown their own version of this screen differently: the
// meeting list had a title and a hint, the notes list had one localized
// sentence, and the task and email lists had a bare em-dash. None of them said
// what the panel was *for*, and only one offered a way out of the empty state.
//
// The shape here is not new — it is the one the email panel already had, which
// was the only complete one (icon, title, explanation, action): lifted out so
// the other four can share it instead of drifting again in four directions.
//
// Every call site passes localized strings from `@/lib/i18n`; nothing here
// builds a sentence.
export function EmptyState({
  icon,
  title,
  hint,
  actionLabel,
  onAction,
  children,
}: {
  /** Emoji. Sized here rather than by the caller so all five stay equal. */
  icon?: string;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Extra content under the action — a secondary link, a disclaimer. */
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        padding: 'var(--space-10) var(--space-5)',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
      }}
    >
      {icon && (
        // A glyph size, not a text tier — `--text-*` tops out at 24px and this
        // is deliberately the one large mark on an otherwise empty screen.
        <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 'var(--space-3)' }}>{icon}</div>
      )}
      <div
        style={{
          fontSize: 'var(--text-md)',
          fontWeight: 600,
          color: 'var(--ink)',
          marginBottom: hint ? 'var(--space-2)' : 0,
        }}
      >
        {title}
      </div>
      {hint && (
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--muted)',
            lineHeight: 1.6,
            // Capped: at panel widths a hint runs to 60+ characters per line and
            // stops reading as a sentence.
            maxWidth: 300,
          }}
        >
          {hint}
        </div>
      )}
      {actionLabel && onAction && (
        // `--space-4` above the button, but only when a hint preceded it —
        // otherwise the button floats away from the title it belongs to.
        <button
          type="button"
          className="btn btn-brand btn-sm"
          style={{ marginTop: hint ? 'var(--space-4)' : 'var(--space-3)' }}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
      {children}
    </div>
  );
}
