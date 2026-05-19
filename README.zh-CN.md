# Portable AI Agent Widget

[![npm version](https://img.shields.io/npm/v/portable-ai-agent-widget)](https://www.npmjs.com/package/portable-ai-agent-widget)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-43853d)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[English](./README.md)

在线文档与演示：<https://hyb654197815.github.io/web-ai/>

`portable-ai-agent-widget` 是一个面向前端业务系统的页面级 AI Agent 方案。它的核心不是“再造一个通用聊天框”，而是把前端页面知识沉淀成一套可复用的 `webAIDocs/`，同时服务两类 Agent：

1. 编程 Agent：先读业务文档，再改代码，提升 coding 质量。
2. 前端运行时 Agent：直接消费这套文档，更快接入页面问答、导航和当前页操作。

## 这个项目是干什么的

这个项目把“前端页面知识驱动 Agent”拆成三层：

- `webGenerate`：给编程助手安装工作流，并在真实业务前端项目中生成 `webAIDocs/routes.md` 和 `page-xxx.md`
- FastAPI 后端：负责模型配置、鉴权、MCP、会话、计费、知识托管
- 前端 Widget：负责把 AI Agent 接到你的业务系统页面里

如果你的系统是后台、运营平台、中台、工作台、管理端这类“页面结构清晰、路由稳定、表单和操作流程明确”的产品，这个项目会非常适合。

## 项目的两个核心能力

### 1. 生成业务文档，增强编程 Agent 的 coding 能力

`webGenerate` 不是直接生成代码，而是先让助手在真实业务仓库中生成业务知识文档：

- `routes.md`：系统路由总索引
- `page-xxx.md`：页面用途、字段、按钮、操作流程、注意事项

这样做的价值是，编程 Agent 在开发、重构、排查问题前，可以先理解页面业务含义，而不是只靠扫源码和猜字段名。

### 2. 生成的文档，可以让前端 Agent 快速接入

这套文档不只是给 IDE 用的。

你可以把生成后的 `webAIDocs/` 目录压缩成 ZIP，上传到管理端 `Knowledge`，再配置模型和 API Key，前端 Widget 就能快速获得业务上下文。

这意味着一套文档可以同时服务：

- 编程阶段的 coding Agent
- 运行阶段的前端 Agent
- 后端内置 MCP 文档查询能力

## 推荐流程

推荐按下面这条链路使用这个项目：

1. 给团队使用的编程助手安装 `webGenerate`
2. 在真实业务前端仓库中触发助手命令，生成 `webAIDocs/`
3. 检查生成结果是否覆盖主要页面
4. 把整个 `webAIDocs/` 压缩成 ZIP
5. 启动后端，打开管理端
6. 在管理端配置模型
7. 在 `Knowledge` 中上传 ZIP
8. 在 `API Keys` 中创建开发用 Key
9. 在你的前端项目里接入 Widget

这条流程适合作为快速开始，因为它优先走“助手生成文档 + 管理端上传 + 前端接入”的路径，而不是一开始就让使用者直接面对 API 细节。

## 快速开始

### 环境要求

- Node.js `>= 18`
- 后端建议 Python `3.11+`

### 1. 给编程助手安装 `webGenerate`

下面这些命令都可以直接执行：

| 编程助手 | 安装命令 | 助手内触发方式 | 增量同步 | 卸载命令 |
| --- | --- | --- | --- | --- |
| Codex | `npx portable-ai-agent-widget codex install` | `$webGenerate .` | `$webGenerate . --update` | `npx portable-ai-agent-widget codex uninstall` |
| Claude Code | `npx portable-ai-agent-widget claude install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget claude uninstall` |
| OpenCode | `npx portable-ai-agent-widget opencode install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget opencode uninstall` |
| GitHub Copilot CLI | `npx portable-ai-agent-widget copilot-cli install` | 让 Copilot 执行 `/webGenerate .` | 让 Copilot 执行 `/webGenerate . --update` | `npx portable-ai-agent-widget copilot-cli uninstall` |
| VS Code Copilot Chat | `npx portable-ai-agent-widget vscode-copilot install` | 让 Copilot 执行 `/webGenerate .` | 让 Copilot 执行 `/webGenerate . --update` | `npx portable-ai-agent-widget vscode-copilot uninstall` |
| Gemini CLI | `npx portable-ai-agent-widget gemini install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget gemini uninstall` |
| Cursor | `npx portable-ai-agent-widget cursor install` | 让 Cursor Agent 执行 `/webGenerate .` | 让 Cursor Agent 执行 `/webGenerate . --update` | `npx portable-ai-agent-widget cursor uninstall` |
| Trae | `npx portable-ai-agent-widget trae install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget trae uninstall` |
| Trae CN | `npx portable-ai-agent-widget trae-cn install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget trae-cn uninstall` |
| Antigravity | `npx portable-ai-agent-widget antigravity install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget antigravity uninstall` |

参数说明：

- `<platform>` 支持：`claude`、`codex`、`opencode`、`copilot-cli`、`vscode-copilot`、`gemini`、`antigravity`、`cursor`、`trae`、`trae-cn`
- 动作参数支持：`install`、`uninstall`
- 也支持另一种写法：`webGenerate install --platform codex`

助手内命令参数说明：

- `[path]` 是要扫描的项目根目录，通常直接传 `.`
- `--update` 表示只做增量同步，适合页面功能改动之后再次刷新文档
- 如果 `routes.md` 缺失或质量太差，增量模式会自动回退成全量生成

### 2. 在真实业务前端项目中生成 `webAIDocs`

注意：生成动作要在你的业务前端仓库里执行，不是在本项目仓库里执行。

生成结果通常如下：

```text
webAIDocs/
  routes.md
  page-xxx.md
  page-yyy.md
```

这些文件的含义：

- `routes.md`：告诉 Agent 系统里有哪些页面、路由如何映射
- `page-xxx.md`：告诉 Agent 当前页面做什么、有哪些字段和按钮、常见操作步骤是什么

### 3. 把 `webAIDocs/` 压缩成 ZIP

建议把整个 `webAIDocs/` 目录直接压缩上传，不要只拿一份 `routes.md`。

原因很简单：运行时 Agent 真正要用的是整套页面文档，而不是单一总索引。

### 4. 启动后端

```bash
cd backend
pip install -r requirements.txt

# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

至少需要修改：

```env
ADMIN_PASSWORD=your-strong-password
JWT_SECRET_KEY=your-long-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=15
ENABLE_ADMIN_BACKEND=true
```

然后启动：

```bash
python main.py
```

默认地址：

- 服务地址：`http://localhost:4096`
- 管理后台：`http://localhost:4096/admin`

### 5. 在管理端配置模型，并上传业务文档 ZIP

第一次进入管理端，建议按这个顺序来：

1. 登录管理员账号
2. 在 `Models` 中配置至少一个可用模型
3. 在 `Knowledge` 中上传 `webAIDocs` ZIP
4. 在 `API Keys` 中创建开发联调用的 Key
5. 需要时再去配置 `Tools & MCP`

为什么推荐这个顺序：

- 没有模型，Agent 无法正常工作
- 没有知识文档，Agent 只能做非常泛的回答
- ZIP 上传比手工逐个复制文档更稳，尤其适合多仓库场景

当前管理端支持：

- 上传 ZIP
- 上传单文件
- 在线编辑文档
- 重命名
- 删除

### 6. 接入前端 Widget

安装包：

```bash
npm install portable-ai-agent-widget
```

本地最快接法：

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  apiKey: "sk-your-api-key",
  selfAuth: true,
  routerPush: (route) => router.push(route),
});
```

这样就能先把链路跑通，不需要先从 API 直调开始。

如果你不走打包器，也可以直接用 IIFE：

```html
<script
  src="https://your-cdn.com/agent-widget.iife.js"
  data-backend-url="http://localhost:4096/api"
  data-api-key="sk-your-api-key"
  data-self-auth="true"
  data-mode="auto"
  data-stream="true"
