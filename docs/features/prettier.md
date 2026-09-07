# Prettier

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

按项目自己的 Prettier 配置统一格式。初始化默认启用，并要求项目存在格式配置。

## 接入与配置

```bash
npm install --save-dev --save-exact "prettier@>=3 <4"
```

例如在 `.prettierrc.json` 中保存团队选择：

```json
{
  "semi": true,
  "singleQuote": true
}
```

<!-- config-fields:start -->
**字段说明**（属于项目 Prettier 配置，不是 repo-guard 主配置）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `semi` | 是否在语句末尾输出分号 | `true` / `false`；Prettier 3 默认 `true` | false 仍可能为避免语法歧义保留必要分号 |
| `singleQuote` | 是否优先使用单引号 | `true` / `false`；Prettier 3 默认 `false` | 不等同于 JSX 引号选项；格式器会按转义需要选择写法 |

<!-- config-fields:end -->

`repo-guard.config.json` 配置片段：

```json
{
  "preCommit": {
    "prettier": {
      "enabled": true,
      "pattern": "*.{js,jsx,ts,tsx,vue,json,css,scss,html,md,yml,yaml}",
      "fix": true,
      "requireConfig": true
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `preCommit.prettier` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否启用Prettier 暂存格式处理 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `pattern` | 选择暂存文件的 glob，使用项目相对路径匹配 | 字符串<br>默认：`"*.{js,jsx,mjs,cjs,ts,tsx,vue,json,json5,jsonc,css,scss,less,html,md,mdx,yml,yaml}"` | 至少 1 个字符 |
| `fix` | 是否自动修复可修复项；false 使用只读检查 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `requireConfig` | 是否要求消费项目提供适用的工具配置 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |

<!-- config-fields:end -->

这里的 `pattern` 是示例范围；初始化配置支持更多扩展名，应按实际项目保留或调整。

```bash
npx repo-guard enable prettier
npx repo-guard doctor
```

## 执行与修复

提交阶段在 Stylelint、ESLint 修复后格式化暂存文件，随后执行 Stylelint、ESLint 只读复核。CI `full` 只读验证格式。找不到配置或解析器时，先补齐项目工具；格式失败时修复对应文件、重新暂存，再提交。部分暂存和未暂存内容由 `lint-staged` 保留。

源码：[Prettier 门禁](../../src/gates/quality/prettier-gate.js)。
