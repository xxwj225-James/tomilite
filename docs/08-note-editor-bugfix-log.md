# Note Editor Bug Fix Log — 2026-07-20

## 代码块语法高亮

### 问题
代码块在编辑器中没有语法着色，只有 CSS 暗色背景。

### 尝试过的方案

| 方案 | 结果 | 原因 |
|------|------|------|
| highlight.js 直接修改 `innerHTML` | 高亮起效但代码块点击定位失效 | DOM 突变破坏了 ProseMirror 的 position → DOM 映射 |
| ProseMirror Decoration Plugin（模块级单例） | 编辑器内容空白、无法编辑 | Note/Report 两个编辑器共享同一个 Plugin 实例，状态冲突 |
| ProseMirror Decoration Plugin（`$prose(() => new Plugin({...}))` 每次新建） | ✅ 完美 | 每个编辑器实例获得独立的 Plugin |

### 最终方案

```
hljs.highlight(code) → HTML
  → parseTokens(HTML) → [{from, to, cls}]
    → Decoration.inline(from, to, {class: cls})
      → ProseMirror 渲染为覆盖 <span>（零 DOM 突变）
```

关键点：
- Plugin 在 `$prose` 工厂内创建（`$prose((ctx) => new Plugin({key: HL_KEY, ...}))`），避免多编辑器共享
- `HL_KEY`（PluginKey）可以模块级共享，但 Plugin 实例不行
- 2 秒间隔刷新，搭配位置边界检查 `start + t.to <= pos + node.nodeSize`

---

## 面板滚动条

### 问题
右侧面板被拖宽后超出窗口，没有横向滚动条。

### 修复

| CSS | 改动 | 作用 |
|-----|------|------|
| `.app-root` | `overflow:hidden` → `overflow-x:auto; overflow-y:hidden` | 允许根元素横向滚动 |
| `.app-shell` | 新增 `min-width:0` | 允许 flex 子元素缩小 |
| `.app-viewport` | 新增 `overflow-x:scroll; min-width:0` | 面板溢出时显示滚动条 |
| `.main-chat-wrapper` | 新增 `min-width:0` | 同上 |
| `.app-viewport-chat` | `flex:1 1 360px; min-width:360px` | 聊天区最小宽度 |
| `.panel--open` | 新增 `width:auto; min-width:340px; flex-shrink:0` | 面板不能缩小 |

---

## 置顶按钮持久化

### 问题
早会 greeting 的置顶按钮在重启后消失，置顶内容也不见了。

### 修复

1. **按钮消失**：`saveMsg` 未传 `pinnable:true`，`switchSession` 未加载 `pinnable` 字段
   - 新增 `ChatMessage.pinnable` 列（schema v11）
   - `saveMsg` 传 `pinnable`，`switchSession` 恢复 `pinnable`
   - Greeting 消息加 `tool:'greeting'` 标记做兜底检测

2. **置顶内容消失**：`pinnedText` 只有 React state 没有持久化
   - `useState(() => localStorage.getItem('tl-pinned-text'))` 初始化读取
   - `useEffect` 同步写入 localStorage

---

## Action 按钮（润色/翻译/总结/扩写）

### 问题
点击后 AI 只返回纯文本，没有 Apply/Undo 按钮。

### 根因分析

1. **`stagedData` 从未赋值** — `suggest_note_edit` 结果被 auto-apply 消费后，`stagedData` 仍为 null
2. **action 按钮绕过 `sendMessage` 正常流程** — `sendMessageRef.current(text)` 不捕获 `noteSnapshot`，AI 收不到编辑器上下文
3. **Guard model 不识别 `[Note editor action:]` 格式** — 没有对应分类规则

### 修复

| 文件 | 改动 |
|------|------|
| `App.tsx` | `stagedData` 赋值：`{ title, content, original, type:'note' }` |
| `App.tsx` | `sendMessage` 新增 `noteActionPayload` 参数 |
| `App.tsx` | `onNoteAction` 只对 4 个 action 类型触发 AI，过滤保存通知 |
| `agent.ts` | 检测 `[Note editor action:]` 时跳过 guard model，直接路由到 `suggest_note_edit` |
| `App.tsx` | staged 聊天气泡：`_full?.content` 全文 Markdown 渲染预览 |

---

## 代码块与编辑器的交互

### 代码块按钮
- 恢复 `createCodeBlockCommand`（之前改为插入 ``` 符号），显示原生代码块带背景

### Shift-Enter 换行
- `$prose((ctx) => proseKeymap({'Shift-Enter': ...}))` — 在代码块内插入 `\n`

### 外部粘贴代码
- paste handler：`<pre>` / `<code>` HTML 放行（ProseMirror 转换为代码块），其余 HTML → 纯文本

### Ctrl-Enter 退出代码块
- ProseMirror 内置行为，无需自定义 keymap

---

## saveMsg 竞态

### 问题
`saveMsg` 在 `currentSessionId` 为空时每次调用都 `createSession`，短时间内多次调用产生重复 session。

### 修复
```ts
const sessionCreatingRef = useRef<Promise<string> | null>(null);
// 复用正在创建的 session promise
if (!sessionCreatingRef.current) {
  sessionCreatingRef.current = api.chat.createSession('Chat 1').then(...)
}
sessionCreatingRef.current.then((sid) => doSave(sid));
```

---

## 其他修复

- **TOC 点击 crash**：删除了 ContentPanel 中的 TOC（DOM Range 操作不兼容 ProseMirror）
- **前端二次混淆**：`obfuscate.js` 删掉前端 index-*.js 的二次混淆（vite plugin 已处理）
- **export_to_excel / export_to_doc**：新增 agent tools，支持导出 Excel/Word
