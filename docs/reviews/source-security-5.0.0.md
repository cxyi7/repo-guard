# 源码安全唯一入口 5.0.0 审查记录

按用户确认移除兼容入口。此版本取代开发中的 4.2.0 方案，删除公开命令和 Gate ID，属于不兼容变更，因此版本调整为 5.0.0；没有发布。

## 删除与保留范围

- 删除 `dynamic-code`、`unsafe-html`、`target-blank` 命令及其自动生成的 npm 脚本登记。
- 删除 `security.dynamic-code`、`security.vue-unsafe-html`、`security.vue-target-blank` Gate 注册、Hook/CI 步骤和托管规范条目。
- 删除六个旧运行模块：`dynamic-code-gate.js`、`dynamic-code-ast.js`、`dynamic-code-rules.js`、`vue-policy-gates.js`、`policies/vue-unsafe-html.js`、`policies/vue-target-blank.js`。删除新门禁中的旧规则分流与转发逻辑。
- 删除三份旧入口说明文档。旧入口专用测试由统一规则、实际文件/CLI/Hook、精确例外、跨应用隔离和旧入口拒绝测试接替。
- 只保留 `source-security` 命令、`security.source-security` 门禁及 `checks.sourceSecurity` 配置。所有阶段检查同一规则集合，按阶段提供的范围执行。
- Node 前端默认开启六组；Node 后端迁入相同入口，默认只开启 eval / Function 动态代码检查，其余分类及字符串定时器默认关闭。Java 不启用此门禁。
- 底层规则 ID 与精确例外契约保持一致；它们是当前规则标识，不是旧入口别名。源码解析依赖仍由新实现使用，本轮未删除依赖。

## 不提供转换

旧命令返回未知命令配置错误；旧 CI Gate ID 返回未知门禁配置错误，不转发、不静默忽略。项目须直接配置最新命令与 `ci.gatePolicy.gates["security.source-security"]`；不自动转换旧 npm 脚本、CI Gate 策略或交付要求。

## 审查与验证

重点验证统一门禁在 manual、pre-commit、ci-policy、ci-full、release-ready 中没有遗留的“排除旧规则”逻辑；JS、Vue、HTML 同时存在时，三种文件中的明确违规均被检查。

新增实际 CLI 拒绝旧命令、CI 拒绝旧 Gate ID、Node 后端默认分类和精确审批位置反例。保留原有 HTML-only Hook、部分暂存恢复、CRLF 行列、动态值不推导、误报与绕过回归。

首轮专项回归为 510 项，其中 507 通过：一项测试仍引用删除的 Gate ID，已改为当前 ID；另外两项进程终止测试在沙箱中受限，将在允许进程清理的完整回归中复验，不改变断言或门禁要求。

## 最终结果

- 完整回归 `npm test -- --test-concurrency=4`：1449 项，1433 通过、16 项既有可选/平台测试跳过、0 失败，约 307 秒；日志 `test/.tmp/source-security-5-full.log`。首轮沙箱受限的进程终止测试在该轮通过。
- 配置、入口、CI、架构等专项回归及 42 项文档/源码安全/跨应用测试均完成；新入口拒绝、后端默认分类、精确例外和真实 Hook 用例没有跳过。
- `npm run check` 通过，包含 ESLint、依赖边界、语法和中文文案；暂存/未暂存差异检查通过。
- 打包干运行核对 505 个条目：被删除的六个运行模块与三份旧入口文档均不在包内；当前入口、策略、配置及说明齐全；不包含 test、.agents、.git。
- 当前分支 `feat/source-security-5.0.0`，包版本 5.0.0；未提交、推送或发布。历史 4.2.0 审查记录仅保留审查过程，已标注该入口方案被取代，不提供兼容行为。
