import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

// ═══ Setup status: LLM/email/git/apikey/standup/MCP config flags + welcome guide visibility ═══
export function useSetupChecks() {
  const [showWelcome, setShowWelcome] = useState(false); // must be before useEffect that references it (obfuscator TDZ)
  // ─── Soft-gate: LLM API key check ───
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [gitConfigured, setGitConfigured] = useState(false);
  const [apikeyConfigured, setApikeyConfigured] = useState(false);
  const [standupConfigured, setStandupConfigured] = useState(false);
  const [mcpConfigured, setMcpConfigured] = useState(false);
  const [llmBannerDismissed, setLlmBannerDismissed] = useState(false);

  useEffect(() => {
    // Check all setup statuses, then decide whether to show welcome guide
    Promise.all([
      api.llm
        .getConfig()
        .then((d: any) => !!d?.activeProvider?.hasKey)
        .catch(() => false),
      api.hosted
        .status()
        .then((s: any) => !!s?.active)
        .catch(() => false),
      fetch('/api/email.getConfig')
        .then((r) => r.json())
        .then((d) => (d.result?.data || []).some((c: any) => c.type === 'imap'))
        .catch(() => false),
      fetch('/api/git.listWorkDirs')
        .then((r) => r.json())
        .then((d) => (d.result?.data || []).length > 0)
        .catch(() => false),
      fetch('/api/apikey.list')
        .then((r) => r.json())
        .then((d) => (d.result?.data || []).length > 0)
        .catch(() => false),
      fetch('/api/standup.getSettings')
        .then((r) => r.json())
        .then((d) => !!d.result?.data?.evening)
        .catch(() => false),
      fetch('/api/mcpServer.list')
        .then((r) => r.json())
        .then((d) => (d?.result?.data || []).filter((s: any) => s.enabled).length > 0)
        .catch(() => false),
    ]).then(([hasLLM, hasHosted, hasEmail, hasGit, hasApikey, hasStandup, hasMcp]) => {
      setLlmConfigured(hasLLM || hasHosted);
      setEmailConfigured(hasEmail);
      setGitConfigured(hasGit);
      setApikeyConfigured(hasApikey);
      setStandupConfigured(hasStandup);
      setMcpConfigured(hasMcp);
      // If all DB settings are already configured → auto-dismiss (OTA user with everything set up)
      if ((hasLLM || hasHosted) && hasEmail && hasGit && hasApikey && hasStandup && hasMcp) {
        localStorage.setItem('tl-welcome-dismissed', '1');
      }
      // Show welcome guide if not dismissed
      if (localStorage.getItem('tl-welcome-dismissed') !== '1') setShowWelcome(true);
    });
  }, []);

  // Periodically re-check configs while welcome guide is visible (instant ✅ update)
  useEffect(() => {
    if (!showWelcome) return;
    const refresh = () => {
      Promise.all([
        api.llm
          .getConfig()
          .then((d: any) => !!d?.activeProvider?.hasKey)
          .catch(() => false),
        api.hosted
          .status()
          .then((s: any) => !!s?.active)
          .catch(() => false),
        fetch('/api/email.getConfig')
          .then((r) => r.json())
          .then((d) => (d.result?.data || []).some((c: any) => c.type === 'imap'))
          .catch(() => false),
        fetch('/api/git.listWorkDirs')
          .then((r) => r.json())
          .then((d) => (d.result?.data || []).length > 0)
          .catch(() => false),
        fetch('/api/apikey.list')
          .then((r) => r.json())
          .then((d) => (d.result?.data || []).length > 0)
          .catch(() => false),
        fetch('/api/standup.getSettings')
          .then((r) => r.json())
          .then((d) => !!d.result?.data?.evening)
          .catch(() => false),
        fetch('/api/mcpServer.list')
          .then((r) => r.json())
          .then((d) => (d?.result?.data || []).filter((s: any) => s.enabled).length > 0)
          .catch(() => false),
      ]).then(([hasLLM, hasHosted, hasEmail, hasGit, hasApikey, hasStandup, hasMcp]) => {
        setLlmConfigured(hasLLM || hasHosted);
        setEmailConfigured(hasEmail);
        setGitConfigured(hasGit);
        setApikeyConfigured(hasApikey);
        setStandupConfigured(hasStandup);
        setMcpConfigured(hasMcp);
        if ((hasLLM || hasHosted) && hasEmail && hasGit && hasApikey && hasStandup && hasMcp) {
          localStorage.setItem('tl-welcome-dismissed', '1');
          setShowWelcome(false);
        }
      });
    };
    refresh();
    const iv = setInterval(refresh, 10000);
    return () => clearInterval(iv);
  }, [showWelcome]);

  return {
    showWelcome,
    setShowWelcome,
    llmConfigured,
    setLlmConfigured,
    emailConfigured,
    gitConfigured,
    apikeyConfigured,
    standupConfigured,
    mcpConfigured,
    llmBannerDismissed,
    setLlmBannerDismissed,
  };
}
