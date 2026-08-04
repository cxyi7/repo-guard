# Changelog

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
