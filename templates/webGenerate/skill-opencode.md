---
name: webGenerate
description: 对前端项目生成或增量更新业务知识文档（webAIDocs/routes.md + page-xxx.md）
trigger: /webGenerate
---

# /webGenerate

在当前助手内直接执行知识文档流水线，禁止再调用 `webGenerate <path>` 或 `node scripts/webGenerate.js`。

## Usage

```bash
/webGenerate .                       # 对当前目录全量生成
/webGenerate ./raw                   # 对指定目录全量生成
/webGenerate ./raw --update          # 仅增量更新受影响页面
```

## Output Contract

产物目录固定为 `<target_root>/webAIDocs/`，但**文档内容与结构必须严格满足** webGenerate 的路由与页面文档规范。

必须生成或更新：
- `webAIDocs/routes.md`
- `webAIDocs/page-<slug>.md`

禁止写入 `webAIDocs/` 之外的文档文件。

## Mandatory Workflow

1. 解析参数
- 默认 `path = .`
- 支持 `--update`
- `path` 不存在或不是目录时，直接报错

2. 判定模式
- 未传 `--update`：`full`
- 传 `--update` 且 `routes.md` 存在：`incremental`
- 传 `--update` 但 `routes.md` 缺失或严重失真：回退 `full`

3. 全量模式（必须遵循 generator 要求）
- 读取 `package.json` 识别框架（Vue/React/Next/Nuxt）与路由机制（配置式/文件系统）
- 定位路由入口并映射组件文件（含 lazy import）
- 先写 `routes.md`，再按路由逐个生成 `page-xxx.md`

4. 增量模式（必须遵循 updater 要求）
- 先读取已有 `routes.md` 与相关 `page-xxx.md`
- 通过 git diff / 变更文件 / import 链映射受影响页面
- 仅更新受影响路由行与页面文档，尽量保持未受影响文件不变
- 若无法可靠建立影响范围，逐步扩大补扫；仍不可靠则回退 `full`

## routes.md Hard Requirements

`routes.md` 必须包含并保持如下结构语义：

1. frontmatter 字段（字段名必须出现）
- `generated_by: webGenerate`
- `version: 1.3.0`（或后续兼容版本号）
- `generated_at: <ISO8601>`
- `framework: <detected-framework>`
- `project_root: <absolute-path>`

2. 固定章节
- `# 系统路由与页面概要`
- `## 路由列表`
- `## 使用说明`

3. 路由表列（列名必须完整）
- `路径 | 页面名称 | 组件文件 | 文档文件 | authRequired`

4. 每条路由至少包含
- `path`
- 页面名称
- 组件文件相对路径
- `page-<slug>.md`
- `authRequired`

## page-xxx.md Hard Requirements

每个页面文档必须满足下列结构（来自原 generator/updater 规范）：

1. frontmatter 至少包含
- `path`
- `slug`
- `title`
- `pagePurpose`
- `component`
- `generated_by`（全量为 `webGenerate`）
- `generated_at`
- `authRequired`
- `params`

2. 文档正文章节至少包含
- `# 页面：<title>`
- `## 页面用途`
- `## 页面说明`
- `## 前置条件`
- `## 关键操作步骤`
- `## 表单字段`（若页面有表单）
- `## 操作元素`（至少关键按钮/入口）
- `## 使用注意`

3. 版式必须采用“旧版详细文档”风格
- `## 页面用途` 下使用 3 条项目符号：`适用对象`、`核心目标`、`成功结果`
- `## 页面说明` 必须是 1 段到 3 段完整说明，不能只写短句
- `## 前置条件` 必须是项目符号列表
- `## 关键操作步骤` 下必须使用 `### 主流程：...` / `### 辅助流程：...`
- `## 表单字段` 下每个字段必须使用 `### <fieldKey>` 小节
- `## 操作元素` 下每个元素必须使用 `### <elementName>` 小节
- 字段与元素的小节内部必须使用多行 bullet 列表，不允许压成单行摘要

## Agent Execution Detail Requirements (Mandatory)

以下要求用于保证 Agent 可直接执行页面操作，不满足即视为不合格文档：

1. 关键操作步骤必须“可执行而非概述”
- 每页至少 1 组主流程；复杂页需补充 1-3 组辅助流程
- 每组流程建议 4-8 步；不得只写“点击提交并完成”这类合并步骤
- 每一步必须包含：`action`、`target`、`related_fields_or_elements`、`expected_result`
- `expected_result` 必须可观察（URL变化、弹窗出现、表格刷新、toast文案、按钮状态变化等）
- 每一步必须单独编号并展开为多行，格式参考原始 generator 样式：
  `1. 步骤名称`
  `- action: ...`
  `- target: ...`
  `- related_fields_or_elements:`
  `  - xxx`
  `- expected_result: ...`

