---
name: "widget-knowledge-updater"
description: "在前端项目发生增量代码修改后，按受影响范围同步更新 widget-knowledge-system 的 routes.md 与 page-xxx.md；适用于页面、路由、表单、列表、弹窗、共享组件、接口联动等局部变更后的知识文档维护"
---

# Widget Knowledge Updater Skill

## Skill 目标

本 Skill 用于在已有 `widget-knowledge-system` 文档基础上，针对**增量代码变更**同步更新知识文档，避免每次都全量重建。

目标是：

- 只更新受影响的 `routes.md` 行和 `page-xxx.md`
- 尽量保持未受影响页面文档稳定不变
- 让文档随页面、路由、表单、弹窗、列表、共享组件等局部修改持续可用

---

## 适用场景

- 新增、修改、删除少量路由
- 仅修改某几个页面组件
- 修改页面依赖的弹窗、抽屉、表格列、表单 schema、局部子组件
- 修改共享组件、hooks、store、service、constants，并需要同步所有受影响页面文档
- 修改按钮文案、字段文案、鉴权逻辑、提交流程、选择器、交互顺序

以下情况不要使用本 Skill，直接改用 `widget-knowledge-generator`：

- 当前没有现成的 `<references_dir>/routes.md`
- 页面文档整体缺失或质量明显失真
- 项目经历大范围重构，无法可靠界定受影响范围

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
5. 若仍无法可靠定位 `references_dir`，必须显式报错并要求上层调用补充路径，禁止自行读写其他目录

---

## 输出目录（强制约束）

所有写入必须落到：

`<references_dir>/`

允许更新：

- `routes.md`
- `page-<slug>.md`

约束：

- 默认只修改受影响文件，不重写无关文件
- 所有 `write` 操作必须使用相对于 `<references_dir>/` 的路径
- 不允许覆盖 `<references_dir>/` 以外的文件


---

## 输入约定

prompt 或上层 Agent 必须提供：

- 项目源码根目录路径
- 如已知知识库 Skill 目录，可额外提供 `knowledge_skill_root` / `references_dir`

并且至少提供以下之一：

- 变更文件路径列表
- 变更的路由路径 / 页面名称 / 组件路径
- PR / commit / diff 摘要
- 明确的业务改动范围，例如“用户管理页新增批量禁用”

如果输入较模糊，应先做**最小必要定位**，不要直接退化为全量扫描。

示例输入语义：

> “分析 `/workspace/project-a`，我改了 `src/views/admin/users/index.vue` 和 `src/components/UserDialog.vue`，只同步受影响页面文档”

> “分析 `/workspace/project-a`，权限管理新增 `/admin/permission/role` 路由，请增量更新知识库”

---

## 增量更新总原则

1. 先读取已有 `references/routes.md`
2. 只读取受影响页面对应的 `page-xxx.md`
3. 只继续追踪必要的源码文件，不做全项目盲扫
4. 只更新受影响的文档段落、路由行、文件名和元信息
5. 未受影响的页面文档尽量保持原样

如果无法判断影响范围，再逐步扩大读取范围；只有在确认基础文档已不可用时，才建议改走全量生成。

---

## 工作流程

### Step 1：建立基线

先读取以下文件：

- `<references_dir>/routes.md`
- 与用户输入直接相关的已有 `page-xxx.md`
- 用户明确提到的变更源码文件

若 `routes.md` 不存在或严重缺失，停止增量模式，并改用 `widget-knowledge-generator`。

---

### Step 2：识别变更类型

将改动归类为以下一种或多种：

- 路由定义变化
- 页面入口组件变化
- 页面局部子组件变化
- 共享组件 / hooks / store / service / constants 变化
- 文案、校验、权限、提交流程变化
- 样式变化

判断规则：

- 改动路由配置、菜单、layout、guard：优先视为“路由定义变化”
- 改动页面组件本体：优先视为“页面入口组件变化”
- 改动被页面 import 的弹窗、表格、表单、抽屉：视为“页面局部子组件变化”
- 改动被多个页面共同引用的模块：视为“共享依赖变化”
- 仅样式变更且未改变文案、结构、交互、selector：通常不必更新文档

---

### Step 3：从变更文件映射到受影响页面

优先按以下顺序定位：

1. 用 `routes.md` 中的 `组件文件` 直接匹配页面入口
2. 顺着页面组件的 import 链，确认变更文件是否被该页面使用
3. 若改动的是共享模块，找到所有直接或间接引用它的页面
4. 若涉及新路由或删路由，再回到路由定义文件做补充分析

映射结果必须输出为一个明确的受影响集合：

- `affectedRoutes`
- `affectedPages`
- `needsRoutesUpdate`
- `needsPageDocUpdate`

