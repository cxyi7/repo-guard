# 前端工具预设与原生配置合并

[功能索引](README.md) · [ESLint](eslint.md) · [Prettier](prettier.md) · [Stylelint](stylelint.md) · [类型检查](typecheck.md)

Vue JavaScript / TypeScript 应用将四项工具的团队默认规则保存到 `repo-guard.config.json` 的 `checks.<工具>.options`。用户可编辑这些值；执行时同一文件适用的原生配置优先。不开启 Java 或 Node 后端的前端规则，也不把工具安装放进 Hook。

## 启用与更新

```bash
npx repo-guard enable eslint prettier stylelint typeCheck --project web
npx repo-guard doctor --project web
npx repo-guard ci --project web --profile full
```

启用前需准备消费项目自己的工具。首次 `init` 只为当前默认开启的 ESLint、Prettier 保存预设；Stylelint 和类型检查仍由明确启用选择。`enable` 为缺少 `options` 的检查补齐整份模板，即使该检查此前已开启。已有 `options`（包括空对象）不会重新填充或覆盖，重复启用不改写文件。关闭检查保留配置、依赖及原生工具文件。

读取既有 v2 配置不自动套用新预设；没有 `options` 的配置继续使用已声明的执行方式。新字段不是旧格式转换器。升级 npm 包不自动重置保存过的规则。

`requireConfig: true` 接受内联 `options` 作为配置来源，不再要求额外创建 `.prettierrc` 或 Stylelint 配置文件。ESLint 有 `options` 时使用内联预设，忽略旧的 `preset` 布尔选择，避免重复注入；无 `options` 时仍按 `preset` 控制原有预设。

## 字段归属

| 字段 | 内容与要求 |
|---|---|
| `checks.eslint.options` | `recommended`、`typeAware`、`ignores`、`globals`、`linterOptions`、`rules`、`vueRules`、`typescriptRules`、`typedRules`；规则设置为 ESLint 原生值 |
| `checks.prettier.options` | JSON 格式化选项；支持行宽、缩进、分号、引号、尾逗号、括号、换行符和 Vue/HTML/Markdown 排版；未知选项或错误类型拒绝 |
| `checks.stylelint.options` | `extends`、`plugins`、`customSyntax`、`ignoreFiles`、`overrides`、`rules`、默认严重程度和禁用注释诊断；插件与语法由项目安装 |
| `checks.typeCheck.options` | 必填 `tool`（`tsc` / `vue-tsc`）、`configFiles`（非空应用内 JSON 路径数组）、`compilerOptions`（原生编译选项对象） |

具体配置在启用时完整写出；默认模板见[模板源码](../../src/profiles/frontend-tool-presets.js)，字段类型见[配置 Schema](../../config.schema.json)。不把插件对象、函数或 JavaScript 源码塞进 JSON；原生工具配置可以继续使用其支持的函数和模块导入。

## ESLint

基础模板组合项目安装的 `@eslint/js`、`eslint-plugin-vue`、`typescript-eslint` 与 `eslint-config-prettier`；按显式项目身份选取 Vue/TS 配置，使用 `globals` 提供浏览器全局变量。Prettier 冲突处理只作用于预设层，用户原生配置仍最后覆盖。

| 规则组 | 初始选择 |
|---|---|
| 可维护性 | 圈复杂度 15、嵌套 4、函数 120 行（不计空行注释）、嵌套回调 4、参数 5 |
| JS 正确性 | 严格相等、强制花括号、禁止 var/debugger/eval/Function、优先 const；Promise executor 返回值、返回赋值、自比较、alert 检查 |
| 调试与注释 | console 仅允许 warn/error；TODO/FIXME/HACK 默认报错；报告未使用的禁用指令及行内配置 |
| Vue | 默认 script setup；props 上限 12、模板深度 5；显式 emits、验证声明、按钮 type；禁止修改 props、computed 副作用与异步；未使用 refs 与 setup 响应性检查 |
| TS | 类型导入一致；禁止显式 any、非空断言；使用 TS 未使用变量规则；ts-ignore/ts-nocheck 禁止，ts-expect-error 要求至少 10 字符说明 |
| 类型感知 | Promise 未处理或误用、await 对象、无必要断言、不安全赋值/调用/成员访问/返回、switch 联合分支完整性 |

TypeScript 应用模板 `typeAware: true`；JavaScript 应用为 `false`。类型感知依赖项目实际 tsconfig；未加入类型项目的文件不能伪装为已检查。构建脚本或不同运行环境可通过原生 Flat Config 的文件块配置。

暂存类型感知检查复制整个仓库索引到临时目录，选中文件使用 lint-staged 隔离后的内容，依赖工具继续取消费项目安装；不读取未暂存依赖源码。修复成功才将选中文件写回，失败保留原文件，临时目录最终清理。索引中的冲突、符号链接和子模块当前明确拒绝，不能通过工作树回退混入未暂存内容。绝对指向仓库外源码的类型配置不属于可复现的索引快照配置，接入时应改成项目相对路径。

## Prettier

