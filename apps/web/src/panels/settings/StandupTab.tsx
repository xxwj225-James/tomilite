import { useState, useEffect } from "react";
import { t } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useLang } from "@/stores/useLang";

export function StandupTab() {
  const lang = useLang();
  const [morning, setMorning] = useState(true);
  const [morningTime, setMorningTime] = useState('09:00');
  const [evening, setEvening] = useState(false);
  const [eveningTime, setEveningTime] = useState('18:00');
  const [saved, setSaved] = useState<Record<string, any> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.standup.getSettings().then(s => {
      if (s) {
        setMorning(s.morning !== false); setMorningTime(s.morningTime || '09:00');
        setEvening(s.evening === true); setEveningTime(s.eveningTime || '18:00');
        setSaved({ morning: s.morning !== false, morningTime: s.morningTime || '09:00', evening: s.evening === true, eveningTime: s.eveningTime || '18:00' });
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const hasChanges = saved && (
    saved.morning !== morning || saved.morningTime !== morningTime ||
    saved.evening !== evening || saved.eveningTime !== eveningTime
  );

  const handleSave = async () => {
    if (morning && !morningTime) { setMorningTime('09:00'); return; }
    if (evening && !eveningTime) { setEveningTime('18:00'); return; }
    setSaving(true);
    const data = { morning, morningTime, evening, eveningTime };
    try {
      const result = await api.standup.saveSettings(data);
      if (result?.ok) {
        setSaved(data);
      } else {
        console.error('[StandupTab] Save returned unexpected:', result);
        alert(lang === 'zh' ? '保存失败，请重试' : 'Save failed, please retry');
      }
    } catch (e: any) {
      console.error('[StandupTab] Save failed:', e?.message || e);
      alert((lang === 'zh' ? '保存失败: ' : 'Save failed: ') + (e?.message || 'Unknown error'));
    }
    setSaving(false);
  };

  if (!loaded) return <div className="card"><div className="card-bd text-xs text-ink-muted" style={{ padding: 20, textAlign: 'center' }}>{t('misc.loading', lang)}</div></div>;

  return (
    <div>
      <div className="card">
        <div className="card-hd">{t('standupTab.morningCheckin', lang)}</div>
        <div className="card-bd">
          <p className="text-xs text-ink-muted mb-3">{t('standupTab.morningDesc', lang)}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 10 }}>
            <input type="checkbox" checked={morning} onChange={e => setMorning(e.target.checked)} style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 13 }}>{t('standupTab.enableMorning', lang)}</span>
          </label>
          {morning && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('standupTab.reminderTime', lang)}</span>
              <input type="time" value={morningTime} onChange={e => setMorningTime(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--edge)', background: 'var(--surface)' }} />
            </div>
          )}
        </div>
      </div>
      <div className="card" style={{ marginTop: 8 }}>
        <div className="card-hd">{t('standupTab.eveningReport', lang)}</div>
        <div className="card-bd">
          <p className="text-xs text-ink-muted mb-3">{t('standupTab.eveningDesc', lang)}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 10 }}>
            <input type="checkbox" checked={evening} onChange={e => setEvening(e.target.checked)} style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 13 }}>{t('standupTab.enableEvening', lang)}</span>
          </label>
          {evening && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('standupTab.generateTime', lang)}</span>
              <input type="time" value={eveningTime} onChange={e => setEveningTime(e.target.value)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--edge)', background: 'var(--surface)' }} />
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <button className="btn btn-brand btn-sm" onClick={handleSave} disabled={!hasChanges || saving}>
          {saving ? t('btn.saving', lang) : t('standupTab.saveSettings', lang)}
        </button>
        {hasChanges && <span style={{ fontSize: 11, color: 'var(--amber)', marginRight: 8 }}>{t('standupTab.unsavedChanges', lang)}</span>}
      </div>
    </div>
  );
}
