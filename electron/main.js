// TomiLite Electron Shell
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, Notification, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { console.error('[Updater] electron-updater not available:', e.message); }

ipcMain.handle('dialog:pickDirectory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('dialog:pickSaveFile', async (_event, defaultName, filters) => {
  const opts = { defaultPath: defaultName };
  if (filters && Array.isArray(filters)) opts.filters = filters;
  else opts.filters = [{ name: 'All Files', extensions: ['*'] }];
  const result = await dialog.showSaveDialog(opts);
  return result.canceled ? null : result.filePath;
});
const os = require('os');
const fs = require('fs');

const API_PORT = 3192;
const NOTIFY_PORT = 3191;
const isDev = process.env.NODE_ENV === 'development';
const IS_STORE_BUILD = process.execPath.includes('\\WindowsApps\\');

let mainWindow = null;
let tray = null;
let apiProcess = null;
let apiErrors = '';
let isQuitting = false;
let pendingNotifications = 0;

// ─── Port helper — kill stale process left by crash/force-quit ───
function killPortProcess(port) {
  try {
    const result = require('child_process').execSync(
      'netstat -ano | findstr :' + port + '.*LISTENING', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const match = result.match(/(\d+)\s*$/m);
    if (match && match[1] && match[1] !== String(process.pid)) {
      console.log('[Startup] Killing PID ' + match[1] + ' on port ' + port);
      require('child_process').execSync('taskkill /F /PID ' + match[1] + ' /T', { stdio: 'ignore' });
    }
  } catch (e) { /* port is free or netstat failed */ }
}

// ─── Notification server (API sends Cat-1 email alerts here) ───
const notifyServer = http.createServer(function (req, res) {
  if (req.method === 'POST' && req.url === '/notify') {
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
      try {
        var data = JSON.parse(body);
        pendingNotifications++;
        updateTrayBadge();
        if (Notification.isSupported()) {
          var n = new Notification({ title: data.title || 'TomiLite', body: data.body, icon: path.join(__dirname, 'icon.png') });
          n.show();
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, count: pendingNotifications }));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  } else {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, count: pendingNotifications }));
  }
});
function startNotifyServer() {
  notifyServer.on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
      console.log('[Startup] Port ' + NOTIFY_PORT + ' in use, killing stale process...');
      killPortProcess(NOTIFY_PORT);
      // Retry after a short delay for OS to release the port
      setTimeout(function () {
        notifyServer.listen(NOTIFY_PORT, '127.0.0.1');
      }, 500);
    } else {
      console.error('[NotifyServer] Error:', err.message);
    }
  });
  notifyServer.listen(NOTIFY_PORT, '127.0.0.1', function () {
    console.log('Notify server on port ' + NOTIFY_PORT);
  });
}
startNotifyServer();

function updateTrayBadge() {
  if (tray && pendingNotifications > 0) {
    tray.setToolTip('TomiLite (' + pendingNotifications + ' new alerts)');
  } else if (tray) {
    tray.setToolTip('TomiLite');
  }
}

