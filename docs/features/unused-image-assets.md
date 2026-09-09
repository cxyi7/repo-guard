# 无效图片资源

通过源码引用与动态声明识别未使用图片，并检查新增债务。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步规范，再运行 `npx repo-guard doctor`。

无效图片是指位于 `checks.imageAssets.include` 范围内，但没有被配置范围源码静态引用、也没有被有效动态声明覆盖的图片。该能力默认关闭，不会进入 pre-commit；启用时同步打开父级图片治理：

```bash
npx repo-guard enable unusedImageAssets
npx repo-guard unused-image-assets
```

```json
{
  "checks": {
    "unusedImageAssets": {
      "enabled": true,
      "action": "error",
      "sourceInclude": [
        "*.{html,md}",
        "src/**/*.{vue,nvue,html,wxml,js,jsx,ts,tsx,mjs,cjs,css,less,scss,sass,wxss,json}",
        "public/**/*.html",
        "docs/**/*.md"
      ],
      "sourceExclude": [
        "**/*.spec.*",
        "**/*.test.*",
        "**/generated/**",
        "**/dist/**"
      ],
      "sourceExtensions": [
        ".vue",
        ".nvue",
        ".html",
        ".wxml",
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".mjs",
        ".cjs",
        ".css",
        ".less",
        ".scss",
        ".sass",
        ".wxss",
        ".md",
        ".json"
      ],
      "aliases": [
        {
          "prefix": "@/",
          "directory": "src"
        }
      ],
      "publicRoots": [
        {
          "directory": "public",
          "urlPrefix": "/"
        }
      ],
      "dynamicReferences": [
        {
          "sourcePatterns": [
            "src/pages/gallery.ts"
          ],
          "assetPatterns": [
            "src/assets/runtime/*.png"
          ],
          "reason": "接口只返回文件名，页面在受控目录内拼接图片路径"
        }
      ],
      "limits": {
        "maxSourceFiles": 10000,
        "maxSourceBytes": 2097152,
        "maxTotalSourceBytes": 104857600
      }
    },
    "imageAssets": {
      "enabled": true,
      "enforcement": "changedFiles"
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.imageAssets.enabled` | 是否启用图片治理 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.imageAssets.enforcement` | changedFiles 约束变更图片；allFiles 扩大为全部匹配图片 | `"changedFiles"` / `"allFiles"`<br>默认：`"changedFiles"` | 只接受列出的值 |
| `checks.unusedImageAssets.enabled` | 是否启用无效图片引用检查 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"；启用命令同时启用 imageAssets，父级关闭时不执行。 |
| `checks.unusedImageAssets.action` | report 报告无效引用；error 阻断未使用图片问题 | `"report"` / `"error"`<br>默认：`"error"` | 只接受列出的值 |
| `checks.unusedImageAssets.sourceInclude` | 参与图片引用分析的仓库相对源码 glob | 字符串数组<br>默认：内置 4 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项；每项为非空字符串 |
| `checks.unusedImageAssets.sourceExclude` | 不参与引用分析的源码 glob，优先级高于 sourceInclude | 字符串数组<br>默认：内置 8 项，见[默认配置](../../src/config/defaults.js) | 允许空数组；每项为非空字符串 |
| `checks.unusedImageAssets.sourceExtensions` | 参与引用分析的源码扩展名；需要带开头的点 | 数组；每项可选 `".vue"`、`".nvue"`、`".html"`、`".wxml"`、`".js"`、`".jsx"`、`".ts"`、`".tsx"`、`".mjs"`、`".cjs"`、`".css"`、`".less"`、`".scss"`、`".sass"`、`".wxss"`、`".md"`、`".json"`<br>默认：内置 17 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项；元素不可重复 |
| `checks.unusedImageAssets.aliases` | 源码引用别名到仓库目录的映射 | 对象数组；对象字段见后续行<br>默认：`[{"prefix":"@/","directory":"src"}]` | 允许空数组 |
| `checks.unusedImageAssets.aliases[].prefix` | 源码中的引用前缀，如 @/；同一列表不得重名 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `checks.unusedImageAssets.aliases[].directory` | 该别名映射到的仓库相对目录 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `checks.unusedImageAssets.publicRoots` | 将公开访问的 URL 前缀映射到仓库资源目录 | 对象数组；对象字段见后续行<br>默认：`[{"directory":"public","urlPrefix":"/"}]` | 允许空数组 |
| `checks.unusedImageAssets.publicRoots[].directory` | 公开静态资源所在的仓库相对目录 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `checks.unusedImageAssets.publicRoots[].urlPrefix` | 公开访问路径前缀，必须以 / 开始且不能重复 | 字符串<br>本对象内必填，无自动代填值 | 必须以 / 开头 |
| `checks.unusedImageAssets.dynamicReferences` | 有审核依据的动态引用声明列表 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `checks.unusedImageAssets.dynamicReferences[].sourcePatterns` | 产生动态引用的特定源码范围 | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；每项为非空字符串；不能用 **、**/*、**/** 覆盖整个仓库。 |
| `checks.unusedImageAssets.dynamicReferences[].assetPatterns` | 上述动态引用确实会用到的资源范围 | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；每项为非空字符串；不能用 **、**/*、**/** 覆盖整个仓库。 |
| `checks.unusedImageAssets.dynamicReferences[].reason` | 静态分析无法直接识别引用的具体原因 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `checks.unusedImageAssets.limits.maxSourceFiles` | 引用扫描最多读取的源码文件数 | 整数<br>默认：`10000` | ≥ 1；≤ 100000 |
| `checks.unusedImageAssets.limits.maxSourceBytes` | 单个源码文件最多读取的字节数 | 整数<br>默认：`2097152` | ≥ 1024；≤ 200000000 |
| `checks.unusedImageAssets.limits.maxTotalSourceBytes` | 全部引用源码合计读取字节上限 | 整数<br>默认：`104857600` | ≥ 1024；≤ 1000000000 |

<!-- config-fields:end -->

- 解析 JS/TS 的静态字符串、`new URL` 和 `import.meta.glob`，Vue/HTML/WXML 的 `src`、静态绑定、`srcset`、`poster`，CSS/Less/SCSS/Sass/WXSS 的 `url()`，以及明确纳入范围的 Markdown 和 JSON；远程 URL、`data:`、`blob:`、注释和动态模板不会被误计为使用。
- 相对路径以引用源码目录解析，别名与公开 URL 分别由 `aliases` 和 `publicRoots` 映射；查询参数和 hash 不参与文件匹配。路径必须留在仓库内，Git revision 源码通过单次批量对象读取并受文件数、单文件和总字节上限保护。
- 默认 `/assets/logo.png` 按 Vite 的 `public/assets/logo.png` 解析；uni-app 若把 `/static/logo.png` 实际存放在 `src/static/logo.png`，应将映射改为 `{ "directory": "src", "urlPrefix": "/" }`，并同步把 `src/static` 加入 `checks.imageAssets.include`，避免把平台根路径误认为 `public` 路径。
- 运行时拼接无法静态证明时，必须配置 `dynamicReferences`。每项声明都要有原因，并同时匹配真实源码和图片；整个仓库通配、空匹配和已经失效的声明会作为配置错误处理。
- 手动命令始终审计当前工作区全量。`changedFiles` 在 pre-push、CI full 和 release-ready 中比较基线与当前 revision 的“未使用集合”，只阻止新增未引用图片或删除最后一处引用造成的新债务；`allFiles` 阻止全部存量。
- v2 基线从对应提交中的工作区清单读取应用配置，支持自定义子配置文件名；通过应用标识找到原来的目录和别名。当前工作区配置不能替代历史配置，基线缺少已声明的子配置会报错。
- Git 基线中的项目配置也必须为 v2；其他版本会直接报错，不提供转换。应按当前结构重新建立配置，经团队评审后选择可信的 v2 提交作为基线，再启用增量债务检查。不得默默使用当前配置代替历史配置，也不能把失败当作已通过。
- `action: "report"` 只报告警告，`error` 产生阻断错误。结构化例外仍需精确匹配 `assets/unused` 与图片路径。工具只提供证据，不自动删除图片或改写引用；删除前必须人工确认运行时、后端下发和平台约定路径。

## 执行与复核

执行入口：手动、pre-push、CI full 和 release-ready。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/repository/unused-image-assets-gate.js) · [对应测试](../../test/gates/repository/unused-image-assets.test.js)
