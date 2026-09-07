# 文件头同步

根据 Git 事实同步暂存文件头，保留人工维护的描述。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑配置后运行 `npx repo-guard migrate` 和 `npx repo-guard doctor`。

文件头默认关闭，可通过 `npx repo-guard enable fileHeader` 启用，再在 `repo-guard.config.json` 中调整作用范围：

```json
{
  "preCommit": {
    "fileHeader": {
      "enabled": true,
      "include": ["src/**", "scripts/**"],
      "exclude": ["src/generated/**", "src/vendor/**"],
      "extensions": [
        ".vue",
        ".html",
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".mjs",
        ".cjs",
        ".css",
        ".less",
        ".scss",
        ".sass"
      ]
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `preCommit.fileHeader` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否在 pre-commit 的 lint-staged 隔离环境中同步暂存文件头 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `include` | 仓库相对 glob；文件至少命中一项才进入文件头同步范围 | 字符串数组<br>默认：`["**/*"]` | 至少 1 项；每项为非空字符串 |
| `exclude` | 仓库相对 glob；排除优先级高于 include，适合忽略生成目录、第三方代码或特殊文件 | 字符串数组<br>默认：`[]` | 允许空数组；每项为非空字符串 |
| `extensions` | 允许同步文件头的扩展名白名单；当前仅支持 Vue、HTML、JavaScript、TypeScript 和样式源文件 | 数组；每项可选 `".vue"`、`".html"`、`".js"`、`".jsx"`、`".ts"`、`".tsx"`、`".mjs"`、`".cjs"`、`".css"`、`".less"`、`".scss"`、`".sass"`<br>默认：`[".vue",".html",".js",".jsx",".ts",".tsx",".mjs",".cjs",".css",".less",".scss",".sass"]` | 至少 1 项；元素不可重复 |

<!-- config-fields:end -->

- `include` 和 `exclude` 都使用仓库相对 glob；`exclude` 优先，适合排除生成代码、第三方代码和无需托管的目录。
- `extensions` 是白名单，不能填写当前支持范围以外的扩展名。
- `.vue`、`.html` 使用 `<!-- ... -->`；脚本和样式文件使用 `/* ... */`。
- 脚本 shebang 和样式 `@charset` 等必须位于首行的声明会保留在文件头之前。
- `@Author`、`@Date` 取文件第一次新增到 Git 历史时的作者和提交时间；新文件在首次提交前使用当前 Git 提交身份和时间。
- `@LastEditor`、`@LastEditTime` 每次从当前 Git 提交身份和时间重建；手动修改这四个字段不会保留。
- `@Description` 由开发者维护。已有受管文件头会保留该字段；新文件先生成空值，不根据文件名主观猜测描述。
- 即使用户删除 `@Description` 或乱写 Git 字段，只要顶部注释仍包含 LastEditor/LastEditTime，或同时包含 Author/Date，也会识别为受管文件头并整体重建；普通许可证和只有单个 Author 的 JSDoc 不会被覆盖。
- 历史字段输出统一使用 `@LastEditor`，旧的 `@LastEditors` 会在下一次同步时归一化。
- 已跟踪文件若因浅克隆而无法追溯首次新增记录，会停止同步并提示先补全 Git 历史，避免写入错误作者和时间。
- 文件头同步只处理本次暂存文件，并继续由 `lint-staged` 隔离和恢复未暂存改动。

## 执行与复核

执行入口：pre-commit 暂存内容同步阶段。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/policies/file-header.js) · [对应测试](../../test/file-header.test.js)
