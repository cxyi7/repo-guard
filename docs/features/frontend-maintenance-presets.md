# 前端文件组织与维护预设

[功能索引](README.md) · [工具预设](frontend-tool-presets.md)

前端 Vue 项目初始化时将本页预设完整保存到 `repo-guard.config.json`。本页描述初始化模板，不改变已有配置的读取补缺值；升级包不会开启既有项目的检查。显式启用某项时补充缺少字段，已保存的值和数组优先，关闭后仍保留配置。Java 和 Node 后端不使用这套前端目录规则。

## 默认开关

开启 `filePlacement`、`maxFileLines`、`pathNaming`、`architecture`、`asyncResourceCleanup`、`functionDocs`、`fileHeader`。`deadCode` 默认开启核心问题类型并写入可修改的 Knip options；`repository.codePlacement` 保持关闭。架构工具由消费项目安装，完整预设不等于已经安装工具；先运行 Doctor，再用真实检查验证。

## 目录与命名

| 类别 | 默认允许目录 | 识别范围 |
|---|---|---|
| 测试 | `src/tests/**` | `.test` / `.spec` 脚本和 test/tests/__tests__ 目录内容 |
| 专用类型 | `src/types/**` | `.d.ts/.d.mts/.d.cts`、`.types.ts/.types.mts/.types.cts` 和 types 目录中的 TS 文件 |
| 独立样式 | 应用根目录 `styles/**` | CSS、SCSS、Sass、Less；Vue 内联 style 保留 |
| 资源 | `src/assets/**`、`public/assets/**`、`docs/assets/**` | 图片、字体、媒体和 PDF，保留 favicon 例外 |
| 文档 | `docs/**` 与既有工具文档目录 | Markdown，保留根 README、AGENTS 等明确例外 |

归位采用 `newFiles`，新增、复制和重命名文件受限；显式审计可检查存量。规则按数组顺序取第一项，测试 fixture 优先归测试目录，不自动移动文件。普通 `.ts` 业务实现不视作类型文件；任意文件是否只含类型无法由这套路径分类完整推断。

命名默认 `convention: "kebab-case"`、`include: ["src/**"]`、`lowercaseExtension: true`。目录和所有文件统一风格：`order-list.vue`、`use-order.ts`、`order.types.ts`、`order.d.ts`。不设 PascalCase 特例；`App.vue` 也会报告命名问题，接入时须明确重命名并更新引用，或由用户配置例外。多段文件名各段均检查，最后的扩展名独立检查小写。默认排除隐藏路径和 generated 目录；框架路由特例由项目显式配置。

`lowercaseExtension` 为可修改布尔字段，未声明时不改变旧检查行为。主配置 Schema 与运行时校验一致。

## 文件规模

默认 `strict`，达到阈值的 85% 提醒，超限阻断；行数包含空行和注释。用户可修改 `rules`、`exclusions`、`warnAt` 和模式，不自动放宽。

| 第一条匹配规则 | 行数上限 |
|---|---|
| `src/**/*.vue` | 700 |
| src 下 composables、utils 目录的脚本 | 400 |
| src 下 api、stores、store 目录的脚本 | 500 |
| src 下其余 JS/TS 系列 | 1000 |
| src 与根 styles 下 CSS/SCSS/Sass/Less | 500 |

样式规则额外覆盖根 `styles/`，避免文件移到规定目录后逃出规模检查。业务脚本范围不扩展到 src 外。

## 架构与业务分层

使用项目 dependency-cruiser，默认源码 `src`、超时 120000ms、按项目 tsconfig 解析别名。规则名称、正则目录、严重程度和数组均可修改。不存在的业务目录不会被强行创建。

