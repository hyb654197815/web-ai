---
name: "widget-knowledge-generator"
description: "分析前端项目源码并全量生成或重建 widget-knowledge-system Skill（路由索引与页面级操作文档）；适用于首次建库、历史文档质量较差或发生大范围重构后的整体重建"
---

# Widget Knowledge Generator Skill

## Skill 目标

本 Skill 用于对前端项目进行一次性静态分析，并在当前工作目录下**全量生成或重建** `widget-knowledge-system` 的知识文档，使受限 Agent 能够：

- 仅通过 `routes.md` 判断页面导航
- 按需加载 `page-xxx.md` 理解页面用途、关键流程、字段与关键元素
- 在不理解源码、不生成 JS 的前提下，为页面问答、代码定位和 UI 自动化提供稳定知识基础

---

## 适用与不适用

### 适用场景

- 首次为项目建立 `widget-knowledge-system`
- 现有 `routes.md` / `page-xxx.md` 缺失较多、质量较差或结构不一致
- 项目发生大范围重构，多个模块、路由组织方式、目录结构已明显变化
- 需要统一重建所有页面文档

### 不适用场景

以下情况**不要默认使用本 Skill**，优先改用 `widget-knowledge-updater`：

- 只修改了少量页面、表单、弹窗、列表、共享组件或接口逻辑
- 只想同步若干受影响路由和页面文档
- 希望尽量保持未受影响文档不变，避免全量重写

---

## 路径解析约定

在执行任何 `read` / `write` 之前，先解析以下内部路径变量：

- `knowledge_skill_root`：`widget-knowledge-system` Skill 根目录
- `references_dir`：知识文档目录，固定等于 `<knowledge_skill_root>/references/`

解析顺序：

1. 若上层调用显式提供 `references_dir` 或 `knowledge_output_dir`，优先使用该目录
2. 否则若上层调用显式提供 `knowledge_skill_root` 或 `knowledge_skill_dir`，则使用 `<knowledge_skill_root>/references/`
3. 否则默认把当前 Skill 同级目录中的 `../widget-knowledge-system/` 视为 `knowledge_skill_root`
4. `.opencode/skills/` 只是当前 OpenCode 的一种安装形态，不得写死为唯一前缀
5. 若仍无法可靠定位 `references_dir`，必须显式报错并要求上层调用补充路径，禁止自行写入其他目录

---

## 输出目录（强制约束）

所有生成文件必须写入：

`<references_dir>/`

包含：

- `routes.md`
- `page-<slug>.md`

### 路径约束说明

- 禁止写入任何其他目录
- 所有 `write` 操作必须使用相对于 `<references_dir>/` 的路径
- 不允许覆盖 `<references_dir>/` 以外的文件


---

## 输入约定

- prompt 或上层 Agent **必须提供项目源码根目录路径**
- 上层 Agent 如已知知识库 Skill 目录，可额外提供 `knowledge_skill_root` / `references_dir`，避免对安装目录做任何假设
- Skill 使用 `read` 从该路径读取源码
- Skill **不得假设当前工作目录即源码目录**

示例输入语义：
> “分析 `/workspace/project-a` 下的前端项目源码，并全量重建 widget-knowledge-system”

---

## 工作流程

### Step 1：识别项目架构

1. 使用 `read` 读取 `<project_root>/package.json`
2. 根据 dependencies / devDependencies 判断技术栈：
   - Vue 2 / Vue 3（`vue`, `vue-router`, `@vue/router`）
   - React（`react`, `react-router-dom`）
   - Next.js / Nuxt（`next`, `nuxt`）
3. 推断路由机制：
   - 配置式路由
   - 文件系统路由（`pages` 目录）

输出内部状态：

- `framework`
- `routerType`（`config` / `filesystem`）
- `language`（`js` / `ts`）

---

### Step 2：定位路由定义

根据框架查找路由入口文件：

#### Vue

- `src/router/index.js`
- `src/router/index.ts`
- `src/router.js`
- `src/router.ts`

#### React

- `src/App.jsx`
- `src/App.tsx`
- `src/routes.js`
- `src/routes.jsx`
- `src/routes.tsx`
- `createBrowserRouter`
- `<Routes>`

#### 文件系统路由

- `pages/`
- `src/pages/`

提取信息：

- `path`
- `component` 文件路径
- 动态参数（`:id`, `[id]`）

---

### Step 3：路由到页面组件映射

- 解析 import / lazy import
- 将每个 route 映射到真实组件文件
- 若组件为懒加载，仍需解析目标文件

若无法定位组件：

- 仍生成 route
- 在页面文档中标记 `parsing_warning`

---

### Step 4：生成 `routes.md`

文件结构固定如下：

```markdown
---
generated_by: widget-knowledge-generator
version: 1.3.0
generated_at: <ISO8601>
framework: vue3
project_root: <path>
---

# 系统路由与页面概要

## 路由列表

| 路径 | 页面名称 | 组件文件 | 文档文件 | authRequired |
|------|----------|----------|----------|--------------|
| /login | 登录页 | src/pages/Login.vue | page-login.md | false |

## 使用说明

- Agent 首次仅加载本文件
- 页面级操作前，按需读取对应 page-xxx.md
```

---

### Step 5：全量分析页面源码并生成 `page-xxx.md`

根据生成的 `routes.md` 对所有路由进行遍历，对每个路由对应的页面组件做静态分析，并提取以下信息。

