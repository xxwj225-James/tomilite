import { useState, useEffect } from 'react';
import { useLang } from '@/stores/useLang';
import { api } from '@/lib/api';
import { t as i18nT } from '@/lib/i18n';
import { setConsent as telSetConsent } from '@/lib/telemetry';

function stored(key: string, fallback?: any) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : (fallback ?? null);
  } catch {
    return fallback ?? null;
  }
}
function store(key: string, val: any) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}
function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function AboutTab() {
  const lang = useLang();
  const t = (zh: string, ja: string, en: string) => (lang === 'zh' ? zh : lang === 'ja' ? ja : en);
  const [updateInfo, setUpdateInfo] = useState<any>(() => stored('tl-update'));
  const [dlState, setDlState] = useState<any>(() => stored('tl-update-dl'));
  const [dlError, setDlError] = useState('');
  // ─── Anonymous usage statistics toggle (mirrors telemetry.consent) ───
  const [telOn, setTelOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    api.system
      .getConfig('telemetry.consent')
      .then((v: any) => {
        if (alive) setTelOn(v === 'yes');
      })
      .catch(() => {
        if (alive) setTelOn(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  const toggleTel = async (on: boolean) => {
    setTelOn(on);
    try {
      await api.system.setConfig({ key: 'telemetry.consent', value: on ? 'yes' : 'no' });
    } catch {}
    telSetConsent(on);
  };
  type StatusKey = 'up-to-date' | 'downloaded' | 'checking' | 'store-build' | 'desktop-only' | '';
  const [resultStatus, setResultStatus] = useState<StatusKey>(() => {
    const done = stored('tl-update-done');
    return done?.version && stored('tl-update')?.version === done.version ? 'downloaded' : '';
  });
  const resultText: Record<StatusKey, string> = {
    'up-to-date': t('✅ 已是最新版本', '✅ 最新バージョンです', '✅ You are up to date'),
    downloaded: t(
      '✅ 下载完成，点击顶部通知安装',
      '✅ ダウンロード完了 — 上部バナーからインストール',
      '✅ Downloaded — install from top banner',
    ),
    checking: t('⏳ 检测中...', '⏳ チェック中...', '⏳ Checking...'),
    'store-build': t('📦 请通过 Microsoft Store 更新', '📦 Microsoft Store で更新', '📦 Update via Microsoft Store'),
    'desktop-only': t('⚠️ 更新功能仅在桌面版可用。', '⚠️ デスクトップ版のみ対応', '⚠️ Desktop only.'),
    '': '',
  };
  // ─── Optional hosted-quota status line (trial remaining ¥ / Pro) ───
  const [hostedInfo, setHostedInfo] = useState<{ active: boolean; remaining?: number | null } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s: any = await api.hosted.status();
        if (!alive) return;
        if (!s?.active) {
          setHostedInfo({ active: false });
          return;
        }
        const u: any = await api.hosted.usage().catch(() => null);
        if (alive) setHostedInfo({ active: true, remaining: u?.data?.remainingCny ?? null });
      } catch {
        if (alive) setHostedInfo({ active: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Restore download state from localStorage on mount (survives tab switches)
  // Check if download completed while this tab was unmounted
  const dlDone = stored('tl-update-done');
  const downloadComplete = dlDone && dlDone.version === updateInfo?.version;
  const downloadCancelled = !!updateInfo?.dismissed; // user closed notification bar

  const dlTimeout =
    (dlState?.lastProgress || dlState?.startTime) && Date.now() - (dlState.lastProgress || dlState.startTime) > 1800000;
  const busy = downloadComplete || downloadCancelled || dlTimeout || dlError ? false : !!dlState?.active;
  const downloading = downloadComplete || downloadCancelled || dlTimeout || dlError ? false : dlState?.active;
  const dlProgress = downloadComplete ? 100 : dlState?.progress || 0;

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onUpdateAvailable) return;

    api.onUpdateAvailable((info: any) => {
      setUpdateInfo({ version: info.version });
      setResultStatus(''); // clear "Checking..." text
      store('tl-update', { version: info.version });
      remove('tl-update-dl');
      remove('tl-update-done');
      remove('tl-update-seen');
      setDlError('');
    });
    api.onUpdateError?.((msg: string) => {
      setDlError(msg || t('下载失败，请重试', 'ダウンロード失敗、再試行', 'Download failed, retry'));
      setDlState(null);
      remove('tl-update-dl');
    });
    api.onUpdateNotAvailable(() => {
      setUpdateInfo(null);
      setResultStatus('up-to-date');
    });
    api.onDownloadProgress((p: any) => {
      const pct = p?.percent || 0;
      const prev = stored('tl-update-dl') || {};
      const updated = { ...prev, active: true, progress: pct, lastProgress: Date.now() };
      store('tl-update-dl', updated);
      setDlState(updated);
    });

    api.onUpdateDownloaded(() => {
      remove('tl-update-dl');
      setDlState(null);
      setUpdateInfo((prev: any) => (prev ? { ...prev, downloaded: true } : prev));
      setResultStatus('downloaded');
    });
    // Sync with App.tsx — notification bar was dismissed while we were showing "downloading..."
    const onDismissed = () => {
      setDlState(null);
      setUpdateInfo((prev: any) => (prev ? { ...prev, dismissed: true } : prev));
    };
    window.addEventListener('tl-update-dismissed', onDismissed);
    return () => window.removeEventListener('tl-update-dismissed', onDismissed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t recreated per render; listeners registered once
  }, []);

  const downloaded = downloadComplete || (!!updateInfo?.downloaded && !dlState?.active);
  const hasUpdate = updateInfo?.version && !downloading && !downloaded;

  const handleClick = () => {
    if (downloaded) {
      const api = (window as any).electronAPI;
      if (api?.installUpdate) api.installUpdate();
    } else if (hasUpdate) {
      const api = (window as any).electronAPI;
      if (api?.startDownload) {
        const s = { active: true, startTime: Date.now(), progress: 0 };
        store('tl-update-dl', s);
        // Clear dismissed flag so notification bar re-appears
        if (updateInfo?.dismissed) {
          const restored = { version: updateInfo.version };
          setUpdateInfo(restored);
          store('tl-update', restored);
          remove('tl-update-done');
          // Notify App.tsx to un-dismiss notification bar
          window.dispatchEvent(new CustomEvent('tl-update-undismissed', { detail: restored }));
        }
        setDlState(s);
        setDlError(''); // clear previous error
        setResultStatus(''); // button + progress bar already show downloading state
        // Clear red dot — user has seen update and acted on it
        remove('tl-update-seen');
        api.startDownload();
      }
    } else if (dlTimeout) {
      // Download interrupted/timed out — retry
      remove('tl-update-dl');
      setDlState(null);
      setResultStatus('');
    } else {
      const api = (window as any).electronAPI;
      if (api?.isStoreBuild) {
        setResultStatus('store-build');
        return;
      }
      setResultStatus('checking');
      if (api?.checkUpdate) {
        api.checkUpdate();
        setTimeout(() => {
          setResultStatus((prev) => (prev === 'checking' ? 'up-to-date' : prev));
        }, 15000);
      } else {
        setResultStatus('desktop-only');
      }
    }
  };

  const btnLabel = dlError ? (
    t('🔄 重试', '🔄 再試行', '🔄 Retry')
  ) : downloaded ? (
    t('⬆️ 安装并重启', '⬆️ インストールして再起動', '⬆️ Install & Restart')
  ) : downloading ? (
    t('下载中...', 'ダウンロード中...', 'Downloading...')
  ) : busy ? (
    t('检测中...', 'チェック中...', 'Checking...')
  ) : dlTimeout ? (
    t('🔄 重新下载', '🔄 再ダウンロード', '🔄 Retry')
  ) : hasUpdate ? (
    t('⬇️ 下载新版本', '⬇️ 新バージョンをダウンロード', '⬇️ Download Update')
  ) : (
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
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
      </svg>
      {t('检查更新', '更新をチェック', 'Check for Updates')}
    </span>
  );

  return (
    <div>
      <div className="card">
        <div className="card-hd">{t('关于', 'About', 'About')}</div>
        <div className="card-bd text-sm">
          {hostedInfo?.active && (
            <p className="text-xs" style={{ marginBottom: 6 }}>
              {i18nT('hosted.accountState', lang, {
                state:
                  hostedInfo.remaining != null
                    ? i18nT('hosted.stateTrial', lang, { n: Number(hostedInfo.remaining).toFixed(2) })
                    : i18nT('hosted.statePro', lang),
              })}
            </p>
          )}
          <p>TomiLite v{__APP_VERSION__}</p>
          {hasUpdate && (
            <p className="text-xs text-brand-main mt-1">
              🚀 v{updateInfo.version} {t('可用', '利用可能', 'available')}
            </p>
          )}
          <p className="text-ink-muted mt-1">
            {t('AI 个人办公助手', 'AI パーソナルオフィスアシスタント', 'AI personal office assistant')}
          </p>
          <button
            className={hasUpdate || downloaded ? 'btn btn-brand btn-sm mt-2' : 'btn btn-sm mt-2'}
            style={hasUpdate || downloaded ? {} : { background: 'var(--surface2)', border: '1px solid var(--edge)' }}
            onClick={handleClick}
            disabled={(busy && !dlTimeout) || !!downloading}
          >
            {btnLabel}
          </button>
          {resultStatus && <p className="text-xs text-ink-muted mt-1">{resultText[resultStatus]}</p>}
          {downloading && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--brand)', fontWeight: 600 }}>{Math.round(dlProgress)}%</span>
              </div>
              <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.round(dlProgress)}%`,
                    height: '100%',
                    background: 'var(--brand)',
                    borderRadius: 2,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          )}
          <p className="text-ink-muted mt-2" style={{ fontSize: 10 }}>
            {t(
              '版权所有 © 2026 Tomatovector。保留所有权利。',
              '© 2026 Tomatovector. 無断複写・転載を禁じます。',
              'Copyright © 2026 Tomatovector. All rights reserved.',
            )}
          </p>
        </div>
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <div className="card-hd">{t('许可证', 'ライセンス', 'License')}</div>
        <div className="card-bd text-sm" style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
          <p>
            {t(
              '本软件为专有保密软件。仅供个人设备内部使用。',
              '本ソフトウェアは独占的な機密情報です。個人のデバイスでの内部使用に限ります。',
              'This software is proprietary and confidential. You may install and use it on your personal devices for internal use only.',
            )}
          </p>
          <p className="mt-1">
            {t(
              '禁止重新分发、转授权、销售、修改、反编译或逆向工程。',
              '再配布、サブライセンス、販売、改変、逆コンパイル、リバースエンジニアリングを禁止します。',
              'You may NOT redistribute, sublicense, sell, modify, decompile, or reverse engineer the Software.',
            )}
          </p>
          <p className="mt-1">
            {t(
              '本软件按"原样"提供，不附带任何形式的明示或暗示担保。',
              '本ソフトウェアは「現状有姿」で提供され、明示または黙示を問わず、いかなる保証もありません。',
              'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.',
            )}
          </p>
          <p className="mt-1">Contact: xxwj225@hotmail.com</p>
        </div>
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <div className="card-hd">{i18nT('telemetry.aboutTitle', lang)}</div>
        <div className="card-bd text-sm">
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              cursor: telOn === null ? 'default' : 'pointer',
              opacity: telOn === null ? 0.6 : 1,
            }}
          >
            <input
              type="checkbox"
              disabled={telOn === null}
              checked={telOn === true}
              onChange={(e) => toggleTel(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>{i18nT('telemetry.aboutLabel', lang)}</span>
          </label>
          <p className="text-ink-muted" style={{ fontSize: 10, lineHeight: 1.6, marginTop: 6 }}>
            {i18nT('telemetry.aboutDesc', lang)}
          </p>
        </div>
      </div>
    </div>
  );
}
