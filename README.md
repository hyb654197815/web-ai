# Portable AI Agent Widget

[![npm version](https://img.shields.io/npm/v/portable-ai-agent-widget)](https://www.npmjs.com/package/portable-ai-agent-widget)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-43853d)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

在线文档与演示：<https://hyb654197815.github.io/web-ai/>

一个面向后台、中台、运营系统的页面级 AI Agent 方案。

它把这件事拆成三层：

- 前端 Widget：负责承接对话、接收受控动作
- FastAPI 后端：负责鉴权、知识检索、模型决策、MCP 管理
- `webGenerate` 工作流：负责生成 `webAIDocs/routes.md` 和 `page-xxx.md`

适合“页面结构清晰、业务流程固定、希望 AI 能回答页面问题并辅助操作”的 Web 应用。

## 核心能力

- 页面问答：基于当前路由和页面知识文档回答业务问题
- 受控导航：返回 `navigate` 动作，由前端路由执行
- 当前页操作：返回 `form` 动作，用于表单、筛选、按钮、分页等页面交互
- 知识文档复用：统一读取 `webAIDocs/`，可同时服务 Widget、Agent、IDE 工作流

## 安全边界

- 前端只执行白名单动作，不执行任意脚本
- 不依赖 DOM 注入，不把模型工具能力直接暴露给浏览器
- 生产环境推荐 `selfAuth=false`，由你自己的服务下发短期 token

## 为什么这个项目适合做开源接入层

- 接入简单：前端只需要初始化一个 `AIAgent`
- 能力可控：前端动作协议固定，不把“任意自动化”带进线上页面
- 知识可维护：页面知识落在 `webAIDocs/`，可随业务演进持续更新
- 架构清晰：前端、后端、知识文档工作流职责分离

## 标准流程

高质量问答依赖高质量 `webAIDocs/`。如果没有先生成并放回仓库，后端虽然能启动，但 Agent 的页面理解和业务回答质量会明显下降。

推荐按下面顺序接入：

1. 用 `webGenerate` 给你的编程助手安装工作流
2. 在业务项目里运行 `webGenerate` 生成 `webAIDocs/routes.md` 和 `page-xxx.md`
3. 把生成好的 `webAIDocs/` 复制回当前仓库，供后端 Agent 读取
4. 启动后端，配置管理员、API Key、模型和 MCP
5. 在前端项目中接入 Widget

## 快速开始

### 依赖要求

- Node.js `>= 18`
- Python `3.11+` 推荐

### 1. 安装 `webGenerate` 工作流

例如为 Codex 安装：

```bash
npx portable-ai-agent-widget codex install
```

也可以安装到其他助手：

```bash
npx portable-ai-agent-widget claude install
npx portable-ai-agent-widget cursor install
npx portable-ai-agent-widget gemini install
```

### 2. 生成 `webAIDocs/`

安装完成后，在你的业务项目中触发：

- Codex：`$webGenerate .`
- Claude / Cursor / Gemini / Trae / Copilot 等：`/webGenerate .`

增量同步：

- Codex：`$webGenerate . --update`
- 其他助手：`/webGenerate . --update`

固定输出：

- `webAIDocs/routes.md`
- `webAIDocs/page-xxx.md`

### 3. 把文档复制回当前仓库

这是影响问答质量的关键步骤。后端默认会从当前项目根目录读取 `webAIDocs/`，所以生成完成后，需要把业务项目里的文档复制回本仓库：

```text
your-business-project/
└─ webAIDocs/
   ├─ routes.md
   └─ page-xxx.md

copy to

portable-ai-agent-widget/
└─ webAIDocs/
```

可以理解为：`webGenerate` 负责在业务项目里“产出知识”，当前仓库里的后端负责“消费知识”。

### 4. 启动后端

```bash
cd backend
pip install -r requirements.txt

# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

至少修改这些配置：

```env
ADMIN_PASSWORD=your-strong-password
JWT_SECRET_KEY=your-long-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=15
ENABLE_ADMIN_BACKEND=true
# 默认使用 SQLite：data/agent.sqlite3；可选配置 MySQL/PostgreSQL
# AGENT_DATABASE_URL=postgresql+psycopg://user:password@127.0.0.1:5432/web_ai
```

然后启动服务：

```bash
python main.py
```

默认地址：

- 服务地址：`http://localhost:4096`
- 管理后台：`http://localhost:4096/admin`

说明：

- `ADMIN_USERNAME` 默认是 `admin`
- 如果 `ADMIN_PASSWORD` 仍是示例默认值，管理后台会拒绝登录

### 5. 创建 API Key，并配置模型 / MCP

登录 `http://localhost:4096/admin` 后：

1. 打开 `API Keys`
2. 创建一个新的 Key
3. 保存生成结果
4. 根据需要在 `Models`、`Tools & MCP` 中配置模型和工具
5. 如需 token 计费，在模型里填写 `input_price`、`output_price`、`cache_write_price`、`cache_read_price`
6. 打开 `Usage` 查看请求数、token、消费、平均耗时和调用明细

说明：

- 如果没有配置可用模型，Agent 无法正常回答
- 如果业务依赖 MCP 工具，也应该在这一步一起配置
- 价格单位是 USD / 1M tokens；数据库 DSL 见 `backend/SQL_DSL.md`

### 6. 安装前端包

```bash
npm install portable-ai-agent-widget
```

### 7. 先用开发模式跑通

`selfAuth=true` 适合本地联调，接入路径最短：

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  apiKey: "sk-your-api-key",
  selfAuth: true,
  routerPush: (route) => router.push(route),
});