#### 5.1 页面元信息提取

- 基础属性：提取页面标题，优先级为 `definePage meta.title` > `document.title` > 组件注释
- 功能描述：提取 JSDoc、文件头注释、页面头部文案
- 权限状态：识别路由守卫标识（如 `meta.requiresAuth`、`beforeEnter`），准确判断 `authRequired`
- 页面具体用途：结合路由路径、页面标题、头部文案、按钮文案、列表/表单结构，总结业务目标、适用对象、完成结果；禁止只写“某某管理页”这类空泛描述

#### 5.2 页面关键操作步骤提取

覆盖范围：

- 登录、注册、搜索、筛选、重置、保存、提交、发布
- 新增、编辑、删除、批量操作、导入、导出、上传、下载
- 弹窗打开/关闭、抽屉操作、Tab 切换、分页、详情查看、行内操作

生成要求：

- 每个页面至少输出 1 组主流程
- 若存在明显辅助流程，可额外输出 1 到 3 组辅助流程
- 每组流程推荐 3 到 6 步，必须按真实页面交互顺序描述
- 每一步必须写明：`action`、`target`、`related_fields_or_elements`、`expected_result`
- `related_fields_or_elements` 必须引用后续“表单字段”或“操作元素”章节中真实存在的名称
- 对列表页、详情页、设置页等非纯表单页面，也必须给出符合页面职责的关键步骤
- 若只能根据源码合理推断，需显式写明“推断”；不得编造不存在的流程

#### 5.3 表单字段深度识别

识别范围：

- 原生元素：`input`、`textarea`、`select`
- UI 框架组件：AntD `Form.Item`、Element `el-form-item`、MUI `TextField` 等

字段详情要求：

- 根据 `label`、`placeholder`、`name` 推断语义化字段名
- 字段类型输出为：`text` / `password` / `number` / `checkbox` / `select` / `custom`
- Selector 必须遵循以下优先级：
  1. `#id`
  2. `[data-testid="xxx"]`
  3. `[name="xxx"]`
  4. `[aria-label="xxx"]`
  5. 上下文限定选择器
  6. `.class`（仅兜底且需确保唯一）

#### 5.4 操作元素提取

目标对象：

- 提交按钮（提交 / 发布 / 保存）
- 与当前表单强绑定的关键确认按钮
- 页面主操作按钮（新增、编辑、删除、导入、导出、查看详情等）
- 列表页的搜索、重置、分页、行操作控件
- 触发弹窗、抽屉、Tab、上传器的关键控件

提取要求：

- 仅提取元素语义与 selector，不生成可执行脚本
- Selector 沿用上述优先级规则
- 若某个元素出现在“关键操作步骤”中，则必须在本章节中给出可用 selector

#### 5.5 页面文档命名与结构

命名规则：

- `/login` -> `page-login.md`
- `/users/:id` -> `page-users-id.md`
- `/` -> `page-home.md`

标准模板：

```markdown
---
path: /login
slug: page-login
title: 用户登录
pagePurpose: 用户登录鉴权与建立会话
component: src/pages/Login.vue
generated_by: widget-knowledge-generator
generated_at: <ISO8601>
authRequired: false
params: []
---
# 页面：用户登录
## 页面用途
- 适用对象：未登录用户
- 核心目标：输入账号密码并完成登录鉴权
- 成功结果：登录成功后进入首页或业务目标页
## 页面说明
用于用户登录鉴权，包含凭证输入与提交逻辑。
## 前置条件
- 当前已进入 `/login`
- 若存在来源页跳转逻辑，应保留登录后的返回路径
## 关键操作步骤
### 主流程：账号密码登录
1. 填写用户名
   - action: fill
   - target: username
   - related_fields_or_elements:
     - username
   - expected_result: 用户名输入框出现待登录账号
2. 填写密码
   - action: fill
   - target: password
   - related_fields_or_elements:
     - password
   - expected_result: 密码输入框完成凭证输入
3. 点击登录提交
   - action: click
   - target: 登录提交
   - related_fields_or_elements:
     - password
     - 登录提交
   - expected_result: 表单被提交，并进入登录后的页面或触发登录结果反馈
## 表单字段
### username
- type: text
- selectors:
  - #login-username
  - input[name="username"]
- validation: required
## 操作元素
### 登录提交
- selectors:
  - button[type=submit]
  - [data-testid="login-submit"]
## 使用注意
- Agent 执行 `fill_form` 时，优先使用 `selectors` 列表中的首个选择器。
- 若首选选择器失效，按列表顺序依次降级尝试后续选择器。
- 若页面结构变化导致所有选择器失效，需重新生成此文档。
```

---

### Step 6：检查产物

1. 检查项目源码中的所有路由是否都出现在 `routes.md`
2. 根据 `routes.md` 检查所有页面路由是否都已经生成对应 `page-xxx.md`
3. 抽查每个 `page-xxx.md` 是否同时包含“页面用途”“关键操作步骤”“表单字段/操作元素”，避免生成只有选择器、没有业务语义的空心文档

---

## 与增量更新 Skill 的协同规则

- 本 Skill 负责“初始化”和“全量重建”
- 当用户描述的是“我刚改了这些页面/这些文件，请同步更新文档”时，优先使用 `widget-knowledge-updater`
- 全量生成完成后，后续常规迭代默认走增量更新，不要每次重扫整个项目
