# Vue 新窗口链接安全

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

检查模板中可静态识别的 `target="_blank"` 是否同时声明安全的 rel。

## 执行入口

```bash
npx repo-guard target-blank
```

本能力没有 `enable/disable` 功能开关。适用的 pre-commit 固定执行，CI `policy`、`full` 和 `release-ready` 包含对应策略步骤，CI 的 `inherit/off/report/enforce` 单独决定执行方式。手动命令检查项目文件，提交入口检查对应暂存源码，具体结果应结合报告中的范围理解。

## 判断与修复

稳定规则 ID：`vue/target-blank-security`。

使用 `rel="noopener noreferrer"`，且不得包含 `opener`。静态属性和可解析的绑定字面量可被检查；动态 `rel` 无法证明包含所需 token 时会报告问题。动态 target 的运行时行为仍需项目测试。

```html
<a href="/help" target="_blank" rel="noopener noreferrer">使用帮助</a>
```

无法立即消除且规则支持例外时，按[结构化例外](structured-exceptions.md)登记精确位置、责任人、审核依据和有效期。通过表示本次范围内没有未获准的问题；不适用的文件不会因此获得业务或运行时安全保证。

修复后重新暂存并使用相同入口复核。实际界面仍需交互测试和人工验收。

## 维护依据

[实现入口](../../src/policies/vue-target-blank.js) · [对应测试](../../test/vue-target-blank.test.js)
