# 函数文档同步

随函数参数和返回结构更新文档标签，保留业务说明。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步规范，再运行 `npx repo-guard doctor`；`migrate` 仅用于旧版本显式迁移。

函数文档同步默认关闭，可通过 `npx repo-guard enable functionDocs` 启用：

```json
{
  "checks": {
    "functionDocs": {
      "enabled": true,
      "include": [
        "src/**"
      ],
      "exclude": [
        "**/*.d.ts",
        "**/*.min.js",
        "**/generated/**",
        "**/*.spec.*",
        "**/*.test.*"
      ],
      "extensions": [
        ".vue",
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".mjs",
        ".cjs"
      ]
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.functionDocs.enabled` | 是否在 pre-commit 的 lint-staged 隔离环境中同步函数文档 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.functionDocs.include` | 仓库相对 glob；文件至少命中一项才进入函数文档同步范围 | 字符串数组<br>默认：`["**/*"]` | 至少 1 项；每项为非空字符串 |
| `checks.functionDocs.exclude` | 仓库相对 glob；排除优先级高于 include，默认跳过声明文件、压缩产物、生成目录和测试文件 | 字符串数组<br>默认：`["**/*.d.ts","**/*.min.js","**/generated/**","**/*.spec.*","**/*.test.*"]` | 允许空数组；每项为非空字符串 |
| `checks.functionDocs.extensions` | 允许同步函数文档的扩展名白名单；Vue 文件只处理内联 script 和 script setup | 数组；每项可选 `".vue"`、`".js"`、`".jsx"`、`".ts"`、`".tsx"`、`".mjs"`、`".cjs"`<br>默认：`[".vue",".js",".jsx",".ts",".tsx",".mjs",".cjs"]` | 至少 1 项；元素不可重复 |

<!-- config-fields:end -->

- 仅处理本次暂存且同时命中 `include`、未命中 `exclude`、扩展名已启用的文件；默认排除声明文件、压缩产物、生成目录和测试文件。
- 使用 Babel AST 识别具名函数、类/对象方法、单变量绑定的箭头或函数实现，以及默认导出实现；匿名回调不会被自动补文档。
- 参数新增、删除或调序时同步 `@param`；有返回值时补齐 `@returns`，无返回值时删除陈旧返回标签。新标签只写参数名或标签名，不猜测“用户 ID”等业务说明。
- 保留人工维护的 `@Description`、标签说明和未托管标签；兼容 `@arg`/`@argument`、`@return` 和 `@exception` 别名。TypeScript 函数会移除 `@param`/`@returns` 中与签名重复的类型，但不改写说明。
- 函数存在直接逃逸的 `throw` 或返回的 `Promise.reject` 且缺少 `@throws`/`@exception` 时，只输出可定位的中文警告，不自动猜测异常说明，不阻断提交。
- 匿名解构参数不自动改写整个函数文档，而是给出提示；Generator 只同步参数，保留已有返回标签并提示人工维护 `@yields`。
- Vue 文件只解析顶层内联 `<script>` 和 `<script setup>`，跳过注释、template、style 和带 `src` 的外部 script。同步结果幂等，并继续由 `lint-staged` 保护部分暂存内容。

## 执行与复核

执行入口：pre-commit 暂存内容同步阶段。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/policies/function-documentation.js) · [对应测试](../../test/policies/function-documentation.test.js)
