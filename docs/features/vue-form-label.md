# Vue 表单标签

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

检查原生 input、select、textarea 是否有可识别的名称，让用户理解需要输入什么。

## 执行入口

```bash
npx repo-guard form-labels
```

本能力没有 `enable/disable` 功能开关。适用的 pre-commit 固定执行，CI `policy`、`full` 和 `release-ready` 包含对应策略步骤，CI 的 `inherit/off/report/enforce` 单独决定执行方式。手动命令检查项目文件，提交入口检查对应暂存源码，具体结果应结合报告中的范围理解。

## 判断与修复

稳定规则 ID：`vue/form-control-label`。

优先使用有文本的 `<label for>` 与静态 id，或用有文本的 label 包裹控件。非空静态 `aria-label` 和指向存在、有文本、非自身元素的 `aria-labelledby` 也可形成名称。placeholder 不能替代标签；动态名称无法静态证明时会报告。button、hidden、image、reset、submit 类型的 input 不属于本规则的文字控件集合。

```html
<label for="userName">姓名</label>
<input id="userName" name="userName" />
```

无法立即消除且规则支持例外时，按[结构化例外](structured-exceptions.md)登记精确位置、责任人、审核依据和有效期。通过表示本次范围内没有未获准的问题；不适用的文件不会因此获得业务或运行时安全保证。

修复后重新暂存并使用相同入口复核。实际界面仍需交互测试和人工验收。

## 维护依据

[实现入口](../../src/policies/vue-form-label.js) · [对应测试](../../test/vue-form-label.test.js)
