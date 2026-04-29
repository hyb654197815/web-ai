# portable-ai-agent-widget

这个包发布到 npm 后，最直接的用法是安装并使用 `webgenerate`。

## 安装

```bash
npm install portable-ai-agent-widget
```

如果你只是想直接执行命令，也可以不先安装，直接用：

```bash
npx portable-ai-agent-widget codex install
```

## `webgenerate` 是做什么的

`webgenerate` 只负责把知识库工作流安装到对应助手里，不直接扫描源码生成文档。

安装完成后：

- Codex 用 `$webGenerate .`
- Claude / OpenCode / Cursor / Copilot / Gemini / Trae 等用 `/webGenerate .`

## 常用命令

安装：

```bash
webgenerate codex install
webgenerate claude install
webgenerate opencode install
webgenerate copilot-cli install
webgenerate vscode-copilot install
webgenerate gemini install
webgenerate antigravity install
webgenerate cursor install
webgenerate trae install
webgenerate trae-cn install
```

卸载：

```bash
webgenerate <platform> uninstall
```

## 文档生成方式

安装后，在你的业务项目中触发：

```bash
/webGenerate .
/webGenerate . --update
```

Codex 中使用：

```bash
$webGenerate .
$webGenerate . --update
```

输出目录固定为项目根目录：

- `webAIDocs/routes.md`
- `webAIDocs/page-xxx.md`

## MCP Server

也可以启动一个只读 MCP Server，让支持 MCP 的 Agent 查询当前项目的 `webAIDocs/`：

```bash
webGenerate MCP
webgenerate MCP
webgenerate MCP --root ./your-project
```

它提供路由列表、路由搜索、页面文档读取和页面文档列表等 tools。

仓库根目录提供了默认 `mcp.json`，开发者可以基于它增加自己的 MCP Server 配置。

## 本地安装后的调用方式

如果你执行的是：

```bash
npm install portable-ai-agent-widget
```

那么推荐这样调用：

```bash
npx webgenerate codex install
```

或者：

```bash
npx portable-ai-agent-widget codex install
```

如果你希望直接全局运行 `webgenerate`，可以：

```bash
npm install -g portable-ai-agent-widget
webgenerate codex install
```

## 作为前端包使用

这个包也提供前端 Widget，可直接：

```js
import AIAgent from "portable-ai-agent-widget";
```

更完整的项目接入和架构说明请看 GitHub 仓库。
