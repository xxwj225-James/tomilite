# TomiLite — 代码防反编译安全设计

> 适配 Node.js/TypeScript 技术栈。

## 威胁模型

TomiLite 作为开源分发产品，攻击者可以：
- 直接读取源码（GitHub 开源仓库）
- 解包 npm 分发的 `.tgz` / Docker 镜像
- `node --inspect` 调试运行时，dump 内存中的源码
- 提取 AI Prompt 和业务逻辑

**目标：发布版本（非开源仓库）的反编译成本高到不可接受。**

---

## 技术栈分层

| 层 | 技术 |
|----|------|
| API Server | TypeScript → esbuild → .js | Java .jar |
| AI Agent | TypeScript (同 API) | Python .py |
| Frontend | React → Vite → .js/.css | 不适用（前端代码公开） |
| Docker | Multi-stage Alpine | 同 |

---

## P0: JavaScript 混淆（当前实施）

**工具**: `javascript-obfuscator`
**对应**: ProGuard 混淆策略

```
混淆策略（对齐 ProGuard keep 规则）:

保留可读（= ProGuard -keep）:
  routers/*.js       → tRPC 路由映射需要过程名
  shared/**/*.js     → 共享类型、枚举值
  trpc.js            → tRPC 初始化
  server.js          → 入口文件

轻度混淆:
  services/*.js      → 业务逻辑
  lib/*.js           → 工具函数

完全混淆:
  所有其他 .js       → 内部实现
```

**混淆选项**:

| 选项 | 值 | 说明 |
|------|-----|------|
| `controlFlowFlattening` | true (threshold 0.75) | 打乱控制流，反编译后逻辑难以还原 |
| `stringArray` | true (base64) | 字符串加密，AI Prompt 不可 grep |
| `deadCodeInjection` | true (threshold 0.4) | 注入死代码迷惑反编译 |
| `selfDefending` | true | 格式化/美化代码后自动触发死循环 |
| `splitStrings` | true | 字符串拆分到多个变量，阻止搜索 |
| `identifierNamesGenerator` | hexadecimal | 变量名 → `_0x1a2b3c` |

**构建命令**: `npm run build:prod`（自动执行混淆）

---

## P2: V8 字节码编译（上市前启用）

**工具**: `bytenode`
**对应**: ClassFinal AES 加密思路

**效果**: `.js` 文件编译为 V8 字节码 (`.jsc`)，反编译工具直接报 "不是合法 JS 文件"。

```bash
# 上市发布构建
npm run build:prod    # tsc + javascript-obfuscator 混淆
npm run bytecode       # bytenode 编译 .js → .jsc
```

**保留不编译**:
- `server.js` — Node.js 入口必须为 .js
- 前端构建产物 (`dist/`) — 已通过 Vite Terser 压缩混淆

**启动方式**:
```js
// server.js
require('bytenode');
require('./routers/issue.jsc');  // 加载字节码模块
```

**构建命令**: `node scripts/compile-bytecode.js`

---

## 前端防护

**双重混淆：Terser + javascript-obfuscator**

前端代码在 Vite 构建时经过两层处理：

**第 1 层 — Terser（Vite 内置）**:
- Tree shaking（死代码消除）
- Variable mangling（变量名混淆）
- Console removal（`drop_console`）
- Code minification（压缩）

**第 2 层 — vite-plugin-obfuscator（自定义插件）**:
- `controlFlowFlattening: true` (threshold 0.9) — 打乱控制流
- `stringArray: true` (RC4 加密) — 所有字符串加密
- `deadCodeInjection: true` — 注入死代码
- `selfDefending: true` — 防止格式化/美化
- `debugProtection: true` — 阻止 DevTools 调试
- `transformObjectKeys: true` — 混淆对象属性名

**效果**：
```
源码:  const apiUrl = "/api/issues"
Terser: const a="/api/issues"
+vite-plugin: const _0x12f3a4=_0xa1b2('4e%$#@',0x3f);  // RC4解密后才是 "/api/issues"
```

**生产构建**:
```bash
cd apps/web
vite build --mode production    # 自动触发 obfuscatorPlugin
# 输出 dist/ — 无 sourcemap，双重混淆
```

---

## npm 分发包加固

| 措施 | 说明 |
|------|------|
| `.npmignore` | 排除源码 `src/`，只发布 `dist/` + 混淆后的文件 |
| `files` 字段 | `package.json` 中指定 `dist/` 为发布内容 |
| 去除 sourcemap | 生产构建不生成 `.map` 文件 |

---

## Docker 镜像加固

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /build
COPY package*.json .
RUN npm ci --production
COPY . .
RUN npm run build:prod

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /build/apps/api/dist ./api
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json .

# 清理
RUN rm -rf /var/cache/apk/* /tmp/* /root/.npm /root/.cache

USER node
EXPOSE 3001
CMD ["node", "api/server.js"]
```

> 最终镜像只有混淆后的 `.js` + `node_modules`，零明文源码。

---

## 安全分级

| 组件 | 开源仓库 | P0 发布 | P2 上市 |
|------|---------|--------|---------|
| API Server | TypeScript 源码 | javascript-obfuscator 混淆 | bytenode V8 字节码 |
| AI Agent | TypeScript 源码 | 同上 | 同上 |
| Frontend | React 源码（公开） | Vite Terser | vite-plugin-obfuscator |
| AI Prompt | 明文在源码中 | stringArray base64 加密 | 字节码不可读 |
| npm 包 | — | 去除 sourcemap | 只发布 dist/ |

## 实施优先级

| Phase | 内容 | 状态 |
|-------|------|---------------|------|
| **P0** | javascript-obfuscator 混淆 + Docker 清理 | ProGuard | ✅ 已实施 |
| **P2** | bytenode V8 字节码 | ClassFinal AES | 📋 脚本就绪，上市前运行 |
