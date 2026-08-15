import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { LLM_PROVIDERS, getProvider, DEFAULT_PROVIDER } from '@/lib/llmProviders';
import { useLang } from '@/stores/useLang';
import { t as tt } from '@/lib/i18n';

interface Props {
  onSave?: (config: Record<string, unknown>) => void;
  standalone?: boolean;
}

export function LlmForm({ onSave, standalone = false }: Props) {
  const lang = useLang();
  const t = (key: string) => {
    const map: Record<string, Record<string, string>> = {
      en: { testConn: 'Test Connection', testing: 'Testing...', saveChanges: 'Save Changes', saving: 'Saving...', saved: '✅ Saved', apiKeyRequired: 'API key is required. Test connection must pass before continuing.' },
      zh: { testConn: '测试连接', testing: '测试中...', saveChanges: '保存设置', saving: '保存中...', saved: '✅ 已保存', apiKeyRequired: '请填写 API 密钥并通过连接测试。' },
      ja: { testConn: '接続テスト', testing: 'テスト中...', saveChanges: '設定を保存', saving: '保存中...', saved: '✅ 保存済み', apiKeyRequired: 'APIキーが必要です。接続テストを通過してください。' },
      th: { testConn: 'Test Connection', testing: 'Testing...', saveChanges: 'Save Changes', saving: 'Saving...', saved: '✅ Saved', apiKeyRequired: 'API key is required.' },
      mi: { testConn: 'Test Connection', testing: 'Testing...', saveChanges: 'Save Changes', saving: 'Saving...', saved: '✅ Saved', apiKeyRequired: 'API key is required.' },
      ru: { testConn: 'Test Connection', testing: 'Testing...', saveChanges: 'Save Changes', saving: 'Saving...', saved: '✅ Saved', apiKeyRequired: 'API key is required.' },
    };
    return map[lang]?.[key] || map.en[key] || key;
  };
  const [selectedProvider, setSelectedProvider] = useState(DEFAULT_PROVIDER);
  const providerConfig = getProvider(selectedProvider) || LLM_PROVIDERS[0];
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testPassed, setTestPassed] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const realKeyRef = useRef('');
  const [keyConfigured, setKeyConfigured] = useState(false);

  useEffect(() => {
    api.llm.getConfig().then((d: any) => {
      const activeProvider = d?.activeProvider;
      if (activeProvider?.hasKey) {
        setKeyConfigured(true);
        setApiKey(activeProvider.keyMasked || '');
        realKeyRef.current = activeProvider.apiKey || '';
        // Detect active provider name from providers list
        const matched = (d?.providers || []).find((p: any) => p.id === activeProvider.providerId);
        if (matched?.name) setSelectedProvider(matched.name);
      }
    }).catch(() => {});
  }, []);

  const testConn = async () => {
    const keyToTest = keyConfigured ? realKeyRef.current : apiKey.trim();
    if (!keyToTest) { setTestResult('❌ API Key is empty'); return; }
    setTesting(true); setTestResult('');
    try {
      const result = await api.llm.testConnection({ baseUrl: providerConfig.apiBaseUrl, apiKey: keyToTest, model: providerConfig.flashModel });
      const ok = result?.ok;
      const detail = (result as any)?.message ? `: ${(result as any).message}` : (result as any)?.status ? ` (HTTP ${(result as any).status})` : '';
      setTestResult(ok ? '✅ Connected' : `❌ Failed${detail}`);
      setTestPassed(ok);
    } catch { setTestResult('❌ Failed'); setTestPassed(false); }
    setTesting(false);
  };

  const handleSave = async () => {
    // Always validate the API key before saving, unless already tested
    if (!testPassed) {
      setSaving(true); setTestResult('');
      const keyToTest = keyConfigured ? realKeyRef.current : apiKey.trim();
      if (!keyToTest) { setTestResult('❌ API Key is empty'); setSaving(false); return; }
      try {
        const result = await api.llm.testConnection({ baseUrl: providerConfig.apiBaseUrl, apiKey: keyToTest, model: providerConfig.flashModel });
        if (result?.ok) { setTestResult('✅ Connected'); setTestPassed(true); } else { const detail = (result as any)?.message ? `: ${(result as any).message}` : (result as any)?.status ? ` (HTTP ${(result as any).status})` : ''; setTestResult(`❌ Failed${detail}`); setSaving(false); return; }
      } catch { setTestResult('❌ Failed'); setSaving(false); return; }
    }
    setSaving(true);
    try {
      const data = await api.llm.getConfig();
      const providers = data?.providers || [];
      const selected = providers.find(function(p: any) { return p.name === selectedProvider; });
      const providerId = selected?.id;
      if (providerId) {
        if (!keyConfigured) {
          await api.llm.saveProvider({ providerId: providerId, apiKey: apiKey.trim(), isActive: true });
        }
        await api.llm.saveConfig({ flashModel: providerConfig.flashModel, proModel: providerConfig.proModel });
      }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      onSave?.({ apiKey: apiKey.trim() });
      window.dispatchEvent(new CustomEvent('tl-llm-config-changed'));
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="form-grp"><label className="form-label">{tt('llmTab.provider', lang)}</label>
        <select className="form-select" value={selectedProvider} onChange={e => { setSelectedProvider(e.target.value); setTestPassed(false); setTestResult(''); }}>
          {LLM_PROVIDERS.filter(p => !p.hidden).map(p => <option key={p.name} value={p.name}>{p.displayName}</option>)}
        </select>
      </div>
      <div className="form-grp"><label className="form-label">{tt('llmTab.baseUrl', lang)}</label><input className="form-input" value={providerConfig.apiBaseUrl} readOnly style={{ opacity: 0.6, cursor: 'not-allowed' }} /></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="form-grp" style={{ flex: 1 }}><label className="form-label">{tt('llmTab.flashModel', lang)}</label><input className="form-input" value={providerConfig.flashModel} readOnly style={{ opacity: 0.6, cursor: 'not-allowed' }} /></div>
        <div className="form-grp" style={{ flex: 1 }}><label className="form-label">{tt('llmTab.proModel', lang)}</label><input className="form-input" value={providerConfig.proModel} readOnly style={{ opacity: 0.6, cursor: 'not-allowed' }} /></div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.5 }}>{tt('llmTab.contextWindow', lang).replace('{n}', (providerConfig.contextWindow / 1000).toFixed(0))}</div>
      <div className="form-grp">
        <label className="form-label">{tt('llmTab.apiKey', lang)} <span className="text-required">*</span></label>
        {keyConfigured && <p className="text-xs" style={{ color: 'var(--green)', marginBottom: 4 }}>{tt('llmTab.apiKeyConfigured', lang)}</p>}
        <input className="form-input" type="password" value={apiKey} onChange={e => { setApiKey(e.target.value); setTestPassed(false); setTestResult(''); setKeyConfigured(false); }} placeholder="sk-..." />
      </div>
      {testResult && <p style={{ fontSize: 12, marginBottom: 6, color: testResult.includes('✅') ? 'var(--green)' : 'var(--brand)' }}>{testResult}</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
        <button className="btn btn-sm" style={{ background: 'var(--brand)', color: '#fff', border: 'none' }} onClick={testConn} disabled={testing || !apiKey.trim()}>{testing ? t('testing') : t('testConn')}</button>
        {standalone && (
          <button className="btn btn-brand btn-sm" onClick={handleSave} disabled={saving}>{saving ? t('saving') : saved ? t('saved') : t('saveChanges')}</button>
        )}
      </div>
      {!testPassed && <p style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 500, marginTop: 6 }}>{t('apiKeyRequired')}</p>}
      <p className="text-xs text-ink-muted mt-3">
        <a href={providerConfig.keyUrl} target="_blank" style={{ color: 'var(--brand)' }}>{providerConfig.keyUrl.replace('https://', '').split('/')[0]}</a>
        {' — '}{lang === 'zh' ? providerConfig.keyDescription : providerConfig.keyDescriptionEn}
      </p>
    </div>
  );
}
