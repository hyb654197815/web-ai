# AI Agent 安全认证接入指南

## 概述

当前认证体系包含：

- JWT access token
- JWT refresh token
- API Key 管理
- 管理员登录
- API Key 失效联动：停用或删除 Key 后，旧 token 立即失效
- 按 API Key 的服务端限流
- 管理后台开关

## 核心原则

### 开发环境

可以使用：

- 前端 `selfAuth=true`
- 前端直接传 `apiKey`

适合本地验证，接入最快。

### 生产环境

推荐使用：

- 前端 `selfAuth=false`
- 你自己的后端提供 `getToken()` 对应的取 token 接口

原因：

- `apiKey` 一旦下发到前端，就可能被反向拿到
- 攻击者拿到 `apiKey` 后可以自行换 token 调 AI 接口
- `selfAuth=false` 可以把长期凭条留在你自己的服务端

## 环境变量

示例：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password-now
JWT_SECRET_KEY=your-long-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7
ENABLE_ADMIN_BACKEND=true
PORT=4096
HOST=0.0.0.0
RELOAD=false
```

说明：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ADMIN_USERNAME` | 管理员账号 | `admin` |
| `ADMIN_PASSWORD` | 管理员密码 | `admin123` |
| `JWT_SECRET_KEY` | JWT 密钥 | 自动生成 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token 有效期（分钟） | `15` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Refresh token 有效期（天） | `7` |
| `ENABLE_ADMIN_BACKEND` | 是否启用 `/admin` 与 `/api/admin/*` | `true` |

## 首次启动要求

首次启动前必须修改 `ADMIN_PASSWORD`。

当前实现中：

- 如果 `ADMIN_PASSWORD` 仍为默认值 `admin123`
- `/api/auth/login` 会拒绝登录
- 管理接口也无法继续使用

也就是说，默认口令不再可直接投入使用。

## 管理后台

开启时：

- 页面入口：`/admin`
- 管理接口：`/api/admin/*`
- 管理员登录：`POST /api/auth/login`

关闭方式：

```env
ENABLE_ADMIN_BACKEND=false
```

关闭后这些路径都不可访问：

- `/admin`
- `/admin/agent-admin.iife.js`
- `/api/auth/login`
- `/api/admin/*`

## Token 行为

### Access token

- 默认有效期 15 分钟
- 由 `/api/auth/token` 或 `/api/auth/refresh` 返回
- 每次调用 AI 接口时，都会回查绑定的 API Key 是否仍然存在、启用、未过期

### Refresh token

- 默认有效期 7 天
- 刷新时同样会回查绑定的 API Key
- 如果 API Key 已被停用、删除或过期，refresh 也会失败

### API Key 与 Token 的联动

创建 token 时，服务端会把 API Key 的内部标识绑定到 token 上。

因此：

- 删除 API Key 后，旧 access token 失效
- 删除 API Key 后，旧 refresh token 失效
- 禁用 API Key 后，旧 token 失效
- API Key 过期后，旧 token 失效

## 服务端限流

限流现在分为两层：

1. 原有 IP 级别限流
2. API Key 级别限流

API Key 级别限流使用 Key 自身的 `rate_limit` 字段，按每分钟请求数执行。

## 接口说明

### 1. 使用 API Key 换 token

```http
POST /api/auth/token
Content-Type: application/json

{
  "api_key": "sk-..."
}
```

响应：

```json
{
  "access_token": "xxx",
  "refresh_token": "xxx",
  "token_type": "bearer",
  "expires_in": 900
}
```

### 2. 刷新 token

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refresh_token": "xxx"
}
```

### 3. 调用 AI 接口

```http
POST /api/chat
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "message": "你好",
  "context": {
    "pathname": "/"
  }
}
```

## 前端接入

### 模式一：`selfAuth=true`

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  apiKey: "sk-your-api-key",
  selfAuth: true,
});
```

行为：

- 前端自动调用 `/api/auth/token`
- token 过期或接口 `401` 时自动重试
- 使用指数退避

### 模式二：`selfAuth=false`

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  selfAuth: false,
  getToken: async () => {
    const res = await fetch("/internal/agent/token", {
      method: "POST",
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("获取 token 失败");
    }

    const data = await res.json();
    return {
      token: data.token,
      expiresIn: data.expiresIn,
    };
  },
});
```

行为：

- 前端不再使用 `apiKey`
- `401` 时重新调用 `getToken()`
- 仍然使用指数退避

## 你的服务如何接入 `getToken`

推荐让你的业务服务做代理。

### 示例：FastAPI 业务服务

```python
import os
import httpx
from fastapi import FastAPI, HTTPException, Request

app = FastAPI()

WIDGET_BACKEND = os.environ["WIDGET_BACKEND"].rstrip("/")
WIDGET_API_KEY = os.environ["WIDGET_API_KEY"]


@app.post("/internal/agent/token")
async def issue_agent_token(request: Request):
    # 这里接你的登录态和权限判断
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

### 前端如何消费

```js
AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  selfAuth: false,
  getToken: async () => {
    const response = await fetch("/internal/agent/token", {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("无法获取 Agent token");
    }

    const data = await response.json();
    return data.token;
  },
});
```

## 安全建议

1. 生产环境优先使用 `selfAuth=false`
2. 不要把 `agent-admin.json`、`api-keys.json`、`backend/.env`、`mcp.json` 提交到仓库
3. 定期轮换模型供应商 API Key
4. 定期轮换业务侧 API Key
5. 为你自己的 `/internal/agent/token` 接口接入登录态和权限校验
6. 不要把管理后台直接暴露在公网
