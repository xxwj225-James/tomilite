import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import { Msg } from '@/components/chat/Msg';
import type { StagedEdit } from '@/types/chat';

// ═══ Message list — chat bubbles + thinking indicator ═══
export function MsgList({
  messages,
  thinking,
  agentStatus,
  pinnedText,
  onApply,
  onUndo,
  onPin,
  flashMsgId,
}: {
  messages: any[];
  thinking: boolean;
  agentStatus: string;
  pinnedText: string | null;
  onApply: (s: StagedEdit) => void;
  onUndo: (s: StagedEdit) => void;
  onPin: (t: string) => void;
  /** The message a search result pointed at, highlighted briefly after the jump. */
  flashMsgId?: string | null;
}) {
  const lang = useLang();
  return (
    <>
      {/* `internal` messages are the agent's record of what the user did — panel
          opens/closes, editor hand-offs. They belong in `history`, not on screen,
          so they are filtered here rather than dropped at the source. */}
      {messages
        .filter((m) => m != null && !(m as any).internal)
        .map((m, i) => {
          const pinnable = !!(m as any).pinnable || (m.role === 'assistant' && m.tool === 'greeting');
          const pinned = pinnable && !!pinnedText && pinnedText === m.text;
          return (
            <Msg
              // Deliberately the index, not `m.id`: optimistic and streaming messages
              // carry no id, so keying by it would produce duplicate `undefined` keys in
              // the list that re-renders most often in the app. The search deep link
              // locates a row with `data-msg-id` instead, which does not affect
              // reconciliation.
              key={i}
              msgId={(m as any).id}
              flash={!!(m as any).id && (m as any).id === flashMsgId}
              role={m.role}
              text={m.text}
              tool={m.tool}
              staged={m.staged}
              card={m.card}
              onApply={onApply}
              onUndo={onUndo}
              thinking={thinking}
              pinnable={pinnable}
              isPinned={pinned}
              onPin={onPin}
              reasoningContent={(m as any).reasoningContent}
            />
          );
        })}
      {thinking && (
        <div className="msg msg--assistant" style={{ marginBottom: 4 }}>
          <div
            className="msg-bubble msg-bubble--assistant"
            style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.7 }}
          >
            <span
              className="agent-spinner"
              style={{
                width: 14,
                height: 14,
                border: '2px solid var(--edge)',
                borderTopColor: 'var(--brand)',
                borderRadius: '50%',
                display: 'inline-block',
                animation: 'spin 0.6s linear infinite',
              }}
            />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', fontStyle: 'italic' }}>
              {agentStatus || t('chat.working', lang)}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
