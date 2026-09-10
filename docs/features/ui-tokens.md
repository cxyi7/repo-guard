# 样式 Token 检查

让颜色、间距、字号等使用团队登记的设计变量，支持原生 CSS、SCSS/Sass、Less，以及 Vue 中对应的内联 `style` 块。功能名仍为 `uiTokens`，默认关闭，仅适用于前端应用。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

例如，团队将 `var(--space-md)` 登记为间距 Token 后，`padding: var(--space-md)` 可以通过；直接写 `padding: 16px` 会被指出。检查只读，不代替 Stylelint 的常规规则，也不会自动生成设计系统或修复样式。

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值。配置片段需合并到原文件，数组整项替换。

## 接入与配置

先准备应用自己的 Stylelint 安装、配置及所选语言需要的自定义语法，再准备 Token 定义源和清单。原生 CSS 不需要 Sass 或 Less 预处理器；SCSS、缩进式 Sass、Less 和 Vue 样式需要消费项目配置能够解析相应文件的 `customSyntax`。repo-guard 不探测语言、不安装工具，也不编译 Sass 或 Less。

本仓库已通过真实解析测试的配置组合如下；只需准备项目实际使用的语法包，并在现有 Stylelint 配置的 `overrides` 中按文件类型设置 `customSyntax`：

| 文件类型 | `customSyntax` | 说明 |
|---|---|---|
| `.css` | 默认 CSS 解析器 | 无需额外语法包 |
| `.scss` | `postcss-scss` | 保留 SCSS 变量及表达式 |
| `.sass` | `postcss-sass` | 解析缩进式 Sass |
| `.less` | `postcss-less` | 保留 Less 变量及表达式 |
| `.vue` | `postcss-html` | 同时安装内联样式语言对应的语法包；按各块的 `lang` 解析 |

这些语法包安装在消费项目中。常规样式规则继续由项目自己的 Stylelint 配置维护。

在所属前端应用的 `repo-guard.config.json` 中添加：

```json
{
  "checks": {
    "uiTokens": {
      "enabled": false,
      "languages": ["css", "sass", "less"],
      "manifestFile": "ui-tokens.manifest.json"
    }
  }
}
```

只使用原生 CSS 时，将 `languages` 改为 `["css"]`；SCSS 和缩进式 Sass 都用 `"sass"`。允许按项目实际情况多选。扫描时同时根据明确选择的语言与文件语法判断，未选择的语言不会被接管。

