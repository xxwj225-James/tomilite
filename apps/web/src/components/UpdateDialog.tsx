import { useState, useEffect } from 'react';

interface UpdateInfo {
  version: string;
  isNewer?: boolean;
  publishedAt?: string;
  changelog?: string;
  downloadUrl?: string;
}

export function useUpdateCheck() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [filePath, setFilePath] = useState('');

  useEffect(() => {
    const ea = (window as any).electronAPI;
    if (!ea) return;

    ea.onUpdateAvailable((info: any) => {
      setUpdate({
        version: info.version,
        publishedAt: info.releaseDate || '',
        changelog: info.releaseNotes || '',
        downloadUrl: info.downloadUrl || '',
      });
      setShowDialog(true);
      setDownloaded(false);
    });
    ea.onUpdateDownloaded((info: any) => {
      setDownloaded(true);
      setFilePath(info?.downloadedFile || '');
    });

    // Periodic re-check every 2 hours
    const check = () => { if (ea?.checkUpdate) ea.checkUpdate(); };
    const interval = setInterval(check, 7200_000);
    return () => clearInterval(interval);
  }, []);

  return { update, showDialog, openDialog: () => setShowDialog(true), closeDialog: () => setShowDialog(false), downloaded, filePath };
}

export function UpdateDialog({ update, open, onClose, downloaded, filePath }: {
  update: UpdateInfo | null;
  open: boolean;
  onClose: () => void;
  downloaded?: boolean;
  filePath?: string;
}) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const ea = (window as any).electronAPI;
    if (!ea) return;
    ea.onUpdateProgress((p: any) => {
      setProgress(`Downloading... ${p?.percent ? Math.round(p.percent) + '%' : ''}`);
    });
  }, []);

  if (!open || !update) return null;

  const handleDownload = () => {
    setInstalling(true);
    setProgress('Downloading...');
    setError('');
    const ea = (window as any).electronAPI;
    if (ea?.startDownload) {
      ea.startDownload();
    } else {
      window.open(update.downloadUrl, '_blank');
      setError('Download started in browser.');
      setInstalling(false);
    }
  };

  const handleInstall = () => {
    const ea = (window as any).electronAPI;
    if (ea?.installUpdate) {
      ea.installUpdate();
    }
  };

  const changelogHtml = update.changelog || 'No changelog available.';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="card w-full max-w-lg mx-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="card-hd flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold">{downloaded ? 'Update Ready 🚀' : 'Update Available 🚀'}</h2>
            <span className="text-xs text-ink-muted">v{update.version} · {update.publishedAt?.substring(0, 10)}</span>
          </div>
          <button className="btn-ghost btn-xs" onClick={onClose}>✕</button>
        </div>

        <div className="card-bd">
          <div className="text-sm leading-relaxed max-h-64 overflow-auto mb-4 prose prose-invert prose-sm"
            dangerouslySetInnerHTML={{ __html: changelogHtml }} />

          {error && <div className="text-xs text-red-400 mb-3 p-2 bg-red-500/10 rounded">{error}</div>}

          {progress && (
            <div className="text-xs text-brand-main mb-3 p-2 bg-brand-soft rounded">{progress}</div>
          )}

          {filePath && (
            <div className="text-xs text-ink-muted mb-3 p-2 bg-surface2 rounded break-all">📁 {filePath}</div>
          )}

          <div className="flex gap-2 justify-end">
            <button className="btn-secondary btn-xs" onClick={onClose}>
              {downloaded ? 'Later' : 'Later'}
            </button>
            {downloaded ? (
              <button className="btn-brand btn-xs" onClick={handleInstall}>
                Install & Restart
              </button>
            ) : (
              <button className="btn-brand btn-xs" onClick={handleDownload} disabled={installing}>
                {installing ? 'Downloading...' : 'Download & Install'}
              </button>
            )}
          </div>

          <p className="text-xs text-ink-muted mt-3">
            Current: v... → New: v{update.version}
          </p>
        </div>
      </div>
    </div>
  );
}