不要因为一个共享组件改动，就默认重写所有 `page-xxx.md`；只更新真实受影响的页面。

---

### Step 4：按变更类型更新 `routes.md`

只有在以下情况发生时，才更新 `routes.md`：

- 新增路由
- 删除路由
- 路由 path 改名
- 页面标题、页面名称、组件文件路径变化
- `authRequired` 变化
- 页面文档文件名需要同步改名

更新规则：

- 保持未受影响路由行原样
- 对受影响路由，按现有表头结构做行级更新
- 若新增路由，补充新行并确保 `文档文件` 指向正确的 `page-xxx.md`
- 若删除路由，从 `routes.md` 中移除对应行
- 若路由改名导致 slug 变化，更新 `文档文件` 列，并同步更新页面文档文件名

---

### Step 5：按受影响范围更新 `page-xxx.md`

对每个受影响页面，只更新真实变化的章节，不要无差别重写整篇文档。

#### 5.1 先读取旧文档

先读取已有 `page-xxx.md`，保留其中仍然正确的内容，重点比对以下章节：

- frontmatter
- 页面用途
- 页面说明
- 前置条件
- 关键操作步骤
- 表单字段
- 操作元素
- 使用注意

#### 5.2 章节级更新规则

按变更类型更新：

- 路由或标题变化：更新 frontmatter、标题、页面用途、前置条件
- 表单字段变化：更新“关键操作步骤”中的相关步骤、`表单字段`、校验与 selector
- 按钮/弹窗/抽屉/列表操作变化：更新“关键操作步骤”和“操作元素”
- 权限变化：更新 `authRequired`、前置条件、页面说明
- API / service / submit handler 变化：更新页面用途、关键步骤的 `expected_result`、使用注意
- 仅文案变化：更新标题、字段名、按钮名、步骤中的 target 与说明
- 仅样式变化且不影响结构、文案、selector、交互：通常无需修改文档

#### 5.3 主流程与辅助流程规则

- 保证每个受影响页面至少保留 1 组有效主流程
- 若页面出现新的明显支线流程，可新增 1 到 3 组辅助流程
- 若原流程已失效，必须删除或改写，不允许保留过期步骤
- `related_fields_or_elements` 必须能在当前文档的“表单字段”或“操作元素”章节中找到对应项

#### 5.4 字段与元素规则

字段与操作元素继续遵循以下 selector 优先级：

1. `#id`
2. `[data-testid="xxx"]`
3. `[name="xxx"]`
4. `[aria-label="xxx"]`
5. 上下文限定选择器
6. `.class`

如果旧 selector 已失效，应移除失效项，不要一味追加。

---

### Step 6：处理新增、改名、删除

#### 新增页面

- 生成新的 `page-xxx.md`
- 在 `routes.md` 中加入对应路由行

#### 页面或路由改名

- 重新计算 slug
- 更新 `routes.md` 中的 `文档文件`
- 将页面文档写入新的 `page-xxx.md`
- 若运行环境无法删除旧文件，则把旧文件改写为“已废弃占位文档”，正文明确说明新文件名与新路由

#### 页面删除

- 从 `routes.md` 中移除对应路由行
- 若运行环境无法删除旧 `page-xxx.md`，则将旧文档改写为“已废弃，不再被 routes.md 引用”

---

## 页面文档结构要求

受影响页面的 `page-xxx.md` 仍需保持与现有系统兼容，至少包含：

- frontmatter
- 页面用途
- 页面说明
- 前置条件
- 关键操作步骤
- 表单字段和/或操作元素
- 使用注意

推荐在 frontmatter 中补充以下可选字段，帮助后续继续做增量同步：

```yaml
updateMode: incremental
sourceFiles:
  - src/views/admin/users/index.vue
  - src/components/UserDialog.vue
```

如果旧文档没有这两个字段，可以新增；如果已有，则按本次受影响源码更新。

---

## 验证要求

完成后必须检查：

1. 所有受影响路由都已在 `routes.md` 中同步
2. 所有受影响页面都已更新到对应 `page-xxx.md`
3. 未受影响页面文档没有被无意义重写
4. “关键操作步骤”里引用的字段和元素，在文档中都能找到
5. 已失效的 selector、按钮名、字段名、旧路由、旧标题没有残留在受影响文档中

---

## 失败兜底

如果遇到以下情况，必须显式说明并建议改用全量生成：

- 无法建立“变更文件 -> 页面路由”的可靠映射
- 现有 `routes.md` 与源码严重不一致
- 受影响范围已经扩散到大部分页面
- 旧文档普遍缺少“页面用途”“关键操作步骤”“表单字段/操作元素”等核心结构
