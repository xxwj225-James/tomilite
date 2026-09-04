import { useState } from 'react';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { t as tt2, tr } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';
import { track as telTrack } from '@/lib/telemetry';

// ═══ Reports Editor View — top bar + content + send dialog ═══

export function ReportsEditor(p: Record<string, unknown>) {
  const lang = useLang();
  const t = (zh: string, ja: string, en: string) => tr(lang, zh, ja, en);
  const isSent = p.isSent as boolean;
  const reportType = p.reportType as string;
  const title = p.title as string;
  const content = p.content as string;
  const selected = p.selected as any;
  const saving = p.saving as boolean;
  const sending = p.sending as boolean;
  const sendMsg = p.sendMsg as string;
  const sendTo = p.sendTo as string;
  const sendCC = p.sendCC as string;
  const sendSubject = p.sendSubject as string;
  const sendBody = p.sendBody as string;
  const showSendDialog = p.showSendDialog as boolean;
  const sendAttachments = p.sendAttachments as File[];
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportResult, setExportResult] = useState('');

  const doExport = async (format: 'xlsx' | 'docx' | 'html' | 'pdf' | 'pptx') => {
    if (!selected?.id) return;
    setShowExportDialog(false);
    try {
      // PDF: server renders HTML → Electron main prints it via printPdf IPC
      if (format === 'pdf') {
        const resp = await fetch(
          `/api/report.exportHtml?input=${encodeURIComponent(JSON.stringify({ reportId: selected.id }))}`,
        );
        const d = await resp.json();
        const { html, filename } = d.result?.data || {};
        if (!html) return;
        const pdfName = (filename || 'report').replace(/\.html$/i, '') + '.pdf';
        const printRes = await (window as any).electronAPI?.printPdf(html, pdfName);
        if (!printRes?.ok) return;
        const savePath = await (window as any).electronAPI?.pickSaveFile(printRes.filename, [
          { name: 'PDF', extensions: ['pdf'] },
        ]);
        if (!savePath) return;
        await (window as any).electronAPI?.copyFile(savePath, printRes.filePath);
        setExportResult(tt2('export.success', lang).replace('{path}', savePath));
        telTrack('export.' + format);
        return;
      }
      const endpoint =
        format === 'xlsx'
          ? 'exportExcel'
          : format === 'docx'
            ? 'exportWord'
            : format === 'pptx'
              ? 'exportPpt'
              : 'exportHtml';
      const resp = await fetch(
        `/api/report.${endpoint}?input=${encodeURIComponent(JSON.stringify({ reportId: selected.id }))}`,
      );
      const d = await resp.json();
      if (!d.result?.data?.ok) return;
      const { filePath, filename } = d.result.data;
      const filterName =
        format === 'xlsx' ? 'Excel' : format === 'docx' ? 'Word' : format === 'pptx' ? 'PowerPoint' : 'HTML';
      const savePath = await (window as any).electronAPI?.pickSaveFile(filename, [
        { name: filterName, extensions: [format] },
      ]);
      if (!savePath) return;
      await (window as any).electronAPI?.copyFile(savePath, filePath);
      setExportResult(tt2('export.success', lang).replace('{path}', savePath));
      telTrack('export.' + format);
    } catch (e) {
      console.error('[Export] failed:', e);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top bar */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid var(--edge)',
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          flexWrap: 'wrap',
          background: 'linear-gradient(180deg, var(--surface), var(--surface2))',
        }}
      >
        <button
          className="btn-ghost btn-xs"
          onClick={() => {
            const dirty = (p.reportEditedRef as { current: boolean }).current || (!selected?.id && content.trim());
            if (dirty) {
              (window as unknown as Record<string, unknown>).__tl_unsaved = 'reports';
              (p.setReportPendBack as (v: boolean) => void)(true);
            } else {
              (window as unknown as Record<string, unknown>).__tl_unsaved = null;
              (p.setSelected as (v: null) => void)(null);
              (p.setTitle as (v: string) => void)('');
              (p.setContent as (v: string) => void)('');
              (p.setCurrentReportId as (v: null) => void)(null);
              (p.onEditingReport as ((r: null) => void) | undefined)?.(null);
            }
          }}
        >
          {t('← 返回', '← 戻る', '← Back')}
        </button>
        {!isSent && (
          <select
            className="form-select"
            style={{ width: 'auto' }}
            value={reportType}
            onChange={p.onReportType as (e: { target: { value: string } }) => void}
          >
            <option value="daily">{t('日报', '日報', 'Daily')}</option>
            <option value="weekly">{t('周报', '週報', 'Weekly')}</option>
            <option value="monthly">{t('月报', '月報', 'Monthly')}</option>
            <option value="sprint">{t('迭代', 'スプリント', 'Sprint')}</option>
            <option value="custom">{t('自定义', 'カスタム', 'Custom')}</option>
          </select>
        )}
        <span style={{ flex: 1 }} />
        {/* AI action buttons */}
        {!isSent && p.onReportAction && (
          <div style={{ display: 'flex', gap: 3 }}>
            {[
              { key: 'polish', icon: '✨', label: t('润色', 'ポリッシュ', 'Polish') },
              { key: 'summarize', icon: '📝', label: t('摘要', '要約', 'Summary') },
              { key: 'expand', icon: '📖', label: t('扩写', '拡張', 'Expand') },
              { key: 'translate', icon: '🌐', label: t('翻译', '翻訳', 'Translate') },
            ].map((a) => (
              <button
                key={a.key}
                className="btn btn-xs"
                style={{
                  background: 'var(--surface2)',
                  color: 'var(--ink)',
                  border: '1px solid var(--edge)',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                }}
                onClick={() => (p.onReportAction as (action: string) => void)(a.key)}
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>
        )}
        {/* Export dialog */}
        {showExportDialog && (
          <>
            <div
              className="menu-overlay"
              style={{ display: 'block', zIndex: 100 }}
              onClick={() => setShowExportDialog(false)}
            />
            <div
              style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%,-50%)',
                zIndex: 101,
                background: 'var(--surface)',
                borderRadius: 12,
                border: '1px solid var(--edge)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                padding: 24,
                minWidth: 280,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{tt2('export.title', lang)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                  onClick={() => doExport('xlsx')}
                >
                  {tt2('export.excel', lang)}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                  onClick={() => doExport('docx')}
                >
                  {tt2('export.word', lang)}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                  onClick={() => doExport('html')}
                >
                  {tt2('export.html', lang)}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                  onClick={() => doExport('pptx')}
                >
                  {tt2('export.ppt', lang)}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ justifyContent: 'center' }}
                  onClick={() => doExport('pdf')}
                >
                  {tt2('export.pdf', lang)}
                </button>
              </div>
              <button
                className="btn-ghost btn-xs"
                style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)' }}
                onClick={() => setShowExportDialog(false)}
              >
                {tt2('export.cancel', lang)}
              </button>
            </div>
          </>
        )}
        {/* Export result toast */}
        {exportResult && (
          <>
            <div
              className="menu-overlay"
              style={{ display: 'block', zIndex: 100 }}
              onClick={() => setExportResult('')}
            />
            <div
              style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%,-50%)',
                zIndex: 101,
                background: 'var(--surface)',
                borderRadius: 12,
                border: '1px solid var(--edge)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                padding: 24,
                minWidth: 320,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{exportResult}</div>
              <button className="btn btn-brand btn-sm" onClick={() => setExportResult('')}>
                {tt2('export.ok', lang)}
              </button>
            </div>
          </>
        )}
        {!isSent && (
          <button
            className="btn btn-brand btn-sm"
            onClick={p.handleSave as () => void}
            disabled={saving || (!content && !title.trim())}
          >
            {saving ? (
              t('保存中...', '保存中...', 'Saving...')
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                {t(' 保存', ' 保存', ' Save')}
              </span>
            )}
          </button>
        )}
        {!isSent && (
          <button
            className="btn btn-brand btn-sm"
            onClick={() => {
              const today = new Date().toISOString().substring(0, 10);
              const label = reportType === 'daily' ? 'Daily' : 'Weekly';
              const t = (title || label + ' Report ' + today).replace(/\d{4}-\d{2}-\d{2}/, today);
              (p.setSendSubject as (v: string) => void)('[TomiLite] ' + t);
              (p.setSendTo as (v: string) => void)('');
              (p.setSendCC as (v: string) => void)('');
              (p.setSendBody as (v: string) => void)(content || '');
              (p.setShowSendDialog as (v: boolean) => void)(true);
            }}
            disabled={!content && !title.trim()}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              {t(' 发送', ' 送信', ' Send')}
            </span>
          </button>
        )}
        {/* Export button — same style as Send */}
        {selected?.id && (
          <button className="btn btn-brand btn-sm" onClick={() => setShowExportDialog(true)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {tt2('export.title', lang)}
            </span>
          </button>
        )}
        {selected?.id && (
          <button
            className="btn-ghost btn-xs"
            disabled={!!(p as any).deleting}
            style={{ color: (p as any).deleting ? 'var(--muted)' : 'var(--brand)' }}
            onClick={() => (p.setDeleteTarget as (v: string) => void)(selected.id as string)}
          >
            {(p as any).deleting ? t('删除中...', '削除中...', 'Deleting...') : t('删除', '削除', 'Delete')}
          </button>
        )}
        {isSent && (
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>
            {t('📤 只读(已发送)', '📤 閲覧のみ(送信済み)', '📤 View-only (sent)')}
          </span>
        )}
      </div>
      {/* Sent warning */}
      {isSent && (
        <div style={{ fontSize: 10, color: 'var(--amber)', background: 'var(--surface2)', padding: '4px 14px' }}>
          ⚠️{' '}
          {t(
            '已发送的报告仅可查看，不能编辑。',
            '送信済みレポートは表示のみで編集できません。',
            'Sent report is view-only.',
          )}
        </div>
      )}
      <div style={{ padding: '10px 14px 0' }}>
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--edge)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 14px',
          }}
        >
          <input
            className="form-input"
            style={{ fontWeight: 700, fontSize: 15 }}
            placeholder={t('标题', 'タイトル', 'Title')}
            value={title}
            onChange={p.onReportTitle as (e: { target: { value: string } }) => void}
            readOnly={isSent}
          />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '10px 14px', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            background: 'var(--surface)',
            border: '1px solid var(--edge)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <MarkdownEditor
            value={content}
            onChange={p.onReportContent as (v: string) => void}
            placeholder={t('内容（Markdown）', '本文（Markdown）', 'Body (Markdown)')}
            readOnly={isSent}
            height="100%"
          />
        </div>
      </div>

      {/* Send Dialog */}
      {showSendDialog && (
        <>
          <div
            className="menu-overlay"
            style={{ display: 'block', zIndex: 100 }}
            onClick={() => (p.setShowSendDialog as (v: boolean) => void)(false)}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              zIndex: 101,
              width: 500,
              maxHeight: '80vh',
              background: 'var(--surface)',
              borderRadius: 12,
              border: '1px solid var(--edge)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="card-hd" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M22 4L13.5 11.5a2 2 0 01-2.27.07L11 11.5 2 4" />
                </svg>
                {t(' 发送报告', ' レポートを送信', ' Send Report')}
              </span>
              <button className="panel-close" onClick={() => (p.setShowSendDialog as (v: boolean) => void)(false)}>
                ✕
              </button>
            </div>
            <div
              style={{
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                overflow: 'auto',
                flex: 1,
                paddingBottom: 80,
              }}
            >
              <div className="form-grp">
                <label className="form-label">
                  {t('收件人（逗号分隔）', '宛先（カンマ区切り）', 'To (comma separated)')}
                </label>
                <textarea
                  className="form-textarea"
                  style={{ minHeight: 40, fontSize: 12 }}
                  value={sendTo}
                  onChange={(e) => (p.setSendTo as (v: string) => void)(e.target.value)}
                  placeholder="alice@example.com, bob@example.com"
                />
              </div>
              <div className="form-grp">
                <label className="form-label">{t('抄送（可选）', 'CC（任意）', 'CC (optional)')}</label>
                <textarea
                  className="form-textarea"
                  style={{ minHeight: 40, fontSize: 12 }}
                  value={sendCC}
                  onChange={(e) => (p.setSendCC as (v: string) => void)(e.target.value)}
                  placeholder="manager@example.com"
                />
              </div>
              <div className="form-grp">
                <label className="form-label">{t('主题', '件名', 'Subject')}</label>
                <input
                  className="form-input"
                  style={{ fontSize: 12 }}
                  value={sendSubject}
                  onChange={(e) => (p.setSendSubject as (v: string) => void)(e.target.value)}
                />
              </div>
              <div className="form-grp">
                <label className="form-label">{t('正文（可编辑）', '本文（編集可）', 'Body (editable)')}</label>
                <MarkdownEditor
                  value={sendBody}
                  onChange={(v) => (p.setSendBody as (v: string) => void)(v)}
                  height="200px"
                />
              </div>
              <div className="form-grp">
                <label className="form-label">{t('附件', '添付ファイル', 'Attachments')}</label>
                <input
                  type="file"
                  multiple
                  style={{ fontSize: 11 }}
                  onChange={(e) => (p.setSendAttachments as (v: File[]) => void)(Array.from(e.target.files || []))}
                />
                {sendAttachments.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    {sendAttachments.map((f) => f.name).join(', ')}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-sm"
                  style={{ background: 'var(--surface2)' }}
                  onClick={() => (p.setShowSendDialog as (v: boolean) => void)(false)}
                >
                  {t('取消', 'キャンセル', 'Cancel')}
                </button>
                <button
                  className="btn btn-brand btn-sm"
                  onClick={p.handleSendEmail as () => void}
                  disabled={sending || !sendTo.trim()}
                >
                  {sending ? (
                    sendMsg
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                      {t(' 发送', ' 送信', ' Send')}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
