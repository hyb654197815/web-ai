# Portable AI Agent Widget

一个面向前端项目的可嵌入式 AI Agent 方案，包含两部分能力：

1. 运行时能力：在业务站点中嵌入前端 Agent Widget，通过后端知识库回答“当前页怎么操作”“表单怎么填写”“下一步做什么”，并在用户明确要求时执行安全的路由跳转。
2. 知识库能力：通过 `gen-docs` 脚本或提示词，把业务前端项目自动整理成 `routes.md + page-xxx.md` 知识文档，并以 Skill 的形式复用到 Codex、OpenCode、Claude Code、Cursor、Trae 等工具中。

本仓库适合以下场景：

- 给已有后台/中台/运营系统增加“页面问答 + 路由跳转”型 AI 助手
- 为大型前端项目建立可持续维护的页面知识库
- 让 AI 编码工具先按业务文档定位页面，再实施代码修改
- 在不同 Agent 工具之间复用同一套前端项目知识

## 核心能力

- 前端 Widget 只保留两类动作：页面问答、`navigate` 路由跳转
- 后端基于 FastAPI + LangChain，自动读取知识库并返回自然语言或导航动作
- `gen-docs` 支持 `OpenCode / Codex / Claude Code` 三种 CLI runner
- 对 `Cursor / Trae` 这类 IDE Agent，支持 `--print-prompt` 输出可直接粘贴执行的提示词
- 支持把 Skill 复制到目标项目中，让 AI 工具基于业务文档定位代码并直接修改
- 支持全量建库和增量同步两种知识文档更新模式

## 架构概览

### 运行时链路

1. 前端页面集成 `AIAgent`
2. 用户提问后，Widget 把消息和当前 `pathname/hash/href/title` 发给后端
3. 后端从知识库中按需读取 `routes.md` 和相关 `page-xxx.md`
4. 后端返回：
   - 自然语言答案
   - 或 `{ action: "navigate", params: { route } }`
5. 前端只执行受控的 `navigate`，不会执行脚本、DOM 注入或自动填表

### 知识库链路

1. `scripts/generate-docs.js` 根据 `--runner` 选择 OpenCode、Codex 或 Claude Code
2. 脚本自动把 `widget-knowledge-*` Skill 安装到当前工作区对应目录
3. 调用 Skill 对目标前端项目做全量分析或增量同步
4. 生成结果写入 `widget-knowledge-system/references/`
5. 后端和其他 Agent 再复用这套知识文档做页面问答、代码定位和业务改动

## 目录设计

当前仓库的职责可以按“运行时 + 生成器 + 技能知识库”理解：

```text
.
├─ src/
│  └─ agent-widget.js                  # 前端 Widget 源码，构建产物来自这里
├─ dist/
│  ├─ agent-widget.js                  # ES Module 版本，适合模块化集成
│  └─ agent-widget.iife.js             # IIFE 版本，适合 CDN / script 直连
├─ backend/
│  ├─ main.py                          # FastAPI 入口
│  ├─ config.py                        # 知识库目录、端口、CORS、模型配置
│  ├─ agent_*.py                       # 上下文拼装、LLM 适配、输出清洗等
│  ├─ prompts/                         # 后端 system/user prompt
│  └─ README.md                        # 后端单独说明
├─ scripts/
│  └─ generate-docs.js                 # 文档生成总控脚本，入口为 npm run gen-docs
├─ prompts/
│  ├─ generate-docs-*.txt              # runner 模式提示词模板
│  ├─ generate-docs-direct-*.txt       # Cursor / Trae 等直跑提示词模板
│  └─ widget-system.txt                # 运行时问答系统提示词
├─ .opencode/skills/
├─ .codex/skills/
├─ .claude/skills/
│  └─ widget-knowledge-*/              # 三套 Skill 与生成后的 references
├─ .opencode-gen-target/               # 跨项目生成时的临时软链接 / junction
├─ package.json                        # 前端构建与 gen-docs 脚本入口
└─ vite.config.js                      # 打包 ESM + IIFE 两个前端分发版本
```