初始格式：`printWidth: 100`、`tabWidth: 2`、空格缩进、分号、JS 单引号、JSX 双引号、必要时属性引号、全部尾逗号、对象括号空格、箭头函数括号、LF。Vue script/style 不额外缩进，HTML 按 CSS 空白语义处理，不强制每属性独占一行，自动格式化嵌入代码，Markdown 保留正文换行。

逐文件调用项目 Prettier 的 `resolveConfig`，包含 `.editorconfig` 和原生 `overrides`；原生值覆盖同名内联值，未覆盖项保留。`.gitignore` / `.prettierignore` 继续生效。模板不声称 Prettier 能处理所有 Sass 缩进语法；不支持的文件必须采用经过验证的工具或调整该工具的文件范围。

## Stylelint

初始 CSS 模板使用 `stylelint-config-standard`、`stylelint-order`，Vue 文件使用 `postcss-html`。类名为小写 kebab-case，属性按字母序排列。CSS 正确性包含无效颜色、空块、重复属性（保留合法回退）、简写覆盖、字体回退、关键帧 important、未知单位/属性/选择器/at-rule 和属性值检查。

维护阈值：复合选择器 3、嵌套 3、ID 0，禁止 important；独立 CSS 权重为 `0,3,1`，SCSS/Less 与混合 Vue 不统一套用 specificity。加入 `custom-property-no-missing-var-function` 和 `declaration-block-no-duplicate-custom-properties`。关闭 `no-descending-specificity`；不禁止所有颜色字面量或 px。原生规则只执行最终合并结果，治理位于 `checks.stylelint.governance`，Token 位于 `checks.stylelint.uiTokens`。

SCSS、缩进 Sass、Less 必须在 `options.overrides` 或项目原生配置中明确配语法和对应规则，不按文件存在情况静默改动团队规则。例如 SCSS 使用 `stylelint-config-standard-scss`；其语言规则替代纯 CSS at-rule 检查，值表达式检查也需适配。Vue 混合样式语言应验证每种 lang 的实际解析。

两层配置分别通过 Stylelint 解析 extends 和逐文件 overrides，然后合并：同名规则整项替换，原生关闭值生效；插件按并集合并以支持未被覆盖的基础规则；其他原生字段优先。损坏原生配置报错，不当成不存在。

## 类型检查

初始选项为 `strict`、索引访问可能为空、精确可选属性、显式 override、switch 禁止贯穿、路径大小写一致、禁止不可达代码和无用标签、保留模块语法、逐文件转译约束。未使用变量/参数交给 ESLint；`skipLibCheck: false`。模块目标、模块解析、别名、源码范围和环境类型由项目实际配置决定。

读取 TypeScript 原生配置及 extends，遍历 `configFiles` 的全部项目引用；用户显式声明的选项优先，只补未声明的默认值。没有实际源码或配置无效均失败。Vue 使用 `vue-tsc`，包含 `.vue` 文件。原生继承配置组合造成互斥选项时报告实际错误，不自动放宽默认规则。

每个有源码的项目在临时检查配置中继承其原生配置，单独检查；检查模式固定不输出 JS、不构建复合项目产物，增量元数据只写入独立临时目录并最终清理，不覆盖项目原有 tsbuildinfo。这些是执行边界，不是可被原生配置开启的发布行为。跨应用引用拒绝；需要预构建声明产物的项目应先由团队准备，不能把没有产物误报为通过。实际 typecheck 脚本若存在，也执行并纳入结果，不用原生预设掩盖脚本失败。

类型检查不进入 pre-commit；在手动、可选 pre-push、完整 CI 和 release-ready 执行。多个类型检查结果按公共状态优先级汇总，原始码仅作为第三方诊断；启动失败、超时、信号终止属于执行错误。

## 查看最终配置与依赖要求

```bash
npx repo-guard tool-config --tool eslint --file src/App.vue --project web
npx repo-guard tool-config --tool prettier --file src/App.vue --project web
npx repo-guard tool-config --tool stylelint --file src/styles/main.css --project web
npx repo-guard tool-config --tool typeCheck --project web
```

查询返回 `version: 2` 的 JSON：`configured` 为已保存预设，`effective` 为工具解析后的生效设置，`requirements` 为已开启检查的依赖要求。ESLint/Stylelint 输出可序列化规则，不输出可执行解析器或插件对象。类型选项中枚举可能采用 TypeScript API 的数值表示。查询成功退出 `0` 只表示配置已解析，不能作为工程通过证据；非法输入、缺失工具或损坏配置按统一错误处理。

公开 API `getFrontendToolRequirements(config)` 供接入 Skill 获取包名与用途；生效配置通过上述 CLI 查询，执行适配器不作为包公共 API 导出。要求目录不自动解析任意原生配置的全部依赖，也不提供未经验证的版本组合；接入者仍需检查 Node、插件 peerDependencies、已有锁文件和原生配置引用。本文不代表自动安装 Skill 已交付。

## 验证依据

[配置与启停测试](../../test/config/frontend-tool-options.test.js) · [真实工具与索引隔离测试](../../test/integrations/frontend-tool-presets.test.js)

工具需求接口也服务 Node 后端的就绪验证：非内联 ESLint preset 同样登记 @eslint/js，TypeScript 身份登记 typescript-eslint 与 typescript；Vue 插件仅按 Vue 身份登记。Node 后端不自动获得前端工具 options。
