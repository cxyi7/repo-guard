# Token 指定值与生成 CSS 校验

接入时遵守[消费项目预设设计原则](consumer-preset-design-principles.md)：先确认实际源码范围，不能假设已有标准目录或类名。检查通过只针对明确配置的范围，不证明整个消费项目都已纳入。

[功能索引](README.md) · [样式 Token](ui-tokens.md)

`checks.stylelint.uiTokens.values` 保存项目明确确认的值约定，`artifacts` 控制构建后的 CSS 检查，两者默认关闭。仅开启 `values` 就能验证源码，无需浏览器或构建。规则只判断是否遵守指定值，不判断颜色、间距是否适合业务，也不承诺浏览器的计算值、层叠结果或视觉表现。

## 配置

以下片段合并到现有 `checks.stylelint.uiTokens`。对应的来源文件、Token 标识和别名必须已经登记在清单中，来源指纹必须正确：

```json
{
  "enabled": true,
  "values": {
    "enabled": true,
    "definitions": [
      {
        "token": "color.brand",
        "source": "styles/tokens.css",
        "language": "css",
        "alias": "var(--color-brand)",
        "selector": ":root",
        "value": "#1677ff",
        "conditions": [],
        "outputs": [
          { "selector": ":root", "property": "--color-brand" }
        ]
      },
      {
        "token": "color.brand",
        "source": "styles/theme-dark.css",
        "language": "css",
        "alias": "var(--color-brand)",
        "selector": "[data-theme=dark]",
        "value": "#4096ff",
        "outputs": [
          { "selector": "[data-theme=dark]", "property": "--color-brand" }
        ]
      }
    ]
  },
  "artifacts": { "enabled": false, "patterns": ["**/*.css"] }
}
```

| 字段（相对于 `uiTokens`） | 用途与约束 |
| --- | --- |
| `values.enabled` | 默认 `false`；开启后 `definitions` 必须非空。 |
| `values.definitions` | 默认 `[]`；只对明确列出的定义核对指定值，其余 Token 继续执行原有登记、类别及引用检查。 |
| `definitions[].token` | 清单中的 Token 标识。 |
| `definitions[].source` | 清单登记的确定样式文件，应用相对路径，不接受 glob、JSON 或 JS。必须纳入检查，即使普通扫描范围排除了它或本轮暂存区没有样式文件。 |
| `definitions[].language` | `css`、`sass` 或 `less`，必须已开启且与来源文件类型对应；Vue 按样式块语言识别。 |
| `definitions[].alias` | 清单已登记、可直接定义的 `var(--name)`、`$name` 或 `@name`；函数、map 表达式和 Sass 模块限定引用不能充当定义名。 |
| `definitions[].selector` | 定义所在选择器；文件根级的 Sass/Less 变量使用空字符串。支持选择器列表，每个分支都校验，不推断业务元素身份。 |
| `definitions[].value` | 必填的源码指定值；同一位置不能重复登记。每次出现均检查，不能用后续正确声明掩盖错误声明。 |
| `definitions[].conditions` | 默认 `[]`；外层 at-rule 条件，按由外到内排列，例如 `[{"name":"media","params":"(prefers-color-scheme: dark)"}]`。主题、媒体条件和层的位置均须明确登记。嵌套选择器不自动展开。 |
| `definitions[].outputs` | 默认 `[]`；启用产物检查时每项至少一个映射。字段为 `selector`、`property`、可选 `conditions` 和 `value`。 |
| `outputs[].value` | 可选，默认沿用源码指定值；编译后值不同（如 Sass 表达式、`!default`）时，明确填写预期输出值，程序不推导编译结果。 |
| `artifacts.enabled` | 默认 `false`；要求 `values.enabled`、非空输出映射、`checks.build.enabled`、`build.artifactBudget.enabled` 和精确的 `cleanScript`。 |
| `artifacts.patterns` | 默认 `["**/*.css"]`；相对于 `checks.build.artifactBudget.outputDirectory`，不写死 `dist`。只解析匹配的 `.css` 文件。零匹配是配置错误。 |

关闭 `values` 不影响原有 Token 引用检查；关闭 `artifacts` 不影响源码检查。关闭 Stylelint 或 Token 主开关时保留所有子配置，不删除依赖、文件或已确认值。用户可以修改这些配置，修改后必须重新核验。

## 判断依据与边界

源码检查发现缺失定义、错误值、`!important` 或未登记位置的重定义时阻断。`@property` 注册声明、函数参数等不能冒充实际变量赋值。转义变量名也参与匹配。原有受控属性引用规则仍生效：业务代码即使写了同值字面量，也不会因此获得绕过 Token 引用的许可。

比较采用 AST：允许明确的语法差异，如顶层值中的 `#fff` 与 `#ffffff`、逗号旁空白、属性选择器引号和选择器注释；保留变量大小写、字符串内容和单位。任意函数参数中的哈希值可能是标识，不推断为颜色，采用保守比较，包括转义函数名。普通 CSS 属性名忽略大小写，自定义属性名仍区分大小写；同一输出位置的配置冲突也按此规则拒绝。只将声明与变量定义作为产物值证据，不把同名媒体或容器规则当作属性声明。不会认定 `1rem = 16px`、`0 = 0px`，不计算 `calc()`、Sass/Less 函数、CSS 变量引用链或运行时 fallback。

产物检查在清理与真实构建成功后执行，不进入 pre-commit。检查每个输出映射是否存在、值是否一致；受控 CSS 自定义属性出现在未登记选择器或条件下也会阻断。普通属性只检查明确映射的选择器与条件，不推断其他规则是否在浏览器中覆盖它。它不扫描 JS 中嵌入的 CSS、HTML 的 style 属性、远程样式或运行时插入的样式，也不验证任意 `var()` 在浏览器中是否能解析。

产物必须位于当前应用的安全输出目录，不允许符号链接；扫描上限为 100000 个目录或文件，CSS 单文件 10 MiB、总计 100 MiB。指定映射不能依靠例外直接跳过产物核对。只有源码、产物和其他构建检查全部通过才登记构建证据，证据包含 Token 配置、清单及来源实际指纹；构建期间输入变化、检查失败或后续修改均不能继续复用该证据。

## 执行与验证

执行 `npx repo-guard doctor` 校验接入，再运行 `npx repo-guard stylelint` 核验源码；启用产物检查后运行 `npx repo-guard build`。多应用仓库加 `--project <id>`。配置/执行错误使用统一退出码 `1`；缺失、错值和未授权定义作为违规使用 `2`。配置或清单变化触发 Token 全量复查，不能通过无暂存样式跳过。

[源码门禁](../../src/gates/quality/ui-token-gate.js) · [构建衔接](../../src/gates/quality/ui-token-build.js) · [源码真实解析测试](../../test/integrations/ui-tokens/style-gate.test.js) · [真实构建测试](../../test/integrations/ui-tokens/build-values.test.js)