await AIAgent.sendMessage("带我去用户管理");
```

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

## 生产环境推荐接法

生产环境建议使用 `selfAuth=false`，不要把 `apiKey` 下发到前端。

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

这个模式的好处：

- 前端不再持有长期 `apiKey`
- token 过期后，Widget 会自动重新获取
- 你可以把登录态、权限校验、限流策略留在自己的服务里

完整的鉴权说明和服务端示例见：

- [backend/AUTH_GUIDE.md](./backend/AUTH_GUIDE.md)
- [QUICK_START.md](./QUICK_START.md)

## `webGenerate` 工作流

`webGenerate` 不直接在 npm 命令里扫描业务页面，而是先把工作流安装到你的助手里，再通过助手命令生成 `webAIDocs/`。

### 安装工作流

例如为 Codex 安装：

```bash
npx portable-ai-agent-widget codex install
```

也可以安装到其他助手：

```bash
npx portable-ai-agent-widget claude install
npx portable-ai-agent-widget cursor install
npx portable-ai-agent-widget gemini install
```

### 生成知识文档

安装完成后，在业务项目中触发：

- Codex：`$webGenerate .`
- Claude / Cursor / Gemini / Trae / Copilot 等：`/webGenerate .`

增量同步：

- Codex：`$webGenerate . --update`
- 其他助手：`/webGenerate . --update`

固定输出：

- `webAIDocs/routes.md`
- `webAIDocs/page-xxx.md`

### 生成后要做什么

生成完成后，请把业务项目中的 `webAIDocs/` 复制回当前仓库，再启动后端或重新生成 Agent 相关配置。

这是因为当前仓库中的后端和本地 Agent 默认读取的是“当前项目根目录下的 `webAIDocs/`”，不是你业务项目中的那一份临时输出。

## 常用接口

- `POST /api/auth/token`
- `POST /api/auth/refresh`
- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/session`
- `POST /api/session/{sessionId}/message`
- `GET /api/page-agent/config`
- `POST /api/page-agent/chat/completions`

鉴权特性：

- Access token 默认有效期 15 分钟
- Refresh token 默认有效期 7 天
- Access / refresh token 都会持续回查绑定的 API Key 是否有效
- 停用或删除 API Key 后，旧 token 会立即失效
- 服务端按 API Key 的 `rate_limit` 执行限流

## 仓库结构

```text
.
├─ src/                     # 前端 Widget 源码
├─ dist/                    # 前端构建产物（ESM + IIFE）
├─ backend/                 # FastAPI 后端
├─ scripts/webGenerate.js   # webGenerate CLI / MCP 入口
├─ prompts/                 # 提示词
├─ templates/               # 各平台 Skill 模板
└─ webAIDocs/               # 页面知识文档
```

## 本地开发

```bash
npm install
npm run build
npm run dev
```

后端开发：

```bash
cd backend
pip install -r requirements.txt
python main.py
```

## 命令速查

```bash
# 构建前端产物
npm run build

# 本地预览
npm run dev

# 同步 GitHub README 到 README.md
npm run readme:github

# 发布前切换 npm README
npm run readme:npm
```

## 相关文档

- [QUICK_START.md](./QUICK_START.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PRINCIPLES.md](./PRINCIPLES.md)
- [backend/README.md](./backend/README.md)
- [backend/AUTH_GUIDE.md](./backend/AUTH_GUIDE.md)

## 发布

```bash
npm run build
npm pack --dry-run
npm publish
```

发布时会自动切换到 npm 版 README，打包结束后再恢复仓库版 README。
