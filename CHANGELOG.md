# Changelog

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
