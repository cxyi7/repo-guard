# UI Token 契约

按项目 Manifest 检查 Sass 与 UnoCSS 的设计 Token 使用。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步规范，再运行 `npx repo-guard doctor`。

UI Token 门禁默认关闭。项目必须先在 `repo-guard.config.json` 中声明实际使用的适配器，再执行 `npx repo-guard enable uiTokens`；repo-guard 不会根据文件扩展名猜测语言。当前版本只支持 `sass` 和 `unocss`，可以只启用其中一个，也可以同时启用：

启用命令会在根配置 `repository.rules` 中为 Manifest 补充 `notify` 保护；多应用需要使用 `--project <id>`，保护路径会加上应用目录。例如 `apps/web` 的 `design/tokens.json` 对应根规则 `apps/web/design/tokens.json`。已有同路径规则不会被降低，关闭检查也不会移除保护。

```json
{
  "checks": {
    "uiTokens": {
      "enabled": false,
      "manifestFile": "ui-tokens.manifest.json",
      "include": [
        "src/**/*.{vue,html,scss,sass,js,jsx,ts,tsx}"
      ],
      "exclude": [
        "**/generated/**",
        "**/dist/**",
        "**/coverage/**",
        "**/reports/**"
      ],
      "adapters": {
        "sass": {
          "enabled": true
        },
        "unocss": {
          "enabled": true,
          "configFiles": [
            "uno.config.ts"
          ],
          "attributify": true,
          "variantGroups": true
        }
      },
      "icon": {
        "components": [
          "UiIcon",
          "SvgIcon"
        ],
        "nativeSvg": true,
        "sassSelectors": [
          "svg",
          ".icon",
          ".ui-icon",
          ".svg-icon"
        ]
      }
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.uiTokens.enabled` | 是否在 pre-commit、CI policy、CI full 与 release-ready 中启用 UI Token 门禁 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"；启用时至少选择一个适配器，Manifest 与来源文件必须已跟踪并通过指纹复核。 |
| `checks.uiTokens.manifestFile` | 应用目录内由项目生成并提交的 UI Token Manifest | 字符串<br>默认：`"ui-tokens.manifest.json"` | 至少 1 个字符 |
| `checks.uiTokens.include` | 参与 Sass 或 UnoCSS 静态检查的仓库相对 glob | 字符串数组<br>默认：`["src/**/*.{vue,html,scss,sass,js,jsx,ts,tsx}"]` | 至少 1 项；每项为非空字符串 |
| `checks.uiTokens.exclude` | 优先于 include 的排除 glob | 字符串数组<br>默认：`["**/generated/**","**/dist/**","**/coverage/**","**/reports/**"]` | 允许空数组；每项为非空字符串 |
| `checks.uiTokens.adapters.sass.enabled` | 使用消费项目自身的 Stylelint 与自定义语法解析 Sass 和 Vue style | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.uiTokens.adapters.unocss.enabled` | 是否启用UnoCSS Token 静态检查 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.uiTokens.adapters.unocss.configFiles` | 必须同时列入 Manifest sources 的 UnoCSS 配置文件 | 字符串数组<br>默认：`["uno.config.ts"]` | 至少 1 项；元素不可重复；每项为非空字符串 |
| `checks.uiTokens.adapters.unocss.attributify` | 是否检查 UnoCSS Attributify 写法 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.uiTokens.adapters.unocss.variantGroups` | 是否展开并检查 UnoCSS variant group 写法 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.uiTokens.icon.components` | 在这些组件上将 size、w、h utility 识别为 icon-size | 字符串数组<br>默认：`["UiIcon","SvgIcon"]` | 至少 1 项；元素不可重复；每项为非空字符串 |
| `checks.uiTokens.icon.nativeSvg` | 是否在原生 svg 元素上约束 icon-size utility | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `checks.uiTokens.icon.sassSelectors` | 在这些 Sass/CSS 选择器上下文中将 width、height、inline-size、block-size 识别为 icon-size | 字符串数组<br>默认：`["svg",".icon",".ui-icon",".svg-icon"]` | 至少 1 项；元素不可重复；每项为非空字符串 |

<!-- config-fields:end -->

保存这段配置后运行：

```bash
npx repo-guard enable uiTokens
```

