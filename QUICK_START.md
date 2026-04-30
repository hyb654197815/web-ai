# 快速启动指南

## 1. 安装依赖

```bash
cd backend
pip install -r requirements.txt
```

## 2. 配置环境变量

```bash
cp .env.example .env
```

至少修改这些配置：

```env
ADMIN_PASSWORD=your-strong-password
JWT_SECRET_KEY=your-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=15
ENABLE_ADMIN_BACKEND=true
```

说明：

- 默认管理员密码不会再允许登录
- `ENABLE_ADMIN_BACKEND=false` 时，`/admin` 和 `/api/admin/*` 会被关闭

## 3. 启动服务

```bash
python main.py
```

启动成功后默认访问：

- 服务地址：`http://localhost:4096`
- 管理后台：`http://localhost:4096/admin`

## 4. 创建 API Key

1. 使用你配置好的管理员账号登录 `/admin`
2. 打开 `API Keys`
3. 创建新的 API Key
4. 保存生成的 Key

## 5. 选择前端接入方式

### 开发环境：`selfAuth=true`

```js
import AIAgent from "portable-ai-agent-widget";

AIAgent.init({
  backendUrl: "http://localhost:4096/api",
  apiKey: "sk-your-api-key",
  selfAuth: true,
});
```

### 生产环境：`selfAuth=false`

推荐把 `apiKey` 放在你自己的后端，由你的服务给前端返回短期 token：

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
});
```

## 6. 你的服务如何提供 `/internal/agent/token`

示例：

```python
import os
import httpx
from fastapi import FastAPI, HTTPException

app = FastAPI()

WIDGET_BACKEND = os.environ["WIDGET_BACKEND"].rstrip("/")
WIDGET_API_KEY = os.environ["WIDGET_API_KEY"]


@app.post("/internal/agent/token")
async def issue_agent_token():
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{WIDGET_BACKEND}/api/auth/token",
            json={"api_key": WIDGET_API_KEY},
        )

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Widget token exchange failed")

    payload = response.json()
    return {
        "token": payload["access_token"],
        "expiresIn": payload.get("expires_in", 900),
    }
```

## 7. 常用接口

```bash
# 直接用 API Key 换 token（适合服务端调用，不建议前端生产环境直连）
curl -X POST http://localhost:4096/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"api_key": "sk-your-api-key-here"}'

# 用 access token 调用聊天接口
curl -X POST http://localhost:4096/api/chat \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "你好", "context": {"pathname": "/"}}'
```

## 8. 重要提醒

1. 生产环境推荐 `selfAuth=false`
2. 停用或删除 API Key 后，旧 token 会立即失效，不能再刷新或继续调用
3. 服务端已按 API Key `rate_limit` 执行限流
4. `agent-admin.json`、`api-keys.json`、`backend/.env`、`mcp.json` 应保留在服务器侧，不要提交到仓库

## 9. 相关文档

- [README.md](./README.md)
- [backend/AUTH_GUIDE.md](./backend/AUTH_GUIDE.md)
- [backend/security_recommendations.md](./backend/security_recommendations.md)
