# 功能说明文档索引

每项能力都提供用途、接入或调用方式、执行范围、判断依据、失败处理以及实现和测试入口。安装与日常操作从[使用说明](../usage-guide.md)开始；内部模块职责见[维护者架构说明](../project-structure-and-feature-inventory.md)。

交付相关能力统一维护在[交付合同手册](delivery-contract.md)：功能登记、合同、证据和反馈是同一条流程，下面按环节链接到同页相应位置。

## 接入与托管

| 功能 | 说明文档 | 状态 |
|---|---|---|
| 项目初始化 | [docs/features/project-initialization.md](project-initialization.md) | 已维护 |
| 配置迁移 | [docs/features/configuration-migration.md](configuration-migration.md) | 已维护 |
| Doctor 诊断与受管修复 | [docs/features/doctor.md](doctor.md) | 已维护 |
| 托管 Git Hook | [docs/features/managed-git-hooks.md](managed-git-hooks.md) | 已维护 |
| AGENTS 托管规范 | [docs/features/managed-agent-policies.md](managed-agent-policies.md) | 已维护 |
| GitLab CI 安装与配置档 | [docs/features/gitlab-ci.md](gitlab-ci.md) | 已维护 |

## 提交阶段质量与安全

| 功能 | 说明文档 | 状态 |
|---|---|---|
| 暂存隔离与跨进程重入保护 | [docs/features/staged-isolation-and-lifecycle-lock.md](staged-isolation-and-lifecycle-lock.md) | 已维护 |
| Stylelint | [docs/features/stylelint.md](stylelint.md) | 已维护 |
| ESLint | [docs/features/eslint.md](eslint.md) | 已维护 |
| Prettier | [docs/features/prettier.md](prettier.md) | 已维护 |
| 文件头同步 | [docs/features/file-header.md](file-header.md) | 已维护 |
| 函数文档同步 | [docs/features/function-documentation.md](function-documentation.md) | 已维护 |
| Vue 异步资源清理 | [docs/features/async-resource-cleanup.md](async-resource-cleanup.md) | 已维护 |
| UI Token 契约 | [docs/features/ui-tokens.md](ui-tokens.md) | 已维护 |
| 样式复杂度 | [docs/features/style-complexity.md](style-complexity.md) | 已维护 |
| 样式治理 | [docs/features/style-governance.md](style-governance.md) | 已维护 |
| 动态代码 | [docs/features/dynamic-code.md](dynamic-code.md) | 已维护 |
| Vue 不安全 HTML | [docs/features/vue-unsafe-html.md](vue-unsafe-html.md) | 已维护 |
| Vue 新窗口链接安全 | [docs/features/vue-target-blank.md](vue-target-blank.md) | 已维护 |
| Vue 表单标签 | [docs/features/vue-form-label.md](vue-form-label.md) | 已维护 |
| Vue 图片替代文本 | [docs/features/vue-image-alt.md](vue-image-alt.md) | 已维护 |

## 仓库与代码治理

