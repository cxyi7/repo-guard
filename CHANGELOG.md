# Changelog

## 0.11.0

- 让自动 `pre-push` 从待推送提交读取配置，并在质量门禁启用时要求单一的当前 `HEAD` 和干净工作区，确保 Vitest、构建与 Lighthouse 验证的就是实际推送内容。
- 保留多个待推送提交中同路径的独立变更记录，并对无法安全验证的多提交推送给出拆分提示。
- 单元测试静态检查忽略注释和字面量，拒绝 `.skipIf/.todo`，并支持 `.mjs/.cjs/.jsx` 源码映射。
- 加强托管 Hook 标记识别、人工文本保留、Git Remote 凭据脱敏和 Stylelint 无效选项诊断。

## 0.10.0

- 增加面向纯 JavaScript/Vue 项目的可配置 Vitest 单元测试门禁，在 `pre-push` 中先于 Lighthouse 自动执行。
- 默认以本次推送的精确 Git 范围检查新增目标源码是否存在同目录 `.spec.js`，支持切换为检查所有变更源码，并可配置源码、测试和排除 glob。
- 拒绝没有 `it/test` 用例的空测试，以及本次变更测试文件中的 `describe/it/test.skip` 和 `.only`；失败时输出可直接交给 AI 的中文修复指令。
- 启用单元测试时增量维护根目录 `AGENTS.md` 的受管理测试规范，保留已有人工内容，并由 `doctor` 验证和修复。
- 增加测试脚本、超时和覆盖率开关；测试框架、Vue Test Utils、运行环境、Mock 和覆盖率阈值继续由业务项目控制。
- 托管 Hook 升级为 v4，继续识别并升级 v1、v2、v3 Hook。

## 0.9.0

- 增加可配置的最终暂存文件物理行数门禁，默认限制 Vue 文件 700 行、JS/JSX/TS/TSX 文件 1000 行。
- 行数检查在 Stylelint/ESLint 最终复检之后运行，并通过 `lint-staged` 正确隔离部分暂存文件的未暂存内容。
- 新项目默认启用行数门禁；已有配置迁移时保持关闭，可通过 `repo-guard enable maxFileLines` 开启。
- 支持按仓库相对 glob 配置多条限制和排除生成文件，超限时为每个文件输出可单独复制给 AI 的完整重构指令。
- 增加默认 85% 的非阻断预警，以及允许存量超限文件持平或缩短的 `noRegression` 渐进治理模式。
- Vue 超限提示增加 `template`、`script`、`style` 有效内容行数和最大区域的针对性拆分建议。
- 增加由 `preCommit.eslint.preset` 开关控制的 AI 可维护性规则基线，不需要项目手动导入 repo-guard 配置。
- ESLint 基线通过 `baseConfig` 使用业务项目安装的 `@eslint/js`，并按安装情况自动加入 `eslint-plugin-vue` 和 `typescript-eslint`；项目原有 Flat Config 后加载并可覆盖基线。
- 新项目默认开启 ESLint 基线；已有配置迁移保持关闭。自动基线要求 ESLint `>=9.19`，`doctor` 会检查版本和依赖。
- ESLint 基线不启用类型感知检查，避免在 pre-commit 中引入 TypeScript 类型检查。

## 0.8.0

- 增加仅面向 Vue 项目的 `repo-guard lighthouse`，使用业务项目本地 `@lhci/cli` 和 `lighthouserc.*`。
- Lighthouse 执行项目 npm 构建脚本后依次运行 `collect` 和 `assert`，支持 `--skip-build`。
- 增加默认关闭的 Lighthouse `pre-push` 门禁、环境诊断和 `.lighthouseci/` 忽略维护。
- 托管 Hook 升级为 v3，兼容识别和升级 v1、v2 Hook。

## 0.7.0

- 增加使用业务项目本地安装和配置的暂存文件 Stylelint 自动修复门禁。
- 固定质量流水线为 Stylelint 修复、ESLint 修复、Prettier、Stylelint 复检、ESLint 复检。
- Stylelint 修复失败或后续门禁失败时恢复整个质量流水线修改，并保留部分暂存文件的未暂存内容。
- `init` 仅在本地 Stylelint 和项目配置都存在时自动启用，不安装依赖、不生成规则、不探测语言组合。
- 同一个 Vue 文件混用多种 `<style lang>` 时直接阻止提交；未修复问题输出编号式中文 AI 修复指令。
- 增加可选 peer dependency `stylelint >=16 <18`，Node.js 最低版本保持 `18.12.0`。

## 0.6.0

- 增加默认开启的项目级 `notification.enabled` 企业微信通知开关。
- 增加 `repo-guard enable notification` 和 `repo-guard disable notification`。
- 通知关闭后仍识别并记录受保护文件，但不校验通知参数、不发送请求且不阻止提交。
- ESLint 无法修复时，为每个问题生成带编号、可单独复制给 AI 的中文修复指令。
- 修复指令包含相对路径、行列、规则、原始错误和禁止绕过规则的约束。

## 0.5.0

- 新项目执行 `init` 时默认启用 ESLint 修复、Prettier 格式化和 9 条通知级保护规则。
- 增加幂等的 `repo-guard migrate`，补齐缺失配置但保留项目规则和显式设置。
- 增加 `repo-guard enable eslint prettier`，显式快速启用暂存质量门禁。
- 增加 `repo-guard doctor --fix`，修复托管 Hook、项目脚本和受管理仓库文件。
- 安装器写入前预检全部 Hook，遇到自定义 Hook 时不再产生部分升级。
- 初始化和修复时增加 `guard:migrate`、`guard:enable-quality` 项目脚本。
- 配置仍使用 `version: 1`，升级包不会使旧项目配置失效。

## 0.4.0

- 增加可配置的暂存文件 Prettier 自动格式化和只检查门禁。
- 统一编排 ESLint 修复、Prettier 格式化和 ESLint 最终复检。
- 使用业务项目本地的 Prettier 3、项目格式规则和忽略文件。
- 增加质量流水线级文件快照，任一步失败时恢复全部修改。
- `doctor` 增加 Prettier 版本和项目配置检查。
- 保持 v1 配置向后兼容，未显式启用 Prettier 的项目行为不变。

## 0.3.0

- 增加可配置的暂存文件 ESLint 自动修复门禁。
- 使用 `lint-staged` 隔离部分暂存文件中的未暂存内容。
- 修复后复检，再执行保护文件识别、指纹和企业微信通知。
- 增加项目本地 ESLint 解析和忽略文件识别。
- Hook 升级为 v2，并兼容自动迁移 v1 托管 Hook。
- `doctor` 增加 ESLint 配置和过期 Hook 检查。
- 不包含 TypeScript 类型检查。

## 0.2.0

- 增加本地 `.env.config` 通知配置模板和泄漏保护。
- 初始化时增量维护 `.gitignore`。

## 0.1.0

- 提供受保护文件规则、企业微信通知、暂存指纹和 Git Hook 安装。