项目需要用自己的设计系统生成脚本提交 `ui-tokens.manifest.json`，生成器必须输出 `version: 2`。读取端和 Schema 均拒绝旧版本，不自动转换或改写旧文件；请更新项目生成脚本并重新生成清单。定义源可以是 Sass、JSON、TypeScript 或其他语言；repo-guard 不执行定义源，而是只读取归一化后的 Token 类别与适配器别名。下面的 SHA-256 是格式占位，实际值必须由生成脚本按来源文件原始字节计算并写入：

```json
{
  "$schema": "./node_modules/@cxyi7/repo-guard/ui-token-manifest.schema.json",
  "version": 2,
  "sources": [
    {
      "path": "src/styles/tokens.scss",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    {
      "path": "uno.config.ts",
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ],
  "tokens": [
    {
      "id": "color.brand",
      "category": "color",
      "aliases": {
        "sass": ["$color-brand"],
        "unocss": ["bg-brand", "text-brand"]
      }
    },
    {
      "id": "spacing.md",
      "category": "spacing",
      "aliases": {
        "sass": ["$space-md"],
        "unocss": ["p-space-md", "gap-space-md"]
      }
    },
    {
      "id": "breakpoint.tablet",
      "category": "breakpoint",
      "aliases": {
        "sass": ["$breakpoint-tablet"],
        "unocss": ["tablet"]
      }
    }
  ],
  "shortcuts": [
    {
      "name": "card-tokenized",
      "expandsTo": ["bg-brand", "p-space-md"]
    }
  ]
}
```

<!-- config-fields:start -->
**字段说明**：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `version` | UI Token Manifest 格式版本 | 只能为 `2`<br>本对象内必填，无自动代填值 | 只接受列出的值；拒绝旧版本，不自动转换 |
| `sources` | Token 定义源及 UnoCSS 配置文件的指纹列表 | 对象数组；对象字段见后续行<br>本对象内必填，无自动代填值 | 至少 1 项；来源必须受 Git 跟踪；Manifest 不得引用自身，修改来源后需重新生成真实指纹。 |
| `sources[].path` | 实际 Token 来源或 UnoCSS 配置文件的仓库相对路径 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符；不能只包含空白；来源必须受 Git 跟踪；Manifest 不得引用自身，修改来源后需重新生成真实指纹。 |
| `sources[].sha256` | 来源文件原始字节的小写 SHA-256 | 字符串<br>本对象内必填，无自动代填值 | 64 位小写十六进制 SHA-256，必须从真实文件字节计算；来源必须受 Git 跟踪；Manifest 不得引用自身，修改来源后需重新生成真实指纹。 |
| `tokens` | 项目设计系统声明的 Token 列表 | 对象数组；对象字段见后续行<br>本对象内必填，无自动代填值 | 至少 1 项 |
| `tokens[].id` | 稳定且唯一的 Token 标识 | 字符串<br>本对象内必填，无自动代填值 | 小写字母开头的稳定标识，段之间用点或连字符，段内只含小写字母和数字 |
| `tokens[].category` | Token 所属的受控设计类别 | `"color"` / `"spacing"` / `"font-family"` / `"font-size"` / `"line-height"` / `"font-weight"` / `"radius"` / `"shadow"` / `"z-index"` / `"breakpoint"` / `"animation-duration"` / `"icon-size"`<br>本对象内必填，无自动代填值 | 只接受列出的值 |
| `tokens[].aliases.sass` | Sass 中可引用该 Token 的精确表达式列表 | 字符串数组<br>未声明固定默认值 | 允许空数组；元素不可重复；每项为非空字符串；每项：不能只包含空白；按完整表达式匹配；使用时类别必须与受控属性一致。 |
| `tokens[].aliases.unocss` | UnoCSS 中可引用该 Token 的单个静态 utility 列表 | 字符串数组<br>未声明固定默认值 | 允许空数组；元素不可重复；每项为非空字符串；每项：单个非空且不含空白的字符串；不得包含 variant 或 ! 前缀；别名与 shortcut 不得相互重名。 |
| `shortcuts` | 项目静态 shortcut 的声明列表 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `shortcuts[].name` | shortcut 的唯一静态名称 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符；单个非空且不含空白的字符串；不得包含 variant 或 ! 前缀；别名与 shortcut 不得相互重名。 |
| `shortcuts[].expandsTo` | 该 shortcut 实际展开的静态 utility 列表 | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；元素不可重复；每项为非空字符串；每项：单个非空且不含空白的字符串；必须与 UnoCSS 配置双向一致，展开后的受控 utility 仍逐项检查。 |
| `$schema` | 指向本配置的 JSON Schema，为编辑器提供字段校验 | 字符串；示例为包内 Schema 相对路径 | 相对路径按当前配置文件所在目录解析；这不是业务开关 |

