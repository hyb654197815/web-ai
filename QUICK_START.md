# 快速启动指南

## 1. 安装 `webGenerate` 到你的编程助手

例如：

```bash
npx portable-ai-agent-widget codex install
```

也可以安装到其他助手：

```bash
npx portable-ai-agent-widget claude install
npx portable-ai-agent-widget cursor install
npx portable-ai-agent-widget gemini install
```

## 2. 在业务项目中生成 `webAIDocs/`

安装完成后，在业务项目里运行：

- Codex：`$webGenerate .`
- Claude / Cursor / Gemini / Trae / Copilot 等：`/webGenerate .`

增量更新：

- Codex：`$webGenerate . --update`
- 其他助手：`/webGenerate . --update`

生成结果固定为：

- `webAIDocs/routes.md`
- `webAIDocs/page-xxx.md`

## 3. 把生成好的文档复制回当前仓库

这一步非常关键，会直接影响 Agent 的最终问答质量。

后端默认读取当前仓库根目录下的 `webAIDocs/`，所以你需要把业务项目里生成的文档复制回来：

```text
business-project/webAIDocs/*  ->  portable-ai-agent-widget/webAIDocs/
```

## 4. 安装后端依赖

```bash
cd backend
pip install -r requirements.txt
```

## 5. 配置环境变量

```bash
cp .env.example .env
```

至少修改这些配置：

```env
ADMIN_PASSWORD=your-strong-password
JWT_SECRET_KEY=your-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=15
ENABLE_ADMIN_BACKEND=true
DISABLE_AGENT_AUTH=false
# 默认使用 SQLite：data/agent.sqlite3
# AGENT_DATABASE_URL=mysql+pymysql://user:password@127.0.0.1:3306/web_ai?charset=utf8mb4
```

说明：

- 默认管理员密码不会再允许登录
- `ENABLE_ADMIN_BACKEND=false` 时，`/admin` 和 `/api/admin/*` 会被关闭

## 6. 启动服务

```bash
python main.py
```

启动成功后默认访问：

- 服务地址：`http://localhost:4096`
- 管理后台：`http://localhost:4096/admin`

## 7. 创建 API Key，并配置模型

1. 使用你配置好的管理员账号登录 `/admin`
2. 打开 `API Keys`
3. 创建新的 API Key
4. 保存生成的 Key
5. 在 `Models` 中配置可用模型
6. 如果需要计费，在模型里填写输入、输出、缓存写入、缓存读取价格
7. 如果需要，在 `Tools & MCP` 中配置工具和 MCP
8. 打开 `Usage` 查看 token 用量、费用、平均耗时和调用明细

说明：

- 没有可用模型时，Agent 无法正常返回高质量回答
- 如果复制回来的 `webAIDocs/` 不完整，回答质量也会明显下降
- 价格单位是 USD / 1M tokens；MySQL、PostgreSQL 或其他 SQLAlchemy 方言可通过驱动 URL 配置

## 8. 选择前端接入方式

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

### 本地调试免鉴权

如果你想让用户在本地直接调试，不想配置 API Key 和 token，可以在 `backend/.env` 中打开：

```env
DISABLE_AGENT_AUTH=true
```

开启后前端 Agent 可以直接匿名调用 `/api/chat`、`/api/session/*`、`/api/page-agent/chat/completions`，无需再填写 `apiKey` 或实现 `getToken()`。

## 9. 你的服务如何提供 `/internal/agent/token`

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

## 10. 常用接口

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

## 11. 重要提醒

1. 生产环境推荐 `selfAuth=false`
2. 停用或删除 API Key 后，旧 token 会立即失效，不能再刷新或继续调用
3. 服务端已按 API Key `rate_limit` 执行限流
4. `webAIDocs/` 是 Agent 的核心知识输入，应与业务页面保持同步
5. `agent-admin.json`、`api-keys.json`、`backend/.env`、`mcp.json` 应保留在服务器侧，不要提交到仓库

## 12. 相关文档

- [README.md](./README.md)
- [backend/AUTH_GUIDE.md](./backend/AUTH_GUIDE.md)
- [backend/security_recommendations.md](./backend/security_recommendations.md)
