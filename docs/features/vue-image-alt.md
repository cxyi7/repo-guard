# Vue 图片替代文本

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

检查原生 img 的替代文本是否明确表达用途，并区分内容图片与装饰图片。

## 执行入口

```bash
npx repo-guard image-alt
```

本能力没有 `enable/disable` 功能开关。适用的 pre-commit 固定执行，CI `policy`、`full` 和 `release-ready` 包含对应策略步骤，CI 的 `inherit/off/report/enforce` 单独决定执行方式。手动命令检查项目文件，提交入口检查对应暂存源码，具体结果应结合报告中的范围理解。

## 判断与修复

稳定规则 ID：`vue/img-alt`。

内容图片使用具体、非空、可静态验证的 alt；“图片”、文件名和空白占位不能说明用途。装饰图片使用 `alt=""` 并声明静态 `role="presentation"` 或 `role="none"`。动态 alt/role、重复声明及无参数 `v-bind` 会使语义不可证明。

```html
<img src="/assets/orderFlow.svg" alt="订单从创建到签收的四个步骤" />
<img src="/assets/divider.svg" alt="" role="presentation" />
```

无法立即消除且规则支持例外时，按[结构化例外](structured-exceptions.md)登记精确位置、责任人、审核依据和有效期。通过表示本次范围内没有未获准的问题；不适用的文件不会因此获得业务或运行时安全保证。

修复后重新暂存并使用相同入口复核。实际界面仍需交互测试和人工验收。

## 维护依据

[实现入口](../../src/policies/vue-image-alt.js) · [对应测试](../../test/vue-image-alt.test.js)
