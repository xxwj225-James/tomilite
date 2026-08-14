import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';

// ═══ Update bar — download/install progress + actions ═══
export function UpdateBar({ updateAvailable, updateError, updateProgress, updateTimedOut, updateFilePath, onInstall, onDownload, onClose, onOpenFolder, onStopDownload, onResult }: {
  updateAvailable: any;
  updateError: string;
  updateProgress: number;
  updateTimedOut: boolean;
  updateFilePath: string;
  onInstall: () => Promise<any>;
  onDownload: () => void;
  onClose: () => void;
  onOpenFolder: () => void;
  onStopDownload: () => void;
  onResult: (r: { ok: boolean; message: string }) => void;
}) {
  const lang = useLang();
  if (!updateAvailable || updateAvailable.dismissed) return null;
  return (
    <div className="update-bar">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      {updateError ? (
        <span>❌ <strong>v{updateAvailable.version}</strong> {updateError}</span>
      ) : updateProgress > 0 && updateProgress < 100 ? (
        <span>⬇️ <strong>v{updateAvailable.version}</strong> {t('update.downloading', lang)}... {Math.round(updateProgress)}%</span>
      ) : updateAvailable.downloaded ? (
        <span>✅ <strong>v{updateAvailable.version}</strong> {t('update.downloadedInstall', lang)}</span>
      ) : updateTimedOut ? (
        <span>⚠️ <strong>v{updateAvailable.version}</strong> {t('update.timedOut', lang)}</span>
      ) : (
        <span>🚀 <strong>v{updateAvailable.version}</strong> {t('update.available', lang)}</span>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        {updateAvailable.downloaded ? (
          <button className="btn btn-brand btn-xs" onClick={async () => {
            const r = await onInstall();
            if (r && !r.ok) onResult({ ok: false, message: r.error ? t('update.installFailed', lang, { err: r.error }) : t('update.installLaunchFailed', lang) });
          }}>{t('update.installRestart', lang)}</button>
        ) : updateProgress > 0 ? null : (
          <button className="btn btn-brand btn-xs" onClick={onDownload}>{(updateError || updateTimedOut) ? t('update.retry', lang) : t('chat.download', lang)}</button>
        )}
        <button className="btn-ghost btn-xs" onClick={() => { if (updateProgress > 0 && updateProgress < 100) { onStopDownload(); } else { onClose(); } }}>✕</button>
      </div>
      </div>
      {updateFilePath && <div style={{ fontSize: 9, color: 'var(--blue)', wordBreak: 'break-all', cursor: 'pointer', textDecoration: 'underline' }} onClick={onOpenFolder}>📁 {updateFilePath}</div>}
      {updateProgress > 0 && updateProgress < 100 && (
        <div style={{ height: 3, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden', marginTop: 2 }}>
          <div style={{ width: `${Math.round(updateProgress)}%`, height: '100%', background: 'var(--brand)', borderRadius: 2, transition: 'width 0.3s ease' }} />
        </div>
      )}
    </div>
  );
}