></script>
```

## 生产环境推荐方式

生产环境建议改成 `selfAuth=false`，不要把长期 `apiKey` 直接下发到浏览器。

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  selfAuth: false,
  getToken: async () => {
    const response = await fetch("/internal/agent/token", {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("获取 Agent token 失败");
    }

    const data = await response.json();
    return {
      token: data.token,
      expiresIn: data.expiresIn,
    };
  },
  routerPush: (route) => router.push(route),
});
```

## CLI 能力说明

安装或卸载工作流：

```bash
webGenerate <platform> install
webGenerate <platform> uninstall
webGenerate install --platform <platform>
```

内置 MCP 模式：

```bash
webGenerate MCP
webGenerate MCP --root ./your-project
```

当前 MCP 工具包括：

- `list_routes`
- `search_routes`
- `get_page_doc`
- `list_page_docs`

## 为什么这套文档能同时服务两类 Agent

`webAIDocs/` 是这个项目最重要的桥梁。

- 对编程 Agent 来说，它是开发前的业务上下文
- 对运行时 Agent 来说，它是页面问答和页面动作的知识底座

所以你做一次文档生成，不只是“产出了一份说明书”，而是在给两个不同阶段的 Agent 同时补知识。

## 仓库结构

```text
.
├─ src/                     # 前端 Widget 源码
├─ dist/                    # 前端构建产物
├─ backend/                 # FastAPI 后端
├─ scripts/webGenerate.js   # CLI 与内置 MCP 入口
├─ templates/               # 各助手工作流模板
└─ webAIDocs/               # 业务知识文档
```

## 本地开发

```bash
npm install
npm run build
npm run dev
```

后端：

```bash
cd backend
pip install -r requirements.txt
python main.py
```

## 相关文档

- [README.md](./README.md)
- [QUICK_START.md](./QUICK_START.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PRINCIPLES.md](./PRINCIPLES.md)
- [backend/README.md](./backend/README.md)
- [backend/AUTH_GUIDE.md](./backend/AUTH_GUIDE.md)
