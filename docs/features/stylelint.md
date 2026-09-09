# Stylelint 与样式规范

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

复用项目自己的 Stylelint 和配置，检查 CSS、预处理样式和 Vue 样式。默认关闭，明确开启后复用项目已经准备好的工具；样式复杂度与样式治理分别配置。

## 接入与配置

消费项目支持的 Stylelint 范围为 `>=16 <18`。根据项目语言准备规则配置与 custom syntax；Vue、SCSS、Sass、Less 需要对应解析能力。不要用纯 CSS 配置直接替换已有框架配置。

```bash
npm install --save-dev --save-exact "stylelint@>=16 <18"
```

纯 CSS 项目可使用以下 `stylelint.config.mjs` 起点：

```js
export default {
  rules: {
    'color-no-invalid-hex': true, // 检查无效十六进制颜色；true 启用，null 关闭
    'block-no-empty': true, // 检查空样式块；true 启用，null 关闭
  },
};
```

`repo-guard.config.json` 配置片段：

```json
{
  "checks": {
    "styleComplexity": {
      "enabled": true,
      "maxCompoundSelectors": 3,
      "maxNestingDepth": 3
    },
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
      "enabled": true,
      "pattern": "**/*.{css,scss,sass,less,vue}",
      "fix": true,
      "maxWarnings": 0,
      "requireConfig": true
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.stylelint.enabled` | 是否启用Stylelint 暂存样式处理 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 |
| `checks.stylelint.pattern` | 选择暂存文件的 glob，使用项目相对路径匹配 | 字符串<br>默认：`"**/*.{css,scss,sass,less,vue}"` | 至少 1 个字符 |
| `checks.stylelint.fix` | 是否自动修复可修复项；false 使用只读检查 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.stylelint.maxWarnings` | 允许的工具警告数上限；0 表示不允许警告 | 整数<br>默认：`0` | ≥ 0 |
| `checks.stylelint.requireConfig` | 是否要求消费项目提供适用的工具配置 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.styleComplexity.enabled` | 是否启用选择器与嵌套复杂度检查 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 启用命令会打开 Stylelint，关闭 Stylelint 会同时关闭本项。 |
| `checks.styleComplexity.maxCompoundSelectors` | 单个解析后选择器允许的复合选择器数量 | 整数<br>默认：`3` | ≥ 0 |
| `checks.styleComplexity.maxNestingDepth` | 允许的最大样式规则嵌套深度 | 整数<br>默认：`3` | ≥ 0 |
| `checks.styleGovernance.enabled` | 是否启用样式优先级与全局位置治理 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 启用命令会打开 Stylelint，关闭 Stylelint 会同时关闭本项。 |
| `checks.styleGovernance.maxSpecificity` | 优先级上限，顺序为 ID、类/属性/伪类、元素/伪元素 | 字符串<br>默认：`"0,3,0"` | 三个非负整数字段，以逗号分隔且不插入空格，例如 0,3,0 |
| `checks.styleGovernance.maxIdSelectors` | 单个选择器允许的 ID 选择器数量；0 表示禁止 | 整数<br>默认：`0` | ≥ 0 |
| `checks.styleGovernance.disallowImportant` | 是否禁止 !important 声明 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.styleGovernance.allowedGlobalStylePatterns` | 允许全局样式的仓库相对路径；CSS Module 自动按隔离样式处理 | 字符串数组<br>默认：内置 8 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项；元素不可重复；每项为非空字符串 |

<!-- config-fields:end -->

```bash
npx repo-guard enable stylelint styleComplexity styleGovernance
npx repo-guard doctor
```

启用 `styleComplexity` 或 `styleGovernance` 会同步启用 Stylelint；关闭 Stylelint 会同时关闭这两项。单独启用 Stylelint 不等于自动打开两项增强规则。

## 执行与修复

提交阶段先修复样式，再在格式化完成后复核；CI `full` / `release-ready` 只读检查。样式复杂度和样式治理也有手动入口：

```bash
npx repo-guard style-complexity
npx repo-guard style-governance
```

按报告降低选择器或嵌套复杂度，移除不符合约定的优先级写法，或将全局样式放回团队声明的位置，再运行相同检查。源码：[Stylelint 门禁](../../src/gates/quality/stylelint-gate.js)。
