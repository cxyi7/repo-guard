# 构建产物预算

在实际构建后复核 PC 或小程序产物体积，并控制历史超限债务。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步规范，再运行 `npx repo-guard doctor`。

产物预算是现有 `build` 门禁的可选后置阶段。一个业务项目只能选择一种平台：PC 项目配置 `pc`，小程序项目配置 `miniProgram`，不能同时存在。未启用 `artifactBudget` 时，原有构建行为不变。

通过命令启停功能时，已启用的 `baseline` 模式会为 `baselineFile` 补充根配置 `repository.rules` 保护。多应用使用带应用目录的仓库相对路径；已有同路径规则保留原级别，避免降低对基线的团队约束。手动编辑配置时也应一并维护该保护规则。

PC/Vite 项目示例：

```json
{
  "checks": {
    "build": {
      "enabled": true,
      "script": "build",
      "timeoutMs": 300000,
      "artifactBudget": {
        "enabled": true,
        "platform": "pc",
        "outputDirectory": "dist",
        "cleanScript": "clean:dist",
        "action": "error",
        "mode": "strict",
        "pc": {
          "analyzer": "viteManifest",
          "manifest": ".vite/manifest.json",
          "sourceMaps": "forbid",
          "compression": [
            "raw",
            "gzip",
            "brotli"
          ],
          "limits": {
            "totalRawBytes": 8388608,
            "initialJsBrotliBytes": 358400,
            "initialCssBrotliBytes": 153600,
            "maxChunkRawBytes": 614400,
            "maxChunkCount": 80,
            "maxAssetRawBytes": 2097152
          }
        }
      }
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.build.enabled` | 是否启用项目构建 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 |
| `checks.build.script` | 消费项目 package.json 中要执行的 npm 脚本名 | 字符串<br>默认：`"build"` | 至少 1 个字符；仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `checks.build.timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>默认：`300000` | ≥ 1 |
| `checks.build.artifactBudget.enabled` | 是否启用构建产物预算 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.build.artifactBudget.platform` | pc 表示网页产物，miniProgram 表示小程序产物；启用预算时必须选定一个平台 | `"pc"` / `"miniProgram"` / `null`<br>默认：`null` | 启用后 pc 与 miniProgram 配置只能选择对应的一项。 |
| `checks.build.artifactBudget.outputDirectory` | 仓库内未跟踪且不穿过符号链接的生产产物目录；不得为仓库根目录或 src | 字符串<br>默认：`"dist"` | 至少 1 个字符 |
| `checks.build.artifactBudget.cleanScript` | 可选的项目 npm 清理脚本。未配置时，构建本身必须清除 repo-guard 的旧产物探针 | 字符串 / null<br>默认：`null` | 非 null 时：仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `checks.build.artifactBudget.action` | report 只报告预算问题；error 使超标导致门禁失败 | `"report"` / `"error"`<br>默认：`"error"` | 只接受列出的值 |
| `checks.build.artifactBudget.mode` | strict 按绝对上限检查；baseline 结合已登记基线限制新增问题 | `"strict"` / `"baseline"`<br>默认：`"strict"` | 只接受列出的值 |
| `checks.build.artifactBudget.pc.analyzer` | viteManifest 按 Vite 清单分析依赖与首屏；directory 按目录分析 | `"viteManifest"` / `"directory"`<br>默认：`"viteManifest"` | 只接受列出的值 |
| `checks.build.artifactBudget.pc.manifest` | 相对于产物目录的 Vite manifest 文件位置 | 字符串<br>默认：`".vite/manifest.json"` | 不得替换为其他类型；按本页说明提供实际项目值 |
| `checks.build.artifactBudget.pc.sourceMaps` | allow 允许发布 source map；forbid 拒绝产物中的 source map | `"allow"` / `"forbid"`<br>默认：`"forbid"` | 只接受列出的值 |
| `checks.build.artifactBudget.pc.compression` | 统计体积的方式：raw 原始字节、gzip 压缩、brotli 压缩 | 数组；每项可选 `"raw"`、`"gzip"`、`"brotli"`<br>默认：`["raw","gzip","brotli"]` | 至少 1 项；元素不可重复 |
| `checks.build.artifactBudget.pc.limits.totalRawBytes` | 全部纳入统计的产物原始字节上限 | 整数 / null<br>默认：`null` | 非 null 时：≥ 1 |
| `checks.build.artifactBudget.pc.limits.initialJsBrotliBytes` | 首屏 JavaScript 的 Brotli 压缩字节上限 | 整数 / null<br>默认：`null` | 非 null 时：≥ 1；依赖 viteManifest 分析并启用 brotli 统计。 |
| `checks.build.artifactBudget.pc.limits.initialCssBrotliBytes` | 首屏 CSS 的 Brotli 压缩字节上限 | 整数 / null<br>默认：`null` | 非 null 时：≥ 1；依赖 viteManifest 分析并启用 brotli 统计。 |
| `checks.build.artifactBudget.pc.limits.maxChunkRawBytes` | 单个代码分块的原始字节上限 | 整数 / null<br>默认：`null` | 非 null 时：≥ 1 |
| `checks.build.artifactBudget.pc.limits.maxChunkCount` | 代码分块数量上限 | 整数 / null<br>默认：`null` | 非 null 时：≥ 1 |
| `checks.build.artifactBudget.pc.limits.maxAssetRawBytes` | 单个静态资源的原始字节上限 | 整数 / null<br>默认：`null` | 非 null 时：≥ 1 |

