import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useUICommandStore } from '@/stores/uiCommandStore';
import { useLang } from '@/stores/useLang';
import { HomePanel } from '@/panels/HomePanel';
import { TasksPanel } from '@/panels/tasks/TasksPanel';
import { NotesPanel } from '@/panels/notes/NotesPanel';
import { EmailPanel } from '@/panels/email/EmailPanel';
import { ReportsPanel } from '@/panels/reports/ReportsPanel';
import { McpPanel } from '@/panels/mcp/McpPanel';
import { FeedbackPanel } from '@/panels/feedback/FeedbackPanel';
import { SettingsPanel } from '@/panels/settings/SettingsPanel';
import { AboutPanel } from '@/panels/AboutPanel';

// ═══ Content Panel — keep-alive routing (lazy-mount on first visit, then hide/show) ═══

const MENU_TEXTS: Record<string, Record<string, string>> = {
  en: { home: 'Home', tasks: 'Tasks', notes: 'Notes', email: 'Email', mcp: 'MCP Approve', reports: 'Reports', feedback: 'Feedback', settings: 'Settings', about: 'About' },
  zh: { home: '首页', tasks: '任务', notes: '笔记', email: '邮件', mcp: 'MCP审批', reports: '报告', feedback: '反馈', settings: '设置', about: '关于' },
  ja: { home: 'ホーム', tasks: 'タスク', notes: 'ノート', email: 'メール', mcp: 'MCP 承認', reports: 'レポート', feedback: 'フィードバック', settings: '設定', about: 'About' },
  th: { home: 'หน้าแรก', tasks: 'งาน', notes: 'บันทึก', email: 'อีเมล', mcp: 'ตรวจสอบ MCP', reports: 'รายงาน', feedback: 'ข้อเสนอแนะ', settings: 'การตั้งค่า' },
  mi: { home: 'Kāinga', tasks: 'Mahi', notes: 'Tuhipoka', email: 'Īmēra', mcp: 'Arotake MCP', reports: 'Pūrongo', feedback: 'Urupare', settings: 'Tautuhinga' },
  ru: { home: 'Главная', tasks: 'Задачи', notes: 'Заметки', email: 'Почта', mcp: 'Аудит MCP', reports: 'Отчёты', feedback: 'Отзывы', settings: 'Настройки' },
};

function tMenu(key: string, lang: string) {
  return MENU_TEXTS[lang]?.[key] || MENU_TEXTS.en[key] || key;
}

interface Props {
  panel: string | null;
  onClose: () => void;
  onEditingNote?: (note: { id?: string; title: string; content: string; category: string } | null) => void;
  onEditingTask?: (task: { issueNumber?: number; id?: string; title: string; description: string; status: string; priority: string; storyPoints?: number } | null) => void;
  onEditingReport?: (report: { title: string; content: string; id?: string } | null) => void;
  onNoteAction?: (action: string) => void;
  onReportAction?: (action: string) => void;
  noteRefresh?: number;
  taskRefresh?: number;
  reportRefresh?: number;
  emailRefresh?: number;
  appliedEdit?: { title?: string; content?: string; category?: string } | null;
  appliedTaskEdit?: Record<string, any> | null;
  appliedReport?: { title?: string; content?: string } | null;
}

function PanelBody({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: active ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
      {children}
    </div>
  );
}

export function ContentPanel({ panel, onClose, onEditingNote, onEditingTask, onEditingReport, onNoteAction, onReportAction, noteRefresh, taskRefresh, reportRefresh, emailRefresh, appliedEdit, appliedTaskEdit, appliedReport }: Props) {
  const lang = useLang();
  const { queue, clearType } = useUICommandStore();
  const mountedRef = useRef<Set<string>>(new Set());
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const cmd = queue.find(c => c.type === 'navigate');
    if (cmd) {
      clearType('navigate');
      const targetPanel = cmd.payload.panel;
      if (targetPanel === 'notes' || targetPanel === 'tasks' || targetPanel === 'reports' || targetPanel === 'email') {
        window.dispatchEvent(new CustomEvent('tl-navigate', { detail: targetPanel }));
      }
    }
  }, [queue, clearType]);

  // Lazy-mount: track which panels have been opened, keep them alive thereafter
  useEffect(() => {
    if (panel && !mountedRef.current.has(panel)) {
      mountedRef.current.add(panel);
      forceUpdate(n => n + 1); // trigger render to include new panel
    }
  }, [panel]);

  const mounted = mountedRef.current;

  return (
    <div className={cn('panel', panel ? 'panel--open' : '')}>
      <div className="panel-header">
        <h3 className="panel-title">{panel === 'about' ? '' : tMenu(panel || '', lang)}</h3>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>
      <div className="panel-body">
        {mounted.has('home') && (
          <PanelBody active={panel === 'home'}>
            <HomePanel />
          </PanelBody>
        )}
        {mounted.has('tasks') && (
          <PanelBody active={panel === 'tasks'}>
            <TasksPanel onEditingTask={onEditingTask} appliedTaskEdit={appliedTaskEdit} taskRefresh={taskRefresh} active={panel === 'tasks'} />
          </PanelBody>
        )}
        {mounted.has('email') && (
          <PanelBody active={panel === 'email'}>
            <EmailPanel emailRefresh={emailRefresh} active={panel === 'email'} />
          </PanelBody>
        )}
        {mounted.has('notes') && (
          <PanelBody active={panel === 'notes'}>
            <NotesPanel onEditingNote={onEditingNote} onNoteAction={onNoteAction} noteRefresh={noteRefresh} appliedEdit={appliedEdit} active={panel === 'notes'} />
          </PanelBody>
        )}
        {mounted.has('reports') && (
          <PanelBody active={panel === 'reports'}>
            <ReportsPanel onEditingReport={onEditingReport} onReportAction={onReportAction} appliedReport={appliedReport} reportRefresh={reportRefresh} active={panel === 'reports'} />
          </PanelBody>
        )}
        {mounted.has('mcp') && (
          <PanelBody active={panel === 'mcp'}>
            <McpPanel />
          </PanelBody>
        )}
        {mounted.has('feedback') && (
          <PanelBody active={panel === 'feedback'}>
            <FeedbackPanel />
          </PanelBody>
        )}
        {mounted.has('settings') && (
          <PanelBody active={panel === 'settings'}>
            <SettingsPanel />
          </PanelBody>
        )}
        {mounted.has('about') && (
          <PanelBody active={panel === 'about'}>
            <AboutPanel />
          </PanelBody>
        )}
      </div>
    </div>
  );
}