<!-- config-fields:start -->
**字段说明**（包含可选的扫描与图标配置）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.uiTokens.enabled` | 启用样式 Token 检查 | `true` / `false`；默认 `false` | 必须是 JSON 布尔值；启用后需要有效的清单、来源文件及对应解析工具。 |
| `checks.uiTokens.languages` | 明确参与检查的样式语言 | 从 `"css"`、`"sass"`、`"less"` 中选择；默认 `["css"]` | 非空且不可重复；`sass` 同时包含 `.scss` 和 `.sass`；Vue 块根据 `lang` 归属，没有 `lang` 的块属于 CSS。 |
| `checks.uiTokens.manifestFile` | 项目生成并提交的 Token 清单 | 应用相对文件路径；默认 `"ui-tokens.manifest.json"` | 非空、确定文件路径，不支持 glob；不得越出应用目录。 |
| `checks.uiTokens.include` | 参与扫描的应用相对 glob | 字符串数组；默认 `["src/**/*.{vue,css,scss,sass,less}"]` | 至少一项，每项非空；目录不在 `src` 下时需调整。 |
| `checks.uiTokens.exclude` | 优先于 `include` 的排除范围 | 字符串数组；默认 `["**/generated/**","**/dist/**","**/coverage/**","**/reports/**"]` | 允许空数组，每项非空；不要把业务样式整体排除来隐藏违规。 |
| `checks.uiTokens.iconSelectors` | 哪些选择器中的尺寸按图标尺寸检查 | 字符串数组；默认 `["svg",".icon",".ui-icon",".svg-icon"]` | 至少一项、不可重复且每项非空；匹配上下文中的 `width`、`height`、`inline-size`、`block-size` 使用 `icon-size` 类别。 |

<!-- config-fields:end -->

将真实的 Token 来源与清单加入 Git 后启用：

```bash
npx repo-guard enable uiTokens
npx repo-guard doctor
npx repo-guard ui-tokens
```

多应用仓库在命令后加 `--project <id>`。启用命令会在**所属应用**的 `repository.rules` 中为清单补充 `notify` 保护，路径相对于该应用；不会把前端保护规则写入后端。已有同路径规则不会被降低，关闭检查也不会移除这条保护规则。启用与停用会同步应用的 AI 托管规范；直接修改配置后运行 `npx repo-guard doctor --fix` 同步，再执行 `doctor` 复核。

当前配置不再提供 UnoCSS 检查。旧的 `adapters`、`icon`，以及清单中的 `aliases.unocss`、`shortcuts` 都会被拒绝，不自动转换。Stylus 不在支持范围内。

## 维护 Token 清单

项目使用自己的设计系统生成脚本产出并提交 `ui-tokens.manifest.json`，必须使用 `version: 2`。定义源可以是 CSS、Sass、Less、JSON、TypeScript 或其他文件；repo-guard 不执行定义源，只读取清单中的类别、语言别名和来源指纹。

下面展示同一个 Token 如何对应三种样式语言。示例的 SHA-256 只是格式占位，不能直接用于检查；生成脚本必须按真实来源文件的原始字节计算。若变量由多个文件定义或生成，需把实际定义源完整列入 `sources`。

```json
{
  "$schema": "./node_modules/@cxyi7/repo-guard/ui-token-manifest.schema.json",
  "version": 2,
  "sources": [
    {
      "path": "design/tokens.json",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ],
  "tokens": [
    {
      "id": "color.brand",
      "category": "color",
      "aliases": {
        "css": ["var(--color-brand)"],
        "sass": ["$color-brand"],
        "less": ["@color-brand"]
      }
    },
    {
      "id": "spacing.md",
      "category": "spacing",
      "aliases": {
        "css": ["var(--space-md)"],
        "sass": ["$space-md"],
        "less": ["@space-md"]
      }
    },
    {
      "id": "breakpoint.tablet",
      "category": "breakpoint",
      "aliases": {
        "css": ["768px", "48rem"],
        "sass": ["$breakpoint-tablet"],
        "less": ["@breakpoint-tablet"]
      }
    }
  ]
}
```

<!-- config-fields:start -->
**字段说明**：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `$schema` | 为编辑器提供字段校验 | 可选字符串；示例为包内 Schema 相对路径 | 相对路径按清单所在目录解析，按实际安装位置调整；不控制检查开关。 |
| `version` | 清单格式版本 | 必填，只能是 `2` | 不读取或转换旧版本。 |
| `sources` | 真实 Token 定义源及其指纹 | 必填对象数组 | 至少一项；路径不可重复；来源需纳入 Git，清单不得引用自身。 |
| `sources[].path` | 定义源的位置 | 必填、非空的应用相对文件路径 | 确定路径，不支持 glob，不得越出应用目录或经过符号链接。 |
| `sources[].sha256` | 来源文件原始字节的 SHA-256 | 必填字符串 | 64 位小写十六进制，必须与实际文件一致；来源变化后重新生成。 |
| `tokens` | 允许使用的设计 Token | 必填对象数组 | 至少一项；每个 Token 都需声明标识、类别及至少一种语言的别名。 |
| `tokens[].id` | 稳定的 Token 标识 | 必填字符串，例如 `color.brand` | 不可重复；小写字母开头，段内只含小写字母和数字，段间使用点号或连字符。 |
| `tokens[].category` | Token 所属的设计类别 | 必填，下表的 12 类之一 | 使用时必须与受控属性的类别一致。 |
| `tokens[].aliases` | 各语言允许的精确写法 | 必填对象，仅支持 `css`、`sass`、`less` | 至少一个语言数组非空；省略的语言补为空数组。同一语言的别名在整份清单中不得重复。 |
| `tokens[].aliases.css` | CSS 变量引用，或 CSS 断点允许值 | 字符串数组，默认 `[]` | 普通类别只能是完整 `var(--name)`，名称只含字母、数字、下划线、连字符，无空白与回退参数；断点类别只能是大于零的 `px`、`em` 或 `rem` 长度。 |
| `tokens[].aliases.sass` | Sass 中允许使用的变量或表达式 | 字符串数组，默认 `[]` | 每项非空、不可重复；按完整表达式边界匹配，例如 `$space-md` 或项目登记的 map、函数表达式。 |
| `tokens[].aliases.less` | Less 中允许使用的变量或表达式 | 字符串数组，默认 `[]` | 每项非空、不可重复；按完整表达式边界匹配，例如 `@space-md` 或项目登记的函数表达式。 |

<!-- config-fields:end -->

普通声明可以在 Sass、Less 文件中使用已登记的 CSS `var()` 别名。断点按当前样式语言单独匹配：CSS 使用清单中允许的具体值，Sass 和 Less 使用各自登记的别名。不会因为 CSS 允许 `768px` 就同时允许 Sass 文件硬编码这个值。

CSS 自定义属性不能直接用于 `@media` 的条件，因此 CSS 的断点 Token 在清单中登记允许的长度，例如 `@media (min-width: 768px)`。允许值必须由团队明确确认；`768px` 与 `48rem` 是两个独立别名，不假定它们始终等价。`var(--space-md, 16px)` 这样的回退写法不能证明始终符合指定 Token，不能通过检查。

## 检查范围与边界

| 类别 | 约束的设计内容 |
|---|---|
| `color` | 文字、背景、边框等受控颜色 |
| `spacing` | 内外边距、间隙等间距 |
| `font-family` | 字体族 |
| `font-size` | 字号 |
| `line-height` | 行高 |
| `font-weight` | 字重 |
| `radius` | 圆角 |
| `shadow` | 阴影 |
| `z-index` | 层级 |
| `breakpoint` | 媒体与容器查询的断点 |
| `animation-duration` | 动画与过渡时长 |
| `icon-size` | `iconSelectors` 指定上下文中的图标尺寸 |

受控声明需要使用对应类别的完整别名。原始颜色、长度、字体、阴影、时长、未登记变量、错误类别及无法证明符合清单的计算表达式会被指出；`0`、`auto`、`inherit`、`none` 等不属于设计刻度的中性常量允许使用。普通元素宽高、布局、定位模式、透明度、边框厚度等不属于本门禁的管理范围。

已登记变量应在清单中的定义源维护。受控组件中重新定义这些变量会产生 `ui-token/unapproved-definition`，避免在组件里给同名 Token 换一个任意值。来源文件的指纹验证不等于自动验证设计系统是否合理：项目生成器必须以真实定义源为依据，不能通过删 Token、伪造类别或仅刷新哈希隐藏违规。

检查独立的 `.css`、`.scss`、`.sass`、`.less` 文件和 Vue 内联样式块。Vue 的外链 `style src` 指向的样式，只有作为独立文件落入扫描范围且选中对应语言时才参与检查；本门禁不追踪全部外链。HTML `style` 属性、JavaScript 动态样式、运行时或编译后生成的样式不在本次扫描范围内。解析失败时提示工具或语法配置问题，不把文件当作通过。

样式解析失败保持 `configuration-error` 分类；Stylelint 原始诊断单独写入标准 `diagnostics`，标注 `stylelint` 来源，完成敏感信息与仓库根路径脱敏并限制长度，Console 和 JSON 报告均保留诊断。

清单、任一来源或应用配置变化时，增量入口会复查该应用范围内的全部受控样式，避免修改 Token 后漏掉未修改的页面。这是只读复查，不会从 Hook 执行项目级修复。来源哈希不一致、契约文件缺失或删除都会产生中文结构化问题；只有删除项的提交也会补跑只读入口。临时放行使用应用自己的精确、限时[结构化例外](structured-exceptions.md)。

## 执行与复核

执行入口：手动 `ui-tokens`、pre-commit、CI `policy` / `full` / `release-ready`。不进入 pre-push；功能开关、应用身份、所选语言与文件范围共同决定实际检查范围。前端配置不会套用到 Node 后端，后端不得启用该功能。

检查失败时，根据中文报告中的规则、文件位置和证据修复。源码问题改用正确类别的 Token；定义变更需要重新生成清单并核对指纹；工具问题需要补齐消费项目的 Stylelint 与语法配置。修改后重新暂存，使用相同入口复核，不通过关闭功能或删除清单规避团队要求。

[实现入口](../../src/gates/quality/ui-token-gate.js) · [策略测试](../../test/policies/ui-tokens.test.js) · [真实解析与清单测试](../../test/integrations/ui-tokens/) · [提交阶段测试](../../test/hooks/ui-tokens.test.js)
