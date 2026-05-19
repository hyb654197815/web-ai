(function () {
  const { createApp } = Vue;

  const ASSET = {
    videos: {
      generate: "./assets/videos/generate-docs.mp4",
      form: "./assets/videos/form-fill.mp4",
      route: "./assets/videos/route-navigation.mp4",
      qa: "./assets/videos/knowledge-qa.mp4",
      mcp: "./assets/videos/mcp-capability.mp4"
    },
    images: {
      frontend: "./assets/images/frontend-integration.png",
      adminModels: "./assets/images/admin-models.png",
      adminModelAdd: "./assets/images/admin-model-add.png",
      adminApiKeys: "./assets/images/admin-api-keys.png",
      adminMcp: "./assets/images/admin-mcp.png",
      adminMcpAdd: "./assets/images/admin-mcp-add.png",
      adminUsage: "./assets/images/admin-usage.png",
      adminSessions: "./assets/images/admin-sessions.png",
      adminKnowledge: "./assets/images/admin-knowledge.png",
      adminControl: "./assets/images/screenshots/admin-control.png",
      knowledgeFlow: "./assets/images/screenshots/knowledge-flow.png",
      widgetConsole: "./assets/images/screenshots/widget-console.png",
      frontendRuntime: "./assets/images/screenshots/frontend-integration-redacted.png"
    }
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inlineCode(value) {
    return '<span class="inline-code">' + escapeHtml(value) + "</span>";
  }

  function codeBlock(lang, code) {
    return (
      '<div class="code-block"><div class="code-head">' +
      escapeHtml(lang) +
      "</div><pre><code>" +
      escapeHtml(code.trim()) +
      "</code></pre></div>"
    );
  }

  function section(id, title, kicker, body) {
    const kickerHtml = kicker ? '<p class="section-kicker">' + kicker + "</p>" : "";
    return '<section class="doc-section" id="' + id + '"><h2>' + title + "</h2>" + kickerHtml + body + "</section>";
  }

  function grid(cards, className) {
    return '<div class="' + className + '">' + cards.join("") + "</div>";
  }

  function card(title, body) {
    return '<div class="info-card"><h3>' + title + "</h3><p>" + body + "</p></div>";
  }

  function miniCard(title, body) {
    return '<div class="mini-card"><strong>' + title + "</strong><p>" + body + "</p></div>";
  }

  function statCard(value, label) {
    return '<div class="stat-card"><strong>' + value + "</strong><span>" + label + "</span></div>";
  }

  function note(type, title, body) {
    return '<div class="note ' + type + '"><strong>' + title + "</strong><p>" + body + "</p></div>";
  }

  function pills(items) {
    return '<div class="pill-row">' + items.map((item) => '<span class="pill">' + item + "</span>").join("") + "</div>";
  }

  function steps(items) {
    return (
      '<div class="step-list">' +
      items
        .map(function (item, index) {
          return (
            '<div class="step-card"><div class="step-index">' +
            (index + 1) +
            '</div><div><h3>' +
            item.title +
            "</h3><p>" +
            item.body +
            "</p></div></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function table(headers, rows) {
    return (
      '<div class="table-wrap"><table class="doc-table"><thead><tr>' +
      headers.map((head) => "<th>" + head + "</th>").join("") +
      "</tr></thead><tbody>" +
      rows
        .map(function (row) {
          return "<tr>" + row.map((cell) => "<td>" + cell + "</td>").join("") + "</tr>";
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  function video(src, caption) {
    return '<figure class="media-block"><video controls playsinline preload="metadata" src="' + src + '"></video><figcaption>' + caption + "</figcaption></figure>";
  }

  function image(src, caption) {
    return '<figure class="media-block"><img src="' + src + '" alt="' + escapeHtml(caption) + '"><figcaption>' + caption + "</figcaption></figure>";
  }

  function mediaGrid(items) {
    return '<div class="media-grid">' + items.join("") + "</div>";
  }

  function captionGrid(items) {
    return '<div class="caption-grid">' + items.map((item) => '<div class="caption-card"><strong>' + item.title + '</strong><p>' + item.body + "</p></div>").join("") + "</div>";
  }

  function linkRows(items) {
    return '<div class="link-list">' + items.map((item) => '<div class="link-row"><span>' + item.title + '</span><span>' + item.body + "</span></div>").join("") + "</div>";
  }

  function buildDocs() {
    const installAll = [
      "npx portable-ai-agent-widget codex install",
      "npx portable-ai-agent-widget claude install",
      "npx portable-ai-agent-widget opencode install",
      "npx portable-ai-agent-widget copilot-cli install",
      "npx portable-ai-agent-widget vscode-copilot install",
      "npx portable-ai-agent-widget gemini install",
      "npx portable-ai-agent-widget antigravity install",
      "npx portable-ai-agent-widget cursor install",
      "npx portable-ai-agent-widget trae install",
      "npx portable-ai-agent-widget trae-cn install"
    ].join("\n");

    const envExample = [
      "ADMIN_PASSWORD=your-strong-password",
      "JWT_SECRET_KEY=your-long-random-secret",
      "ACCESS_TOKEN_EXPIRE_MINUTES=15",
      "REFRESH_TOKEN_EXPIRE_DAYS=7",
      "ENABLE_ADMIN_BACKEND=true",
      "DISABLE_AGENT_AUTH=false"
    ].join("\n");

    const frontendQuickStart = [
      'import AIAgent from "portable-ai-agent-widget";',
      "",
      "AIAgent.init({",
      '  backendUrl: "http://localhost:4096/api",',
      '  apiKey: "sk-your-api-key",',
      "  selfAuth: true,",
      "  routerPush: (route) => router.push(route)",
      "});"
    ].join("\n");

    const productionAuth = [
      'import AIAgent from "portable-ai-agent-widget";',
      "",
      "AIAgent.init({",
      '  backendUrl: "https://your-domain.com/api",',
      "  selfAuth: false,",
      "  getToken: async () => {",
      '    const response = await fetch("/internal/agent/token", {',
      '      method: "POST",',
      '      credentials: "include"',
      "    });",
      "",
      "    if (!response.ok) throw new Error(\"Failed to get token\");",
      "    const data = await response.json();",
      "    return {",
      "      token: data.token,",
      "      expiresIn: data.expiresIn",
      "    };",
      "  }",
      "});"
    ].join("\n");

    const skipAuthCode = [
      "DISABLE_AGENT_AUTH=true",
      "",
      "# frontend can omit apiKey and getToken in local debugging",
      'AIAgent.init({ backendUrl: "http://localhost:4096/api", selfAuth: false });'
    ].join("\n");

    const assistantTriggers = [
      "# Codex",
      "$webGenerate .",
      "$webGenerate . --update",
      "",
      "# Claude / Cursor / Gemini / Trae / Copilot / OpenCode / Antigravity",
      "/webGenerate .",
      "/webGenerate . --update"
    ].join("\n");

    const mcpCommand = [
      "# expose webGenerate as an MCP server",
      "webGenerate MCP",
      "",
      "# or lock the knowledge root explicitly",
      "webGenerate MCP --root ./your-project"
    ].join("\n");

    return {
      zh: {
        brand: {
          name: "Portable AI Agent Widget",
          tagline: "Open-source docs"
        },
        labels: {
          darkMode: "深色",
          lightMode: "浅色",
          menu: "菜单",
          navigation: "Documentation",
          onThisPage: "页内二级目录",
          related: "相关章节",
          adminCenter: "管理端文档中心",
          adminCenterDesc: "按能力拆分的后台说明，适合实施、运维与业务配置时快速查阅。"
        },
        topNav: [
          { label: "概览", route: "overview", match: ["overview"] },
          { label: "快速开始", route: "quick-start", match: ["quick-start"] },
          { label: "webGenerate", route: "webgenerate-cli", match: ["webgenerate-cli", "webgenerate-assistant"] },
          { label: "前端 Agent", route: "frontend-agent", match: ["frontend-agent", "api-auth", "mcp"] },
          { label: "管理端", route: "admin-overview", match: ["admin-overview", "admin-models", "admin-api-keys", "admin-tools-mcp", "admin-usage", "admin-sessions", "admin-knowledge", "admin-logs"] }
        ],
        sidebar: [
          {
            title: "开始",
            items: [
              { route: "overview", label: "概览", meta: "产品能力 / 场景 / 结构" },
              { route: "quick-start", label: "快速开始", meta: "非 API 方式跑通全流程" }
            ]
          },
          {
            title: "webGenerate",
            items: [
              { route: "webgenerate-cli", label: "CLI 与 npx 用法", meta: "安装 / 卸载 / MCP / 参数" },
              { route: "webgenerate-assistant", label: "编程助手中的 webGenerate", meta: "触发方式 / 输出 / 增量同步" }
            ]
          },
          {
            title: "运行时能力",
            items: [
              { route: "frontend-agent", label: "前端 Agent 能力", meta: "表单 / 路由 / 问答 / 接入" },
              { route: "api-auth", label: "API Key 与鉴权配置", meta: "开发 / 生产 / 跳过 API Key" },
              { route: "mcp", label: "MCP 能力", meta: "服务接入 / 工具编排 / 知识流程" }
            ]
          },
          {
            title: "管理端文档中心",
            items: [
              { route: "admin-overview", label: "后台总览", meta: "角色分工 / 配置流程" },
              { route: "admin-models", label: "Models", meta: "模型源 / 权重 / 探活 / 价格" },
              { route: "admin-api-keys", label: "API Keys", meta: "密钥 / 限流 / 过期 / 启停" },
              { route: "admin-tools-mcp", label: "Tools & MCP", meta: "工具注册 / MCP 服务 / JSON 配置" },
              { route: "admin-usage", label: "Usage", meta: "请求量 / Token / 成本 / 延迟" },
              { route: "admin-sessions", label: "Sessions", meta: "会话追踪 / 历史消息 / 排障" },
              { route: "admin-knowledge", label: "Knowledge", meta: "ZIP 上传 / 在线编辑 / 文档托管" },
              { route: "admin-logs", label: "Logs & Stats", meta: "审计 / 封禁 / 安全监控" }
            ]
          }
        ],
        adminMenu: [
          { route: "admin-overview", label: "后台总览", meta: "功能地图" },
          { route: "admin-models", label: "Models", meta: "模型配置" },
          { route: "admin-api-keys", label: "API Keys", meta: "密钥与限流" },
          { route: "admin-tools-mcp", label: "Tools & MCP", meta: "工具编排" },
          { route: "admin-usage", label: "Usage", meta: "成本与监控" },
          { route: "admin-sessions", label: "Sessions", meta: "对话追踪" },
          { route: "admin-knowledge", label: "Knowledge", meta: "文档中心" },
          { route: "admin-logs", label: "Logs & Stats", meta: "日志审计" }
        ],
        pages: {
          "overview": {
            group: "start",
            groupLabel: "Overview",
            eyebrow: "Open-source project documentation",
            title: "一个把业务知识、编程 Agent 与前端动作真正串起来的开源接入层",
            summary: "它适合需要页面知识理解、问答辅助和受控页面动作的 Web 系统，核心价值是把业务文档、运行时配置和前端 Agent 能力串成一条完整链路。",
            badges: ["Business knowledge driven", "Frontend action safe", "Admin-first operations", "Open source ready"],
            actions: [],
            related: [
              { label: "快速开始", route: "quick-start" },
              { label: "CLI 与 npx 用法", route: "webgenerate-cli" }
            ],
            sections: [
              { id: "overview-capability", title: "核心能力" },
              { id: "overview-scenarios", title: "适用场景" },
              { id: "overview-features", title: "产品特性" },
              { id: "overview-workflow", title: "标准工作流" }
            ],
            html:
              section(
                "overview-capability",
                "核心能力",
                "这部分说明项目真正提供的能力，而不是实现细节。",
                grid(
                  [
                    card(
                      "1. 用业务文档提升编程 Agent 的页面理解能力",
                      "通过 " + inlineCode("webAIDocs/routes.md") + " 与 " + inlineCode("page-xxx.md") + "，把路由结构、页面用途、表单字段和操作步骤沉淀为可复用知识。这样编程 Agent 在改页面、改表单或分析业务逻辑时，可以先理解业务含义，再进入代码。"
                    ),
                    card(
                      "2. 给前端应用增加受控 Agent 动作层",
                      "前端 Widget 不执行任意脚本，只接收受控动作协议，重点支持表单填写、路由跳转与知识问答。这样既能把 AI 带进后台、运营系统和中台页面，又能保持线上页面的安全边界。"
                    ),
                    card(
                      "3. 用管理端统一托管模型、知识与外部能力",
                      "模型、API Key、MCP 和知识文档都在管理端集中配置。前端页面不需要直接处理复杂运行时逻辑，只需要接入统一的 Agent 服务。"
                    ),
                    card(
                      "4. 让知识文档同时服务开发和运行时",
                      "同一份 webAIDocs 既可以让编程助手理解业务页面，也可以让运行时后端回答问题、做路由决策或执行表单动作，避免一份知识维护多处。"
                    )
                  ],
                  "card-grid"
                ) +
                  '<div class="stats-row">' +
                  [
                    statCard("4", "核心能力：知识理解、前端动作、后台配置、能力复用"),
                    statCard("3", "前端默认能力：问答、跳转、表单"),
                    statCard("8+", "管理端模块：模型、密钥、MCP、知识、日志等"),
                    statCard("10", "支持安装到 10 种编程助手或工作台")
                  ].join("") +
                  "</div>" +
                  note("info", "一句话理解", "业务项目负责产出知识文档，管理端负责配置运行时，前端页面负责承接用户最终看到的问答、跳转和表单动作。")
              ) +
              section(
                "overview-scenarios",
                "适用场景",
                "当页面结构稳定、业务流程清晰、又希望把 AI 变成可控产品能力时，这个项目最合适。",
                captionGrid([
                  {
                    title: "后台 / 中台 / 运营系统",
                    body: "把复杂操作流程变成自然语言入口，减少培训成本、重复支持和人工答疑。"
                  },
                  {
                    title: "页面逻辑复杂的业务前端",
                    body: "适合有较多表单、筛选、详情页和多级路由的系统，让 Agent 能先理解页面，再做问答或动作。"
                  },
                  {
                    title: "知识问答 + 页面动作联动",
                    body: "不仅回答“在哪里做、怎么做”，还能直接跳到目标路由，或继续填写表单。"
                  },
                  {
                    title: "多团队复用的接入层",
                    body: "适合把同一套前端 Agent 能力复用到多个业务系统，而不是只做一次性 Demo。"
                  },
                  {
                    title: "编程 Agent 参与业务页面开发",
                    body: "适合希望让 Codex、Claude、Cursor 等编程助手在开发时先看业务文档，再理解页面代码的团队。"
                  },
                  {
                    title: "运行时项目与业务项目分离",
                    body: "适合业务仓库单独维护页面，运行时项目统一托管模型、知识文档和管理后台的架构。"
                  }
                ]) +
                  note("info", "不太适合的场景", "如果你的目标是做开放式浏览器自动化、任意网页抓取或无规则的自由操作，这个项目并不是最合适的选择。它更适合有明确页面结构和业务边界的系统。")
              ) +
              section(
                "overview-features",
                "产品特性",
                "它不是一组零散脚本，而是一条从知识生成到前端接入的完整链路。",
                grid(
                  [
                    miniCard("知识文档复用", "同一份 webAIDocs 可以同时服务 IDE 中的编程 Agent、后端问答服务和前端 Widget。"),
                    miniCard("前端接入轻量", "业务方只需初始化一个 AIAgent，并提供路由跳转能力，即可获得对话式入口。"),
                    miniCard("管理端驱动配置", "模型、API Key、MCP、知识文档都在后台管理，不需要每次改代码。"),
                    miniCard("生产安全可控", "开发环境可直接 selfAuth；生产环境建议由业务后端代发 token，不暴露长期 API Key。"),
                    miniCard("ZIP 上传知识", "生成好的文档直接压缩上传后台，适合外部业务仓库与运行时仓库分离的场景。"),
                    miniCard("文档中心式后台", "把模型、MCP、会话、日志、知识托管拆成独立配置面板，适合团队协作与运维排查。")
                  ],
                  "triplet-grid"
                ) +
                  pills([
                    "Widget runtime",
                    "FastAPI backend",
                    "webGenerate workflow",
                    "MCP enabled",
                    "Admin console",
                    "Open-source deployment"
                  ])
              ) +
              section(
                "overview-workflow",
                "标准工作流",
                "项目推荐的从零到上线链路。",
                steps([
                  {
                    title: "安装 webGenerate 到编程助手",
                    body: "先通过 npx 安装相应平台的 skill / rule / workflow，让助手具备生成业务知识文档的能力。"
                  },
                  {
                    title: "在业务前端项目里生成 webAIDocs",
                    body: "在真实业务仓库中触发 " + inlineCode("$webGenerate .") + " 或 " + inlineCode("/webGenerate .") + "，产出 routes.md 与 page-xxx.md。"
                  },
                  {
                    title: "把文档压缩并上传到管理端",
                    body: "无需手动同步到后端代码目录，直接把 webAIDocs 压成 ZIP，通过 Knowledge 模块上传即可。"
                  },
                  {
                    title: "在后台配置模型、API Key 与 MCP",
                    body: "登录 /admin，完成模型源、密钥策略与工具配置，之后前端即可直接消费统一能力。"
                  },
                  {
                    title: "前端接入 Widget 并完成联调",
                    body: "初始化 AIAgent，连接后端 API 地址，开放路由跳转与表单动作，最终完成业务侧接入。"
                  }
                ])
              )
          },
          "quick-start": {
            group: "start",
            groupLabel: "Quick Start",
            eyebrow: "Run it without hand-writing API calls",
            title: "快速开始",
            summary: "这里按“安装助手工作流 → 生成文档 → 后台上传 ZIP → 配置模型 → 前端接入 Widget”的方式跑通完整闭环，重点是非 API 方式使用。",
            badges: ["No direct API onboarding", "Assistant-first workflow", "ZIP upload ready", "Frontend integration"],
            actions: [],
            related: [
              { label: "编程助手中的 webGenerate", route: "webgenerate-assistant" },
              { label: "后台总览", route: "admin-overview" }
            ],
            sections: [
              { id: "quick-before", title: "开始前你需要准备什么" },
              { id: "quick-flow", title: "五步跑通" },
              { id: "quick-install", title: "安装助手工作流" },
              { id: "quick-generate", title: "生成并上传文档" },
              { id: "quick-console", title: "后台配置模型与密钥" },
              { id: "quick-frontend", title: "前端接入" }
            ],
            html:
              section(
                "quick-before",
                "开始前你需要准备什么",
                "这一页默认你是第一次接这个项目。",
                grid(
                  [
                    miniCard("1. 一个业务前端项目", "它可以是后台系统、运营平台或任何有固定页面和路由的 Web 应用。webGenerate 需要在这个业务项目里生成文档。"),
                    miniCard("2. 当前这个运行时项目", "也就是包含 backend、docs、src 和管理端的项目。它负责托管知识文档、配置模型并对前端提供 Agent 服务。"),
                    miniCard("3. 基础环境", "建议准备 Node.js 18+；如果要本地启动后端，再准备 Python 3.11+。"),
                    miniCard("4. 一个编程助手", "例如 Codex、Claude、Cursor、Gemini、Trae、Copilot 等。先装 webGenerate，再在助手中触发生成。")
                  ],
                  "triplet-grid"
                ) +
                  note("warn", "容易混淆的点", "webGenerate 不是在当前运行时项目里扫描页面，而是在你的业务前端项目里生成知识文档。生成完再把文档通过 ZIP 上传到当前项目的管理端。")
              ) +
              section(
                "quick-flow",
                "五步跑通",
                "适合第一次接入时直接照着做。",
                steps([
                  { title: "安装 webGenerate", body: "给你的编程助手装上 webGenerate，对业务项目生成可读知识文档。" },
                  { title: "生成 webAIDocs", body: "在业务前端仓库中触发 slash / dollar 命令，自动输出 routes.md 与 page-xxx.md。" },
                  { title: "压缩 webAIDocs", body: "把整份目录压成 ZIP，准备上传到后台 Knowledge 模块。" },
                  { title: "登录管理端配置模型", body: "完成管理员初始化、创建 API Key、配置模型和 MCP 服务。" },
                  { title: "在前端初始化 AIAgent", body: "对接 backendUrl、apiKey 或 token，开放 routerPush，即可开始路由跳转和表单动作。" }
                ]) +
                  note("warn", "快速开始重点", "本章节强调的是“产品化接入路径”，也就是先用助手生成文档、再用后台上传和配置，而不是直接手写接口调用。你只要按顺序把每一步做完，就能得到一个能回答页面问题、能跳路由、能做表单动作的前端 Agent。")
              ) +
              section(
                "quick-install",
                "安装助手工作流",
                "先把生成能力装到你常用的编程助手中。",
                "<p>项目的 CLI 负责安装 skill / rule / workflow，本身不直接扫描页面。你只需要运行对应平台的安装命令，之后在业务仓库中触发助手命令即可。</p>" +
                  codeBlock("bash", installAll) +
                  table(
                    ["平台", "安装命令", "安装后怎么触发"],
                    [
                      ["Codex", inlineCode("npx portable-ai-agent-widget codex install"), inlineCode("$webGenerate .")],
                      ["Claude / Cursor / Gemini / Trae", inlineCode("npx portable-ai-agent-widget <platform> install"), inlineCode("/webGenerate .")],
                      ["Copilot CLI / VS Code Copilot / OpenCode", "同样走 install", "让助手执行 webGenerate 工作流或 slash 命令"]
                    ]
                  ) +
                  note("info", "怎么判断安装成功", "安装成功后，一般会在你的助手目录或工作区中写入对应 skill / rule 文件。更直观的判断方式是：进入业务项目后，你已经可以在助手里使用 /webGenerate 或 $webGenerate 触发生成。")
              ) +
              section(
                "quick-generate",
                "生成并上传文档",
                "业务知识文档是整个系统的输入源。",
                "<p>安装完成后，在你的业务前端项目中执行生成命令。生成结果固定落在 " +
                  inlineCode("webAIDocs/") +
                  " 目录。建议把整个目录压缩为 ZIP，直接上传到后台 Knowledge 模块，避免手动逐个拷贝。</p>" +
                  codeBlock("bash", assistantTriggers) +
                  mediaGrid([
                    video(ASSET.videos.generate, "文档生成演示：先安装工作流，再在业务仓库里触发 webGenerate，最后得到可上传的 webAIDocs。"),
                    image(ASSET.images.knowledgeFlow, "Knowledge 文档流转示意：业务仓库产出文档，运行时项目通过后台统一托管。")
                  ]) +
                  note("info", "生成完成后检查什么", "至少确认 webAIDocs 目录里存在 routes.md，以及若干 page-xxx.md。没有这些文件时，后续问答和页面动作质量会明显下降。") +
                  note("warn", "推荐上传方式", "如果你的业务项目和运行时项目不在同一个仓库，ZIP 上传是最稳妥的知识同步方式。不要只复制 routes.md 而漏掉 page 文档。")
              ) +
              section(
                "quick-console",
                "后台配置模型与密钥",
                "上传文档之后，在管理端把运行时能力配齐。",
                "<p>进入 " +
                  inlineCode("http://localhost:4096/admin") +
                  " 后，按下面顺序完成初始化：</p>" +
                  codeBlock("env", envExample) +
                  linkRows([
                    { title: "Models", body: "添加模型源、设置 baseURL / apiKey / 权重 / 单价，并执行探活。" },
                    { title: "API Keys", body: "创建供前端或业务后端使用的调用密钥，配置过期时间和每分钟限流。" },
                    { title: "Knowledge", body: "上传 ZIP 或单文件，必要时在线编辑文档内容。" },
                    { title: "Tools & MCP", body: "根据业务场景启用外部工具或 MCP 服务。" }
                  ]) +
                  mediaGrid([
                    image(ASSET.images.adminControl, "后台总控视图：从这里进入模型、知识、密钥、MCP 等配置模块。"),
                    image(ASSET.images.adminKnowledge, "Knowledge 模块：支持 ZIP 上传、文件管理与在线编辑。")
                  ]) +
                  note("info", "建议顺序", "第一次进入后台时，不要试图同时配所有菜单。建议只做四件事：改管理员密码、配一个可用模型、创建一把 API Key、上传一份 webAIDocs ZIP。其余能力等基础链路跑通后再补。")
              ) +
              section(
                "quick-frontend",
                "前端接入",
                "跑通最短路径时，先用 selfAuth=true 完成联调。",
                "<p>如果只是本地联调，前端可以直接传 " +
                  inlineCode("apiKey") +
                  " 并开启 " +
                  inlineCode("selfAuth=true") +
                  "。这会让 Widget 自动向后端换取 token。等到准备上线时，再切到业务后端代发 token 的生产接法。</p>" +
                  codeBlock("ts", frontendQuickStart) +
                  mediaGrid([
                    image(ASSET.images.frontend, "前端接入效果：Widget 与页面知识、动作协议、后台配置一起工作。"),
                    image(ASSET.images.frontendRuntime, "运行时接入截图：在真实业务页面中展示对话入口与受控动作。")
                  ]) +
                  note("info", "跑通后你应该看到什么", "前端页面里会出现 Agent 入口。此时你应该能让它回答页面问题、跳转到某个路由，或者尝试填充一个简单表单。") +
                  note("warn", "生产环境建议", "上线时优先使用 selfAuth=false，不要把长期 API Key 直接下发到浏览器。")
              )
          },
          "webgenerate-cli": {
            group: "webGenerate",
            groupLabel: "webGenerate CLI",
            eyebrow: "Install, uninstall, and expose MCP",
            title: "webGenerate 的 CLI / npx 全部用法",
            summary: "CLI 的职责是把 webGenerate 安装进不同编程助手，或以 MCP Server 方式暴露知识文档能力；真正的文档生成动作发生在助手内部。",
            badges: ["Install workflow", "10 platforms", "Alias support", "MCP server mode"],
            actions: [],
            related: [
              { label: "快速开始", route: "quick-start" },
              { label: "MCP 能力", route: "mcp" }
            ],
            sections: [
              { id: "cli-beginner", title: "先记住什么" },
              { id: "cli-positioning", title: "定位" },
              { id: "cli-syntax", title: "命令语法" },
              { id: "cli-platforms", title: "平台与参数" },
              { id: "cli-mcp", title: "MCP 模式" }
            ],
            html:
              section(
                "cli-beginner",
                "先记住什么",
                "如果你刚接触 webGenerate，先记住下面三句话。",
                steps([
                  { title: "第一句：先 install，再生成", body: "npx 命令只是在助手里安装生成能力，不会立刻产出 webAIDocs。" },
                  { title: "第二句：真正生成发生在助手内部", body: "你需要进入业务项目，在 Codex 用 $webGenerate，在其他助手用 /webGenerate。" },
                  { title: "第三句：生成的目标是业务知识文档", body: "最终你想得到的是 routes.md 和 page-xxx.md，而不是某种代码脚手架。" }
                ])
              ) +
              section(
                "cli-positioning",
                "定位",
                "先分清 CLI 做什么，不做什么。",
                grid(
                  [
                    card("CLI 负责安装", "把 skill、rule、hook、workspace instruction 写入 Claude、Codex、Cursor、Gemini、Copilot 等对应目录。"),
                    card("CLI 不直接生成文档", "生成 routes.md 和 page-xxx.md 的动作，必须在装好工作流后的编程助手里触发。")
                  ],
                  "duo-grid"
                ) +
                  note("info", "一个关键认知", "看到 npx 命令并不代表已经生成文档；npx 只是把“生成能力”安装到助手。")
              ) +
              section(
                "cli-syntax",
                "命令语法",
                "适合做安装、卸载、平台切换与 MCP 暴露。",
                codeBlock(
                  "bash",
                  [
                    "webGenerate <platform> install",
                    "webGenerate <platform> uninstall",
                    "webGenerate install --platform codex",
                    "webGenerate MCP",
                    "webGenerate MCP --root ./your-project"
                  ].join("\n")
                ) +
                  table(
                    ["命令", "作用", "说明"],
                    [
                      [inlineCode("webGenerate <platform> install"), "安装 webGenerate 工作流", "最常用命令。会写入对应平台的 skill / rule / hook。"],
                      [inlineCode("webGenerate <platform> uninstall"), "卸载工作流", "移除平台侧配置，不会删除你的业务文档。"],
                      [inlineCode("webGenerate install --platform codex"), "等价安装写法", "适合自动化脚本或统一命令模板。"],
                      [inlineCode("webGenerate MCP"), "启动 MCP Server", "供其他 Agent / IDE 通过 MCP 读取 routes/page 文档。"],
                      [inlineCode("webGenerate MCP --root ./your-project"), "显式指定知识根目录", "多项目或 monorepo 场景更稳妥。"]
                    ]
                  )
              ) +
              section(
                "cli-platforms",
                "平台与参数",
                "当前支持的安装平台与平台别名。",
                table(
                  ["平台参数", "对应产品", "安装后入口"],
                  [
                    ["codex", "Codex", inlineCode("$webGenerate .")],
                    ["claude", "Claude Code", inlineCode("/webGenerate .")],
                    ["opencode", "OpenCode", "助手工作流 / slash 触发"],
                    ["copilot-cli", "GitHub Copilot CLI", "工作流或 Agent chat 触发"],
                    ["vscode-copilot", "VS Code Copilot Chat", "工作流或 Agent chat 触发"],
                    ["gemini", "Gemini CLI", inlineCode("/webGenerate .")],
                    ["antigravity", "Google Antigravity", "slash workflow"],
                    ["cursor", "Cursor", "Cursor Agent / slash workflow"],
                    ["trae", "Trae", inlineCode("/webGenerate .")],
                    ["trae-cn", "Trae CN", inlineCode("/webGenerate .")]
                  ]
                ) +
                  codeBlock("bash", installAll)
              ) +
              section(
                "cli-mcp",
                "MCP 模式",
                "把 webGenerate 生成的知识文档以 MCP 能力对外暴露。",
                "<p>MCP 模式适合两类场景：一类是让其他 Agent 通过标准工具协议读取路由与页面文档；另一类是让多仓库环境中的开发工具统一查询业务知识，而不是自行到磁盘里盲搜。</p>" +
                  codeBlock("bash", mcpCommand) +
                  captionGrid([
                    { title: "list_routes", body: "从 routes.md 中列出系统路由，适合定位业务页面。"},
                    { title: "search_routes", body: "按关键词查找候选页面，适合“我只知道业务名、不知道路由”的场景。"},
                    { title: "get_page_doc", body: "按路径、标题或文档名读取具体 page-xxx.md。"},
                    { title: "list_page_docs", body: "直接列出当前知识目录下的 page 文档。" }
                  ]) +
                  note("warn", "注意", "MCP 模式是读取知识文档，不是替代前端 Widget 或后端问答 API。它更像开发工作台里的知识查询层。")
              )
          },
          "webgenerate-assistant": {
            group: "webGenerate",
            groupLabel: "Assistant Workflow",
            eyebrow: "Slash or dollar command inside assistants",
            title: "编程助手中的 webGenerate 全部用法",
            summary: "安装完成后，真正高频使用的是助手内部触发命令：全量生成、增量同步、指定项目路径，以及围绕输出文档进行开发协作。",
            badges: ["Full generation", "Incremental update", "Assistant-native", "Knowledge-first development"],
            actions: [
              { label: "回看 CLI 安装", route: "webgenerate-cli", kind: "secondary" }
            ],
            related: [
              { label: "快速开始", route: "quick-start" },
              { label: "前端 Agent 能力", route: "frontend-agent" }
            ],
            sections: [
              { id: "assistant-prepare", title: "生成前准备" },
              { id: "assistant-trigger", title: "触发命令" },
              { id: "assistant-params", title: "参数说明" },
              { id: "assistant-output", title: "输出与使用方式" },
              { id: "assistant-best-practice", title: "最佳实践" }
            ],
            html:
              section(
                "assistant-prepare",
                "生成前准备",
                "避免第一次触发时不知道在哪个目录执行。",
                "<ul>" +
                  "<li>先确认你已经在对应助手里执行过 install。</li>" +
                  "<li>切到真实业务前端项目根目录，而不是当前运行时项目根目录。</li>" +
                  "<li>确保这个项目里确实存在路由、页面组件、表单或业务页面结构，否则生成内容会非常有限。</li>" +
                  "<li>如果是首次生成，优先不用 " + inlineCode("--update") + "，先做一次全量输出。 </li>" +
                  "</ul>" +
                  note("info", "目录判断技巧", "如果你当前所在项目里没有业务页面源码，只看到 backend、docs、src 这类运行时目录，那大概率不是应该执行 webGenerate 的地方。")
              ) +
              section(
                "assistant-trigger",
                "触发命令",
                "不同助手的前缀不同，但语义一致。",
                codeBlock("bash", assistantTriggers) +
                  table(
                    ["写法", "含义", "适合什么时候用"],
                    [
                      [inlineCode("$webGenerate ."), "Codex 全量生成", "首次接入或页面结构变动较大时。"],
                      [inlineCode("$webGenerate . --update"), "Codex 增量同步", "改完页面后只更新受影响文档。"],
                      [inlineCode("/webGenerate ."), "其他助手全量生成", "首次生成 webAIDocs。"],
                      [inlineCode("/webGenerate . --update"), "其他助手增量同步", "业务页面小步迭代后同步知识。"]
                    ]
                  )
              ) +
              section(
                "assistant-params",
                "参数说明",
                "当前常用参数不多，但每个都很关键。",
                table(
                  ["参数", "说明", "示例"],
                  [
                    [inlineCode("."), "当前工作区作为业务项目根目录", inlineCode("/webGenerate .")],
                    [inlineCode("./path/to/project"), "显式指定目标项目路径", inlineCode("/webGenerate ./apps/admin")],
                    [inlineCode("--update"), "只同步变化文件，避免每次全量重建", inlineCode("/webGenerate . --update")]
                  ]
                ) +
                  note("info", "为什么只保留少量参数", "这个工作流刻意保持简单：路径决定扫描范围，--update 决定同步策略，输出目录固定，减少团队协作时的认知差异。")
              ) +
              section(
                "assistant-output",
                "输出与使用方式",
                "输出很稳定，便于纳入版本管理和后台托管。",
                "<p>标准输出为：</p>" +
                  codeBlock(
                    "text",
                    [
                      "webAIDocs/",
                      "  routes.md",
                      "  page-xxx.md",
                      "  page-yyy.md"
                    ].join("\n")
                  ) +
                  captionGrid([
                    { title: "routes.md", body: "系统级总索引。告诉 Agent 页面有哪些、各自对应什么组件与文档。" },
                    { title: "page-xxx.md", body: "页面级知识。描述用途、功能、表单字段、操作步骤和注意事项。" },
                    { title: "开发时怎么用", body: "先读 routes，再读目标 page 文档，再去找组件 / store / API 文件。"},
                    { title: "运行时怎么用", body: "后端或管理端直接消费这些文档，为前端问答和动作决策提供上下文。"}
                  ]) +
                  note("info", "生成后立即检查", "打开 routes.md 看看主要路由是否都在，随机抽查 1 到 2 个 page 文档，看字段、按钮和步骤是否像你当前页面。这样能尽早发现生成范围不对或页面识别不完整。")
              ) +
              section(
                "assistant-best-practice",
                "最佳实践",
                "把 webGenerate 视为“知识同步动作”，而不是一次性脚本。",
                "<ul>" +
                  "<li>首次接入时做一次全量生成，随后把 " + inlineCode("--update") + " 变成页面开发后的固定收尾动作。</li>" +
                  "<li>业务页面大改版、菜单重构、表单字段变化时，优先同步 webAIDocs，再让 Agent 接着开发。</li>" +
                  "<li>多仓库场景优先使用 ZIP 上传到后台，而不是依赖人工复制 page 文档。</li>" +
                  "<li>如果团队里同时使用 Codex 与其他助手，统一规定文档输出目录为 " + inlineCode("webAIDocs") + "，保持消费方式一致。</li>" +
                  "</ul>" +
                  note("warn", "当前环境说明", "这里展示的是助手触发命令本身。它不是普通 shell 命令，因此文档中写法可以直接照用，但在终端里不能把它当作独立可执行程序来跑。")
              )
          },
          "frontend-agent": {
            group: "runtime",
            groupLabel: "Frontend Agent",
            eyebrow: "Form, route, and knowledge in one widget",
            title: "前端 Agent 能力",
            summary: "前端侧聚焦三类核心体验：表单填写、路由跳转、知识问答。它不是开放式浏览器自动化，而是为业务页面设计的可控动作运行时。",
            badges: ["Form action", "Route navigation", "Knowledge Q&A", "Safe frontend runtime"],
            actions: [],
            related: [
              { label: "快速开始", route: "quick-start" },
              { label: "MCP 能力", route: "mcp" }
            ],
            sections: [
              { id: "frontend-ready", title: "接入前准备" },
              { id: "frontend-capability", title: "三类能力" },
              { id: "frontend-integration", title: "接入方式" },
              { id: "frontend-videos", title: "视频演示" },
              { id: "frontend-runtime", title: "运行时边界" }
            ],
            html:
              section(
                "frontend-ready",
                "接入前准备",
                "先准备好最小接入清单，后面会顺很多。",
                grid(
                  [
                    miniCard("后端地址", "你需要知道运行时后端的 API 地址，例如 http://localhost:4096/api。"),
                    miniCard("鉴权策略", "先决定是开发态用 selfAuth=true，还是生产态由业务后端代发 token。"),
                    miniCard("路由能力", "如果要支持跳转，前端要能把 navigate 动作接到 router.push 之类的方法。"),
                    miniCard("一个真实页面", "建议从一个有筛选表单、详情跳转或清晰业务说明的页面开始联调。")
                  ],
                  "card-grid"
                ) +
                  note("info", "联调建议", "先只验证一个页面，不要一开始就想让它覆盖整个系统。通常先跑通“问答 + 跳转”或“问答 + 简单表单”就够了。")
              ) +
              section(
                "frontend-capability",
                "三类能力",
                "让终端用户直接感知到的产品价值。",
                grid(
                  [
                    card("表单填写", "返回 form 动作，用于搜索条件、筛选面板、录入表单、分页参数等页面输入操作。"),
                    card("路由跳转", "返回 navigate 动作，由你自己的 router 来执行页面切换，适合后台系统中的业务导航。"),
                    card("知识问答", "结合当前 pathname、管理端上传的知识文档与会话上下文，回答“这个页面做什么、在哪里配置、下一步怎么操作”等问题。"),
                    card("可控扩展", "通过后端模型与 MCP 能力，把动作、知识、工具编排统一在管理端配置，不把复杂性塞给浏览器。")
                  ],
                  "card-grid"
                )
              ) +
              section(
                "frontend-integration",
                "接入方式",
                "接入门槛很低，但建议一开始就保留路由与权限边界。",
                "<p>最常见的前端接入项包括 " +
                  inlineCode("backendUrl") +
                  "、" +
                  inlineCode("routerPush") +
                  "、" +
                  inlineCode("selfAuth") +
                  " 和 token / apiKey 策略。页面只暴露“允许 AI 做什么”，不直接暴露任意脚本执行能力。</p>" +
                  codeBlock(
                    "ts",
                    [
                      'import AIAgent from "portable-ai-agent-widget";',
                      "",
                      "AIAgent.init({",
                      '  backendUrl: "http://localhost:4096/api",',
                      '  apiKey: "sk-your-api-key",',
                      "  selfAuth: true,",
                      "  routerPush: (route) => router.push(route)",
                      "});",
                      "",
                      'await AIAgent.sendMessage("带我去用户管理并告诉我这个页面怎么筛选");'
                    ].join("\n")
                  ) +
                  image(ASSET.images.frontend, "前端接入示意：对话、路由、知识与受控动作在同一页面里工作。")
              ) +
              section(
                "frontend-videos",
                "视频演示",
                "视频默认使用 contain 展示，完整画面不会被裁切。",
                mediaGrid([
                  video(ASSET.videos.form, "表单填写：根据自然语言填充查询条件或业务表单。"),
                  video(ASSET.videos.route, "路由跳转：结合业务知识定位正确页面并触发前端路由切换。"),
                  video(ASSET.videos.qa, "知识问答：基于页面知识文档回答业务说明、步骤和注意事项。")
                ])
              ) +
              section(
                "frontend-runtime",
                "运行时边界",
                "这个项目强调“像产品能力一样可控”，而不是浏览器自动化。",
                "<ul>" +
                  "<li>前端只执行白名单动作，不执行任意脚本。</li>" +
                  "<li>真正的模型调用、知识检索与工具编排在后端完成，浏览器只接收受控结果。</li>" +
                  "<li>生产环境中推荐由你的业务服务控制 token 发放，从源头限制调用范围。</li>" +
                  "<li>对 B 端复杂页面来说，这种边界更适合真实上线，而不是实验性自动化。 </li>" +
                  "</ul>" +
                  image(ASSET.images.widgetConsole, "Widget 运行态示意：用户通过统一入口触发问答、导航和页面动作。")
              )
          },
          "api-auth": {
            group: "runtime",
            groupLabel: "Auth & API Key",
            eyebrow: "Configure API keys instead of hand-writing endpoints",
            title: "API Key 与鉴权配置",
            summary: "这里只讲怎么配置 apiKey、前端怎么接、生产环境怎么做，以及如何在本地开发时跳过 API Key；不展开接口目录。",
            badges: ["selfAuth=true", "selfAuth=false", "Production token proxy", "Skip API key in dev"],
            actions: [],
            related: [
              { label: "前端 Agent 能力", route: "frontend-agent" },
              { label: "后台总览", route: "admin-overview" }
            ],
            sections: [
              { id: "auth-choose", title: "如何选择模式" },
              { id: "auth-modes", title: "三种接法" },
              { id: "auth-frontend", title: "前端怎么配置" },
              { id: "auth-production", title: "生产环境配置" },
              { id: "auth-skip", title: "如何跳过 API Key" }
            ],
            html:
              section(
                "auth-choose",
                "如何选择模式",
                "如果你不确定该选哪种模式，可以直接按这个规则走。",
                steps([
                  { title: "只是本地跑通功能", body: "优先用 selfAuth=true。这样最简单，前端直接传 apiKey 即可。" },
                  { title: "已经准备上线或进入正式联调", body: "改成 selfAuth=false，由你的业务后端提供 getToken。" },
                  { title: "只是想临时验证页面动作", body: "可以短时间开启 DISABLE_AGENT_AUTH=true，但只限本地开发。"}
                ]) +
                  note("warn", "常见误区", "很多情况下会一开始就直接做生产鉴权，结果前端、后端、登录态一起卡住。更稳妥的顺序是：先 selfAuth 跑通，再切生产模式。")
              ) +
              section(
                "auth-modes",
                "三种接法",
                "先根据环境选择鉴权模式，再决定前端代码长什么样。",
                table(
                  ["模式", "适合场景", "前端需要什么"],
                  [
                    [inlineCode("selfAuth=true"), "本地联调 / 内网演示", "直接传 apiKey，Widget 自动换 token。"],
                    [inlineCode("selfAuth=false"), "生产环境", "前端不拿长期 apiKey，只实现 getToken。"],
                    [inlineCode("DISABLE_AGENT_AUTH=true"), "临时调试或集成验证", "前端既不用 apiKey，也不用 getToken。"]
                  ]
                ) +
                  note("warn", "生产环境建议", "真正上线时优先使用 selfAuth=false，把长期 API Key 放在你自己的服务端，而不是浏览器。")
              ) +
              section(
                "auth-frontend",
                "前端怎么配置",
                "最常见的是开发态和生产态两份初始化配置。",
                "<p>开发态直接配置 " + inlineCode("apiKey") + " 最快：</p>" +
                  codeBlock("ts", frontendQuickStart) +
                  "<p>如果你已经有登录态和业务后端，推荐从一开始就使用 token 代发模式：</p>" +
                  codeBlock("ts", productionAuth)
              ) +
              section(
                "auth-production",
                "生产环境配置",
                "让业务后端代发 token，前端只拿短期凭证。",
                "<p>推荐在运行时服务端配置如下基础环境变量：</p>" +
                  codeBlock("env", envExample) +
                  "<p>然后由你的业务服务保存真正的 API Key，并提供一个 " + inlineCode("/internal/agent/token") + " 之类的内部接口。Widget 每次只拿短期 token，过期后自动重新获取。</p>" +
                  captionGrid([
                    { title: "为什么不下发长期 apiKey", body: "长期 Key 一旦暴露在浏览器中，就可能被复制并脱离你的业务页面直接调用。"},
                    { title: "为什么要短期 token", body: "便于和登录态、角色权限、风控策略绑定，也便于轮换与撤销。"},
                    { title: "管理员侧怎么配合", body: "先在后台创建 API Key，再由业务后端使用这把 Key 去换短期 token。"},
                    { title: "运维建议", body: "把后台、密钥文件和生产模型配置留在内网或受限网络，不直接暴露公网。"}
                  ])
              ) +
              section(
                "auth-skip",
                "如何跳过 API Key",
                "本地调试时可以更轻量，但请明确只适用于开发环境。",
                "<p>如果你只是想验证 Widget 是否能正常发消息、跳路由、触发表单动作，可以在后端环境变量里开启 " +
                  inlineCode("DISABLE_AGENT_AUTH=true") +
                  "。开启后前端可以不传 " +
                  inlineCode("apiKey") +
                  "，也不实现 " +
                  inlineCode("getToken") +
                  "。</p>" +
                  codeBlock("env", skipAuthCode) +
                  note("danger", "不要带到生产环境", "关闭鉴权只适合本地调试与联调验证，不建议在正式环境或开放网络中使用。")
              )
          },
          "mcp": {
            group: "runtime",
            groupLabel: "MCP",
            eyebrow: "Knowledge tools and external capability composition",
            title: "MCP 能力详解",
            summary: "MCP 在这个项目里有两层含义：一层是让 webGenerate 文档以 MCP 工具方式被外部 Agent 读取；另一层是管理端把外部 MCP Server 编排进运行时能力。",
            badges: ["Knowledge MCP", "Tool composition", "Admin managed", "Agent friendly"],
            actions: [
              { label: "查看 Tools & MCP 后台", route: "admin-tools-mcp", kind: "primary" }
            ],
            related: [
              { label: "CLI 与 npx 用法", route: "webgenerate-cli" },
              { label: "后台总览", route: "admin-overview" }
            ],
            sections: [
              { id: "mcp-layers", title: "两层能力" },
              { id: "mcp-webgenerate", title: "webGenerate 作为 MCP" },
              { id: "mcp-admin", title: "管理端中的 MCP" },
              { id: "mcp-usecases", title: "适用场景" }
            ],
            html:
              section(
                "mcp-layers",
                "两层能力",
                "先把 MCP 在项目中的角色拆开看。",
                grid(
                  [
                    card("开发工作台里的 MCP", "通过 " + inlineCode("webGenerate MCP") + " 把 routes/page 文档暴露为标准工具，方便其他 Agent 查询业务知识。"),
                    card("运行时后台里的 MCP", "在 Tools & MCP 模块中登记外部 MCP Server，把它们变成后端可调用能力，再供前端 Widget 间接使用。")
                  ],
                  "duo-grid"
                )
              ) +
              section(
                "mcp-webgenerate",
                "webGenerate 作为 MCP",
                "它更像面向 Agent 的知识检索入口。",
                codeBlock("bash", mcpCommand) +
                  table(
                    ["工具名", "作用", "适合场景"],
                    [
                      ["list_routes", "列出系统路由", "想快速浏览业务页面地图。"],
                      ["search_routes", "按关键词查路由", "只知道业务名，不知道具体路径。"],
                      ["get_page_doc", "读取页面文档", "需要让 Agent 理解某个表单或页面操作。"],
                      ["list_page_docs", "列出 page 文档", "做知识目录检查或增量同步前核对。"]
                    ]
                  ) +
                  video(ASSET.videos.mcp, "MCP 能力演示：把知识文档和外部工具编排进 Agent 工作流。")
              ) +
              section(
                "mcp-admin",
                "管理端中的 MCP",
                "后台把外部服务做成可探活、可启停、可编辑的配置项。",
                "<p>Tools & MCP 页面支持按 JSON 编辑服务配置、执行 probe 探活、启停单个服务，并展示当前启用数量。对于多业务团队来说，这种集中管理方式比把工具配置散落在代码里更容易维护。</p>" +
                  mediaGrid([
                    image(ASSET.images.adminMcp, "MCP 模块总览：查看当前服务、启停状态与探活结果。"),
                    image(ASSET.images.adminMcpAdd, "新增 / 编辑 MCP：通过 JSON 表达工具端点与连接信息。")
                  ])
              ) +
              section(
                "mcp-usecases",
                "适用场景",
                "MCP 最适合做“外部知识或能力接入层”。",
                captionGrid([
                  { title: "知识查阅", body: "让 Agent 先查业务路由和页面说明，再决定如何回答或开发。"},
                  { title: "外部工具编排", body: "把企业内部工具、知识库或服务代理成 MCP Server 后统一接入。"},
                  { title: "多仓库协作", body: "运行时项目与业务前端项目分离时，用 MCP 补齐跨仓知识检索。"},
                  { title: "受控扩展", body: "相比浏览器直接拿外部能力，后台统一编排更适合生产治理。"}
                ]) +
                  note("info", "选择建议", "如果你的主要目标是让 Agent 理解页面，先把 webGenerate 文档链路跑通；如果还需要接外部知识或系统，再把 MCP 作为第二阶段能力引入。")
              )
          },
          "admin-overview": {
            group: "admin",
            groupLabel: "Admin Center",
            eyebrow: "Documentation center for configuration and operations",
            title: "管理端总览",
            summary: "管理端不是简单的配置弹窗集合，而是整个运行时的文档中心：模型、API Key、MCP、知识库、会话、日志、统计都集中在这里。",
            badges: ["Doc-center style", "Admin-first operations", "Knowledge hosting", "Runtime observability"],
            actions: [],
            related: [
              { label: "快速开始", route: "quick-start" },
              { label: "API Key 与鉴权配置", route: "api-auth" }
            ],
            sections: [
              { id: "admin-firstday", title: "第一次登录先做什么" },
              { id: "admin-map", title: "功能地图" },
              { id: "admin-flow", title: "建议配置顺序" },
              { id: "admin-roles", title: "适合谁来用" },
              { id: "admin-submenus", title: "子菜单总览" }
            ],
            html:
              section(
                "admin-firstday",
                "第一次登录先做什么",
                "把第一次进入后台的动作压缩到最少。",
                steps([
                  { title: "先修改管理员密码", body: "默认密码不能直接用于正式登录，先完成初始化。" },
                  { title: "去 Models 配一个能探活成功的模型", body: "没有可用模型，后面所有问答和动作都跑不起来。" },
                  { title: "去 API Keys 创建一把 Key", body: "本地前端联调通常会用到它。" },
                  { title: "去 Knowledge 上传 webAIDocs ZIP", body: "没有知识文档时，页面问答只会停留在很泛的层面。" },
                  { title: "最后再看 Usage、Sessions、Logs", body: "这些模块更适合在链路跑通后做观察和排障。" }
                ]) +
                  note("info", "建议路线", "如果当前目标只是“跑通第一个页面”，后台只需要重点关注 Models、API Keys 和 Knowledge 三个菜单。")
              ) +
              section(
                "admin-map",
                "功能地图",
                "把管理端当成部署与运营控制台来理解。",
                mediaGrid([
                  image(ASSET.images.adminControl, "后台总览：文档中心式入口，统一进入模型、密钥、知识、会话与日志模块。"),
                  image(ASSET.images.adminKnowledge, "Knowledge 模块：支撑业务知识文档长期托管与在线维护。")
                ]) +
                  grid(
                    [
                      miniCard("Models", "配置模型源、baseURL、apiKey、探活状态、价格和负载均衡。"),
                      miniCard("API Keys", "创建与轮换业务调用密钥，控制有效期、启停与限流。"),
                      miniCard("Tools & MCP", "注册外部 MCP 服务和工具能力，用于增强模型回答或动作。"),
                      miniCard("Usage", "查看请求量、Token、成本与延迟。"),
                      miniCard("Sessions", "回看用户会话与消息，用于排障与优化。"),
                      miniCard("Knowledge", "上传 ZIP、在线编辑页面知识文档。"),
                      miniCard("Logs & Stats", "查看封禁 IP、请求状态、后台审计与整体统计。")
                    ],
                    "triplet-grid"
                  )
              ) +
              section(
                "admin-flow",
                "建议配置顺序",
                "这样最容易减少接入过程中的反复试错。",
                steps([
                  { title: "先改管理员密码并启动后台", body: "首次启动需要修改默认密码，否则后台登录会被拒绝。" },
                  { title: "配置 Models", body: "先保证至少有一个可用模型，后续问答和动作才有稳定输出。" },
                  { title: "创建 API Keys", body: "为前端调试、业务后端代发 token 或多环境使用准备调用密钥。" },
                  { title: "上传 Knowledge", body: "把 webAIDocs 作为 ZIP 上传，让问答和动作有业务知识上下文。" },
                  { title: "视业务情况启用 MCP", body: "需要外部工具或额外知识源时，再在 Tools & MCP 中完成编排。" },
                  { title: "上线后盯 Usage / Sessions / Logs", body: "成本、会话、错误与安全审计都从这里统一追踪。" }
                ])
              ) +
              section(
                "admin-roles",
                "适合谁来用",
                "管理端适合被多个角色共同使用，而不是只给开发者。",
                captionGrid([
                  { title: "实施 / 解决方案团队", body: "负责初始化模型、密钥、知识库和路由联调。"},
                  { title: "前端负责人", body: "关注接入方式、动作边界和知识文档质量。"},
                  { title: "运维 / 平台团队", body: "关注密钥轮换、成本、日志、封禁和后台暴露范围。"},
                  { title: "业务运营", body: "可在 Knowledge 中修正文档描述，而不必每次走代码发布。"}
                ])
              ) +
              section(
                "admin-submenus",
                "子菜单总览",
                "每个子菜单都应该被理解成一个“可单独查阅的产品模块”。",
                linkRows([
                  { title: "Models", body: "模型接入策略与负载均衡中心" },
                  { title: "API Keys", body: "前端 / 业务服务调用凭证中心" },
                  { title: "Tools & MCP", body: "外部能力接入与工具编排中心" },
                  { title: "Usage", body: "成本和性能观测中心" },
                  { title: "Sessions", body: "业务会话追踪中心" },
                  { title: "Knowledge", body: "业务知识上传、编辑、托管中心" },
                  { title: "Logs & Stats", body: "安全审计、封禁与整体运行状态中心" }
                ])
              )
          },
          "admin-models": {
            group: "admin",
            groupLabel: "Admin / Models",
            eyebrow: "Model routing and pricing center",
            title: "Models",
            summary: "Models 页面负责把“这个项目用什么模型、从哪儿调用、是否可用、价格怎么算、如何做负载均衡”全部收口到一个地方。",
            badges: ["Provider", "baseURL", "apiKey", "Probe", "Pricing", "Load balancing"],
            actions: [],
            related: [
              { label: "API Keys", route: "admin-api-keys" },
              { label: "Usage", route: "admin-usage" }
            ],
            sections: [
              { id: "models-fields", title: "可配置项" },
              { id: "models-probe", title: "探活与状态" },
              { id: "models-pricing", title: "计费字段" },
              { id: "models-balance", title: "负载均衡" }
            ],
            html:
              section(
                "models-fields",
                "可配置项",
                "模型接入时最重要的字段都在这里。",
                table(
                  ["字段", "用途", "为什么重要"],
                  [
                    ["provider", "选择 OpenAI Compatible 或 Anthropic", "决定探活方式与请求协议。"],
                    ["model / name", "标识模型名与展示名称", "后续 Usage、日志与排障都要靠它识别。"],
                    ["baseURL", "供应商地址", "适配官方 API 或兼容代理地址。"],
                    ["apiKey", "供应商密钥", "真正调用模型的凭证，应妥善保管。"],
                    ["enabled", "启停模型", "可快速把异常模型移出生产流量。"],
                    ["weight", "权重", "与负载均衡策略配合使用。"]
                  ]
                ) +
                  mediaGrid([
                    image(ASSET.images.adminModels, "Models 总览：集中查看已接入模型、状态和配置。"),
                    image(ASSET.images.adminModelAdd, "新增模型：按 provider、baseURL、apiKey 和价格字段完整录入。")
                  ])
              ) +
              section(
                "models-probe",
                "探活与状态",
                "配置不应该停留在“填完就算”，还要验证可用性。",
                "<p>Models 页面支持主动 probe。对于 OpenAI Compatible 模型会检查模型列表端点；对于 Anthropic 会走对应消息接口探活。这样你可以在前端接入前先确认模型是否可用，以及最近一次失败原因。</p>" +
                  captionGrid([
                    { title: "available", body: "模型可调用，适合进入正式流量。"},
                    { title: "unavailable", body: "通常表示 baseURL、apiKey 或网络存在问题。"},
                    { title: "unknown", body: "端点可达，但模型名未明确列出，建议进一步确认。"},
                    { title: "disabled", body: "后台手动停用，不会再参与调度。"}
                  ])
              ) +
              section(
                "models-pricing",
                "计费字段",
                "Usage 模块的成本统计依赖这里的价格信息。",
                "<p>你可以填写 " +
                  inlineCode("input_price") +
                  "、" +
                  inlineCode("output_price") +
                  "、" +
                  inlineCode("cache_write_price") +
                  " 和 " +
                  inlineCode("cache_read_price") +
                  "。单位是 USD / 1M tokens。填写后，Usage 才能把 token 消耗转换成可观测的费用。</p>" +
                  note("info", "配置建议", "如果你是多模型并行策略，建议把每个模型的价格都录准，这样 Usage 才能真正用于成本比较。")
              ) +
              section(
                "models-balance",
                "负载均衡",
                "后台支持按启用状态和权重进行模型选择。",
                "<p>默认策略是 " +
                  inlineCode("round_robin") +
                  "。当负载均衡开启时，系统会在可用模型中按权重轮转。这样可以把高成本模型留给复杂场景，把便宜模型作为基础流量承载。</p>" +
                  note("warn", "运营建议", "如果你只接入一个模型，也建议保留至少一个备用模型配置，这样模型供应商波动时有更好的切换空间。")
              )
          },
          "admin-api-keys": {
            group: "admin",
            groupLabel: "Admin / API Keys",
            eyebrow: "Consumer credentials and rate limiting",
            title: "API Keys",
            summary: "API Keys 页面负责前端调试、业务后端代发 token、多环境接入和限流控制，是连接运行时能力与业务调用方的凭证中心。",
            badges: ["Key creation", "Rate limit", "Expire days", "Enable / disable", "Copy / revoke"],
            actions: [],
            related: [
              { label: "API Key 与鉴权配置", route: "api-auth" },
              { label: "Logs & Stats", route: "admin-logs" }
            ],
            sections: [
              { id: "keys-capabilities", title: "功能范围" },
              { id: "keys-fields", title: "关键字段" },
              { id: "keys-lifecycle", title: "生命周期" },
              { id: "keys-security", title: "安全建议" }
            ],
            html:
              section(
                "keys-capabilities",
                "功能范围",
                "它不只是“生成一个字符串”，而是整个消费侧入口治理。",
                mediaGrid([
                  image(ASSET.images.adminApiKeys, "API Keys 列表：管理可用密钥、调用次数、状态和过期策略。")
                ]) +
                  grid(
                    [
                      miniCard("创建", "为本地联调、业务后端代发 token 或不同环境生成独立 API Key。"),
                      miniCard("启停", "一键停用某把密钥，旧 token 会立即失效。"),
                      miniCard("过期时间", "通过 expires_days 为临时接入或演示环境设置更短寿命。"),
                      miniCard("限流", "通过 rate_limit 控制每分钟请求数，避免单个业务方超量调用。"),
                      miniCard("复制与分发", "创建后复制给业务后端或本地开发者。"),
                      miniCard("撤销", "删除后旧 access token 与 refresh token 都无法继续使用。")
                    ],
                    "triplet-grid"
                  )
              ) +
              section(
                "keys-fields",
                "关键字段",
                "这些字段决定了调用方的边界。",
                table(
                  ["字段", "作用", "建议"],
                  [
                    ["name", "区分不同业务系统或环境", "建议按 team / app / env 命名。"],
                    ["expires_days", "密钥生命周期", "演示环境与外部集成建议设置更短。"],
                    ["rate_limit", "每分钟请求限制", "根据业务流量上限设置，避免被单点打爆。"],
                    ["enabled", "是否启用", "发现异常立即停用。"]
                  ]
                )
              ) +
              section(
                "keys-lifecycle",
                "生命周期",
                "API Key 与 token 是强绑定的。",
                "<p>当 API Key 被停用、删除或过期时，之前依赖这把 Key 签发的 token 会立即失效。这意味着 API Key 页面不仅是“发号器”，也是最直接的撤销控制台。</p>" +
                  note("info", "生产经验", "如果你使用 selfAuth=false，业务后端只需要保存一把长期 API Key；真正暴露给浏览器的永远是短期 token。")
              ) +
              section(
                "keys-security",
                "安全建议",
                "把 API Key 当成服务间凭证来管理，而不是前端配置项。",
                "<ul>" +
                  "<li>本地开发可以直接下发到前端，生产环境不要这么做。</li>" +
                  "<li>按业务系统拆分 API Key，避免多个系统复用同一把长期凭证。</li>" +
                  "<li>给外部合作方设置更短的过期时间和更紧的 rate_limit。</li>" +
                  "<li>把 Key 轮换计划纳入常规运维动作，配合 Usage 和 Logs 做观察。</li>" +
                  "</ul>"
              )
          },
          "admin-tools-mcp": {
            group: "admin",
            groupLabel: "Admin / Tools & MCP",
            eyebrow: "External tools and service composition",
            title: "Tools & MCP",
            summary: "这一页负责把额外能力接进运行时：外部 MCP Server、工具配置、启停和探活，都通过后台集中治理，而不是散落在代码里。",
            badges: ["JSON config", "Probe", "Enable / disable", "Server count", "Runtime composition"],
            actions: [],
            related: [
              { label: "MCP 能力详解", route: "mcp" },
              { label: "Models", route: "admin-models" }
            ],
            sections: [
              { id: "tools-purpose", title: "有什么功能" },
              { id: "tools-editing", title: "如何配置" },
              { id: "tools-runtime", title: "运行时价值" }
            ],
            html:
              section(
                "tools-purpose",
                "有什么功能",
                "把模型以外的外部能力集中纳管。",
                mediaGrid([
                  image(ASSET.images.adminMcp, "Tools & MCP 总览：查看当前服务、启停状态和探活结果。"),
                  image(ASSET.images.adminMcpAdd, "新增 / 编辑 MCP：以 JSON 形式描述服务配置。")
                ]) +
                  grid(
                    [
                      miniCard("新增 MCP 服务", "按 JSON 填写连接信息与服务定义。"),
                      miniCard("编辑配置", "统一修改名称、命令、参数或服务元数据。"),
                      miniCard("启停服务", "对异常工具快速下线，不影响其他配置。"),
                      miniCard("Probe 探活", "在真正进入运行时前先确认服务可达。"),
                      miniCard("数量感知", "后台会展示当前启用 / 可用的服务情况。"),
                      miniCard("运行时编排", "后端统一决定何时调用这些外部工具，前端不需要感知细节。")
                    ],
                    "triplet-grid"
                  )
              ) +
              section(
                "tools-editing",
                "如何配置",
                "它本质上是“文档化的能力配置”。",
                "<p>推荐把每个 MCP 服务都视为一个可运维资产：在 JSON 中清楚写明它的用途、依赖和目标环境。这样当团队成员变动或环境迁移时，后台页面本身就能充当说明书。</p>" +
                  note("info", "为什么做成后台配置", "工具配置往往比前端页面变化更频繁。把它放在后台统一管理，可以避免每次接新工具都重新发版前端。")
              ) +
              section(
                "tools-runtime",
                "运行时价值",
                "真正收益在于降低业务页面与外部系统的耦合。",
                captionGrid([
                  { title: "统一接入层", body: "模型、知识与外部工具都从后端统一调度，不把复杂逻辑塞给浏览器。"},
                  { title: "可替换性", body: "某个 MCP 服务失效时，可以在后台快速替换或停用。"},
                  { title: "安全边界", body: "把外部调用能力留在服务端，前端只执行结果。"},
                  { title: "适合平台化", body: "多个业务线复用同一套 Widget 时，这种能力编排方式更稳定。"}
                ])
              )
          },
          "admin-usage": {
            group: "admin",
            groupLabel: "Admin / Usage",
            eyebrow: "Cost, token, and latency observability",
            title: "Usage",
            summary: "Usage 页面把请求量、Token、成本和耗时集中展示出来，适合做模型比较、成本对账和性能观测。",
            badges: ["Requests", "Token usage", "Cost", "Latency", "Range filter"],
            actions: [],
            related: [
              { label: "Models", route: "admin-models" },
              { label: "Sessions", route: "admin-sessions" }
            ],
            sections: [
              { id: "usage-summary", title: "看什么" },
              { id: "usage-filters", title: "怎么筛选" },
              { id: "usage-meaning", title: "对运营有什么帮助" }
            ],
            html:
              section(
                "usage-summary",
                "看什么",
                "这是成本和性能的第一观察位。",
                mediaGrid([
                  image(ASSET.images.adminUsage, "Usage 仪表：查看总请求数、Token、费用、平均耗时和明细记录。")
                ]) +
                  grid(
                    [
                      miniCard("总请求数", "观察整体调用规模。"),
                      miniCard("输入 / 输出 Token", "帮助判断问答上下文是否过长。"),
                      miniCard("缓存读写 Token", "有缓存时可看到额外消耗。"),
                      miniCard("总成本", "依赖 Models 中的价格字段换算。"),
                      miniCard("平均耗时", "用于发现模型或工具链是否拖慢响应。"),
                      miniCard("逐条明细", "可定位是哪个 key、哪个模型、哪个端点产生了消耗。")
                    ],
                    "triplet-grid"
                  )
              ) +
              section(
                "usage-filters",
                "怎么筛选",
                "适合按时间与 API Key 做运营分析。",
                "<p>Usage 支持按时间范围（例如近 1 天、7 天、30 天、90 天）和 API Key 进行筛选。这样你可以分别查看某个业务系统、某个环境或某次活动期间的调用成本。</p>" +
                  note("info", "前提条件", "如果希望 Usage 成本真正准确，记得先在 Models 页面配置对应模型的价格字段。")
              ) +
              section(
                "usage-meaning",
                "对运营有什么帮助",
                "它不仅是监控，更是策略决策依据。",
                captionGrid([
                  { title: "模型成本比较", body: "同类任务下，对比不同模型的响应耗时和单次成本。"},
                  { title: "业务环境拆分", body: "通过 API Key 识别测试环境与生产环境的流量差异。"},
                  { title: "异常预警", body: "某个时间段 Token 激增，往往意味着前端提示词或知识上下文发生变化。"},
                  { title: "预算管理", body: "适合在开源项目走向生产后建立基础用量预算。"}
                ])
              )
          },
          "admin-sessions": {
            group: "admin",
            groupLabel: "Admin / Sessions",
            eyebrow: "Conversation playback and troubleshooting",
            title: "Sessions",
            summary: "Sessions 页面用来回看用户真实对话和页面上下文，是排障、优化知识文档和调整提示词时最有价值的后台视图之一。",
            badges: ["Session history", "Message replay", "Pathname context", "Debugging"],
            actions: [],
            related: [
              { label: "Usage", route: "admin-usage" },
              { label: "Knowledge", route: "admin-knowledge" }
            ],
            sections: [
              { id: "sessions-purpose", title: "能看到什么" },
              { id: "sessions-debug", title: "怎么用于排障" },
              { id: "sessions-optimization", title: "怎么用于优化" }
            ],
            html:
              section(
                "sessions-purpose",
                "能看到什么",
                "它是“真实用户对话回放中心”。",
                mediaGrid([
                  image(ASSET.images.adminSessions, "Sessions 列表：查看 session、消息数、最近页面和最后消息。")
                ]) +
                  grid(
                    [
                      miniCard("Session ID", "用于识别一次完整对话链路。"),
                      miniCard("消息数", "帮助判断用户是否经历了长对话或反复追问。"),
                      miniCard("最近页面", "定位问题发生在什么业务路由。"),
                      miniCard("最后消息预览", "快速判断用户是在求助、跳转还是表单操作。"),
                      miniCard("消息详情", "进入后可以看到用户与助手的历史内容。"),
                      miniCard("时间线", "帮助你判断问题是即时发生还是长链路堆积。")
                    ],
                    "triplet-grid"
                  )
              ) +
              section(
                "sessions-debug",
                "怎么用于排障",
                "很多“用户说不好用”的问题，最后都需要回到会话本身。",
                "<ul>" +
                  "<li>如果用户问答答偏了，先看当时所在的 pathname 与历史上下文。</li>" +
                  "<li>如果跳错页面，检查 webAIDocs 是否缺少路由解释或页面别名。</li>" +
                  "<li>如果表单动作执行不稳定，回看用户表述与页面字段之间是否存在知识缺口。</li>" +
                  "<li>如果前端反馈超时，结合 Usage 里的耗时与 Sessions 里的对话长度一起分析。</li>" +
                  "</ul>"
              ) +
              section(
                "sessions-optimization",
                "怎么用于优化",
                "Sessions 对“知识文档质量提升”特别有帮助。",
                note("info", "优化思路", "把高频问题、高频误判页面和高频失败动作，从 Sessions 中沉淀回 webAIDocs 或提示词，是让系统越用越稳的关键。")
              )
          },
          "admin-knowledge": {
            group: "admin",
            groupLabel: "Admin / Knowledge",
            eyebrow: "Hosted business knowledge center",
            title: "Knowledge",
            summary: "Knowledge 页面是整个项目最有产品感的一块：它把业务文档从“仓库文件”提升成“后台可管理资产”，支持 ZIP 上传、单文件上传、在线编辑、重命名和删除。",
            badges: ["ZIP upload", "Single file upload", "Online editor", "Rename / delete", "Knowledge hosting"],
            actions: [],
            related: [
              { label: "编程助手中的 webGenerate", route: "webgenerate-assistant" },
              { label: "Sessions", route: "admin-sessions" }
            ],
            sections: [
              { id: "knowledge-functions", title: "功能范围" },
              { id: "knowledge-flow", title: "文档流转" },
              { id: "knowledge-editing", title: "在线维护" },
              { id: "knowledge-value", title: "为什么重要" }
            ],
            html:
              section(
                "knowledge-functions",
                "功能范围",
                "这里不是简单上传附件，而是管理项目的业务知识底座。",
                mediaGrid([
                  image(ASSET.images.adminKnowledge, "Knowledge 页面：查看文件列表、上传 ZIP、在线编辑和维护业务文档。"),
                  image(ASSET.images.knowledgeFlow, "知识流转：业务仓库生成文档，后台统一托管，运行时统一消费。")
                ]) +
                  grid(
                    [
                      miniCard("ZIP 上传", "一次性导入完整 webAIDocs，最适合多仓库场景。"),
                      miniCard("单文件上传", "补充或替换个别文档时更高效。"),
                      miniCard("新建文件", "后台可直接创建新的知识文件。"),
                      miniCard("在线编辑", "无需改代码即可修正文案、步骤和页面说明。"),
                      miniCard("重命名 / 删除", "适合文档结构调整与废弃页面清理。"),
                      miniCard("统一消费", "后端直接从这里读取知识，前端问答和动作都因此受益。")
                    ],
                    "triplet-grid"
                  )
              ) +
              section(
                "knowledge-flow",
                "文档流转",
                "推荐把 Knowledge 作为业务文档的运行时主入口。",
                steps([
                  { title: "业务仓库生成 webAIDocs", body: "通过助手中的 webGenerate 在真实业务项目里生成文档。" },
                  { title: "压缩并上传", body: "把整份 webAIDocs 目录压缩成 ZIP，在后台一键导入。" },
                  { title: "必要时在线修订", body: "对一些描述性内容，可以直接在后台小步修正。" },
                  { title: "运行时直接消费", body: "后端读取 Knowledge 目录，让问答和动作依赖最新业务文档。" }
                ])
              ) +
              section(
                "knowledge-editing",
                "在线维护",
                "这让业务文档不再完全绑定代码发布节奏。",
                "<p>对于页面说明、操作提示、注意事项这类强文案内容，后台在线编辑往往比改代码再发版更快。对于页面结构、字段名、路由等强技术内容，仍建议从业务仓库重新生成再上传，保证知识与真实页面同步。</p>" +
                  note("warn", "维护原则", "结构变化走重新生成，说明性变化走在线修订，这样最稳。")
              ) +
              section(
                "knowledge-value",
                "为什么重要",
                "Knowledge 决定了这个项目是否真的“业务知识驱动”。",
                captionGrid([
                  { title: "提升问答准确率", body: "没有最新业务文档，模型再强也容易答得泛。"},
                  { title: "提升动作成功率", body: "页面字段与步骤更完整时，表单与导航动作更容易命中。"},
                  { title: "降低代码依赖", body: "很多知识更新不必等前端重新发版。"},
                  { title: "适合开源项目扩展", body: "不同团队可以用同一套后台接入不同业务知识目录。"}
                ])
              )
          },
          "admin-logs": {
            group: "admin",
            groupLabel: "Admin / Logs & Stats",
            eyebrow: "Audit, blocking, and runtime status",
            title: "Logs & Stats",
            summary: "Logs & Stats 负责把安全、审计和整体运行状态补齐：包括请求统计、封禁 IP、后台审计与异常追踪，是生产治理的最后一块拼图。",
            badges: ["Request stats", "Blocked IP", "Audit logs", "Security visibility"],
            actions: [],
            related: [
              { label: "API Keys", route: "admin-api-keys" },
              { label: "Usage", route: "admin-usage" }
            ],
            sections: [
              { id: "logs-stats", title: "统计能力" },
              { id: "logs-security", title: "安全能力" },
              { id: "logs-operations", title: "运维价值" }
            ],
            html:
              section(
                "logs-stats",
                "统计能力",
                "这里关注的是运行状态，而不是业务问答内容本身。",
                grid(
                  [
                    miniCard("今日请求", "快速感知系统是否在正常被调用。"),
                    miniCard("成功 / 失败请求", "识别是否有大面积错误或上游服务波动。"),
                    miniCard("封禁 IP 数量", "快速感知是否存在异常访问。"),
                    miniCard("请求日志", "查看 method、path、status、IP、User-Agent 等审计信息。")
                  ],
                  "card-grid"
                )
              ) +
              section(
                "logs-security",
                "安全能力",
                "很多生产问题最终会回到这里确认。",
                "<ul>" +
                  "<li>如果出现异常高频请求，可结合 API Keys 与 Usage 判断是正常流量还是误用。</li>" +
                  "<li>如果 IP 被封禁，可在后台查看并按需解封。</li>" +
                  "<li>如果管理后台需要最小暴露面，建议把 /admin 放在内网或受限网络中。</li>" +
                  "<li>密钥轮换、失败请求与异常状态码，建议都配合 Logs 做审计留痕。</li>" +
                  "</ul>" +
                  note("danger", "后台暴露建议", "不要把管理后台和底层配置文件直接暴露在公网；把它视为运维面板而不是普通业务页面。")
              ) +
              section(
                "logs-operations",
                "运维价值",
                "这是让项目从“能跑”走向“可运营”的关键部分。",
                captionGrid([
                  { title: "排查失败请求", body: "结合状态码和路径快速判断问题发生在哪个环节。"},
                  { title: "识别异常访问", body: "被封禁 IP 和日志记录是安全审计的第一层。"},
                  { title: "联动成本与会话", body: "Usage 看成本，Sessions 看上下文，Logs 看系统状态，三者一起用价值最高。"},
                  { title: "适合团队协作", body: "开发、运维、平台团队可以基于同一后台视图协同处理问题。"}
                ])
              )
          }
        }
      },
      en: {
        brand: {
          name: "Portable AI Agent Widget",
          tagline: "Open-source docs"
        },
        labels: {
          darkMode: "Dark",
          lightMode: "Light",
          menu: "Menu",
          navigation: "Documentation",
          onThisPage: "On this page",
          related: "Related",
          adminCenter: "Admin documentation center",
          adminCenterDesc: "A task-oriented admin guide split by runtime capabilities."
        },
        topNav: [
          { label: "Overview", route: "overview", match: ["overview"] },
          { label: "Quick Start", route: "quick-start", match: ["quick-start"] },
          { label: "webGenerate", route: "webgenerate-cli", match: ["webgenerate-cli", "webgenerate-assistant"] },
          { label: "Frontend Agent", route: "frontend-agent", match: ["frontend-agent", "api-auth", "mcp"] },
          { label: "Admin", route: "admin-overview", match: ["admin-overview", "admin-models", "admin-api-keys", "admin-tools-mcp", "admin-usage", "admin-sessions", "admin-knowledge", "admin-logs"] }
        ],
        sidebar: [
          {
            title: "Getting started",
            items: [
              { route: "overview", label: "Overview", meta: "Product shape and value" },
              { route: "quick-start", label: "Quick Start", meta: "End-to-end onboarding" }
            ]
          },
          {
            title: "webGenerate",
            items: [
              { route: "webgenerate-cli", label: "CLI and npx usage", meta: "Install / uninstall / MCP" },
              { route: "webgenerate-assistant", label: "Inside coding assistants", meta: "Triggers and outputs" }
            ]
          },
          {
            title: "Runtime",
            items: [
              { route: "frontend-agent", label: "Frontend Agent", meta: "Form / route / Q&A" },
              { route: "api-auth", label: "API key and auth config", meta: "Dev / prod / skip auth" },
              { route: "mcp", label: "MCP capabilities", meta: "Knowledge and tools" }
            ]
          },
          {
            title: "Admin center",
            items: [
              { route: "admin-overview", label: "Admin overview", meta: "Capability map" },
              { route: "admin-models", label: "Models", meta: "Providers and probing" },
              { route: "admin-api-keys", label: "API Keys", meta: "Keys and rate limits" },
              { route: "admin-tools-mcp", label: "Tools & MCP", meta: "Tool composition" },
              { route: "admin-usage", label: "Usage", meta: "Token and cost" },
              { route: "admin-sessions", label: "Sessions", meta: "Replay and debug" },
              { route: "admin-knowledge", label: "Knowledge", meta: "ZIP upload and editing" },
              { route: "admin-logs", label: "Logs & Stats", meta: "Audit and security" }
            ]
          }
        ],
        adminMenu: [
          { route: "admin-overview", label: "Overview", meta: "Capability map" },
          { route: "admin-models", label: "Models", meta: "Model config" },
          { route: "admin-api-keys", label: "API Keys", meta: "Keys and limits" },
          { route: "admin-tools-mcp", label: "Tools & MCP", meta: "Tool composition" },
          { route: "admin-usage", label: "Usage", meta: "Cost and performance" },
          { route: "admin-sessions", label: "Sessions", meta: "Conversation replay" },
          { route: "admin-knowledge", label: "Knowledge", meta: "Hosted docs" },
          { route: "admin-logs", label: "Logs & Stats", meta: "Audit and runtime health" }
        ],
        pages: {
          "overview": {
            group: "start",
            groupLabel: "Overview",
            eyebrow: "Open-source project documentation",
            title: "An open-source runtime that connects business knowledge, coding agents, and safe frontend actions",
            summary: "The project solves two things at once: it helps coding agents work from business docs, and it gives frontend apps safe form-fill, route-jump, and knowledge-Q&A abilities.",
            badges: ["Knowledge driven", "Frontend safe actions", "Admin first", "Open source ready"],
            actions: [
              { label: "Open Quick Start", route: "quick-start", kind: "primary" },
              { label: "Open admin center", route: "admin-overview", kind: "secondary" }
            ],
            related: [
              { label: "Quick Start", route: "quick-start" },
              { label: "CLI and npx usage", route: "webgenerate-cli" }
            ],
            sections: [
              { id: "overview-capability", title: "Core capabilities" },
              { id: "overview-features", title: "Product traits" },
              { id: "overview-workflow", title: "Standard workflow" },
              { id: "overview-scenarios", title: "Best-fit scenarios" }
            ],
            html:
              section(
                "overview-capability",
                "Core capabilities",
                "A short answer to what the project is for.",
                grid(
                  [
                    card("1. Make coding agents work from business docs", "Use " + inlineCode("routes.md") + " and " + inlineCode("page-xxx.md") + " so coding assistants understand page meaning before changing code."),
                    card("2. Add safe agent runtime abilities to frontend apps", "Give web apps route navigation, form actions, and knowledge Q&A without exposing unrestricted browser automation.")
                  ],
                  "card-grid"
                ) +
                  '<div class="stats-row">' +
                  [statCard("2", "Main capability tracks"), statCard("3", "Frontend runtime abilities"), statCard("8+", "Admin modules"), statCard("10", "Supported assistant installs")].join("") +
                  "</div>"
              ) +
              section(
                "overview-features",
                "Product traits",
                "A complete onboarding chain instead of isolated scripts.",
                grid(
                  [
                    miniCard("Reusable docs", "One set of webAIDocs can serve IDE agents, runtime backend, and the frontend widget."),
                    miniCard("Light frontend onboarding", "Initialize one AIAgent and hand over route control."),
                    miniCard("Admin-driven operations", "Models, keys, MCP, and knowledge are configured in the console."),
                    miniCard("Production-friendly auth", "Use selfAuth in dev and token proxying in production.")
                  ],
                  "card-grid"
                )
              ) +
              section(
                "overview-workflow",
                "Standard workflow",
                "The recommended path from zero to production.",
                steps([
                  { title: "Install webGenerate into your coding assistant", body: "Add the assistant-specific skill or workflow first." },
                  { title: "Generate webAIDocs in the business frontend repo", body: "Run the slash or dollar trigger inside the real product workspace." },
                  { title: "Upload docs as ZIP", body: "Treat the generated webAIDocs folder as a runtime asset." },
                  { title: "Configure models, API keys, and MCP", body: "Finish runtime setup in the admin console." },
                  { title: "Integrate the widget in the frontend", body: "Initialize AIAgent and enable route/form actions." }
                ])
              ) +
              section(
                "overview-scenarios",
                "Best-fit scenarios",
                "Where this project is strongest.",
                captionGrid([
                  { title: "Back-office systems", body: "Add a natural-language entry point to admin, ops, and internal business tools." },
                  { title: "Knowledge-aware maintenance", body: "Let agents read business docs before refactoring complex pages." },
                  { title: "Q&A plus action", body: "Answer what to do, then navigate or act on the page." },
                  { title: "Reusable open-source layer", body: "A shared AI runtime layer that multiple products can adopt." }
                ])
              )
          },
          "quick-start": {
            group: "start",
            groupLabel: "Quick Start",
            eyebrow: "Run the full path without direct API work",
            title: "Quick Start",
            summary: "This path focuses on the product workflow: install webGenerate, generate docs, upload ZIP in admin, configure the model, and integrate the frontend widget.",
            badges: ["Assistant first", "ZIP upload", "Widget onboarding", "No endpoint tour"],
            actions: [
              { label: "Continue to webGenerate", route: "webgenerate-cli", kind: "primary" }
            ],
            related: [
              { label: "Frontend Agent", route: "frontend-agent" },
              { label: "Admin overview", route: "admin-overview" }
            ],
            sections: [
              { id: "quick-flow", title: "Five-step flow" },
              { id: "quick-install", title: "Install the workflow" },
              { id: "quick-generate", title: "Generate and upload docs" },
              { id: "quick-console", title: "Configure the admin console" },
              { id: "quick-frontend", title: "Integrate the frontend" }
            ],
            html:
              section(
                "quick-flow",
                "Five-step flow",
                "Use this if you want the fastest end-to-end path.",
                steps([
                  { title: "Install webGenerate", body: "Add the workflow to your assistant." },
                  { title: "Generate webAIDocs", body: "Run the assistant command in the real business repo." },
                  { title: "ZIP the docs", body: "Upload the full directory to Knowledge in the admin console." },
                  { title: "Configure model and API key", body: "Finish runtime setup in /admin." },
                  { title: "Initialize the widget", body: "Connect the frontend to the runtime backend." }
                ])
              ) +
              section(
                "quick-install",
                "Install the workflow",
                "The CLI installs the skill or rule set for your assistant.",
                codeBlock("bash", installAll)
              ) +
              section(
                "quick-generate",
                "Generate and upload docs",
                "The generated webAIDocs folder is the key business input.",
                codeBlock("bash", assistantTriggers) +
                  mediaGrid([
                    video(ASSET.videos.generate, "Demo: install the workflow, generate docs in the business repo, and prepare ZIP upload."),
                    image(ASSET.images.knowledgeFlow, "The knowledge flow from business repo to runtime admin console.")
                  ])
              ) +
              section(
                "quick-console",
                "Configure the admin console",
                "Finish runtime setup in a product-style control center.",
                codeBlock("env", envExample) +
                  linkRows([
                    { title: "Models", body: "Add provider, baseURL, apiKey, and pricing." },
                    { title: "API Keys", body: "Create runtime keys for dev or token proxying." },
                    { title: "Knowledge", body: "Upload the ZIP file or edit documents online." },
                    { title: "Tools & MCP", body: "Add external services if needed." }
                  ])
              ) +
              section(
                "quick-frontend",
                "Integrate the frontend",
                "Use direct apiKey auth in local development first.",
                codeBlock("ts", frontendQuickStart) +
                  image(ASSET.images.frontend, "Frontend integration view with the widget and runtime connection.")
              )
          },
          "webgenerate-cli": {
            group: "webGenerate",
            groupLabel: "webGenerate CLI",
            eyebrow: "Install workflows and expose MCP",
            title: "Full CLI and npx usage",
            summary: "The CLI installs webGenerate into assistants, uninstalls it, or exposes MCP mode. It does not directly generate the page docs by itself.",
            badges: ["Install", "Uninstall", "Platform aliases", "MCP mode"],
            actions: [{ label: "See assistant triggers", route: "webgenerate-assistant", kind: "primary" }],
            related: [{ label: "MCP", route: "mcp" }],
            sections: [
              { id: "cli-positioning", title: "Positioning" },
              { id: "cli-syntax", title: "Syntax" },
              { id: "cli-platforms", title: "Platforms and parameters" },
              { id: "cli-mcp", title: "MCP mode" }
            ],
            html:
              section("cli-positioning", "Positioning", "What the CLI does and does not do.", grid([card("It installs workflows", "It writes the needed skill, rule, or hook files into the selected assistant."), card("It does not generate docs by itself", "The actual generation happens from inside the assistant after installation.")], "duo-grid")) +
              section("cli-syntax", "Syntax", "The main command forms.", codeBlock("bash", ["webGenerate <platform> install", "webGenerate <platform> uninstall", "webGenerate install --platform codex", "webGenerate MCP", "webGenerate MCP --root ./your-project"].join("\n"))) +
              section("cli-platforms", "Platforms and parameters", "Current supported install targets.", table(["Platform", "Product", "After install"], [["codex", "Codex", inlineCode("$webGenerate .")], ["claude", "Claude Code", inlineCode("/webGenerate .")], ["cursor", "Cursor", "Agent workflow"], ["gemini", "Gemini CLI", inlineCode("/webGenerate .")], ["trae / trae-cn", "Trae", inlineCode("/webGenerate .")], ["copilot-cli / vscode-copilot", "GitHub Copilot", "Agent workflow"], ["opencode", "OpenCode", "Agent workflow"], ["antigravity", "Google Antigravity", "Agent workflow"]])) +
              section("cli-mcp", "MCP mode", "Expose business docs through MCP tools.", codeBlock("bash", mcpCommand) + captionGrid([{ title: "list_routes", body: "List routes from routes.md." }, { title: "search_routes", body: "Search candidate pages by keywords." }, { title: "get_page_doc", body: "Read one page doc by route, title, or filename." }, { title: "list_page_docs", body: "List the available page docs." }]))
          },
          "webgenerate-assistant": {
            group: "webGenerate",
            groupLabel: "Assistant Workflow",
            eyebrow: "Use webGenerate inside the assistant",
            title: "Full webGenerate usage inside coding assistants",
            summary: "After installation, the everyday workflow is the assistant-side trigger: full generation, incremental sync, path selection, and reuse of generated docs during coding work.",
            badges: ["Full generation", "Incremental sync", "Assistant native", "Knowledge first"],
            actions: [],
            related: [{ label: "Quick Start", route: "quick-start" }],
            sections: [
              { id: "assistant-trigger", title: "Triggers" },
              { id: "assistant-params", title: "Parameters" },
              { id: "assistant-output", title: "Output" },
              { id: "assistant-best-practice", title: "Best practice" }
            ],
            html:
              section("assistant-trigger", "Triggers", "Use the matching prefix for your assistant.", codeBlock("bash", assistantTriggers)) +
              section("assistant-params", "Parameters", "Keep the workflow intentionally simple.", table(["Parameter", "Meaning", "Example"], [[inlineCode("."), "Current workspace root", inlineCode("/webGenerate .")], [inlineCode("./path"), "Explicit business project root", inlineCode("/webGenerate ./apps/admin")], [inlineCode("--update"), "Incremental sync only", inlineCode("/webGenerate . --update")]])) +
              section("assistant-output", "Output", "Stable file names make the workflow easy to automate.", codeBlock("text", ["webAIDocs/", "  routes.md", "  page-xxx.md"].join("\n"))) +
              section("assistant-best-practice", "Best practice", "Treat doc generation as a repeated knowledge sync step.", "<ul><li>Run a full generation once, then use " + inlineCode("--update") + " after page work.</li><li>Regenerate when routes, forms, or page structure change.</li><li>Prefer ZIP upload in multi-repo setups.</li><li>Keep " + inlineCode("webAIDocs") + " as the stable output contract across teams.</li></ul>")
          },
          "frontend-agent": {
            group: "runtime",
            groupLabel: "Frontend Agent",
            eyebrow: "Safe runtime for form, route, and Q&A",
            title: "Frontend Agent capabilities",
            summary: "The frontend runtime focuses on three user-facing abilities: form filling, route navigation, and knowledge Q&A, all inside a controlled action model.",
            badges: ["Form", "Navigate", "Knowledge Q&A", "Safe runtime"],
            actions: [{ label: "Auth and API key config", route: "api-auth", kind: "primary" }],
            related: [{ label: "Quick Start", route: "quick-start" }],
            sections: [
              { id: "frontend-capability", title: "Three core abilities" },
              { id: "frontend-integration", title: "Integration shape" },
              { id: "frontend-videos", title: "Video demos" },
              { id: "frontend-runtime", title: "Runtime boundary" }
            ],
            html:
              section("frontend-capability", "Three core abilities", "The widget is designed for business pages, not general browser automation.", grid([card("Form fill", "Use controlled form actions for search panels, inputs, and business forms."), card("Route jump", "Return navigate actions and let your router handle page changes."), card("Knowledge Q&A", "Answer from pathname, uploaded docs, and session context."), card("Safe extension", "Tool use and model orchestration remain on the backend.")], "card-grid")) +
              section("frontend-integration", "Integration shape", "A small frontend API with clear responsibility.", codeBlock("ts", ['import AIAgent from "portable-ai-agent-widget";', "", "AIAgent.init({", '  backendUrl: "http://localhost:4096/api",', '  apiKey: "sk-your-api-key",', "  selfAuth: true,", "  routerPush: (route) => router.push(route)", "});"].join("\n")) + image(ASSET.images.frontend, "Frontend integration screenshot.")) +
              section("frontend-videos", "Video demos", "Videos use contain mode so the full frame remains visible.", mediaGrid([video(ASSET.videos.form, "Form filling demo."), video(ASSET.videos.route, "Route navigation demo."), video(ASSET.videos.qa, "Knowledge Q&A demo.")])) +
              section("frontend-runtime", "Runtime boundary", "The browser only performs whitelisted actions.", "<ul><li>No arbitrary script execution in the browser.</li><li>Models, tools, and knowledge retrieval stay on the backend.</li><li>Production setups should avoid shipping long-lived keys to the client.</li></ul>")
          },
          "api-auth": {
            group: "runtime",
            groupLabel: "Auth & API Key",
            eyebrow: "Configure the key strategy, not endpoint details",
            title: "API key and authentication configuration",
            summary: "This page focuses on how to configure apiKey usage, frontend auth modes, production token proxying, and how to skip API keys in local development.",
            badges: ["selfAuth=true", "selfAuth=false", "Token proxy", "Skip auth in dev"],
            actions: [{ label: "Open API Keys admin page", route: "admin-api-keys", kind: "primary" }],
            related: [{ label: "Frontend Agent", route: "frontend-agent" }],
            sections: [
              { id: "auth-modes", title: "Auth modes" },
              { id: "auth-frontend", title: "Frontend configuration" },
              { id: "auth-production", title: "Production setup" },
              { id: "auth-skip", title: "Skip API key in dev" }
            ],
            html:
              section("auth-modes", "Auth modes", "Pick the mode first, then write the frontend integration.", table(["Mode", "Best for", "Frontend requirement"], [[inlineCode("selfAuth=true"), "Local development", "Pass apiKey directly."], [inlineCode("selfAuth=false"), "Production", "Implement getToken without exposing long-lived keys."], [inlineCode("DISABLE_AGENT_AUTH=true"), "Temporary local debugging", "No apiKey or getToken needed."]])) +
              section("auth-frontend", "Frontend configuration", "Development and production usually use different init blocks.", codeBlock("ts", frontendQuickStart) + codeBlock("ts", productionAuth)) +
              section("auth-production", "Production setup", "Keep the long-lived apiKey on your own backend.", codeBlock("env", envExample) + "<p>Your business backend should hold the real key and return short-lived tokens to the widget.</p>") +
              section("auth-skip", "Skip API key in dev", "Useful for local verification only.", codeBlock("env", skipAuthCode) + note("danger", "Development only", "Do not carry auth bypass settings into production environments."))
          },
          "mcp": {
            group: "runtime",
            groupLabel: "MCP",
            eyebrow: "Knowledge and external capability composition",
            title: "MCP capabilities",
            summary: "MCP appears in two ways here: webGenerate can expose knowledge docs as MCP tools, and the admin console can register external MCP services for runtime use.",
            badges: ["Knowledge MCP", "External tools", "Backend orchestration", "Admin managed"],
            actions: [{ label: "Open Tools & MCP", route: "admin-tools-mcp", kind: "primary" }],
            related: [{ label: "CLI and npx usage", route: "webgenerate-cli" }],
            sections: [
              { id: "mcp-layers", title: "Two layers" },
              { id: "mcp-webgenerate", title: "webGenerate as MCP" },
              { id: "mcp-admin", title: "Admin-side MCP" },
              { id: "mcp-usecases", title: "Use cases" }
            ],
            html:
              section("mcp-layers", "Two layers", "Separate developer knowledge access from runtime tool orchestration.", grid([card("Developer-side MCP", "Use " + inlineCode("webGenerate MCP") + " to expose routes and page docs to external agents."), card("Runtime-side MCP", "Use Tools & MCP in the admin console to register external services for the backend.")], "duo-grid")) +
              section("mcp-webgenerate", "webGenerate as MCP", "A standard tool surface for business knowledge.", codeBlock("bash", mcpCommand) + video(ASSET.videos.mcp, "MCP capability demo.")) +
              section("mcp-admin", "Admin-side MCP", "Register, edit, probe, and enable external MCP services in the console.", mediaGrid([image(ASSET.images.adminMcp, "MCP overview page."), image(ASSET.images.adminMcpAdd, "Add or edit MCP configuration.")])) +
              section("mcp-usecases", "Use cases", "Good for external knowledge, tools, and multi-repo knowledge access.", captionGrid([{ title: "Knowledge lookup", body: "Let agents inspect routes and page docs before acting." }, { title: "Tool composition", body: "Bridge internal systems through MCP services." }, { title: "Multi-repo coordination", body: "Keep runtime and business repos connected through a standard tool layer." }, { title: "Safer extension", body: "Keep external capability calls on the backend instead of the browser." }]))
          },
          "admin-overview": {
            group: "admin",
            groupLabel: "Admin Center",
            eyebrow: "Runtime control center",
            title: "Admin overview",
            summary: "The admin console acts as a documentation center for runtime setup: models, keys, MCP, knowledge, sessions, logs, and stats all live here.",
            badges: ["Admin center", "Knowledge hosting", "Observability", "Operations ready"],
            actions: [{ label: "Open Models", route: "admin-models", kind: "primary" }],
            related: [{ label: "Quick Start", route: "quick-start" }],
            sections: [
              { id: "admin-map", title: "Capability map" },
              { id: "admin-flow", title: "Recommended setup order" },
              { id: "admin-roles", title: "Who uses it" },
              { id: "admin-submenus", title: "Submenu map" }
            ],
            html:
              section("admin-map", "Capability map", "Think of the console as an operations product, not a loose config page.", mediaGrid([image(ASSET.images.adminControl, "Admin overview screenshot."), image(ASSET.images.adminKnowledge, "Knowledge module screenshot.")])) +
              section("admin-flow", "Recommended setup order", "A reliable rollout path.", steps([{ title: "Change the bootstrap password", body: "The default admin password must be replaced before login." }, { title: "Configure models", body: "Ensure at least one working model exists." }, { title: "Create API keys", body: "Prepare keys for local dev or backend token proxying." }, { title: "Upload knowledge docs", body: "Bring in the generated webAIDocs ZIP." }, { title: "Enable MCP if needed", body: "Add tool services after the base flow works." }, { title: "Observe usage, sessions, and logs", body: "Monitor cost, replay conversations, and watch runtime health." }])) +
              section("admin-roles", "Who uses it", "Useful to frontend leads, platform teams, implementation teams, and operators.", captionGrid([{ title: "Implementation teams", body: "Initial setup and runtime onboarding." }, { title: "Frontend owners", body: "Action boundaries and doc quality." }, { title: "Platform or ops", body: "Secrets, logs, and production exposure." }, { title: "Business operators", body: "Knowledge editing without code releases." }])) +
              section("admin-submenus", "Submenu map", "Each submenu is a product-level module.", linkRows([{ title: "Models", body: "Providers, status, pricing, balancing" }, { title: "API Keys", body: "Consumers, rate limits, rotation" }, { title: "Tools & MCP", body: "External capability composition" }, { title: "Usage", body: "Cost and latency" }, { title: "Sessions", body: "Conversation replay" }, { title: "Knowledge", body: "Hosted docs" }, { title: "Logs & Stats", body: "Audit and runtime health" }]))
          },
          "admin-models": {
            group: "admin",
            groupLabel: "Admin / Models",
            eyebrow: "Model routing and pricing",
            title: "Models",
            summary: "Configure providers, model names, base URLs, API keys, health checks, pricing, and load balancing in one place.",
            badges: ["Provider", "Probe", "Pricing", "Weight", "Status"],
            actions: [],
            related: [{ label: "Usage", route: "admin-usage" }],
            sections: [
              { id: "models-fields", title: "Fields" },
              { id: "models-probe", title: "Health checks" },
              { id: "models-pricing", title: "Pricing" },
              { id: "models-balance", title: "Balancing" }
            ],
            html:
              section("models-fields", "Fields", "The page gathers provider and access configuration.", table(["Field", "Purpose", "Why it matters"], [["provider", "OpenAI compatible or Anthropic", "Controls probe logic and request style."], ["model / name", "Identifier and display title", "Needed for logs and cost reports."], ["baseURL", "Provider endpoint", "Supports official APIs and proxies."], ["apiKey", "Provider credential", "The actual model access secret."], ["weight", "Traffic weight", "Works with load balancing."], ["enabled", "Enable or disable", "Removes a model from production routing quickly."]]) + mediaGrid([image(ASSET.images.adminModels, "Models overview."), image(ASSET.images.adminModelAdd, "Add model form.")])) +
              section("models-probe", "Health checks", "Probe before sending real user traffic.", captionGrid([{ title: "available", body: "Ready for live traffic." }, { title: "unavailable", body: "Usually points to endpoint, key, or network issues." }, { title: "unknown", body: "Reachable endpoint but the model id was not clearly listed." }, { title: "disabled", body: "Manually turned off in the console." }])) +
              section("models-pricing", "Pricing", "Usage cost reports depend on the prices stored here.", "<p>Fill input, output, cache write, and cache read price fields in USD per 1M tokens.</p>") +
              section("models-balance", "Balancing", "Weight-based round-robin helps split traffic across healthy models.", "<p>Keep at least one backup model configured if production reliability matters.</p>")
          },
          "admin-api-keys": {
            group: "admin",
            groupLabel: "Admin / API Keys",
            eyebrow: "Consumer credentials",
            title: "API Keys",
            summary: "Create, expire, rate limit, enable, disable, copy, and revoke consumer credentials from one page.",
            badges: ["Create", "Expire", "Rate limit", "Enable / disable", "Revoke"],
            actions: [],
            related: [{ label: "API key and auth config", route: "api-auth" }],
            sections: [
              { id: "keys-capabilities", title: "Capabilities" },
              { id: "keys-fields", title: "Key fields" },
              { id: "keys-lifecycle", title: "Lifecycle" },
              { id: "keys-security", title: "Security notes" }
            ],
            html:
              section("keys-capabilities", "Capabilities", "API keys are the consumer-side control layer.", mediaGrid([image(ASSET.images.adminApiKeys, "API key list view.")])) +
              section("keys-fields", "Key fields", "Name, expiration days, rate limit, and enabled status shape the calling boundary.", table(["Field", "Purpose", "Suggestion"], [["name", "Identify app or environment", "Use team/app/env naming."], ["expires_days", "Key lifetime", "Shorter for demos or third parties."], ["rate_limit", "Requests per minute", "Protect the backend from spikes."], ["enabled", "Quick on/off", "Disable immediately on suspicious use."]])) +
              section("keys-lifecycle", "Lifecycle", "Tokens are tied to the API key that created them.", "<p>If the key is disabled, deleted, or expired, old tokens immediately stop working.</p>") +
              section("keys-security", "Security notes", "Treat keys as server-side credentials.", "<ul><li>Use direct keys in local development only.</li><li>Split keys by product or environment.</li><li>Rotate regularly.</li></ul>")
          },
          "admin-tools-mcp": {
            group: "admin",
            groupLabel: "Admin / Tools & MCP",
            eyebrow: "External capability composition",
            title: "Tools & MCP",
            summary: "Register external MCP services and tools, edit them as JSON, probe them, and enable or disable them without touching frontend code.",
            badges: ["JSON config", "Probe", "Enable / disable", "Tool composition"],
            actions: [],
            related: [{ label: "MCP", route: "mcp" }],
            sections: [
              { id: "tools-purpose", title: "Functions" },
              { id: "tools-editing", title: "Configuration" },
              { id: "tools-runtime", title: "Runtime value" }
            ],
            html:
              section("tools-purpose", "Functions", "Bring non-model capabilities into the runtime.", mediaGrid([image(ASSET.images.adminMcp, "MCP overview."), image(ASSET.images.adminMcpAdd, "Add MCP configuration.")])) +
              section("tools-editing", "Configuration", "Treat each MCP config as a documented operational asset.", "<p>JSON editing, probing, and enable/disable controls keep external services manageable from the admin UI.</p>") +
              section("tools-runtime", "Runtime value", "Keep external capability wiring off the browser and inside the backend runtime.", captionGrid([{ title: "Safer extension", body: "The browser only receives controlled action outputs." }, { title: "Replaceable services", body: "Swap or disable tools without frontend changes." }, { title: "Shared platform layer", body: "Useful when multiple products share the same widget runtime." }, { title: "Operational clarity", body: "Service state is visible in one console." }]))
          },
          "admin-usage": {
            group: "admin",
            groupLabel: "Admin / Usage",
            eyebrow: "Cost and performance",
            title: "Usage",
            summary: "Observe request counts, token totals, estimated cost, latency, and per-record details from the runtime console.",
            badges: ["Requests", "Tokens", "Cost", "Latency", "Filters"],
            actions: [],
            related: [{ label: "Models", route: "admin-models" }],
            sections: [
              { id: "usage-summary", title: "What it shows" },
              { id: "usage-filters", title: "How to filter" },
              { id: "usage-meaning", title: "Why it matters" }
            ],
            html:
              section("usage-summary", "What it shows", "This is your first cost and performance dashboard.", mediaGrid([image(ASSET.images.adminUsage, "Usage dashboard.")])) +
              section("usage-filters", "How to filter", "Filter by time range and API key.", "<p>Use the range and key filters to compare environments, products, or rollout windows.</p>") +
              section("usage-meaning", "Why it matters", "Useful for cost control, latency tuning, and model comparison.", captionGrid([{ title: "Cost comparison", body: "Compare providers and models for the same workload." }, { title: "Traffic segmentation", body: "Separate test and production traffic through API keys." }, { title: "Anomaly detection", body: "Spot sudden token growth early." }, { title: "Budget planning", body: "Build runtime budgets once the project reaches production." }]))
          },
          "admin-sessions": {
            group: "admin",
            groupLabel: "Admin / Sessions",
            eyebrow: "Conversation replay",
            title: "Sessions",
            summary: "Replay real conversations, inspect path context, and troubleshoot user reports by following the actual session history.",
            badges: ["Session ID", "History", "Pathname", "Debugging"],
            actions: [],
            related: [{ label: "Knowledge", route: "admin-knowledge" }],
            sections: [
              { id: "sessions-purpose", title: "What you can see" },
              { id: "sessions-debug", title: "Debugging value" },
              { id: "sessions-optimization", title: "Optimization value" }
            ],
            html:
              section("sessions-purpose", "What you can see", "A conversation replay center for real users.", mediaGrid([image(ASSET.images.adminSessions, "Sessions list.")])) +
              section("sessions-debug", "Debugging value", "When users say the agent answered or navigated incorrectly, this is where the investigation starts.", "<ul><li>Inspect the active pathname.</li><li>Read the message history.</li><li>Cross-check with uploaded page docs.</li></ul>") +
              section("sessions-optimization", "Optimization value", "Good source material for improving docs and prompts.", "<p>Feed repeated confusion and repeated failure cases back into webAIDocs or runtime prompts.</p>")
          },
          "admin-knowledge": {
            group: "admin",
            groupLabel: "Admin / Knowledge",
            eyebrow: "Hosted business docs",
            title: "Knowledge",
            summary: "Upload ZIP files, upload single files, create new docs, edit them online, rename them, delete them, and use the admin console as the hosted source of runtime business knowledge.",
            badges: ["ZIP upload", "Editor", "Rename", "Delete", "Hosted docs"],
            actions: [],
            related: [{ label: "Assistant-side webGenerate", route: "webgenerate-assistant" }],
            sections: [
              { id: "knowledge-functions", title: "Functions" },
              { id: "knowledge-flow", title: "Doc flow" },
              { id: "knowledge-editing", title: "Editing" },
              { id: "knowledge-value", title: "Why it matters" }
            ],
            html:
              section("knowledge-functions", "Functions", "The console turns repo files into runtime-managed knowledge assets.", mediaGrid([image(ASSET.images.adminKnowledge, "Knowledge page."), image(ASSET.images.knowledgeFlow, "Knowledge flow diagram.")])) +
              section("knowledge-flow", "Doc flow", "Generate in the business repo, then upload to runtime admin.", steps([{ title: "Generate webAIDocs", body: "Use webGenerate inside the assistant." }, { title: "ZIP and upload", body: "Bring the whole doc set into the admin console." }, { title: "Edit when needed", body: "Handle wording or instruction tweaks online." }, { title: "Serve runtime", body: "Let the backend read the hosted docs directly." }])) +
              section("knowledge-editing", "Editing", "Use online editing for content tweaks, but regenerate from source when structure changes.", note("warn", "Maintenance rule", "Regenerate for route or field changes; edit online for descriptive changes.")) +
              section("knowledge-value", "Why it matters", "Knowledge quality drives both answer quality and action quality.", captionGrid([{ title: "Better answers", body: "The runtime answers from current business docs." }, { title: "Better actions", body: "Form and route actions are more reliable when page docs are complete." }, { title: "Less code coupling", body: "Some updates no longer require frontend releases." }, { title: "Better platform reuse", body: "Different teams can plug different knowledge sets into the same runtime." }]))
          },
          "admin-logs": {
            group: "admin",
            groupLabel: "Admin / Logs & Stats",
            eyebrow: "Audit and runtime health",
            title: "Logs & Stats",
            summary: "Use this module for request stats, blocked IPs, runtime audit signals, and security-oriented operational visibility.",
            badges: ["Stats", "Blocked IPs", "Audit", "Runtime health"],
            actions: [],
            related: [{ label: "API Keys", route: "admin-api-keys" }],
            sections: [
              { id: "logs-stats", title: "Stats" },
              { id: "logs-security", title: "Security" },
              { id: "logs-operations", title: "Operations" }
            ],
            html:
              section("logs-stats", "Stats", "Track request totals, success and failure counts, and blocked IP counts.", grid([miniCard("Today requests", "Quick traffic snapshot."), miniCard("Success / failure", "Spot broad failures fast."), miniCard("Blocked IPs", "Watch suspicious access."), miniCard("Request logs", "Audit method, path, status, IP, and user agent.")], "card-grid")) +
              section("logs-security", "Security", "This page helps confirm access problems, abusive traffic, and admin exposure concerns.", "<ul><li>Use it with API Keys and Usage when investigating traffic spikes.</li><li>Unblock IPs only after confirming they are legitimate.</li><li>Keep the admin console behind restricted access in production.</li></ul>") +
              section("logs-operations", "Operations", "This is part of turning the project from a demo into an operable system.", captionGrid([{ title: "Failure analysis", body: "Find which path or status code failed." }, { title: "Security review", body: "Check blocked IPs and audit patterns." }, { title: "Cross-module debugging", body: "Use Logs with Usage and Sessions together." }, { title: "Team collaboration", body: "Frontend, platform, and ops teams can work from the same console view." }]))
          }
        }
      }
    };
  }

  const DOCS = buildDocs();

  function normalizeRoute(hash) {
    const raw = String(hash || "").replace(/^#\/?/, "").trim();
    if (!raw) return "overview";
    return raw;
  }

  const app = createApp({
    data() {
      return {
        lang: localStorage.getItem("docs-lang") || "zh",
        theme: localStorage.getItem("docs-theme") || "light",
        route: normalizeRoute(window.location.hash),
        mobileSidebar: false,
        docs: DOCS
      };
    },
    computed: {
      locale() {
        return this.docs[this.lang] || this.docs.zh;
      },
      currentPage() {
        return this.locale.pages[this.route] || this.locale.pages.overview;
      },
      isAdminPage() {
        return this.currentPage.group === "admin";
      }
    },
    methods: {
      go(route) {
        const next = route || "overview";
        if (this.route === next) {
          this.mobileSidebar = false;
          this.scrollToTop();
          return;
        }
        window.location.hash = "#/" + next;
      },
      isGroupActive(item) {
        return Array.isArray(item.match) ? item.match.indexOf(this.route) >= 0 : item.route === this.route;
      },
      handleHashChange() {
        this.route = normalizeRoute(window.location.hash);
        this.mobileSidebar = false;
        this.$nextTick(this.scrollToTop);
      },
      scrollToSection(id) {
        this.$nextTick(function () {
          const target = document.getElementById(id);
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      },
      scrollToTop() {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      },
      toggleLang() {
        this.lang = this.lang === "zh" ? "en" : "zh";
        localStorage.setItem("docs-lang", this.lang);
      },
      toggleTheme() {
        this.theme = this.theme === "light" ? "dark" : "light";
        localStorage.setItem("docs-theme", this.theme);
        document.documentElement.setAttribute("data-theme", this.theme);
      },
      closeMobilePanels() {
        this.mobileSidebar = false;
      },
      openExternal(href) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    },
    mounted() {
      document.documentElement.setAttribute("data-theme", this.theme);
      window.addEventListener("hashchange", this.handleHashChange);
      if (!window.location.hash) {
        window.location.hash = "#/overview";
      } else {
        this.handleHashChange();
      }
    },
    beforeUnmount() {
      window.removeEventListener("hashchange", this.handleHashChange);
    }
  });

  app.mount("#app");
})();
