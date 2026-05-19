# Portable AI Agent Widget

[![npm version](https://img.shields.io/npm/v/portable-ai-agent-widget)](https://www.npmjs.com/package/portable-ai-agent-widget)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-43853d)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[简体中文](./README.zh-CN.md)

Docs and demo: <https://hyb654197815.github.io/web-ai/>

`portable-ai-agent-widget` is a page-level AI agent stack for business frontends.

It is built around one shared document contract: `webAIDocs/`.

Those documents serve two jobs:

1. They help coding agents understand routes, forms, and page behavior before they modify frontend code.
2. They can be uploaded into the runtime admin so the frontend AI agent can answer business questions and act on the page faster.

## What This Project Does

This project combines three parts:

- `webGenerate`: installs a workflow into coding assistants so they can generate `webAIDocs/routes.md` and `page-xxx.md`
- FastAPI backend: handles auth, model routing, MCP, billing, sessions, and hosted knowledge docs
- frontend widget: plugs into your web app for knowledge Q&A, controlled navigation, and current-page actions

If your product has admin pages, dashboards, operations systems, or other route-driven business pages, this project gives you a practical way to turn page structure into reusable agent knowledge.

## Two Core Capabilities

### 1. Improve coding agents with business docs

`webGenerate` turns a real frontend project into business-facing docs:

- `routes.md` gives an index of pages and route mapping
- `page-xxx.md` describes page purpose, fields, buttons, flows, and operational notes

Once those files exist, coding assistants can read them first and then change code with much better business context.

### 2. Reuse the same docs for fast frontend-agent onboarding

The generated docs are not only for IDE workflows.

You can compress the whole `webAIDocs/` folder as a ZIP, upload it in the admin console, configure a model, and immediately give the runtime agent a business knowledge base without building a custom retrieval pipeline first.

## Workflow In One View

1. Install the `webGenerate` workflow into the coding assistant your team uses.
2. Run the assistant command inside the real frontend business repo.
3. Generate `webAIDocs/routes.md` and `page-xxx.md`.
4. Compress the generated `webAIDocs/` folder into a ZIP file.
5. Start the backend and open the admin console.
6. Configure at least one model.
7. Upload the ZIP in `Knowledge`.
8. Create an API key for local widget integration.
9. Install the frontend package and initialize the widget.

This is the recommended quick start because it avoids raw REST setup at the beginning. You can get value first through the assistant workflow, admin UI, and widget integration.

## Quick Start

### Requirements

- Node.js `>= 18`
- Python `3.11+` recommended for the backend

### 1. Install `webGenerate` into your coding assistant

Use one of the supported platform commands below from any terminal.

| Assistant | Install command | Trigger in chat | Incremental sync | Uninstall |
| --- | --- | --- | --- | --- |
| Codex | `npx portable-ai-agent-widget codex install` | `$webGenerate .` | `$webGenerate . --update` | `npx portable-ai-agent-widget codex uninstall` |
| Claude Code | `npx portable-ai-agent-widget claude install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget claude uninstall` |
| OpenCode | `npx portable-ai-agent-widget opencode install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget opencode uninstall` |
| GitHub Copilot CLI | `npx portable-ai-agent-widget copilot-cli install` | Ask Copilot to run `/webGenerate .` | Ask Copilot to run `/webGenerate . --update` | `npx portable-ai-agent-widget copilot-cli uninstall` |
| VS Code Copilot Chat | `npx portable-ai-agent-widget vscode-copilot install` | Ask Copilot to run `/webGenerate .` | Ask Copilot to run `/webGenerate . --update` | `npx portable-ai-agent-widget vscode-copilot uninstall` |
| Gemini CLI | `npx portable-ai-agent-widget gemini install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget gemini uninstall` |
| Cursor | `npx portable-ai-agent-widget cursor install` | Ask Cursor Agent to run `/webGenerate .` | Ask Cursor Agent to run `/webGenerate . --update` | `npx portable-ai-agent-widget cursor uninstall` |
| Trae | `npx portable-ai-agent-widget trae install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget trae uninstall` |
| Trae CN | `npx portable-ai-agent-widget trae-cn install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget trae-cn uninstall` |
| Antigravity | `npx portable-ai-agent-widget antigravity install` | `/webGenerate .` | `/webGenerate . --update` | `npx portable-ai-agent-widget antigravity uninstall` |

CLI parameter notes:

- `<platform>` can be `claude`, `codex`, `opencode`, `copilot-cli`, `vscode-copilot`, `gemini`, `antigravity`, `cursor`, `trae`, or `trae-cn`
- action is `install` or `uninstall`
- alternative form is also supported: `webGenerate install --platform codex`

Assistant trigger parameter notes:

- `[path]` is the project root to scan; use `.` in most cases
- `--update` means incremental sync after code changes
- if `routes.md` is missing or too broken, the workflow falls back from incremental mode to a full regeneration

### 2. Generate docs inside the real business frontend repo

Go to your actual frontend product repo and run the assistant trigger there, not in this widget repo.

Expected output:

```text
webAIDocs/
  routes.md
  page-xxx.md
  page-yyy.md
```

What these files do:

- `routes.md`: route index for the whole system
- `page-xxx.md`: page-level business knowledge for forms, actions, steps, and notes

### 3. Compress `webAIDocs/` as a ZIP

Create a ZIP from the entire `webAIDocs/` folder, not only from `routes.md`.

That ZIP is the fastest way to move business knowledge from the frontend repo into the runtime admin.

### 4. Start the backend

```bash
cd backend
pip install -r requirements.txt

# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

At minimum, set:

```env
ADMIN_PASSWORD=your-strong-password
JWT_SECRET_KEY=your-long-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=15
ENABLE_ADMIN_BACKEND=true
```

Then start the service:

```bash
python main.py
```

Default URLs:

- backend: `http://localhost:4096`
- admin console: `http://localhost:4096/admin`

### 5. Configure the runtime in the admin console

Open the admin console and do this order first:

1. Sign in with the admin account
2. Open `Models` and configure at least one working model
3. Open `Knowledge` and upload the `webAIDocs` ZIP
4. Open `API Keys` and create a key for local development
5. Optionally configure `Tools & MCP`

Why this order matters:

- no model means the runtime agent cannot answer
- no uploaded docs means the runtime agent only has weak business context
- ZIP upload is safer than copying files one by one in multi-repo setups

The admin knowledge module supports ZIP upload, single-file upload, online editing, rename, and delete.

### 6. Integrate the frontend widget

Install the package:

```bash
npm install portable-ai-agent-widget
```

For the fastest local integration, initialize the widget with the API key you created in the admin console:

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  apiKey: "sk-your-api-key",
  selfAuth: true,
  routerPush: (route) => router.push(route),
});
```

This quick start is intentionally widget-first. You do not need to start with direct REST calls.

If you prefer a no-bundler embed, use the IIFE build:

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

## Production Recommendation

For production, switch to `selfAuth=false` and return short-lived tokens from your own backend instead of exposing the long-lived API key to the browser.

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
      throw new Error("Failed to fetch agent token");
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

## CLI Reference

Install or uninstall assistant workflows:

```bash
webGenerate <platform> install
webGenerate <platform> uninstall
webGenerate install --platform <platform>
```

Run the built-in MCP server against a doc set:

```bash
webGenerate MCP
webGenerate MCP --root ./your-project
```

The built-in MCP exposes these tools:

- `list_routes`
- `search_routes`
- `get_page_doc`
- `list_page_docs`

## Why The Same Docs Work For Both Agent Types

`webAIDocs/` is the bridge between development-time agents and runtime agents.

- Coding agents use it as business context before refactoring or implementing frontend features.
- Runtime agents use the hosted copy as the knowledge base behind page Q&A, route guidance, and current-page actions.

That means one documentation pass can improve both coding quality and user-facing agent behavior.

## Repo Structure

```text
.
├─ src/                     # frontend widget source
├─ dist/                    # frontend build output
├─ backend/                 # FastAPI backend
├─ scripts/webGenerate.js   # CLI and built-in MCP entry
├─ templates/               # assistant workflow templates
└─ webAIDocs/               # business knowledge docs
```

## Local Development

```bash
npm install
npm run build
npm run dev
```

Backend:

```bash
cd backend
pip install -r requirements.txt
python main.py
```

## Related Docs

- [README.zh-CN.md](./README.zh-CN.md)
- [QUICK_START.md](./QUICK_START.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PRINCIPLES.md](./PRINCIPLES.md)
- [backend/README.md](./backend/README.md)
- [backend/AUTH_GUIDE.md](./backend/AUTH_GUIDE.md)

## Publish

```bash
npm run build
npm pack --dry-run
npm publish
```

The publish flow switches `README.md` to the npm version before packing, then restores the GitHub version afterward.
