import { MarkdownEditor } from '@/components/MarkdownEditor';
import { sanitizeHtml } from '@/lib/sanitize';
import { tt } from '@/i18n/translations';
import { useLang } from '@/stores/useLang';

// ═══ Email Detail View — AI summary + reply draft + actions ═══

export function EmailDetail(p: Record<string, unknown>) {
  const get = (key: string): any => (p as Record<string, never>)[key];
  const t = get('t') as (k: string) => string;
  const lang = useLang();
  const _t = (k: string) => tt(lang, k);
  const email = get('selected') as any;

  const isDone = email?.status === 'done' || email?.isProcessed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--edge)', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-ghost btn-xs" onClick={() => {
          const dirty = !isDone && get('replyText') !== get('lastSavedDraftRef')?.current;
          if (dirty) { get('setPendingBack')(true); } else { get('setSelected')(null); }
        }}>{t('back')}</button>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t('emailDetail')}
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 14px 80px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Subject + From */}
        {isDone ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--ink)' }}>
              ✅ {email?.subject || '(no subject)'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {t('from')}{email?.fromAddr || '—'}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--ink)' }}>
              {email?.subject || '(no subject)'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {t('from')}{email?.fromAddr || '—'}
              {email?.date && <span style={{ marginLeft: 8 }}>{t('received')}: {(email.date || '').substring(5, 16)}</span>}
            </div>
          </div>
        )}

        {/* AI Summary */}
        {email?.summary && (
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>🤖 {t('summary')}</div>
            <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--ink)' }}>
              {email.summary}
            </div>
          </div>
        )}

        {/* Done state: show sent reply */}
        {isDone && email?.description?.includes('**已回复**:') && (
          <div style={{ background: 'color-mix(in srgb, var(--green) 8%, transparent)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--green)' }}>{t('replySent')}</div>
            <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--ink)' }}>
              {(email.description || '').match(/\*\*已回复\*\*:\n([\s\S]+)$/)?.[1]?.trim() || ''}
            </div>
          </div>
        )}

        {/* Draft generation loading */}
        {!isDone && get('draftGenerating') && (
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{t('genDrafting')}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{_t('emailPanel.escToCancel')}</div>
          </div>
        )}

        {/* Reply draft editor */}
        {!isDone && (get('replyText') || get('isReplying')) && !get('draftGenerating') && (
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12 }}>
            {/* To / CC / Subject fields */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', minWidth: 36, lineHeight: '26px' }}>{t('to')}</span>
                <input value={get('sendTo') as string || ''} onChange={e => get('setSendTo')(e.target.value)}
                  style={{ flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--edge)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', minWidth: 36, lineHeight: '26px' }}>CC</span>
                <input value={get('sendCC') as string || ''} onChange={e => get('setSendCC')(e.target.value)}
                  style={{ flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--edge)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', minWidth: 36, lineHeight: '26px' }}>{t('subject')}</span>
                <input value={get('sendSubject') as string || ''} onChange={e => get('setSendSubject')(e.target.value)}
                  style={{ flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--edge)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }} />
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>📝 {t('aiDraft')}</div>
            <MarkdownEditor
              value={get('replyText') as string}
              onChange={get('setReplyText') as (v: string) => void}
              placeholder={t('editDraft')}
              height="200px"
            />
          </div>
        )}

        {/* Full email body */}
        {get('emailLoading') && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{t('loading')}</div>
        )}
        {get('emailFullBody') && (
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, flex: '0 0 auto', minHeight: 200, maxHeight: '60vh', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--ink)', flexShrink: 0 }}>{t('original')}</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, flex: 1 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(get('emailFullBody') as string) }} />
          </div>
        )}

        {/* Actions */}
        {!isDone && (
          <div style={{ display: 'flex', gap: 8, marginTop: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {/* Generate draft button (cat 1/2, no draft yet) */}
            {(email?.category === 1 || email?.category === 2) && !get('draftGenerating') && !get('replyText') && !get('isReplying') && (
              <button className="btn btn-brand btn-sm" onClick={() => get('startDraftGeneration')()}>
                {t('genDraft')}
              </button>
            )}
            {/* Manual reply button (cat 3/4, no AI draft) */}
            {(email?.category === 3 || email?.category === 4) && !get('replyText') && !get('isReplying') && (
              <button className="btn btn-sm" style={{ background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--edge)' }} onClick={() => get('startManualReply')()}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  {_t('emailPanel.reply')}
                </span>
              </button>
            )}
            {/* Send */}
            {(get('replyText') || get('isReplying')) && (
              <button className="btn btn-brand btn-sm" onClick={() => get('handleSendReply')()} disabled={get('sending') as boolean}>
                {get('sending') ? t('sending') : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    {t('send')}
                  </span>
                )}
              </button>
            )}
            {/* Read Original / Hide Original toggle */}
            <button className="btn btn-sm" style={{ background: 'var(--surface2)', color: 'var(--ink)' }}
              onClick={() => get('emailFullBody') ? get('setEmailFullBody')(null) : get('handleReadFullEmail')()} disabled={get('emailLoading') as boolean}>
              {get('emailLoading') ? t('loading') : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {get('emailFullBody') ? (
                    <>{_t('emailPanel.hideOriginal')}</>
                  ) : (
                    <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
                    {t('readOrig')}</>
                  )}
                </span>
              )}
            </button>
            {/* Link/Unlink Task */}
            {get('linkedIssue') ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {_t('emailPanel.trackedAs')}:
                </span>
                <a onClick={(e) => { e.preventDefault(); get('openLinkedTask')(); }}
                  style={{ fontSize: 11, fontWeight: 600, color: 'var(--brand)', cursor: 'pointer', textDecoration: 'underline' }}>
                  TL-{get('linkedIssue').issueNumber} {get('linkedIssue').title}
                </a>
                <button className="btn btn-xs" style={{ background: 'var(--surface2)', color: 'var(--brand)', border: '1px solid var(--brand)', fontSize: 10, whiteSpace: 'nowrap' }}
                  onClick={() => get('setUnlinkConfirm')(true)}>
                  {_t('emailPanel.unlinkTask')}
                </button>
              </div>
            ) : (
              <button className="btn btn-sm" style={{ background: 'var(--surface2)', color: 'var(--purple)', border: '1px solid var(--purple)' }}
                onClick={() => get('handleLinkTask')()} disabled={get('linkingTask') as boolean}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {get('linkingTask') ? (
                    <>{_t('emailPanel.creatingTask')}</>
                  ) : (
                    <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    {_t('emailPanel.linkTask')}</>
                  )}
                </span>
              </button>
            )}
            {/* Dismiss */}
            <button className="btn btn-sm" style={{ background: 'var(--surface2)', color: 'var(--amber)', border: '1px solid var(--amber)' }}
              onClick={() => get('setDismissTarget')(email?.id)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                {t('dismiss')}
              </span>
            </button>
          </div>
        )}

        {/* Send error */}
        {get('sendError') && (
          <div style={{ fontSize: 11, color: 'var(--brand)', marginTop: 4 }}>{get('sendError') as string}</div>
        )}
      </div>
    </div>
  );
}
