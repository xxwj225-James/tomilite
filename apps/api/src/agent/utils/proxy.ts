// Proxy detection: read Windows system proxy (used only for OpenAI/Anthropic)
export function getProxyUrl(): string | undefined {
  let url: any = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!url && process.platform === 'win32') {
    try {
      const { execSync } = require('node:child_process');
      const raw = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer 2>nul', { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim();
      const m = raw.match(/ProxyServer\s+REG_SZ\s+(.+)/i);
      if (m?.[1]) {
        const val = m[1];
        const httpsMatch = val.match(/https=([^;]+)/i);
        url = httpsMatch ? httpsMatch[1] : val.split(';')[0];
        if (!url.startsWith('http')) url = 'http://' + url;
      }
    } catch { /* no system proxy */ }
  }
  return url;
}
