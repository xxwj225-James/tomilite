import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { sanitizeHtml } from '@/lib/sanitize';
import { t, tr, type I18NKey } from '@/lib/i18n';
import { marked } from 'marked';
import { useLang } from '@/stores/LangContext';
import { useLanguageStore } from '@/stores/languageStore';
import type { StagedEdit, ChatCard } from '@/types/chat';

// Local i18n helpers — converted to keyed t() in the i18n refactor phase
function _t(key: string, lang: string) { return t(key as I18NKey, lang); }
function _l(zh: string, ja: string, en: string) {
  const lang = useLanguageStore.getState().lang;
  return lang === 'zh' ? zh : lang === 'ja' ? ja : en;
}

// ═══ Message bubble ═══
export function Msg({ role, text, tool, staged, card, onApply, onUndo, thinking, pinnable, onPin, isPinned, reasoningContent }: { role: 'user' | 'assistant'; text: string; tool?: string; staged?: StagedEdit; card?: ChatCard; onApply?: (s: StagedEdit) => void; onUndo?: (s: StagedEdit) => void; thinking?: boolean; pinnable?: boolean; onPin?: (t: string) => void; isPinned?: boolean; reasoningContent?: string }) {
  const lang = useLang();
  const thinkingRef = useRef<HTMLDivElement>(null);
  const safeText = typeof text === 'string' ? text : String(text || '...');
  const isMonitor = role === 'assistant' && safeText.startsWith('🔔');
  const isApiKeyHint = role === 'assistant' && /no api key|api key not|未配置.*key|api key.*配置/i.test(safeText);
  const [thinkingOpen, setThinkingOpen] = useState(!!thinking); // auto-expand while agent is thinking
  const hasR = !!(role === 'assistant' && reasoningContent);
  // Auto-scroll thinking panel to bottom as new content streams in
  useEffect(() => { if (thinkingOpen && thinkingRef.current) thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight; }, [reasoningContent, thinkingOpen]);
  return (
    <div className={cn('msg', role === 'user' ? 'msg--user' : 'msg--assistant')} style={isMonitor ? { marginBottom: 4 } : undefined}>
      {hasR && (
        <div style={{ width: '100%', marginBottom: 4 }}>
          <div
            onClick={() => setThinkingOpen(!thinkingOpen)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--amber)', background: 'var(--surface2)', border: '1px solid var(--edge)', fontWeight: 500, userSelect: 'none' }}
          >
            <span style={{ fontSize: 10, transition: 'transform .15s', transform: thinkingOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
            💭 {lang === 'zh' ? '思考过程' : lang === 'ja' ? '思考プロセス' : 'Thinking'}
          </div>
          {thinkingOpen && (
            <div ref={thinkingRef} style={{ marginTop: 4, padding: '8px 12px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--edge)', fontSize: 10, color: 'var(--muted)', whiteSpace: 'pre-line', wordBreak: 'break-word', lineHeight: 1.5, maxHeight: 300, overflow: 'auto', fontStyle: 'italic' }}>
              {reasoningContent}
            </div>
          )}
        </div>
      )}
      <div className={cn('msg-bubble', role === 'user' ? 'msg-bubble--user' : 'msg-bubble--assistant', role === 'assistant' && 'md-preview')}
        style={isMonitor ? { fontSize: 10, opacity: 0.55, fontStyle: 'italic', padding: '3px 10px', background: 'transparent', border: 'none', boxShadow: 'none' } : undefined}>
        {isApiKeyHint ? (
          <div>
            <span style={{ fontSize: 12, color: 'var(--amber)', lineHeight: 1.6 }}>⚠️ {safeText}</span>
            <br />
            <button className="btn btn-brand btn-xs" style={{ marginTop: 8 }} onClick={() => {
              (window as any).__tl_settingsTab = 'llm';
              window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'settings' }));
            }}>
              {_l('⚙️ 前往设置 LLM API Key →','⚙️ LLM APIキーを設定 →','⚙️ Configure LLM API Key →')}
            </button>
          </div>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: role === 'assistant' ? sanitizeHtml(marked.parse(safeText) as string) : sanitizeHtml(safeText.replace(/\n/g, '<br>')) }} />
        )}
        {tool && <span className="msg-tool">🔧 {tool}</span>}
        {card && card.disabled ? (
          <div style={{ margin: '8px 0', padding: 10, background: 'var(--surface2)', borderRadius: 8, border: '2px solid var(--edge)', fontSize: 12, maxWidth: 400, opacity: 0.55 }}>
            <span style={{ fontWeight: 700, fontSize: 10, color: 'var(--muted)' }}>{card.type === 'export_xlsx' || card.type === 'export_doc' ? card.title : (card.key || card.id?.substring(0, 8))}</span>
            <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(148,163,184,.1)', color: 'var(--muted)', marginLeft: 6 }}>🗑️ {tr(lang,'已删除','削除済み','Deleted')}</span>
            <div style={{ fontWeight: 500, marginTop: 4, color: 'var(--muted)', lineHeight: 1.3 }}>{card.title}</div>
          </div>
        ) : card && card.blocked ? (
          <div style={{ margin: '8px 0', padding: 10, background: 'var(--surface)', borderRadius: 8, border: `2px solid ${card.resolved ? 'var(--edge)' : 'var(--amber)'}`, fontSize: 12, maxWidth: 420, opacity: card.resolved ? 0.6 : 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: card.resolved ? 'var(--muted)' : 'var(--amber)', fontSize: 13 }}>⚠️ 发现 {card.duplicates?.length || 0} 个相似{_t(card.type === 'note' ? 'app.entityNote' : card.type === 'report' ? 'app.entityReport' : 'app.entityTask', lang) || (card.type === 'note' ? 'note' : card.type === 'report' ? 'report' : 'task')}{card.resolved ? tr(lang,' · 已处理',' · 処理済み',' · Resolved') : ''}</div>
            {card.duplicates?.slice(0, 8).map((d: any) => (
              <div key={d.key} style={{ display: 'flex', gap: 8, fontSize: 10, marginBottom: 2, color: 'var(--muted)' }}>
                <span style={{ fontWeight: 600, color: 'var(--brand)', minWidth: 50 }}>{d.key}</span>
                <span style={{ flex: 1 }}>{d.title}</span>
                <span style={{ color: d.status === 'done' ? 'var(--green)' : 'var(--muted)' }}>{d.status}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-xs" disabled={!!card.resolved || thinking} style={{ background: card.resolved ? 'var(--surface2)' : 'var(--amber)', color: card.resolved ? 'var(--muted)' : '#000', fontWeight: 700, padding: '5px 14px', opacity: thinking ? 0.5 : 1, cursor: card.resolved ? 'not-allowed' : 'pointer' }}
                onClick={() => { if (!thinking && !card.resolved) window.dispatchEvent(new CustomEvent('tl-force-create', { detail: card })); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ verticalAlign: 'middle', marginRight: 2 }}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>{tr(lang,'强行创建','強制作成','Force Create')}
              </button>
              <button className="btn btn-xs" disabled={!!card.resolved || thinking} style={{ background: 'var(--surface2)', color: card.resolved ? 'var(--muted)' : 'var(--ink)', border: '1px solid var(--edge)', padding: '5px 14px', opacity: thinking ? 0.5 : 1, cursor: card.resolved ? 'not-allowed' : 'pointer' }}
                onClick={() => { if (!thinking && !card.resolved) window.dispatchEvent(new CustomEvent('tl-cancel-dedup', { detail: card })); }}>
                {tr(lang,'取消','キャンセル','Cancel')}
              </button>
            </div>
          </div>
        ) : card && (
          <div style={{ margin: '8px 0', padding: 10, background: 'var(--surface)', borderRadius: 8, border: '2px solid var(--brand)', fontSize: 12, maxWidth: 400, cursor: 'default' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 10, color: 'var(--brand)' }}>{card.key || card.id?.substring(0, 8)}</span>
              {card.type === 'task' && card.issueType && card.issueType !== 'task' && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: card.issueType === 'bug' ? 'var(--red-soft)' : card.issueType === 'story' ? 'var(--brand-soft)' : 'rgba(148,163,184,.15)', color: card.issueType === 'bug' ? 'var(--red)' : card.issueType === 'story' ? 'var(--brand)' : 'var(--ink)', fontWeight: 500 }}>{card.issueType}</span>}
              {card.type === 'task' && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: card.status === 'done' ? 'rgba(34,197,94,.2)' : 'rgba(148,163,184,.15)', color: card.status === 'done' ? 'var(--green)' : 'var(--ink)', fontWeight: 500 }}>{card.status || 'todo'}</span>}
              {card.type === 'task' && card.priority && <span style={{ fontSize: 9, fontWeight: 600, color: card.priority === 'critical' ? 'var(--brand)' : card.priority === 'high' ? 'var(--amber)' : 'var(--muted)' }}>{card.priority}</span>}
              {card.type === 'note' && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(148,163,184,.15)', color: 'var(--ink)', fontWeight: 500 }}>{card.category || 'note'}</span>}
              {card.type === 'report' && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(148,163,184,.15)', color: 'var(--ink)', fontWeight: 500 }}>{card.reportType || 'report'}</span>}
            </div>
            <div style={{ fontWeight: 600, marginBottom: card.description ? 2 : 6, lineHeight: 1.3, color: 'var(--ink)' }}>{card.title}</div>
            {card.description && <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, lineHeight: 1.4, maxHeight: 48, overflow: 'hidden' }}>{card.description}...</div>}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {card.type === 'task' && <button className="btn btn-brand btn-xs" onClick={() => { window.dispatchEvent(new CustomEvent('tl-open-card', { detail: card })); }}>{tr(lang,'👁 查看','👁 表示','👁 View')}</button>}
              {card.type === 'report' && <button className="btn btn-brand btn-xs" onClick={() => { window.dispatchEvent(new CustomEvent('tl-open-card', { detail: card })); }}>{tr(lang,'👁 查看','👁 表示','👁 View')}</button>}
              {card.type === 'task' && <button className="btn btn-xs" style={{ background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--edge)' }} onClick={() => { window.dispatchEvent(new CustomEvent('tl-edit-card', { detail: card })); }}>{tr(lang,'✏️ 编辑','✏️ 編集','✏️ Edit')}</button>}
              {card.type === 'note' && <button className="btn btn-xs" style={{ background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--edge)' }} onClick={() => { window.dispatchEvent(new CustomEvent('tl-edit-card', { detail: card })); }}>{tr(lang,'✏️ 编辑','✏️ 編集','✏️ Edit')}</button>}
              <button className="btn-ghost btn-xs" style={{ color: 'var(--muted)' }} onClick={() => { window.dispatchEvent(new CustomEvent('tl-delete-card', { detail: card })); }}>{tr(lang,'🗑 删除','🗑 削除','🗑 Delete')}</button>
              {(card.type === 'export_xlsx' || card.type === 'export_doc') && (
                <button className="btn btn-brand btn-xs" onClick={async () => {
                  const api = (window as any).electronAPI;
                  if (!api?.pickSaveFile) { window.dispatchEvent(new CustomEvent('tl-save-result', { detail: { ok: false, message: tr(lang,'保存对话框不可用','保存ダイアログが利用できません','Save dialog not available') } })); return; }
                  const isXlsx = card.type === 'export_xlsx';
                  const ext = isXlsx ? 'xlsx' : 'docx';
                  const fp = await api.pickSaveFile(card.title, [{ name: isXlsx ? 'Excel' : 'Word', extensions: [ext] }]);
                  if (fp) {
                    try {
                      api.copyFile(fp, card.key!);
                      window.dispatchEvent(new CustomEvent('tl-save-result', { detail: { ok: true, message: tr(lang,`✅ 已保存 "${card.title}"`,`✅ 「${card.title}」を保存しました`,`✅ "${card.title}" saved`) } }));
                    } catch {
                      window.dispatchEvent(new CustomEvent('tl-save-result', { detail: { ok: false, message: tr(lang,`保存 "${card.title}" 失败`,`「${card.title}」の保存に失敗`,`Failed to save "${card.title}"`) } }));
                    }
                  }
                }}>📥 {tr(lang,'另存为','名前を付けて保存','Save As')}</button>
              )}
            </div>
          </div>
        )}
        {staged && (
          <div style={{ marginTop: 8 }}>
            {/* Diff display — show what changed (only when original available) */}
            {staged.original && staged.title !== staged.original.title && staged.title && (
              <div style={{ fontSize: 10, marginBottom: 2, lineHeight: 1.6, color: 'var(--ink)' }}>
                <span style={{ fontWeight: 600, color: 'var(--muted)', fontSize: 9 }}>{tr(lang,'标题','タイトル','Title')}: </span>
                <span style={{ textDecoration: 'line-through', color: 'var(--brand)', opacity: 0.7 }}>{staged.original.title?.substring(0, 60)}</span>
                <span style={{ margin: '0 4px', color: 'var(--muted)' }}>→</span>
                <span style={{ color: 'var(--green)', fontWeight: 500 }}>{staged.title?.substring(0, 60)}</span>
              </div>
            )}
            {staged.original && staged.status && staged.status !== staged.original.status && (
              <div style={{ fontSize: 10, marginBottom: 2 }}>
                <span style={{ fontWeight: 600, color: 'var(--muted)', fontSize: 9 }}>{tr(lang,'状态','ステータス','Status')}: </span>
                <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{staged.original.status}</span>
                <span style={{ margin: '0 4px', color: 'var(--muted)' }}>→</span>
                <span style={{ color: 'var(--brand)', fontWeight: 500 }}>{staged.status}</span>
              </div>
            )}
            {staged.original && staged.priority && staged.priority !== staged.original.priority && (
              <div style={{ fontSize: 10 }}>
                <span style={{ fontWeight: 600, color: 'var(--muted)', fontSize: 9 }}>{tr(lang,'优先级','優先度','Priority')}: </span>
                <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{staged.original.priority}</span>
                <span style={{ margin: '0 4px', color: 'var(--muted)' }}>→</span>
                <span style={{ color: 'var(--amber)', fontWeight: 500 }}>{staged.priority}</span>
              </div>
            )}
            {/* New content preview */}
            {staged.content && (
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontWeight: 600, color: 'var(--green)', fontSize: 9, marginBottom: 4 }}>
                  {tr(lang,'修改后内容','変更後の内容','Updated Content')}:
                </div>
                <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, lineHeight: 1.7, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(((staged as any)._full?.content || staged.content || '') as string) as string) }} />
              </div>
            )}
            {staged.original && staged.description !== staged.original.description && staged.description && (
              <div style={{ fontSize: 10, marginBottom: 2, color: 'var(--muted)' }}>
                {tr(lang,`描述已修改 (${staged.description?.length || 0} 字符)`,`説明変更済み (${staged.description?.length || 0} 文字)`,`Modified (${staged.description?.length || 0} chars)`)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              {onApply && (
                <button className="btn btn-brand btn-xs" onClick={() => onApply(staged)}>{t('btn.apply', lang)}</button>
              )}
              {staged.original && onUndo && (
                <button className="btn btn-secondary btn-xs" onClick={() => onUndo(staged)}>{t('btn.undo', lang)}</button>
              )}
            </div>
          </div>
        )}
        {pinnable && onPin && (
          <button className="btn btn-xs" style={{ marginTop: 6, fontSize: 10, background: isPinned ? 'var(--amber)' : 'var(--brand)', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', color: '#fff', fontWeight: 600 }}
            onClick={() => onPin(text)}>
            {isPinned ? (tr(lang,'📌 已置顶','📌 ピン留め中','📌 Pinned')) : (tr(lang,'📌 置顶','📌 ピン留め','📌 Pin to top'))}
          </button>
        )}
      </div>
    </div>
  );
}
