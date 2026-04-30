# Portable AI Agent Widget

`portable-ai-agent-widget` 是一个给前端项目接入页面级 AI Agent 的仓库，包含三部分：

- 前端运行时 Widget：页面问答、受控路由跳转、当前页操作
- FastAPI 后端：知识文档读取、动作决策、模型与 MCP 管理
- `webGenerate` 工作流：生成 `webAIDocs/routes.md` 和 `page-xxx.md`

它适合后台、中台、运营系统这类有明确页面结构和业务流程的 Web 应用。

## 能力边界

- 页面问答
- 受控导航：`navigate`
- 当前页操作：`form`
- 基于 `webAIDocs/` 的页面知识检索

前端只执行白名单动作，不直接执行任意脚本。

## 仓库结构

```text
.
├─ src/                     # Widget 源码
├─ dist/                    # 前端构建产物
├─ backend/                 # FastAPI 后端
├─ scripts/webGenerate.js   # CLI / MCP 入口
├─ prompts/                 # 提示词
├─ templates/               # 各平台 skill 模板
└─ webAIDocs/               # 业务知识文档
```

## 快速开始

### 1. 启动后端

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
```

必须先修改 `backend/.env`：

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

默认地址是 `http://localhost:4096`。

### 2. 创建 API Key

打开 `http://localhost:4096/admin`，用管理员账号登录后，在 `API Keys` 菜单创建一个 Key。

说明：

- 若 `ADMIN_PASSWORD` 仍是默认值，管理后台登录会被拒绝
- 若 `ENABLE_ADMIN_BACKEND=false`，则 `/admin` 与 `/api/admin/*` 都不可访问

## 前端接入

### 方案 A：`selfAuth=true`，前端自动用 API Key 换 token

这个模式接入最简单，但 `apiKey` 会出现在前端代码或页面配置中。

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

IIFE 方式：

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

### 方案 B：`selfAuth=false`，由你自己的服务提供 token

这是生产环境推荐方案。前端不再持有 `apiKey`，而是通过你自己的后端获取 access token。

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
    return data.token;
  },
  routerPush: (route) => router.push(route),
});
```

说明：

- `selfAuth=true` 时，前端 Agent 会自动调用 `/api/auth/token` 与 `/api/auth/refresh`
- `selfAuth=false` 时，前端 Agent 不再使用 `apiKey`
- `selfAuth=false` 时必须提供 `getToken()`，返回值可以是 token 字符串，或 `{ token | accessToken, expiresAt?, expiresIn? }`
- 当接口返回 `401` 时，Agent 会自动指数退避重试
- `selfAuth=true` 时会重新用 `apiKey` 认证
- `selfAuth=false` 时会重新调用 `getToken()`

### 生产环境推荐

生产环境推荐使用 `selfAuth=false`。

原因：

- `selfAuth=true` 需要把 `apiKey` 下发到前端
- 前端 JS、页面属性、打包产物都可能被反向拿到 `apiKey`
- 一旦 `apiKey` 泄露，攻击者就能自行换 token 调用 AI 接口

## 你的服务如何提供 `getToken`

推荐做法：

1. 在你自己的后端保存 Widget 的 `apiKey`
2. 由你自己的后端调用 Widget 后端的 `/api/auth/token`
3. 只把短期 access token 返回给前端
4. 前端 Agent 使用 `selfAuth=false + getToken()`

### 示例：你的业务服务对外提供 token 接口

下面是一个最小 FastAPI 示例：

```python
import os
import httpx
from fastapi import FastAPI, HTTPException, Request

app = FastAPI()

WIDGET_BACKEND = os.environ["WIDGET_BACKEND"].rstrip("/")
WIDGET_API_KEY = os.environ["WIDGET_API_KEY"]


@app.post("/internal/agent/token")
async def issue_agent_token(request: Request):
    # 这里接你自己的登录态 / 权限校验
    # 例如：if not request.session.get("user"): raise HTTPException(401, "请先登录")

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{WIDGET_BACKEND}/api/auth/token",
            json={"api_key": WIDGET_API_KEY},
        )

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Widget backend token exchange failed")

    payload = response.json()
    return {
        "token": payload["access_token"],
        "expiresIn": payload.get("expires_in", 900),
    }
```

### 前端对接这个接口

```js
AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  selfAuth: false,
  getToken: async () => {
    const res = await fetch("/internal/agent/token", {
      method: "POST",
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("无法获取 Agent token");
    }

    const data = await res.json();
    return {
      token: data.token,
      expiresIn: data.expiresIn,
    };
  },
});
```

## 后端接口

常用接口：

- `POST /api/auth/token`
- `POST /api/auth/refresh`
- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/session`
- `POST /api/session/{sessionId}/message`
- `GET /api/page-agent/config`
- `POST /api/page-agent/chat/completions`

鉴权说明：

- Access token 默认有效期 15 分钟，可通过 `ACCESS_TOKEN_EXPIRE_MINUTES` 调整
- Refresh token 默认有效期 7 天，可通过 `REFRESH_TOKEN_EXPIRE_DAYS` 调整
- Access/refresh token 都会持续回查绑定的 API Key 是否仍然有效
- 停用或删除 API Key 后，旧 token 将无法继续调用和刷新
- 服务端会按 API Key 的 `rate_limit` 执行限流，不再只按 IP 限流

## 管理后台

管理后台统一入口：

- `http://localhost:4096/admin`

当前包含：

- `Models`
- `Tools & MCP`
- `API Keys`
- `Stats`
- `Logs`

可通过环境变量关闭：

```env
ENABLE_ADMIN_BACKEND=false
```

关闭后：

- `/admin`
- `/admin/agent-admin.iife.js`
- `/api/auth/login`
- `/api/admin/*`

都不可访问。

## `webGenerate` 的作用

`webGenerate` 负责把知识文档工作流安装到不同 Agent / IDE 中，不直接在 npm 命令里扫描业务项目。

安装示例：

```bash
webgenerate codex install
webgenerate claude install
webgenerate cursor install
```

安装后，在业务项目中触发：

```bash
/webGenerate .
/webGenerate . --update
```

Codex 中使用：

```bash
$webGenerate .
$webGenerate . --update
```

生成结果固定在：

- `webAIDocs/routes.md`
- `webAIDocs/page-xxx.md`

## 开发

```bash
npm install
npm run build
npm run dev
```

## 文档

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PRINCIPLES.md](./PRINCIPLES.md)
- [QUICK_START.md](./QUICK_START.md)
- [backend/AUTH_GUIDE.md](./backend/AUTH_GUIDE.md)

## 发布

```bash
npm run build
npm pack --dry-run
npm publish
```

发布时会自动切换到 npm 版 README，打包结束后再恢复仓库版 README。