### 三个 Skill 的职责

- `widget-knowledge-generator`
  - 用于首次建库、全量重建、重构后重新扫描
- `widget-knowledge-updater`
  - 用于增量同步，只更新受影响页面和路由文档
- `widget-knowledge-system`
  - 用于业务需求定位代码。AI 工具先读 `routes.md` 找页面入口，再按需读 `page-xxx.md`，最后进入真实源码实施改动

## 快速开始

### 1. 安装前端依赖并构建 Widget

```bash
npm install
npm run build
```

构建后会得到：

- `dist/agent-widget.js`
- `dist/agent-widget.iife.js`

### 2. 启动后端

方式 A：本地 Python 启动

```bash
cd backend
pip install -r requirements.txt
python main.py
```

方式 B：Docker 启动

```bash
docker build -t web-ai-backend .
docker run --rm -p 4096:4096 --env-file backend/.env web-ai-backend
```

默认后端地址：`http://localhost:4096/api`

容器镜像会内置 `.opencode`、`.claude`、`.codex` 和 `backend`，后端会继续按环境变量和默认目录自动寻找知识库。

### 3. 本地调试

```bash
npm run dev
```

本地示例地址：

- `http://localhost:5173/index.html`
- `http://localhost:5173/demo/index.html`

## 工具安装入口

`gen-docs` 的直连 runner 只支持 `opencode | codex | claude`。`Cursor / Trae` 走“提示词直跑”或“复制 Skill 到业务项目”模式，不是 `--runner` 的合法值。

README 推荐优先使用 `Codex CLI` 作为生成与维护知识库的主工具，其次再考虑 `Claude Code`；`OpenCode` 仍然受支持，并保留为脚本默认值，主要用于兼容已有流程。

| 工具 | 推荐度 | 在本项目中的用法 | 官方入口 |
| --- | --- | --- | --- |
| Codex CLI | 首选推荐 | CLI runner，用于 `npm run gen-docs -- --runner codex` | https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started |
| OpenCode | 次选推荐 | CLI runner，用于 `npm run gen-docs -- --runner opencode` | https://opencode.ai/docs/ |
| Claude Code | 兼容推荐 | CLI runner，用于 `npm run gen-docs -- --runner claude` | https://docs.anthropic.com/en/docs/claude-code/getting-started |
| Cursor | 推荐用于提示词直跑和业务改代码 | 提示词直跑、项目规则 / 文档读取型使用 | https://www.cursor.com/downloads / https://docs.cursor.com/context/rules |
| Trae | 推荐用于提示词直跑和业务改代码 | 提示词直跑、Agent Skills / 项目规则型使用 | https://www.trae.ai/download / https://www.trae.ai/blog |

## 使用 `gen-docs` 生成项目知识文档

### 它会做什么

执行 `npm run gen-docs` 时，脚本会自动完成以下事情：

1. 解析参数并确定目标项目路径
2. 选择对应 runner
3. 把三套 `widget-knowledge-*` Skill 安装到当前工作区对应目录
4. 为目标项目生成 prompt
5. 当目标项目不在当前工作区内时，自动创建 `.opencode-gen-target`
   - Windows 下创建的是 `junction`
   - macOS / Linux 下创建的是软链接
6. 执行全量或增量文档生成
7. 如有需要，再做一次“检查补全”
8. 结束时自动移除本次临时链接

### 全量生成

适合首次建库、历史文档失真、发生大范围重构：

```bash
npm run gen-docs -- .
```

虽然脚本默认 runner 仍然是 `opencode`，但 README 推荐你在实际使用时优先显式指定 `--runner codex`，其次再考虑 `--runner claude`。

推荐写法：

```bash
# 首选推荐：Codex CLI
npm run gen-docs -- --runner codex D:\code\admin-client

# 次选推荐：Claude Code
npm run gen-docs -- --runner claude D:\code\admin-client
```

兼容写法：

```bash
# OpenCode（脚本默认值，兼容保留）
npm run gen-docs -- --runner opencode D:\code\admin-client
```

