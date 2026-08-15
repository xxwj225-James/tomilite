/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConfirmDialog } from '@tomilite/shared-ui/components/ConfirmDialog';
import { useLang } from '@/stores/useLang';
import { useReportsState } from './useReportsState';
import { ReportsList } from './ReportsList';
import { ReportsEditor } from './ReportsEditor';

// ═══ Reports Panel — thin shell: hook → list | editor ═══

export function ReportsPanel({ onEditingReport, onReportAction, appliedReport, reportRefresh, active }: { onEditingReport?: (report: { title: string; content: string; id?: string } | null) => void; onReportAction?: (action: string) => void; appliedReport?: { title?: string; content?: string } | null; reportRefresh?: number; active?: boolean }) {
  const lang = useLang();
  const _t = (zh: string, ja: string, en: string) => lang === 'zh' ? zh : lang === 'ja' ? ja : en;
  const s = useReportsState(onEditingReport, appliedReport, reportRefresh, active);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {!s.editing ? <ReportsList {...s} /> : <ReportsEditor {...s} onReportAction={onReportAction} />}
      <ConfirmDialog open={!!s.sendResult} variant="alert" title={s.sendResult?.key === 'success' ? _t('成功','成功','Success') : _t('错误','エラー','Error')} message={s.sendResultMsg as string} lang={lang} onConfirm={() => s.setSendResult(null)} onCancel={() => s.setSendResult(null)} />
      <ConfirmDialog open={s.reportPendBack as boolean} title={_t('未保存的更改','未保存の変更','Unsaved Changes')} message={_t('要保存后退出吗？','保存してから退出しますか？','Save before leaving?')} lang={lang} confirmLabel={<span style={{display:'inline-flex',alignItems:'center',gap:3}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>{_t(' 保存',' 保存',' Save')}</span>} cancelLabel={_t('不保存','破棄','Exit')} onConfirm={async () => { (s.setReportPendBack as (v: boolean) => void)(false); await (s.handleSave as () => Promise<void>)(); (window as any).__tl_unsaved = null; (s.setSelected as (v: null) => void)(null); (s.setTitle as (v: string) => void)(''); (s.setContent as (v: string) => void)(''); (s.setCurrentReportId as (v: null) => void)(null); onEditingReport?.(null); }} onCancel={() => { (s.setReportPendBack as (v: boolean) => void)(false); (window as any).__tl_unsaved = null; (s.setSelected as (v: null) => void)(null); (s.setTitle as (v: string) => void)(''); (s.setContent as (v: string) => void)(''); (s.setCurrentReportId as (v: null) => void)(null); onEditingReport?.(null); }} />
      <ConfirmDialog
        open={!!s.unsavedTarget}
        variant="confirm"
        title={_t('未保存的更改','未保存の変更','Unsaved Changes')}
        message={_t('当前编辑内容将被清空，是否继续？请先保存编辑内容。','未保存の変更は失われます。続行しますか？','Unsaved changes will be lost. Continue?')}
        lang={lang}
        confirmLabel={_t('继续','続行','Continue')}
        cancelLabel={_t('取消','キャンセル','Cancel')}
        onConfirm={() => {
          const r = s.unsavedTarget as Record<string, unknown>;
          (s.setUnsavedTarget as (v: null) => void)(null);
          (window as any).__tl_unsaved = null;
          if (r && (r as any) !== '__back__') {
            (s.setSelected as (v: Record<string, unknown>) => void)(r); (s.setTitle as (v: string) => void)(r.title as string); (s.setContent as (v: string) => void)((r.content as string) || ''); (s.setReportType as (v: string) => void)((r.reportType as string) || 'daily');
            (s.setCurrentReportId as (v: string | null) => void)(r.status === 'draft' ? r.id as string : null);
          }
        }}
        onCancel={() => (s.setUnsavedTarget as (v: null) => void)(null)}
      />
      <ConfirmDialog
        open={!!s.deleteTarget}
        title={_t('删除报告','レポートを削除','Delete Report')}
        message={_t('确定要删除这份报告吗？此操作不可恢复。','このレポートを削除しますか？元に戻せません。','Delete this report? This action cannot be undone.')}
        lang={lang}
        confirmLabel={_t('删除','削除','Delete')}
        cancelLabel={_t('取消','キャンセル','Cancel')}
        onConfirm={s.executeDelete as () => void}
        onCancel={() => (s.setDeleteTarget as (v: null) => void)(null)}
      />
      <ConfirmDialog
        open={!!s.deletedNotify}
        variant="alert"
        title={_t('提示','通知','Notice')}
        message={s.deletedNotify as string}
        lang={lang}
        onConfirm={() => (s.setDeletedNotify as (v: null) => void)(null)}
        onCancel={() => (s.setDeletedNotify as (v: null) => void)(null)}
      />
    </div>
  );
}
