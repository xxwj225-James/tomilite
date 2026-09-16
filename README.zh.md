# TomiLite

[English](README.md) | **中文**

**让你的 AI 真正动手干活 —— 而不只是陪你聊。**

TomiLite 是一个本地优先的桌面 AI 工作台。你用大白话说需求，Agent 就去建任务、写笔记、分类邮件、录制并整理会议、生成日报 —— 全部基于你自己的数据，存在你电脑本地的 SQLite 数据库里。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/xxwj225-James/tomilite)](https://github.com/xxwj225-James/tomilite/releases/latest)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4.svg)](https://github.com/xxwj225-James/tomilite/releases/latest)

**[⬇ 下载 Windows 版](https://github.com/xxwj225-James/tomilite/releases/latest)** · [Tomi 能做什么](#tomi-能做什么) · [功能](#功能) · [文档](docs/) · [官网](https://tomatovector.com)

![TomiLite — 对话优先的 AI Agent](docs/images/home.jpg)

## 为什么选 TomiLite？

AI 什么都能答。但它不知道**你正在忙什么**。

TomiLite 给你的 AI 一个持久化的工作区 —— 你的任务、笔记、知识库、邮件和会议 —— 让它基于你的真实上下文行动，而不是靠猜。

## 🎙 会议录音永不离开你的电脑

录一场会议，拿到带行动项的纪要 —— 音频全程不上传：

![TomiLite 会议流程 —— 录制、本机转写、AI 纪要、行动项一键变任务](docs/images/meeting-demo.gif)

1. **录制** —— 麦克风与系统声音混成一路
2. **本机转写** —— 内置的 [whisper.cpp](https://github.com/ggml-org/whisper.cpp) 二进制在你电脑上完成语音识别：不调 API、不上传
3. **AI 生成纪要** —— 摘要、决议与行动项，说话人如实标注 `Speaker 1/2/3`（不做声纹识别，所以绝不编造姓名）
4. **直接行动** —— 任何行动项一键变成看板上的任务；纪要可以通过你自己的 SMTP 发出去

大多数会议 AI 工具都要上传音频、按分钟计费。TomiLite 的音频永远不离开你的电脑 —— 只有转写文本会在你主动要求生成摘要时送到你配置的 LLM。**即使完全没配置 LLM**，录制和转写也能正常工作。

→ [会议功能详解](docs/meetings.md)

## Tomi 能做什么？

用大白话跟 Tomi 聊 —— Agent 把你的话变成动作，结果实时出现在任务 / 笔记 / 邮件 / 日报面板里：

| 你说                                      | Tomi 会做                            |
| ----------------------------------------- | ------------------------------------ |
| "创建一个任务：重构登录模块，优先级 high" | 在任务看板上建一个任务               |
| "把任务改成进行中 / 更新这个任务"         | 更新状态、优先级、描述               |
| "写一篇关于 API 设计的笔记"               | 在知识库创建 Markdown 笔记           |
| "生成今天的日报"                          | 生成晨间任务简报 + 晚报              |
| "总结未读邮件"                            | 读取邮件（IMAP）、分类、起草回复     |
| "搜索知识库里关于缓存的内容"              | 语义搜索笔记                         |
| "看看最近的 git 提交"                     | 读取你的 git 工作区                  |
| "帮我分析 TL-3 这个任务"                  | 打开并分析指定 issue                 |

> 提示：应用内欢迎引导也提供了一键示例提示词。新会话是空的 —— 随便问 Tomi 什么，或者直接用上面的例子。

## 功能

| 功能 | 说明 |
| ---- | ---- |
| 🎙 **本地会议纪要** | 录制 → 本机 whisper.cpp 转写 → AI 纪要 + 行动项 → 一键变任务。音频永不外传 |
| 💬 **对话优先的 AI Agent** | 多会话聊天、并发任务；Agent 通过 function calling 调用工具（建/改任务、笔记、日报、网页搜索、git、shell） |
| ✅ **任务看板** | TODO / In Progress / Done 分栏、拖拽改状态、列宽可调可排序、优先级与类型 |
| 📝 **笔记与知识库** | Markdown 所见即所得编辑器（Milkdown），自动生成目录栏（目次）并高亮当前阅读位置；语义搜索；可导出 Excel / Word / PDF / PPT / HTML / MD |
| 📧 **智能邮件处理** | AI 四分类、LLM 二次分组、AI 回复草稿、邮件↔任务关联（IMAP） |
| 📊 **日报** | 晨间任务简报 + 晚报，AI 自动生成，可导出 Excel / Word / PDF / PPT |
| 🔌 **MCP 服务端与客户端** | 把任务/笔记暴露给外部 AI 客户端（如 Claude Code），支持 API Key 鉴权 + 人工审批；也可连接其他 MCP 服务器，让 Agent 使用它们的工具 |
| 🤖 **多 provider LLM** | DeepSeek、Qwen（DashScope）、Kimi（Moonshot）、OpenAI、Anthropic、Ollama |
| 🌐 **官方托管试用** | 无需 API Key：在 **设置 → LLM → Hosted** 用邮箱登录，通过官方网关使用免费额度。自带 Key（BYOK）依然可用，一键切换 |
| 🌍 **三语 · 4 套主题** | 中文 / 日本語 / English；Pipeline（深色）/ Hub（浅色）/ Canvas（纯白）/ Quantum（墨绿），全部基于 CSS 变量 |

## 🔒 隐私与遥测

TomiLite 是**本地优先**的：任务、笔记、邮件、日报、聊天记录、会议录音与转写、API Key、git 数据都存在 `~/.tomilite/` 下你自己的 SQLite 数据库里，从不上传。

**会议功能尤其如此** —— 录制、语音识别、存储全在本机完成，音频本身不会上传到任何地方。唯一的例外是 AI 环节：当你要求生成摘要、决议或纪要时，发给你配置的 LLM 提供方（托管试用时经由 TomiVector 网关）的是**转写文本**，不是音频。语音识别与 AI 摘要是两个独立步骤，所以完全可以做到"录了、转了，但什么都没离开你的电脑"。

其余唯一的对外流量是**可选、需主动开启的匿名使用统计** —— 首次启动时会征询，之后随时可在 **关于 → 隐私与使用统计** 中更改。开启后只会把聚合计数、功能/面板名称、导出格式、应用版本/系统/语言批量发送到作者服务器（`tomatovector.com`）。**不含任何聊天内容、文件和笔记/邮件正文或标题、文件名、代码、API Key 与个人数据。** 关闭时会清空本地暂存缓冲。

📄 完整的采集范围、接口约定以及如何自建接收端，见 [docs/telemetry.md](docs/telemetry.md)。

## 快速开始

### 安装（Windows）

**[⬇ 下载最新安装包](https://github.com/xxwj225-James/tomilite/releases)**，运行 `TomiLite-Setup-*.exe`。

### 配置

1. **设置 → LLM**：填入你自己的 API Key（DeepSeek / Qwen / Kimi / OpenAI / …）并测试连接 —— 或选 **Hosted** 用邮箱登录，直接用官方网关试用，无需 Key
2. **设置 → 邮件**：添加 IMAP 账号以启用邮件处理（可选）
3. **设置 → MCP 服务器**：连接外部 MCP 服务器供 Agent 使用（可选）

### 开发

```bash
npm install
npm run dev        # 启动 Vite 开发服务器（前端）+ API 服务
npm run pack       # 构建并打包 Windows 安装包（electron-builder）
```

环境要求：Node.js 20+、npm 10+。

## 界面截图

![多会话聊天](docs/images/home-sessions.jpg)

![任务看板 —— 拖拽改状态](docs/images/tasks.jpg)

![笔记 —— Markdown 所见即所得编辑器](docs/images/notes.jpg)

![邮件 —— AI 分类与回复草稿](docs/images/email.jpg)

![日报 —— 晨间简报 + 晚报](docs/images/reports.jpg)

## 架构

```
electron/          Electron 外壳（窗口、拉起 API、OTA 更新、系统通知）
apps/web/          React 19 + Vite 前端（面板：聊天、任务、笔记、邮件、日报、MCP）
apps/api/          Node.js API 服务（tRPC + 原生 SSE Agent 流）
  src/agent/       AI Agent：ReAct 循环、工具注册与分发、LLM 客户端、
                   MCP 客户端（协议协商、动态工具注入）
  src/routers/     tRPC 路由（issues、wiki、email、reports、mcp、standup…）
packages/
  database/        Prisma schema + SQLite（用户数据存本地）
  shared-ui/       共享 React 组件
```

关键设计：

- **本地优先**：SQLite 存在 `~/.tomilite/`，不依赖云服务
- **Agent 工具调用**：基于原生 fetch 实现 OpenAI 兼容的 `tools`/`tool_choice` 协议 —— 各家 provider 的差异按 baseUrl 分别处理
- **MCP 客户端**：自动协商 TomiHub 风格 / JSON-RPC / 旧版协议；发现的工具注入为 `mcp__<server>__<tool>` 函数；API Key 静态加密，绝不发给 LLM
- **人工介入**：外部 MCP 客户端的写操作需在 MCP 面板中审批
- **数据库迁移**：只做增量、带版本号（`SCHEMA_VERSION`，见 `apps/api/src/server.ts`）

## 文档

- [架构](docs/architecture.md) —— 系统设计、面板、工具、OTA
- [会议](docs/meetings.md) —— 录制、本地转写、AI 纪要、生成任务
- [MCP 客户端](docs/mcp-client.md) —— 连接外部 MCP 服务器
- [邮件 AI 收件箱](docs/email-ai.md) —— AI 邮件分类与处理
- [任务面板](docs/tasks-panel.md) —— 看板、拖拽改状态、任务编辑器
- [UI 设计系统](docs/ui-design-system.md) —— 设计令牌、主题、组件
- [安全](docs/SECURITY.md) —— 本地优先的安全模型
- [隐私与遥测](docs/telemetry.md) —— 可选的匿名使用统计
- [版本发布说明](docs/release-notes/)

## 🧩 生态

- **🌐 TomiLite 浏览器扩展** —— [tomilite-browser-extension](https://github.com/xxwj225-James/tomilite-browser-extension)：Chrome / Edge 里的 AI 侧边栏，一键总结或翻译任意网页、把选中内容剪藏成任务与笔记、翻译视频字幕（bilibili / YouTube / HTML5 视频站），并与桌面端自动同步（localhost:3192）。📥 [下载](https://github.com/xxwj225-James/tomilite-browser-extension/releases)
- **🤖 DSH 插件** —— [tomilite-dsh-plugin](https://github.com/xxwj225-James/tomilite-dsh-plugin)：让你的 DeepSeek Harness Agent 访问本地 TomiLite 的任务、笔记与统计

## 支持

TomiLite 完全免费开源。如果它帮到了你的工作流，欢迎支持它继续开发：

- 💝 [爱发电](https://afdian.com/a/jameswu) —— 一次性或按月支持

### 合作伙伴推荐 · 赞助

- ☁️ [腾讯云新客特惠](https://curl.qcloud.com/kGPqI6IA) —— 云服务器新用户代金券
- ☁️ [阿里云云大使](https://www.aliyun.com/minisite/goods?userCode=x4jbzcb6) —— 新用户最高 45% 返现

## TomiHub 团队版

TomiLite 面向个人工作流；**[TomiHub](https://tomatovector.com)** 面向团队协同 —— _本地优先、AI 原生、隐私优先设计。_

TomiHub 不只是 TomiLite 的多用户版，而是为研发组织设计的枢纽 —— 打通 MCP 协议、RBAC 权限、LLM 算力路由与项目管理，让整个团队在同一块看板上协作，同时保留本地客户端的全部隐私优势。

- **全流程项目管理** —— 瀑布 / Scrum / 看板、Issue 跟踪、甘特图、Sprint 迭代、Wiki
- **AI 算力枢纽** —— 集中式模型接入，支持 DeepSeek / Qwen / Kimi / OpenAI 路由，以及 Ollama / vLLM 本地模型
- **多用户实时协作** —— 三级 RBAC 权限、GitHub / GitLab Webhook
- **100% 数据主权** —— Docker 自托管部署、全局加密同步与备份、团队级深度 RAG 检索

访问 [tomatovector.com](https://tomatovector.com) 了解更多。

## 商标

"TomiLite"、"TomiHub"、"Tomatovector" 是 Tomatovector 的商标。MIT 许可证允许复用代码，但未经书面许可，不得将名称与标识用于衍生产品或暗示背书。

## 许可证

[MIT](LICENSE) © 2026 Tomatovector
