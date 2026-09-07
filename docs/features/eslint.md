# ESLint

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

检查 JavaScript、TypeScript 和 Vue 代码。使用项目自己的 ESLint、解析器和配置；`preset: true` 会叠加 repo-guard 的推荐规范，包括复杂度、函数长度和部分 Vue 约定。

## 接入与配置

初始化默认启用 ESLint 和预设。预设要求 ESLint `>=9.19`，并安装 `@eslint/js`；Vue 和 TypeScript 项目还需相应解析器与插件。以下是 JavaScript 项目的依赖示例：

```bash
npm install --save-dev --save-exact "eslint@^9.19.0" "@eslint/js@^9.19.0"
```

项目需有可用的 ESLint 配置。下面的 `eslint.config.mjs` 仅用于演示 JavaScript 项目；已有 Vue/TypeScript 配置应保留对应文件匹配、插件和解析器：

```js
import js from '@eslint/js';

export default [
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
];
```

将字段合并到 `repo-guard.config.json`：

```json
{
  "preCommit": {
    "eslint": {
      "enabled": true,
      "preset": true,
      "pattern": "*.{js,jsx,ts,tsx,vue}",
      "fix": true,
      "maxWarnings": 0
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `preCommit.eslint` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否启用ESLint 暂存检查 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `preset` | 是否在项目 Flat Config 前注入 repo-guard 维护性规则预设 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `pattern` | 选择暂存文件的 glob，使用项目相对路径匹配 | 字符串<br>默认：`"*.{js,jsx,ts,tsx,vue}"` | 至少 1 个字符 |
| `fix` | 是否自动修复可修复项；false 使用只读检查 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `maxWarnings` | 允许的工具警告数上限；0 表示不允许警告 | 整数<br>默认：`0` | ≥ 0 |

<!-- config-fields:end -->

`preset: false` 表示使用项目自身规范，不叠加 repo-guard 预设；该选择应由团队配置决定。它不关闭独立的原生安全检查。`maxWarnings: 0` 表示警告同样可能阻止提交。

```bash
npx repo-guard enable eslint
npx repo-guard doctor
```

## 执行与修复

提交时在 `lint-staged` 暂存快照内修复并复核；CI `full` 只读检查项目文件。自动修复后仍有错误时，按提示修复语法、解析器或具体规则，再暂存并重新提交。不要把项目级 `eslint --fix .` 放进 Hook。

源码：[ESLint 门禁](../../src/gates/quality/eslint-gate.js)、[预设](../../src/gates/quality/eslint-preset.js)。
