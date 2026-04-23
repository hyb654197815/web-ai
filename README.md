# Portable AI Agent Widget

一个可发布到 npm 的前端 AI Agent 组件包，同时提供：

- 前端运行时 Widget：页面问答、受控路由跳转、当前页表单操作
- `webGenerate` CLI 安装入口：为 Codex、Claude、Cursor、Copilot、Gemini、Trae 等助手安装知识库工作流

架构和设计原理已拆分到独立文档：

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PRINCIPLES.md](./PRINCIPLES.md)

## 安装

### 作为前端运行时包安装

```bash
npm install portable-ai-agent-widget
```

### 作为 CLI 安装器直接使用

推荐无需全局安装，直接用 `npx`：

```bash
npx portable-ai-agent-widget codex install
npx portable-ai-agent-widget claude install
npx portable-ai-agent-widget cursor install
```

如果你希望长期使用，也可以全局安装：

```bash
npm install -g portable-ai-agent-widget
webGenerate codex install
```

## 包含内容

安装后你会得到两类能力：

1. 包入口 `portable-ai-agent-widget`
2. 命令行入口 `webGenerate`

对应产物：

- `dist/agent-widget.js`：ESM 版本
- `dist/agent-widget.iife.js`：IIFE 版本
- `scripts/webGenerate.js`：CLI 安装入口

## 前端使用

### 方式一：ESM 引入

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "https://your-agent-service.com/api",
  routerPush: (route) => router.push(route),
});

await AIAgent.sendMessage("打开设置页");
```

### 方式二：IIFE / CDN 引入

如果你需要把构建产物发布到 CDN，可使用：

```html
<script
  src="https://your-cdn.com/agent-widget.iife.js"
  data-backend-url="https://your-agent-service.com/api"
  data-mode="auto"
  data-stream="true"
></script>
```

随后可直接调用：

```html
<script>
  window.AIAgent.sendMessage("打开用户管理页");
</script>
```

## `AIAgent` 常用 API

- `AIAgent.init(config)`
- `AIAgent.sendMessage(message, options?)`
- `AIAgent.execute(payload, options?)`
- `AIAgent.startNewSession(options?)`
- `AIAgent.resetSession(options?)`
- `AIAgent.getSessionId()`
- `AIAgent.setSessionId(sessionId)`
- `AIAgent.getConfig()`

常用初始化字段：

| 字段 | 说明 |
| --- | --- |
| `backendUrl` | 后端 API 基础地址 |
| `routerPush(route)` | SPA 路由跳转函数 |
| `mode` | `auto | crewai | opencode` |
| `stream` | 是否启用 SSE |
| `chatPath` | 默认 `/chat` |
| `streamPath` | 默认 `/chat/stream` |
| `sessionId` | 初始会话 ID |
| `headers` | 额外请求头 |

## `webGenerate` 的使用方式

`webGenerate` 现在只负责安装和卸载助手 Skill，不直接生成文档。

### 1. 安装到对应助手

```bash
webGenerate codex install
webGenerate claude install
webGenerate opencode install
webGenerate copilot-cli install
webGenerate vscode-copilot install
webGenerate gemini install
webGenerate antigravity install
webGenerate cursor install
webGenerate trae install
webGenerate trae-cn install
```

卸载：

```bash
webGenerate <platform> uninstall
```

### 2. 在助手里触发文档生成

安装完成后，在项目里运行：

```bash
/webGenerate .
/webGenerate . --update
```

Codex 中使用：

```bash
$webGenerate .
$webGenerate . --update
```

最终产物统一写到项目根目录：

- `webAIDocs/routes.md`
- `webAIDocs/page-xxx.md`

## 后端接口约定

前端默认对接 `http://localhost:4096/api`，常用接口包括：

- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/session`
- `POST /api/session/{sessionId}/message`
- `GET /api/health`
- `GET /api/page-agent/config`
- `POST /api/page-agent/chat/completions`

运行时只接受三类结果：

1. 普通问答
2. `navigate`
3. `form`

## 本地开发

```bash
npm install
npm run build
npm run dev
```

后端本地启动：

```bash
cd backend
pip install -r requirements.txt
python main.py
```

## 发布到 npm

首次发布或后续发版可按下面流程执行：

```bash
npm run build
npm login
npm publish
```

发版前建议先检查：

```bash
npm pack --dry-run
```

如果后续需要发新版本：

```bash
npm version patch
npm publish
```

## 适用场景

- 给后台、中台、运营系统增加页面问答助手
- 在业务项目中提供受控导航和当前页表单操作
- 为前端项目生成 `webAIDocs/` 知识库
- 让 AI 编码工具先按业务文档定位页面，再改代码
