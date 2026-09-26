// Centralized i18n config — all UI strings in one file
// Usage: import { t } from '@/lib/i18n';  →  {t('chat.placeholder', lang)}
//
// Supported languages: en, zh, ja (th/mi/ru are reserved for future use, currently fallback to en)
// When adding th/mi/ru UI support in the future, just add translations to the relevant keys below.

const I18N = {
  // ═══ Telemetry (anonymous usage stats — opt-in) ═══
  'telemetry.dialogTitle': {
    en: 'Help improve TomiLite (optional)',
    zh: '帮助改进 TomiLite(可选)',
    ja: 'TomiLite の改善にご協力(任意)',
  },
  'telemetry.dialogLead': {
    en: 'May we collect anonymous usage statistics? We want to know how many real users TomiLite has and which features they actually use, so we can make it better.',
    zh: '是否允许我们收集匿名的使用统计?我们想知道有多少真实用户在用自己的 TomiLite、主要用了哪些功能,以便把它做得更好。',
    ja: '匿名の利用統計を収集してもよろしいですか?実際のユーザー数と、どの機能が使われているかを知ることで改善に役立てたいと考えています。',
  },
  'telemetry.collectedTitle': { en: 'We collect', zh: '会收集', ja: '収集するもの' },
  'telemetry.collected': {
    en: 'Which panels you open (Tasks / Notes / Email / Reports / Home / MCP / Settings / About)\nAggregate counts of tasks, notes, reports, emails, chat sessions and focus time you create\nWhich AI tools you run and which export formats you use\nApp version, operating system, interface language',
    zh: '打开过的功能(任务 / 笔记 / 邮件 / 报告 / 首页 / MCP / 设置 / 关于)\n创建的任务、笔记、报告、邮件、对话、专注时长等汇总计数\n使用过的 AI 工具、手动导出的文件格式\n应用版本、操作系统、界面语言',
    ja: '開いた機能(タスク / ノート / メール / レポート / ホーム / MCP / 設定 / 詳細)\n作成したタスク・ノート・レポート・メール・会話・集中時間などの集計\n使用した AI ツールと書き出したファイル形式\nアプリバージョン、OS、表示言語',
  },
  'telemetry.neverTitle': { en: 'We never collect', zh: '绝不收集', ja: '絶対に収集しないもの' },
  'telemetry.never': {
    en: 'Chat content, file or note contents, email bodies, code, file names, API keys — no personal data of any kind.',
    zh: '聊天内容、文件与笔记正文、邮件正文与标题、代码、文件名、API Key 等任何个人信息,一概不采集。',
    ja: 'チャット内容、ファイル・ノート本文、メール本文、コード、ファイル名、APIキーなど、個人情報は一切収集しません。',
  },
  'telemetry.dest': {
    en: 'Aggregates are sent to tomatovector.com (viewable only by the author) to improve the product. Never sold or shared.',
    zh: '汇总数据仅发送至 tomatovector.com(仅作者本人查看),用于改进产品,绝不出售或共享。',
    ja: '集計データは tomatovector.com に送信され(作者のみ閲覧)、製品改善にのみ使用されます。販売・共有は一切しません。',
  },
  'telemetry.manage': {
    en: 'You can turn this off anytime in About → Privacy & Usage Statistics. Turning it off clears the locally staged data.',
    zh: '可在「关于 → 隐私与匿名使用统计」随时关闭;关闭会同时清除本机已暂存的数据。',
    ja: '「詳細 → プライバシーと利用統計」でいつでもオフにできます。オフにすると端末に保存されたデータも削除されます。',
  },
  'telemetry.agree': { en: 'Agree & start using', zh: '同意并开始使用', ja: '同意して利用開始' },
  'telemetry.decline': { en: 'No, thanks', zh: '暂不参与', ja: '参加しない' },
  'telemetry.aboutTitle': { en: 'Privacy & Usage Statistics', zh: '隐私与匿名使用统计', ja: 'プライバシーと利用統計' },
  'telemetry.aboutLabel': {
    en: 'Share anonymous usage statistics to help improve TomiLite',
    zh: '匿名分享使用数据,帮助改进 TomiLite',
    ja: 'TomiLite 改善のため匿名の利用統計を共有する',
  },
  'telemetry.aboutDesc': {
    en: 'Aggregates only: panels opened, item counts, AI tools used, app version/OS/language. No chat, file, email, code or key content. Turning this off clears locally staged data.',
    zh: '仅统计匿名使用情况(打开的功能、创建数量、使用的 AI 工具、应用版本/系统/语言),不含任何内容或密钥;关闭会清除本机暂存数据。',
    ja: '匿名の利用状況のみ(開いた機能、作成数、使用 AI ツール、バージョン/OS/言語)。コンテンツやキーは含みません。オフで端末の保存データも削除されます。',
  },
  // ═══ Chat Area ═══
  'chat.placeholder': {
    en: 'Ask me anything...',
    zh: '随时问我...',
    ja: '何でも聞いてください...',
    th: 'ถามอะไรก็ได้...',
    mi: 'Pātai mai...',
    ru: 'Спросите что угодно...',
  },
  'chat.thinking': {
    en: 'Thinking...',
    zh: '思考中...',
    ja: '考え中...',
    th: 'กำลังคิด...',
    mi: 'E whakaaro ana...',
    ru: 'Думаю...',
  },
  'chat.queued': { en: 'Queued...', zh: '已排队...', ja: '待機中...' },
  'chat.working': {
    en: 'Working...',
    zh: '工作中...',
    ja: '作業中...',
    th: 'กำลังทำงาน...',
    mi: 'E mahi ana...',
    ru: 'Работаю...',
  },
  'chat.send': { en: 'Send', zh: '发送', ja: '送信', th: 'ส่ง', mi: 'Tuku', ru: 'Отправить' },
  'chat.newLine': { en: 'New line', zh: '换行', ja: '改行', th: 'บรรทัดใหม่', mi: 'Rārangi hou', ru: 'Новая строка' },
  'chat.noLLM': {
    en: '⚠️ LLM API Key not configured. AI chat unavailable.\n\nPlease configure your API Key in Settings → LLM.',
    zh: '⚠️ 未配置 LLM API Key，AI 聊天功能不可用。\n\n请在 Settings → LLM 中配置 API Key 后再试。',
    ja: '⚠️ LLM APIキーが未設定です。\n\nSettings → LLM でAPIキーを設定してください。',
  },
  'chat.sendEnter': {
    en: 'Send (Enter)',
    zh: '发送 (Enter)',
    ja: '送信 (Enter)',
    th: 'ส่ง (Enter)',
    mi: 'Tuku (Enter)',
    ru: 'Отправить (Enter)',
  },
  'chat.sendToInterrupt': {
    en: 'Send to interrupt',
    zh: '发送并中断',
    ja: '送信して中断',
    th: 'ส่งเพื่อขัดจังหวะ',
    mi: 'Tuku hei haukoti',
    ru: 'Отправить и прервать',
  },
  'chat.hintEsc': {
    en: '⏹ Esc to stop  ·  Type to interrupt',
    zh: '⏹ Esc 停止  ·  输入以中断',
    ja: '⏹ Escで停止  ·  入力して中断',
    th: '⏹ Esc เพื่อหยุด  ·  พิมพ์เพื่อขัดจังหวะ',
    mi: '⏹ Pēhi Esc hei whakamutu',
    ru: '⏹ Esc для остановки  ·  Ввод для прерывания',
  },
  'chat.compress': { en: 'Compress', zh: '压缩', ja: '圧縮', th: 'บีบอัด', mi: 'Whakarāpopoto', ru: 'Сжать' },
  'chat.compressing': {
    en: 'Compressing...',
    zh: '压缩中...',
    ja: '圧縮中...',
    th: 'กำลังบีบอัด...',
    mi: 'E whakarāpopoto ana...',
    ru: 'Сжимаю...',
  },
  'chat.clear': { en: 'Clear', zh: '清除', ja: 'クリア', th: 'ล้าง', mi: 'Whakawātea', ru: 'Очистить' },
  'chat.compressTooltip': {
    en: 'Compress — summarize conversation',
    zh: '压缩 — 总结对话',
    ja: '圧縮 — 会話を要約',
    th: 'บีบอัด — สรุปการสนทนา',
    mi: 'Whakarāpopoto — whakarāpopotohia te kōrero',
    ru: 'Сжать — суммировать разговор',
  },
  'chat.clearTooltip': {
    en: 'Clear messages',
    zh: '清除消息',
    ja: 'メッセージをクリア',
    th: 'ล้างข้อความ',
    mi: 'Whakawātea karere',
    ru: 'Очистить сообщения',
  },
  'chat.modeToDark': {
    en: 'Switch to dark mode',
    zh: '切换到深色模式',
    ja: 'ダークモードに切り替え',
  },
  'chat.modeToLight': {
    en: 'Switch to light mode',
    zh: '切换到浅色模式',
    ja: 'ライトモードに切り替え',
  },
  // Settings → Appearance. Theme and light/dark are two axes, so they are
  // presented as two controls rather than one list of eight combinations.
  'settings.tab.appearance': { en: 'Appearance', zh: '外观', ja: '外観' },
  'appearance.theme': { en: 'Theme', zh: '主题', ja: 'テーマ' },
  'appearance.themeHint': {
    en: 'Sets the accent colour and the neutral surfaces. Independent of light or dark — any theme works in either.',
    zh: '决定强调色与中性底色。与明暗相互独立 —— 每套主题都能用在两种模式里。',
    ja: 'アクセントカラーと中間色を決めます。ライト／ダークとは独立で、どのテーマも両モードで使えます。',
  },
  'appearance.mode': { en: 'Light / dark', zh: '明暗', ja: 'ライト / ダーク' },
  'appearance.modeLight': { en: 'Light', zh: '浅色', ja: 'ライト' },
  'appearance.modeDark': { en: 'Dark', zh: '深色', ja: 'ダーク' },
  'appearance.modeHint': {
    en: 'Applies on top of the theme above. Takes effect immediately and is remembered across restarts.',
    zh: '叠加在上方主题之上。立即生效，重启后仍保留。',
    ja: '上のテーマに重ねて適用されます。すぐに反映され、再起動後も保持されます。',
  },
  // Celebrations are device-local like the two above: they decide what this machine draws,
  // and nothing on the server reads the flag.
  'appearance.celebrations': { en: 'Celebrations', zh: '庆祝动画', ja: 'お祝い' },
  'appearance.celebrationsEnable': {
    en: 'Show a celebration when a milestone is reached',
    zh: '达成里程碑时播放庆祝动画',
    ja: 'マイルストーン達成時にお祝いを表示',
  },
  'appearance.celebrationsHint': {
    en: 'A short confetti burst at round numbers: finished tasks, notes in the knowledge map, or a health score of excellent. Each milestone plays once, ever.',
    zh: '在整数关口播放一小段彩纸动画：完成的任务数、知识地图里的笔记数、或健康分达到「优秀」。每个里程碑只播一次。',
    ja: '節目の数で短い紙吹雪を表示します:完了タスク数、ナレッジマップのノート数、ヘルススコア「優秀」。各マイルストーンは一度だけ再生されます。',
  },
  'chat.download': { en: 'Download', zh: '下载', ja: 'ダウンロード', th: 'ดาวน์โหลด', mi: 'Tikiake', ru: 'Скачать' },
  'chat.uploadFile': {
    en: 'Upload file',
    zh: '上传文件',
    ja: 'ファイルをアップロード',
    th: 'อัปโหลดไฟล์',
    mi: 'Tukuatu kōnae',
    ru: 'Загрузить файл',
  },
  'chat.compressTitle': {
    en: 'Compress Chat',
    zh: '压缩对话',
    ja: 'チャットを圧縮',
    th: 'บีบอัดแชท',
    mi: 'Whakarāpopoto Kōrero',
    ru: 'Сжать чат',
  },
  'chat.compressMessage': {
    en: 'Summarize this conversation into 2-3 bullet points? The summary will be sent as a new message to condense the context.',
    zh: '将本次对话总结为2-3个要点？总结将作为新消息发送以压缩上下文。',
    ja: 'この会話を2-3の箇条書きに要約しますか？要約が新しいメッセージとして送信され、コンテキストが圧縮されます。',
    th: 'สรุปการสนทนานี้เป็น 2-3 ข้อ?',
    mi: 'Whakarāpopotohia tēnei kōrero?',
    ru: 'Суммировать этот разговор в 2-3 пункта?',
  },
  'chat.compressTooFew': {
    en: 'Chat history is too short — need at least 4 messages to compress.',
    zh: '聊天记录太少，至少需要 4 条消息才能压缩。',
    ja: 'チャット履歴が短すぎます — 圧縮には少なくとも4つのメッセージが必要です。',
  },
  'chat.compressBusy': {
    en: 'A message is still generating — wait for it to finish before compressing.',
    zh: '当前有消息正在生成，请等待完成后再压缩。',
    ja: 'メッセージが生成中です — 完了するまで圧縮できません。',
  },
  'chat.tokens': { en: 'tokens', zh: 'tokens', ja: 'トークン', th: 'โทเค็น', mi: 'tokens', ru: 'токены' },

  // ═══ Menu Bar ═══
  'menu.home': { en: 'Home', zh: '首页', ja: 'ホーム', th: 'หน้าแรก', mi: 'Kāinga', ru: 'Главная' },
  'menu.tasks': { en: 'Tasks', zh: '任务', ja: 'タスク', th: 'งาน', mi: 'Mahi', ru: 'Задачи' },
  'menu.notes': { en: 'Notes', zh: '笔记', ja: 'ノート', th: 'บันทึก', mi: 'Tuhipoka', ru: 'Заметки' },
  'menu.email': { en: 'Email', zh: '邮件', ja: 'メール', th: 'อีเมล', mi: 'Īmēra', ru: 'Почта' },
  'menu.mcp': {
    en: 'MCP Approve',
    zh: 'MCP审批',
    ja: 'MCP 承認',
    th: 'ตรวจสอบ MCP',
    mi: 'Arotake MCP',
    ru: 'Аудит MCP',
  },
  'menu.reports': { en: 'Reports', zh: '报告', ja: 'レポート', th: 'รายงาน', mi: 'Pūrongo', ru: 'Отчёты' },
  'menu.feedback': { en: 'Feedback', zh: '反馈', ja: 'フィードバック', th: 'ข้อเสนอแนะ', mi: 'Urupare', ru: 'Отзывы' },
  'menu.settings': { en: 'Settings', zh: '设置', ja: '設定', th: 'การตั้งค่า', mi: 'Tautuhinga', ru: 'Настройки' },
  'menu.newChat': {
    en: '+ New Chat',
    zh: '+ 新对话',
    ja: '+ 新規チャット',
    th: '+ แชทใหม่',
    mi: '+ Kōrero Hou',
    ru: '+ Новый чат',
  },
  // Date headings in the session list. That list is ordered by recency, and once
  // the titles are generated the ordering is the only thing telling one row from
  // the next — so it gets labelled instead of being left implicit.
  'sidebar.today': { en: 'Today', zh: '今天', ja: '今日', th: 'วันนี้', mi: 'Rā nei', ru: 'Сегодня' },
  'sidebar.yesterday': { en: 'Yesterday', zh: '昨天', ja: '昨日', th: 'เมื่อวาน', mi: 'Inanahi', ru: 'Вчера' },
  'sidebar.earlier': { en: 'Earlier', zh: '更早', ja: 'それ以前', th: 'ก่อนหน้านี้', mi: 'Mua atu', ru: 'Ранее' },

  // ═══ Pin ═══
  'pin.top': {
    en: '📌 Pin to top',
    zh: '📌 置顶',
    ja: '📌 ピン留め',
    th: '📌 ปักหมุด',
    mi: '📌 Titi',
    ru: '📌 Закрепить',
  },
  'pin.pinned': {
    en: '📌 Pinned',
    zh: '📌 已置顶',
    ja: '📌 ピン留め中',
    th: '📌 ปักหมุดแล้ว',
    mi: '📌 Kua Titi',
    ru: '📌 Закреплено',
  },
  'pin.unpin': { en: 'Unpin', zh: '取消置顶', ja: 'ピン留め解除', th: 'เลิกปักหมุด', mi: 'Wetekina', ru: 'Открепить' },

  // ═══ Buttons ═══
  'btn.view': { en: '👁 View', zh: '👁 查看', ja: '👁 表示', th: '👁 ดู', mi: '👁 Tiro', ru: '👁 Смотр.' },
  'btn.edit': { en: '✏️ Edit', zh: '✏️ 编辑', ja: '✏️ 編集', th: '✏️ แก้ไข', mi: '✏️ Whakatika', ru: '✏️ Правка' },
  'btn.delete': { en: '🗑 Delete', zh: '🗑 删除', ja: '🗑 削除', th: '🗑 ลบ', mi: '🗑 Mukua', ru: '🗑 Удалить' },
  'btn.cancel': { en: 'Cancel', zh: '取消', ja: 'キャンセル', th: 'ยกเลิก', mi: 'Whakakore', ru: 'Отмена' },
  'btn.close': { en: 'Close', zh: '关闭', ja: '閉じる' },
  'btn.save': { en: 'Save', zh: '保存', ja: '保存', th: 'บันทึก', mi: 'Tiaki', ru: 'Сохранить' },
  'btn.saving': {
    en: 'Saving...',
    zh: '保存中...',
    ja: '保存中...',
    th: 'กำลังบันทึก...',
    mi: 'E tiaki ana...',
    ru: 'Сохранение...',
  },
  'btn.saved': {
    en: '✅ Saved',
    zh: '✅ 已保存',
    ja: '✅ 保存済み',
    th: '✅ บันทึกแล้ว',
    mi: '✅ Kua Tiaki',
    ru: '✅ Сохранено',
  },
  'btn.saveFailed': {
    en: 'Save failed',
    zh: '保存失败',
    ja: '保存失敗',
    th: 'บันทึกล้มเหลว',
    mi: 'Tiaki Rāhua',
    ru: 'Ошибка сохранения',
  },
  'btn.saveAs': {
    en: '📥 Save As',
    zh: '📥 另存为',
    ja: '📥 名前を付けて保存',
    th: '📥 บันทึกเป็น',
    mi: '📥 Tiaki Hei',
    ru: '📥 Сохранить как',
  },
  'btn.back': { en: '← Back', zh: '← 返回', ja: '← 戻る', th: '← กลับ', mi: '← Hoki', ru: '← Назад' },
  'btn.refresh': { en: 'Refresh', zh: '刷新', ja: '更新', th: 'รีเฟรช', mi: 'Whakahou', ru: 'Обновить' },
  'btn.export': { en: 'Export', zh: '导出', ja: 'エクスポート', th: 'ส่งออก', mi: 'Whakaputa', ru: 'Экспорт' },
  'btn.exportSelected': {
    en: 'Export selected',
    zh: '导出选中笔记',
    ja: '選択をエクスポート',
    th: 'ส่งออกที่เลือก',
    mi: 'Whakaputa',
    ru: 'Экспорт',
  },
  'btn.refreshList': {
    en: 'Refresh list',
    zh: '刷新列表',
    ja: 'リスト更新',
    th: 'รีเฟรชรายการ',
    mi: 'Whakahou',
    ru: 'Обновить',
  },
  'btn.new': { en: '+ New', zh: '+ 新建', ja: '+ 新規', th: '+ ใหม่', mi: '+ Hou', ru: '+ Новый' },
  'btn.create': { en: '+ Create', zh: '+ 新建', ja: '+ 作成', th: '+ สร้าง', mi: '+ Waihanga', ru: '+ Создать' },
  'btn.apply': {
    en: '✅ Apply',
    zh: '✅ 应用',
    ja: '✅ 適用',
    th: '✅ นำไปใช้',
    mi: '✅ Whakahono',
    ru: '✅ Применить',
  },
  'btn.undo': { en: '↩ Undo', zh: '↩ 撤销', ja: '↩ 元に戻す', th: '↩ ยกเลิก', mi: '↩ Whakakore', ru: '↩ Отменить' },
  'btn.forceCreate': {
    en: 'Force Create',
    zh: '强行创建',
    ja: '強制作成',
    th: 'บังคับสร้าง',
    mi: 'Waihanga',
    ru: 'Принудительно',
  },
  'btn.restartNow': {
    en: 'Restart Now',
    zh: '立即重启',
    ja: '今すぐ再起動',
    th: 'รีสตาร์ทตอนนี้',
    mi: 'Whakaara Ināianei',
    ru: 'Перезапустить',
  },
  'btn.leave': { en: 'Leave', zh: '离开', ja: '閉じる', th: 'ออก', mi: 'Wehe', ru: 'Выйти' },
  'btn.send': { en: 'Send', zh: '发送', ja: '送信', th: 'ส่ง', mi: 'Tuku', ru: 'Отправить' },
  'btn.sending': {
    en: 'Sending...',
    zh: '发送中...',
    ja: '送信中...',
    th: 'กำลังส่ง...',
    mi: 'E tuku ana...',
    ru: 'Отправка...',
  },
  'btn.submit': { en: '📨 Submit', zh: '📨 提交', ja: '📨 送信', th: '📨 ส่ง', mi: '📨 Tuku', ru: '📨 Отправить' },
  'btn.submitting': {
    en: 'Submitting...',
    zh: '提交中...',
    ja: '送信中...',
    th: 'กำลังส่ง...',
    mi: 'E tuku ana...',
    ru: 'Отправка...',
  },
  'btn.submitNewFeedback': {
    en: 'Submit New Feedback',
    zh: '提交新反馈',
    ja: '新規フィードバック',
    th: 'ส่งข้อเสนอแนะใหม่',
    mi: 'Tuku Urupare Hou',
    ru: 'Новый отзыв',
  },

  // ═══ Dialog ═══
  'dialog.unsavedChanges': {
    en: 'Unsaved Changes',
    zh: '未保存的更改',
    ja: '保存されていない変更',
    th: 'การเปลี่ยนแปลงที่ไม่ได้บันทึก',
    mi: 'Ngā Panoni Kāore i Tiakina',
    ru: 'Несохранённые изменения',
  },
  'dialog.delete': { en: 'Delete', zh: '删除', ja: '削除', th: 'ลบ', mi: 'Mukua', ru: 'Удалить' },
  'dialog.confirm': { en: 'Confirm', zh: '确认', ja: '確認', th: 'ยืนยัน', mi: 'Whakaū', ru: 'Подтвердить' },
  'dialog.ok': { en: 'OK', zh: '确定', ja: 'OK', th: 'ตกลง', mi: 'Āe', ru: 'OK' },

  // ═══ Staged Edit ═══
  'staged.title': { en: 'Title', zh: '标题', ja: 'タイトル', th: 'ชื่อเรื่อง', mi: 'Taitara', ru: 'Заголовок' },
  'staged.preview': {
    en: 'Preview',
    zh: '内容预览',
    ja: 'プレビュー',
    th: 'ดูตัวอย่าง',
    mi: 'Arokite',
    ru: 'Предпросмотр',
  },
  'staged.desc': { en: 'Desc', zh: '描述', ja: '説明', th: 'คำอธิบาย', mi: 'Whakaahuatanga', ru: 'Описание' },
  'staged.status': { en: 'Status', zh: '状态', ja: 'ステータス', th: 'สถานะ', mi: 'Tūnga', ru: 'Статус' },
  'staged.priority': { en: 'Priority', zh: '优先级', ja: '優先度', th: 'ลำดับ', mi: 'Mātāmua', ru: 'Приоритет' },

  // ═══ Home Panel ═══
  'home.taskStats': {
    en: '📊 Task Statistics',
    zh: '📊 任务统计',
    ja: '📊 タスク統計',
    th: '📊 สถิติงาน',
    mi: '📊 Tauanga Mahi',
    ru: '📊 Статистика',
  },
  'home.total': { en: 'Total', zh: '总计', ja: '合計', th: 'รวม', mi: 'Tapeke', ru: 'Всего' },
  'home.done': { en: 'Done', zh: '已完成', ja: '完了', th: 'เสร็จ', mi: 'Kua Oti', ru: 'Готово' },
  'home.rate': { en: 'Rate', zh: '完成率', ja: '完了率', th: 'อัตรา', mi: 'Ōrau', ru: 'Процент' },
  'home.7dDone': { en: '7d Done', zh: '近7天完成', ja: '7日間完了', th: '7 วัน', mi: '7 Rā', ru: '7 дн.' },
  'home.priority': {
    en: 'Priority',
    zh: '优先级分布',
    ja: '優先度分布',
    th: 'การกระจายลำดับ',
    mi: 'Tuari',
    ru: 'Приоритет',
  },
  'home.completion': {
    en: 'Completion',
    zh: '完成度',
    ja: '達成度',
    th: 'ความสำเร็จ',
    mi: 'Whakaoti',
    ru: 'Завершение',
  },
  'home.velocity': { en: 'Velocity', zh: '速度', ja: '速度', th: 'ความเร็ว', mi: 'Tere', ru: 'Скорость' },
  'home.git': {
    en: 'Git',
    zh: 'Git 活跃',
    ja: 'Git アクティビティ',
    th: 'กิจกรรม Git',
    mi: 'Ngohe Git',
    ru: 'Активность Git',
  },
  'home.freshness': { en: 'Freshness', zh: '新鲜度', ja: '鮮度', th: 'ความใหม่', mi: 'Houtanga', ru: 'Свежесть' },
  'health.trend.up': {
    en: '📈 On the rise! Keep the momentum going!',
    zh: '📈 势头上升！保持这股劲头！',
    ja: '📈 上昇中！この勢いを続けよう！',
  },
  'health.trend.down': {
    en: '📉 A small dip — tomorrow is a fresh start!',
    zh: '📉 稍有回落 — 明天是新开始！',
    ja: '📉 少し下降 — 明日は新しいスタート！',
  },
  'health.trend.steady': {
    en: '➡️ Steady and consistent — keep it up!',
    zh: '➡️ 稳定向前 — 持之以恒！',
    ja: '➡️ 安定して継続中 — その調子！',
  },
  'home.trend': {
    en: '📊 7-Day Trend',
    zh: '📊 近7天趋势',
    ja: '📊 7日間の推移',
    th: '📊 7 วัน',
    mi: '📊 7 Rā',
    ru: '📊 7 дн.',
  },
  'home.healthScore': {
    en: '❤️ My Health Score',
    zh: '❤️ 我的健康分',
    ja: '❤️ ヘルススコア',
    th: '❤️ คะแนนสุขภาพ',
    mi: '❤️ Hauora',
    ru: '❤️ Здоровье',
  },
  'home.knowledgeMap': {
    en: '🧠 Knowledge Map',
    zh: '🧠 知识地图',
    ja: '🧠 ナレッジマップ',
    th: '🧠 แผนที่ความรู้',
    mi: '🧠 Mahere Mātauranga',
    ru: '🧠 Карта знаний',
  },
  // The map is a tree over the user's own notes, so the old subtitle ("generated from your
  // tasks and notes") now describes something the card no longer is — tasks are not in it,
  // and nothing in it is *written* by the model. `th`/`mi` are dropped rather than left
  // stale: the claim changed, and the file's own policy is that those two fall back to en.
  'home.aiGenerated': {
    en: '🤖 Topics named by AI — every note in it is yours',
    zh: '🤖 主题由 AI 命名，内容全部来自你的笔记',
    ja: '🤖 テーマは AI が命名、内容はすべてあなたのノート',
    ru: '🤖 Темы названы AI — заметки ваши',
  },

  // ═══ Celebration ═══
  //
  // One line, and it names the rung that was crossed rather than the value on screen — see
  // `decide()` in lib/achievements. Every line states what happened and nothing more: an
  // adjective ("great work!") could not be wrong, but it would also be the only part of the
  // message that is not a fact about the user's own data.
  //
  // `tasksFirst` exists for a visible English bug, not for elegance: "{n} tasks done" renders
  // as "1 tasks done" at the first rung. Introducing a plural system for one string is not
  // worth it, so the component special-cases rung 0; if the first rung is ever dropped, this
  // key goes with it.
  'celebrate.tasksFirst': { en: 'First task done', zh: '第一个任务完成', ja: '最初のタスク完了' },
  'celebrate.tasks': { en: '{n} tasks done', zh: '已完成 {n} 个任务', ja: 'タスク {n} 件完了' },
  'celebrate.notes': {
    en: '{n} notes in the knowledge map',
    zh: '知识地图已有 {n} 篇笔记',
    ja: 'ナレッジマップにノート {n} 件',
  },
  // No `{n}`: the level is a machine code from the API, and this line is the only place that
  // names it for the user — so a threshold change cannot show up as a renamed number.
  'celebrate.excellent': {
    en: 'Health score is excellent',
    zh: '健康分达到「优秀」',
    ja: 'ヘルススコアが「優秀」になりました',
  },

  // ═══ Knowledge map card ═══
  //
  // Every string here renders structured data. The only machine codes that reach the UI are
  // `degraded` and `detail`, and they are translated rather than printed: a user shown
  // "index-range" has been told nothing they can act on.
  'kmap.organize': { en: 'Organize notes', zh: '生成知识地图', ja: 'マップを生成' },
  'kmap.reorganize': { en: 'Re-organize', zh: '重新归纳', ja: '再生成' },
  // The stale case gets its own label because the two buttons that used to sit here were
  // indistinguishable: a re-read cannot rename a topic, so after a language switch the
  // "refresh" icon did nothing visible. This label names the action that does work.
  'kmap.organizeNew': { en: 'Organize new notes', zh: '归纳新笔记', ja: '新しいノートを整理' },
  'kmap.organizing': { en: 'Organizing…', zh: '正在归纳…', ja: '生成中…' },
  'kmap.stats': {
    en: '{placed} of {total} notes in topics',
    zh: '已归类 {placed} / 共 {total} 篇',
    ja: '分類済み {placed} / 全 {total} 件',
  },
  'kmap.statsIssues': {
    en: '{duplicates} placed twice, {invalid} indices out of range',
    zh: '{duplicates} 处重复归置，{invalid} 个越界序号',
    ja: '重複 {duplicates} 件、範囲外 {invalid} 件',
  },
  'kmap.needNotes': { en: 'No notes yet.', zh: '知识库里还没有笔记。', ja: 'ノートがまだありません。' },
  // The one screen a user with an empty library should land on. A map needs notes; the
  // harvest button is the shortest path to having some, so the empty state carries it
  // rather than leaving them to find it in the header.
  'kmap.needNotesHint': {
    en: 'Finished tasks, past reports and meetings can become notes here.',
    zh: '已完成的任务、过往的报告、会议记录都可以在这里变成笔记。',
    ja: '完了したタスク・過去のレポート・会議はここでノートにできます。',
  },
  'kmap.empty': { en: 'This map has not been built yet.', zh: '还没有生成过知识地图。', ja: 'まだマップがありません。' },
  'kmap.emptyHint': {
    en: 'AI groups your notes under topic names. The notes themselves are never modified.',
    zh: 'AI 会把笔记归纳到主题下；笔记本身不会被改动。',
    ja: 'AI がノートをテーマ別に整理します。ノート自体は変更されません。',
  },
  'kmap.loadFailed': { en: 'Could not read the map.', zh: '读取知识地图失败。', ja: 'マップを読み込めませんでした。' },
  'kmap.retry': { en: 'Retry', zh: '重试', ja: '再試行' },
  // Said out loud rather than silently showing the previous tree. `load` keeps the old map on
  // failure, so without this line a failed re-read is indistinguishable from no new data.
  'kmap.reloadFailed': {
    en: 'Could not re-read the map — showing the previous result.',
    zh: '读取失败，显示的是上次的结果。',
    ja: '再読み込みに失敗しました。前回の結果を表示しています。',
  },
  // The two reasons the stored tree no longer matches the request. Both were computed by the
  // server from the day the map was written (`stale` folds in the note-id set *and* the
  // language) and neither had ever been rendered.
  'kmap.staleNotes': {
    en: '{n} new notes are not in the map yet',
    zh: '有 {n} 篇新笔记还没归入地图',
    ja: '新しいノート {n} 件がまだマップに入っていません',
  },
  'kmap.staleLang': {
    en: 'This map was generated in {lang} — topic names change only when you organize again.',
    zh: '这张地图是用{lang}生成的 —— 换语言后需要重新归纳，主题名才会变。',
    ja: 'このマップは{lang}で生成されました。テーマ名は再整理したときだけ変わります。',
  },
  // Notes newer than the tree are shown as a 「新笔记」 node rather than described by a
  // sentence — the node is also where you click through to them, so a counter would be a
  // second, useless way of saying the same thing.
  'kmap.newNotes': { en: 'New notes', zh: '新笔记', ja: '新しいノート' },
  'kmap.unfiled': { en: 'Unfiled', zh: '未归类', ja: '未分類' },
  'kmap.pickNote': {
    en: 'Pick a note from the tree.',
    zh: '从左边的树里选一篇笔记。',
    ja: '左のツリーからノートを選んでください。',
  },
  'kmap.openNote': { en: 'Open note', zh: '打开笔记', ja: 'ノートを開く' },
  'kmap.sameTitle': { en: '{n} notes share this title', zh: '有 {n} 篇同名笔记', ja: '同名のノートが {n} 件' },
  'kmap.degraded.no-llm': {
    en: 'No LLM is configured — showing notes grouped by category.',
    zh: '未配置 LLM，下面按「分类」展示。',
    ja: 'LLM が未設定のため、カテゴリ別に表示しています。',
  },
  'kmap.degraded.invalid': {
    en: "The model's answer was unusable — showing notes grouped by category.",
    zh: 'AI 返回的结果不可用，下面按「分类」展示。',
    ja: 'AI の応答を利用できなかったため、カテゴリ別に表示しています。',
  },
  'kmap.degraded.categories': {
    en: 'Too many notes to organize at once — grouped by category.',
    zh: '笔记太多，本次按「分类」展示。',
    ja: 'ノートが多すぎるため、カテゴリ別に表示しています。',
  },
  'kmap.detail.tooManyNotes': { en: 'More than 400 notes', zh: '笔记超过 400 篇', ja: 'ノートが 400 件超' },
  'kmap.detail.truncated': {
    en: 'The AI answer was cut off at the output limit',
    zh: 'AI 的回答被输出长度上限截断',
    ja: 'AI の応答が出力上限で途切れました',
  },
  'kmap.detail.llmError': {
    en: 'The model call failed (network or key)',
    zh: '调用模型失败（网络或密钥）',
    ja: 'モデル呼び出しに失敗（ネットワークまたはキー）',
  },
  'kmap.detail.malformed': {
    en: 'The AI returned a structure that failed validation',
    zh: 'AI 返回的结构没有通过校验',
    ja: 'AI の返した構造が検証を通りませんでした',
  },

  // ═══ Links between notes ═══
  'kmap.outLinks': { en: 'Links out', zh: '出链', ja: '外向きリンク' },
  'kmap.backLinks': { en: 'Back-links', zh: '反链', ja: '被リンク' },
  'kmap.noLinks': { en: 'No [[links]] in or out yet', zh: '还没有 [[链接]]', ja: '[[リンク]] はまだありません' },
  'kmap.brokenLink': { en: 'No note has this title', zh: '没有这篇笔记', ja: 'このタイトルのノートはありません' },

  // ═══ Neighbours in embedding space ═══
  'kmap.semantic': { en: 'Nearest by meaning', zh: '语义最近', ja: '意味が近い' },
  'kmap.semanticHint': {
    en: 'Ordered by vector distance. No similarity cut-off is applied, so no score is shown.',
    zh: '按向量距离排序。没有可用的相似度阈值，所以不显示分数。',
    ja: 'ベクトル距離順です。有効なしきい値がないためスコアは表示しません。',
  },
  'kmap.embed.disabled': {
    en: 'Local semantic search is turned off',
    zh: '本机已关闭语义检索',
    ja: 'ローカルの意味検索は無効です',
  },
  'kmap.embed.downloading': {
    en: 'Downloading the semantic model…',
    zh: '正在下载语义模型…',
    ja: '意味モデルをダウンロード中…',
  },
  'kmap.embed.absent': {
    en: 'The semantic model has not been downloaded',
    zh: '语义模型还没有下载',
    ja: '意味モデルが未ダウンロードです',
  },
  'kmap.embed.failed': {
    en: 'The semantic model failed to load',
    zh: '语义模型加载失败',
    ja: '意味モデルの読み込みに失敗しました',
  },
  'kmap.embed.noVector': { en: 'This note has no vector yet', zh: '这篇笔记还没有向量', ja: 'このノートは未ベクトル化です' },
  'kmap.embed.noPeers': { en: 'No other note has a vector yet', zh: '其他笔记都还没有向量', ja: '他のノートにまだベクトルがありません' },
  'kmap.embed.pending': { en: '{n} notes still queued', zh: '还有 {n} 篇在队列里', ja: '{n} 件がキューに残っています' },
  'kmap.embed.retry': { en: 'Rebuild vectors', zh: '重建向量', ja: 'ベクトルを再構築' },
  'kmap.embed.queued': { en: 'Queued {n} notes.', zh: '已排队 {n} 篇。', ja: '{n} 件をキューに追加しました。' },
  'kmap.embedFailed': { en: 'Could not reach the embedding service.', zh: '无法访问向量服务。', ja: 'ベクトルサービスに接続できません。' },
  // ═══ Fixing a topic the model named badly ═══
  // The 「⋯」 menu on a topic row, and the three things behind it. All three are local: no
  // model, no tokens, no note is ever written or removed. A bad topic name is sticky by
  // design (`priorTopicNames` asks the model to reuse what exists), so without these there
  // is no way to correct one at all.
  'kmap.topic.more': { en: 'Topic actions', zh: '主题操作', ja: 'トピックの操作' },
  'kmap.topic.rename': { en: 'Rename', zh: '重命名', ja: '名前を変更' },
  'kmap.topic.merge': { en: 'Merge into…', zh: '合并到…', ja: '統合先…' },
  'kmap.topic.delete': { en: 'Delete', zh: '删除', ja: '削除' },
  'kmap.topic.cancel': { en: 'Cancel', zh: '取消', ja: 'キャンセル' },
  'kmap.topic.renamed': { en: 'Renamed to “{name}”.', zh: '已重命名为「{name}」。', ja: '「{name}」に変更しました。' },
  'kmap.topic.deleted': {
    en: 'Deleted “{name}”. Its notes are still in the map.',
    zh: '已删除「{name}」，笔记都还在。',
    ja: '「{name}」を削除しました。ノートは残っています。',
  },
  'kmap.topic.merged': {
    en: 'Merged “{a}” into “{b}”.',
    zh: '已把「{a}」合并进「{b}」。',
    ja: '「{a}」を「{b}」に統合しました。',
  },
  // The delete prompt has to say where the notes go, because "delete" on a row that owns
  // notes reads as "delete the notes" — and it does not do that.
  'kmap.topic.deleteTitle': { en: 'Remove this topic?', zh: '移除这个主题？', ja: 'このトピックを削除しますか？' },
  'kmap.topic.deleteBody': {
    en: '“{name}” leaves the map, but nothing under it is deleted: its {n} notes move to {where}, and its sub-topics take its place.',
    zh: '「{name}」会从地图上移除，但它下面的东西一个都不会删：{n} 篇笔记会移到{where}，子主题上移接管它的位置。',
    ja: '「{name}」はマップから消えますが、その下のものは何も削除されません。{n} 件のノートは{where}に移動し、サブトピックがその位置を引き継ぎます。',
  },
  'kmap.topic.deleteBodyEmpty': {
    en: '“{name}” leaves the map. It has no notes of its own, so all that moves is its sub-topics, up into its place.',
    zh: '「{name}」会从地图上移除。它自己名下一篇笔记都没有，所以移动的只有它的子主题 —— 上移接管它的位置。',
    ja: '「{name}」はマップから消えます。このトピック自身のノートはないため、移動するのはサブトピックだけです。',
  },
  /** Fills `{where}` in the sentence above — the other value is `kmap.unfiled`. */
  'kmap.topic.parent': { en: 'its parent topic', zh: '父主题', ja: '親トピック' },
  'kmap.topic.mergeTitle': { en: 'Merge “{name}” into…', zh: '把「{name}」合并到…', ja: '「{name}」の統合先' },
  'kmap.topic.mergeLead': {
    en: 'Pick the topic that should absorb this one. Its notes and sub-topics move there, and nothing is deleted.',
    zh: '选一个主题来吸收它。它的笔记和子主题都会移过去，不会删掉任何东西。',
    ja: 'このトピックを吸収するトピックを選んでください。ノートとサブトピックはそこへ移動し、何も削除されません。',
  },
  'kmap.topic.mergeEmpty': {
    en: 'There is no other topic to merge into yet.',
    zh: '还没有其它主题可以合并。',
    ja: '統合できる別のトピックがまだありません。',
  },
  // One line per refusal from `editTree`. These are machine codes, so they are mapped
  // through a table rather than interpolated into a key — a code with no line here would
  // otherwise be a missing-key lookup.
  'kmap.topic.fail.not-found': {
    en: 'That topic is no longer in the map. Reopen the card and try again.',
    zh: '地图上已经找不到这个主题了，重新打开卡片再试。',
    ja: 'そのトピックはもうマップにありません。カードを開き直してください。',
  },
  'kmap.topic.fail.tree-changed': {
    en: 'The map changed since this card was drawn. Reopen it and try again.',
    zh: '地图已经变了，重新打开卡片再试。',
    ja: 'マップが変わっています。カードを開き直してください。',
  },
  'kmap.topic.fail.not-a-topic': {
    en: 'This row is not a topic you can edit.',
    zh: '这一行不是可以编辑的主题。',
    ja: 'この行は編集できるトピックではありません。',
  },
  'kmap.topic.fail.empty-name': {
    en: 'A topic name cannot be empty.',
    zh: '主题名不能是空的。',
    ja: 'トピック名を空にはできません。',
  },
  'kmap.topic.fail.same-node': {
    en: 'A topic cannot be merged into itself.',
    zh: '不能把主题合并到它自己。',
    ja: 'トピック自身には統合できません。',
  },
  'kmap.topic.fail.into-descendant': {
    en: 'A topic cannot be merged into one of its own sub-topics.',
    zh: '不能把主题合并进它自己的子主题。',
    ja: 'トピック自身のサブトピックには統合できません。',
  },
  'kmap.topic.fail.no-target': {
    en: 'The destination topic is no longer in the map. Reopen the card and try again.',
    zh: '目标主题已经不在地图上了，重新打开卡片再试。',
    ja: '統合先のトピックはもうマップにありません。カードを開き直してください。',
  },
  // The backstop in `editTree`. It should be unreachable; if it is ever printed, a surgical
  // bug was caught before it could drop a note.
  'kmap.topic.fail.lost-notes': {
    en: 'That edit would have dropped a note, so it was not applied. The map is unchanged.',
    zh: '这次编辑会丢笔记，所以没有执行。地图没有变动。',
    ja: 'この編集ではノートが失われるため、実行しませんでした。マップは変わっていません。',
  },
  'kmap.topic.failed': { en: 'Could not reach the API.', zh: '无法访问接口。', ja: 'API に接続できませんでした。' },
  // ═══ Harvesting knowledge out of tasks, reports and meetings ═══
  // The dialog behind the map card's 「整理知识」 button. Three sources, one note each, and
  // one free pass in front of the paid one so the user sees a count before a bill.
  'distill.open': { en: 'Harvest knowledge', zh: '整理知识', ja: '知識を整理' },
  'distill.title': { en: 'Harvest knowledge into notes', zh: '把知识整理成笔记', ja: '知識をノートに整理' },
  'distill.lead': {
    en: 'A finished task, a month of reports and a meeting’s decisions are folded into notes of your own — one note per source. Nothing is written until you review it.',
    zh: '把一个完成的任务、一个月的报告、一场会议的决定，各整理成一篇你自己的笔记 —— 每个来源一篇。你看过之前不会写入任何东西。',
    ja: '完了したタスク、1 か月分のレポート、会議の決定を、それぞれ自分のノート 1 件にまとめます。確認するまで何も書き込みません。',
  },
  // The scope row. `distill.count` is the sentence that must be read *before* the button
  // that spends money, which is why it is stated as a count and not as "ready".
  'distill.sources': { en: 'Sources', zh: '来源', ja: '対象' },
  'distill.kind.task': { en: 'Finished tasks', zh: '已完成任务', ja: '完了タスク' },
  'distill.kind.report': { en: 'Report months', zh: '报告月份', ja: 'レポート月' },
  'distill.kind.meeting': { en: 'Meetings', zh: '会议', ja: '会議' },
  'distill.sinceLabel': { en: 'From the last', zh: '时间范围', ja: '期間' },
  'distill.sinceDays': { en: '{n} days', zh: '最近 {n} 天', ja: '直近 {n} 日' },
  'distill.sinceAll': { en: 'All of it', zh: '全部', ja: 'すべて' },
  'distill.count': {
    en: '{n} sources to harvest',
    zh: '将整理 {n} 个来源',
    ja: '{n} 件を整理します',
  },
  'distill.deferred': {
    en: '{n} more are over this run’s limit — the next press starts there.',
    zh: '还有 {n} 个超出本次上限，下次会从那里接着来。',
    ja: 'さらに {n} 件が今回の上限を超えています。次回はそこから始まります。',
  },
  'distill.start': { en: 'Harvest', zh: '开始整理', ja: '整理を開始' },
  'distill.running': { en: 'Reading the sources…', zh: '正在阅读来源…', ja: 'ソースを読み込み中…' },
  'distill.apply': { en: 'Write {n} notes', zh: '写入 {n} 篇笔记', ja: '{n} 件を書き込む' },
  'distill.applying': { en: 'Writing…', zh: '写入中…', ja: '書き込み中…' },
  'distill.done': { en: 'Wrote {n} notes.', zh: '写入了 {n} 篇笔记。', ja: '{n} 件のノートを書き込みました。' },
  'distill.doneUnchanged': { en: '{n} were already up to date.', zh: '{n} 篇内容没有变化。', ja: '{n} 件は最新のままです。' },
  'distill.total': { en: '{n} proposals · {t} tokens', zh: '{n} 条候选 · {t} tokens', ja: '候補 {n} 件 · {t} tokens' },
  'distill.merges': { en: 'merges into “{title}”', zh: '并入「{title}」', ja: '「{title}」に統合' },
  'distill.truncated': {
    en: 'Longer than the budget — this note may be missing its tail.',
    zh: '内容超出预算，这篇笔记可能缺了结尾。',
    ja: '予算を超えているため、このノートは末尾が欠けている可能性があります。',
  },
  'distill.edit': { en: 'Edit', zh: '编辑', ja: '編集' },
  'distill.titlePlaceholder': { en: 'Note title', zh: '笔记标题', ja: 'ノートのタイトル' },
  // The five empty states. They look identical on screen and need opposite responses:
  // nothing here / you have seen it all / the model found nothing worth keeping (a correct
  // and common answer) / no model configured / spending is paused.
  'distill.none.everything': { en: 'Nothing to harvest', zh: '没有可整理的来源', ja: '整理できる対象がありません' },
  'distill.none.noMaterial': { en: '{n} have no content to work from', zh: '{n} 个没有内容可整理', ja: '{n} 件は中身がありません' },
  'distill.none.notDone': { en: '{n} are still open', zh: '{n} 个还没完成', ja: '{n} 件は未完了です' },
  'distill.none.noDecisions': { en: '{n} have no decisions', zh: '{n} 个没有决议', ja: '{n} 件は決定がありません' },
  'distill.none.outOfScope': { en: '{n} are outside the range', zh: '{n} 个不在时间范围内', ja: '{n} 件は期間外です' },
  'distill.none.reviewed': { en: '{n} have been harvested already', zh: '{n} 个已经整理过', ja: '{n} 件は整理済みです' },
  'distill.none.reviewedHint': {
    en: 'Tick “re-harvest everything” to see them again.',
    zh: '勾选「重新整理全部」可以再看一遍。',
    ja: '「すべて再整理」を選ぶと再び表示されます。',
  },
  'distill.force': { en: 'Re-harvest everything', zh: '重新整理全部', ja: 'すべて再整理' },
  'distill.nothingDurable': {
    en: 'The model read every source and found nothing worth keeping. That is a normal answer for routine work.',
    zh: '模型读完了所有来源，认为没有值得留下的东西。对日常性工作来说这是正常结果。',
    ja: 'モデルはすべて読みましたが、残す価値のある内容はないと判断しました。日常的な作業ではよくある結果です。',
  },
  'distill.paused': {
    en: 'Spending is paused until {at} — the quota ran out.',
    zh: '消费已暂停到 {at} —— 配额用完了。',
    ja: '消費は {at} まで停止中です — クォータを使い切りました。',
  },
  'distill.noSources': { en: 'Pick at least one source.', zh: '至少选择一种来源。', ja: '対象を 1 つ以上選んでください。' },
  'distill.noLlm': { en: 'No model is configured, so nothing can be read.', zh: '还没有配置模型，无法阅读来源。', ja: 'モデルが未設定のため読み込めません。' },
  'distill.failed': { en: 'Failed: {why}', zh: '失败：{why}', ja: '失敗: {why}' },
  'distill.network': { en: 'could not reach the API server', zh: '无法连接 API 服务器', ja: 'APIサーバーに接続できません' },
  'distill.skippedCount': { en: '{n} sources were left out.', zh: '{n} 个来源被跳过。', ja: '{n} 件をスキップしました。' },
  'distill.partial': { en: 'Some sources failed: {why}', zh: '部分来源失败：{why}', ja: '一部が失敗: {why}' },
  'distill.why.open-in-editor': {
    en: 'open in the editor',
    zh: '正在编辑器中打开',
    ja: 'エディターで開いています',
  },
  'distill.why.no-material': { en: 'nothing to read', zh: '没有可读的内容', ja: '読む内容がありません' },
  'distill.why.nothing-durable': { en: 'nothing worth keeping', zh: '没有值得留下的东西', ja: '残す価値がありません' },
  'distill.why.truncated': { en: 'the answer was cut off', zh: '回答被截断', ja: '回答が途切れました' },
  'distill.why.parse': { en: 'unreadable answer', zh: '回答无法解析', ja: '回答を解析できません' },
  'distill.why.llm-error': { en: 'the model call failed', zh: '模型调用失败', ja: 'モデル呼び出しに失敗' },
  'distill.why.source-missing': { en: 'the source is gone', zh: '来源已不存在', ja: 'ソースが存在しません' },
  'distill.why.note-changed': {
    en: 'the note was edited after you reviewed it',
    zh: '这篇笔记在你审阅之后又被改过',
    ja: '確認後にノートが編集されました',
  },

  // ═══ Backfilling links into existing notes ═══
  // No emoji here: the button that renders this already draws a link icon of its own
  // (`NotesList`), so a 🔗 in the string showed up as two icons side by side.
  'notes.findLinks': { en: 'Find links', zh: '补链接', ja: 'リンク補完' },
  'links.title': { en: 'Find links between notes', zh: '给笔记补链接', ja: 'ノート間のリンクを補完' },
  'links.lead': {
    en: 'The AI reads your notes and proposes links between related ones. Nothing is written until you confirm.',
    zh: 'AI 会读你的笔记，提议互相相关的链接。你确认之前不会写入任何内容。',
    ja: 'AI がノートを読み、関連するものを提案します。確認するまで書き込みません。',
  },
  'links.start': { en: 'Analyze', zh: '开始分析', ja: '分析を開始' },
  'links.analyzing': { en: 'Analyzing…', zh: '正在分析…', ja: '分析中…' },
  'links.none': { en: 'No links to propose.', zh: '没有找到需要补的链接。', ja: '提案するリンクはありません。' },
  'links.apply': { en: 'Write {n} selected', zh: '写入选中的 {n} 条', ja: '選択した {n} 件を書き込む' },
  'links.applying': { en: 'Writing…', zh: '写入中…', ja: '書き込み中…' },
  'links.done': { en: 'Updated {n} notes.', zh: '写入了 {n} 篇笔记。', ja: '{n} 件のノートを更新しました。' },
  'links.doneUnchanged': { en: '{n} already had these links.', zh: '{n} 篇没有变化。', ja: '{n} 件は変化なし。' },
  'links.failed': { en: 'Analysis failed: {why}', zh: '分析失败：{why}', ja: '分析に失敗: {why}' },
  'links.unlinkable': {
    en: 'Several notes share these titles, so they cannot be link targets: {titles}',
    zh: '这些标题有多篇同名笔记，无法作为链接目标：{titles}',
    ja: 'これらのタイトルは複数のノートが持つため、リンク先にできません: {titles}',
  },
  'links.total': { en: '{n} notes · {m} proposals', zh: '{n} 篇笔记 · {m} 条建议', ja: '{n} 件 · 提案 {m} 件' },
  'links.skippedOpen': {
    en: '{n} notes are open in the editor and were skipped.',
    zh: '{n} 篇正在编辑器里打开，已跳过。',
    ja: '{n} 件はエディタで開かれているためスキップしました。',
  },
  'links.skippedReviewed': {
    en: '{n} notes were reviewed before and have not changed.',
    zh: '{n} 篇上次已确认过且没有改动。',
    ja: '{n} 件は確認済みで変更がありません。',
  },
  'links.skippedOther': { en: '{n} notes were skipped.', zh: '{n} 篇被跳过。', ja: '{n} 件をスキップしました。' },
  'links.force': { en: 'Re-analyze everything', zh: '重新分析全部', ja: 'すべて再分析' },
  'links.missing': { en: 'The note was deleted.', zh: '笔记已被删除。', ja: 'ノートは削除されました。' },
  'links.openInEditor': {
    en: 'Open in the editor; close it and run again.',
    zh: '正在编辑器里打开；关闭后再跑一次。',
    ja: 'エディタで開かれています。閉じてから再実行してください。',
  },
  'links.close': { en: 'Close', zh: '关闭', ja: '閉じる' },
  'links.selectAll': { en: 'Select all', zh: '全选', ja: 'すべて選択' },
  'links.selectNone': { en: 'Clear', zh: '全不选', ja: '選択解除' },
  'links.network': { en: 'Could not reach the API server.', zh: '无法连接 API 服务器。', ja: 'APIサーバーに接続できません。' },
  // Named, not summarized: "some notes were not analyzed" and "your notes are unrelated"
  // render as the same empty list otherwise.
  'links.partial': {
    en: 'Some notes were not analyzed: {why}',
    zh: '有笔记没能分析完：{why}',
    ja: '一部のノートは分析できませんでした: {why}',
  },

  'home.loading': {
    en: 'Loading...',
    zh: '加载中...',
    ja: '読み込み中...',
    th: 'กำลังโหลด...',
    mi: 'E uta ana...',
    ru: 'Загрузка...',
  },

  // ═══ Notes Panel ═══
  'notes.search': {
    en: '🔍 Search notes...',
    zh: '🔍 搜索笔记...',
    ja: '🔍 ノート検索...',
    th: '🔍 ค้นหาบันทึก...',
    mi: '🔍 Rapu tuhipoka...',
    ru: '🔍 Поиск...',
  },
  'notes.title': { en: 'Title', zh: '标题', ja: 'タイトル', th: 'ชื่อเรื่อง', mi: 'Taitara', ru: 'Заголовок' },
  'notes.category': { en: 'Category', zh: '分类', ja: 'カテゴリ', th: 'หมวดหมู่', mi: 'Kāwai', ru: 'Категория' },
  // Marker for notes written by the background chat distillation (category 'chat')
  // The four machine-written categories. They are labelled here, next to the rest, because
  // a category that has no label prints as its raw value — which is exactly what
  // `NotesList` used to do for `chat`, and would then have done for these three.
  'notes.categoryChat': { en: '💬 Chat summary', zh: '💬 会话纪要', ja: '💬 会話メモ' },
  'notes.categoryTask': { en: '✅ From a task', zh: '✅ 来自任务', ja: '✅ タスクから' },
  'notes.categoryReport': { en: '📊 From a report', zh: '📊 来自报告', ja: '📊 レポートから' },
  'notes.categoryMeeting': { en: '🗣 From a meeting', zh: '🗣 来自会议', ja: '🗣 会議から' },
  // Label for the empty category in the editor's <select>. Every other value shows itself.
  'notes.uncategorized': { en: 'Uncategorized', zh: '未分类', ja: '未分類', th: 'ไม่มีหมวดหมู่', mi: 'Kāore he kāwai', ru: 'Без категории' },
  'notes.updated': { en: 'Updated', zh: '更新', ja: '更新', th: 'อัปเดต', mi: 'Whakahoutia', ru: 'Обновлено' },
  'notes.clickToSort': {
    en: 'Click to sort',
    zh: '点击排序',
    ja: 'クリックでソート',
    th: 'คลิกเพื่อเรียง',
    mi: 'Pāwhiria hei kōmaka',
    ru: 'Нажмите для сортировки',
  },
  'notes.noteTitle': {
    en: 'Note title',
    zh: '笔记标题',
    ja: 'ノートタイトル',
    th: 'ชื่อบันทึก',
    mi: 'Taitara Tuhipoka',
    ru: 'Заголовок',
  },
  'notes.placeholder': {
    en: 'Write your note... (Markdown supported)',
    zh: '写下你的笔记...（支持 Markdown）',
    ja: 'ノートを書く...（Markdown対応）',
    th: 'เขียนบันทึก... (รองรับ Markdown)',
    mi: 'Tuhia tō tuhipoka...',
    ru: 'Пишите заметку... (Markdown)',
  },
  'notes.polish': {
    en: '✨ Pol',
    zh: '✨ 润色',
    ja: '✨ 推敲',
    th: '✨ ขัดเกลา',
    mi: '✨ Whakapaipai',
    ru: '✨ Обработка',
  },
  'notes.translate': {
    en: '🌐 Tran',
    zh: '🌐 翻译',
    ja: '🌐 翻訳',
    th: '🌐 แปล',
    mi: '🌐 Whakamāori',
    ru: '🌐 Перевод',
  },
  'notes.summarize': {
    en: '📝 Sum',
    zh: '📝 总结',
    ja: '📝 要約',
    th: '📝 สรุป',
    mi: '📝 Whakarāpopoto',
    ru: '📝 Итог',
  },
  'notes.expand': {
    en: '📖 Exp',
    zh: '📖 扩写',
    ja: '📖 拡張',
    th: '📖 ขยาย',
    mi: '📖 Whakawhānui',
    ru: '📖 Расширить',
  },
  'notes.deleteNote': {
    en: 'Delete Note',
    zh: '删除笔记',
    ja: 'ノート削除',
    th: 'ลบบันทึก',
    mi: 'Mukua Tuhipoka',
    ru: 'Удалить заметку',
  },
  'notes.deleteConfirm': {
    en: 'Delete this note? This action cannot be undone.',
    zh: '删除这条笔记？此操作无法撤销。',
    ja: 'このノートを削除しますか？元に戻せません。',
    th: 'ลบบันทึกนี้? ไม่สามารถยกเลิกได้',
    mi: 'Mukua tēnei tuhipoka? Kāore e taea te whakakore.',
    ru: 'Удалить заметку? Это необратимо.',
  },
  'notes.deleteSelected': {
    en: 'Delete {n} selected',
    zh: '删除选中的 {n} 篇',
    ja: '選択した {n} 件を削除',
  },
  'notes.selectAll': {
    en: 'Select everything shown',
    zh: '全选筛选结果',
    ja: '表示中をすべて選択',
  },
  'notes.batchDeleteTitle': { en: 'Batch delete', zh: '批量删除', ja: '一括削除' },
  'notes.batchDeleteConfirm': {
    en: 'Delete {n} selected note(s)? This cannot be undone.',
    zh: '删除选中的 {n} 篇笔记？此操作无法撤销。',
    ja: '選択した {n} 件のノートを削除しますか？元に戻せません。',
  },
  'notes.batchDeleting': {
    en: 'Deleting… ({done}/{total})',
    zh: '正在删除…（{done}/{total}）',
    ja: '削除中…（{done}/{total}）',
  },
  'notes.batchDeleteFailed': {
    en: '{n} note(s) could not be deleted; the rest were.',
    zh: '{n} 篇删除失败，其余已删除。',
    ja: '{n} 件を削除できませんでした（残りは削除済み）。',
  },
  'notes.batchDeleted': {
    en: 'Deleted {n} notes',
    zh: '删除了 {n} 篇笔记',
    ja: 'ノートを {n} 件削除しました',
  },
  'notes.saveFailed': {
    en: 'Save Failed',
    zh: '保存失败',
    ja: '保存失敗',
    th: 'บันทึกล้มเหลว',
    mi: 'Tiaki Rāhua',
    ru: 'Ошибка сохранения',
  },
  'notes.noNotes': {
    en: 'No notes yet.',
    zh: '暂无笔记。',
    ja: 'ノートがありません。',
    th: 'ยังไม่มีบันทึก',
    mi: 'Kāore anō he tuhipoka.',
    ru: 'Нет заметок.',
  },
  'notes.untitled': {
    en: 'Untitled',
    zh: '未命名',
    ja: '無題',
    th: 'ไม่มีชื่อ',
    mi: 'Kore Taitara',
    ru: 'Без названия',
  },
  'notes.untitledNote': {
    en: 'Untitled Note',
    zh: '无标题笔记',
    ja: '無題ノート',
    th: 'บันทึกไม่มีชื่อ',
    mi: 'Tuhipoka Kore Taitara',
    ru: 'Заметка без названия',
  },
  'notes.general': { en: 'General', zh: '通用', ja: '一般', th: 'ทั่วไป', mi: 'Whānui', ru: 'Общее' },
  'notes.architecture': {
    en: 'Architecture',
    zh: '架构',
    ja: 'アーキテクチャ',
    th: 'สถาปัตยกรรม',
    mi: 'Hoahoa',
    ru: 'Архитектура',
  },
  'notes.apiDocs': {
    en: 'API Docs',
    zh: 'API 文档',
    ja: 'API ドキュメント',
    th: 'เอกสาร API',
    mi: 'Tuhinga API',
    ru: 'API Документы',
  },
  'notes.runbook': { en: 'Runbook', zh: '操作手册', ja: 'ランブック', th: 'คู่มือ', mi: 'Pukapuka', ru: 'Руководство' },
  'notes.toc': { en: 'Table of contents', zh: '目录', ja: '目次', th: 'สารบัญ', mi: 'Rārangi Upoko', ru: 'Оглавление' },

  // ═══ Tasks Panel ═══
  'tasks.search': {
    en: '🔍 Search...',
    zh: '🔍 搜索...',
    ja: '🔍 検索...',
    th: '🔍 ค้นหา...',
    mi: '🔍 Rapu...',
    ru: '🔍 Поиск...',
  },
  'tasks.allTypes': {
    en: 'All Types',
    zh: '全部类型',
    ja: '全ての種類',
    th: 'ทุกประเภท',
    mi: 'Ngā Momo',
    ru: 'Все типы',
  },
  'tasks.allPriority': {
    en: 'All Priority',
    zh: '全部优先级',
    ja: '全ての優先度',
    th: 'ทุกลำดับ',
    mi: 'Katoa',
    ru: 'Все',
  },
  'tasks.allStatus': {
    en: 'All Status',
    zh: '全部状态',
    ja: '全てのステータス',
    th: 'ทุกสถานะ',
    mi: 'Katoa',
    ru: 'Все',
  },
  'tasks.type.task': { en: '✅ Task', zh: '✅ 任务', ja: '✅ タスク', th: '✅ งาน', mi: '✅ Mahi', ru: '✅ Задача' },
  'tasks.type.bug': { en: '🐛 Bug', zh: '🐛 缺陷', ja: '🐛 バグ', th: '🐛 บั๊ก', mi: '🐛 Hapa', ru: '🐛 Баг' },
  'tasks.type.story': {
    en: '📖 Story',
    zh: '📖 故事',
    ja: '📖 ストーリー',
    th: '📖 สตอรี่',
    mi: '📖 Pūrākau',
    ru: '📖 История',
  },
  'tasks.type.email': {
    en: '📥 Email',
    zh: '📥 邮件',
    ja: '📥 メール',
    th: '📥 อีเมล',
    mi: '📥 Īmēra',
    ru: '📥 Почта',
  },
  'tasks.status.todo': { en: 'Todo', zh: '待办', ja: '未着手', th: 'Todo', mi: 'Todo', ru: 'Todo' },
  'tasks.status.inProgress': {
    en: 'In Progress',
    zh: '进行中',
    ja: '進行中',
    th: 'กำลังทำ',
    mi: 'Kei te Haere',
    ru: 'В процессе',
  },
  'tasks.status.inReview': {
    en: 'In Review',
    zh: '评审中',
    ja: 'レビュー中',
    th: 'กำลังตรวจ',
    mi: 'Kei te Arotake',
    ru: 'На проверке',
  },
  'tasks.action.start': { en: '▶ Start', zh: '▶ 开始', ja: '▶ 開始' },
  'tasks.action.complete': { en: '✓ Done', zh: '✓ 完成', ja: '✓ 完了' },
  'tasks.toast.statusChanged': { en: 'Status → {status}', zh: '状态 → {status}', ja: 'ステータス → {status}' },
  'tasks.toast.statusChangeFailed': {
    en: '❌ Failed to update status',
    zh: '❌ 状态更新失败',
    ja: '❌ ステータス更新に失敗しました',
  },
  'tasks.dragHint': {
    en: 'Click # or Title to view details. Drag Priority/Type/Created/Due/Updated columns to change status.',
    zh: '点击 # 或标题查看详情，拖拽优先级/种类/创建/截止/更新时间区域来修改状态',
    ja: '# またはタイトルをクリックすると詳細を表示。優先度/種類/作成日/期限/更新日の列をドラッグしてステータスを変更',
  },
  'tasks.status.done': { en: 'Done', zh: '完成', ja: '完了', th: 'เสร็จ', mi: 'Kua Oti', ru: 'Готово' },
  'tasks.priority.critical': {
    en: '🔴 Critical',
    zh: '🔴 紧急',
    ja: '🔴 緊急',
    th: '🔴 วิกฤต',
    mi: '🔴 Mātāmua',
    ru: '🔴 Критичный',
  },
  'tasks.priority.high': { en: '🟡 High', zh: '🟡 高', ja: '🟡 高', th: '🟡 สูง', mi: '🟡 Nui', ru: '🟡 Высокий' },
  'tasks.priority.medium': {
    en: '🔵 Medium',
    zh: '🔵 中',
    ja: '🔵 中',
    th: '🔵 กลาง',
    mi: '🔵 Waenga',
    ru: '🔵 Средний',
  },
  'tasks.priority.low': { en: '🟢 Low', zh: '🟢 低', ja: '🟢 低', th: '🟢 ต่ำ', mi: '🟢 Iti', ru: '🟢 Низкий' },
  'tasks.field.priority': { en: 'Priority', zh: '优先', ja: '優先' },
  'tasks.field.type': { en: 'Type', zh: '类型', ja: '種別' },
  'tasks.field.time': { en: 'Time', zh: '时间', ja: '日時' },
  'tasks.field.created': { en: 'Created', zh: '创建', ja: '作成' },
  'tasks.field.due': { en: 'Due', zh: '截止', ja: '期限' },
  'tasks.field.updated': { en: 'Updated', zh: '更新', ja: '更新' },
  'tasks.priority.crit': { en: 'Crit', zh: '紧急', ja: '緊急' },
  'tasks.priority.hi': { en: 'High', zh: '高', ja: '高' },
  'tasks.priority.med': { en: 'Med', zh: '中', ja: '中' },
  'tasks.priority.lo': { en: 'Low', zh: '低', ja: '低' },
  'tasks.type.taskAbbr': { en: 'Task', zh: '任务', ja: 'タスク' },
  'tasks.type.bugAbbr': { en: 'Bug', zh: '缺陷', ja: 'バグ' },
  'tasks.type.storyAbbr': { en: 'Story', zh: '故事', ja: 'ストーリー' },
  'tasks.title': { en: 'Title', zh: '标题', ja: 'タイトル', th: 'ชื่อเรื่อง', mi: 'Taitara', ru: 'Заголовок' },
  'tasks.description': {
    en: 'Description',
    zh: '描述',
    ja: '説明',
    th: 'คำอธิบาย',
    mi: 'Whakaahuatanga',
    ru: 'Описание',
  },
  'tasks.type': { en: 'Type', zh: '类型', ja: 'タイプ', th: 'ประเภท', mi: 'Momo', ru: 'Тип' },
  'tasks.priority': { en: 'Priority', zh: '优先级', ja: '優先度', th: 'ลำดับ', mi: 'Mātāmua', ru: 'Приоритет' },
  'tasks.status': { en: 'Status', zh: '状态', ja: 'ステータス', th: 'สถานะ', mi: 'Tūnga', ru: 'Статус' },
  'tasks.sp': { en: 'SP', zh: 'SP', ja: 'SP', th: 'SP', mi: 'SP', ru: 'SP' },
  'tasks.required': {
    en: ' (required)',
    zh: '（必填）',
    ja: '（必須）',
    th: ' (จำเป็น)',
    mi: ' (hiahia)',
    ru: ' (обяз.)',
  },
  'tasks.descMarkdown': {
    en: 'Description (Markdown supported)',
    zh: '描述（支持 Markdown）',
    ja: '説明（Markdown対応）',
    th: 'คำอธิบาย (Markdown)',
    mi: 'Whakaahuatanga (Markdown)',
    ru: 'Описание (Markdown)',
  },
  'tasks.newTask': {
    en: 'New Task',
    zh: '新任务',
    ja: '新規タスク',
    th: 'งานใหม่',
    mi: 'Mahi Hou',
    ru: 'Новая задача',
  },
  'tasks.emailDetail': {
    en: '📥 Email Task Detail',
    zh: '📥 邮件任务详情',
    ja: '📥 メールタスク詳細',
    th: '📥 รายละเอียดงานอีเมล',
    mi: '📥 Taipitopito Mahi Īmēra',
    ru: '📥 Детали задачи',
  },
  'tasks.from': { en: 'From: ', zh: '发件人：', ja: '送信者：', th: 'จาก：', mi: 'Nā：', ru: 'От：' },
  'tasks.markDone': {
    en: 'Mark Done',
    zh: '标记完成',
    ja: '完了マーク',
    th: 'ทำเครื่องหมายเสร็จ',
    mi: 'Tohu Kua Oti',
    ru: 'Отметить готово',
  },
  'tasks.markDoneConfirm': {
    en: 'Mark this email task as done?',
    zh: '将此邮件任务标记为完成？',
    ja: 'このメールタスクを完了にしますか？',
    th: 'ทำเครื่องหมายงานอีเมลนี้ว่าเสร็จ?',
    mi: 'Tohua tēnei mahi īmēra kua oti?',
    ru: 'Отметить как готово?',
  },
  'tasks.deleteConfirm': {
    en: 'Delete this task? This action cannot be undone.',
    zh: '删除此任务？此操作无法撤销。',
    ja: 'このタスクを削除しますか？元に戻せません。',
    th: 'ลบงานนี้? ไม่สามารถยกเลิกได้',
    mi: 'Mukua tēnei mahi? Kāore e taea te whakakore.',
    ru: 'Удалить задачу? Это необратимо.',
  },
  'tasks.deleteTask': {
    en: 'Delete Task',
    zh: '删除任务',
    ja: 'タスク削除',
    th: 'ลบงาน',
    mi: 'Mukua Mahi',
    ru: 'Удалить задачу',
  },
  'tasks.batchDelete': {
    en: 'Batch Delete',
    zh: '批量删除',
    ja: '一括削除',
    th: 'ลบเป็นชุด',
    mi: 'Mukua Rōpū',
    ru: 'Массовое удаление',
  },

  // ═══ Reports Panel ═══
  'reports.search': {
    en: '🔍 Search reports...',
    zh: '🔍 搜索报告...',
    ja: '🔍 レポート検索...',
    th: '🔍 ค้นหารายงาน...',
    mi: '🔍 Rapu pūrongo...',
    ru: '🔍 Поиск...',
  },
  'reports.draft': {
    en: '📝 Draft',
    zh: '📝 草稿',
    ja: '📝 下書き',
    th: '📝 ร่าง',
    mi: '📝 Tauira',
    ru: '📝 Черновик',
  },
  'reports.sent': {
    en: '📤 Sent',
    zh: '📤 已发送',
    ja: '📤 送信済み',
    th: '📤 ส่งแล้ว',
    mi: '📤 Kua Tukua',
    ru: '📤 Отправлено',
  },
  'reports.daily': { en: 'Daily', zh: '日报', ja: '日次', th: 'รายวัน', mi: 'Ia Rā', ru: 'Дневной' },
  'reports.weekly': { en: 'Weekly', zh: '周报', ja: '週次', th: 'รายสัปดาห์', mi: 'Ia Wiki', ru: 'Недельный' },
  'reports.title': {
    en: 'Report title',
    zh: '报告标题',
    ja: 'レポートタイトル',
    th: 'ชื่อรายงาน',
    mi: 'Taitara Pūrongo',
    ru: 'Заголовок',
  },
  'reports.body': {
    en: 'Body (Markdown)',
    zh: '内容（Markdown）',
    ja: '本文（Markdown）',
    th: 'เนื้อหา (Markdown)',
    mi: 'Tinana (Markdown)',
    ru: 'Содержание (Markdown)',
  },
  'reports.deleteReport': {
    en: 'Delete Report',
    zh: '删除报告',
    ja: 'レポート削除',
    th: 'ลบรายงาน',
    mi: 'Mukua Pūrongo',
    ru: 'Удалить отчёт',
  },

  // ═══ Settings Tabs ═══
  'settings.llm': { en: 'LLM', zh: 'LLM', ja: 'LLM', th: 'LLM', mi: 'LLM', ru: 'LLM' },
  'settings.keys': { en: 'Keys', zh: '密钥', ja: 'キー', th: 'กุญแจ', mi: 'Kī', ru: 'Ключи' },
  'settings.email': { en: 'Email', zh: '邮件', ja: 'メール', th: 'อีเมล', mi: 'Īmēra', ru: 'Почта' },
  'settings.git': { en: 'Git', zh: 'Git', ja: 'Git', th: 'Git', mi: 'Git', ru: 'Git' },
  'settings.standup': {
    en: 'Daily Standup',
    zh: '每日站会',
    ja: 'デイリースタンドアップ',
    th: 'สแตนด์อัพรายวัน',
    mi: 'Tū Ata',
    ru: 'Ежедневный стендап',
  },
  'settings.about': { en: 'About', zh: '关于', ja: '概要', th: 'เกี่ยวกับ', mi: 'Mō', ru: 'О программе' },

  // ═══ Feedback Panel ═══
  'feedback.title': { en: '📬 Submit Feedback', zh: '📬 提交反馈', ja: '📬 フィードバック送信' },
  'feedback.thankYou': {
    en: 'Thank you for your feedback!',
    zh: '感谢你的反馈！',
    ja: 'フィードバックありがとうございます！',
  },
  'feedback.sent': { en: 'Feedback sent. Thanks!', zh: '反馈已发送，感谢！', ja: '送信しました。' },
  'feedback.sentTo': {
    en: 'Opened in your browser — submit the GitHub Issue to send feedback. Thanks!',
    zh: '已在浏览器打开 — 提交 GitHub Issue 即可发送反馈，感谢！',
    ja: 'ブラウザで開きました — GitHub Issue を送信するとフィードバックが届きます。ありがとうございます！',
  },
  'feedback.type': { en: 'Type', zh: '类型', ja: 'タイプ' },
  'feedback.bugReport': { en: '🐛 Bug Report', zh: '🐛 Bug 报告', ja: '🐛 バグ報告' },
  'feedback.featureRequest': { en: '💡 Feature Request', zh: '💡 功能建议', ja: '💡 機能リクエスト' },
  'feedback.otherFeedback': { en: '💬 Other', zh: '💬 其他反馈', ja: '💬 その他' },
  'feedback.titleLabel': { en: 'Title', zh: '标题', ja: 'タイトル' },
  'feedback.titlePlaceholder': { en: 'Brief description', zh: '一句话描述', ja: '概要を入力' },
  'feedback.bodyLabel': { en: 'Description', zh: '详细描述', ja: '詳細説明' },
  'feedback.bodyPlaceholder': {
    en: 'Expected vs actual behavior, reproduction steps, etc.',
    zh: '请描述预期行为、实际行为、复现步骤等',
    ja: '期待する動作・実際の動作・再現手順などを記入',
  },
  'feedback.contact': { en: 'Contact (optional)', zh: '联系方式（可选）', ja: '連絡先（任意）' },
  'feedback.contactPlaceholder': { en: 'email or GitHub ID', zh: 'email 或 GitHub ID', ja: 'メール または GitHub ID' },
  'feedback.submit': { en: 'Submit', zh: '提交', ja: '送信' },
  'feedback.submitting': { en: 'Submitting...', zh: '提交中...', ja: '送信中...' },
  'feedback.footer': {
    en: 'Feedback is submitted via GitHub Issues',
    zh: '反馈通过 GitHub Issues 提交',
    ja: 'フィードバックは GitHub Issues で送信されます',
  },
  'feedback.sendFailed': {
    en: '❌ Submission failed, please try again.',
    zh: '❌ 提交失败，请重试。',
    ja: '❌ 送信に失敗しました。再試行してください。',
  },
  'feedback.noSmtp': {
    en: 'Please configure SMTP in Settings → Email before submitting feedback.',
    zh: '请先在 Settings → Email 配置 SMTP 后再提交反馈。',
    ja: 'Settings → Email でSMTPを設定してください。',
  },

  // ═══ Email Settings Tab ═══
  'emailTab.connected': { en: 'Connected', zh: '已连接', ja: '接続済み' },
  'emailTab.chooseProvider': { en: 'Choose your email provider', zh: '选择邮箱服务商', ja: 'メールプロバイダーを選択' },
  'emailTab.custom': { en: 'Custom', zh: '自定义', ja: 'カスタム' },
  'emailTab.emailAddress': { en: 'Email Address', zh: '邮箱地址', ja: 'メールアドレス' },
  'emailTab.passwordAuthCode': { en: 'Password / Auth Code', zh: '密码 / 授权码', ja: 'パスワード / 認証コード' },
  'emailTab.appPasswordHint': {
    en: 'App password or email password',
    zh: '应用专用密码或邮箱密码',
    ja: 'アプリパスワードまたはメールパスワード',
  },
  'emailTab.howToGetAuthCode': {
    en: 'How to get {provider} auth code',
    zh: '{provider} 授权码获取方法',
    ja: '{provider} 認証コードの取得方法',
  },
  'emailTab.fromName': { en: 'From Name', zh: '发件人名称', ja: '送信者名' },
  'emailTab.advancedSettings': { en: 'Advanced Settings', zh: '高级设置', ja: '詳細設定' },
  'emailTab.incoming': { en: 'Incoming', zh: '收件', ja: '受信' },
  'emailTab.pollSeconds': { en: 'Poll(s)', zh: '轮询秒', ja: 'ポーリング(秒)' },
  'emailTab.outgoing': { en: 'Outgoing', zh: '发件', ja: '送信' },
  'emailTab.disconnect': { en: 'Disconnect', zh: '断开连接', ja: '切断' },
  'emailTab.saveAndConnect': { en: 'Save & Connect', zh: '保存并连接', ja: '保存して接続' },
  'emailTab.saving': { en: 'Saving...', zh: '保存中...', ja: '保存中...' },
  'emailTab.connecting': { en: 'Connecting...', zh: '连接中...', ja: '接続中...' },
  'emailTab.connectedOk': { en: '✅ Connected', zh: '✅ 已连接', ja: '✅ 接続済み' },
  'emailTab.disconnecting': { en: 'Disconnecting...', zh: '断开中...', ja: '切断中...' },
  'emailTab.disconnected': { en: 'Disconnected', zh: '已断开', ja: '切断済み' },
  'emailTab.testingSmtp': { en: 'Testing SMTP...', zh: '正在测试 SMTP...', ja: 'SMTP テスト中...' },
  'emailTab.smtpFailed': { en: '❌ SMTP failed: ', zh: '❌ SMTP 失败：', ja: '❌ SMTP 失敗：' },
  'emailTab.checkSettings': { en: 'check settings', zh: '请检查设置', ja: '設定を確認してください' },
  'emailTab.smtpConnFailed': {
    en: '❌ SMTP connection failed',
    zh: '❌ SMTP 连接失败',
    ja: '❌ SMTP 接続に失敗しました',
  },
  'emailTab.saveFailed': { en: '❌ Save failed', zh: '❌ 保存失败', ja: '❌ 保存に失敗しました' },
  'emailTab.imapConnectFailed': { en: 'IMAP connect failed', zh: 'IMAP 连接失败', ja: 'IMAP 接続に失敗しました' },
  'emailTab.networkError': { en: 'Network error', zh: '网络错误', ja: 'ネットワークエラー' },

  // ═══ Git Settings Tab ═══
  'gitTab.workDirs': { en: 'Work Directories', zh: '工作目录', ja: 'ワークディレクトリ' },
  'gitTab.workDirsDesc': {
    en: 'Add directories to scan for Git repos and commits. Auto-polled every 10 minutes.',
    zh: '添加目录以扫描 Git 仓库和提交记录。每 10 分钟自动轮询。',
    ja: 'Git リポジトリとコミットをスキャンするディレクトリを追加します。10分ごとに自動ポーリング。',
  },
  'gitTab.add': { en: '+ Add', zh: '+ 添加', ja: '+ 追加' },
  'gitTab.discoveredRepos': { en: 'Discovered Repos', zh: '发现的仓库', ja: '検出されたリポジトリ' },
  'gitTab.noReposFound': {
    en: 'No repos found yet. Add a work directory and scan.',
    zh: '尚未发现仓库。请添加工作目录并扫描。',
    ja: 'リポジトリが見つかりません。ワークディレクトリを追加してスキャンしてください。',
  },
  'gitTab.lastScan': { en: 'Last scan: ', zh: '上次扫描: ', ja: '最終スキャン: ' },
  'gitTab.notScanned': { en: 'Not scanned', zh: '未扫描', ja: '未スキャン' },
  'gitTab.recentCommits': { en: 'Recent Commits', zh: '最近提交', ja: '最近のコミット' },
  'gitTab.scanning': { en: 'Scanning...', zh: '扫描中...', ja: 'スキャン中...' },
  'gitTab.scanNow': { en: ' Scan Now', zh: ' 立即扫描', ja: ' 今すぐスキャン' },
  'gitTab.noCommits': {
    en: 'No commits recorded yet. Add a work directory and start scanning.',
    zh: '暂无提交记录。请添加工作目录并开始扫描。',
    ja: 'コミットが記録されていません。ワークディレクトリを追加してスキャンを開始してください。',
  },
  'gitTab.prev': { en: 'Prev', zh: '上一页', ja: '前へ' },
  'gitTab.next': { en: 'Next', zh: '下一页', ja: '次へ' },
  'gitTab.pageNum': { en: 'Page {n} / {m}', zh: '第 {n} 页 / 共 {m} 页', ja: '{n} / {m} ページ' },
  'gitTab.scanError': { en: 'Scan Error', zh: '扫描错误', ja: 'スキャンエラー' },
  'gitTab.scanComplete': { en: 'Scan Complete', zh: '扫描完成', ja: 'スキャン完了' },
  'gitTab.noReposFoundDialog': {
    en: 'No repos found.\nCheck:\n1) Work directory added\n2) Path is correct\n3) Git installed and in PATH',
    zh: '未发现仓库。请确认：\n1) 已添加工作目录\n2) 目录路径正确\n3) Git 已安装且在 PATH 中',
    ja: 'リポジトリが見つかりません。以下を確認：\n1) ワークディレクトリが追加されているか\n2) パスが正しいか\n3) Git がインストールされ PATH にあるか',
  },
  'gitTab.scanResult': {
    en: 'Found {repos} repos, {commits} new commits',
    zh: '发现 {repos} 个仓库，{commits} 条新提交',
    ja: '{repos} 件のリポジトリ、{commits} 件の新しいコミットを検出',
  },
  'gitTab.gitNotFound': {
    en: 'Git not found. Install Git and ensure it is in system PATH.',
    zh: '未找到 Git。请安装 Git 并确保其在系统 PATH 中。',
    ja: 'Gitが見つかりません。GitをインストールしてシステムPATHに追加してください。',
  },

  // ═══ Standup Settings Tab ═══
  'standupTab.morningCheckin': { en: 'Morning Check-in', zh: '晨会提醒', ja: '朝のチェックイン' },
  'standupTab.morningDesc': {
    en: "Show today's task summary at the top of chat at the set time.",
    zh: '到达设定时间后，在聊天窗口顶部显示今日任务摘要。',
    ja: '設定時間になると、チャット上部に今日のタスク概要を表示します。',
  },
  'standupTab.enableMorning': { en: 'Enable morning check-in', zh: '启用晨会提醒', ja: '朝のチェックインを有効にする' },
  'standupTab.reminderTime': { en: 'Time', zh: '提醒时间', ja: '通知時間' },
  'standupTab.eveningReport': { en: 'Evening Auto-Report', zh: '晚报自动生成', ja: '夕方の自動レポート' },
  'standupTab.eveningDesc': {
    en: 'At the set time, auto-generate a daily report with a bubble notification.',
    zh: '到达设定时间后，自动汇总今日数据生成日报并气泡提醒。',
    ja: '設定時間になると、今日のデータを自動集計して日報を生成し、バブル通知します。',
  },
  'standupTab.enableEvening': {
    en: 'Enable auto evening report',
    zh: '启用晚报自动生成',
    ja: '夕方レポートを有効にする',
  },
  'standupTab.generateTime': { en: 'Time', zh: '生成时间', ja: '生成時間' },
  'standupTab.saveSettings': { en: 'Save Settings', zh: '保存设置', ja: '設定を保存' },
  'standupTab.unsavedChanges': { en: 'Unsaved changes', zh: '有未保存的更改', ja: '未保存の変更があります' },

  // ═══ Email Form (standalone SMTP form) ═══
  'emailForm.smtpHost': { en: 'SMTP Host', zh: 'SMTP 主机', ja: 'SMTP ホスト' },
  'emailForm.port': { en: 'Port', zh: '端口', ja: 'ポート' },
  'emailForm.email': { en: 'Email', zh: '邮箱', ja: 'メール' },
  'emailForm.password': { en: 'Password / Auth Code', zh: '密码 / 授权码', ja: 'パスワード / 認証コード' },
  'emailForm.fromName': { en: 'From Name', zh: '发件人名称', ja: '送信者名' },
  'emailForm.useStarttls': { en: 'Use STARTTLS', zh: '使用 STARTTLS', ja: 'STARTTLS を使用' },
  'emailForm.testConnection': { en: 'Test Connection', zh: '测试连接', ja: '接続テスト' },
  'emailForm.testing': { en: 'Testing...', zh: '测试中...', ja: 'テスト中...' },
  'emailForm.saveChanges': { en: 'Save Changes', zh: '保存更改', ja: '変更を保存' },
  'emailForm.connected': { en: '✅ Connected', zh: '✅ 已连接', ja: '✅ 接続済み' },
  'emailForm.saved': { en: '✅ Saved', zh: '✅ 已保存', ja: '✅ 保存済み' },
  'emailForm.connFailed': {
    en: '❌ Connection failed. Check your host, port, email and password.',
    zh: '❌ 连接失败。请检查主机、端口、邮箱和密码。',
    ja: '❌ 接続に失敗しました。ホスト、ポート、メール、パスワードを確認してください。',
  },
  'emailForm.failed': { en: '❌ Failed', zh: '❌ 失败', ja: '❌ 失敗' },

  // ═══ Markdown Editor ═══
  'md.ctrlEnter': {
    en: 'Ctrl+Enter to exit code block',
    zh: 'Ctrl+Enter 退出代码块',
    ja: 'Ctrl+Enter でコードブロックを抜ける',
    th: 'Ctrl+Enter เพื่อออกจากบล็อกโค้ด',
    mi: 'Ctrl+Enter ki te puta i te paraka waehere',
    ru: 'Ctrl+Enter для выхода из блока кода',
  },

  // ═══ Update ═══
  'update.downloading': {
    en: 'Downloading',
    zh: '下载中',
    ja: 'ダウンロード中',
    th: 'กำลังดาวน์โหลด',
    mi: 'E tikiake ana',
    ru: 'Загрузка',
  },
  'update.downloaded': {
    en: 'Downloaded — restart to install',
    zh: '已下载，重启以安装',
    ja: 'ダウンロード完了 — 再起動してインストール',
    th: 'ดาวน์โหลดแล้ว — รีสตาร์ทเพื่อติดตั้ง',
    mi: 'Kua tikiake — whakaara anō hei tāuta',
    ru: 'Загружено — перезапустите',
  },

  // ═══ Evening Report ═══
  'evening.report': {
    en: '📋 Evening Report',
    zh: '📋 晚报',
    ja: '📋 イブニングレポート',
    th: '📋 รายงานเย็น',
    mi: '📋 Pūrongo Ahiahi',
    ru: '📋 Вечерний отчёт',
  },
  'evening.noData': {
    en: '⚠️ No data',
    zh: '⚠️ 暂无数据',
    ja: '⚠️ データなし',
    th: '⚠️ ไม่มีข้อมูล',
    mi: '⚠️ Kāore he raraunga',
    ru: '⚠️ Нет данных',
  },

  // ═══ Misc ═══
  'misc.error': { en: 'Error', zh: '错误', ja: 'エラー' },
  'misc.deleted': { en: 'Deleted', zh: '已删除', ja: '削除済み', th: 'ลบแล้ว', mi: 'Kua Mukua', ru: 'Удалено' },
  'misc.resolved': {
    en: 'Resolved',
    zh: '已处理',
    ja: '処理済み',
    th: 'จัดการแล้ว',
    mi: 'Kua Whakahaere',
    ru: 'Обработано',
  },
  'misc.cannotParse': {
    en: 'Cannot parse',
    zh: '无法解析',
    ja: '解析不能',
    th: 'แยกวิเคราะห์ไม่ได้',
    mi: 'Kāore e taea',
    ru: 'Не разобрать',
  },
  'misc.loading': {
    en: 'Loading...',
    zh: '加载中...',
    ja: '読み込み中...',
    th: 'กำลังโหลด...',
    mi: 'E uta ana...',
    ru: 'Загрузка...',
  },

  // ═══ Markdown Editor Toolbar ═══
  'md.bold': { en: 'Bold', zh: '加粗', ja: '太字' },
  'md.italic': { en: 'Italic', zh: '斜体', ja: '斜体' },
  'md.strikethrough': { en: 'Strikethrough', zh: '删除线', ja: '取り消し線' },
  'md.inlineCode': { en: 'Inline Code', zh: '行内代码', ja: 'インラインコード' },
  'md.heading1': { en: 'Heading 1', zh: '一级标题', ja: '見出し1' },
  'md.heading2': { en: 'Heading 2', zh: '二级标题', ja: '見出し2' },
  'md.heading3': { en: 'Heading 3', zh: '三级标题', ja: '見出し3' },
  'md.bulletList': { en: 'Bullet List', zh: '无序列表', ja: '箇条書き' },
  'md.numberedList': { en: 'Numbered List', zh: '有序列表', ja: '番号付きリスト' },
  'md.blockquote': { en: 'Blockquote', zh: '引用块', ja: '引用' },
  'md.codeBlock': { en: 'Code Block', zh: '代码块', ja: 'コードブロック' },
  'md.link': { en: 'Link', zh: '链接', ja: 'リンク' },
  'md.image': { en: 'Image', zh: '图片', ja: '画像' },
  'md.textColor': { en: 'Text Color', zh: '文字颜色', ja: '文字色' },
  'md.highlight': { en: 'Highlight', zh: '高亮', ja: 'ハイライト' },
  'md.insertTable': { en: 'Insert Table', zh: '插入表格', ja: '表を挿入' },
  'md.horizontalRule': { en: 'Horizontal Rule', zh: '分割线', ja: '区切り線' },
  'md.taskList': { en: 'Task List', zh: '任务列表', ja: 'タスクリスト' },
  'md.addRowAbove': { en: 'Add Row Above', zh: '上方插入行', ja: '上に行を追加' },
  'md.addRowBelow': { en: 'Add Row Below', zh: '下方插入行', ja: '下に行を追加' },
  'md.addColLeft': { en: 'Add Column Left', zh: '左侧插入列', ja: '左に列を追加' },
  'md.addColRight': { en: 'Add Column Right', zh: '右侧插入列', ja: '右に列を追加' },
  'md.deleteRow': { en: 'Delete Row', zh: '删除行', ja: '行を削除' },
  'md.deleteCol': { en: 'Delete Column', zh: '删除列', ja: '列を削除' },
  'md.deleteTable': { en: 'Delete Table', zh: '删除表格', ja: '表を削除' },
  'md.alignLeft': { en: 'Align Left', zh: '居左', ja: '左揃え' },
  'md.alignCenter': { en: 'Align Center', zh: '居中', ja: '中央揃え' },
  'md.alignRight': { en: 'Align Right', zh: '居右', ja: '右揃え' },

  // ═══ Email Panel ═══
  'emailList.noConfigTitle': { en: 'No Email Configured', zh: '尚未配置邮箱', ja: 'メール未設定' },
  'emailList.noConfigDesc': {
    en: 'Connect your IMAP inbox and AI will automatically classify emails and draft smart replies.',
    zh: '配置 IMAP 邮箱后，AI 将自动分类收件箱并生成智能回复草稿。',
    ja: 'IMAP受信トレイを接続すると、AIが自動でメールを分類し、スマートな返信下書きを作成します。',
  },
  'emailList.goToSettings': { en: '⚙️ Go to Email Settings →', zh: '⚙️ 前往设置邮箱 →', ja: '⚙️ メール設定へ →' },
  'emailList.cat1Desc': {
    en: 'Urgent emails requiring immediate action — incidents, security issues, escalations',
    zh: '需要立即处理的紧急邮件，如生产事故、安全漏洞、老板加急等',
    ja: 'インシデント、セキュリティ問題など早急な対応が必要な緊急メール',
  },
  'emailList.cat2Desc': {
    en: 'Emails needing a reply today — task assignments, review requests, collaboration',
    zh: '需要在今天内回复的工作邮件，如任务指派、评审请求、协同讨论等',
    ja: 'タスク割り当て、レビュー依頼など今日中に返信が必要なメール',
  },
  'emailList.cat3Desc': {
    en: 'Notifications to be aware of — CI/CD alerts, system warnings, digests',
    zh: '只需知晓不需回复的通知类邮件，如 CI/CD 通告、系统告警、周报等',
    ja: 'CI/CD通知、システムアラートなど確認のみで返信不要の通知メール',
  },
  'emailList.cat4Desc': {
    en: 'Low-priority emails — newsletters, digests, marketing',
    zh: '不紧急的邮件，如订阅推送、技术简报、营销邮件等',
    ja: 'ニュースレターやマーケティングなど優先度の低いメール',
  },
  'emailList.aiAnalyzing': { en: 'AI analyzing & grouping...', zh: 'AI 正在分析归类...', ja: 'AIが分析中...' },
  'emailPanel.unlinkTitle': { en: 'Unlink Task', zh: '解除关联任务', ja: 'タスクの関連付け解除' },
  'emailPanel.unlinkMessage': {
    en: 'This will delete the linked task. Continue?',
    zh: '解除关联将删除此任务，确定继续？',
    ja: '関連付けを解除すると、このタスクは削除されます。続行しますか？',
  },
  'emailPanel.deleteTask': { en: 'Delete Task', zh: '删除任务', ja: 'タスクを削除' },
  'emailPanel.deleting': { en: 'Deleting...', zh: '删除中...', ja: '削除中...' },
  'emailPanel.processing': { en: 'Processing...', zh: '处理中...', ja: '処理中...' },
  'emailPanel.unsavedTitle': { en: 'Unsaved Changes', zh: '未保存的更改', ja: '未保存の変更' },
  'emailPanel.unsavedMessage': {
    en: 'Save draft before leaving?',
    zh: '保存草稿后退出？',
    ja: '下書きを保存してから退出しますか？',
  },
  'emailPanel.save': { en: 'Save', zh: '保存', ja: '保存' },
  'emailPanel.exit': { en: 'Exit', zh: '不保存', ja: '破棄' },
  'emailPanel.sendError.noSmtp': { en: 'No SMTP config', zh: '未配置 SMTP', ja: 'SMTPが未設定です' },
  'emailPanel.sendError.sendFailed': { en: 'Send failed', zh: '发送失败', ja: '送信失敗' },
  'emailPanel.sendError.network': { en: 'Network error', zh: '网络错误', ja: 'ネットワークエラー' },
  'emailPanel.sendError.noRecipients': { en: 'No recipients', zh: '未指定收件人', ja: '宛先が指定されていません' },
  'emailPanel.sendError.smtpIncomplete': {
    en: 'SMTP config incomplete',
    zh: 'SMTP 配置不完整',
    ja: 'SMTP設定が不完全です',
  },
  'emailPanel.sendError.noPassword': {
    en: 'SMTP password not configured',
    zh: '未配置 SMTP 密码',
    ja: 'SMTPパスワードが未設定です',
  },
  'emailPanel.sendError.noSmtpFound': {
    en: 'No SMTP config found',
    zh: '未找到 SMTP 配置',
    ja: 'SMTP設定が見つかりません',
  },
  'report.saveFailed': { en: 'Save failed.', zh: '保存失败。', ja: '保存に失敗しました。' },
  'export.title': { en: 'Export', zh: '导出', ja: 'エクスポート' },
  'export.excel': { en: '📊 Excel (.xlsx)', zh: '📊 Excel (.xlsx)', ja: '📊 Excel (.xlsx)' },
  'export.word': { en: '📄 Word (.docx)', zh: '📄 Word (.docx)', ja: '📄 Word (.docx)' },
  'export.html': { en: '🌐 HTML (.html)', zh: '🌐 HTML (.html)', ja: '🌐 HTML (.html)' },
  'export.markdown': { en: '📝 Markdown (.md)', zh: '📝 Markdown (.md)', ja: '📝 Markdown (.md)' },
  'export.pdf': { en: '📄 PDF (.pdf)', zh: '📄 PDF (.pdf)', ja: '📄 PDF (.pdf)' },
  'export.ppt': { en: '📽 PowerPoint (.pptx)', zh: '📽 PowerPoint (.pptx)', ja: '📽 PowerPoint (.pptx)' },
  'export.success': { en: '✅ Exported to {path}', zh: '✅ 已导出至 {path}', ja: '✅ {path} にエクスポートしました' },
  'export.cancel': { en: 'Cancel', zh: '取消', ja: 'キャンセル' },
  'export.ok': { en: 'OK', zh: '确定', ja: 'OK' },
  'report.deleteFailed': { en: 'Delete failed.', zh: '删除失败。', ja: '削除に失敗しました。' },
  'emailPanel.reply': { en: 'Reply', zh: '回复', ja: '返信' },
  'emailDetail.summary': { en: 'AI Summary', zh: 'AI 摘要', ja: 'AI サマリー' },
  'emailDetail.draft': { en: 'AI Draft', zh: 'AI 草稿', ja: 'AI 下書き' },
  'emailDetail.send': { en: 'Send', zh: '发送', ja: '送信' },
  'emailDetail.sending': { en: 'Sending...', zh: '发送中...', ja: '送信中...' },
  'emailDetail.readOrig': { en: 'Read Original', zh: '阅读原文', ja: '原文を読む' },
  'emailDetail.dismiss': { en: 'Dismiss', zh: '忽略', ja: '閉じる' },
  'emailDetail.loading': { en: 'Loading...', zh: '加载中...', ja: '読み込み中...' },
  'emailDetail.loadFail': { en: 'Cannot load original', zh: '无法加载原文', ja: '読み込み失敗' },
  'emailDetail.from': { en: 'From', zh: '发件人', ja: '送信者' },
  'emailDetail.to': { en: 'To', zh: '收件人', ja: '宛先' },
  'emailDetail.subject': { en: 'Subject', zh: '主题', ja: '件名' },
  'emailDetail.selected': { en: '{n} selected', zh: '已选 {n} 封', ja: '{n}件選択中' },
  'emailDetail.clearSelection': { en: 'Clear', zh: '取消选择', ja: '選択解除' },
  'emailDetail.batchDismiss': { en: '🗑 Dismiss selected', zh: '🗑 忽略所选', ja: '🗑 選択を破棄' },
  'emailDetail.batchDismissing': { en: 'Dismissing...', zh: '忽略中...', ja: '破棄中...' },
  'emailList.colFrom': { en: 'From', zh: '发件人', ja: '送信者' },
  'emailList.colTime': { en: 'Time', zh: '时间', ja: '日時' },
  'emailList.colSubject': { en: 'Subject', zh: '主题', ja: '件名' },
  'emailList.groupToMe': { en: 'To Me', zh: '发给我的', ja: '自分宛' },
  'emailList.groupNotify': { en: 'Notifications', zh: '通知', ja: '通知' },
  'emailList.groupOther': { en: 'Other', zh: '其他', ja: 'その他' },
  'emailList.groupIncident': { en: 'Incidents', zh: '事故', ja: 'インシデント' },
  'emailList.groupEscalation': { en: 'Escalations', zh: '升级', ja: 'エスカレーション' },
  'emailList.groupReview': { en: 'Reviews', zh: '审核', ja: 'レビュー' },
  'emailList.groupTask': { en: 'Tasks', zh: '任务', ja: 'タスク' },
  'emailList.groupQuestion': { en: 'Questions', zh: '问题', ja: '質問' },
  'emailList.groupSecurity': { en: 'Security', zh: '安全', ja: 'セキュリティ' },
  'emailList.groupSystem': { en: 'System', zh: '系统', ja: 'システム' },
  'emailList.groupReport': { en: 'Reports', zh: '报告', ja: 'レポート' },
  'emailList.groupPromo': { en: 'Promotions', zh: '推广', ja: 'プロモーション' },
  'emailList.groupNewsletter': { en: 'Digests', zh: '文摘', ja: 'ダイジェスト' },
  'emailList.groupingWithAI': { en: 'AI grouping...', zh: 'AI 分组中...', ja: 'AIグループ分け中...' },
  'emailDetail.received': { en: 'Received', zh: '收信', ja: '受信' },
  'emailDetail.markDone': { en: 'Mark Done', zh: '标记完成', ja: '完了' },
  'emailDetail.aiDraft': { en: 'AI Draft', zh: 'AI 草稿', ja: 'AI 下書き' },
  'emailDetail.editDraft': { en: 'Edit reply draft...', zh: '编辑回复草稿...', ja: '返信下書きを編集...' },
  'emailDetail.genDraft': { en: '🤖 Generate Draft', zh: '🤖 生成草稿', ja: '🤖 下書き生成' },
  'emailDetail.genDrafting': { en: '🤖 Generating...', zh: '🤖 生成中...', ja: '🤖 生成中...' },
  'emailDetail.dismissConfirm': { en: 'Dismiss this email?', zh: '忽略此邮件？', ja: 'このメールを閉じますか？' },
  'emailDetail.dismissed': { en: '✅ Dismissed', zh: '✅ 已忽略', ja: '✅ 閉じました' },
  'emailDetail.tabAll': { en: '📥 All', zh: '📥 全部', ja: '📥 すべて' },
  'emailDetail.tabUrgent': { en: '🔴 Urgent', zh: '🔴 紧急', ja: '🔴 緊急' },
  'emailDetail.tabAction': { en: '🟡 Action Required', zh: '🟡 需处理', ja: '🟡 要対応' },
  'emailDetail.tabNotify': { en: '🔔 Notifications', zh: '🔔 通知', ja: '🔔 通知' },
  'emailDetail.tabLow': { en: '🔵 Other', zh: '🔵 其他', ja: '🔵 その他' },
  'emailDetail.empty': { en: 'Inbox empty', zh: '收件箱为空', ja: '受信トレイが空です' },
  'emailDetail.noConfig': {
    en: 'No email account connected.',
    zh: '未配置邮箱。',
    ja: 'メールアカウントが未設定です。',
  },
  'emailDetail.goToSettings': { en: 'Go to Settings →', zh: '前往设置 →', ja: '設定へ →' },
  'emailDetail.connected': { en: 'Connected', zh: '已连接', ja: '接続済み' },
  'emailDetail.disconnected': { en: 'Disconnected', zh: '未连接', ja: '未接続' },
  'emailDetail.trackedAs': { en: 'Tracked as', zh: '关联任务', ja: '関連タスク' },
  'emailDetail.convertToTask': { en: '📋 Convert to Task', zh: '📋 转为任务', ja: '📋 タスクに変換' },
  'emailDetail.original': { en: '📧 Original Email', zh: '📧 邮件原文', ja: '📧 元のメール' },
  'emailDetail.replySent': { en: '📤 Reply sent', zh: '📤 已发送', ja: '📤 送信済み' },
  'emailDetail.refresh': { en: 'Refresh', zh: '刷新', ja: '更新' },
  'emailDetail.back': { en: '← Back', zh: '← 返回', ja: '← 戻る' },
  'emailDetail.emailDetail': { en: 'Email Detail', zh: '邮件详情', ja: 'メール詳細' },

  // ═══ MCP Panel ═══
  'mcp.searchPlaceholder': { en: 'Search tools...', zh: '搜索工具...', ja: 'ツール検索...' },
  'mcp.filterAll': { en: 'All', zh: '全部', ja: 'すべて' },
  'mcp.filterPending': { en: 'Pending', zh: '待审批', ja: '承認待ち' },
  'mcp.filterApproved': { en: 'Approved', zh: '已批准', ja: '承認済み' },
  'mcp.filterExecuted': { en: 'Executed', zh: '已执行', ja: '実行済み' },
  'mcp.filterDenied': { en: 'Denied', zh: '已拒绝', ja: '拒否' },
  'mcp.entries': { en: 'entries', zh: '条记录', ja: '件' },
  'mcp.loading': { en: 'Loading...', zh: '加载中...', ja: '読み込み中...' },
  'mcp.empty': { en: 'No audit entries yet.', zh: '暂无审计记录。', ja: '監査記録はありません。' },
  'mcp.external': { en: 'External', zh: '外部', ja: '外部' },
  'mcp.approve': { en: '✓ Approve', zh: '✓ 批准', ja: '✓ 承認' },
  'mcp.deny': { en: '✕ Deny', zh: '✕ 拒绝', ja: '✕ 拒否' },
  'mcp.result': { en: 'Result:', zh: '结果:', ja: '結果:' },
  'mcp.approved': { en: '✅ Approved', zh: '✅ 已批准', ja: '✅ 承認済み' },
  'mcp.denied': { en: '✕ Denied', zh: '✕ 已拒绝', ja: '✕ 拒否済み' },
  'mcp.actionFailed': { en: 'Action failed', zh: '操作失败', ja: '操作に失敗しました' },

  // ═══ Settings → API Keys ═══
  'apikey.generateTitle': { en: 'Generate API Key', zh: '生成 API 密钥', ja: 'APIキーを生成' },
  'apikey.nameLabel': { en: 'Key Name', zh: '密钥名称', ja: 'キー名' },
  'apikey.namePlaceholder': { en: 'e.g. cursor-mcp', zh: '例如: cursor-mcp', ja: '例: cursor-mcp' },
  'apikey.hitlLabel': { en: 'HITL Mode', zh: 'HITL 模式', ja: 'HITL モード' },
  'apikey.hitlManual': {
    en: 'Manual (all writes require confirmation)',
    zh: '手动（读取以外需确认）',
    ja: '手動（読み取り以外は確認が必要）',
  },
  'apikey.hitlAuto': {
    en: 'Auto (auto-approve all operations)',
    zh: '自动（自动批准所有操作）',
    ja: '自動（すべての操作を自動承認）',
  },
  'apikey.generate': { en: 'Generate Key', zh: '生成密钥', ja: 'APIキーを生成' },
  'apikey.usageTitle': { en: 'Usage', zh: '使用方法', ja: '使用方法' },
  'apikey.stdioTitle': { en: 'Claude Code / any MCP client', zh: 'Claude Code / 任意 MCP 客户端', ja: 'Claude Code / 任意の MCP クライアント' },
  'apikey.stdioLead': {
    en: 'Add this to .mcp.json in your project root (Claude Code), or to your client’s own MCP config file:',
    zh: '把下面这段加到项目根目录的 .mcp.json（Claude Code），或你的客户端自己的 MCP 配置文件里：',
    ja: 'これをプロジェクトルートの .mcp.json（Claude Code）、またはお使いのクライアントの MCP 設定ファイルに追加します：',
  },
  'apikey.keyNote': {
    en: 'Replace the key placeholder with the key you generate below — it is shown only once.',
    zh: '把密钥占位符替换为下方生成的完整密钥 —— 它只显示一次。',
    ja: 'キーのプレースホルダーを下で生成したキーに置き換えてください。キーは一度しか表示されません。',
  },
  'apikey.httpTitle': { en: 'Local HTTP endpoint', zh: '本地 HTTP 端点', ja: 'ローカル HTTP エンドポイント' },
  'apikey.httpLead': {
    en: 'If your client speaks Streamable HTTP instead of stdio, point it at this URL and send your key in an X-Api-Key header:',
    zh: '如果你的客户端用的是 Streamable HTTP 而不是 stdio，把它指向这个地址，并用 X-Api-Key 头带上密钥：',
    ja: 'クライアントが stdio ではなく Streamable HTTP を使う場合は、この URL を指定し、キーを X-Api-Key ヘッダーで送信してください：',
  },
  'apikey.toolsTitle': { en: 'Tools', zh: '工具', ja: 'ツール' },
  'apikey.toolsLead': {
    en: 'All {count} tools are available. Reads run immediately; a write returns a pending-approval message and waits for you to approve it in the MCP panel, then the same call returns the result.',
    zh: '共 {count} 个工具可用。读操作直接执行；写操作会返回"待审批"，等你在这个应用的 MCP 面板里批准后，用同样的参数再调一次就能拿到结果。',
    ja: '{count} 個のツールが利用できます。読み取りは即時実行され、書き込みは「承認待ち」を返します。MCP パネルで承認したあと、同じ引数で再度呼び出すと結果が返ります。',
  },
  'apikey.hitlNote': {
    en: 'Manual — writes wait for your approval in the MCP panel. Auto — everything runs immediately.',
    zh: '手动 —— 写操作需在本应用的 MCP 面板中人工批准。自动 —— 所有操作立即执行。',
    ja: '手動 — 書き込みは MCP パネルでの承認を待ちます。自動 — すべての操作が即時実行されます。',
  },
  'apikey.hashNote': {
    en: 'Keys are SHA-256 hashed before storage. The raw key is shown only once.',
    zh: '密钥存储前经 SHA-256 哈希处理，原始密钥仅显示一次。',
    ja: 'キーは保存前に SHA-256 でハッシュ化されます。生のキーは一度だけ表示されます。',
  },
  'apikey.devWarning': {
    en: 'This is a development build, so the paths below are placeholders. Install the packaged app to get the real ones.',
    zh: '这是开发版，下面的路径是占位符。安装打包后的应用才会得到真实路径。',
    ja: 'これは開発ビルドのため、以下のパスはプレースホルダーです。実際のパスはパッケージ版で表示されます。',
  },
  'apikey.generated': {
    en: '✅ Key generated — copy now, won’t be shown again:',
    zh: '✅ 密钥已生成 —— 立即复制，不会再次显示：',
    ja: '✅ キーが生成されました — 今すぐコピーしてください。再表示されません：',
  },
  'apikey.listTitle': { en: 'API Keys', zh: 'API 密钥', ja: 'APIキー' },
  'apikey.usedTimes': { en: 'used {count}x', zh: '已用 {count} 次', ja: '{count} 回使用' },
  'apikey.created': { en: 'Created', zh: '创建于', ja: '作成' },
  'apikey.expires': { en: 'Expires', zh: '过期于', ja: '有効期限' },
  'apikey.revoke': { en: 'Revoke', zh: '撤销', ja: '失効' },
  'apikey.empty': { en: 'No API keys yet.', zh: '暂无 API 密钥。', ja: 'APIキーはまだありません。' },
  'apikey.revokeTitle': { en: 'Revoke API Key', zh: '撤销 API 密钥', ja: 'APIキーを失効' },
  'apikey.revokeMessage': {
    en: 'This key will be revoked immediately. MCP clients using this key will be unable to connect. Are you sure?',
    zh: '撤销后该密钥将立即失效，使用该密钥的 MCP 客户端将无法连接。确定要撤销吗？',
    ja: 'このキーは直ちに失効し、このキーを使用する MCP クライアントは接続できなくなります。よろしいですか？',
  },
  'apikey.cancel': { en: 'Cancel', zh: '取消', ja: 'キャンセル' },
  'apikey.revokeFailed': { en: 'Revoke failed: {msg}', zh: '撤销失败: {msg}', ja: '失効失敗: {msg}' },

  // ═══ LLM Settings Tab ═══
  'llmTab.provider': { en: 'Provider', zh: '服务商', ja: 'プロバイダー' },
  'llmTab.baseUrl': { en: 'Base URL', zh: 'Base URL', ja: 'ベースURL' },
  'llmTab.flashModel': { en: 'Flash Model', zh: 'Flash 模型', ja: 'Flashモデル' },
  'llmTab.proModel': { en: 'Pro Model', zh: 'Pro 模型', ja: 'Proモデル' },
  'llmTab.contextWindow': {
    en: 'Context window: {n}K tokens (model limit, not editable)',
    zh: '上下文窗口: {n}K tokens（模型固定值，不可修改）',
    ja: 'コンテキストウィンドウ: {n}K トークン（モデル固定値、変更不可）',
  },
  'llmTab.maxOutputTokens': { en: 'Max Output Tokens', zh: '最大输出 Tokens', ja: '最大出力トークン' },
  'llmTab.maxTokensHint': {
    en: 'Lower values are ignored. The provider minimum is {floor}.',
    zh: '低于下限的值将被忽略，当前下限为 {floor}。',
    ja: '下限を下回る値は無視されます。現在の下限は {floor} です。',
  },
  'llmTab.apiKey': { en: 'API Key', zh: 'API Key', ja: 'APIキー' },
  'llmTab.apiKeyConfigured': {
    en: '✅ API key already configured. Enter a new key to replace.',
    zh: '✅ API Key 已配置，输入新 Key 替换。',
    ja: '✅ APIキー設定済み。新しいキーを入力すると置き換えます。',
  },

  // ═══ Hosted LLM (Settings → LLM: 免费托管试用 / Pro) ═══
  'hosted.segmentByok': { en: 'My API Key', zh: '自带 API Key', ja: '自分の APIキー' },
  'hosted.segmentHosted': { en: 'Hosted quota', zh: '托管试用', ja: 'ホステッド枠' },
  'hosted.signedInBanner': {
    en: 'Logged in as {email} — hosted quota currently OFF (using your own key).',
    zh: '已登录 {email},当前未使用托管试用(使用自带 Key)。',
    ja: '{email} でログイン中 — 現在は自分のキーを使用中です。',
  },
  'hosted.useHosted': { en: 'Use hosted quota', zh: '启用托管试用', ja: 'ホステッド枠を使う' },
  'hosted.switchToByok': { en: 'Use my own key', zh: '切回自带 Key', ja: '自分のキーに戻す' },
  'hosted.logout': { en: 'Log out', zh: '退出登录', ja: 'ログアウト' },
  'hosted.loginTitle': { en: 'Free hosted trial', zh: '免费托管试用', ja: '無料ホステッド試用' },
  'hosted.loginDesc': {
    en: 'No API key needed. Route all AI features through the official gateway with an optional free trial credit and affordable Pro plans. Your provider keys never leave this device.',
    zh: '无需配置 Key。把全部 AI 功能接入官方网关,可免费试用小额额度,也能按量购买 Pro。你自带的 Key 不会离开本机。',
    ja: 'APIキー不要。全 AI 機能を公式ゲートウェイ経由に。無料トライアル枠と Pro プランが使えます。',
  },
  'hosted.trialCredit': { en: 'Free trial credit: ¥{n}', zh: '免费试用额度: ¥{n}', ja: '無料トライアル: ¥{n}' },
  'hosted.emailLabel': { en: 'Email', zh: '邮箱', ja: 'メール' },
  'hosted.codeLabel': { en: 'Verification code', zh: '验证码', ja: '認証コード' },
  'hosted.emailPlaceholder': { en: 'you@example.com', zh: 'you@example.com', ja: 'you@example.com' },
  'hosted.sendCode': { en: 'Send code', zh: '发送验证码', ja: '認証コード送信' },
  'hosted.resendIn': { en: 'Resend in {n}s', zh: '{n}s 后可重发', ja: '{n}秒後に再送信' },
  'hosted.codePlaceholder': { en: '6-digit code', zh: '6 位验证码', ja: '6桁のコード' },
  'hosted.login': { en: 'Verify & log in', zh: '登录', ja: 'ログイン' },
  'hosted.activeTitle': { en: 'Hosted account', zh: '托管账号', ja: 'ホステッドアカウント' },
  'hosted.planTrial': { en: 'Trial', zh: '试用', ja: 'トライアル' },
  'hosted.planPro': { en: 'Pro', zh: 'Pro', ja: 'Pro' },
  'hosted.planLabel': { en: 'Plan', zh: '套餐', ja: 'プラン' },
  'hosted.balance': { en: 'Balance', zh: '剩余额度', ja: '残高' },
  'hosted.used': { en: 'Used', zh: '已用', ja: '使用済み' },
  'hosted.totalCost': { en: 'Total cost', zh: '累计费用', ja: '累計費用' },
  'hosted.requests': { en: 'Requests', zh: '请求数', ja: 'リクエスト数' },
  'hosted.tokens': { en: 'Tokens', zh: 'Tokens', ja: 'トークン' },
  'hosted.refresh': { en: 'Refresh', zh: '刷新', ja: '更新' },
  'hosted.intentTitle': {
    en: 'If a paid Pro version launches later, would you consider subscribing?',
    zh: '若未来推出付费 Pro 版,你会考虑订阅吗?',
    ja: '将来、有料の Pro 版が出るとしたら、購読しますか?',
  },
  'hosted.intentDesc': {
    en: 'No API key or payment needed right now — we just want to hear from you.',
    zh: '现在无需申请 API key、也无需付款,只是想听听你的想法。',
    ja: '今は API キーも支払いも不要です。あなたの考えを教えてください。',
  },
  'hosted.intentYes': { en: 'Yes, I would', zh: '会订阅', ja: '購読する' },
  'hosted.intentPrice': { en: 'Depends on price', zh: '看价格', ja: '価格次第' },
  'hosted.intentUndecided': { en: 'Not sure yet', zh: '还不确定', ja: 'まだ分からない' },
  'hosted.intentNo': { en: 'No / free is enough', zh: '不会,免费够用', ja: '購読しない' },
  'hosted.intentDone': {
    en: 'Recorded — thanks for the feedback!',
    zh: '已记录,谢谢反馈!',
    ja: '記録しました — フィードバックありがとうございます!',
  },
  'hosted.quotaExhausted': {
    en: 'Free trial quota is used up — if a subscription launches later, tell us your intention at Settings → LLM → Hosted Trial.',
    zh: '免费试用额度已用完 — 若未来推出订阅版,欢迎到 设置 → LLM → 托管试用 告诉我们你的意愿。',
    ja: '無料トライアル枠を使い切りました — 将来サブスクリプションが出る場合は、設定 → LLM → ホステッド試用 からご意見をお聞かせください。',
  },
  'hosted.expired': {
    en: 'Session expired — please log in again.',
    zh: '会话已过期 — 请重新登录。',
    ja: 'セッションの有効期限が切れました。再ログインしてください。',
  },
  'hosted.networkError': {
    en: 'Unable to reach the hosted gateway. Check your network.',
    zh: '无法连接托管网关,请检查网络。',
    ja: 'ホステッドゲートウェイに接続できません。ネットワークを確認してください。',
  },
  'hosted.accountState': { en: 'Hosted: {state}', zh: '托管: {state}', ja: 'ホステッド: {state}' },
  'hosted.stateTrial': { en: 'trial ¥{n} left', zh: '试用中,剩 ¥{n}', ja: 'トライアル残 ¥{n}' },
  'hosted.statePro': { en: 'Pro', zh: 'Pro', ja: 'Pro' },
  'hosted.closedBanner': {
    en: 'Hosted gateway is currently closed (trial disabled). Requests will fail — switch to My API Key in Settings → LLM to keep chatting.',
    zh: '托管试用已关闭 — 当前请求会失败。可到 设置 → LLM 切回「自带 API Key」继续使用。',
    ja: 'ホステッド試用は現在閉鎖されています — 送信は失敗します。設定 → LLM で「自分の APIキー」に切り替えてください。',
  },
  'hosted.closedSettings': {
    en: 'Hosted gateway is closed right now — you cannot send messages or request new codes.',
    zh: '托管试用已关闭 — 暂无法发送消息或获取验证码。',
    ja: 'ホステッド試用は閉鎖中です — メッセージ送信と認証コード取得はできません。',
  },
  'hosted.errFeatureClosed': {
    en: 'Hosted trial is closed right now — switch to My API Key in Settings → LLM, or try again later.',
    zh: '托管试用已关闭 — 请到 设置 → LLM 切回「自带 API Key」，或稍后再试。',
    ja: 'ホステッド試用は現在閉鎖中です — 設定 → LLM で「自分の APIキー」に切り替えるか、後でもう一度お試しください。',
  },
  'hosted.errAccountDisabled': {
    en: 'This hosted account has been disabled — please contact support.',
    zh: '该托管账号已被停用 — 请联系管理员。',
    ja: 'このホステッドアカウントは無効化されています — 管理者にお問い合わせください。',
  },
  'hosted.errModelNotAllowed': {
    en: 'This model is not available on the hosted gateway.',
    zh: '该模型在托管网关上不可用。',
    ja: 'このモデルはホステッドゲートウェイでは利用できません。',
  },
  'hosted.errNotConfigured': {
    en: 'Hosted gateway is not configured yet — try again later.',
    zh: '托管网关尚未配置完成 — 请稍后再试。',
    ja: 'ホステッドゲートウェイがまだ設定されていません — 後でもう一度お試しください。',
  },

  // ═══ App (welcome screen, menu labels, entity labels) ═══
  'app.welcomeTitle': { en: 'Welcome to TomiLite', zh: '欢迎使用 TomiLite', ja: 'TomiLite AI エージェント' },
  'app.welcomeDesc': {
    en: 'Your AI office assistant. Chat, create, organize — all in one place.',
    zh: '你的 AI 个人办公助手。聊天、创建、整理——一站式搞定。',
    ja: 'あなたの生産性アシスタント。',
  },
  'app.welcomeGuide1': {
    en: '💬 Chat with AI — ask anything, create tasks, search notes',
    zh: '💬 在对话框与 AI 交流——创建任务、搜索笔记',
    ja: '💬 AIとチャット — 質問、タスク作成、ノート検索',
  },
  'app.welcomeGuide2': {
    en: '📋 Click bottom panel → Task/Note/Report',
    zh: '📋 点击下方面板 → 打开任务/笔记/报告',
    ja: '📋 下部の + をクリック → タスク/ノート/レポートパネルを開く',
  },
  'app.welcomeGuide3': {
    en: '📝 Say "create a task for..." to get started',
    zh: '📝 试试说"创建一个任务：重构登录模块"',
    ja: '📝 「認証モジュールのリファクタリングタスクを作成」と話しかけてみよう',
  },
  'app.sugg1': {
    en: 'Create a task: refactor auth module',
    zh: '创建一个任务：重构认证模块',
    ja: '進行中のタスクは？',
  },
  'app.sugg2': {
    en: 'Update a task: set TL-1 to in progress',
    zh: '更新任务：把 TL-1 改为进行中',
    ja: 'タスクを更新：TL-1を進行中に',
  },
  'app.sugg3': {
    en: 'Write a note about API design',
    zh: '写一篇关于微服务架构的笔记',
    ja: 'API設計についてノートを書く',
  },
  'app.sugg4': { en: 'Generate daily report', zh: '生成今日日报', ja: '日次レポート' },
  'app.sugg5': { en: 'Summarize unread emails', zh: '总结未读邮件', ja: '未読メールを要約' },
  'app.welcomeSetupLlm': { en: 'LLM API Key (Required)', zh: 'LLM API Key（必填）', ja: 'LLM API キー（必須）' },
  'app.welcomeSetupEmail': { en: 'Email (Optional)', zh: '邮件（可选）', ja: 'メール（任意）' },
  'app.welcomeSetupGit': {
    en: 'Git Workspaces (Optional)',
    zh: 'Git 工作区（可选）',
    ja: 'Git ワークスペース（任意）',
  },
  'app.welcomeSetupConfigure': { en: 'Configure →', zh: '设置 →', ja: '設定 →' },
  'app.welcomeSetupDone': { en: '✅ All set! 🚀', zh: '✅ 配置完成！🚀', ja: '✅ 設定済み' },
  'app.welcomeSetupNeeded': { en: 'Required', zh: '必填', ja: '未設定' },
  'app.welcomeSetupLlmDesc': {
    en: '→ AI chat, smart task management, email replies',
    zh: '→ AI 聊天、智能任务管理、邮件智能回复',
    ja: 'AI チャット、タスク管理、メール返信',
  },
  'app.welcomeSetupLlmPriority': {
    en: '⚡ Configure first — affects email classification, report generation, and AI accuracy.',
    zh: '⚡ 建议优先配置 — 影响邮件分类、报告生成和 AI 准确性。',
    ja: '⚡ 最初に設定してください — メール分類、レポート生成、AIの精度に影響します。',
  },
  'app.welcomeSetupEmailDesc': {
    en: '→ AI inbox triage, smart reply drafts, email→task conversion',
    zh: '→ AI 收件箱分类、智能回复草稿、邮件转任务',
    ja: 'AI 受信トレイ分類、スマート返信',
  },
  'app.welcomeSetupGitDesc': {
    en: '→ Auto repo scanning, commit tracking, daily activity reports',
    zh: '→ 自动扫描仓库、提交跟踪、日报工作活跃度分析',
    ja: 'リポジトリ自動スキャン、コミット追跡',
  },
  'app.welcomeSetupApikey': { en: 'API Keys', zh: 'API Keys', ja: 'APIキー（任意）' },
  'app.welcomeSetupApikeyDesc': {
    en: '→ Create API tokens for external tools or MCP servers',
    zh: '→ 创建 API Token 供外部工具或 MCP Server 调用',
    ja: '→ APIトークンを作成、外部ツールやMCPサーバーからアクセス',
  },
  'app.welcomeSetupStandup': { en: 'Daily Standup', zh: '每日站会', ja: 'スタンドアップ（任意）' },
  'app.welcomeSetupStandupDesc': {
    en: '→ Morning task brief + evening report auto-generation',
    zh: '→ 早间任务简报 + 晚间日报自动生成',
    ja: '→ 朝タスク概要 + 夕方レポート自動作成',
  },
  'app.welcomeSetupMcp': { en: 'MCP Servers', zh: 'MCP 服务器', ja: 'MCPサーバー' },
  'app.welcomeSetupMcpDesc': {
    en: '→ Connect to Tomihub, GitHub, Jira etc. to extend AI capabilities',
    zh: '→ 连接 Tomihub、GitHub、Jira 等外部 MCP 服务器扩展 AI 能力',
    ja: '→ Tomihub、GitHub、JiraなどのMCPサーバーに接続してAIの機能を拡張',
  },
  'app.welcomeStart': { en: 'Start Using →', zh: '开始使用 →', ja: '使い始める →' },
  'app.welcomeSkip': { en: 'Skip for now →', zh: '稍后配置 →', ja: '後で設定 →' },
  'app.welcomeDontShow': { en: "Don't show again", zh: '不再显示', ja: '今後表示しない' },
  'app.menuHome': { en: 'Home', zh: '首页', ja: 'ホーム', th: 'หน้าแรก', mi: 'Kāinga', ru: 'Главная' },
  'app.menuChat': { en: 'Chat', zh: '对话', ja: 'チャット', th: 'แชท', mi: 'Kōrero', ru: 'Чат' },
  'app.menuTasks': { en: 'Tasks', zh: '任务', ja: 'タスク', th: 'งาน', mi: 'Mahi', ru: 'Задачи' },
  'app.menuNotes': { en: 'Notes', zh: '笔记', ja: 'ノート', th: 'บันทึก', mi: 'Tuhipoka', ru: 'Заметки' },
  'app.menuEmail': { en: 'Email', zh: '邮件', ja: 'メール', th: 'อีเมล', mi: 'Īmēra', ru: 'Почта' },
  'app.menuMcp': {
    en: 'MCP Approve',
    zh: 'MCP审批',
    ja: 'MCP 承認',
    th: 'ตรวจสอบ MCP',
    mi: 'Arotake MCP',
    ru: 'Аудит MCP',
  },
  'app.menuReports': { en: 'Reports', zh: '报告', ja: 'レポート', th: 'รายงาน', mi: 'Pūrongo', ru: 'Отчёты' },
  'app.menuMeeting': { en: 'Meetings', zh: '会议', ja: '会議', th: 'การประชุม', mi: 'Hui', ru: 'Встречи' },
  'app.menuFeedback': {
    en: 'Feedback',
    zh: '反馈',
    ja: 'フィードバック',
    th: 'ข้อเสนอแนะ',
    mi: 'Urupare',
    ru: 'Отзывы',
  },
  'app.menuSettings': { en: 'Settings', zh: '设置', ja: '設定', th: 'การตั้งค่า', mi: 'Tautuhinga', ru: 'Настройки' },
  'app.menuAbout': { en: 'About', zh: '关于', ja: 'About', th: 'About', mi: 'About', ru: 'About' },
  'app.menuMore': { en: 'More', zh: '更多', ja: 'その他', th: 'เพิ่มเติม', mi: 'Ētahi atu', ru: 'Ещё' },
  'app.entityNote': { en: 'note', zh: '笔记', ja: 'ノート', th: 'บันทึก', mi: 'tuhipoka', ru: 'заметка' },
  'app.entityTask': { en: 'task', zh: '任务', ja: 'タスク', th: 'งาน', mi: 'mahi', ru: 'задача' },
  'app.entityReport': { en: 'report', zh: '报告', ja: 'レポート', th: 'รายงาน', mi: 'pūrongo', ru: 'отчёт' },

  // ═══ Chat actions & status messages (App refactor) ═══
  'chat.appliedToEditor': {
    en: '✅ Applied to editor. You can continue editing or click **Save** to save, or ask me to adjust.',
    zh: '✅ 已应用到编辑器。你可以继续修改或点击 **Save** 保存，也可以让我再调整。',
    ja: '✅ エディタに適用しました。引き続き編集するか **Save** をクリックして保存、または調整を依頼してください。',
  },
  'chat.revertedEdit': {
    en: '↩ Reverted changes back to previous content.',
    zh: '↩ 已撤销修改，恢复到之前的内容。',
    ja: '↩ 変更を元に戻し、以前の内容に復元しました。',
  },
  'chat.cancelledCreate': { en: 'OK, creation cancelled.', zh: '好的，已取消创建。', ja: 'キャンセルしました。' },
  'chat.revertedToPrev': {
    en: '✅ Reverted to previous content.',
    zh: '✅ 已恢复到修改前的内容。',
    ja: '✅ 以前の内容に復元しました。',
  },
  'chat.interrupted': { en: 'Interrupted', zh: '已中断', ja: '中断されました' },
  'chat.noAiContent': {
    en: 'Sorry, the AI returned no content. Please retry or check your API configuration.',
    zh: '抱歉，AI 未返回内容。请重试或检查 API 配置。',
    ja: 'AIが応答しませんでした。再試行するか、API設定を確認してください。',
  },
  'chat.tooMany': { en: 'Max 3 concurrent tasks', zh: '最多同时运行 3 个任务', ja: '同時実行は最大3件です' },
  'chat.thinkingRound': {
    en: '💭 Thinking... (round {n})',
    zh: '💭 思考中（第 {n} 轮）',
    ja: '💭 考え中（{n}ラウンド目）',
  },
  'chat.titleMismatch': {
    en: '⚠️ Title mismatch — only other fields applied. Use create_issue for a new task.',
    zh: '⚠️ 标题与当前任务不匹配，仅应用了其他字段。如需新建请使用 create_issue。',
    ja: '⚠️ タイトルが現在のタスクと一致しません。他のフィールドのみ適用しました。新規作成には create_issue を使用してください。',
  },
  'chat.replyDraftUpdated': {
    en: '📧 **Reply draft updated**. Reply "undo" to revert.',
    zh: '📧 **回复草稿已更新**。回复「撤销」恢复原稿。',
    ja: '📧 **返信下書きが更新されました**。「元に戻す」で復元。',
  },
  'chat.callFailed': { en: '❌ Call failed: {err}', zh: '❌ 调用失败: {err}', ja: '❌ 呼び出しに失敗しました: {err}' },
  'chat.contextRemaining': {
    en: '{pct}% context remaining — click to compress',
    zh: '剩余 {pct}% 上下文空间，点击压缩',
    ja: '残り {pct}% のコンテキスト、クリックで圧縮',
  },
  'chat.generatingReport': { en: '⏳ Generating report...', zh: '⏳ 生成日报中...', ja: '⏳ 日報生成中...' },
  'chat.reportFailed': { en: '⚠️ Failed', zh: '⚠️ 生成失败', ja: '⚠️ 生成失敗' },
  'chat.actionPolish': { en: 'Polish', zh: '润色', ja: '推敲' },
  'chat.actionTranslate': {
    en: 'Translate (ask target language first)',
    zh: '翻译（先确认目标语言）',
    ja: '翻訳（翻訳先の言語を確認）',
  },
  'chat.actionSummarize': { en: 'Summarize into 3 bullet points', zh: '总结为3个要点', ja: '3つの要点に要約' },
  'chat.actionExpand': { en: 'Expand into a detailed version', zh: '扩写为更详细的版本', ja: '詳細版に拡張' },
  'chat.blockedSimilar': {
    en: '⚠️ {n} similar {entity}(s)',
    zh: '⚠️ 发现 {n} 个相似{entity}',
    ja: '⚠️ {entity}が{n}件類似しています',
  },
  'chat.batchCreated': { en: '✅ {n} tasks created', zh: '✅ 已创建 {n} 个任务', ja: '✅ {n}件のタスクを作成しました' },
  'chat.batchKey': { en: 'Key', zh: '编号', ja: 'キー' },
  'chat.batchActions': { en: 'Actions', zh: '操作', ja: '操作' },
  'chat.rowDeleted': { en: 'Deleted', zh: '已删除', ja: '削除済み' },

  // ═══ Dialogs ═══
  'dialog.unsavedMessage': {
    en: 'Unsaved changes will be lost. Leave anyway?',
    zh: '有未保存的内容，离开将丢失更改。确定离开？',
    ja: '保存されていない変更があります。このまま離れますか？',
  },
  'dialog.deleteConfirm': {
    en: 'Delete "{title}"? This cannot be undone.',
    zh: '确定删除 "{title}" 吗？此操作无法撤销。',
    ja: '「{title}」を削除しますか？元に戻せません。',
  },
  'dialog.deleting': { en: '🗑️ Deleting...', zh: '🗑️ 删除中...', ja: '🗑️ 削除中...' },
  'dialog.stopDownload': { en: 'Stop Download', zh: '停止下载', ja: 'ダウンロード停止' },
  'dialog.stopDownloadMessage': {
    en: 'Stop downloading v{version}?',
    zh: '确定要停止下载 v{version} 吗？',
    ja: 'v{version} のダウンロードを停止しますか？',
  },
  'dialog.stop': { en: 'Stop', zh: '停止', ja: '停止' },

  // ═══ Update / OTA ═══
  'update.installRestart': { en: 'Install & Restart', zh: '安装并重启', ja: 'インストールして再起動' },
  'update.retry': { en: '🔄 Retry', zh: '🔄 重试', ja: '🔄 再試行' },
  'update.timedOut': {
    en: 'Download timed out, retry',
    zh: '下载超时，请重试',
    ja: 'ダウンロードタイムアウト、再試行',
  },
  'update.available': { en: 'available', zh: '可用', ja: '利用可能' },
  'update.downloadFailed': { en: 'Download failed', zh: '下载失败', ja: 'ダウンロード失敗' },
  'update.installFailed': {
    en: 'Install failed: {err}. Please retry download.',
    zh: '安装失败: {err}, 请重试下载',
    ja: 'インストール失敗: {err}、ダウンロードを再試行してください',
  },
  'update.installLaunchFailed': {
    en: 'Install failed, please retry.',
    zh: '安装启动失败，请重试',
    ja: 'インストールの起動に失敗しました。再試行してください',
  },
  'update.downloadedInstall': { en: 'Downloaded — click to install', zh: '已下载，点击安装', ja: 'ダウンロード完了' },

  // ═══ Delete / save-as ═══
  'delete.deletedLabel': { en: '🗑️ Deleted {label}', zh: '🗑️ 已删除 {label}', ja: '🗑️ 削除済み {label}' },
  'delete.saveDialogUnavailable': {
    en: 'Save dialog not available',
    zh: '保存对话框不可用',
    ja: '保存ダイアログが利用できません',
  },
  'delete.savedFile': { en: '✅ "{title}" saved', zh: '✅ 已保存 "{title}"', ja: '✅ 「{title}」を保存しました' },
  'delete.saveFileFailed': { en: 'Failed to save "{title}"', zh: '保存 "{title}" 失败', ja: '「{title}」の保存に失敗' },

  // ═══ Editor hints ═══
  'editor.updatedContent': { en: 'Updated Content', zh: '修改后内容', ja: '変更後の内容' },
  'editor.descModified': { en: 'Modified ({n} chars)', zh: '描述已修改 ({n} 字符)', ja: '説明変更済み ({n} 文字)' },
  'editor.noteCreateHint': {
    en: "📝 **You're creating a new note**\nTell me what you need — I can help optimize structure, translate, add details, fix grammar... Just let me know!",
    zh: '📝 **你正在创建新笔记**\n告诉我你的需求，我可以帮你：优化内容结构、翻译成其他语言、补充细节、修正语法……直接说出你的想法就好！',
    ja: '📝 **新しいノートを作成中です**\n内容の最適化、翻訳、詳細の追加、文法修正などお手伝いできます。お気軽にお申し付けください！',
  },
  'editor.noteEditHint': {
    en: '📔 **You\'re editing "{title}"**\nNeed help optimizing, translating, or rewriting? Just tell me what you need~',
    zh: '📔 **你正在编辑《{title}》**\n需要我帮忙优化、翻译、改写吗？直接告诉我你的需求～',
    ja: '📔 **「{title}」を編集中です**\n最適化、翻訳、書き換えなどお手伝いできます。お気軽にどうぞ～',
  },
  'editor.taskCreateHint': {
    en: "📝 **You're creating a new task**\nTell me the title, description, and priority — I'll help organize and create it~",
    zh: '📝 **你正在创建新Task**\n告诉我标题、描述、优先级，我帮你整理并创建～',
    ja: '📝 **新しいタスクを作成中です**\nタイトル、説明、優先度を教えてください。整理して作成します～',
  },
  'editor.taskViewHint': {
    en: '📋 **You\'re viewing TL-{num} "{title}"**\nStatus: {status} · Priority: {priority}{sp}\nNeed help updating status, modifying content, or splitting subtasks?',
    zh: '📋 **你正在查看 TL-{num}「{title}」**\n状态: {status} · 优先级: {priority}{sp}\n需要我帮忙更新状态、修改内容，或者拆分子任务吗？',
    ja: '📋 **TL-{num}「{title}」を表示中**\nステータス: {status} · 優先度: {priority}{sp}\nステータス更新、内容修正、サブタスク分割をお手伝いできます。',
  },
  'editor.reportHint': {
    en: "📊 **You're editing a report**\nTell me what you need — I can help generate, optimize, add data, or adjust formatting.",
    zh: '📊 **你正在编辑报告**\n告诉我你的需求，我可以帮你：生成报告、优化内容、补充数据、调整格式。',
    ja: '📊 **レポートを編集中です**\n生成、内容最適化、データ追加、書式調整などお手伝いできます。',
  },

  // ═══ Misc ═══
  'misc.llmNotConfigured': {
    en: 'LLM API Key not configured. AI chat unavailable.',
    zh: '未配置 LLM API Key，AI 聊天功能不可用。',
    ja: 'LLM APIキーが未設定です。',
  },
  'misc.goConfigure': { en: 'Configure →', zh: '前往配置 →', ja: '設定へ →' },
  'misc.configureLlmKey': {
    en: '⚙️ Configure LLM API Key →',
    zh: '⚙️ 前往设置 LLM API Key →',
    ja: '⚙️ LLM APIキーを設定 →',
  },
  'misc.forceCreateFailed': { en: 'Creation failed', zh: '创建失败', ja: '作成失敗' },
  'misc.createdSuccess': { en: '✅ Created successfully', zh: '✅ 创建成功', ja: '✅ 作成成功' },
  'misc.createFailedRetry': {
    en: '❌ Creation failed, please retry',
    zh: '❌ 创建失败，请重试',
    ja: '❌ 作成失敗、再試行',
  },
  'misc.networkError': { en: '❌ Network error', zh: '❌ 网络错误', ja: '❌ ネットワークエラー' },
  'misc.thinkingLabel': { en: 'Thinking', zh: '思考过程', ja: '思考プロセス' },

  // ═══ Agent context signals (ephemeral 🔔 messages) ═══
  'agent.enteredNotes': { en: 'Opened Notes panel', zh: '打开了 Notes 面板', ja: 'Notes パネルを開きました' },
  'agent.enteredTasks': { en: 'Opened Tasks panel', zh: '打开了 Tasks 面板', ja: 'Tasks パネルを開きました' },
  'agent.exitedNotes': { en: 'Exited Notes panel', zh: '退出了 Notes 面板', ja: 'Notes パネルを閉じました' },
  'agent.exitedTasks': { en: 'Exited Tasks panel', zh: '退出了 Tasks 面板', ja: 'Tasks パネルを閉じました' },
  'agent.enteredReports': { en: 'Opened Reports panel', zh: '打开了 Reports 面板', ja: 'Reports パネルを開きました' },
  'agent.exitedReports': { en: 'Exited Reports panel', zh: '退出了 Reports 面板', ja: 'Reports パネルを閉じました' },
  'agent.enteredEmail': { en: 'Opened Email panel', zh: '打开了 Email 面板', ja: 'Email パネルを開きました' },
  'agent.exitedEmail': { en: 'Exited Email panel', zh: '退出了 Email 面板', ja: 'Email パネルを閉じました' },
  'agent.openedReport': {
    en: 'Opened report editor',
    zh: '用户打开了Report编辑',
    ja: 'ユーザーがレポートエディタを開きました',
  },
  'agent.createdNote': { en: 'Created a new note', zh: '用户创建了新笔记', ja: 'ユーザーが新しいノートを作成しました' },
  'agent.openedNote': {
    en: 'Opened note "{title}"',
    zh: '用户打开了笔记《{title}》',
    ja: 'ユーザーがノート「{title}」を開きました',
  },
  'agent.newTaskForm': {
    en: 'Opened new task form "{title}"',
    zh: '用户打开了新建Task表单「{title}」',
    ja: 'ユーザーが新規タスクフォーム「{title}」を開きました',
  },
  'agent.openedTask': {
    en: 'Opened task TL-{num} "{title}"',
    zh: '用户打开了 Task TL-{num}「{title}」',
    ja: 'ユーザーがタスク TL-{num}「{title}」を開きました',
  },

  // ═══ Meeting Intelligence ═══
  // Two rules run through this whole block:
  //  1. Never say "identified" a speaker — see meeting.speakers.disclaimer.
  //  2. Never claim the audio is the only thing that leaves the machine; the
  //     transcript does too, and that is stated plainly (meeting.privacy.*).

  'meeting.title': { en: 'Meetings', zh: '会议', ja: '会議' },
  'meeting.new': { en: 'New meeting', zh: '新建会议', ja: '新しい会議' },
  'meeting.search': { en: 'Search meetings', zh: '搜索会议', ja: '会議を検索' },
  'meeting.searchTranscript': { en: 'Search transcript', zh: '搜索转写内容', ja: '文字起こしを検索' },
  'meeting.back': { en: 'Back', zh: '返回', ja: '戻る' },
  'meeting.loading': { en: 'Loading…', zh: '加载中…', ja: '読み込み中…' },
  'meeting.empty': { en: 'No meetings yet', zh: '还没有会议', ja: '会議はまだありません' },
  'meeting.emptyHint': {
    en: 'Record a meeting and TomiLite will turn it into tasks you can actually start.',
    zh: '录一场会议，TomiLite 会把它变成能直接开工的任务。',
    ja: '会議を録音すると、TomiLite がそのまま着手できるタスクに変えます。',
  },
  'meeting.noResults': { en: 'No matches', zh: '没有匹配结果', ja: '一致する項目がありません' },
  'meeting.emptyAction': { en: 'Start recording', zh: '开始录音', ja: '録音を開始' },

  // ─── Empty states (components/EmptyState.tsx) ───
  //
  // A search that matched nothing is a different screen from a panel that has
  // nothing in it: the first needs one line, the second needs an explanation.
  'empty.noResults': { en: 'Nothing matched', zh: '没有匹配的内容', ja: '一致するものがありません' },
  //
  // Each panel gets a title that says what the panel *is* and a hint that says
  // how something gets into it. The task hint names both routes on purpose: the
  // obvious one is the button, but most tasks in this app arrive from the chat,
  // and a user who only ever sees an empty list has no way to guess that.
  'empty.notes.title': { en: 'No notes yet', zh: '还没有笔记', ja: 'ノートはまだありません' },
  'empty.notes.hint': {
    en: 'Notes you write here are searchable by the assistant, so it can quote them back later.',
    zh: '写在这里的笔记，助手可以检索到，之后能引用给你。',
    ja: 'ここに書いたノートはアシスタントが検索でき、後で引用できます。',
  },
  'empty.notes.action': { en: 'New note', zh: '新建笔记', ja: '新規ノート' },
  // A library that is empty was probably filled somewhere else. This is the one moment
  // where saying so is useful rather than nagging.
  'empty.notes.import': {
    en: 'Or import notes you already have…',
    zh: '或者导入你已有的笔记…',
    ja: 'すでにあるノートを取り込む…',
  },

  'empty.tasks.title': { en: 'No tasks yet', zh: '还没有任务', ja: 'タスクはまだありません' },
  'empty.tasks.hint': {
    en: 'Create one here, or just tell the assistant what needs doing and it will file it.',
    zh: '可以在这里新建，也可以直接告诉助手要做什么，它会替你建好。',
    ja: 'ここで作成するか、アシスタントにやることを伝えれば登録されます。',
  },
  'empty.tasks.action': { en: 'New task', zh: '新建任务', ja: '新規タスク' },
  // Same reasoning as `empty.notes.import`: an empty task list is exactly the state of a
  // team whose work already lives in a tracker.
  'empty.tasks.import': {
    en: 'Or import tasks from Redmine…',
    zh: '或者从 Redmine 导入任务…',
    ja: 'Redmine からタスクを取り込む…',
  },

  'empty.reports.title': { en: 'No reports yet', zh: '还没有报告', ja: 'レポートはまだありません' },
  'empty.reports.hint': {
    en: 'Reports are for writing up where things stand — daily, weekly, or at the end of a piece of work.',
    zh: '报告用来写清当前进展 —— 日报、周报，或一件工作结束时的小结。',
    ja: 'レポートは進捗を書き残すためのもの — 日次・週次、または作業の区切りに。',
  },
  'empty.reports.action': { en: 'New report', zh: '新建报告', ja: '新規レポート' },

  // Only shown when a mailbox *is* configured and simply has nothing in it —
  // the unconfigured case has its own screen in EmailList with a settings link.
  'empty.email.title': { en: 'No mail yet', zh: '还没有邮件', ja: 'メールはまだありません' },
  'empty.email.hint': {
    en: 'Your mailbox is connected but nothing has been fetched yet. Sync to pull in what has arrived.',
    zh: '邮箱已连接，但还没有取回任何邮件。同步一下就能拉取已收到的邮件。',
    ja: 'メールボックスは接続済みですが、まだ取得していません。同期すると受信メールを取り込みます。',
  },
  'empty.email.action': { en: 'Sync now', zh: '立即同步', ja: '今すぐ同期' },
  'empty.email.syncing': { en: 'Syncing…', zh: '同步中…', ja: '同期中…' },

  // ─── Recorder ───
  'meeting.recorder.title': { en: 'Record', zh: '录音', ja: '録音' },
  'meeting.source.mic': { en: 'Microphone only', zh: '仅麦克风', ja: 'マイクのみ' },
  'meeting.source.both': { en: 'Microphone + system audio', zh: '麦克风 + 系统声音', ja: 'マイク + システム音声' },
  'meeting.record.start': { en: 'Start recording', zh: '开始录音', ja: '録音を開始' },
  'meeting.record.starting': { en: 'Starting…', zh: '正在开始…', ja: '開始しています…' },
  'meeting.record.stop': { en: 'Stop', zh: '停止', ja: '停止' },
  'meeting.record.pause': { en: 'Pause', zh: '暂停', ja: '一時停止' },
  'meeting.record.resume': { en: 'Resume', zh: '继续', ja: '再開' },
  'meeting.record.stopAndTranscribe': { en: 'Stop & transcribe', zh: '停止并转写', ja: '停止して文字起こし' },
  'meeting.record.hint': {
    en: 'System audio is captured through the screen-capture permission; the video track is closed immediately and nothing is recorded from the screen.',
    zh: '系统声音通过屏幕捕获权限获取；视频轨会被立即关闭，屏幕内容不会被录制。',
    ja: 'システム音声は画面キャプチャ権限で取得します。映像トラックは即座に閉じ、画面は録画しません。',
  },
  'meeting.record.elapsed': { en: 'Elapsed', zh: '已录时长', ja: '経過時間' },
  'meeting.record.uploading': { en: 'Uploading…', zh: '上传中…', ja: 'アップロード中…' },
  'meeting.record.clipping': { en: 'Clipping', zh: '削顶', ja: 'クリッピング' },
  'meeting.record.micDeniedTitle': { en: 'Microphone unavailable', zh: '麦克风不可用', ja: 'マイクを利用できません' },
  'meeting.record.micDenied': {
    en: 'TomiLite could not open the microphone. If you denied permission, allow it and retry. On Windows, "Microphone access", "Let desktop apps access your microphone" and the per-app list are three separate switches — check all three.',
    zh: 'TomiLite 打不开麦克风。如果是你拒绝了权限，请允许后重试。Windows 上「麦克风访问」「允许桌面应用访问麦克风」和逐应用列表是三个独立开关，三个都要检查。',
    ja: 'マイクを開けませんでした。拒否した場合は許可して再試行してください。Windows では「マイクへのアクセス」「デスクトップアプリにマイクへのアクセスを許可する」とアプリ個別リストは別々のスイッチです。3つとも確認してください。',
  },
  'meeting.record.openWindowsSettings': {
    en: 'Open Windows settings',
    zh: '打开 Windows 设置',
    ja: 'Windows の設定を開く',
  },
  'meeting.record.retry': { en: 'Retry', zh: '重试', ja: '再試行' },
  'meeting.record.degraded': {
    en: 'System audio is unavailable, so this recording is microphone-only. The other side of the call will not be in the transcript.',
    zh: '系统声音不可用，本次仅录制麦克风。通话对方的语音不会出现在转写里。',
    ja: 'システム音声を取得できないため、マイクのみで録音しています。通話相手の音声は文字起こしに含まれません。',
  },
  'meeting.record.deadStream': {
    en: 'No system audio for {sec}s. The other side of the call may be playing through an output device TomiLite cannot capture — check your output device before this meeting ends.',
    zh: '已经 {sec} 秒没有系统声音。对方的语音可能走到了 TomiLite 采集不到的输出设备——请在会议结束前检查输出设备。',
    ja: '{sec} 秒間システム音声がありません。通話相手の音声が TomiLite が取得できない出力先に流れている可能性があります。会議が終わる前に出力デバイスを確認してください。',
  },
  'meeting.record.uploadFailed': {
    en: 'Could not upload the recording. Recording is paused and nothing has been dropped.',
    zh: '录音上传失败。已暂停录音，已录内容没有丢失。',
    ja: '録音をアップロードできませんでした。録音を停止し、データは保持しています。',
  },
  'meeting.level.mic': { en: 'Mic', zh: '麦克风', ja: 'マイク' },
  'meeting.level.system': { en: 'System', zh: '系统', ja: 'システム' },
  'meeting.level.mix': { en: 'Mix', zh: '混合', ja: 'ミックス' },

  // ─── Consent gate ───
  'meeting.consent.title': { en: 'Before you record', zh: '录音前请确认', ja: '録音の前に' },
  'meeting.consent.body': {
    en: "TomiLite will save the microphone and (optionally) your computer's system audio to a file on this machine. Audio is never uploaded. Recording a conversation may require the consent of everyone in it — some jurisdictions require every participant to agree, others only one. TomiLite cannot decide that for you.",
    zh: 'TomiLite 会把麦克风与（可选的）系统声音保存成本机文件。音频不会上传。录制对话可能需要在场所有参与者同意——部分地区要求全员同意，部分地区只需一方同意。TomiLite 无法替你判断。',
    ja: 'TomiLite はマイクと（任意で）システム音声をこの端末上のファイルに保存します。音声はアップロードしません。会話の録音には参加者の同意が必要な場合があります。全員の同意が必要な地域もあれば、一方の同意で足りる地域もあります。TomiLite がそれを判断することはできません。',
  },
  'meeting.consent.check': {
    en: 'I will obtain any consent required where the recording happens.',
    zh: '我会在录音所在地取得所需的同意。',
    ja: '録音を行う地域で必要な同意を取得します。',
  },
  'meeting.consent.readMore': {
    en: 'How meetings are stored and sent',
    zh: '会议数据如何存储与发送',
    ja: '会議データの保存と送信について',
  },
  'meeting.consent.continue': { en: 'Start recording', zh: '开始录音', ja: '録音を開始' },
  'meeting.consent.cancel': { en: 'Cancel', zh: '取消', ja: 'キャンセル' },

  // ─── Status ───
  'meeting.status.recording': { en: 'Recording', zh: '录音中', ja: '録音中' },
  'meeting.status.recorded': { en: 'Recorded', zh: '已录音', ja: '録音済み' },
  'meeting.status.queued': { en: 'Queued', zh: '排队中', ja: '待機中' },
  'meeting.status.running': { en: 'Transcribing {pct}%', zh: '转写中 {pct}%', ja: '文字起こし中 {pct}%' },
  'meeting.status.done': { en: 'Transcribed', zh: '已转写', ja: '文字起こし済み' },
  'meeting.status.failed': { en: 'Failed', zh: '失败', ja: '失敗' },
  'meeting.status.cancelled': { en: 'Cancelled', zh: '已取消', ja: 'キャンセル済み' },
  'meeting.status.aiRunning': { en: 'Generating…', zh: '生成中…', ja: '生成中…' },
  'meeting.status.aiDone': { en: 'Minutes ready', zh: '纪要已生成', ja: '議事録あり' },
  'meeting.status.aiFailed': { en: 'Generation failed', zh: '生成失败', ja: '生成に失敗' },
  'meeting.status.aiNone': { en: 'Not generated', zh: '未生成', ja: '未生成' },
  'meeting.status.sent': { en: 'Minutes sent', zh: '纪要已发送', ja: '議事録を送信済み' },

  // ─── Tabs ───
  'meeting.tab.transcript': { en: 'Transcript', zh: '转写', ja: '文字起こし' },
  'meeting.tab.minutes': { en: 'Minutes', zh: '纪要', ja: '議事録' },
  'meeting.tab.actions': { en: 'Action items', zh: '行动项', ja: 'アクション項目' },

  // ─── Transcription ───
  'meeting.transcribe.start': { en: 'Transcribe', zh: '开始转写', ja: '文字起こし' },
  'meeting.transcribe.retry': { en: 'Retry transcription', zh: '重新转写', ja: '文字起こしを再実行' },
  'meeting.transcribe.cancel': { en: 'Cancel', zh: '取消', ja: 'キャンセル' },
  'meeting.transcribe.noAudio': {
    en: 'This meeting has no audio to transcribe.',
    zh: '这场会议没有可转写的音频。',
    ja: '文字起こしできる音声がありません。',
  },
  'meeting.transcribe.noBinary': {
    en: 'The local speech engine is missing from this build.',
    zh: '此版本缺少本地语音引擎。',
    ja: 'このビルドには音声エンジンが含まれていません。',
  },
  'meeting.transcribe.noModel': {
    en: 'No speech model installed.',
    zh: '尚未安装语音模型。',
    ja: '音声モデルが未インストールです。',
  },
  'meeting.transcribe.busy': {
    en: 'Another transcription is already running.',
    zh: '已有另一场转写正在进行。',
    ja: '別の文字起こしが実行中です。',
  },
  'meeting.transcribe.noAudioFile': {
    en: 'The audio file is missing.',
    zh: '音频文件不存在。',
    ja: '音声ファイルがありません。',
  },
  'meeting.transcribe.slowHint': {
    en: 'A 30-minute meeting takes roughly 2–5 minutes on this machine.',
    zh: '30 分钟的会议在这台机器上大约需要 2–5 分钟。',
    ja: '30分の会議でおよそ2〜5分かかります。',
  },
  'meeting.transcribe.installModel': {
    en: 'Install a speech model',
    zh: '安装语音模型',
    ja: '音声モデルをインストール',
  },
  'meeting.transcribe.keepSafe': {
    en: 'Your audio and transcript are saved. You can continue at any time.',
    zh: '音频与转写已保存，随时可以继续。',
    ja: '音声と文字起こしは保存済みです。いつでも続けられます。',
  },
  'meeting.transcribe.showMore': { en: 'Show {n} more', zh: '再显示 {n} 条', ja: 'さらに {n} 件表示' },

  // ─── Speaker honesty ───
  'meeting.speakers.disclaimer': {
    en: 'Speaker labels are inferred from pauses, not from voice identification. Roles are guesses and may be wrong.',
    zh: '说话人标签由停顿推断，并非声纹识别。角色为推测，可能出错。',
    ja: '話者ラベルは無音区間からの推定で、声紋識別ではありません。役割は推測であり、誤ることがあります。',
  },
  'meeting.speakers.roleGuess': { en: 'possibly {role}', zh: '可能是{role}', ja: '{role}の可能性' },

  // ─── AI ───
  'meeting.ai.generate': { en: 'Generate minutes', zh: '生成纪要', ja: '議事録を生成' },
  'meeting.ai.regenerate': { en: 'Regenerate', zh: '重新生成', ja: '再生成' },
  'meeting.ai.estimating': { en: 'Estimating…', zh: '正在估算…', ja: '見積もり中…' },
  'meeting.ai.mapStage': {
    en: 'Summarizing part {i} of {n}…',
    zh: '正在摘要第 {i}/{n} 部分…',
    ja: '{n} 件中 {i} 件目を要約中…',
  },
  'meeting.ai.synthStage': { en: 'Writing up the minutes…', zh: '正在撰写纪要…', ja: '議事録を作成中…' },
  'meeting.ai.confirmTitle': {
    en: 'This will use your trial credit',
    zh: '这将消耗试用额度',
    ja: 'トライアル残高を消費します',
  },
  'meeting.ai.confirmBody': {
    en: 'About {tokens} tokens will be sent to {model} through the TomiVector gateway. Your balance is ¥{balance} of ¥{total}. Transcript, audio and any previous summaries stay on this machine — only transcript text goes out.',
    zh: '大约 {tokens} token 将经 TomiVector 网关发送给 {model}。当前余额 ¥{balance} / ¥{total}。转写、音频与已有摘要都留在本机——只有转写文本会发出去。',
    ja: '約 {tokens} トークンを TomiVector ゲートウェイ経由で {model} に送信します。残高は ¥{balance} / ¥{total} です。文字起こし・音声・生成済み要約は端末に残り、送信されるのは文字起こしテキストのみです。',
  },
  'meeting.ai.confirmOk': { en: 'Generate', zh: '生成', ja: '生成する' },
  'meeting.ai.cancel': { en: 'Cancel', zh: '取消', ja: 'キャンセル' },
  'meeting.ai.byokNote': {
    en: 'About {tokens} tokens will be sent to your own {model} endpoint.',
    zh: '大约 {tokens} token 将发送到你自己配置的 {model} 接口。',
    ja: '約 {tokens} トークンを、設定済みの {model} エンドポイントに送信します。',
  },
  'meeting.ai.estimateHint': {
    en: 'Long meetings are summarized in parts on a cheaper model, so cost grows with length far more slowly than the transcript does.',
    zh: '长会议会用更便宜的模型分块摘要，因此成本随时长增长远慢于转写文本的增长。',
    ja: '長い会議は安価なモデルで分割要約するため、コストの増加は文字起こしの長さほど急ではありません。',
  },
  'meeting.ai.quotaExhausted': {
    en: 'Trial credit exhausted. Your transcript and audio are already saved — generate the minutes after upgrading and only the writing-up step is charged.',
    zh: '试用额度已用尽。转写与音频都已保存——升级后再生成，只有撰写纪要这一步会计费。',
    ja: 'トライアル残高が不足しています。文字起こしと音声は保存済みです。アップグレード後に生成すれば、議事録作成の分だけが課金されます。',
  },
  'meeting.ai.upgrade': { en: 'Open settings', zh: '打开设置', ja: '設定を開く' },
  'meeting.ai.retry': { en: 'Try again', zh: '重试', ja: '再試行' },
  'meeting.ai.fallbackUsed': {
    en: 'The structured response could not be parsed, so the minutes were written by three separate calls.',
    zh: '结构化响应解析失败，已改用三次独立调用生成纪要。',
    ja: '構造化レスポンスを解析できなかったため、3回の個別呼び出しで議事録を作成しました。',
  },

  // ─── Minutes ───
  'meeting.minutes.summary': { en: 'Summary', zh: '摘要', ja: '要約' },
  'meeting.minutes.decisions': { en: 'Decisions', zh: '决议', ja: '決定事項' },
  // `{n}` is the decision's position (01, 02, …) — the number the minutes refer
  // to when someone says "the second decision".
  'meeting.decision.title': { en: 'Decision #{n}', zh: '决议 #{n}', ja: '決定 #{n}' },
  'meeting.decision.rationale': { en: 'Why', zh: '理由', ja: '理由' },
  'meeting.decision.dismiss': { en: 'Hide', zh: '隐藏', ja: '非表示' },
  'meeting.decision.reopen': { en: 'Show', zh: '显示', ja: '表示' },
  'meeting.followup.title': { en: 'Follow-up email', zh: '跟进邮件', ja: 'フォローアップ' },
  'meeting.followup.ready': {
    en: 'Draft ready — review it before sending.',
    zh: '草稿已生成，发送前请确认。',
    ja: '下書きを作成しました。送信前に確認してください。',
  },
  'meeting.followup.sent': { en: 'Sent', zh: '已发送', ja: '送信済み' },
  'meeting.followup.none': {
    en: 'No draft yet. TomiLite writes one when it generates the minutes.',
    zh: '还没有草稿。生成纪要时 TomiLite 会一并生成。',
    ja: '下書きはまだありません。議事録の生成時に作成します。',
  },
  'meeting.followup.reviewSend': { en: 'Review & send', zh: '确认并发送', ja: '確認して送信' },
  'meeting.followup.generate': { en: 'Draft it', zh: '生成草稿', ja: '下書きを作成' },
  'meeting.followup.regenerate': { en: 'Regenerate', zh: '重新生成', ja: '再生成' },
  'meeting.followup.generating': { en: 'Generating…', zh: '生成中…', ja: '生成中…' },
  'meeting.followup.dismiss': { en: 'Discard', zh: '丢弃', ja: '破棄' },
  'meeting.followup.failed': {
    en: 'Could not generate the draft: {error}',
    zh: '无法生成草稿：{error}',
    ja: '下書きを生成できませんでした：{error}',
  },
  'meeting.minutes.speakers': { en: 'Participants', zh: '与会人', ja: '参加者' },
  'meeting.minutes.subject': { en: 'Subject', zh: '主题', ja: '件名' },
  'meeting.minutes.to': { en: 'To', zh: '收件人', ja: '宛先' },
  'meeting.minutes.cc': { en: 'Cc', zh: '抄送', ja: 'Cc' },
  'meeting.minutes.attachTranscript': {
    en: 'Attach transcript (.md)',
    zh: '附上转写（.md）',
    ja: '文字起こしを添付（.md）',
  },
  'meeting.minutes.send': { en: 'Send minutes', zh: '发送纪要', ja: '議事録を送信' },
  'meeting.minutes.cancel': { en: 'Cancel', zh: '取消', ja: 'キャンセル' },
  'meeting.minutes.sending': { en: 'Sending…', zh: '发送中…', ja: '送信中…' },
  'meeting.minutes.sent': { en: 'Minutes sent.', zh: '纪要已发送。', ja: '議事録を送信しました。' },
  'meeting.minutes.sendFailed': {
    en: 'Send failed: {error}',
    zh: '发送失败：{error}',
    ja: '送信に失敗しました：{error}',
  },
  'meeting.minutes.notConfigured': {
    en: 'No email account configured. Minutes are generated locally; add SMTP in Settings → Email to send them.',
    zh: '尚未配置邮箱。纪要在本机生成；要发送请到 设置 → 邮件 配置 SMTP。',
    ja: 'メールアカウントが未設定です。議事録は端末内で生成されます。送信するには 設定 → メール で SMTP を設定してください。',
  },
  'meeting.minutes.goConfigure': { en: 'Configure email', zh: '去配置邮箱', ja: 'メールを設定' },
  'meeting.minutes.empty': {
    en: 'Generate the minutes to fill this in.',
    zh: '生成纪要后这里会有内容。',
    ja: '議事録を生成すると表示されます。',
  },
  'meeting.minutes.noRecipients': {
    en: 'Add at least one recipient.',
    zh: '请至少填写一个收件人。',
    ja: '宛先を1件以上入力してください。',
  },

  // ─── Action items ───
  'meeting.actions.title': { en: 'Action items', zh: '行动项', ja: 'アクション項目' },
  // Four empty states, because "no action items" means four different things.
  // `empty` is the only one that may invite a run; the rest report a run already done.
  'meeting.actions.empty': {
    en: 'No action items. TomiLite looks for them when it writes the minutes.',
    zh: '没有行动项。生成纪要时 TomiLite 会从中提取。',
    ja: 'アクション項目はありません。議事録の生成時に抽出します。',
  },
  'meeting.actions.emptyRunning': {
    en: 'The minutes are being written — action items appear when they are done.',
    zh: '正在生成纪要 —— 生成完会在这里列出行动项。',
    ja: '議事録を生成しています — 完了するとアクション項目が表示されます。',
  },
  'meeting.actions.emptyDone': {
    en: 'No action items in these minutes. Nothing concrete enough to assign came up.',
    zh: '这次纪要里没有行动项 —— 没有出现具体可指派的事。',
    ja: 'この議事録にアクション項目はありません — 具体的に割り当てられる事項はありませんでした。',
  },
  'meeting.actions.emptyFailed': {
    en: 'The last minutes run failed, so no action items were extracted.',
    zh: '上次生成纪要失败了，没有提取到行动项。',
    ja: '前回の議事録生成が失敗したため、アクション項目は抽出されていません。',
  },
  'meeting.actions.createTask': { en: 'Create task', zh: '创建任务', ja: 'タスクを作成' },
  'meeting.actions.creating': { en: 'Creating…', zh: '创建中…', ja: '作成中…' },
  'meeting.actions.openTask': { en: 'Open task', zh: '打开任务', ja: 'タスクを開く' },
  'meeting.actions.owner': { en: 'Owner', zh: '负责人', ja: '担当' },
  'meeting.actions.due': { en: 'Due', zh: '截止', ja: '期限' },
  'meeting.actions.priority': { en: 'Priority', zh: '优先级', ja: '優先度' },
  'meeting.actions.text': { en: 'Action', zh: '事项', ja: '内容' },
  'meeting.actions.dismiss': { en: 'Dismiss', zh: '忽略', ja: '却下' },
  'meeting.actions.reopen': { en: 'Restore', zh: '恢复', ja: '復元' },
  'meeting.actions.taskCreated': { en: 'Task created', zh: '任务已创建', ja: 'タスクを作成しました' },
  'meeting.actions.createFailed': {
    en: 'Could not create the task: {error}',
    zh: '创建任务失败：{error}',
    ja: 'タスクを作成できませんでした：{error}',
  },
  'meeting.actions.alreadyLinked': {
    en: 'This item is already linked to a task.',
    zh: '该行动项已关联任务。',
    ja: 'この項目はすでにタスクに紐づいています。',
  },
  'meeting.actions.unassigned': { en: 'Unassigned', zh: '未指派', ja: '未割当' },
  'meeting.actions.none': { en: '—', zh: '—', ja: '—' },

  // ─── Library rows ───
  'meeting.retention.inDays': {
    en: 'Audio deletes in {days} days',
    zh: '音频将在 {days} 天后自动删除',
    ja: '音声は {days} 日後に削除されます',
  },
  'meeting.retention.forever': { en: 'Audio kept forever', zh: '音频永久保留', ja: '音声は永続保存' },
  'meeting.retention.deleted': { en: 'Audio deleted', zh: '音频已删除', ja: '音声は削除済み' },
  'meeting.counts': {
    en: '{segments} segments · {actions} action items',
    zh: '{segments} 段转写 · {actions} 个行动项',
    ja: '{segments} セグメント · アクション {actions} 件',
  },
  // Used instead of the string above when the meeting produced no action items.
  // "0 action items" reads as a result the user failed to get; dropping the clause
  // reads as a meeting that simply had nothing to assign.
  'meeting.countsNoActions': {
    en: '{segments} segments',
    zh: '{segments} 段转写',
    ja: 'セグメント {segments} 件',
  },
  'meeting.delete.title': { en: 'Delete meeting', zh: '删除会议', ja: '会議を削除' },
  'meeting.delete.message': {
    en: 'Delete "{title}", its transcript, its audio file and its action items? Tasks already created from it are kept.',
    zh: '删除「{title}」及其转写、音频文件和行动项？已创建的任务会保留。',
    ja: '「{title}」とその文字起こし・音声ファイル・アクション項目を削除しますか？作成済みのタスクは残ります。',
  },
  'meeting.delete.ok': { en: 'Delete', zh: '删除', ja: '削除' },
  'meeting.delete.cancel': { en: 'Cancel', zh: '取消', ja: 'キャンセル' },
  'meeting.delete.failed': { en: 'Delete failed: {error}', zh: '删除失败：{error}', ja: '削除に失敗しました：{error}' },

  // ─── Global recording indicator (visible on every panel) ───
  'meeting.indicator.recording': { en: 'Recording: {title}', zh: '正在录音：{title}', ja: '録音中：{title}' },
  'meeting.indicator.open': { en: 'Open', zh: '打开', ja: '開く' },

  // ─── Settings → Meeting ───
  'meeting.settings.tab': { en: 'Meetings', zh: '会议', ja: '会議' },
  'meeting.privacy.title': { en: 'Privacy', zh: '隐私', ja: 'プライバシー' },
  'meeting.privacy.audio': { en: 'Audio', zh: '音频', ja: '音声' },
  'meeting.privacy.audioDetail': {
    en: 'Processed and stored locally. Never uploaded.',
    zh: '本机处理与本机存储，绝不上传。',
    ja: '端末内で処理・保存。アップロードしません。',
  },
  'meeting.privacy.transcript': { en: 'Transcript', zh: '转写', ja: '文字起こし' },
  'meeting.privacy.transcriptDetail': {
    en: "Stored locally in TomiLite's database.",
    zh: '保存在 TomiLite 本机数据库中。',
    ja: 'TomiLite の端末内データベースに保存。',
  },
  'meeting.privacy.ai': { en: 'AI summary', zh: 'AI 摘要', ja: 'AI 要約' },
  'meeting.privacy.aiDetail': {
    en: 'Transcript text IS sent to the LLM provider you configured — or to the TomiVector gateway during a hosted trial. Audio is not.',
    zh: '转写文本会发送给你配置的 LLM 服务商——托管试用时发送至 TomiVector 网关。音频不会。',
    ja: '文字起こしテキストは、設定した LLM プロバイダ（ホスティング試用時は TomiVector ゲートウェイ）に送信されます。音声は送信しません。',
  },
  'meeting.settings.models': { en: 'Speech models', zh: '语音模型', ja: '音声モデル' },
  'meeting.settings.engine': { en: 'Local engine', zh: '本地引擎', ja: 'ローカルエンジン' },
  'meeting.settings.engineOk': {
    en: 'Ready — {bytes} · {threads} threads',
    zh: '就绪 — {bytes} · {threads} 线程',
    ja: '準備完了 — {bytes} · {threads} スレッド',
  },
  'meeting.settings.engineMissing': {
    en: 'Missing files: {files}',
    zh: '缺少文件：{files}',
    ja: '不足ファイル：{files}',
  },
  'meeting.settings.modelInstalled': { en: 'Installed', zh: '已安装', ja: 'インストール済み' },
  'meeting.settings.modelDownload': { en: 'Download', zh: '下载', ja: 'ダウンロード' },
  'meeting.settings.modelDelete': { en: 'Delete', zh: '删除', ja: '削除' },
  'meeting.settings.downloading': {
    en: 'Downloading {name} — {pct}%',
    zh: '正在下载 {name} — {pct}%',
    ja: '{name} をダウンロード中 — {pct}%',
  },
  'meeting.settings.downloadCancel': { en: 'Cancel download', zh: '取消下载', ja: 'ダウンロードを中止' },
  'meeting.settings.downloadFailed': {
    en: 'Download failed: {error}',
    zh: '下载失败：{error}',
    ja: 'ダウンロードに失敗：{error}',
  },
  'meeting.settings.speed': { en: '{done} / {total}', zh: '{done} / {total}', ja: '{done} / {total}' },
  'meeting.settings.defaults': { en: 'Recording defaults', zh: '录音默认值', ja: '録音の既定値' },
  'meeting.settings.defaultSource': { en: 'Default audio source', zh: '默认音源', ja: '既定の音声ソース' },
  'meeting.settings.defaultLang': { en: 'Transcription language', zh: '转写语言', ja: '文字起こし言語' },
  'meeting.settings.modelNoneWarn': {
    en: 'No speech model is downloaded yet. Transcription cannot start until one is.',
    zh: '还没有下载任何语音模型，下载后才能开始转写。',
    ja: '音声モデルがまだありません。ダウンロードするまで文字起こしは開始できません。',
  },
  'meeting.settings.textScript': {
    en: 'Chinese script',
    zh: '中文转写字形',
    ja: '中国語の文字表記',
  },
  'meeting.settings.script.simplified': { en: 'Simplified', zh: '简体中文', ja: '簡体字' },
  'meeting.settings.script.traditional': { en: 'Traditional', zh: '繁體中文', ja: '繁体字' },
  'meeting.settings.script.source': {
    en: "Don't convert",
    zh: '不转换',
    ja: '変換しない',
  },
  'meeting.settings.textScriptNote': {
    en: 'Whisper has no simplified/traditional switch — it picks one itself, and the bundled model picks Traditional for Mandarin. This converts the finished transcript to the script you choose. It only rewrites characters; the words are untouched. Applies to the next transcription, including re-transcribing an existing meeting.',
    zh: 'whisper 没有简繁开关，字形由模型自己决定，而内置模型在普通话上会输出繁体。这里是把转写结果转换成你选的字形，只改字形、不改用词。修改后对下一次转写生效（重新转写已有会议也按新值）。',
    ja: 'whisper に簡体字／繁体字の切り替えはなく、字形はモデルが決めます（同梱モデルは北京語で繁体字を出力します）。ここでは文字起こし結果を選んだ字形に変換します。変わるのは字形だけで、語句はそのままです。次回の文字起こしから適用されます（既存の会議を再文字起こしする場合も同様）。',
  },
  'meeting.settings.retention': {
    en: 'Keep audio for (days, 0 = forever)',
    zh: '音频保留天数（0 = 永久）',
    ja: '音声の保存日数（0 = 無期限）',
  },
  'meeting.settings.retentionNote': {
    en: 'Meetings recorded after this change use the new value. Automatic deletion runs at startup, so a value of 0 is the only way to be sure nothing is ever removed automatically.',
    zh: '修改后录制的会议使用新值。自动清理在启动时执行；设为 0 才能确保不会被自动删除。',
    ja: '変更後に録音した会議に適用されます。自動削除は起動時に実行されるため、確実に残すには 0 を指定してください。',
  },
  'meeting.settings.saved': { en: 'Saved', zh: '已保存', ja: '保存しました' },
  'meeting.settings.reminders': { en: 'Reminders', zh: '提醒', ja: 'リマインダー' },
  'meeting.settings.remindersOn': {
    en: 'Notify me about open action items',
    zh: '行动项有到期/未处理时通知我',
    ja: '未対応のアクションアイテムを通知する',
  },
  'meeting.settings.followUpDays': { en: 'Review after (days)', zh: '会后几天提醒（天）', ja: '会議後の通知（日）' },
  'meeting.settings.remindersNote': {
    en: 'Two Windows notifications: when an action item falls due tomorrow, and when a meeting ended the set number of days ago with action items still open. Nothing is ever emailed automatically.',
    zh: '两个 Windows 通知：行动项明天到期时，以及会议结束达到设定天数但仍有未处理行动项时。不会自动发送任何邮件。',
    ja: 'Windows 通知は 2 種類です。アクションアイテムの期限が明日になったとき、および会議終了から指定日数が経過しても未対応の項目が残っているとき。メールが自動送信されることはありません。',
  },
  'meeting.settings.consentSection': { en: 'Recording consent', zh: '录音同意声明', ja: '録音の同意' },
  'meeting.settings.consentAt': { en: 'Acknowledged on {date}', zh: '已于 {date} 确认', ja: '{date} に確認済み' },
  'meeting.settings.consentNever': { en: 'Not acknowledged yet', zh: '尚未确认', ja: '未確認' },
  'meeting.settings.consentReset': { en: 'Show the notice again', zh: '重新显示声明', ja: '通知を再表示' },
  'meeting.settings.openDoc': {
    en: 'Read docs/meetings.md',
    zh: '阅读 docs/meetings.md',
    ja: 'docs/meetings.md を読む',
  },
  'meeting.settings.modelGuide': {
    en: 'TomiLite transcribes with one model, Base. Download it once and transcription runs offline — there is nothing to choose.',
    zh: 'TomiLite 固定使用 Base 这一个模型转写。下载一次即可离线使用，无需选择。',
    ja: 'TomiLite は Base という1つのモデルで文字起こしします。一度ダウンロードすればオフラインで動作し、選択の必要はありません。',
  },
  'meeting.settings.modelsUnused': {
    en: 'Other models on this machine',
    zh: '本机上的其他模型',
    ja: 'この PC 上の他のモデル',
  },
  'meeting.settings.modelsUnusedNote': {
    en: 'Left over from an earlier version that let you choose. As long as Base is installed they will not be used, and they only take up disk space — safe to delete.',
    zh: '旧版本允许选择模型时留下的。只要 Base 已安装就不会再使用它们，只占磁盘空间，可以放心删除。',
    ja: 'モデルを選べた旧バージョンの残りです。Base がインストールされていれば使われることはなく、ディスクを占有するだけなので削除して構いません。',
  },
  'meeting.settings.modelNote.base': {
    en: 'The balance point. Real meetings, real accuracy, minutes not hours.',
    zh: '平衡点。真实的会议、可用的准确度，耗时是分钟级而非小时级。',
    ja: 'バランス型。実用的な精度で、所要時間は分単位です。',
  },
  'meeting.panel.noModelHint': {
    en: 'No speech model installed yet — recording works, but transcription needs a model (about 150 MB, downloaded once).',
    zh: '尚未安装语音模型 —— 录音可以正常使用，但转写需要一个模型（约 150 MB，下载一次即可）。',
    ja: '音声モデルが未インストールです — 録音は可能ですが、文字起こしにはモデル（約 150 MB・初回のみ）が必要です。',
  },
  'meeting.settings.binMissingWarn': {
    en: 'This build is missing the local speech engine, so transcription is unavailable. Recording and emailing still work.',
    zh: '此版本缺少本地语音引擎，无法转写。录音与邮件仍可正常使用。',
    ja: 'このビルドには音声エンジンが含まれていないため、文字起こしは利用できません。録音とメールは利用できます。',
  },
  // ═══ Importing notes from another app (notes panel + tasks panel) ═══
  //
  // The post-import summary is where the counts live, so these strings carry the whole
  // explanation of what an import did or refused to do. `import.row.*` are labels in a
  // grid; the rest are prose.
  //
  // The dialog title and the toolbar button that opens it are keyed `notes.` and `tasks.`
  // rather than `import.` — they belong to the panel they sit in — but they are written
  // down here, because this is where a reader looks for what the feature says.
  'notes.import.title': { en: 'Import notes', zh: '导入笔记', ja: 'ノートの取り込み' },
  'notes.import.button': {
    en: 'Import notes from files',
    zh: '从文件导入笔记',
    ja: 'ファイルからノートを取り込む',
  },
  'tasks.import.button': {
    en: 'Import tasks from Redmine',
    zh: '从 Redmine 导入任务',
    ja: 'Redmine からタスクを取り込む',
  },
  'import.filesTitle': { en: 'Import from files', zh: '从文件导入', ja: 'ファイルから取り込む' },
  // The formats are listed by extension and nothing else: the format is what the user has
  // in hand, not whichever application happens to write it. An app name in here also
  // invites a section per app, which is what this one button replaced.
  'import.filesLead': {
    en: 'Markdown (.md, .markdown), plain text (.txt), saved web pages (.html, .htm) and single-page web archives (.mht, .mhtml). Each file becomes one note: its title comes from the note itself where it has one and from the file name otherwise, images are embedded, anything else becomes a placeholder line, and the file’s own date is kept where the format records one. Importing the same files again skips what is already there.',
    zh: 'Markdown（.md / .markdown）、纯文本（.txt）、网页（.html / .htm）、单页网页存档（.mht / .mhtml）。每个文件成为一篇笔记：笔记自带标题就用它，没有就用文件名；图片会内嵌，其余内容变成一行占位；格式里记了日期的会保留。再次导入同一批文件时，已存在的笔记会被跳过。',
    ja: 'Markdown（.md / .markdown）、プレーンテキスト（.txt）、保存したウェブページ（.html / .htm）、単一ページのウェブアーカイブ（.mht / .mhtml）。1 ファイルが 1 件のノートになります。ノート自身に見出しがあればそれをタイトルに、なければファイル名を使います。画像は埋め込み、それ以外は 1 行のプレースホルダーになります。形式が日付を持つ場合はそれを保持します。同じファイルを再度取り込むと、既存のノートはスキップされます。',
  },
  // The one cost of a single button, said here rather than discovered in the summary.
  'import.filesImages': {
    en: 'A saved web page keeps its images in a folder beside it, and a file pick cannot see folders — so those images arrive as a placeholder line, and the summary says how many.',
    zh: '保存的网页会把图片放在它旁边的文件夹里，而「选择文件」看不到文件夹 —— 这些图片会变成占位行，汇总里会写明有多少张。',
    ja: '保存したウェブページの画像は隣のフォルダーにありますが、ファイル選択ではフォルダーを参照できません。その画像はプレースホルダーの 1 行になり、件数は集計に表示されます。',
  },
  // A page holding a whole notebook cannot be split (see `html.ts`), so this is a refusal
  // worth knowing before picking rather than a surprise in the summary afterwards.
  'import.filesLimits': {
    en: 'Up to 32 MB per .html note file and 100 MB per .mht. An export that put a whole notebook on one page becomes a single note — re-export it with one file per note instead.',
    zh: '单个 .html 笔记文件上限 32 MB，单个 .mht 上限 100 MB。把整个笔记本导成一页的导出会变成一篇笔记 —— 请改用「每篇一个文件」重新导出。',
    ja: '1 つの .html ノートファイルは最大 32 MB、1 つの .mht は最大 100 MB。ノートブック全体を 1 ページに書き出したものは 1 件のノートになります。ノートごとに 1 ファイルで書き出し直してください。',
  },
  'import.category': { en: 'Notebook (optional)', zh: '分类（可选）', ja: 'ノートブック（任意）' },
  // "Markdown only" is the load-bearing clause: the other two formats name their notebook
  // in their own file name, so a value typed here reaches the Markdown importer and
  // nothing else. Silently ignoring it for two of three formats would be a promise the
  // dialog does not keep.
  'import.categoryHint': {
    en: 'A file pick cannot see which folder a file came from, so one import lands in a single notebook — name it here. Leave it empty and they are filed as “imported”. Markdown files only: a saved web page or web archive names its own notebook.',
    zh: '选择文件时看不到文件来自哪个文件夹，所以一次导入的内容归入同一个分类 —— 就在这里命名。留空则归入「imported」。仅对 Markdown 文件生效：网页与网页存档自带分类名。',
    ja: 'ファイル選択では元のフォルダーが分からないため、1 回の取り込みは 1 つのノートブックにまとまります。ここで名前を付けます。空欄なら「imported」になります。Markdown ファイルにのみ適用されます（ウェブページとウェブアーカイブは自前のノートブック名を持ちます）。',
  },
  'import.chooseFiles': { en: 'Choose files…', zh: '选择文件…', ja: 'ファイルを選択…' },
  // Picking and importing are two steps on purpose: the file dialog is where a wrong pick
  // happens, and an import that starts the moment the dialog closes gives no chance to see
  // what was actually selected before it is parsed and written.
  'import.confirmHint': {
    en: 'Nothing is imported until you confirm.',
    zh: '在按下「确认导入」之前，不会导入任何东西。',
    ja: '確定するまで何も取り込みません。',
  },
  'import.confirm': { en: 'Import these files', zh: '确认导入', ja: 'このファイルを取り込む' },
  'import.selected': { en: '{n} file(s) selected', zh: '已选择 {n} 个文件', ja: '{n} 件のファイルを選択中' },
  'import.clear': { en: 'Clear selection', zh: '清除选择', ja: '選択を解除' },
  // Shown on the offending file in the list, before the run rather than in the summary
  // afterwards. `buckets.ts` answers this, i.e. the same table the importer dispatches on.
  'import.unsupported': {
    en: 'not a format this imports — it will be skipped',
    zh: '不是支持的格式，将被跳过',
    ja: '対応していない形式のためスキップされます',
  },
  'import.moreFiles': { en: '…and {n} more', zh: '……另有 {n} 个', ja: '…ほか {n} 件' },
  'import.options': { en: 'Options', zh: '选项', ja: 'オプション' },
  'import.overwrite': { en: 'Overwrite notes that already exist', zh: '覆盖已存在的笔记', ja: '既存のノートを上書きする' },
  'import.overwriteHint': {
    en: 'Off by default. While it is off, importing the same files a second time leaves the notes you have edited since untouched — the note is yours now. With it on, the file wins.',
    zh: '默认关闭。关闭时，第二次导入同一批文件不会动你后来编辑过的笔记 —— 笔记现在属于你。打开时，以文件为准。',
    ja: '既定ではオフ。オフの間は、同じファイルを再度取り込んでも、その後編集したノートはそのまま残ります（ノートはあなたのものです）。オンの場合、ファイルの内容が優先されます。',
  },
  'import.working': { en: 'Importing…', zh: '正在导入…', ja: '取り込み中…' },
  'import.starting': { en: 'Reading…', zh: '正在读取…', ja: '読み込み中…' },
  'import.progress': {
    en: '{done} / {total} files · {n} notes',
    zh: '{done} / {total} 个文件 · {n} 篇笔记',
    ja: '{done} / {total} ファイル · {n} 件のノート',
  },
  'import.stop': { en: 'Stop', zh: '停止', ja: '停止' },
  'import.failed': { en: 'Import failed', zh: '导入失败', ja: '取り込みに失敗しました' },
  'import.finished': { en: 'Import finished', zh: '导入完成', ja: '取り込み完了' },
  'import.stopped': { en: 'Import stopped', zh: '导入已停止', ja: '取り込みを停止しました' },
  'import.nothing': { en: 'Nothing was imported.', zh: '没有导入任何内容。', ja: '取り込まれたものはありません。' },
  'import.details': { en: 'Details', zh: '明细', ja: '詳細' },
  'import.row.created': { en: 'Created', zh: '新建', ja: '新規' },
  'import.row.updated': { en: 'Updated', zh: '已更新', ja: '更新' },
  'import.row.skipped': { en: 'Already imported, skipped', zh: '已导入，跳过', ja: '取り込み済み・スキップ' },
  'import.row.images': { en: 'Images embedded', zh: '内嵌的图片', ja: '埋め込んだ画像' },
  'import.row.dropped': { en: 'Images left as a placeholder', zh: '用占位替代的图片', ja: 'プレースホルダーにした画像' },
  'import.row.attachments': { en: 'Other attachments, placeholder', zh: '其他附件（占位）', ja: 'その他の添付（プレースホルダー）' },
  'import.row.unreadable': { en: 'Files that could not be read', zh: '无法读取的文件', ja: '読み込めなかったファイル' },
  'import.row.empty': { en: 'Empty files', zh: '空文件', ja: '空のファイル' },
  'import.library': { en: 'Notes in this library', zh: '笔记库现有', ja: 'ライブラリのノート数' },
  'import.libraryCount': { en: '{n} notes', zh: '{n} 篇', ja: '{n} 件' },
  'import.libraryUnknown': {
    en: 'Unknown — the API is not responding.',
    zh: '未知 —— API 无响应。',
    ja: '不明 — API が応答していません。',
  },
  'import.libraryWarn': {
    en: 'Past {max} notes the knowledge map is built from your notebooks instead of by the AI. That is the fallback, not a failure.',
    zh: '超过 {max} 篇后，知识地图会改由笔记本自动生成，而不是交给 AI。那是降级方案，不是故障。',
    ja: '{max} 件を超えると、知識マップは AI ではなくノートブックから自動生成されます。これはフォールバックであり、不具合ではありません。',
  },
  'notes.imported': { en: 'Imported', zh: '已导入', ja: '取り込み済み' },

  // ─── What the notes dialog opens with ───
  'import.notesLead': {
    en: 'Your existing notes, brought in as ordinary notes — fully editable, searchable, and counted by the knowledge map.',
    zh: '把你已有的笔记原样引进来，和在这里写的笔记完全一样：可编辑、可搜索、计入知识地图。',
    ja: '既存のノートをそのまま取り込みます。ここで書いたノートと同じく編集・検索でき、知識マップにも反映されます。',
  },

  // ─── Redmine ───
  'redmine.groupTasks': {
    en: 'Tasks from Redmine',
    zh: '从 Redmine 导入任务',
    ja: 'Redmine からのタスク取り込み',
  },
  'redmine.tasksLead': {
    en: 'Pull the tickets assigned to you so the task board, the Home totals, the daily brief and the assistant can finally see your real workload. Read-only, one direction.',
    zh: '把分派给你的工单拉进来，让任务面板、首页总计、每日简报和助手第一次看见你真实的工作量。只读、单向。',
    ja: '自分に割り当てられたチケットを取り込み、タスクボード・ホームの集計・デイリーブリーフ・アシスタントが実際の作業量を把握できるようにします。読み取り専用・一方向です。',
  },
  'redmine.title': { en: 'Redmine connection', zh: 'Redmine 连接', ja: 'Redmine 接続' },
  'redmine.lead': {
    en: 'Only the tickets assigned to you, from one project. Nothing is ever written back to Redmine, and mirrored tasks cannot be edited here — an edit would be undone by the next sync.',
    zh: '只拉取一个项目中分派给你的工单。绝不写回 Redmine；镜像来的任务在这里不能编辑 —— 改了也会被下次同步覆盖。',
    ja: '1 つのプロジェクトで自分に割り当てられたチケットのみを取り込みます。Redmine へ書き戻すことは一切なく、取り込んだタスクはここでは編集できません（編集しても次回の同期で上書きされます）。',
  },
  'redmine.syncing': { en: 'Syncing…', zh: '同步中…', ja: '同期中…' },
  'redmine.idle': { en: 'Idle', zh: '空闲', ja: '待機中' },
  'redmine.mirrored': { en: '{n} tickets mirrored', zh: '已镜像 {n} 个工单', ja: '{n} 件を取り込み済み' },
  'redmine.lastSync': { en: 'Last sync: {when}', zh: '上次同步：{when}', ja: '最終同期: {when}' },
  'redmine.never': { en: 'never', zh: '从未', ja: '未実行' },
  'redmine.address': { en: 'Redmine address', zh: 'Redmine 地址', ja: 'Redmine のアドレス' },
  'redmine.addressHint': {
    en: 'The server root, not a page inside it. A deployment under a subpath is fine — http://host/redmine.',
    zh: '填服务器根地址，不是某个页面。部署在子路径下也可以，例如 http://host/redmine。',
    ja: 'サーバーのルートを入力してください（ページの URL ではありません）。サブパス配下の設置も可 — http://host/redmine。',
  },
  'redmine.apiKey': { en: 'API key', zh: 'API 密钥', ja: 'API キー' },
  'redmine.apiKeyKeep': { en: 'Leave blank to keep the saved key', zh: '留空则保留已保存的密钥', ja: '空欄なら保存済みのキーを使用します' },
  'redmine.apiKeyHint': {
    en: 'Redmine → My account → API access key. Shown once and stored encrypted on this machine.',
    zh: 'Redmine → 我的账户 → API 访问键。只显示一次，加密后保存在本机。',
    ja: 'Redmine → マイアカウント → API アクセスキー。表示は一度きりで、この端末に暗号化して保存されます。',
  },
  'redmine.plainHttp': {
    en: 'This address is plain http — the API key will cross the network unencrypted. Normal on an intranet; worth knowing anywhere else.',
    zh: '这是明文 http，API 密钥会以未加密方式通过网络。内网属常态，其他场合请知悉。',
    ja: 'このアドレスは http（平文）です。API キーは暗号化されずにネットワークを流れます。社内ネットワークでは通常ですが、それ以外では留意してください。',
  },
  'redmine.working': { en: 'Working…', zh: '处理中…', ja: '処理中…' },
  'redmine.test': { en: 'Test connection', zh: '测试连接', ja: '接続テスト' },
  'redmine.save': { en: 'Save', zh: '保存', ja: '保存' },
  'redmine.saved': { en: 'Saved.', zh: '已保存。', ja: '保存しました。' },
  'redmine.testOk': { en: 'Connected as {user}.', zh: '已连接，身份：{user}。', ja: '{user} として接続しました。' },
  'redmine.project': { en: 'Project', zh: '项目', ja: 'プロジェクト' },
  'redmine.projectPick': { en: 'Choose a project…', zh: '选择项目…', ja: 'プロジェクトを選択…' },
  'redmine.projectNone': { en: 'Load the list first', zh: '请先加载列表', ja: 'まず一覧を読み込んでください' },
  'redmine.loadProjects': { en: 'Load projects', zh: '加载项目', ja: 'プロジェクトを読み込む' },
  'redmine.projectHint': {
    en: 'Only this project is pulled. Loading the list also fetches the tracker and status names, which is what the mapping needs.',
    zh: '只会拉取这个项目。加载列表同时会读取该服务器的跟踪标签与状态名称 —— 映射正是靠它们。',
    ja: 'このプロジェクトのみ取り込みます。一覧の読み込み時にトラッカー名とステータス名も取得します（マッピングに必要）。',
  },
  'redmine.noProjects': {
    en: 'That account can see no projects. Check the key\'s permissions on the Redmine side.',
    zh: '该账号看不到任何项目。请检查密钥在 Redmine 侧的权限。',
    ja: 'このアカウントから参照できるプロジェクトがありません。Redmine 側の権限をご確認ください。',
  },
  'redmine.enabled': { en: 'Sync automatically', zh: '自动同步', ja: '自動同期' },
  'redmine.enabledHint': {
    en: 'Every 30 minutes, plus once shortly after the app starts. Nothing runs while this is off.',
    zh: '每 30 分钟一次，应用启动后不久也会跑一次。关掉后完全不再请求。',
    ja: '30 分ごと、および起動直後に 1 回。オフの間は一切通信しません。',
  },
  'redmine.preview': { en: 'Preview', zh: '预览', ja: 'プレビュー' },
  'redmine.previewTitle': { en: 'What a sync would do', zh: '同步会做什么', ja: '同期で起こること' },
  'redmine.previewTotal': {
    en: '{n} tickets match; the first {sampled} examined. Nothing has been written.',
    zh: '共 {n} 个工单匹配；已检查前 {sampled} 个。尚未写入任何内容。',
    ja: '{n} 件が該当。先頭 {sampled} 件を確認しました。まだ何も書き込んでいません。',
  },
  'redmine.previewWould': {
    en: '{created} would be added, {updated} refreshed.',
    zh: '{created} 个将新增，{updated} 个将刷新。',
    ja: '{created} 件を追加、{updated} 件を更新します。',
  },
  'redmine.syncNow': { en: 'Sync now', zh: '立即同步', ja: '今すぐ同期' },
  'redmine.full': { en: 'Full re-read', zh: '全量重读', ja: '全件を読み直す' },
  'redmine.fullHint': {
    en: 'Ignore the saved position and read everything again. Use it after changing the project or the user.',
    zh: '忽略已保存的进度，从头重读全部。换了项目或用户之后用它。',
    ja: '保存された位置を無視して全件を読み直します。プロジェクトやユーザーを変更した後に使います。',
  },
  'redmine.syncDone': {
    en: 'Read {fetched}: {created} added, {updated} refreshed.',
    zh: '读取 {fetched} 个：新增 {created}、刷新 {updated}。',
    ja: '{fetched} 件を読み込み: 追加 {created}、更新 {updated}。',
  },
  'redmine.syncPartial': {
    en: 'Read {fetched} and stopped at the page limit — {created} added. The position was NOT advanced, so the next sync continues from here.',
    zh: '读取 {fetched} 个后到达翻页上限 —— 新增 {created}。进度未被推进，下次同步会从这里继续。',
    ja: '{fetched} 件を読み込み、ページ上限で停止しました — 追加 {created}。位置は進めていないため、次回はここから継続します。',
  },
  'redmine.syncFailed': { en: 'The sync did not finish.', zh: '同步未能完成。', ja: '同期が完了しませんでした。' },
  'redmine.readOnlyNote': {
    en: 'Mirrored tickets are read-only here. To keep one as an ordinary task, detach it from the task board.',
    zh: '镜像来的工单在这里是只读的。想把某一个变成普通任务，请在任务面板里「解除关联」。',
    ja: '取り込んだチケットはここでは読み取り専用です。通常のタスクとして扱いたい場合はタスクボードで「切り離し」てください。',
  },
  'redmine.disconnect': { en: 'Disconnect', zh: '断开连接', ja: '接続を解除' },
  'redmine.disconnectHint': {
    en: 'What should happen to the tickets already imported?',
    zh: '已经导入的工单怎么处理？',
    ja: 'すでに取り込んだチケットはどう扱いますか？',
  },
  'redmine.discDetach': { en: 'Keep them as my own tasks', zh: '保留，变成我自己的任务', ja: '自分のタスクとして残す' },
  'redmine.discDetachHint': {
    en: 'Recommended. They stay, become editable, and stop being refreshed.',
    zh: '推荐。它们会留下、变为可编辑，且不再被刷新。',
    ja: '推奨。そのまま残り、編集可能になり、更新されなくなります。',
  },
  'redmine.discDelete': { en: 'Delete them', zh: '删除它们', ja: '削除する' },
  'redmine.discKeep': { en: 'Leave them as they are', zh: '保持原样', ja: 'そのままにする' },
  'redmine.discKeepHint': {
    en: 'Only if you are reconnecting soon: they stay read-only, and with no connection nothing will refresh them.',
    zh: '仅当你马上就要重连时选它：它们会保持只读，而没有连接就没东西再刷新它们。',
    ja: 'すぐ再接続する場合のみ。読み取り専用のままになり、接続がないため更新もされません。',
  },
  'redmine.cancel': { en: 'Cancel', zh: '取消', ja: 'キャンセル' },
  'redmine.disconnected': { en: 'Disconnected. {n} tickets affected.', zh: '已断开连接。影响 {n} 个工单。', ja: '接続を解除しました。{n} 件に影響。' },

  // ─── A task row that came from somewhere else ───
  'tasks.mirrored': { en: 'Imported', zh: '已导入', ja: '取り込み済み' },
  'tasks.mirroredHint': {
    en: 'Mirrored from Redmine — read-only here, and it cannot be dragged to another column. Open it to detach it into an ordinary task.',
    zh: '从 Redmine 镜像而来 —— 在这里只读，也不能拖到别的列。打开它可以解除关联、变成普通任务。',
    ja: 'Redmine から取り込んだものです。ここでは読み取り専用で、他の列へドラッグもできません。開いて「切り離す」と通常のタスクになります。',
  },
  // ═══ Global search (Ctrl/⌘+K palette) ═══
  'search.open': { en: 'Search', zh: '搜索', ja: '検索' },
  'search.placeholder': {
    en: 'Search chats, notes, tasks, meetings…',
    zh: '搜索聊天、笔记、任务、会议…',
    ja: 'チャット・ノート・タスク・会議を検索…',
  },
  'search.hint': {
    en: 'Type to search chats, notes, tasks, meetings, email and reports.',
    zh: '输入即可搜索聊天、笔记、任务、会议、邮件和报告。',
    ja: '入力するとチャット・ノート・タスク・会議・メール・レポートを検索します。',
  },
  'search.searching': { en: 'Searching…', zh: '搜索中…', ja: '検索中…' },
  'search.failed': { en: 'Search failed', zh: '搜索失败', ja: '検索に失敗しました' },
  // The badge on a row that only the vector path found. Rendered, not optional: see
  // lib/searchCore.ts on why a search with no usable threshold must label its recall.
  'search.semanticHit': { en: 'related', zh: '语义相近', ja: '関連' },
  'search.warming': {
    en: 'Related results are still loading — only exact matches are shown.',
    zh: '语义检索仍在加载，当前只显示精确匹配。',
    ja: '関連検索はまだ読み込み中です。現在は完全一致のみ表示しています。',
  },
  'search.noKeyword': {
    en: 'No exact match. These are the closest by meaning —',
    zh: '没有精确匹配。以下是语义上最接近的几条 ——',
    ja: '完全一致はありません。意味が近いものを表示しています —',
  },
  'search.footer': {
    en: '↑↓ select · Enter open · Esc close',
    zh: '↑↓ 选择 · 回车打开 · Esc 关闭',
    ja: '↑↓ 選択 · Enter で開く · Esc で閉じる',
  },
  'search.count': { en: '{n} results', zh: '{n} 条结果', ja: '{n} 件' },
  'search.msgNotFound': {
    en: 'That item is no longer available.',
    zh: '这条内容已经不存在了。',
    ja: 'この項目はすでに存在しません。',
  },
  // Only ever an aria-label: the visible type cue is the row's icon.
  'search.kindChat': { en: 'Chat', zh: '聊天', ja: 'チャット' },
  'search.kindNote': { en: 'Note', zh: '笔记', ja: 'ノート' },
  'search.kindTask': { en: 'Task', zh: '任务', ja: 'タスク' },
  'search.kindMeeting': { en: 'Meeting', zh: '会议', ja: '会議' },
  'search.kindEmail': { en: 'Email', zh: '邮件', ja: 'メール' },
  'search.kindReport': { en: 'Report', zh: '报告', ja: 'レポート' },
} as const satisfies Record<string, Record<string, string>>;

export type I18NKey = keyof typeof I18N;

export function t(key: I18NKey, lang: string, params?: Record<string, string | number>): string {
  const entry = I18N[key] as Record<string, string> | undefined;
  let s = entry?.[lang] || entry?.en || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll('{' + k + '}', String(v));
    }
  }
  return s;
}

/**
 * Inline translator for JSX text that doesn't fit the centralized dictionary.
 * New calls: tr(lang, zh, ja, en)
 * Old 7-arg calls: tr(lang, zh, ja, th, mi, ru, en) — backward compat via _rest detection
 * @param lang — current language code (en/zh/ja)
 * @param zh — Chinese text
 * @param ja — Japanese text
 * @param en — English text (also used as fallback)
 * @param _rest — backward compat: old callers may pass th/mi/ru + en (7 total); last is real en
 */
export function tr(lang: string, zh: string, ja: string, en: string, ..._rest: string[]): string {
  // Detect old 7-arg style: _rest has at least 3 extra args (old th, mi, ru), last is real en
  const effectiveEn = _rest.length >= 3 ? _rest[_rest.length - 1] : en;
  return lang === 'zh' ? zh : lang === 'ja' ? ja : effectiveEn;
}

export default I18N;
