import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';
import { Msg } from '@/components/chat/Msg';
import type { StagedEdit } from '@/types/chat';

// ═══ Message list — chat bubbles + thinking indicator ═══
export function MsgList({ messages, thinking, agentStatus, pinnedText, onApply, onUndo, onPin }: {
  messages: any[];
  thinking: boolean;
  agentStatus: string;
  pinnedText: string | null;
  onApply: (s: StagedEdit) => void;
  onUndo: (s: StagedEdit) => void;
  onPin: (t: string) => void;
}) {
  const lang = useLang();
  return (
    <>
      {messages.filter(m => m != null).map((m, i) => { const pinnable = !!(m as any).pinnable || (m.role === 'assistant' && m.tool === 'greeting'); const pinned = pinnable && !!pinnedText && pinnedText === m.text; return <Msg key={i} role={m.role} text={m.text} tool={m.tool} staged={m.staged} card={m.card} onApply={onApply} onUndo={onUndo} thinking={thinking} pinnable={pinnable} isPinned={pinned} onPin={onPin} reasoningContent={(m as any).reasoningContent} />; })}
      {thinking && (
        <div className="msg msg--assistant" style={{ marginBottom: 4 }}>
          <div className="msg-bubble msg-bubble--assistant" style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.7 }}>
            <span className="agent-spinner" style={{ width: 14, height: 14, border: '2px solid var(--edge)', borderTopColor: 'var(--brand)', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite' }} />
            <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{agentStatus || t('chat.working', lang)}</span>
          </div>
        </div>
      )}
    </>
  );
}