2. 步骤必须包含上下文与前后依赖
- 明确触发前置状态（例如“列表已有筛选条件”“弹窗已打开”）
- 明确执行顺序与分支（成功分支/失败分支至少说明主分支）
- 对异步步骤补充等待条件（例如“等待 loading 消失后再点击下一步”）

3. `related_fields_or_elements` 必须强绑定文档实体
- 每一步引用的字段/元素必须在“表单字段/操作元素”章节存在同名条目
- 不允许出现无法反查的泛化名称（如“输入框A”“按钮B”）

4. 操作元素必须“可定位且可降级”
- 每个关键元素至少提供 2 个可用 selector（主 selector + 备选 selector）
- 若存在稳定 id/testid/name，必须优先使用，不可仅给 class
- 对高风险元素增加定位上下文（父容器、行内操作列、弹窗内）
- 对同名按钮（如多个“编辑”）必须提供区分策略（行定位、区域定位、邻近文本）
- 操作元素必须使用如下结构，不允许写成单行：
  `### 搜索按钮`
  `- selectors:`
  `  - button:has-text("搜索")`
  `  - .ant-btn-primary:has-text("搜索")`

5. 表单字段必须覆盖 Agent 真正会填写的字段
- 必填字段必须标记 `validation: required`
- 类型必须准确：`text/password/number/checkbox/select/custom`
- 对 select/date/range/upload 等非纯文本控件写明交互方式（展开、选择、确认）
- 表单字段必须使用如下结构，不允许写成单行：
  `### operatorId`
  `- type: text`
  `- selectors:`
  `  - input[placeholder="搜索操作人工号"]`
  `- validation: optional`

6. 禁止空洞描述
- 禁止仅给页面介绍而缺少可执行步骤
- 禁止只有 selector 列表却没有操作目标与预期结果
- 禁止把多个关键动作压成一步
- 禁止把多个字段合并成“填写A/B/C并搜索”
- 禁止把多个控件写成一行，如 `- 字段A：type text；validation optional`
- 禁止把元素写成一行，如 `- 搜索按钮：主 selector ...；备选 selector ...`
- 禁止输出缺少 `page-` 前缀的 slug；slug 必须形如 `page-admin-operation-logs`

7. 页面问答与代码定位增强
- 页面说明中尽量补充真实 UI 结构：搜索区、表格、弹窗、抽屉、分页、Tab、详情区
- 使用注意中尽量补充对 Agent 和工程师有帮助的信息：
  - 表格列与关键展示字段
  - 成功/失败状态文案或标签
  - 弹窗/抽屉展示的关键信息
  - 关联的接口请求、表单提交、列表刷新、枚举加载等逻辑线索
  - 有助于改代码定位的文件线索（若源码中能明确识别）

## Selector Priority (Mandatory)

字段与元素 selector 优先级必须遵循：
1. `#id`
2. `[data-testid="..."]`
3. `[name="..."]`
4. `[aria-label="..."]`
5. 上下文限定选择器
6. `.class`（仅兜底）

## Naming Rules

- `/login -> page-login.md`
- `/users/:id -> page-users-id.md`
- `/ -> page-home.md`

## Incremental Update Hard Requirements

`--update` 时必须满足：
- 只更新受影响页面，不无差别重写全部文档
- 路由新增/删除/改名时同步更新 `routes.md` 与 `page-xxx.md` 映射
- 页面改名导致 slug 变化时，同步文档文件名；旧文件无法删除时写“已废弃占位说明”
- 可在 frontmatter 增补：
  - `updateMode: incremental`
  - `sourceFiles: [ ... ]`

## Final Validation (Mandatory)

结束前必须自检并汇总：
- `routes.md` 是否覆盖当前有效路由
- `routes.md` 中每条路由是否都有对应 `page-xxx.md`
- 是否存在未被 `routes.md` 引用的陈旧页面文档（删除或标记废弃）
- 关键步骤引用的字段/元素是否在文档内可解析
- 每个关键操作元素是否至少提供 2 个 selector
- 关键流程步骤是否满足“可执行细度”（主流程步骤数、预期结果可观察）

## Final Output

最终回复必须包含：
- `mode: full | incremental`
- `target_root`
- `output_dir: <target_root>/webAIDocs`
- 统计：`routes_count`、`updated_pages`、`removed_or_deprecated_pages`

失败时返回关键错误，并提示先执行安装：`webGenerate opencode install`。