<!-- config-fields:end -->

PC 的 `limits` 至少填写一个正整数上限；单项省略或设为 `null` 表示不限制该指标，不能用 `0` 表示关闭。带 `Bytes` 的值均以字节计，`maxChunkCount` 以数量计。原始体积和数量指标要求 `compression` 包含 `raw`，Gzip/Brotli 指标要求包含对应算法。

`viteManifest` 从生产产物中的 manifest 查找 `isEntry=true` 入口，并递归统计静态 `imports` 及关联 CSS/资源；动态导入不计入首屏。`directory` 适用于非 Vite 构建，只能使用全目录、分块和资源指标，配置首屏指标会直接报配置错误。`manifest` 使用产物目录内的相对文件路径，不能填写绝对路径或 `..` 越界路径。

微信小程序示例：

```json
{
  "checks": {
    "build": {
      "enabled": true,
      "script": "build:mp-weixin",
      "timeoutMs": 300000,
      "artifactBudget": {
        "enabled": true,
        "platform": "miniProgram",
        "outputDirectory": "unpackage/dist/build/mp-weixin",
        "action": "error",
        "mode": "strict",
        "miniProgram": {
          "provider": "weixin",
          "appConfig": "app.json",
          "limits": {
            "mainPackageBytes": 2097152,
            "defaultSubPackageBytes": 2097152,
            "totalPackageBytes": 20971520,
            "maxSingleFileBytes": 524288,
            "maxPreloadBytes": 4194304
          },
          "subPackages": [
            {
              "root": "pagesA",
              "maxBytes": 1572864
            },
            {
              "root": "pagesB",
              "maxBytes": 1835008
            }
          ],
          "expectedSubPackages": [
            "pagesA",
            "pagesB"
          ],
          "exclusions": [
            {
              "patterns": [
                "project.private.config.json"
              ],
              "reason": "微信开发者工具本机配置"
            }
          ]
        }
      }
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.build.enabled` | 是否启用项目构建 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 |
| `checks.build.script` | 消费项目 package.json 中要执行的 npm 脚本名 | 字符串<br>默认：`"build"` | 至少 1 个字符；仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `checks.build.timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>默认：`300000` | ≥ 1 |
| `checks.build.artifactBudget.enabled` | 是否启用构建产物预算 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.build.artifactBudget.platform` | pc 表示网页产物，miniProgram 表示小程序产物；启用预算时必须选定一个平台 | `"pc"` / `"miniProgram"` / `null`<br>默认：`null` | 启用后 pc 与 miniProgram 配置只能选择对应的一项。 |
| `checks.build.artifactBudget.outputDirectory` | 仓库内未跟踪且不穿过符号链接的生产产物目录；不得为仓库根目录或 src | 字符串<br>默认：`"dist"` | 至少 1 个字符 |
| `checks.build.artifactBudget.action` | report 只报告预算问题；error 使超标导致门禁失败 | `"report"` / `"error"`<br>默认：`"error"` | 只接受列出的值 |
| `checks.build.artifactBudget.mode` | strict 按绝对上限检查；baseline 结合已登记基线限制新增问题 | `"strict"` / `"baseline"`<br>默认：`"strict"` | 只接受列出的值 |
| `checks.build.artifactBudget.miniProgram.provider` | 小程序平台；当前仅支持微信 | 只能为 `"weixin"`<br>默认：`"weixin"` | 只接受列出的值 |
| `checks.build.artifactBudget.miniProgram.appConfig` | 相对于产物目录的小程序应用配置文件 | 字符串<br>默认：`"app.json"` | 不得替换为其他类型；按本页说明提供实际项目值 |
| `checks.build.artifactBudget.miniProgram.limits.mainPackageBytes` | 小程序主包字节上限 | 整数<br>本对象内必填，无自动代填值 | ≥ 1 |
| `checks.build.artifactBudget.miniProgram.limits.defaultSubPackageBytes` | 未单独覆盖时使用的分包字节上限 | 整数<br>本对象内必填，无自动代填值 | ≥ 1 |
| `checks.build.artifactBudget.miniProgram.limits.totalPackageBytes` | 全部小程序包合计字节上限 | 整数<br>本对象内必填，无自动代填值 | ≥ 1 |
| `checks.build.artifactBudget.miniProgram.limits.maxSingleFileBytes` | 单个小程序产物文件的字节上限 | 整数 / null<br>默认：`null` | 非 null 时：≥ 1 |
| `checks.build.artifactBudget.miniProgram.limits.maxPreloadBytes` | 预加载分包合计字节上限 | 整数 / null<br>默认：`null` | 非 null 时：≥ 1 |
| `checks.build.artifactBudget.miniProgram.subPackages` | 为指定分包覆盖大小上限 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `checks.build.artifactBudget.miniProgram.subPackages[].root` | 需要单独限制的分包根目录，与 app.json 中的声明对应 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `checks.build.artifactBudget.miniProgram.subPackages[].maxBytes` | 该分包专用字节上限 | 整数 / null<br>默认：`null` | 非 null 时：≥ 1 |
| `checks.build.artifactBudget.miniProgram.expectedSubPackages` | 必须出现在产物中的预期分包根目录列表 | 字符串数组<br>默认：`[]` | 允许空数组；元素不可重复；每项为非空字符串 |
| `checks.build.artifactBudget.miniProgram.exclusions` | 有明确原因的产物排除列表 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `checks.build.artifactBudget.miniProgram.exclusions[].patterns` | 该项排除的产物相对匹配模式 | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；每项为非空字符串；排除范围需具体，并保留原因；不能排除核心应用配置。 |
| `checks.build.artifactBudget.miniProgram.exclusions[].reason` | 排除这些产物的具体原因 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |

