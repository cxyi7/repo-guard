# @cxyi7/repo-guard

`@cxyi7/repo-guard` 是面向 Vue、JavaScript 和 TypeScript 仓库的质量与安全门禁平台。它复用消费项目已有的工程工具，将提交前检查、推送前检查、GitLab CI 和发布准备统一成可审计的固定流程。

它的核心目标是为 AI 辅助开发提供强制、可审计的工程规范，防止 AI 随意修改受保护文件、绕过质量检查、破坏既定目录和依赖边界，或在缺少验证时直接交付代码。

- 当前版本：`1.16.0`
- Node.js：`>=22.23.2`
- 配置契约：`version: 1`
- 开源协议：MIT

## 已完成功能

### 提交质量与文档同步

- 按固定顺序执行暂存文件的 Stylelint、ESLint、Prettier 修复和只读复检，并通过 `lint-staged` 保留部分暂存内容。
- 根据 Git 记录同步文件头作者与时间，根据 AST 同步函数 `@param`、`@returns` 并提示缺失的 `@throws`。
- 治理样式复杂度、样式作用域和 Vue 文件 style 语言一致性，Git Hook 不执行项目级 fix。

### 安全与仓库治理

- 检查动态代码、Vue `v-html`、外链安全、表单可访问名称和图片 alt，并支持精确、限时、可审计的结构化例外。
- 统一文件和文件夹命名，约束文件归位、单文件行数、依赖声明、代码位置和环境配置泄漏。
- 为受保护文件提供 `audit`、`notify`、`block` 三级策略，并支持企业微信通知。

### 测试、架构与性能

- 支持 TypeScript、Vitest、覆盖率、Vue 组件交互、axe、dependency-cruiser、项目构建和 Lighthouse CI 门禁。
- 支持消费项目 Knip 的全项目无效代码检查，识别未使用文件、导出、依赖、缺失依赖和无效入口，并可用只减不增的基线治理旧项目。
- 支持 Stryker 变异测试、构建前硬门禁和中文报告。
- 支持复用 Axios 客户端的手动接口性能测试，以及基于本机 k6 的手动并发压测和中文报告。

### CI、外部门禁与发布准备

- 提供固定 GitLab CI 配置档、可信 Git 变更范围和可选的托管应用交付外壳。
- 支持受控外部门禁、统一 `GateResult`、console/JSON 报告、退出码和报告安全检查。
- 发布就绪检查覆盖代码质量、测试、构建、版本、Schema、公共入口和 npm 打包内容，只验证而不执行发布或部署。

## 文档结构

| 文档 | 内容 |
|---|---|
| [使用说明](docs/usage-guide.md) | 安装、初始化、命令、配置、执行顺序和各门禁接入方式 |
| [项目结构与功能清单](docs/project-structure-and-feature-inventory.md) | 仓库目录、模块职责、依赖方向、运行模型和完整能力清单 |
| [版本记录](CHANGELOG.md) | 各版本新增、调整和修复内容 |
| [发布流程](PUBLISHING.md) | npm 发布前检查、登录、验证和发布流程 |
| [配置 Schema](config.schema.json) | 主配置字段、类型和约束；其他专项 Schema 位于仓库根目录 |
| [MIT 许可证](LICENSE) | 开源许可范围与条款 |
