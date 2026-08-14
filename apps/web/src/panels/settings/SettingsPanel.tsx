import { useState, useEffect } from "react";
import { useLang } from "@/stores/useLang";
import { LlmTab } from "./LlmTab";
import { ApiKeyTab } from "./ApiKeyTab";
import { EmailTab } from "./EmailTab";
import { GitTab } from "./GitTab";
import { StandupTab } from "./StandupTab";
import { McpServerTab } from "./McpServerTab";

const ALL_TABS = ['llm','apikey','email','git','standup','mcpServers'] as const;
type TabKey = typeof ALL_TABS[number];

export function SettingsPanel() {
  const lang = useLang();
  const [tab, setTab] = useState<TabKey>(() => {
    const hint = (window as any).__tl_settingsTab;
    if (hint && ALL_TABS.includes(hint)) { delete (window as any).__tl_settingsTab; return hint as TabKey; }
    return 'llm';
  });

  useEffect(() => {
    const onNav = () => {
      const hint = (window as any).__tl_settingsTab;
      if (hint && ALL_TABS.includes(hint)) { delete (window as any).__tl_settingsTab; setTab(hint as TabKey); }
    };
    onNav(); // immediate check on mount
    const iv = setInterval(onNav, 200);
    return () => clearInterval(iv);
  }, []);

  const tabColor: Record<string, string> = {
    llm: 'var(--brand)',
    apikey: 'var(--amber)',
    email: 'var(--blue)',
    git: 'var(--green)',
    standup: 'var(--purple)',
    mcpServers: 'var(--cyan)',
    about: 'var(--muted)',
  };
  const s = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const settingsIcon = (t: string) => {
    const c = tabColor[t];
    switch (t) {
      case 'llm':
        return <svg {...s} stroke={c}><path d="M12 2l1.8 5.5 5.7.7-4.3 4 1.3 5.6-4.5-3.5-4.5 3.5 1.3-5.6-4.3-4 5.7-.7z"/></svg>;
      case 'apikey':
        return <svg {...s} stroke={c}><circle cx="7" cy="13" r="6"/><path d="M14 13l4 4M22 17l-2.5 2.5M19.5 19.5L16 16"/></svg>;
      case 'email':
        return <svg {...s} stroke={c}><path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
      case 'git':
        return <svg {...s} stroke={c}><circle cx="5" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><line x1="5" y1="7" x2="5" y2="17"/><path d="M5 10c3 0 10-1 13-5"/><path d="M5 14c3 0 10 1 13 5"/></svg>;
      case 'standup':
        return <svg {...s} stroke={c}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
      case 'mcpServers':
        return <svg {...s} stroke={c}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>;
      case 'about':
        return <svg {...s} stroke={c}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
      default: return null;
    }
  };

  const tabLabel = (t: string) => {
    const labels: Record<string, Record<string, string>> = {
      llm: { zh: 'LLM', en: 'LLM', ja: 'LLM' },
      apikey: { zh: '密钥', en: 'Keys', ja: 'キー' },
      email: { zh: '邮件', en: 'Email', ja: 'メール' },
      git: { zh: 'Git', en: 'Git', ja: 'Git' },
      about: { zh: '关于', en: 'About', ja: 'About' },
      standup: { zh: '每日站会', en: 'Daily Standup', ja: 'スタンドアップ' },
      mcpServers: { zh: 'MCP 服务器', en: 'MCP Servers', ja: 'MCPサーバー' },
    };
    return labels[t]?.[lang] || t;
  };
  return (
    <div className="p-2">
      <div className="tabs-h">
        {ALL_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'tab-h tab-h--active' : 'tab-h'} style={tab === t ? { color: tabColor[t], ['--tab-color' as any]: tabColor[t] } : undefined}>
            <span style={{ display: 'inline-flex', alignItems: 'center', opacity: tab === t ? 1 : 0.7 }}>{settingsIcon(t)}</span>
            {tabLabel(t)}
          </button>
        ))}
      </div>
      {tab === 'llm' && <LlmTab />}
      {tab === 'apikey' && <ApiKeyTab />}
      {tab === 'email' && <EmailTab />}
      {tab === 'git' && <GitTab />}
      {tab === 'standup' && <StandupTab />}
      {tab === 'mcpServers' && <McpServerTab />}
    </div>
  );
}
