import { router, publicProcedure, z } from '../trpc';
import { prisma } from '@tomilite/database';
import { decrypt } from '../lib/crypto.js';
import { t } from '../lib/i18n.js';

const DEFAULT_MORNING_TIME = '09:00';
const DEFAULT_EVENING_TIME = '18:00';

const DEFAULT_SETTINGS = { morning: true, morningTime: DEFAULT_MORNING_TIME, evening: false, eveningTime: DEFAULT_EVENING_TIME };

async function getStandupSettings(): Promise<Record<string, any>> {
  const cfg = await prisma.systemConfig.findUnique({ where: { key: 'standupSettings' } });
  if (cfg?.value) return JSON.parse(cfg.value);
  // Seed DB with defaults on first access
  await prisma.systemConfig.create({ data: { key: 'standupSettings', value: JSON.stringify(DEFAULT_SETTINGS) } });
  return { ...DEFAULT_SETTINGS };
}

// ─── Shared data gathering for evening reports ───
async function gatherEveningData() {
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  // All tasks created or updated today (not just done) — exclude email-derived tasks
  const allIssues = (await prisma.issue.findMany({
    where: { projectId: 'proj-default', updatedAt: { gte: todayStr } },
    orderBy: { updatedAt: 'desc' },
  })).filter(i => i.type !== 'email');
  // Notes created/updated today
  const allNotes = await prisma.knowledgePage.findMany({
    where: { updatedAt: { gte: todayStr } },
    orderBy: { updatedAt: 'desc' },
  });
  // Reports created/updated today
  const allReports = await prisma.report.findMany({
    where: { generatedAt: { gte: todayStr } },
    orderBy: { generatedAt: 'desc' },
  });
  // Git commits today
  const gitCommits = await prisma.gitCommit.findMany({
    where: { timestamp: { gte: todayStr }, archived: false },
    orderBy: { timestamp: 'desc' },
    include: { repo: { select: { name: true } } },
  });
  // Status changes
  const changelog = await prisma.issueChangelog.findMany({
    where: { field: 'status', createdAt: { gte: todayStr } },
    include: { issue: { select: { issueNumber: true, title: true } } },
    orderBy: { createdAt: 'desc' }, take: 20,
  });
  const moves = changelog.map(c => ({
    key: `TL-${c.issue?.issueNumber || '?'}`, title: c.issue?.title || '',
    from: c.oldValue || 'new', to: c.newValue || '?',
  }));
  // Emails processed today
  const todayEmails = await prisma.smartEmail.findMany({
    where: { archived: false, createdAt: { gte: todayStr } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { today, todayStr, allIssues, allNotes, allReports, gitCommits, moves, todayEmails };
}

// ─── Shared LLM generation for evening reports ───
async function generateEveningContent(allIssues: any[], allNotes: any[], allReports: any[], gitCommits: any[], moves: any[], lang: string, todayEmails: any[] = []): Promise<string> {
  // Build data context for LLM
  const taskList = allIssues.map(t => `TL-${t.issueNumber} ${t.title} [${t.status}]`).join(', ') || 'none';
  const noteList = allNotes.slice(0, 10).map(n => n.title).join(', ') || 'none';
  const reportList = allReports.slice(0, 5).map(r => r.title).join(', ') || 'none';
  const commitList = gitCommits.slice(0, 15).map(c => `[${c.hash?.substring(0, 7)}] ${c.message?.substring(0, 80)}`).join('\n') || 'none';
  const moveList = moves.map(m => `${m.key} ${m.title}: ${m.from}→${m.to}`).join(', ') || 'none';

  // Try LLM
  try {
    const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
    if (provider?.apiKey) {
      const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
      const cfg = await prisma.llmConfig.findFirst();
      const baseUrl = master?.apiBaseUrl ;
      const model = cfg?.flashModel ;
      if (!baseUrl || !model) return ''; // LLM config incomplete
      const apiKey = await decrypt(provider.apiKey);
      // Labels from centralized i18n for LLM prompt
      const summaryLabel = t('standup.eveningSummary', lang).replace('📋 ', '');
      const criticalLabel = t('standup.criticalHeader', lang);
      const mediumLabel = t('standup.mediumHeader', lang);
      const lowLabel = t('standup.lowHeader', lang);
      const doneLabel = t('standup.doneHeader', lang).replace('✅ ', '');
      const codeLabel = t('standup.gitHeader', lang).replace('💻 ', '');
      const tomorrowLabel = t('standup.tomorrowLabel', lang).replace('💡 ', '');

      const emailList = todayEmails.map(e => `${e.category === 1 ? '🔴' : e.category === 2 ? '🟡' : '🔵'} [${e.fromAddr?.substring(0, 20)}] ${e.subject?.substring(0, 60)}`).join('\n') || 'none';

      const prompt = `You have this real data (ONLY use these — do NOT invent tasks):

Data:
- Tasks (all statuses): ${taskList}
- Notes: ${noteList}
- Reports: ${reportList}
- Git commits: ${commitList}
- Status changes: ${moveList}
- Emails today: ${emailList}

Generate a beautiful daily wrap-up report in ${t('standup.langName', lang)}.

## FORMAT (fill from real data above):

> **📋 ${summaryLabel}**
> One warm paragraph summarizing today's overall progress.

---

### 🔴 ${criticalLabel}
<ONLY if there are critical/high priority tasks — otherwise SKIP this entire section>
| Priority | Key | Task | Status |
|----------|-----|------|--------|
| <fill from real data — skip this section if empty> |

### 🟡 ${mediumLabel}
<ONLY if there are medium priority tasks — otherwise SKIP this entire section>
(same table format)

### 🟢 ${lowLabel}
<ONLY if there are low priority tasks — otherwise SKIP this entire section>
(same table format)

---

### ✅ ${doneLabel}
- item list

### 💻 ${codeLabel}
- Brief summary of git commits

### 📧 ${t('standup.emailHeader', lang)}
<ONLY if there are emails today — otherwise SKIP this entire section>
- Urgent/replied count + 2-3 key email subjects

---

> **💡 ${tomorrowLabel}**
> <Write 2-3 concrete prioritized action items here. Example: "1. Fix the login bug (critical) 2. Review PR #42 3. Update API docs." This section is REQUIRED.>

Style: Warm encouraging tone. Tables MUST use emoji in Priority column (🔴🟡🟢🔵). Every section MUST have content. Under 400 words. NO code blocks.

Data:
- Tasks (all statuses): ${taskList}
- Notes: ${noteList}
- Reports: ${reportList}
- Git commits: ${commitList}
- Status changes: ${moveList}`;
      const body: any = { model, messages: [{ role: 'user', content: prompt }], max_tokens: 1200 };
      if (baseUrl.includes('moonshot') || baseUrl.includes('deepseek')) body.thinking = { type: 'disabled' };
      else if (baseUrl.includes('dashscope')) body.enable_thinking = false;
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (resp.ok) {
        const d = await resp.json();
        const ai = (d.choices?.[0]?.message?.content || '').trim();
        if (ai) return ai;
      }
    }
  } catch { /* fallback */ }

  // Local fallback (when LLM is unavailable)
  const dateStr = new Date().toISOString().substring(0, 10);

  let md = `# ${t('standup.eveningTitle', lang)} — ${dateStr}\n\n`;
  md += `> **📋 ${t('standup.eveningSummary', lang)}**\n>\n>\n\n---\n\n`;

  // Group tasks by priority into tables
  const PRIO_ORDER = ['critical', 'high', 'medium', 'low'];
  const PRIO_EMOJI: Record<string, string> = { critical: '🔴', high: '🟡', medium: '🔵', low: '🟢' };
  const PRIO_KEY: Record<string, string> = { critical: 'standup.criticalHeader', high: 'standup.highHeader', medium: 'standup.mediumHeader', low: 'standup.lowHeader' };
  const STATUS_KEY: Record<string, string> = { done: 'standup.statusDone', in_progress: 'standup.statusProgress', todo: 'standup.statusTodo' };
  const STATUS_ICON: Record<string, string> = { done: '✅', in_progress: '🚧', todo: '📋' };

  if (allIssues.length === 0) {
    md += `${t('standup.noTasks', lang)}\n`;
  } else {
    for (const prio of PRIO_ORDER) {
      const items = allIssues.filter((i: any) => i.priority === prio);
      if (items.length === 0) continue;
      md += `### ${PRIO_EMOJI[prio]} ${t(PRIO_KEY[prio], lang)}\n`;
      md += t('standup.priorityTableHeader', lang) + '\n';
      for (const item of items) {
        const status = item.status || 'todo';
        md += `| ${PRIO_EMOJI[prio]} | TL-${item.issueNumber} | ${item.title} | ${STATUS_ICON[status]} ${t(STATUS_KEY[status], lang)} |\n`;
      }
      md += '\n';
    }
  }

  md += `---\n\n### ${t('standup.doneHeader', lang)}\n`;
  const doneTasks = allIssues.filter((i: any) => i.status === 'done');
  if (doneTasks.length === 0) md += t('standup.none', lang) + '\n';
  else for (const t of doneTasks) md += `- TL-${t.issueNumber} ${t.title} ✅\n`;

  if (allNotes.length > 0) {
    md += `\n### ${t('standup.notesHeader', lang)}\n`;
    for (const n of allNotes.slice(0, 10)) md += `- ${n.title}\n`;
  }
  if (allReports.length > 0) {
    md += `\n### ${t('standup.reportsHeader', lang)}\n`;
    for (const r of allReports.slice(0, 5)) md += `- ${r.title}\n`;
  }
  md += `\n### ${t('standup.gitHeader', lang)}\n`;
  if (gitCommits.length === 0) md += `${t('standup.noCommits', lang)}\n`;
  else for (const c of gitCommits.slice(0, 15)) md += `- [${c.hash?.substring(0, 7)}] ${c.message?.substring(0, 80)}\n`;
  if (moves.length > 0) {
    md += `\n### ${t('standup.boardHeader', lang)}\n`;
    for (const m of moves) md += `- ${m.key} ${m.title}: ${m.from} → ${m.to}\n`;
  }
  if (todayEmails.length > 0) {
    md += `\n### ${t('standup.emailHeader', lang)} (${todayEmails.length})\n`;
    for (const e of todayEmails.slice(0, 8)) {
      const cat = e.category === 1 ? '🔴' : e.category === 2 ? '🟡' : '🔵';
      md += `- ${cat} [${e.fromAddr?.substring(0, 25) || '?'}] ${e.subject?.substring(0, 60) || ''}\n`;
    }
  }
  md += `\n---\n\n> **${t('standup.tomorrowLabel', lang)}**\n${t('standup.tomorrowFallback', lang)}\n`;
  return md;
}

// ─── Morning scheduled check: generate brief 5min before time ───
export async function checkAndGenerateMorning(): Promise<void> {
  try {
    const settings = await getStandupSettings();
    if (settings.morning === false) return;
    const timeStr = settings.morningTime;
    const [th, tm] = timeStr.split(':').map(Number);
    const now = new Date();
    const today = now.toISOString().substring(0, 10);
    const generated = await prisma.systemConfig.findUnique({ where: { key: 'morningBriefDate' } });
    if (generated?.value === today) return;
    const scheduleMin = th * 60 + tm;
    const currentMin = now.getHours() * 60 + now.getMinutes();
    if (currentMin < scheduleMin - 5) return;     // too early
    if (currentMin >= scheduleMin + 180) return;   // too late (>=3h past scheduled time)
    // Just mark the date — actual greeting is generated on-demand by getMorningBrief
    await prisma.systemConfig.upsert({
      where: { key: 'morningBriefDate' },
      create: { key: 'morningBriefDate', value: today },
      update: { value: today },
    });
  } catch { /* non-critical */ }
}

// ─── Evening scheduled check: generate report 5min before time ───
export async function checkAndGenerateEvening(lang: string = 'en'): Promise<string | null> {
  try {
    const settings = await getStandupSettings();
    if (!settings.evening) return null; // disabled

    const timeStr = settings.eveningTime;
    const [th, tm] = timeStr.split(':').map(Number);
    const now = new Date();
    const today = now.toISOString().substring(0, 10);

    // Already generated today?
    const generated = await prisma.systemConfig.findUnique({ where: { key: 'eveningReportDate' } });
    if (generated?.value === today) return null;

    // Generate when current time is near scheduled time (5min before → 4h after)
    const scheduleMin = th * 60 + tm;
    const currentMin = now.getHours() * 60 + now.getMinutes();
    if (currentMin < scheduleMin - 5) return null;     // too early
    if (currentMin > scheduleMin + 240) return null;    // too late (>4h past)

    // Generate
    const { allIssues, allNotes, allReports, gitCommits, moves, todayEmails } = await gatherEveningData();
    if (allIssues.length === 0 && allNotes.length === 0 && allReports.length === 0 && gitCommits.length === 0 && moves.length === 0 && todayEmails.length === 0) return null;

    const content = await generateEveningContent(allIssues, allNotes, allReports, gitCommits, moves, lang, todayEmails);
    const langLabel = lang === 'zh' ? '📋 晚报' : lang === 'ja' ? '📋 イブニングレポート' : '📋 Evening Report';
    const nowStr = now.toISOString().replace('T', ' ').substring(0, 19);

    const saved = await prisma.report.create({
      data: { projectId: 'proj-default', reportType: 'daily', title: `${langLabel} — ${today}`, content, status: 'draft', generatedAt: nowStr },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'eveningReportDate' },
      create: { key: 'eveningReportDate', value: today },
      update: { value: today },
    });
    return saved.id;
  } catch (e) { console.error('[Standup] Evening check failed:', e); return null; }
}

export const standupRouter = router({
  // ─── Morning brief ───
  getMorningBrief: publicProcedure
    .input(z.object({ lang: z.string().default('en') }))
    .query(async ({ input }) => {
      const now = Date.now();
      const dayMs = 86400000;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();
      const yesterdayStart = new Date(today.getTime() - dayMs).toISOString();

      // Exclude email-derived tasks (type='email') — they are reported separately
      const allIssues = (await prisma.issue.findMany({ where: { projectId: 'proj-default' } }))
        .filter(i => i.type !== 'email');
      const openTasks = allIssues.filter(i => ['todo', 'in_progress'].includes(i.status));
      const doneYesterday = allIssues.filter(i =>
        i.status === 'done' && i.updatedAt && i.updatedAt >= yesterdayStart && i.updatedAt < todayStr
      );
      const overdue = openTasks.filter(i =>
        i.updatedAt && (now - new Date(i.updatedAt).getTime()) > 3 * dayMs
      ).map(i => ({
        key: `TL-${i.issueNumber}`, title: i.title, priority: i.priority,
        daysStale: Math.floor((now - new Date(i.updatedAt || now).getTime()) / dayMs),
      })).sort((a, b) => b.daysStale - a.daysStale);

      const todo = openTasks.filter(i => i.status === 'todo');
      const inProgress = openTasks.filter(i => i.status === 'in_progress');

      // ─── Email section: unprocessed action-required emails ───
      const pendingEmails = await prisma.smartEmail.findMany({
        where: { archived: false, isProcessed: false, category: { in: [1, 2] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      if (openTasks.length === 0 && doneYesterday.length === 0 && overdue.length === 0 && pendingEmails.length === 0) {
        return { todoCount: 0, inProgressCount: 0, doneYesterday: 0, overdueTasks: [], openTasks: [], greeting: '' };
      }

      // Group open tasks by priority, sorted critical → high → medium → low
      const PRIO_ORDER = ['critical', 'high', 'medium', 'low'];
      const PRIO_LABEL: Record<string, Record<string, string>> = {
        critical: { zh: '🔴 紧急', ja: '🔴 緊急', en: '🔴 Critical' },
        high: { zh: '🟡 高优先级', ja: '🟡 高優先', en: '🟡 High' },
        medium: { zh: '🔵 中等', ja: '🔵 中', en: '🔵 Medium' },
        low: { zh: '🟢 低优先级', ja: '🟢 低', en: '🟢 Low' },
      };
      const buildGreeting = () => {
        const lines: string[] = [];
        lines.push(t('standup.morningHello', input.lang));
        // Collect all items grouped by priority
        const rows: string[] = [];
        let totalItems = 0;
        for (const prio of PRIO_ORDER) {
          const items = openTasks.filter(t => t.priority === prio);
          if (items.length === 0) continue;
          totalItems += items.length;
          const label = PRIO_LABEL[prio]?.[input.lang] || PRIO_LABEL[prio]?.en || prio;
          for (const t of items.slice(0, 8)) rows.push(`| ${label} | TL-${t.issueNumber} | ${t.title} |`);
        }
        if (totalItems > 0) {
          lines.push('\n' + t('standup.morningTableHeader', input.lang));
          lines.push(...rows);
        } else {
          lines.push(`\n${t('standup.morningEmpty', input.lang)}`);
        }
        if (overdue.length > 0) {
          lines.push(`\n${t('standup.overdueLabel', input.lang)} (${overdue.length})`);
          for (const o of overdue.slice(0, 5)) lines.push(`| ⚠️ | ${o.key} | ${o.title} — ${o.daysStale}d |`);
        }
        if (doneYesterday.length > 0) {
          lines.push(`\n${t('standup.yesterdayDone', input.lang, { n: String(doneYesterday.length) })}`);
        }
        if (pendingEmails.length > 0) {
          lines.push(`\n${t('standup.emailHeader', input.lang)} (${pendingEmails.length})`);
          for (const e of pendingEmails.slice(0, 5)) {
            const cat = e.category === 1 ? '🔴' : '🟡';
            lines.push(`| ${cat} | ${e.fromAddr?.substring(0, 30) || '?'} | ${e.subject?.substring(0, 50) || ''} |`);
          }
        }
        // Encouragement + focus suggestion
        lines.push(`\n${t('standup.morningEncourage', input.lang)}`);
        lines.push(t('standup.morningFocus', input.lang));
        return lines.join('\n');
      };
      let greeting = buildGreeting();

      try {
        const provider = await prisma.llmProvider.findFirst({ where: { isActive: true } });
        if (provider?.apiKey) {
          const master = await prisma.llmProviderMaster.findFirst({ where: { providers: { some: { id: provider.id } } } });
          const cfg = await prisma.llmConfig.findFirst();
          const baseUrl = master?.apiBaseUrl ;
          const model = cfg?.flashModel ;
          if (!baseUrl || !model) return; // LLM config incomplete
          const apiKey = await decrypt(provider.apiKey);
          const taskList = openTasks.slice(0, 10).map(t => `TL-${t.issueNumber} ${t.title} (${t.priority})`).join('\n') || 'none';
          const overdueList = overdue.slice(0, 5).map(o => `${o.key} ${o.title} (${o.daysStale}d)`).join('\n') || 'none';
          const prompt = `You have these tasks (ONLY use these — do NOT invent tasks):

${taskList || '(no tasks)'}
${overdue.length > 0 ? '\nOverdue: ' + overdueList + '\n' : ''}${doneYesterday.length > 0 ? '\nCompleted yesterday: ' + doneYesterday.length + ' tasks\n' : ''}

Generate a morning check-in greeting in ${t('standup.langName', input.lang)}.

## FORMAT:

🌅 **${t('standup.morningHelloPlain', input.lang)}!**

> *One warm encouraging sentence for the day*

| Priority | Key | Task |
|----------|-----|------|
| <fill from real tasks above — skip priorities with no tasks> |
${overdue.length > 0 ? `\n⚠️ **${t('standup.overdueLabelPlain', input.lang)}** (${overdue.length})\n` + overdueList + '\n' : ''}${doneYesterday.length > 0 ? `\n✅ **${t('standup.yesterdayLabel', input.lang)}**: ${doneYesterday.length} tasks\n` : ''}

> 💡 **${t('standup.todayFocusLabel', input.lang)}**: <Write 1-2 concrete suggestions based on the real tasks above.>

Style: Warm and encouraging. ONLY use real tasks from the list above. Skip empty priorities. Keep under 250 words.`;
          const body: any = { model, messages: [{ role: 'user', content: prompt }], max_tokens: 500 };
          if (baseUrl.includes('moonshot') || baseUrl.includes('deepseek')) body.thinking = { type: 'disabled' };
          else if (baseUrl.includes('dashscope')) body.enable_thinking = false;
          const resp = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
          });
          if (resp.ok) { const d = await resp.json(); const ai = (d.choices?.[0]?.message?.content || '').trim().replace(/☀️?/g, '🌅'); if (ai) greeting = ai; }
        }
      } catch { /* fallback */ }

      return {
        todoCount: todo.length, inProgressCount: inProgress.length,
        doneYesterday: doneYesterday.length, overdueTasks: overdue,
        openTasks: openTasks.slice(0, 10).map(i => ({ key: `TL-${i.issueNumber}`, title: i.title, status: i.status, priority: i.priority })),
        greeting,
      };
    }),

  // ─── Evening report (manual via API — returns existing or generates once) ───
  getEveningReport: publicProcedure
    .input(z.object({ lang: z.string().default('en') }))
    .mutation(async ({ input }) => {
      const today = new Date().toISOString().substring(0, 10);
      const langLabel = input.lang === 'zh' ? '📋 晚报' : input.lang === 'ja' ? '📋 イブニングレポート' : '📋 Evening Report';
      const expectedTitle = `${langLabel} — ${today}`;

      // Check eveningReportDate first — if already generated, return existing
      const generated = await prisma.systemConfig.findUnique({ where: { key: 'eveningReportDate' } });
      if (generated?.value === today) {
        const existing = await prisma.report.findFirst({
          where: { reportType: 'daily', generatedAt: { gte: today + ' 00:00:00' } },
          orderBy: { generatedAt: 'desc' },
        });
        if (existing) {
          // Wrong language? Update title but keep content from the existing generation
          if (!existing.title.startsWith(langLabel)) {
            await prisma.report.update({ where: { id: existing.id }, data: { title: expectedTitle } }).catch(() => {});
            return { reportContent: existing.content, reportId: existing.id };
          }
          return { reportContent: existing.content, reportId: existing.id };
        }
      }

      // Delete any existing daily report from today (dedup — shouldn't happen but safeguard)
      const dupes = await prisma.report.findMany({
        where: { reportType: 'daily', generatedAt: { gte: today + ' 00:00:00' } },
        orderBy: { generatedAt: 'asc' },
      });
      if (dupes.length > 1) {
        for (let i = 0; i < dupes.length - 1; i++) {
          await prisma.report.delete({ where: { id: dupes[i].id } }).catch(() => {});
        }
      }

      // Not generated yet — generate now
      const { allIssues, allNotes, allReports, gitCommits, moves, todayEmails } = await gatherEveningData();
      if (allIssues.length === 0 && allNotes.length === 0 && allReports.length === 0 && gitCommits.length === 0 && moves.length === 0 && todayEmails.length === 0) {
        const emptyMsg = input.lang === 'zh' ? '今日暂无活动记录 😴' : input.lang === 'ja' ? '今日のアクティビティ記録はありません 😴' : 'No activity recorded today 😴';
        return { reportContent: emptyMsg, reportId: null };
      }
      const content = await generateEveningContent(allIssues, allNotes, allReports, gitCommits, moves, input.lang, todayEmails);
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      let reportId: string | null = null;
      try {
        const saved = await prisma.report.create({
          data: { projectId: 'proj-default', reportType: 'daily', title: expectedTitle, content, status: 'draft', generatedAt: now },
        });
        reportId = saved.id;
        // Mark as generated to prevent duplicate from background timer
        await prisma.systemConfig.upsert({
          where: { key: 'eveningReportDate' },
          create: { key: 'eveningReportDate', value: today },
          update: { value: today },
        });
      } catch (e: any) { console.error('[Standup] Failed to save evening report:', e?.message || e); }
      return { reportContent: content, reportId };
    }),

  // ─── Check if evening report is ready to notify (generate on-the-fly if needed) ───
  getEveningStatus: publicProcedure.query(async () => {
    const settings = await getStandupSettings();
    if (!settings.evening) return { notify: false };
    const timeStr = settings.eveningTime;
    const [th, tm] = timeStr.split(':').map(Number);
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const scheduleMin = th * 60 + tm;
    if (currentMin < scheduleMin) return { notify: false };      // too early
    if (currentMin > scheduleMin + 240) return { notify: false }; // too late (>4h past)

    const today = now.toISOString().substring(0, 10);
    // Already generated today (check date flag first)
    const generated = await prisma.systemConfig.findUnique({ where: { key: 'eveningReportDate' } });
    if (generated?.value === today) {
      const report = await prisma.report.findFirst({
        where: { reportType: 'daily', generatedAt: { gte: today + ' 00:00:00' }, status: 'draft' },
        orderBy: { generatedAt: 'desc' },
      });
      if (report) return { notify: true, reportId: report.id };
    }

    // Generate on-the-fly (app was closed at scheduled time)
    // Double check no race: re-check report exists
    const existingReport = await prisma.report.findFirst({
      where: { reportType: 'daily', generatedAt: { gte: today + ' 00:00:00' }, status: 'draft' },
      orderBy: { generatedAt: 'desc' },
    });
    if (existingReport) return { notify: true, reportId: existingReport.id };

    const { allIssues, allNotes, allReports, gitCommits, moves, todayEmails } = await gatherEveningData();
    if (allIssues.length === 0 && allNotes.length === 0 && allReports.length === 0 && gitCommits.length === 0 && moves.length === 0 && todayEmails.length === 0) return { notify: false };
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'uiLanguage' } });
    const lang = cfg?.value || 'en';
    const content = await generateEveningContent(allIssues, allNotes, allReports, gitCommits, moves, lang, todayEmails);
    const langLabel = lang === 'zh' ? '📋 晚报' : lang === 'ja' ? '📋 イブニングレポート' : '📋 Evening Report';
    const nowStr = now.toISOString().replace('T', ' ').substring(0, 19);
    let reportId: string | null = null;
    try {
      const saved = await prisma.report.create({ data: { projectId: 'proj-default', reportType: 'daily', title: `${langLabel} — ${today}`, content, status: 'draft', generatedAt: nowStr } });
      await prisma.systemConfig.upsert({ where: { key: 'eveningReportDate' }, create: { key: 'eveningReportDate', value: today }, update: { value: today } });
      reportId = saved.id;
    } catch { /* non-critical */ }
    return { notify: !!reportId, reportId };
  }),

  // ─── Check if morning brief is ready to notify (time reached + generated today) ───
  getMorningStatus: publicProcedure.query(async () => {
    const settings = await getStandupSettings();
    if (settings.morning === false) return { ready: false };
    const timeStr = settings.morningTime;
    const [th, tm] = timeStr.split(':').map(Number);
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const scheduleMin = th * 60 + tm;
    if (currentMin < scheduleMin) return { ready: false };      // too early
    if (currentMin > scheduleMin + 240) return { ready: false }; // too late (>4h past)
    return { ready: true };
  }),

  // ─── Settings ───
  getSettings: publicProcedure.query(async () => {
    try {
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'standupSettings' } });
      const parsed = cfg?.value ? JSON.parse(cfg.value) : {};
      return {
        morning: parsed.morning !== false, morningTime: parsed.morningTime || DEFAULT_MORNING_TIME,
        evening: parsed.evening !== false, eveningTime: parsed.eveningTime || DEFAULT_EVENING_TIME,
      };
    } catch { return { morning: true, morningTime: '09:00', evening: false, eveningTime: '18:00' }; }
  }),

  saveSettings: publicProcedure
    .input(z.object({ morning: z.boolean(), evening: z.boolean(), morningTime: z.string().optional(), eveningTime: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        await prisma.systemConfig.upsert({
          where: { key: 'standupSettings' },
          create: { key: 'standupSettings', value: JSON.stringify(input) },
          update: { value: JSON.stringify(input) },
        });
        console.warn('[Standup] Settings saved:', JSON.stringify(input));
        return { ok: true };
      } catch (e: any) {
        console.error('[Standup] Failed to save settings:', e?.message || e);
        return { ok: false, error: e?.message || 'Unknown error' };
      }
    }),
});
