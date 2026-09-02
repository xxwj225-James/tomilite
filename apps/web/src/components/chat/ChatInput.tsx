import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import type { RefObject } from 'react';

// ═══ Chat input row — attached file chips, upload, textarea, send/stop, hints ═══
export function ChatInput({
  query,
  setQuery,
  attachedFiles,
  onRemoveFile,
  onFiles,
  thinking,
  onSend,
  onStop,
  textareaRef,
  disabled,
}: {
  query: string;
  setQuery: (v: string) => void;
  attachedFiles: Array<{ name: string; size: number; content: string }>;
  onRemoveFile: (i: number) => void;
  onFiles: (files: FileList) => void;
  thinking: boolean;
  onSend: () => void;
  onStop: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
}) {
  const lang = useLang();
  return (
    <div className="chat-input-row">
      {attachedFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingBottom: 6 }}>
          {attachedFiles.map((f, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: 'var(--surface2)',
                border: '1px solid var(--edge)',
                borderRadius: 14,
                padding: '3px 10px',
                fontSize: 11,
                color: 'var(--ink)',
              }}
            >
              📎 {f.name}
              <button
                onClick={() => onRemoveFile(i)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: 13,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-input-inner">
        <div style={{ position: 'relative' }}>
          <button
            className="chat-plus-btn"
            onClick={() => {
              document.getElementById('file-upload')?.click();
            }}
            title={t('chat.uploadFile', lang)}
            style={{ position: 'relative' }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
        </div>
        <input
          id="file-upload"
          type="file"
          multiple
          hidden
          onChange={async (e) => {
            if (e.target.files) {
              await onFiles(e.target.files);
              e.target.value = '';
            }
          }}
        />
        <div className="chat-input-wrap">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder={t('chat.placeholder', lang)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (disabled) return;
                if (query.trim()) {
                  onSend();
                } else {
                  onSend();
                }
              }
              if (e.key === 'Escape' && thinking) {
                e.preventDefault();
                onStop();
              }
            }}
            rows={1}
          />
          {thinking ? (
            <button
              className="chat-send-btn chat-send-btn--stop"
              onClick={onStop}
              title={t('chat.sendToInterrupt', lang)}
              style={{ background: 'var(--brand)', border: 'none' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className={cn(
                'chat-send-btn',
                !disabled && query.trim() ? 'chat-send-btn--active' : 'chat-send-btn--idle',
              )}
              onClick={onSend}
              disabled={!query.trim() || disabled}
              title={t('chat.sendEnter', lang)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 10 4 15 9 20" />
                <path d="M20 4v7a4 4 0 01-4 4H4" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="chat-hint" style={{ padding: '4px 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {thinking ? (
          <span style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 500 }}>{t('chat.hintEsc', lang)}</span>
        ) : disabled ? (
          <span style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 500 }}>{t('chat.compressBusy', lang)}</span>
        ) : (
          <>
            <span
              style={{
                fontSize: 11,
                padding: '2px 10px',
                borderRadius: 10,
                background: 'var(--surface2)',
                color: 'var(--ink)',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                border: '1px solid var(--edge)',
              }}
            >
              Enter → {t('chat.send', lang)}
            </span>
            <span
              style={{
                fontSize: 11,
                padding: '2px 10px',
                borderRadius: 10,
                background: 'var(--surface2)',
                color: 'var(--ink)',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                border: '1px solid var(--edge)',
              }}
            >
              (Shift + Enter) → {t('chat.newLine', lang)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