<!-- config-fields:end -->

小程序分析读取构建后的 `app.json`，兼容 `subPackages`/`subpackages`，每个文件按 root 前缀唯一归入一个分包，其他文件归入主包；重复、嵌套或越界 root 会阻断。独立分包仍单独计量。`preloadRule` 引用不存在的分包或 `packages` 结构错误会阻断，`maxPreloadBytes` 按单条规则可能加载的主包/分包体积计算。`exclusions` 只允许微信开发者工具确定不上传的 `.DS_Store`、`project.config.json` 和 `project.private.config.json`，不能用 glob 排除业务产物。平台体积值可能变化，因此 repo-guard 不在运行代码中永久写死数值，项目需要依据当前发布平台规则显式配置；小程序固定为 `action=error`、`mode=strict`，不能降级。

产物目录必须在仓库内部，不得为根目录或 `src`，不得包含符号链接或 Git 已跟踪文件。`scanLimits.maxFiles`、`scanLimits.maxTotalBytes` 与 `scanLimits.maxCompressionInputBytes` 防止异常产物耗尽扫描和压缩资源。若配置 `cleanScript`，repo-guard 会先运行该精确 npm 脚本并验证其清除旧产物；未配置时，实际构建必须清除旧产物探针。repo-guard 只删除本次运行创建的探针，不会递归删除业务目录；若产物中已存在同名探针文件，门禁会拒绝运行并保留原文件。

PC 旧项目可以使用 `mode: "baseline"` 接受当前超限债务：先按相同配置完成一次生产构建，再执行：

```bash
npx repo-guard build-artifact-baseline init
git add .repo-guard/build-artifact-baseline.json
```

基线只生成并接受 `version: 2`，必须被 Git 跟踪并与当前平台、产物目录和 PC 预算配置指纹一致。版本 1、缺少版本或其他版本在检查与裁剪时都会被拒绝，不会自动转换；已有旧基线需重新评审产物债务并按当前格式登记。新增问题或指标增长仍会阻断；债务下降后执行 `npx repo-guard build-artifact-baseline prune`，命令只能降低数值或删除已解决项，拒绝新增和扩大允许值。`action: "report"` 可用于 PC 试运行并以 warning 报告，但不能用于小程序平台硬限制。

## 执行与复核

执行入口：跟随启用的 build 门禁，在手动、pre-push、CI full 和 release-ready 执行。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/config/build-artifact-budget-validation.js)
