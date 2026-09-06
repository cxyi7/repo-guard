# 功能说明文档索引

本目录用于维护 `@cxyi7/repo-guard` 各项能力的独立说明文档。项目级定位、工作模型、能力领域和代码职责见[项目结构与能力总览](../project-structure-and-feature-inventory.md)；安装、配置和命令见[使用说明](../usage-guide.md)。

当前先建立完整索引。状态为“待编写”的路径是已规划的文档位置，不表示文件已经存在；补写单项文档时，应把路径改为可点击链接并将状态更新为“已维护”。

## 接入与托管

| 功能 | 计划文档 | 状态 |
|---|---|---|
| 项目初始化 | `docs/features/project-initialization.md` | 待编写 |
| 配置迁移 | `docs/features/configuration-migration.md` | 待编写 |
| Doctor 诊断与受管修复 | `docs/features/doctor.md` | 待编写 |
| 托管 Git Hook | `docs/features/managed-git-hooks.md` | 待编写 |
| AGENTS 托管规范 | `docs/features/managed-agent-policies.md` | 待编写 |
| GitLab CI 安装与配置档 | `docs/features/gitlab-ci.md` | 待编写 |

## 提交阶段质量与安全

| 功能 | 计划文档 | 状态 |
|---|---|---|
| 暂存隔离与跨进程重入保护 | `docs/features/staged-isolation-and-lifecycle-lock.md` | 待编写 |
| Stylelint | `docs/features/stylelint.md` | 待编写 |
| ESLint | `docs/features/eslint.md` | 待编写 |
| Prettier | `docs/features/prettier.md` | 待编写 |
| 文件头同步 | `docs/features/file-header.md` | 待编写 |
| 函数文档同步 | `docs/features/function-documentation.md` | 待编写 |
| Vue 异步资源清理 | `docs/features/async-resource-cleanup.md` | 待编写 |
| UI Token 契约 | `docs/features/ui-tokens.md` | 待编写 |
| 样式复杂度 | `docs/features/style-complexity.md` | 待编写 |
| 样式治理 | `docs/features/style-governance.md` | 待编写 |
| 动态代码 | `docs/features/dynamic-code.md` | 待编写 |
| Vue 不安全 HTML | `docs/features/vue-unsafe-html.md` | 待编写 |
| Vue 新窗口链接安全 | `docs/features/vue-target-blank.md` | 待编写 |
| Vue 表单标签 | `docs/features/vue-form-label.md` | 待编写 |
| Vue 图片替代文本 | `docs/features/vue-image-alt.md` | 待编写 |

## 仓库与代码治理

| 功能 | 计划文档 | 状态 |
|---|---|---|
| 路径命名 | `docs/features/path-naming.md` | 待编写 |
| 文件归位 | `docs/features/file-placement.md` | 待编写 |
| 单文件行数 | `docs/features/maximum-file-lines.md` | 待编写 |
| 代码位置 | `docs/features/code-placement.md` | 待编写 |
| 保护文件 | `docs/features/protected-files.md` | 待编写 |
| 企业微信通知 | `docs/features/wecom-notification.md` | 待编写 |
| 图片资源质量 | `docs/features/image-assets.md` | 待编写 |
| 图片安全优化 | `docs/features/image-optimization.md` | 待编写 |
| 无效图片资源与 Git 基线 | `docs/features/unused-image-assets.md` | 待编写 |
| 依赖声明与锁文件 | `docs/features/dependency-policy.md` | 待编写 |
| 提交信息生命周期 | `docs/features/commit-message.md` | 待编写 |
| 结构化例外 | `docs/features/structured-exceptions.md` | 待编写 |
| 树形功能登记 | `docs/features/feature-registry.md` | 待编写 |
| 交付合同门禁 | `docs/features/delivery-contract.md` | 待编写 |
| 交付证据复核 | `docs/features/delivery-evidence.md` | 待编写 |
| 真实反馈反向升级 | `docs/features/delivery-feedback.md` | 待编写 |

合同类能力当前已有共享的[合同驱动交付格式](../contract-driven-delivery.md)，但它不替代上表中各能力自己的说明文档。

## 测试、构建与性能

| 功能 | 计划文档 | 状态 |
|---|---|---|
| 单元测试 | `docs/features/unit-test.md` | 待编写 |
| Vue 组件交互测试 | `docs/features/component-interaction.md` | 待编写 |
| 覆盖率 | `docs/features/coverage.md` | 待编写 |
| 变异测试 | `docs/features/mutation-test.md` | 待编写 |
| 受保护构建 | `docs/features/guarded-build.md` | 待编写 |
| axe 可访问性测试 | `docs/features/accessibility-test.md` | 待编写 |
| TypeScript 类型检查 | `docs/features/typecheck.md` | 待编写 |
| dependency-cruiser 架构检查 | `docs/features/architecture.md` | 待编写 |
| Knip 无效代码与基线 | `docs/features/dead-code.md` | 待编写 |
| 项目构建 | `docs/features/build.md` | 待编写 |
| 单平台构建产物预算 | `docs/features/build-artifact-budget.md` | 待编写 |
| Lighthouse | `docs/features/lighthouse.md` | 待编写 |
| Axios 接口性能 | `docs/features/api-performance.md` | 待编写 |
| k6 接口压测 | `docs/features/k6-load-test.md` | 待编写 |

## CI、报告与发布准备

| 功能 | 计划文档 | 状态 |
|---|---|---|
| 官方 Gate Registry | `docs/features/gate-registry.md` | 待编写 |
| GateResult 与报告 | `docs/features/gate-result-and-reporting.md` | 待编写 |
| 项目外部门禁 | `docs/features/external-gates.md` | 待编写 |
| GitLab 应用交付流水线 | `docs/features/managed-delivery-pipeline.md` | 待编写 |
| 发布就绪检查 | `docs/features/release-ready.md` | 待编写 |

## 单项文档约定

每份功能说明应只描述一个可独立理解和维护的能力，并至少回答：

1. 解决什么问题，边界是什么；
2. 如何启用、配置或调用；
3. 在哪些生命周期执行，读取什么范围；
4. 通过、跳过和失败如何判断，产生哪些证据；
5. 失败后如何修复和复核；
6. 有哪些安全限制、明确不做的事情；
7. 实现入口与对应测试位于哪里。

单项文档描述当前有效实现；版本演进和历史变化只记录在 [CHANGELOG](../../CHANGELOG.md)。