### 增量同步

适合日常迭代后只同步受影响文档：

```bash
npm run gen-docs -- --runner codex --mode incremental --changed src/views/admin/users/index.vue --changed src/components/UserDialog.vue D:\code\admin-client
```

如果暂时没有文件列表，也可以直接给业务范围：

```bash
npm run gen-docs -- --runner codex --mode incremental --scope "权限管理新增角色路由与新增弹窗" D:\code\admin-client
```

### 直接输出提示词给 Cursor / Trae / 通用 IDE Agent

当你不想本地直调 CLI，而是想把 prompt 粘贴到 Cursor、Trae、Claude Code Chat、Codex Chat 中执行时，使用 `--print-prompt`：

```bash
# 输出全量生成 prompt
npm run gen-docs -- --runner codex --print-prompt D:\code\admin-client

# 输出增量同步 prompt
npm run gen-docs -- --runner codex --mode incremental --changed src/views/admin/users/index.vue --print-prompt D:\code\admin-client
```

这条 prompt 会自动带上：

- `analyze_path`：目标项目路径
- `workspace_root`：当前仓库路径
- `knowledge_skill_root`：本次要写入的 Skill 根目录
- `references_dir`：知识文档输出目录
- 本地 `SKILL.md` 文件路径

对 `Cursor / Trae` 这类工具，推荐的使用流程如下：

1. 在当前仓库执行 `--print-prompt`
2. 打开 Cursor 或 Trae，并进入当前仓库工作区
3. 把输出的 prompt 直接粘贴到对话框
4. 如果目标项目在工作区外，Agent 会按 prompt 先创建或复用 `.opencode-gen-target`
5. 生成完成后，Agent 会删除本次任务创建的临时链接

## 参数说明

| 参数 | 别名 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `<projectRoot>` | 无 | 要分析的前端项目根目录 | `.` |
| `--runner <name>` | `--runtime`, `-r` | 运行器，支持 `opencode | codex | claude`；README 首选推荐 `codex`，次选 `claude` | `opencode` |
| `--model <name>` | `-m` | 指定模型名，交给底层 CLI | 使用各 CLI 默认模型 |
| `--mode <name>` | 无 | `full` 或 `incremental` | `full` |
| `--changed <file>` | `-c` | 增量模式下的变更文件，可重复传入 | 空 |
| `--scope <text>` | `-s` | 增量模式下的业务范围说明 | 空 |
| `--verify` | 无 | 强制在主流程后执行一次检查补全 | `full` 自动开，`incremental` 默认关 |
| `--skip-verify` | `--no-verify` | 跳过检查补全 | 关闭 |
| `--print-prompt` | `--prompt-only` | 只输出提示词，不直接调用 CLI | `false` |
| `--global-config` | 无 | 仅对 OpenCode 生效，使用全局配置而非 `.opencode-xdg` 隔离配置 | `false` |

### 常用组合示例

```bash
# 首选推荐：指定 Codex 模型
npm run gen-docs -- --runner codex D:\code\admin-client

# 次选推荐：OpenCode 兼容模式
npm run gen-docs -- --runner opencode --global-config -m nvidia/minimaxai/minimax-m2.1 D:\code\admin-client

# 次选推荐：指定 Claude Code 模型
npm run gen-docs -- --runner claude D:\code\admin-client

# 推荐：增量同步后再做一次检查补全
npm run gen-docs -- --runner codex --mode incremental --changed src/views/admin/users/index.vue --verify D:\code\admin-client
```

## 输出目录与环境变量

### 默认输出目录

- `--runner opencode` 时输出到 `.opencode/skills/widget-knowledge-system/references/`
- `--runner codex` 时输出到 `.codex/skills/widget-knowledge-system/references/`
- `--runner claude` 时输出到 `.claude/skills/widget-knowledge-system/references/`

### 可覆盖的环境变量