| 功能 | 说明文档 | 状态 |
|---|---|---|
| 路径命名 | [docs/features/path-naming.md](path-naming.md) | 已维护 |
| 文件归位 | [docs/features/file-placement.md](file-placement.md) | 已维护 |
| 单文件行数 | [docs/features/maximum-file-lines.md](maximum-file-lines.md) | 已维护 |
| 代码位置 | [docs/features/code-placement.md](code-placement.md) | 已维护 |
| 保护文件 | [docs/features/protected-files.md](protected-files.md) | 已维护 |
| 企业微信通知 | [docs/features/wecom-notification.md](wecom-notification.md) | 已维护 |
| 图片资源质量 | [docs/features/image-assets.md](image-assets.md) | 已维护 |
| 图片安全优化 | [docs/features/image-optimization.md](image-optimization.md) | 已维护 |
| 无效图片资源与 Git 基线 | [docs/features/unused-image-assets.md](unused-image-assets.md) | 已维护 |
| 依赖声明与锁文件 | [docs/features/dependency-policy.md](dependency-policy.md) | 已维护 |
| 提交信息生命周期 | [docs/features/commit-message.md](commit-message.md) | 已维护 |
| 结构化例外 | [docs/features/structured-exceptions.md](structured-exceptions.md) | 已维护 |
| 树形功能登记 | [交付合同手册 · 功能登记与合同规划](delivery-contract.md#功能登记与合同规划) | 已维护 |
| 交付合同门禁 | [docs/features/delivery-contract.md](delivery-contract.md) | 已维护 |
| 交付证据复核 | [交付合同手册 · 交付证据与两轮复核](delivery-contract.md#交付证据与两轮复核) | 已维护 |
| 真实反馈反向升级 | [交付合同手册 · 真实测试反馈与反向升级](delivery-contract.md#真实测试反馈与反向升级) | 已维护 |

## 测试、构建与性能

| 功能 | 说明文档 | 状态 |
|---|---|---|
| 单元测试 | [docs/features/unit-test.md](unit-test.md) | 已维护 |
| Vue 组件交互测试 | [docs/features/component-interaction.md](component-interaction.md) | 已维护 |
| 覆盖率 | [docs/features/coverage.md](coverage.md) | 已维护 |
| 变异测试 | [docs/features/mutation-test.md](mutation-test.md) | 已维护 |
| 受保护构建 | [docs/features/guarded-build.md](guarded-build.md) | 已维护 |
| axe 可访问性测试 | [docs/features/accessibility-test.md](accessibility-test.md) | 已维护 |
| TypeScript 类型检查 | [docs/features/typecheck.md](typecheck.md) | 已维护 |
| dependency-cruiser 架构检查 | [docs/features/architecture.md](architecture.md) | 已维护 |
| Knip 无效代码与基线 | [docs/features/dead-code.md](dead-code.md) | 已维护 |
| 项目构建 | [docs/features/build.md](build.md) | 已维护 |
| 单平台构建产物预算 | [docs/features/build-artifact-budget.md](build-artifact-budget.md) | 已维护 |
| Lighthouse | [docs/features/lighthouse.md](lighthouse.md) | 已维护 |
| Axios 接口性能 | [docs/features/api-performance.md](api-performance.md) | 已维护 |
| k6 接口压测 | [docs/features/k6-load-test.md](k6-load-test.md) | 已维护 |

## CI、报告与发布准备

| 功能 | 说明文档 | 状态 |
|---|---|---|
| 官方 Gate Registry | [docs/features/gate-registry.md](gate-registry.md) | 已维护 |
| GateResult 与报告 | [docs/features/gate-result-and-reporting.md](gate-result-and-reporting.md) | 已维护 |
| 项目外部门禁 | [docs/features/external-gates.md](external-gates.md) | 已维护 |
| GitLab 应用交付流水线 | [docs/features/managed-delivery-pipeline.md](managed-delivery-pipeline.md) | 已维护 |
| 发布就绪检查 | [docs/features/release-ready.md](release-ready.md) | 已维护 |

## 单项文档约定

普通能力按独立主题维护；交付合同按完整流程集中维护，用同页锚点定位各环节。每个主题至少回答：

1. 解决什么问题，边界是什么；
2. 如何启用、配置或调用；配置示例旁逐项说明字段用途、可填值、默认值与约束；
3. 在哪些生命周期执行，读取什么范围；
4. 通过、跳过和失败如何判断，产生哪些证据；
5. 失败后如何修复和复核；
6. 有哪些安全限制、明确不做的事情；
7. 实现入口与对应测试位于哪里。

单项文档描述当前有效实现；版本演进和历史变化只记录在 [CHANGELOG](../../CHANGELOG.md)。

### 配置示例怎么读、怎么维护

- JSON 示例保持标准 JSON，复制时不需要删除注释；紧随其后的字段表解释用途、可选值、默认值、数值范围、路径格式及字段联动。YAML 和 JavaScript 支持注释，可在字段同一行说明。
- 表头注明字段所在对象，例如 `preCommit.pathNaming`；`entries[].reason` 表示数组中每个对象的 `reason`。中间对象用于分组，不能把子字段直接移到配置根级。
- 默认值指省略字段时的补缺值；示例值是当前示例的选择。首次初始化可能根据项目工具是否就绪启用功能，不能把示例中的 `true` 一律写成默认开启。
- `false`、`null`、`0` 和 `[]` 含义不同，不能互换；可为空、可省略、必填及“关闭检查”等语义必须按对应字段说明。数组配置会整项替换，修改主配置片段时保留其他已有字段。
- 枚举必须列出所有允许值，数字说明单位和上下限，路径说明相对哪个目录、是否支持 glob、是否允许为空以及排除优先级。涉及脚本、报告、凭据环境变量或人工确认时，写明前置条件和绑定要求。
- 新增或修改字段时，同时修改示例及旁边的说明；用配置 Schema、补缺默认值和实际校验逻辑交叉核对，不从字段名猜测含义。

## 文档随功能一起维护

| 发生什么变化 | 同步哪些内容 |
|---|---|
| 新增、修改或移除功能 | 对应功能说明、此索引、使用说明入口及开关描述；领域或生命周期变化时同步项目总览 |
| 开关、默认值、范围、联动改变 | 使用说明的 30 项表、相关专题的配置示例与字段说明、配置 Schema 与测试 |
| CLI、Hook、CI 或报告变化 | 操作示例、执行范围、错误处理、相应流程图与回归测试 |
| 交付字段或验收规则变化 | 统一交付手册的流程、时序、反馈图、字段参考，以及 Skill 模板与测试 |
| 模块或依赖边界变化 | 维护者架构说明与架构测试 |

新能力在交付时就应有可用说明，不登记尚不存在的文档链接。维护时核对源码、Schema、执行计划和测试；检查示例可解析、开关不遗漏、相对链接与锚点可达，SVG 与 Mermaid 源文件含义一致。历史演进只写入 CHANGELOG。
