# 图片资源治理与安全优化

检查图片命名、格式、重复与优化收益，显式选择是否写入优化结果。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑配置后运行 `npx repo-guard migrate` 和 `npx repo-guard doctor`。

图片治理默认关闭，消费项目需自行安装兼容的 Sharp 和 SVGO，再显式启用：

```bash
npm install --save-dev --save-exact sharp@0.35.3 svgo@4.1.0
npx repo-guard enable imageAssets
npx repo-guard doctor
```

通过 `npx repo-guard enable imageAssets` 启用时会同步 `AGENTS.md` 托管区块，写入当前生效的命名、真实格式、重复、压缩范围以及 Hook/CI 只读约束；关闭功能会移除对应规则。若直接编辑配置，请运行 `npx repo-guard migrate` 或 `npx repo-guard doctor --fix` 完成同步，CI 只检查一致性，不会写入文件。

```json
{
  "imageAssets": {
    "enabled": true,
    "enforcement": "changedFiles",
    "include": ["src/assets/**/*.{png,jpg,jpeg,webp,avif,svg}"],
    "exclude": ["**/generated/**", "**/dist/**", "**/reports/**"],
    "extensions": ["png", "jpg", "jpeg", "webp", "avif", "svg"],
    "naming": {
      "enabled": true,
      "convention": "camelCase",
      "lowercaseExtension": true,
      "densitySuffixes": ["@2x", "@3x"],
      "allowNinePatch": false
    },
    "duplicates": {
      "exact": "error",
      "pixel": "off",
      "canonicalRoots": ["src/assets"]
    },
    "compression": {
      "enabled": true,
      "action": "report",
      "minInputBytes": 8192,
      "minSavingsBytes": 2048,
      "minSavingsPercent": 10,
      "raster": {
        "enabled": true,
        "allowLossy": false,
        "metadata": "preserve"
      },
      "svg": {
        "enabled": true,
        "allowWrite": false
      },
      "conversion": {
        "enabled": true,
        "target": "webp",
        "sourceFormats": ["png", "jpg", "jpeg"],
        "action": "report",
        "minInputBytes": 8192,
        "minSavingsBytes": 4096,
        "minSavingsPercent": 20,
        "pngMode": "lossless",
        "jpegQuality": 82,
        "effort": 6,
        "exactAlpha": true,
        "allowFallbackOriginal": false
      }
    },
    "limits": {
      "maxInputBytes": 26214400,
      "maxPixels": 40000000,
      "maxFrames": 1
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `imageAssets` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否启用图片治理 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `enforcement` | changedFiles 约束变更图片；allFiles 扩大为全部匹配图片 | `"changedFiles"` / `"allFiles"`<br>默认：`"changedFiles"` | 只接受列出的值 |
| `include` | 参与图片治理的仓库相对文件 glob | 字符串数组<br>默认：内置 3 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项；每项为非空字符串 |
| `exclude` | 排除的图片路径，优先于 include | 字符串数组<br>默认：`["**/generated/**","**/dist/**","**/coverage/**","**/reports/**"]` | 允许空数组；每项为非空字符串 |
| `extensions` | 允许治理的图片扩展名列表；不带开头的点 | 数组；每项可选 `"png"`、`"jpg"`、`"jpeg"`、`"webp"`、`"avif"`、`"svg"`、`"gif"`、`"ico"`、`"bmp"`、`"tif"`、`"tiff"`<br>默认：`["png","jpg","jpeg","webp","avif","svg","gif","ico","bmp","tif","tiff"]` | 至少 1 项；元素不可重复 |
| `naming.enabled` | 是否启用图片名称检查 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `naming.convention` | 图片文件名采用的统一命名风格 | `"camelCase"` / `"kebab-case"`<br>默认：`"camelCase"` | 只接受列出的值 |
| `naming.lowercaseExtension` | 是否要求扩展名使用小写 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `naming.densitySuffixes` | 文件名允许保留的倍率后缀，如 @2x | 字符串数组<br>默认：`["@2x","@3x"]` | 至少 1 项；元素不可重复；每项：只能使用 @2x 到 @9x |
| `naming.allowNinePatch` | 是否允许 Android 九宫格图片的 .9 命名部分 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `duplicates.exact` | off 不检查；error 阻断字节完全相同的重复图片 | `"off"` / `"error"`<br>默认：`"error"` | 只接受列出的值 |
| `duplicates.pixel` | off 不检查；report 报告；error 阻断像素重复图片 | `"off"` / `"report"` / `"error"`<br>默认：`"off"` | 不进入 pre-commit 或 CI policy 的像素分析。 |
| `duplicates.canonicalRoots` | 选择重复图片规范保留位置时使用的目录优先顺序 | 字符串数组<br>默认：`["src/assets","public/assets","docs/assets"]` | 至少 1 项；元素不可重复；每项为非空字符串 |
| `compression.enabled` | 是否启用压缩收益检查 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `compression.action` | report 报告压缩收益；error 将满足优化条件的问题视为违规 | `"report"` / `"error"`<br>默认：`"report"` | 只接受列出的值 |
| `compression.minInputBytes` | 开始评估优化的最小输入字节数 | 整数<br>默认：`8192` | ≥ 0；≤ 200000000 |
| `compression.minSavingsBytes` | 优化结果至少需要节省的字节数 | 整数<br>默认：`2048` | ≥ 1；≤ 200000000 |
| `compression.minSavingsPercent` | 优化结果至少需要节省的百分比，与字节阈值同时满足 | 整数<br>默认：`10` | ≥ 1；≤ 99 |
| `compression.raster.enabled` | 是否启用位图优化 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `compression.raster.allowLossy` | 是否允许有损编码；写入仍需命令行显式确认 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"；显式写入有损结果还需 --allow-lossy。 |
| `compression.raster.metadata` | preserve 保留元数据；strip 移除元数据 | `"preserve"` / `"strip"`<br>默认：`"preserve"` | 只接受列出的值 |
| `compression.svg.enabled` | 是否启用SVG 优化 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `compression.svg.allowWrite` | 是否允许显式优化命令写入 SVG | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"；还需 image-optimize --write；自动 Hook 不写入图片。 |
| `compression.conversion.enabled` | 是否启用WebP 转换收益检查 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `compression.conversion.target` | 转换目标格式；当前仅支持 WebP | 只能为 `"webp"`<br>默认：`"webp"` | 只接受列出的值 |
| `compression.conversion.sourceFormats` | 可以转换为 WebP 的原图格式 | 数组；每项可选 `"png"`、`"jpg"`、`"jpeg"`<br>默认：`["png","jpg","jpeg"]` | 至少 1 项；元素不可重复 |
| `compression.conversion.action` | report 报告转换收益；error 将需转换项作为违规 | `"report"` / `"error"`<br>默认：`"report"` | 只接受列出的值 |
| `compression.conversion.minInputBytes` | 开始评估优化的最小输入字节数 | 整数<br>默认：`8192` | ≥ 0；≤ 200000000 |
| `compression.conversion.minSavingsBytes` | 优化结果至少需要节省的字节数 | 整数<br>默认：`4096` | ≥ 1；≤ 200000000 |
| `compression.conversion.minSavingsPercent` | 优化结果至少需要节省的百分比，与字节阈值同时满足 | 整数<br>默认：`20` | ≥ 1；≤ 99 |
| `compression.conversion.pngMode` | lossless 为 PNG 无损转换；lossy 为有损转换 | `"lossless"` / `"lossy"`<br>默认：`"lossless"` | lossy 写入需同时允许有损并传 --allow-lossy。 |
| `compression.conversion.jpegQuality` | JPEG 转 WebP 的编码质量参数；并非压缩率 | 整数<br>默认：`82` | ≥ 1；≤ 100 |
| `compression.conversion.effort` | WebP 编码投入级别，较高值通常需要更多计算时间 | 整数<br>默认：`6` | ≥ 0；≤ 6 |
| `compression.conversion.exactAlpha` | 是否保留透明像素中的 RGB 信息 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `compression.conversion.allowFallbackOriginal` | 转换收益不足时是否允许保留原格式作为退路 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `limits.maxInputBytes` | 单张图片读取输入字节上限 | 整数<br>默认：`26214400` | ≥ 1024；≤ 200000000 |
| `limits.maxPixels` | 单张图片允许解码的像素数量上限 | 整数<br>默认：`40000000` | ≥ 1；≤ 100000000 |
| `limits.maxFrames` | 允许的最大帧数，默认仅单帧图片 | 整数<br>默认：`1` | ≥ 1；≤ 1000 |

<!-- config-fields:end -->

- `changedFiles` 只阻止本次新增或修改产生的新问题，适合旧项目接入；`allFiles` 每次治理完整范围。精确重复使用 Git blob 标识或内容哈希，不依赖文件名；`canonicalRoots` 接受仓库内目录或 glob，并决定建议保留路径。增量模式优先保留未变更的存量资源，工具不会自动删除副本。
- `duplicates.pixel` 可设为 `report` 或 `error`，通过 Sharp 旋转归一、转换 sRGB 并解码静态像素后比较，能够发现 PNG/JPEG/WebP/AVIF 间的视觉重复；为保持 pre-commit 与 CI policy 轻量，该项只在手动、CI full 和 release-ready 执行。允许原图回退时，同目录同主名的原图/WebP 组合不会被当作像素重复。
- 压缩和 WebP 建议同时满足最小输入体积、最小节省字节数、最小节省比例才会报告。WebP 并不存在对所有 PNG 固定节省 70% 到 80% 的保证：照片、插画、透明图和已压缩素材差异很大，因此门禁只依据每个文件的真实候选结果判断。
- `compression.enabled` 是原格式压缩和 WebP 转换的统一父开关；关闭后即使保留 `conversion.enabled: true` 也不会运行转换分析或写入。像素重复属于独立检查，不受该父开关影响。
- PNG 默认只生成无损候选并复核像素一致性；JPEG/WebP 原格式压缩需先配置 `raster.allowLossy: true`。写入 JPEG/WebP 原格式压缩或 JPEG/有损 PNG 转 WebP 时，还必须传入 `--allow-lossy` 完成第二次确认；只读预览不会要求命令行确认。`metadata` 决定候选保留或移除元数据。
- SVGO 使用保守插件集合，并在接受候选前复核 `viewBox`、ID、类名、ARIA/role、引用、`url(#...)`、`title` 和 `desc`。SVG 写入还必须显式设置 `svg.allowWrite: true`。
- 图片命名与 `preCommit.pathNaming` 同时启用时必须使用同一种 `convention`；图片由 `imageAssets.naming` 检查，避免同一路径被两套规则重复报告。扩展名必须小写，倍率后缀只能使用配置白名单。
- Hook 与 CI 只读取最终暂存区或目标 revision，不读取未暂存副本，也绝不自动改图。输入体积、解码像素和帧数超过上限时停止分析并给出结构化问题，避免压缩炸弹和动画资源造成不可控消耗。

只预览真实收益：

```bash
npx repo-guard image-optimize -- src/assets/logo.png
npx repo-guard image-optimize --to webp -- src/assets/banner.jpg
```

显式写入：

```bash
npx repo-guard image-optimize --write -- src/assets/logo.png
npx repo-guard image-optimize --to webp --write --allow-lossy -- src/assets/banner.jpg
```

写入只接受范围内、由 Git 跟踪且没有暂存/未暂存修改的源文件，并拒绝路径任意层级的符号链接。原格式压缩使用不冲突的临时文件和备份完成安全替换，并保留原文件权限；WebP 转换只创建同目录同主名的 `.webp`，包括悬空符号链接在内的目标路径已存在就停止，原图和代码引用保持不变，必须由开发者完成视觉、浏览器/小程序兼容性和引用切换验证。

## 执行与复核

执行入口：质量检查进入手动、pre-commit、CI policy/full 和 release-ready；像素重复仅在手动、CI full 和 release-ready 分析。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/repository/image-assets-gate.js) · [对应测试](../../test/image-assets.test.js)
