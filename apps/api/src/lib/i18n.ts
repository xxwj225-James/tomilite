/**
 * Backend i18n — centralized dictionary matching frontend @/lib/i18n pattern.
 * Usage: import { t } from '../lib/i18n.js'; → t('knowledge.noLlm', lang)
 */

const I18N: Record<string, Record<string, string>> = {
  // ═══ Knowledge Map ═══
  'knowledge.empty': { en: 'No tasks, notes or reports yet. Start creating content to build your knowledge map.', zh: '暂无任务、笔记或报告。开始创建内容来构建你的知识地图吧。', ja: 'タスク、ノート、レポートはまだありません。コンテンツを作成してナレッジマップを構築しましょう。' },
  'knowledge.noLlm': {
    en: 'No active LLM provider configured. Go to Settings → LLM to set up an API key.',
    zh: '未配置 LLM。请在 Settings → LLM 中设置 API Key。',
    ja: 'LLMが設定されていません。Settings → LLM でAPIキーを設定してください。',
  },
  'knowledge.noModel': {
    en: 'No LLM model configured. Go to Settings → LLM to select a model.',
    zh: '未配置 LLM 模型。请在 Settings → LLM 中选择模型。',
    ja: 'LLMモデルが設定されていません。Settings → LLM でモデルを選択してください。',
  },
  'knowledge.fallbackTitle': { en: 'Knowledge Map', zh: '知识地图', ja: 'ナレッジマップ' },
  'knowledge.fallbackDomains': { en: 'Core Domains', zh: '核心领域', ja: 'コアドメイン' },
  'knowledge.fallbackTasks': { en: '{n} tasks across various statuses', zh: '{n} 个不同状态的任务', ja: '{n}件の様々なステータスのタスク' },
  'knowledge.fallbackNotes': { en: '{n} notes in the knowledge base', zh: '{n} 条知识库笔记', ja: '{n}件のナレッジベースノート' },
  'knowledge.fallbackReports': { en: '{n} reports generated', zh: '{n} 份报告', ja: '{n}件のレポート' },
  'knowledge.fallbackHint': { en: 'Start categorizing your work for a richer map.', zh: '开始整理工作内容，构建更丰富的知识地图。', ja: '作業を分類して、より豊かなマップを構築しましょう。' },
  'knowledge.fallbackError': { en: 'Generation failed', zh: '生成失败', ja: '生成失敗' },

  // ═══ Standup / Daily Reports ═══
  'standup.eveningTitle': { en: '📋 Evening Report', zh: '📋 晚报', ja: '📋 イブニングレポート' },
  'standup.eveningSummary': { en: "Today's work overview", zh: '今日工作概览', ja: '今日の作業概要' },
  'standup.noTasks': { en: 'No tasks today.', zh: '今日暂无任务。', ja: '今日のタスクはありません。' },
  'standup.doneHeader': { en: '✅ Completed Today', zh: '✅ 今日完成', ja: '✅ 今日の完了' },
  'standup.notesHeader': { en: '📝 Notes', zh: '📝 笔记', ja: '📝 ノート' },
  'standup.reportsHeader': { en: '📊 Reports', zh: '📊 报告', ja: '📊 レポート' },
  'standup.gitHeader': { en: '💻 Code Activity', zh: '💻 代码活动', ja: '💻 コードアクティビティ' },
  'standup.noCommits': { en: 'No commits today.', zh: '今日无提交。', ja: '今日のコミットはありません。' },
  'standup.boardHeader': { en: '🔀 Board Moves', zh: '🔀 看板变更', ja: '🔀 かんばん変更' },
  'standup.tomorrowLabel': { en: "💡 Tomorrow's Focus", zh: '💡 明日建议', ja: '💡 明日の提案' },
  'standup.tomorrowFallback': {
    en: '> 1. Prioritize overdue and urgent tasks\n> 2. Move forward on in-progress work\n> 3. Check CI/CD and code reviews',
    zh: '> 1. 优先处理逾期和紧急任务\n> 2. 推进进行中的工作\n> 3. 检查 CI/CD 和代码审查',
    ja: '> 1. 期限超過と緊急タスクを優先\n> 2. 進行中の作業を進める\n> 3. CI/CD とコードレビューをチェック',
  },
  'standup.criticalHeader': { en: 'Critical & High Priority', zh: '紧急 & 高优先级', ja: '緊急 & 高優先' },
  'standup.highHeader': { en: 'High Priority', zh: '高优先级', ja: '高優先' },
  'standup.mediumHeader': { en: 'Medium Priority', zh: '中等优先级', ja: '中優先' },
  'standup.lowHeader': { en: 'Low Priority / Backlog', zh: '低优先级 / 待办', ja: '低優先 / バックログ' },
  'standup.none': { en: '- None', zh: '- 暂无', ja: '- なし' },
  'standup.priorityTableHeader': {
    en: '| Priority | Key | Task | Status |\n|----------|-----|------|--------|',
    zh: '| 优先级 | Key | 任务 | 状态 |\n|----------|-----|------|------|',
    ja: '| 優先度 | Key | タスク | ステータス |\n|----------|-----|--------|------------|',
  },
  'standup.statusDone': { en: 'Done', zh: '完成', ja: '完了' },
  'standup.statusProgress': { en: 'In Progress', zh: '进行中', ja: '進行中' },
  'standup.statusTodo': { en: 'Todo', zh: '待办', ja: '未着手' },
  'standup.morningHello': { en: '🌅 **Good morning!**', zh: '☀️ **早上好！**', ja: '☀️ **おはようございます！**' },
  'standup.morningEncourage': { en: '> *Make today count!*', zh: '> *新的一天，继续加油！*', ja: '> *新しい一日、頑張りましょう！*' },
  'standup.morningFocus': {
    en: "> 💡 **Today's Focus**: Tackle overdue and critical items first, then move forward on in-progress work.",
    zh: '> 💡 **今日建议**: 先处理过期和紧急任务，再推进进行中的工作。',
    ja: '> 💡 **今日の提案**: 期限超過と緊急タスクを優先し、進行中の作業を進めましょう。',
  },
  'standup.morningEmpty': { en: 'No pending tasks today 🎉', zh: '今天没有待办任务 🎉', ja: '今日のタスクはありません 🎉' },
  'standup.overdueLabel': { en: '⚠️ Overdue', zh: '⚠️ 过期', ja: '⚠️ 期限超過' },
  'standup.overdueLabelPlain': { en: 'Overdue', zh: '过期', ja: '期限超過' },
  'standup.yesterdayDone': { en: '✅ {n} completed yesterday', zh: '✅ 昨日完成 {n} 个任务', ja: '✅ 昨日 {n} 件完了' },
  'standup.emailHeader': { en: '📧 Pending Emails', zh: '📧 待处理邮件', ja: '📧 未処理メール' },
  'standup.yesterdayLabel': { en: 'Yesterday', zh: '昨日完成', ja: '昨日の完了' },
  'standup.langName': { en: 'English', zh: 'Chinese', ja: 'Japanese' },
  'standup.morningHelloPlain': { en: 'Good morning', zh: '早上好', ja: 'おはようございます' },
  'standup.todayFocusLabel': { en: "Today's Focus", zh: '今日建议', ja: '今日の提案' },
  // ═══ Email errors ═══
  'email.noSmtpFound': { en: 'No SMTP config found', zh: '未找到 SMTP 配置', ja: 'SMTP設定が見つかりません' },
  'email.smtpIncomplete': { en: 'SMTP config incomplete', zh: 'SMTP 配置不完整', ja: 'SMTP設定が不完全です' },
  'email.noPassword': { en: 'SMTP password not configured', zh: '未配置 SMTP 密码', ja: 'SMTPパスワードが未設定です' },
  'email.notFound': { en: 'Email not found', zh: '邮件未找到', ja: 'メールが見つかりません' },
  'email.noImap': { en: 'No active IMAP connection', zh: '无活跃的 IMAP 连接', ja: 'IMAP接続がありません' },
  'email.connectorNA': { en: 'Connector not available', zh: '连接器不可用', ja: 'コネクターが利用できません' },
  'email.alreadyProcessed': { en: 'Email not found or already processed', zh: '邮件未找到或已处理', ja: 'メールが見つからないか既に処理済みです' },
  'email.noLlmKey': { en: 'No LLM API key configured', zh: '未配置 LLM API Key', ja: 'LLM APIキーが設定されていません' },
  'email.llmIncomplete': { en: 'LLM config incomplete', zh: 'LLM 配置不完整', ja: 'LLM設定が不完全です' },
  'email.noImapFound': { en: 'No IMAP config found', zh: '未找到 IMAP 配置', ja: 'IMAP設定が見つかりません' },
  'email.connectionFailed': { en: 'Connection failed', zh: '连接失败', ja: '接続失敗' },
  'email.taskAlreadyLinked': { en: 'Task already linked', zh: '已关联任务', ja: 'タスクは既に関連付けられています' },

  // ═══ Health Score ═══
  'health.recStaleness': { en: 'Several issues are stale (14+ days old). Consider closing or scheduling them.', zh: '有多个任务停滞超过14天，考虑关闭或重新安排。', ja: '14日以上停滞しているタスクがあります。クローズまたは再スケジュールを検討してください。' },
  'health.recGit': { en: 'No commits tracked today. Install the git hook with "tomat init" to link commits.', zh: '今日还没有跟踪到 commit，使用 "tomat init" 安装 Git hook。', ja: '今日のコミットが追跡されていません。"tomat init"でGitフックをインストールしてください。' },
  'health.recCompletion': { en: 'Low completion rate. Break large tasks into smaller, actionable items.', zh: '任务完成率偏低，试着把大任务拆分成更小的可执行项。', ja: '完了率が低いです。大きなタスクを小さな項目に分割してみてください。' },
  'health.fallbackSummary': { en: '{score}/100 — {level}. {done} done, {inProgress} in progress, {todo} todo.', zh: '{score}/100 — {level}。{done} 完成，{inProgress} 进行中，{todo} 待办。', ja: '{score}/100 — {level}。{done} 完了、{inProgress} 進行中、{todo} ToDo。' },
  'health.trend.up': { en: '📈 On the rise! Keep the momentum going!', zh: '📈 势头上升！保持这股劲头！', ja: '📈 上昇中！この勢いを続けよう！' },
  'health.trend.down': { en: '📉 A small dip — tomorrow is a fresh start!', zh: '📉 稍有回落 — 明天是新开始！', ja: '📉 少し下降 — 明日は新しいスタート！' },
  'health.trend.steady': { en: '➡️ Steady and consistent — keep it up!', zh: '➡️ 稳定向前 — 持之以恒！', ja: '➡️ 安定して継続中 — その調子！' },
  'email.noLinkedTask': { en: 'No linked task', zh: '无关联任务', ja: '関連タスクがありません' },

  'standup.morningTableHeader': {
    en: '| Priority | Key | Task |\n|----------|-----|------|',
    zh: '| 优先级 | Key | 任务 |\n|--------|-----|------|',
    ja: '| 優先度 | Key | タスク |\n|--------|-----|--------|',
  },
};

export function t(key: string, lang: string, vars?: Record<string, string>): string {
  const entry = I18N[key];
  let text = entry?.[lang] || entry?.en || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}
