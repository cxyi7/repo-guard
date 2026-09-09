# 路径命名

统一范围内的文件和目录命名，支持 camelCase 或 kebab-case。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步规范，再运行 `npx repo-guard doctor`；`migrate` 仅用于旧版本显式迁移。

路径命名默认关闭，可通过 `npx repo-guard enable pathNaming` 启用。npm 包同时支持 `camelCase` 和 `kebab-case`，但一个消费项目只能配置一个字符串值，所有指定目录共用同一规范：

```json
{
  "checks": {
    "pathNaming": {
      "enabled": true,
      "convention": "camelCase",
      "include": [
        "src/**",
        "utils/**"
      ],
      "exclude": [
        "**/.*",
        "**/.*/**",
        "**/generated/**"
      ]
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.pathNaming.enabled` | 是否在 pre-commit 和启用的 CI 门禁中检查全部已跟踪路径 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"；false 关闭自动入口；显式 path-naming 仍可检查。 |
| `checks.pathNaming.convention` | 消费项目唯一采用的路径命名规范；不能配置数组，也不能按目录覆盖 | `"camelCase"` / `"kebab-case"`<br>默认：`"camelCase"` | 只接受一个字符串，不能传数组或按目录覆盖；文件与目录使用同一风格。 |
| `checks.pathNaming.include` | 仓库相对 glob；所有命中的文件和文件夹共用同一个 convention | 字符串数组<br>默认：`["src/**","utils/**"]` | 至少 1 项；每项为非空字符串；仓库相对 glob；不能写绝对路径、.. 路径段或 ! 否定前缀；所有命中目录共用 convention。 |
| `checks.pathNaming.exclude` | 仓库相对 glob；排除优先级高于 include，适合隐藏路径、生成目录和框架特殊路径 | 字符串数组<br>默认：`["**/.*","**/.*/**","**/generated/**"]` | 允许空数组；每项为非空字符串；仓库相对 glob；不能写绝对路径、.. 路径段或 ! 否定前缀；优先于 include。 |

<!-- config-fields:end -->

例如，`src/**` 表示 `src` 下任意层级的路径，`**/generated/**` 表示任意层级的 `generated` 目录内路径。路径相对仓库根目录，建议统一使用 `/`；先由 `include` 选中，再由 `exclude` 排除。清空 `exclude` 会替换掉默认排除项，隐藏路径和生成目录也可能参与检查。

- `convention` 只能是 `camelCase` 或 `kebab-case`，不能填写数组，也不能为不同目录分别覆盖；业务项目启用后只有一种统一标准。
- 文件名和文件夹名使用同一规范。`camelCase` 接受 `committeeInfo`，`kebab-case` 接受 `committee-info`；全小写单词（如 `utils`）在两种规范下都合法。
- 文件扩展名不参与检查；多段文件名会逐段检查除最终扩展名外的名称，例如 `committeeInfo.service.ts` 和 `committee-info.service.ts` 分别符合对应规范。
- pre-commit、CI policy/full 和 release-ready 每次检查 Git 索引中的全部已跟踪路径，不只检查本次变更，因此启用前应先完成存量路径治理；新暂存路径也会立即进入检查，已删除路径不再阻断。
- `include`、`exclude` 使用仓库相对 glob，且 `exclude` 优先。默认排除隐藏路径和 `generated` 目录；`[id]`、`(auth)` 等框架特殊目录若需要保留，应明确加入排除范围。
- Git 不跟踪空目录，因此空目录只有在包含已跟踪文件后才会进入检查。门禁不会自动重命名，避免破坏 import、路由、脚本和大小写敏感文件系统中的引用关系。

## 执行与复核

执行入口：手动、pre-commit、CI policy/full 和 release-ready。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/repository/path-naming-gate.js) · [对应测试](../../test/gates/repository/path-naming.test.js)