| 环境变量 | 作用 |
| --- | --- |
| `WIDGET_DOCS_RUNNER` | 默认 runner |
| `WIDGET_SKILLS_DIR` | 显式指定三套 Skill 模板源目录 |
| `WIDGET_KNOWLEDGE_DIR` | 直接指定知识文档输出目录 |
| `WIDGET_KNOWLEDGE_SKILL_DIR` | 指定 `widget-knowledge-system` Skill 根目录 |

后端也会优先按这些变量自动寻找知识库，不要求固定只能放在 `.opencode/skills/`。

## 软链接 / junction 生命周期

当目标项目不在当前仓库目录内时，脚本会自动创建 `.opencode-gen-target` 指向目标项目，避免某些 Agent 工具无法直接读取工作区外目录。

### 自动模式

- `npm run gen-docs` 直调 CLI 时：脚本自动创建并在 `finally` 中清理
- `--print-prompt` 模式：prompt 会要求外部 Agent 在需要时创建，并在结束前删除本次创建的链接

### 手动排障

PowerShell：

```powershell
New-Item -ItemType Junction -Path .opencode-gen-target -Target D:\code\admin-client
Remove-Item .opencode-gen-target
```

macOS / Linux：

```bash
ln -s /path/to/admin-client .opencode-gen-target
rm .opencode-gen-target
```

如果目标项目本来就在当前仓库内，则不会创建链接。

## 复制 Skill 到业务项目，并让 AI 直接改代码

这是本仓库非常重要的第二种用法：不是“生成文档”，而是“把 Skill 带到业务项目里，让 AI 先定位业务页面，再实施改动”。

### 场景 1：只想让 AI 根据业务知识定位并修改代码

只需要复制 `widget-knowledge-system`，以及它的 `references/` 文档：

以下示例以 `.codex/skills` 为来源目录；如果你当前的知识库在 `.opencode/skills` 或 `.claude/skills`，把源路径替换掉即可。

```powershell
New-Item -ItemType Directory -Force -Path D:\code\admin-client\.ai\skills | Out-Null
Copy-Item -Recurse .\.codex\skills\widget-knowledge-system D:\code\admin-client\.ai\skills\
```

推荐目录：

- Codex 项目：`<project>/.codex/skills/widget-knowledge-system/`
- Claude Code 项目：`<project>/.claude/skills/widget-knowledge-system/`
- OpenCode 项目：`<project>/.opencode/skills/widget-knowledge-system/`
- Cursor / Trae / 通用 IDE Agent：`<project>/.ai/skills/widget-knowledge-system/`

然后在目标项目里给出类似提示词：

```text
请先阅读 .ai/skills/widget-knowledge-system/SKILL.md。
定位知识文档时，先看 .ai/skills/widget-knowledge-system/references/routes.md，
再按需读取对应的 page-xxx.md。

业务需求：
在用户管理页新增“批量禁用”按钮，并补充确认弹窗与接口提交逻辑。

要求：
1. 先定位页面入口文件和相关弹窗/接口文件
2. 再实施代码修改
3. 输出变更文件清单与原因
```

这条链路最适合：

- Bug 修复
- 业务页面改造
- 表单、列表、弹窗、权限、接口联调
- 让 Cursor / Trae 先懂业务再改代码

### 场景 2：希望目标项目自己也能生成或同步知识文档

这种情况下，建议把三套 Skill 都复制进去：

以下示例同样以 `.codex/skills` 为来源目录；如果你的源目录来自 `.opencode/skills` 或 `.claude/skills`，替换前缀即可。

```powershell
New-Item -ItemType Directory -Force -Path D:\code\admin-client\.ai\skills | Out-Null
Copy-Item -Recurse .\.codex\skills\widget-knowledge-generator D:\code\admin-client\.ai\skills\
Copy-Item -Recurse .\.codex\skills\widget-knowledge-updater D:\code\admin-client\.ai\skills\
Copy-Item -Recurse .\.codex\skills\widget-knowledge-system D:\code\admin-client\.ai\skills\
```

然后有两种做法：

1. 继续用本仓库的 `npm run gen-docs`，把目标项目作为 `<projectRoot>` 传入
2. 或在 Cursor / Trae 中直接让 Agent 读取这些 `SKILL.md`，按你的业务需求生成 / 更新文档

