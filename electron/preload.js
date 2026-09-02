const { contextBridge, shell, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const IS_STORE_BUILD = process.execPath.includes('\\WindowsApps\\');

// Path whitelist — only allow file ops within user home and temp directories
function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath);
  const allowed = [os.homedir(), os.tmpdir()];
  return allowed.some(function (d) {
    return resolved.startsWith(d);
  });
}

// Read API token synchronously before page loads
const DATA_DIR = process.env.TL_USER_DATA || path.join(os.homedir(), '.tomilite');

let token = '';
try {
  const tokenPath = path.join(DATA_DIR, '.api_token');
  if (fs.existsSync(tokenPath)) {
    token = fs.readFileSync(tokenPath, 'utf-8').trim();
  }
} catch {}

const LOG_DIR = DATA_DIR;
const LOG_FILE = path.join(LOG_DIR, 'frontend.log');
const DEBUG_FLAG = path.join(LOG_DIR, 'debug.flag');
const IS_DEBUG = fs.existsSync(DEBUG_FLAG);
try {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {}

contextBridge.exposeInMainWorld('electronAPI', {
  isDebug: IS_DEBUG,
  // File logging for debugging (only active when debug.flag exists)
  log: function () {
    if (!IS_DEBUG) return;
    try {
      var ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        parts.push(typeof arguments[i] === 'object' ? JSON.stringify(arguments[i]) : String(arguments[i]));
      }
      fs.appendFileSync(LOG_FILE, '[' + ts + '] ' + parts.join(' ') + String.fromCharCode(10));
    } catch (e) {}
  },
  getToken: () => token,
  openExternal: (url) => shell.openExternal(url),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  pickSaveFile: (defaultName, filters) => ipcRenderer.invoke('dialog:pickSaveFile', defaultName, filters),
  printPdf: (html, filename) => ipcRenderer.invoke('pdf:print', { html, filename }),
  saveFile: (filePath, content) => {
    if (!isPathAllowed(filePath)) throw new Error('Access denied');
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  },
  copyFile: (destPath, srcPath) => {
    if (!isPathAllowed(destPath) || !isPathAllowed(srcPath)) throw new Error('Access denied');
    fs.copyFileSync(srcPath, destPath);
    return true;
  },
  fileExists: (filePath) => isPathAllowed(filePath) && fs.existsSync(filePath),
  // Auto-updater (disabled on Store builds — updates via Microsoft Store)
  onUpdateAvailable: IS_STORE_BUILD ? () => {} : (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateNotAvailable: IS_STORE_BUILD ? () => {} : (cb) => ipcRenderer.on('update-not-available', () => cb()),
  onDownloadProgress: IS_STORE_BUILD ? () => {} : (cb) => ipcRenderer.on('download-progress', (_e, p) => cb(p)),
  onUpdateDownloaded: IS_STORE_BUILD ? () => {} : (cb) => ipcRenderer.on('update-downloaded', (_e, info) => cb(info)),
  onUpdateError: IS_STORE_BUILD ? () => {} : (cb) => ipcRenderer.on('update-error', (_e, msg) => cb(msg)),
  installUpdate: IS_STORE_BUILD ? () => {} : () => ipcRenderer.invoke('install-update'),
  startDownload: IS_STORE_BUILD ? () => {} : () => ipcRenderer.invoke('start-download'),
  checkUpdate: IS_STORE_BUILD ? () => {} : () => ipcRenderer.invoke('check-update'),
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
});
