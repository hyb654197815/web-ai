# portable-ai-agent-widget

给前端项目接入页面级 AI Agent 的工具包，包含两部分能力：

- 前端 Widget：页面问答、受控导航、当前页操作
- `webGenerate` CLI：把知识文档工作流安装到 Codex、Claude、Cursor、Gemini 等助手里

在线文档与演示：<https://hyb654197815.github.io/web-ai/>

如果你需要完整的后端接入、鉴权方案和项目架构，请看 GitHub 仓库主页。

## 安装

```bash
npm install portable-ai-agent-widget
```

如果你只是想临时执行 `webGenerate`，也可以直接：

```bash
npx portable-ai-agent-widget codex install
```

## 作为前端包使用

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  apiKey: "sk-your-api-key",
  selfAuth: true,
});
```

生产环境建议改成 `selfAuth=false`，由你自己的服务向前端返回短期 token。

## `webGenerate` 是做什么的

`webGenerate` 不直接扫描源码，而是先把工作流安装到你的助手里，再通过助手命令生成：

- `webAIDocs/routes.md`
- `webAIDocs/page-xxx.md`

安装后：

- Codex 用 `$webGenerate .`
- Claude / Cursor / Gemini / Copilot / Trae 等用 `/webGenerate .`

增量同步：

- Codex 用 `$webGenerate . --update`
- 其他助手用 `/webGenerate . --update`

## 常用命令

```bash
webGenerate codex install
webGenerate claude install
webGenerate cursor install
webGenerate gemini install
webGenerate trae install
```

也支持：

- `webGenerate <platform> uninstall`
- `webGenerate MCP`
- `webGenerate MCP --root ./your-project`

`MCP` 模式会启动一个只读 MCP Server，用于查询当前项目的 `webAIDocs/`。

## 本地调用方式

如果你是本地安装：

```bash
npx webGenerate codex install
```

如果你是全局安装：

```bash
npm install -g portable-ai-agent-widget
webGenerate codex install
```

## 更多文档

- GitHub 仓库：<https://github.com/hyb654197815/web-ai>
- 架构说明：<https://github.com/hyb654197815/web-ai/blob/main/ARCHITECTURE.md>
- 快速开始：<https://github.com/hyb654197815/web-ai/blob/main/QUICK_START.md>
