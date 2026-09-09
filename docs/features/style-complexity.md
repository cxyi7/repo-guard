# 样式复杂度

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

限制选择器组合和样式嵌套深度，减少页面样式难以理解和修改的问题。

## 配置与运行

先完成[Stylelint 接入](stylelint.md)，再合并以下配置片段：

```json
{
  "checks": {
    "styleComplexity": {
      "enabled": true,
      "maxCompoundSelectors": 3,
      "maxNestingDepth": 3
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
| `checks.styleComplexity.enabled` | 是否启用选择器与嵌套复杂度检查 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 启用命令会打开 Stylelint，关闭 Stylelint 会同时关闭本项。 |
| `checks.styleComplexity.maxCompoundSelectors` | 单个解析后选择器允许的复合选择器数量 | 整数<br>默认：`3` | ≥ 0 |
| `checks.styleComplexity.maxNestingDepth` | 允许的最大样式规则嵌套深度 | 整数<br>默认：`3` | ≥ 0 |

<!-- config-fields:end -->

```bash
npx repo-guard enable styleComplexity
npx repo-guard style-complexity
```

`maxCompoundSelectors` 限制一个选择器中的复合选择器数量；`maxNestingDepth` 限制嵌套层数。启用本能力会打开 Stylelint；关闭 Stylelint 会同时关闭本能力。初始化不会根据工具就绪状态自动开启；需要明确启用这两项。

## 执行、结果与修复

自动检查随 Stylelint 进入暂存处理和 CI `full`；专项命令用于显式检查。语法解析使用项目工具及配置，Vue 或预处理语言需准备对应解析器。

超限时先从报告定位选择器和嵌套层级，减少多层后代依赖、提取独立类或拆分组件，再复核。复杂度降低不能以破坏样式语义为代价，需检查页面表现。缺少工具和语法解析失败应先修复接入，不应视作规则已通过。

## 维护依据

[实现入口](../../src/gates/quality/stylelint-gate.js) · [对应测试](../../test/gates/quality/style-complexity.test.js)