<!-- config-fields:end -->

管理范围固定为以下 12 类：`color`、`spacing`、`font-family`、`font-size`、`line-height`、`font-weight`、`radius`、`shadow`、`z-index`、`breakpoint`、`animation-duration`、`icon-size`。宽高、布局、定位模式、透明度、边框宽度、轮廓宽度、文字装饰厚度和描边宽度等其他样式不做判断；唯一例外是配置的图标组件和原生 `svg` 上的 `size`、`w`、`h` UnoCSS utility 会按 `icon-size` 检查。

Sass 适配器有以下边界：

- 使用消费项目自己的 Stylelint、配置和 custom syntax 解析 `.scss`、`.sass`，以及 Vue 中显式标注 `lang="scss"` 或 `lang="sass"` 的 style 块；未选择的 CSS、Less 等语言不会被 Sass 适配器接管。门禁不安装或替换 Sass/Stylelint，也不执行 fix。`icon.sassSelectors` 明确哪些选择器中的 `width`、`height`、`inline-size`、`block-size` 按 `icon-size` 管理，普通元素宽高仍不受约束。
- 受控声明和 `@media`/`@container` 断点必须引用 Manifest 中类别匹配的 Sass 别名。别名可以是变量、map 访问或函数调用等项目写法，但按完整表达式边界匹配，不能用较短别名前缀伪装未登记变量。
- 原始颜色（包括简写中的命名颜色）、长度、字体简写、时长、阴影、断点、未登记变量、错误类别、`calc()` 或原始 fallback 等不可证明写法会阻断；`0`、`auto`、`inherit`、`none` 等与设计刻度无关的安全常量允许使用。

UnoCSS 适配器有以下边界：

- 静态检查 Vue/HTML 的 class、Vue/JSX 绑定中的有限字符串分支、JavaScript/TypeScript/JSX 字符串、带值或无值 Attributify，以及包含函数或任意值的嵌套 variant group；受控 utility 必须精确等于对应类别的 Manifest 别名。无法枚举输出的整个动态 class 绑定会阻断；具有固定 utility 前缀的插值仅在该前缀属于受控类别时阻断。负值 utility 和任意 CSS 属性写法同样不能绕过。
- 默认刻度（例如 `p-4`）、任意值（例如 `bg-[#fff]`）、未登记 breakpoint、任意媒体/容器断点，以及能生成受控 utility 的模板插值或字符串拼接都会阻断。hover、状态、选择器等非断点 variant 不属于 Token 类别，门禁只继续检查其展开后的受控 utility。
- `configFiles` 只做 AST 静态解析，绝不加载或执行。`theme.breakpoints` 必须静态可证明且每个名称都来自 breakpoint Token；配置与 Manifest 中的静态 shortcut 必须双向一致，所有展开内容即使尚未使用也会检查。基础 utility 只信任从 `unocss` 或对应 `@unocss/*` 包静态导入的 Uno/Mini/Wind/Attributify preset，以及官方 variant-group transformer；其参数必须是静态数据。循环、动态、正则/函数 shortcut、配置展开、自定义 `rules`、preset、variant、preflight、extractor、safelist、postprocess 和其他 transformer 无法形成可验证闭环，因此直接阻断。
- 每个 UnoCSS 配置文件都必须出现在 Manifest `sources`。主配置、Manifest、任一来源或 UnoCSS 配置发生变化时，pre-commit 与 CI 会从增量检查提升为作用范围内全量复查，避免改 Token 后漏检未修改页面。

Manifest 启用后会自动加入 `notify` 级受保护文件规则。Manifest 不得把自身列为来源；UnoCSS 别名和 shortcut 项必须是单个无空白静态 token，别名与 shortcut 名称不得包含 variant、`!` 前缀或彼此重名。来源哈希不一致、配置未跟踪、别名类别错误、契约文件删除和静态分析无法证明的动态写法都会产生中文结构化问题；即使一次提交只有删除项，pre-commit 也会补跑只读质量入口。临时放行只能使用现有的精确、限时结构化例外。项目的 Manifest 生成器必须以设计系统定义源为事实来源，不能通过删 Token、伪造类别或只刷新哈希来隐藏违规。

## 执行与复核

执行入口：手动、pre-commit、CI policy/full 和 release-ready。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/quality/ui-token-gate.js) · [对应测试](../../test/gates/quality/ui-tokens.test.js)
