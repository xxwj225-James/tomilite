import { useState } from 'react';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { ConfirmDialog } from '@tomilite/shared-ui/components/ConfirmDialog';
import { t as tt2, tr } from '@/lib/i18n';
import { useLang } from '@/stores/useLang';

// ═══ Notes Editor View — title, category, MarkdownEditor, AI actions, save/delete ═══

interface Props {
  selected: any;
  setSelected: (v: any) => void;
  title: string;
  setTitle: (t: string) => void;
  content: string;
  setContent: (c: string) => void;
  category: string;
  setCategory: (c: string) => void;
  saving: boolean;
  noteEditedRef: any;
  handleSave: () => void;
  handleDelete: (id: string) => void;
  executeDelete: () => void;
  onNoteAction?: (a: string) => void;
  onEditingNote?: (n: any) => void;
  onNoteContent: (v: string) => void;
  onNoteTitle: (e: any) => void;
  onNoteCategory: (e: any) => void;
  deleteTarget: string | null;
  setDeleteTarget: (id: string | null) => void;
  deleting?: boolean;
  pendingBack: boolean;
  setPendingBack: (v: boolean) => void;
  saveError: string | null;
  setSaveError: (v: string | null) => void;
}

export function NotesEditor(p: Props) {
  const lang = useLang();
  const _t = (zh: string, ja: string, en: string) => tr(lang, zh, ja, en);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportResult, setExportResult] = useState('');

  const doExport = async (format: 'xlsx' | 'docx' | 'html' | 'md' | 'pdf' | 'pptx') => {
    if (!p.selected?.id) return;
    setShowExportDialog(false);
    // Markdown: save raw content directly (no API needed)
    if (format === 'md') {
      try {
        const mdContent = `# ${p.title || 'Untitled'}\n\n${p.content || ''}`;
        const fname = `${(p.title || 'note').replace(/[<>:"/\\|?*]/g, '_')}.md`;
        const savePath = await (window as any).electronAPI?.pickSaveFile(fname, [
          { name: 'Markdown', extensions: ['md'] },
        ]);
        if (!savePath) return;
        await (window as any).electronAPI?.saveFile(savePath, mdContent);
        setExportResult(tt2('export.success', lang).replace('{path}', savePath));
      } catch (e) {
        console.error('[Export] failed:', e);
      }
      return;
    }
    // PDF: server renders HTML → Electron main prints it via printPdf IPC
    if (format === 'pdf') {
      try {
        const resp = await fetch(
          `/api/wiki.exportNote?input=${encodeURIComponent(JSON.stringify({ noteId: p.selected.id, format: 'html' }))}`,
        );
        const d = await resp.json();
        const { html, filename } = d.result?.data || {};
        if (!html) return;
        const pdfName = (filename || 'note').replace(/\.html$/i, '') + '.pdf';
        const printRes = await (window as any).electronAPI?.printPdf(html, pdfName);
        if (!printRes?.ok) return;
        const savePath = await (window as any).electronAPI?.pickSaveFile(printRes.filename, [
          { name: 'PDF', extensions: ['pdf'] },
        ]);
        if (!savePath) return;
        await (window as any).electronAPI?.copyFile(savePath, printRes.filePath);
        setExportResult(tt2('export.success', lang).replace('{path}', savePath));
      } catch (e) {
        console.error('[Export] failed:', e);
      }
      return;
    }
    try {
      // wiki.exportNote is the real notes exporter (report.exportNote* does not exist)
      const resp = await fetch(
        `/api/wiki.exportNote?input=${encodeURIComponent(JSON.stringify({ noteId: p.selected.id, format }))}`,
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
    } catch (e) {
      console.error('[Export] failed:', e);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
            const dirty = p.noteEditedRef.current || (!p.selected?.id && (p.title.trim() || p.content.trim()));
            if (dirty) {
              (window as any).__tl_unsaved = 'notes';
              p.setPendingBack(true);
            } else {
              (window as any).__tl_unsaved = null;
              p.setSelected(null);
              p.setTitle('');
              p.setContent('');
              p.onEditingNote?.(null);
            }
          }}
        >
          {_t('← 返回', '← 戻る', '← Back')}
        </button>
        <span style={{ flex: 1 }} />
        <select
          className="form-select"
          style={{ width: 'auto', fontSize: 11 }}
          value={p.category}
          onChange={(e) => p.setCategory(e.target.value)}
        >
          <option value="general">{_t('通用', '一般', 'General')}</option>
          <option value="architecture">{_t('架构', 'アーキテクチャ', 'Architecture')}</option>
          <option value="api_docs">{_t('API 文档', 'API ドキュメント', 'API Docs')}</option>
          <option value="runbook">{_t('操作手册', 'ランブック', 'Runbook')}</option>
        </select>
        {p.onNoteAction && (
          <>
            <span style={{ width: 1, height: 16, background: 'var(--edge)', margin: '0 2px' }} />
            <button
              className="btn-ghost btn-xs"
              disabled={!p.content.trim()}
              style={{
                fontSize: 9,
                color: p.content.trim() ? 'var(--brand)' : 'var(--muted)',
                opacity: p.content.trim() ? 1 : 0.4,
                cursor: p.content.trim() ? 'pointer' : 'default',
                padding: '2px 6px',
              }}
              onClick={() => p.onNoteAction?.('polish')}
            >
              ✨ {_t('润色', '推敲', 'Pol')}
            </button>
            <button
              className="btn-ghost btn-xs"
              disabled={!p.content.trim()}
              style={{
                fontSize: 9,
                color: p.content.trim() ? 'var(--brand)' : 'var(--muted)',
                opacity: p.content.trim() ? 1 : 0.4,
                cursor: p.content.trim() ? 'pointer' : 'default',
                padding: '2px 6px',
              }}
              onClick={() => p.onNoteAction?.('translate')}
            >
              🌐 {_t('翻译', '翻訳', 'Tran')}
            </button>
            <button
              className="btn-ghost btn-xs"
              disabled={!p.content.trim()}
              style={{
                fontSize: 9,
                color: p.content.trim() ? 'var(--brand)' : 'var(--muted)',
                opacity: p.content.trim() ? 1 : 0.4,
                cursor: p.content.trim() ? 'pointer' : 'default',
                padding: '2px 6px',
              }}
              onClick={() => p.onNoteAction?.('summarize')}
            >
              📝 {_t('总结', '要約', 'Sum')}
            </button>
            <button
              className="btn-ghost btn-xs"
              disabled={!p.content.trim()}
              style={{
                fontSize: 9,
                color: p.content.trim() ? 'var(--brand)' : 'var(--muted)',
                opacity: p.content.trim() ? 1 : 0.4,
                cursor: p.content.trim() ? 'pointer' : 'default',
                padding: '2px 6px',
              }}
              onClick={() => p.onNoteAction?.('expand')}
            >
              📖 {_t('扩写', '拡張', 'Exp')}
            </button>
          </>
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
                  onClick={() => doExport('pdf')}
                >
                  {tt2('export.pdf', lang)}
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
                  onClick={() => doExport('md')}
                >
                  {tt2('export.markdown', lang)}
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
        <button className="btn btn-brand btn-xs" onClick={p.handleSave} disabled={p.saving || !p.title.trim()}>
          {p.saving ? (
            _t('保存中...', '保存中...', 'Saving...')
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
              {_t(' 保存', ' 保存', ' Save')}
            </span>
          )}
        </button>
        {p.selected?.id && (
          <button
            className="btn-ghost btn-xs"
            disabled={!!(p as any).deleting}
            style={{ color: (p as any).deleting ? 'var(--muted)' : 'var(--brand)' }}
            onClick={() => p.handleDelete(p.selected.id)}
          >
            {(p as any).deleting ? _t('删除中...', '削除中...', 'Deleting...') : _t('删除', '削除', 'Delete')}
          </button>
        )}
        {/* Export — same style as Save */}
        {p.selected?.id && (
          <button className="btn btn-brand btn-xs" onClick={() => setShowExportDialog(true)}>
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
      </div>
      <div style={{ padding: '10px 14px 0' }}>
        <div
          className="form-grp"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--edge)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px 14px',
          }}
        >
          <input
            className="form-input"
            style={{ fontWeight: 700, fontSize: 16 }}
            placeholder={_t('笔记标题', 'ノートタイトル', 'Note title')}
            value={p.title}
            onChange={p.onNoteTitle}
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
            value={p.content}
            onChange={p.onNoteContent}
            placeholder={_t(
              '写下你的笔记...（支持 Markdown）',
              'ノートを書く...（Markdown対応）',
              'Write your note... (Markdown supported)',
            )}
            height="100%"
          />
        </div>
      </div>
      <ConfirmDialog
        open={!!p.deleteTarget}
        title={_t('删除笔记', 'ノートを削除', 'Delete Note')}
        message={_t(
          '删除这条笔记？此操作无法撤销。',
          'このノートを削除しますか？元に戻せません。',
          'Delete this note? This action cannot be undone.',
        )}
        lang={lang}
        confirmLabel={_t('删除', '削除', 'Delete')}
        cancelLabel={_t('取消', 'キャンセル', 'Cancel')}
        onConfirm={p.executeDelete}
        onCancel={() => p.setDeleteTarget(null)}
      />
      <ConfirmDialog
        open={!!p.saveError}
        variant="alert"
        title={_t('保存失败', '保存失敗', 'Save Failed')}
        message={p.saveError || ''}
        lang={lang}
        onConfirm={() => p.setSaveError(null)}
        onCancel={() => p.setSaveError(null)}
      />
      <ConfirmDialog
        open={p.pendingBack}
        title={_t('未保存的更改', '未保存の変更', 'Unsaved Changes')}
        message={_t(
          '有未保存的内容。要保存后再退出吗？',
          '未保存の変更があります。保存してから退出しますか？',
          'You have unsaved changes. Save before leaving?',
        )}
        lang={lang}
        confirmLabel={
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
            {_t(' 保存', ' 保存', ' Save')}
          </span>
        }
        cancelLabel={_t('不保存', '破棄', 'Exit')}
        onConfirm={async () => {
          p.setPendingBack(false);
          try {
            await p.handleSave();
            (window as any).__tl_unsaved = null;
            p.setSelected(null);
            p.setTitle('');
            p.setContent('');
            p.onEditingNote?.(null);
          } catch {}
        }}
        onCancel={() => {
          p.setPendingBack(false);
          (window as any).__tl_unsaved = null;
          p.setSelected(null);
          p.setTitle('');
          p.setContent('');
          p.onEditingNote?.(null);
        }}
      />
    </div>
  );
}
