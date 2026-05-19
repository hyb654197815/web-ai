# Portable AI Agent Widget

[简体中文](https://github.com/hyb654197815/web-ai/blob/main/README.zh-CN.md)

`portable-ai-agent-widget` helps teams use one generated document set in two places:

1. Improve coding agents before they change frontend code.
2. Onboard a runtime frontend agent quickly through admin upload and widget integration.

## What You Install From npm

This package includes:

- `webGenerate` CLI for assistant workflow installation
- frontend widget package for runtime integration

The runtime backend lives in the GitHub repo and is part of the recommended setup flow.

## Core Value

Generate `webAIDocs/routes.md` and `page-xxx.md` in the real business frontend repo, then reuse those docs across the whole stack.

- For coding agents: the docs explain routes, forms, flows, and business intent
- For runtime agents: the same docs can be uploaded as a ZIP in the admin console and used immediately by the frontend AI agent

## Quick Start

### 1. Install the assistant workflow

```bash
npx portable-ai-agent-widget codex install
```

Other supported platforms:

```bash
npx portable-ai-agent-widget claude install
npx portable-ai-agent-widget opencode install
npx portable-ai-agent-widget copilot-cli install
npx portable-ai-agent-widget vscode-copilot install
npx portable-ai-agent-widget gemini install
npx portable-ai-agent-widget cursor install
npx portable-ai-agent-widget trae install
npx portable-ai-agent-widget trae-cn install
npx portable-ai-agent-widget antigravity install
```

### 2. Generate docs in the business repo

After installation, run the assistant trigger inside the real frontend project:

- Codex: `$webGenerate .`
- Most other assistants: `/webGenerate .`

Incremental sync after page changes:

- Codex: `$webGenerate . --update`
- Most other assistants: `/webGenerate . --update`

Output:

```text
webAIDocs/
  routes.md
  page-xxx.md
```

### 3. Upload docs to the runtime admin

Compress the generated `webAIDocs/` folder as a ZIP, then upload it in the admin console's `Knowledge` page after you configure a model.

This is the fastest non-API onboarding path.

### 4. Integrate the widget

```bash
npm install portable-ai-agent-widget
```

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  apiKey: "sk-your-api-key",
  selfAuth: true,
  routerPush: (route) => router.push(route),
});
```

## CLI Reference

Install or remove assistant workflows:

```bash
webGenerate <platform> install
webGenerate <platform> uninstall
webGenerate install --platform <platform>
```

Supported `<platform>` values:

- `claude`
- `codex`
- `opencode`
- `copilot-cli`
- `vscode-copilot`
- `gemini`
- `antigravity`
- `cursor`
- `trae`
- `trae-cn`

Built-in MCP mode:

```bash
webGenerate MCP
webGenerate MCP --root ./your-project
```

## Learn More

- GitHub: <https://github.com/hyb654197815/web-ai>
- English repo README: <https://github.com/hyb654197815/web-ai/blob/main/README.md>
- Chinese repo README: <https://github.com/hyb654197815/web-ai/blob/main/README.zh-CN.md>