// ─── Start API server ───
function startApiServer() {
  var rootDir = path.resolve(__dirname, '..');
  var dataDir = app.getPath('userData');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Migrate from old data dir (~/.tomatolite → ~/.tomilite). Server reads ~/.tomilite NOT userData
  var homeDir = process.env.TL_USER_DATA || path.join(os.homedir(), '.tomilite');
  if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir, { recursive: true });
  var oldDir = path.join(os.homedir(), '.tomatolite');
  var oldDb = path.join(oldDir, 'dev.db');
  var newDb = path.join(homeDir, 'dev.db');
  var migratedFlag = path.join(homeDir, '.migrated_from_dot_tomatolite');
  if (fs.existsSync(oldDb) && !fs.existsSync(migratedFlag)) {
    try {
      if (fs.existsSync(newDb)) {
        if (fs.statSync(oldDb).size > fs.statSync(newDb).size) fs.copyFileSync(oldDb, newDb);
      } else {
        fs.copyFileSync(oldDb, newDb);
      }
      ['dev.db-journal','dev.db-wal','dev.db-shm','.encryption_key','.api_token'].forEach(function(f) {
        var o = path.join(oldDir,f), n = path.join(homeDir,f);
        if (fs.existsSync(o) && !fs.existsSync(n)) fs.copyFileSync(o,n);
      });
      fs.writeFileSync(migratedFlag, new Date().toISOString());
      console.log('[migrate] ' + oldDir + ' → ' + homeDir);
    } catch (e) { console.error('[migrate]', e.message); }
    // Clean old install dir
    var oldInst = path.join(os.homedir(),'AppData','Local','Programs','TomatoLite');
    try { if (fs.existsSync(oldInst)) { fs.rmSync(oldInst,{recursive:true,force:true}); } } catch (e) {}
  }
  var dbPath = newDb;

  var serverPath = path.join(rootDir, 'apps', 'api', 'dist', 'server.cjs');

  apiProcess = spawn(process.execPath, [serverPath], {
    cwd: rootDir,
    env: Object.assign({}, process.env, {
      API_PORT: String(API_PORT),
      DATABASE_URL: 'file:' + dbPath,
      TL_USER_DATA: dataDir,
      ELECTRON_RUN_AS_NODE: '1',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  apiProcess.stdout.on('data', function (data) {
    var msg = data.toString().trim();
    if (msg) console.log('[API]', msg);
  });
  apiProcess.stderr.on('data', function (data) {
    var msg = data.toString().trim();
    apiErrors += msg + '\n';
    console.error('[API ERR]', msg);
  });
  apiProcess.on('error', function (err) {
    console.error('[API] spawn error:', err.message);
    apiErrors += 'Spawn error: ' + err.message + '\n';
  });
  let apiRestarts = 0;
  apiProcess.on('exit', function (code) {
    if (isQuitting) return;
    console.log('[API] exited with code ' + code);
    if (apiRestarts < 3) {
      apiRestarts++;
      console.log('[API] auto-restarting (attempt ' + apiRestarts + '/3)...');
      setTimeout(startApiServer, 2000);
    } else {
      console.error('[API] max restarts reached — giving up');
    }
  });
}

// ─── Wait for API to be ready ───
function waitForApi(url, retries) {
  if (!retries) retries = 600; // 600×150ms=90s — covers slow first-launch migrations + db push
  return new Promise(function (resolve, reject) {
    var attempts = 0;
    function check() {
      attempts++;
      http.get(url, function (res) { resolve(true); }).on('error', function () {
        if (attempts >= retries) reject(new Error('API not ready'));
        else setTimeout(check, 150);
      });
    }
    check();
  });
}

// ─── Loading screen HTML — fixed pipeline theme ───
var loadingHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
  'body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fb;font-family:sans-serif;overflow:hidden}' +
  '.wrap{text-align:center}' +
  '.icon{width:80px;height:80px;fill:#6366f1;animation:pulse 2s ease-in-out infinite}' +
  '@keyframes pulse{0%,100%{opacity:.4;transform:scale(.9)}50%{opacity:1;transform:scale(1.1)}}' +
  '.title{font-size:18px;font-weight:600;color:#1c1c1e;margin-top:20px}' +
  '.bar{width:200px;height:3px;background:#e8eaef;border-radius:2px;margin:16px auto 0;overflow:hidden}' +
  '.bar-fill{width:30%;height:100%;background:linear-gradient(90deg,#6366f1,#818cf8);border-radius:2px;animation:slide 1.5s ease-in-out infinite}' +
  '@keyframes slide{0%{transform:translateX(-30%)}100%{transform:translateX(330%)}}' +
  '</style></head><body>' +
  '<div class="wrap">' +
  '<svg class="icon" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/></svg>' +
  '<div class="title">TomiLite</div>' +
  '<div class="bar"><div class="bar-fill"></div></div>' +
  '</div></body></html>';
const LOADING_HTML = 'data:text/html;base64,' + Buffer.from(loadingHtml).toString('base64');

// ─── Create window ───
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f8f9fb',
    frame: true,
    titleBarStyle: 'hiddenInset',
    title: 'TomiLite',
    icon: path.join(__dirname, 'icon.png'),
    show: true, // show immediately with loading screen (Microsoft Store review requires visible content)
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });


  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  // F12 → toggle DevTools (for debugging)
  mainWindow.webContents.on('before-input-event', function (e, input) {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Restrict external link handling — deny new windows, open in system browser
  mainWindow.webContents.setWindowOpenHandler(function ({ url }) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', function () {
    isQuitting = true;
  });

  // Show loading screen when ready (avoids white flash)
  mainWindow.once('ready-to-show', function () { mainWindow.show(); });
  mainWindow.loadURL(LOADING_HTML);
}

// ─── Tray ───
function createTray() {
  var icon = nativeImage.createEmpty();
  try {
    var iconPath = path.join(__dirname, 'icon.png');
    tray = new Tray(iconPath);
  } catch (e) {}

  if (tray) {
    var contextMenu = Menu.buildFromTemplate([
      { label: 'Show TomiLite', click: function () { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: 'Quit', click: function () { isQuitting = true; app.quit(); } },
    ]);
    tray.setToolTip('TomiLite');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', function () { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  }
}

// ─── App lifecycle ───
app.whenReady().then(function () {
  console.log('Starting TomiLite...');

  // Show window with loading screen immediately
  createWindow();
  createTray();

  // Start API server
  startApiServer();

  // Wait for API, then navigate to real app
  waitForApi('http://localhost:' + API_PORT + '/api/system.currentVersion')
    .then(function () {
      console.log('API ready, loading app...');
      if (!mainWindow) { console.error('[Startup] mainWindow is null'); return; }
      mainWindow.webContents.on('did-fail-load', function (_e, code, desc, url) {
        console.error('[Startup] Page load failed:', code, desc, url);
        // Retry once, then show error
        setTimeout(function () {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL('http://localhost:' + API_PORT + '/');
        }, 2000);
      });
      mainWindow.webContents.on('did-finish-load', function () {
        console.log('[Startup] Page loaded successfully');
      });
      mainWindow.webContents.on('render-process-gone', function (_e, details) {
        console.error('[Startup] Render process gone:', details.reason);
      });
      // Read API token for external MCP tools
      var dataDir = process.env.TL_USER_DATA || path.join(os.homedir(), '.tomilite');
      var tokenPath = path.join(dataDir, '.api_token');
      var tokenParam = '';
      try { if (fs.existsSync(tokenPath)) tokenParam = '#tl_token=' + fs.readFileSync(tokenPath, 'utf-8').trim(); } catch (e) {}
      if (mainWindow) mainWindow.loadURL('http://localhost:' + API_PORT + '/' + tokenParam);

      // ─── Auto-updater (electron-updater) ───
      if (IS_STORE_BUILD) { console.log('[Updater] Skipped — Store build, updates via Microsoft Store.'); return; }
      if (!autoUpdater) { console.log('[Updater] Skipped — module not loaded.'); return; }
      autoUpdater.autoDownload = false; // let user decide
      autoUpdater.autoInstallOnAppQuit = true;

      // Clean stale pending downloads — prevents corrupted installs on restart
      var pendingDir = path.join(os.homedir(), 'AppData', 'Local', 'tomilite-updater', 'pending');
      // Clean up old updater dir from TomatoLite rename
      var oldPendingDir = path.join(os.homedir(), 'AppData', 'Local', 'tomatolite-updater', 'pending');
      try { if (fs.existsSync(pendingDir)) { fs.rmSync(pendingDir, { recursive: true, force: true }); } } catch (e) {}
      try { if (fs.existsSync(oldPendingDir)) { fs.rmSync(oldPendingDir, { recursive: true, force: true }); console.log('[Updater] Cleaned old updater cache'); } } catch (e) {}

      // Safe IPC send — guards against destroyed window during quit
      function safeSend(channel, data) {
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); } catch (e) {}
      }

      autoUpdater.on('checking-for-update', function () {
        console.log('[Updater] Checking for updates...');
      });
      autoUpdater.on('update-available', function (info) {
        console.log('[Updater] Update available:', info.version);
        safeSend('update-available', info);
      });
      autoUpdater.on('update-not-available', function () {
        console.log('[Updater] No update available.');
      });
      autoUpdater.on('download-progress', function (progress) {
        safeSend('download-progress', progress);
      });
      autoUpdater.on('update-downloaded', function (info) {
        console.log('[Updater] Update downloaded:', info.version, 'file:', info.downloadedFile || info.path || '(unknown)');
        console.log('[Updater] Download info keys:', Object.keys(info));
        safeSend('update-downloaded', {
          version: info.version,
          downloadedFile: info.downloadedFile || info.path || info.installerPath || '',
        });
      });
      autoUpdater.on('error', function (err) {
        // Suppress errors from download interruption (app closed mid-download, network drops)
        var msg = (err?.message || String(err)).toLowerCase();
        if (msg.includes('aborted') || msg.includes('interrupted') || msg.includes('typeerror') || msg.includes('cancelled') || msg.includes('destroyed')) return;
        console.error('[Updater] Error:', err.message);
        safeSend('update-error', err?.message);
      });

      // Handle install request from renderer
      ipcMain.handle('install-update', function () {
        try {
          console.log('[Updater] quitAndInstall called');
          autoUpdater.quitAndInstall(false, true);
        } catch (e) {
          console.error('[Updater] quitAndInstall failed:', e.message);
          return { ok: false, error: e.message };
        }
        return { ok: true };
      });
      ipcMain.handle('start-download', function () {
        // Clean stale pending before new download
        try { if (fs.existsSync(pendingDir)) { fs.rmSync(pendingDir, { recursive: true, force: true }); } } catch (e) {}
        autoUpdater.downloadUpdate();
      });
      ipcMain.handle('check-update', function () {
        autoUpdater.checkForUpdates();
      });
      ipcMain.handle('open-folder', function (_e, filePath) {
        const { shell } = require('electron');
        const path = require('node:path');
        shell.openPath(path.dirname(filePath));
      });

      // Check after a short delay to let the UI settle
      setTimeout(function () { autoUpdater.checkForUpdates(); }, 5000);
    })
    .catch(function () {
      var detail = apiErrors ? 'Details:\n' + apiErrors.substring(0, 500) : 'No error output captured.';
      if (mainWindow) {
        mainWindow.loadURL('data:text/html,' + encodeURIComponent('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="background:#0d0d0d;color:#ff6b6b;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column"><h2>Startup Error</h2><p style="color:#999;font-size:12px;max-width:500px;text-align:center">TomiLite API server failed to start.<br>Try restarting the app. If this persists, delete the app data folder and reinstall.</p><pre style="color:#666;font-size:10px;max-width:500px;overflow:auto">' + detail.replace(/</g,'&lt;').substring(0, 500) + '</pre></body></html>'));
      } else {
        dialog.showErrorBox('Startup Error', 'API server failed to start.\n' + detail);
      }
    });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', function () {
  app.quit();
});

app.on('before-quit', function () {
  isQuitting = true;
  // Close HTTP notify server so port is released immediately
  notifyServer.close(function () { /* ignore close errors */ });
  if (apiProcess && !apiProcess.killed) {
    try {
      require('child_process').execSync('taskkill /F /PID ' + apiProcess.pid + ' /T', { stdio: 'ignore' });
    } catch (e) {}
    apiProcess = null;
  }
});
