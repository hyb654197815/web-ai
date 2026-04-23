# Portable AI Agent Widget

一个面向前端项目的 AI Agent 方案，仓库里同时包含两部分：

- 前端运行时 Widget：页面问答、受控路由跳转、当前页表单操作
- `webgenerate` CLI：为 Codex、Claude、Cursor、Copilot、Gemini、Trae 等助手安装知识库工作流

如果你是从 npm 安装来直接使用 `webgenerate`，更适合看 npm 包里的精简说明；GitHub 仓库这里重点说明项目本身怎么集成、怎么开发、怎么发布。

设计文档：

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PRINCIPLES.md](./PRINCIPLES.md)

## 项目用途

适合下面几类场景：

- 给后台、中台、运营系统增加页面问答助手
- 让用户通过自然语言触发受控导航和当前页表单操作
- 为前端项目生成 `webAIDocs/routes.md` 与 `page-xxx.md`
- 让 AI 编码工具先按业务文档定位页面，再进入源码修改

## 仓库结构

```text
.
├─ src/                     # Widget 源码
├─ dist/                    # 前端构建产物
├─ backend/                 # FastAPI 后端
├─ scripts/webGenerate.js   # CLI 安装入口
├─ prompts/                 # 提示词
├─ templates/               # 各平台 skill 模板
└─ webAIDocs/               # 生成后的业务知识文档
```

## 前端项目怎么接入

### 1. 安装

```bash
npm install portable-ai-agent-widget
```

### 2. 作为 ESM 引入

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "https://your-agent-service.com/api",
  routerPush: (route) => router.push(route),
});

await AIAgent.sendMessage("打开设置页");
```

### 3. 或使用 IIFE / CDN

```html
<script
  src="https://your-cdn.com/agent-widget.iife.js"
  data-backend-url="https://your-agent-service.com/api"
  data-mode="auto"
  data-stream="true"
></script>
```

## 后端要求

前端默认对接 `http://localhost:4096/api`，常用接口：

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

后端本地启动：

```bash
cd backend
pip install -r requirements.txt
python main.py
```

## `webgenerate` 在项目里的作用

`webgenerate` 本身只负责安装和卸载助手 Skill，不直接生成文档。

安装示例：

```bash
webgenerate codex install
webgenerate claude install
webgenerate cursor install
```

安装后在助手里触发：

```bash
/webGenerate .
/webGenerate . --update
```

Codex 中使用：

```bash
$webGenerate .
$webGenerate . --update
```

生成结果统一写到项目根目录：

- `webAIDocs/routes.md`
- `webAIDocs/page-xxx.md`

## 本地开发

```bash
npm install
npm run build
npm run dev
```

## 发布到 npm

```bash
npm run build
npm pack --dry-run
npm publish
```

仓库默认保留 GitHub 版 `README.md`。发包时会自动切换成 npm 版 README，打包后自动恢复，无需手动替换。
