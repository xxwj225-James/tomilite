import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { LANGS } from '@/lib/constants';
import { useLang } from '@/stores/LangContext';

// ═══ Notifications: urgent-email/MCP badges, morning check-in, evening report, backend lang sync ═══
export function useNotifications({ sessionsLoaded }: { sessionsLoaded: boolean }) {
  const lang = useLang();
  const [notifyCount, setNotifyCount] = useState(0);
  const [mcpPending, setMcpPending] = useState(0);
  const [morningNotify, setMorningNotify] = useState<string | null>(null);
  const [eveningNotify, setEveningNotify] = useState<string | null>(null);
  const [notifyLoading, setNotifyLoading] = useState(false);

  // Poll notification count (Cat-1 urgent emails + MCP pending) every 30s
  useEffect(() => {
    const poll = () => {
      fetch('/api/system.notifyCount').then(r => r.json()).then(d => {
        setNotifyCount(d.result?.data?.count || 0);
      }).catch(() => {});
      fetch('/api/mcp.pendingCount').then(r => r.json()).then(d => {
        setMcpPending(d.result?.data?.count || 0);
      }).catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, []);

  // Morning check-in: poll for ready status (backend generates at set time - 5min)
  useEffect(() => {
    if (!sessionsLoaded) return;
    const today = new Date().toISOString().substring(0, 10);
    const check = () => {
      if (localStorage.getItem('tl-morning-date') === today) return; // already shown today
      api.standup.getMorningStatus().then((s: any) => {
        if (s?.ready) {
          api.standup.getMorningBrief(lang).then((data: any) => {
            if (data?.greeting) { setMorningNotify(data.greeting as string); localStorage.setItem('tl-morning-date', today); }
          }).catch(() => {});
        }
      }).catch(() => {});
    };
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, [sessionsLoaded, lang]);

  // Evening report: poll every 60s, show bubble when auto-generated
  useEffect(() => {
    if (!sessionsLoaded) return;
    const check = () => {
      api.standup.getEveningStatus().then((s: any) => {
        if (s?.notify && s.reportId) {
          const today = new Date().toISOString().substring(0, 10);
          if (localStorage.getItem('tl-evening-shown') !== today) {
            setEveningNotify(s.reportId);
          }
        }
      }).catch(() => {});
    };
    check();
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, [sessionsLoaded]);

  // Sync UI language to backend on startup (so evening report timer uses correct language)
  useEffect(() => {
    if (!sessionsLoaded) return;
    const savedLang = localStorage.getItem('tomilite-lang');
    if (savedLang && LANGS.includes(savedLang as any)) {
      fetch('/api/system.saveLanguage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: savedLang }) }).catch(() => {});
    }
  }, [sessionsLoaded]);

  return { notifyCount, mcpPending, morningNotify, setMorningNotify, eveningNotify, setEveningNotify, notifyLoading, setNotifyLoading };
}
