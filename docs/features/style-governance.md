# 样式治理

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

约束优先级、ID 选择器、`!important` 和全局样式位置，让组件样式可预测地共存。

## 配置与运行

先完成[Stylelint 接入](stylelint.md)，合并以下配置片段：

```json
{
  "checks": {
    "styleGovernance": {
      "enabled": true,
      "maxSpecificity": "0,3,0",
      "maxIdSelectors": 0,
      "disallowImportant": true,
      "allowedGlobalStylePatterns": [
        "src/styles/**",
        "src/App.vue"
      ]
    },
    "stylelint": {
      "enabled": true
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.stylelint.enabled` | 是否启用Stylelint 暂存样式处理 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 |
| `checks.styleGovernance.enabled` | 是否启用样式优先级与全局位置治理 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 启用命令会打开 Stylelint，关闭 Stylelint 会同时关闭本项。 |
| `checks.styleGovernance.maxSpecificity` | 优先级上限，顺序为 ID、类/属性/伪类、元素/伪元素 | 字符串<br>默认：`"0,3,0"` | 三个非负整数字段，以逗号分隔且不插入空格，例如 0,3,0 |
| `checks.styleGovernance.maxIdSelectors` | 单个选择器允许的 ID 选择器数量；0 表示禁止 | 整数<br>默认：`0` | ≥ 0 |
| `checks.styleGovernance.disallowImportant` | 是否禁止 !important 声明 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.styleGovernance.allowedGlobalStylePatterns` | 允许全局样式的仓库相对路径；CSS Module 自动按隔离样式处理 | 字符串数组<br>默认：内置 8 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项；元素不可重复；每项为非空字符串 |

<!-- config-fields:end -->

```bash
npx repo-guard enable styleGovernance
npx repo-guard style-governance
```

`maxSpecificity` 表示允许的选择器优先级上限，`maxIdSelectors` 限制 ID 数量，`allowedGlobalStylePatterns` 声明允许全局样式的位置。数组是完整集合，应保留项目确实需要的入口。

## 执行、结果与修复

提交阶段随 Stylelint 检查暂存样式，CI `full` / `release-ready` 只读复核。Vue 组件全局样式也需遵循位置约定。启用本能力会打开 Stylelint；关闭 Stylelint 会关闭本能力。

违规时将局部样式限制在组件范围，公共样式迁入声明的目录，降低选择器优先级并修复依赖 `!important` 的冲突。配置阈值应反映团队设计约定；修复后复核静态结果和实际页面，避免只消除报告却改变视觉效果。

## 维护依据

[实现入口](../../src/policies/style-governance.js) · [对应测试](../../test/gates/quality/style-governance.test.js)
