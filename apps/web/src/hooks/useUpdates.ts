import { useState, useRef, useEffect } from 'react';
import { t } from '@/lib/i18n';
import { useLang } from '@/stores/LangContext';

// ═══ Update / OTA state: electron-updater listeners, download progress, timeout watchdog ═══
export function useUpdates({ onResult }: { onResult: (r: { ok: boolean; message: string }) => void }) {
  const lang = useLang();
  const langRef = useRef(lang);
  langRef.current = lang; // keep current lang for callback registered once
  const [updateAvailable, setUpdateAvailable] = useState<any>(() => {
    try { const saved = localStorage.getItem('tl-update'); if (!saved) return null; const parsed = JSON.parse(saved); if (parsed.downloaded) { parsed.downloaded = false; } /* Ignore stale cache: only show if stored version is actually newer than current */ if (parsed.version && __APP_VERSION__ && parsed.version <= __APP_VERSION__) { localStorage.removeItem('tl-update'); return null; } return parsed; } catch { return null; }
  });
  // Clean stale download state on startup (electron-updater staging does not survive restart)
  useEffect(() => { try { localStorage.removeItem('tl-update-dl'); localStorage.removeItem('tl-update-done'); localStorage.removeItem('tl-update-path'); } catch {} }, []);
  // Persist update state so it survives app restart
  useEffect(() => {
    if (updateAvailable) localStorage.setItem('tl-update', JSON.stringify(updateAvailable));
    else localStorage.removeItem('tl-update');
  }, [updateAvailable]);
  const updateAvailableRef = useRef<any>(null); // stable ref for callbacks that can't re-register
  useEffect(() => { updateAvailableRef.current = updateAvailable; }, [updateAvailable]);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateSeen, setUpdateSeen] = useState(false); // clear About red dot once user views it
  const [updateTimedOut, setUpdateTimedOut] = useState(false); // fallback: no progress for >30 min
  const [updateError, setUpdateError] = useState(''); // actual download error from electron-updater
  const [stopDownloadConfirm, setStopDownloadConfirm] = useState(false);
  // Dismiss update notification & sync AboutTab via event (so it stops showing stale "downloading")
  const dismissUpdateNotification = () => {
    try { localStorage.removeItem('tl-update-dl'); } catch {}
    setUpdateAvailable((prev: any) => prev ? { version: prev.version, dismissed: true, downloaded: prev.downloaded || false } : prev);
    window.dispatchEvent(new CustomEvent('tl-update-dismissed'));
  };
  const handleUpdateInstall = async (): Promise<any> => {
    const api = (window as any).electronAPI;
    if (!api?.installUpdate) return null;
    try {
      const r = await api.installUpdate();
      if (r && !r.ok) {
        setUpdateAvailable((prev: any) => prev ? { ...prev, downloaded: false } : prev);
        onResult({ ok: false, message: r.error || '' });
      }
      return r;
    } catch {
      return { ok: false, error: '' };
    }
  };
  const handleUpdateDownload = () => {
    const api = (window as any).electronAPI;
    if (api?.startDownload) {
      setUpdateTimedOut(false);
      setUpdateError('');
      api.startDownload();
      setUpdateProgress(0.1);
      try { localStorage.setItem('tl-update-dl', JSON.stringify({ active: true, startTime: Date.now(), progress: 0 })); } catch {}
    } else {
      window.open(updateAvailable?.downloadUrl || 'https://tomatovector.com/tomilite', '_blank');
    }
  };
  const handleOpenUpdateFolder = () => {
    const api = (window as any).electronAPI;
    if (api?.openFolder) api.openFolder(updateFilePath);
  };
  const [updateFilePath, setUpdateFilePath] = useState(() => {
    try { localStorage.removeItem('tl-update-path'); } catch {} return ''; // never survive restart
  });
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onUpdateAvailable) return; // browser dev mode — no electron
    api.onUpdateAvailable((info: any) => {
      setUpdateAvailable({ version: info.version, changelog: '', downloadUrl: '', publishedAt: info.releaseDate || '' });
      setUpdateSeen(false); // new update → show red dot again
      setUpdateTimedOut(false); // reset timeout
      setUpdateError(''); // clear any previous error
      try { localStorage.removeItem('tl-update-done'); } catch {} // clear stale completion flag
    });
    api.onUpdateNotAvailable(() => {
      setUpdateAvailable(null); // already on latest, clear stale localStorage state
    });
    // Listen for About tab re-download after user dismissed notification bar
    const onUndismissed = (e: Event) => {
      setUpdateAvailable((e as CustomEvent).detail);
      setUpdateProgress(0);
      setUpdateTimedOut(false);
    };
    window.addEventListener('tl-update-undismissed', onUndismissed);
    api.onDownloadProgress((p: any) => {
      const pct = p.percent || 0;
      setUpdateProgress(pct);
      setUpdateTimedOut(false); // progress = alive, reset timeout
      // Store download progress for About tab to read
      try { const d = JSON.parse(localStorage.getItem('tl-update-dl') || '{}'); localStorage.setItem('tl-update-dl', JSON.stringify({ ...d, progress: pct, lastProgress: Date.now() })); } catch {}
    });
    api.onUpdateError((msg: string) => {
      setUpdateError(msg || t('update.downloadFailed', langRef.current));
      setUpdateProgress(0);
      try { localStorage.removeItem('tl-update-dl'); } catch {}
    });
    api.onUpdateDownloaded((info: any) => {
      setUpdateProgress(100);
      setUpdateError(''); // clear any previous error
      const fp = info?.downloadedFile || info?.path || info?.installerPath || '';
      setUpdateFilePath(fp);
      try { if (fp) localStorage.setItem('tl-update-path', fp); } catch {}
      try { localStorage.removeItem('tl-update-dl'); } catch {} // clear stale progress for About tab
      try { const v = updateAvailableRef.current?.version; if (v) localStorage.setItem('tl-update-done', JSON.stringify({ version: v, time: Date.now() })); } catch {}
      setUpdateAvailable((prev: any) => prev ? { ...prev, downloaded: true } : prev);
    });
    return () => window.removeEventListener('tl-update-undismissed', onUndismissed);
  }, []);

  // Detect download timeout (>30 min with no progress events — fallback for hung downloads)
  useEffect(() => {
    const check = () => {
      try {
        const d = JSON.parse(localStorage.getItem('tl-update-dl') || '{}');
        const last = d?.lastProgress || d?.startTime || 0;
        if (d?.active && last && (Date.now() - last > 1800000)) {
          setUpdateTimedOut(true);
        }
      } catch {}
    };
    check();
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, []);

  return {
    updateAvailable, updateProgress, updateSeen, setUpdateSeen,
    updateTimedOut, updateError, stopDownloadConfirm, setStopDownloadConfirm,
    updateFilePath, dismissUpdateNotification,
    handleUpdateInstall, handleUpdateDownload, handleOpenUpdateFolder,
  };
}
