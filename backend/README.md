# 便携式前端 AI Agent 后端

基于 FastAPI + LangChain 的后端服务，当前支持：

- 路由跳转：`navigate`
- 当前页操作：`form`（协议名沿用 form，实际覆盖表单填写、按钮点击、弹窗、筛选查询、翻页等页面交互）
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
- `GET /api/page-agent/config`
- `POST /api/page-agent/chat/completions`
- `GET /api/health`

## SSE 事件

- `thinking`：ReAct 中间推理、工具调用与观察摘要
- `final`：最终结果
- `done`：流结束
- `error`：异常信息

## 环境变量

- `OPENAI_API_KEY`
- `OPENAI_API_BASE`
- `OPENAI_MODEL_NAME`
- `AGENT_PROMPTS_DIR`
- `WIDGET_KNOWLEDGE_DIR`
- `WIDGET_KNOWLEDGE_SKILL_DIR`
- `WIDGET_SKILLS_DIR`
- `CORS_ORIGINS`
- `PORT`

知识库默认读取顺序：

- `WIDGET_KNOWLEDGE_DIR`
- `WIDGET_KNOWLEDGE_SKILL_DIR/references`
- `WIDGET_SKILLS_DIR/widget-knowledge-system/references`
- 项目根目录 `webAIDocs/`
- 项目根目录 `knowledge/`

可选调优项：

- `AGENT_TEMPERATURE`
- `AGENT_MAX_RETRIES`
- `AGENT_ROUTE_SEARCH_LIMIT`
- `AGENT_MAX_PAGE_DOC_CHARS`
- `AGENT_MAX_MESSAGE_CHARS`
- `STREAM_THINKING_SUMMARY_LIMIT`
- `STREAM_MAX_TOOL_PREVIEW_CHARS`

## 代码结构

- `agent.py`：LangChain Agent 编排、stream 事件转换、最终 payload 抽取
- `agent_tools.py`：`search_routes` / `get_page_doc` / `get_current_page_doc` 工具
- `agent_context.py`：路由表解析、路径匹配、候选路由搜索
- `agent_llm.py`：OpenAI 兼容 Chat Model 初始化
- `agent_output.py`：模型最终文本/JSON 归一化为前端动作协议
- `prompts/agent-system.txt`：system prompt 模板（含 routes.md）
- `prompts/agent-user.txt`：user prompt 模板（含当前页面与用户请求）

## 运行

```bash
cd backend
pip install -r requirements.txt
python main.py
```
