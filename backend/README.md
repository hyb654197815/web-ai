# 便携式前端 AI Agent 后端

基于 FastAPI + LangChain 的后端服务，当前仅支持：

- 路由跳转：`navigate`
- 站内操作问答：页面说明、流程说明、表单填写指引

不再支持：

- `fill_form`
- DOM 快照采集、存储和工具调用
- 脚本执行或自动填写表单

## API

- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/session`
- `POST /api/session/{sessionId}/message`
- `GET /api/health`

## SSE 事件

- `thinking`：中间推理摘要
- `final`：最终结果
- `done`：流结束
- `error`：异常信息

## 环境变量

- `NVIDIA_API_KEY` 或 `OPENAI_API_KEY`
- `OPENAI_API_BASE`
- `OPENAI_MODEL_NAME`
- `AGENT_PROMPTS_DIR`
- `WIDGET_KNOWLEDGE_DIR`
- `WIDGET_KNOWLEDGE_SKILL_DIR`
- `WIDGET_SKILLS_DIR`
- `CORS_ORIGINS`
- `PORT`

可选调优项：

- `AGENT_TEMPERATURE`
- `AGENT_MAX_ROUTE_LINES`
- `AGENT_MAX_RELATED_DOCS`
- `AGENT_MAX_DOC_CHARS`
- `AGENT_MAX_MESSAGE_CHARS`
- `STREAM_THINKING_FLUSH_CHARS`
- `STREAM_MAX_THINKING_EVENTS`

## 代码结构

- `agent.py`：编排层，只保留回合执行、重试策略与公开接口
- `agent_settings.py`：运行时常量与环境变量读取
- `agent_prompts.py`：提示词模板加载与变量渲染
- `agent_context.py`：路由解析、相关文档筛选、用户上下文拼装
- `agent_llm.py`：LangChain / OpenAI 兼容模型适配
- `agent_output.py`：模型输出清洗、导航动作归一化、安全兜底
- `prompts/agent-system.txt`：system prompt 模板
- `prompts/agent-user.txt`：用户上下文 prompt 模板

调整提示词时，优先修改 `backend/prompts/` 下的模板文件，而不是直接改 Python 代码。

## 运行

```bash
cd backend
pip install -r requirements.txt
python main.py
```