- 禁止循环依赖、无法解析的导入、生产源码引用 `src/tests`、生产源码引用仅开发依赖、源码引用 dist/build 产物。
- 不提供包内部路径或 exports 公开入口限制，不根据依赖包的 src/internal 目录名判定违规；导入无法解析仍由独立的 no-unresolved 规则报告。
- 公共 components 不依赖 views/pages；utils 不依赖页面、组件、store/stores 和 features。
- api 不依赖 UI 和页面；types/constants 不依赖页面、组件、状态、features 和 api。
- shared、components、utils、types、constants 不依赖具体 features。
- `src/features/<业务>/` 内部可互相引用，跨业务只能引用目标的 `index` 脚本入口，不允许访问其内部文件。

具体规则在 [模板源码](../../src/profiles/frontend-maintenance-presets.js) 中定义并在初始化时写出。不得只改目录名绕过团队边界；调整项目布局时同步规则及引用。架构检查运行在手动、可选 pre-push、CI full 和 release-ready，不进入 pre-commit。

## 函数文档

默认只同步 `src/**` 中公开导出的函数及公开导出类/对象的方法，排除测试、声明和生成文件。以下字段均可修改：

| `checks.functionDocs` 字段 | 前端初始值 | 行为 |
|---|---|---|
| `exportedOnly` | true | 内部局部函数不自动补空文档 |
| `requireDescription` | true | 公开函数有正文或非空 @Description |
| `requireParamDescription` | true | 每个具名参数有非空含义说明 |
| `requireReturnsDescription` | true | 有返回值时要求非空返回说明 |
| `requireThrowsDescription` | true | 可识别直接逃逸异常时要求非空异常说明 |
| `requireSideEffectsDescription` | true | 要求 @remarks 说明副作用；无副作用时明确写出 |

示例：

```ts
/**
 * 根据标识读取缓存订单。
 * @param id 订单唯一标识
 * @returns 缓存中的订单，缺失时为 undefined
 * @remarks 只读缓存，不发起网络请求。
 */
export function findOrder(id: string) {
  return orders.get(id);
}
```

同步只维护签名相关标签，不编造参数单位、边界条件或业务说明。程序检查结构和非空，说明准确性由 AI 与负责人检查。匿名解构参数暂不自动同步，严格参数说明模式会阻断并要求人工处理；可使用具名参数后在函数内部解构。Generator 返回标签仍提示人工维护。

新增只读 `function-docs` 命令和 `quality.function-documentation` 门禁，在 pre-commit 格式修复和 ESLint/Stylelint 复核之后检查最终内容；CI policy/full、release-ready 同样检查。缺少说明返回违规状态与公共退出码 2；没有文件或已禁用是跳过，不是交付通过证据。源码解析失败使用公共执行错误状态。CI 与手动检查不写文件；pre-commit 的同步仍受 lint-staged 隔离与失败恢复保护。

## 文件头、异步资源和保留关闭项

文件头默认 `src/**`，排除测试、generated、vendor；沿用 Git 作者时间与人工描述同步，不改写普通许可证。异步清理默认使用已有 Vue/composables 范围、1000ms 延时阈值和 fetch 请求识别，完整字段写入配置。长期请求或特殊生命周期通过项目范围及经过审核的例外处理。

无效代码在前端新建预设中开启；精确代码位置检查仍关闭，不删除依赖。原生工具配置优先的合并仅限已经提供适配的工具能力；架构和本页原生策略以其 repo-guard 配置为准，Knip 已提供内联与原生配置合并，dependency-cruiser 不据此获得原生合并能力。

[集成验证](../../test/integrations/frontend-maintenance.test.js)

公共方法测试预设另见[单元测试](unit-test.md)、[覆盖率](coverage.md)和[变异测试](mutation-test.md)。三项在新前端配置默认开启，不改变已有显式开关。

前端 TypeScript 新建预设默认开启 typeCheck 并写入 vue-tsc 及严格编译选项；JavaScript 预设保持关闭。Stylelint 的 uiTokens 主开关默认开启。旧配置读取和已有显式关闭项均保留。
