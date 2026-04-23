# 架构说明

`portable-ai-agent-widget` 由三层组成：前端 Widget、后端 Agent 服务、知识文档工作流。

## 1. 前端运行时层

前端只暴露一个受控入口 `AIAgent`，用于完成三类能力：

- 页面问答
- 路由跳转 `navigate`
- 当前页表单操作 `form`

Widget 会把用户消息和当前页面上下文发送给后端，包括：

- `pathname`
- `hash`
- `href`
- `title`

前端不会直接执行脚本，不接收 DOM 注入指令，也不会把模型密钥暴露到浏览器。

## 2. 后端决策层

后端基于 FastAPI + LangChain，职责是：

- 读取 `webAIDocs/routes.md` 与对应 `page-xxx.md`
- 结合当前页面上下文生成回答
- 输出标准化结果
- 过滤危险内容

后端响应分三种：

1. 普通问答：返回 `message`
2. 导航动作：返回 `action: "navigate"`
3. 表单动作：返回 `action: "form"`

其中 `form` 不直接附带脚本，而是返回面向当前页的操作说明，再交给 `page-agent` 执行页面级动作。

## 3. 知识库层

知识库统一落到项目根目录 `webAIDocs/`：

- `routes.md`
- `page-xxx.md`

文档生成不是由 npm 命令直接扫描源码完成，而是通过安装后的助手命令触发：

- Codex：`$webGenerate .`
- 其他支持 `/` 触发的助手：`/webGenerate .`

`scripts/webGenerate.js` 本身只负责安装和卸载对应平台的 Skill、规则文件和 Hook。

## 4. 整体链路

### 运行时链路

1. 业务项目集成 `AIAgent`
2. 用户在页面中提问
3. Widget 将消息和页面上下文发给后端
4. 后端读取 `webAIDocs/` 中的业务文档
5. 后端返回问答、导航动作或表单动作
6. 前端只执行白名单内动作

### 建库链路

1. 用户安装 `webGenerate`
2. 在助手中运行 `/webGenerate .` 或 `$webGenerate .`
3. 工作流先生成 `routes.md`
4. 再生成或更新匹配的 `page-xxx.md`
5. 后端和其他 AI 工具复用这些文档

## 5. 仓库目录职责

```text
.
├─ src/                     # Widget 源码
├─ dist/                    # npm 分发产物（ESM + IIFE）
├─ backend/                 # FastAPI 后端
├─ scripts/webGenerate.js   # CLI 安装入口
├─ prompts/                 # Widget / 后端提示词
├─ templates/               # 各平台 Skill 模板
└─ webAIDocs/               # 生成后的知识文档
```

## 6. npm 包对外提供的内容

发布到 npm 后，这个包主要提供两类能力：

1. 前端运行时包：通过 `import AIAgent from "portable-ai-agent-widget"` 集成 Widget
2. CLI 安装器：通过 `npx portable-ai-agent-widget <platform> install` 或全局安装后 `webGenerate <platform> install` 安装知识库生成命令