### 对 Cursor / Trae 的建议

Cursor 和 Trae 在本项目中推荐走两种模式：

1. `--print-prompt`
   - 最稳妥，适合一次性全量或增量生成
2. 复制 Skill 到业务项目
   - 最适合长期维护、按业务需求改代码

也就是说：

- 文档生成，优先 `--print-prompt`
- 业务改代码，优先“复制 `widget-knowledge-system` 到目标项目”

## 前端集成

本项目前端集成支持两种方式：

1. 模块化集成
2. CDN / `<script>` 直连集成

### 集成前提

无论哪种方式，都需要准备一个兼容的后端接口：

- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/session`
- `POST /api/session/{sessionId}/message`
- `GET /api/health`

默认前端配置会请求：`http://localhost:4096/api`

### 方式一：模块化集成

适合 Vue、React、Vite、Webpack、Rspack、Next.js 等工程化项目。

#### 步骤 1：构建并引入产物

先在本仓库执行：

```bash
npm install
npm run build
```

然后在你的前端项目中引入 `dist/agent-widget.js`：

```js
import AIAgent from "./vendor/portable-ai-agent-widget/dist/agent-widget.js";

AIAgent.init({
  backendUrl: "https://your-agent-service.com/api",
  routerPush: (route) => {
    router.push(route);
  }
});
```

如果你后续把本项目发布到 npm，也可以改成包名导入；当前仓库本身已经提供了标准 ESM 构建产物。

#### 步骤 2：发送消息

```js
await AIAgent.sendMessage("打开设置页");

await AIAgent.sendMessage("注册表单应该怎么填写？");

```

#### 步骤 3：管理会话

```js
await AIAgent.startNewSession();

const sessionId = AIAgent.getSessionId();
AIAgent.setSessionId(sessionId);
```

### 方式二：CDN / script 直连

适合传统多页应用、静态站点、低代码平台、后端模板页，或者不方便引入构建系统的项目。

#### 步骤 1：把 IIFE 产物发布到你的 CDN

发布文件：

- `dist/agent-widget.iife.js`

#### 步骤 2：在页面中直接引入

```html
<script
  src="https://your-cdn.com/agent-widget.iife.js"
  data-backend-url="https://your-agent-service.com/api"
  data-mode="auto"
  data-chat-path="/chat"
  data-stream-path="/chat/stream"
  data-stream="true"
></script>
```

当脚本检测到 `data-backend-url` 时，会自动执行 `AIAgent.init(...)`。

#### 步骤 3：按需手动调用

```html
<script>
  window.AIAgent.sendMessage("打开用户管理页");
</script>
```

#### 支持的 `data-*` 属性

| 属性 | 说明 |
| --- | --- |
| `data-backend-url` | 后端 API 基础地址，必填 |
| `data-api-base` | `data-backend-url` 的兼容别名 |
| `data-mode` | `auto | crewai | opencode` |
| `data-chat-path` | 聊天接口路径，默认 `/chat` |
| `data-stream-path` | SSE 接口路径，默认 `/chat/stream` |
| `data-stream` | 是否启用流式，`false` 时关闭 |
| `data-session-id` | 初始会话 ID |

## `AIAgent` API

### 对外方法

- `AIAgent.init(config)`
- `AIAgent.sendMessage(message, options?)`
- `AIAgent.execute(payload, options?)`
- `AIAgent.startNewSession(options?)`
- `AIAgent.resetSession(options?)`
- `AIAgent.getSessionId()`
- `AIAgent.setSessionId(sessionId)`
- `AIAgent.getConfig()`

### `init(config)` 支持字段

| 字段 | 说明 |
| --- | --- |
| `backendUrl` | 后端 API 基础地址 |
| `routerPush(route)` | 路由跳转函数；有 SPA 路由时强烈建议传入 |
| `mode` | `auto | crewai | opencode` |
| `chatPath` | 聊天接口路径，默认 `/chat` |
| `stream` | 是否启用 SSE，默认 `true` |
| `streamPath` | 流式接口路径，默认 `/chat/stream` |
| `sessionId` | 初始会话 ID |
| `requestTimeoutMs` | 请求超时，单位毫秒 |
| `headers` | 额外请求头 |
| `debug` | 是否输出调试日志 |

