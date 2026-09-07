# Vue 不安全 HTML

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

发现 Vue 模板中的 `v-html` 及其变体，避免直接注入 HTML 带来的风险。

## 执行入口

```bash
npx repo-guard unsafe-html
```

本能力没有 `enable/disable` 功能开关。适用的 pre-commit 固定执行，CI `policy`、`full` 和 `release-ready` 包含对应策略步骤，CI 的 `inherit/off/report/enforce` 单独决定执行方式。手动命令检查项目文件，提交入口检查对应暂存源码，具体结果应结合报告中的范围理解。

## 判断与修复

稳定规则 ID：`vue/no-v-html`。

普通文本使用插值，结构化内容使用受控组件。门禁检查 `v-html` 的使用本身，不会因为表达式中出现净化函数就自动放行；富文本确有需要时，应先评审来源、净化与渲染边界，再登记精确限时例外。

无法立即消除且规则支持例外时，按[结构化例外](structured-exceptions.md)登记精确位置、责任人、审核依据和有效期。通过表示本次范围内没有未获准的问题；不适用的文件不会因此获得业务或运行时安全保证。

修复后重新暂存并使用相同入口复核。实际界面仍需交互测试和人工验收。

## 维护依据

[实现入口](../../src/policies/vue-unsafe-html.js) · [对应测试](../../test/vue-unsafe-html.test.js)