兼容旧字段：

- `apiBase -> backendUrl`
- `router.push -> routerPush`

### `mode` 的实际含义

| mode | 行为 |
| --- | --- |
| `auto` | 先走 `/chat` 或 `/chat/stream`，遇到 404/405 再回退到 Session API |
| `crewai` | 始终走 `/chat` 和 `/chat/stream` |
| `opencode` | 始终走 `/session` 与 `/session/{id}/message` |

## 前后端协议

### 导航响应

```json
{
  "action": "navigate",
  "params": {
    "route": "/user/settings"
  },
  "message": "正在跳转到设置页面..."
}
```

### 问答响应

```json
{
  "message": "注册页需要依次填写用户名、邮箱、密码和确认密码，确认密码必须与密码一致。"
}
```

### 请求体示例

```json
{
  "message": "打开设置页",
  "sessionId": "optional-session-id",
  "context": {
    "pathname": "/current/path"
  }
}
```

前端会自动透传：

- `pathname`
- `hash`
- `href`
- `title`

不会再采集：

- DOM 快照
- 页面注入脚本
- 自动填表数据

## 安全边界

- 前端只允许执行 `navigate`
- 后端输出会做动作归一化与危险内容过滤
- 禁止返回脚本、DOM 操作、自动提交表单等可执行指令
- 输入消息有长度限制与危险模式拦截

## 后端部署说明

### 关键环境变量

| 变量 | 说明 |
| --- | --- |
| `NVIDIA_API_KEY` / `OPENAI_API_KEY` | 模型 API Key |
| `OPENAI_API_BASE` | OpenAI 兼容接口地址 |
| `OPENAI_MODEL_NAME` | 模型名称 |
| `WIDGET_KNOWLEDGE_DIR` | 显式指定知识文档目录 |
| `WIDGET_KNOWLEDGE_SKILL_DIR` | 显式指定 `widget-knowledge-system` 根目录 |
| `WIDGET_SKILLS_DIR` | 显式指定 skills 目录 |
| `CORS_ORIGINS` | 允许的前端来源，逗号分隔 |
| `HOST` | 服务监听地址，默认 `0.0.0.0` |
| `PORT` | 后端端口，默认 `4096` |

### 启动命令

本地 Python 启动：

```bash
cd backend
pip install -r requirements.txt
python main.py
```

Docker 启动：

```bash
docker build -t web-ai-backend .
docker run --rm -p 4096:4096 --env-file backend/.env web-ai-backend
```

如果不想使用 `--env-file`，也可以直接逐个传入环境变量：

```bash
docker run --rm -p 4096:4096 ^
  -e OPENAI_API_KEY=your_api_key ^
  -e OPENAI_API_BASE=https://your-openai-compatible-base ^
  -e OPENAI_MODEL_NAME=your_model_name ^
  -e CORS_ORIGINS=http://localhost:5173 ^
  web-ai-backend
```

如果你修改了 `PORT`，请同时调整容器内环境变量和端口映射，例如：

```bash
docker run --rm -p 8080:8080 -e PORT=8080 --env-file backend/.env web-ai-backend
```

说明：

- `Dockerfile` 位于仓库根目录，需要在项目根目录执行 `docker build`
- 镜像会复制 `.opencode`、`.claude`、`.codex`、`backend`
- `backend/.env` 不会打进镜像，适合通过 `docker run --env-file backend/.env` 在运行时注入

后端会按以下顺序寻找知识库：

1. `WIDGET_KNOWLEDGE_DIR`
2. `WIDGET_KNOWLEDGE_SKILL_DIR/references`
3. `WIDGET_SKILLS_DIR/widget-knowledge-system/references`
4. `.opencode/.codex/.claude` 默认目录
5. `knowledge/`
