# Changelog

## 1.2.0

- 新增只读 `release-ready` CI profile 与固定 Execution Plan，复用 CI policy、项目 `check`/`test`、build、可选 Lighthouse，并在官方步骤末尾追加显式声明且仅限受保护引用的外部门禁。
- 新增版本、lockfile、changelog、draft 2020-12 Schema、exports/bin 与 npm pack 文件清单一致性检查；pack dry-run 忽略 lifecycle scripts、不生成 tarball，并拒绝敏感发布文件。
- 发布准备子进程仅接收运行所需环境变量白名单，拒绝 publish/deploy 脚本；GitLab 模板、CLI、配置 Schema、README 与架构进度同步更新，整个计划只证明“可以发布”，不会发布或部署。

## 1.1.0

- 新增严格的 `externalGates` 配置和 `repo-guard-json-v1` 报告 Schema，项目可通过精确 npm script 在 manual 与 CI full 接入 API、页面或视觉等自有门禁。
- 项目 Registry 从官方静态 Registry 派生，启用的 `project.*` 门禁只能固定追加到 CI full 官方步骤末尾，不能进入 pre-commit、pre-push、CI policy 或重排安全流水线。
- 新增报告新鲜度、状态/退出码一致性、未知字段、标准路径/符号链接、tracked file、大小、artifact 和敏感内容验证，并对外部脚本输出进行脱敏；超时、取消或输出超限会终止完整 npm 进程树。

## 1.0.0

- 将所有官方门禁收口为原生 `GateResult` Capability，删除数字 runner adapter、旧动态代码 facade、重复 command wrapper 和可旁路统一编排的数字执行入口。
- 收缩包根公共 API，只公开当前配置、Gate 定义/上下文/Registry 与结构化结果契约；这是明确的不兼容主版本重构。
- 缺省配置直接采用当前平台默认值，不再为旧项目保留 ESLint、Prettier、依赖治理和单文件行数门禁的关闭语义；托管 Hook 仍按仓库安全要求识别已知旧标记，但只生成当前版本。

## 0.20.0

- 将 pre-commit 固化为启动时校验的受保护执行计划，锁定 Stylelint fix、ESLint fix、Prettier、只读复检、硬性暂存检查、依赖策略和保护文件顺序；拒绝项目配置调序以及全项目修复、类型检查、测试、构建和网络门禁进入。
- 暂存质量段与最终策略段由同一计划派生并通过通用 orchestrator 传递 `GateResult`，删除 runner 内部数字结果协议；保护文件与暂存代码质量仍是独立 Capability。
- 保留 `lint-staged` 暂存隔离、文件快照、部分暂存和失败恢复以及 Hook 的 0/1 外部语义；修正 Prettier 3 配置文件搜索锚点，确保只从消费仓库内开始查找项目配置。

## 0.19.0

- 新增不可变 `GateContext` 与 `ChangeSet`，manual CLI、CI policy/full 和 pre-push 通过同一通用 orchestrator 执行，统一处理逐 gate 超时、上游取消、失败短路、结果聚合和最终退出码。
- CI 的保护文件、测试策略、单元测试和变更行覆盖率复用同一 Git 变更事实；pre-push 保持既定顺序与精确推送快照约束，并迁移为支持超时/取消的异步编排。
- 本次架构重构删除 `GateResult.legacyExitCode`、旧退出码保留选项、同步编排入口及兼容 CI 步骤退出语义；尚未原生化的数字 runner 只在组合边界转换为统一 `GateResult`。

## 0.18.0

- 建立全平台静态 Gate Registry，集中声明稳定 ID、配置键、生命周期、允许的副作用、超时、所需工具/项目脚本、artifact、manual command 和依赖关系；启动时拒绝重复 ID/配置键/命令、未知关系、排序环路和未声明的副作用降级。
- 新增不可变的 pre-commit、pre-push、CI policy 与 CI full Execution Plan；项目配置只能启停允许配置的能力，不能改变受审顺序，pre-commit 的 Stylelint fix、ESLint fix、Prettier、只读验证和保护文件顺序保持不变。
- manual CLI 帮助、命令发现、参数白名单与项目脚本从 Registry 派生；CI、pre-push 和 staged quality 按 Execution Plan 遍历，原生只读 gate 的 manual/CI 路径统一执行异步 setup、plan 和 run，旧 runner 继续通过组合层适配。

## 0.17.0

- 完成首个 Gate Capability 纵向试点：动态代码门禁注册为只读 `security.dynamic-code`，统一声明 manual、pre-commit、CI 生命周期、规则、超时、配置版本与 setup 诊断。
- 动态代码扫描器迁入 `src/gates/security` 并原生返回结构化 finding、metric 和诊断；文件范围由编排层显式提供，console renderer 在 Registry 组合边界挂接，CLI、pre-commit、CI 与 doctor 从同一能力目录取得能力，旧包根 API 通过兼容导出继续可用。
- CI 的动态代码步骤在保留既有 `name/status/exitCode/durationMs` 和控制台文案的同时附带版本化 `gateResult`，供新消费者读取稳定规则位置、证据、修复建议和指标。

## 0.16.0

- 新增内部统一门禁结果模型，稳定区分通过、跳过、策略违规、配置错误、执行错误和范围错误，并统一表示 finding、artifact、metric、诊断与标准退出码。
- 新增旧 runner 兼容适配层以及 console、版本化 JSON renderer；CI 步骤聚合已使用同一个 `GateResult` 生成现有控制台输出和兼容 JSON，保持原有命令文案、步骤结构及退出码。
- 新平台模块从 `src/core/result` 与 `src/core/report` 进入目标目录，语法检查同步改为递归覆盖 `src`；本版本只实施架构阶段 1，不提前引入 Registry、Execution Plan 或具体门禁迁移。

## 0.15.0

- 新增平台无关的 `repo-guard ci` 只读远程门禁，支持 GitLab MR/分支 SHA、`policy`/`full` profile、全仓硬规则、变更测试策略、保护文件 report/fail 和始终落盘的 JSON 报告。
- 新增 `repo-guard install-ci --provider gitlab`，生成受管理的本地 GitLab CI 模板；简单现有流水线通过 `include + extends` 幂等接入，复杂 include 或 stage 冲突时保留根 CI 并输出人工审查片段。
- 新增 `repo-guard doctor --ci`，CI 环境不要求本地 Hook 或企业微信密钥，并验证模板、根 include、非手动/非 allow_failure Job 与 Node.js 22.23.2；配置、Schema、公共 API、项目脚本和文档同步更新。

## 0.14.0

- 将最低运行环境从 Node.js 18.12.0 提升到 Node.js 22.23.2，并同步包元数据、锁文件、README、配置 Schema 与架构文档。
- `doctor` 现在直接读取 `package.json` 的 `engines.node` 并进行完整主、次、补丁版本比较，避免运行时诊断与发布元数据不一致。

## 0.13.3

- 新增 `preCommit.stylelint.governance` 样式治理增强，强制执行 `selector-max-specificity`、`selector-max-id` 和 `declaration-no-important`；默认最大权重为 `0,3,0`、禁止 ID 选择器和 `!important`。
- 新增非预期全局样式检查：Vue 组件样式必须使用 `scoped/module` 且不得通过 `:global()` 逃逸，普通样式文件必须位于明确白名单或采用 CSS Modules。
- 新增 `repo-guard style-governance`、CLI 开关、doctor、Schema、精确结构化例外及面向 AI 的修复指令。规则不可被项目配置、ignore 或 disable 注释关闭；已有项目迁移后默认关闭。

## 0.13.2

- 新增 `unitTest.componentInteraction` Vue 组件交互测试语义门禁，复用现有测试映射、变更范围、Vitest 脚本和覆盖率流程，不重复执行测试。
- 对范围内含 `v-on/@事件` 或 `v-model` 的组件，要求同一正常用例直接导入组件、使用 Vue Test Utils `mount`、触发 wrapper 交互并在其后断言可见结果、emit、路由、Store 或 Mock 调用。
- 拒绝仅检查组件定义、`wrapper.exists()`、无异常挂载、快照或交互前状态等弱测试；新增配置迁移、Schema、doctor 和面向 AI 的逐项补全指令。已有项目迁移后默认关闭。

## 0.13.1

- 新增始终启用的动态代码执行安全门禁，覆盖 JavaScript、TypeScript、JSX、TSX 和 Vue `<script>` 中的 `eval` 与 `Function` 构造器。
- 识别直接、间接、全局对象、可选链、方括号访问和简单别名获取，同时跳过注释、普通字符串、正则、模板文本与 Vue 非脚本区域。
- 新增 `repo-guard dynamic-code`、`guard:dynamic-code`、doctor 诊断、结构化例外规则和可直接交给 AI 的风险说明、替代方案与验证要求。

## 0.13.0

- 新增 `accessibilityTest` axe 组件/E2E 可访问性测试门禁，支持 vitest-axe、jest-axe、@axe-core/playwright、cypress-axe 和 axe-core。
- 静态要求每个匹配文件包含真实测试用例、axe 扫描和零违规断言，并拒绝禁用或筛选规则、排除节点、影响级别过滤、空脚本和 skip/only/todo 绕过。
- 新增 `repo-guard accessibility-test`、pre-push 编排、项目能力检测、doctor 诊断修复、受管理 AGENTS.md AI 规范和配置 Schema；已有项目迁移后保持关闭。

## 0.12.14

- 新增始终启用的 Vue 原生图片 alt 门禁，要求内容图片提供可静态验证且符合用途的替代文本，纯装饰图片同时使用空 alt 与静态 none/presentation 角色。
- 拒绝缺失或不可证明的动态 alt、未明确装饰语义的空 alt、冲突装饰角色、泛化占位词、图片文件名、重复语义属性和可能覆盖语义的对象批量绑定。
- 新增 `repo-guard image-alt`、`guard:image-alt`、doctor 诊断、统一 AI 修复报告和 `vue/img-alt` 精确结构化例外。

## 0.12.13

- 新增始终启用的 Vue 原生表单控件 label 门禁，覆盖 `input`、`select` 和 `textarea`。
- 接受静态 `for/id`、外层 `label`、非空 `aria-label` 及指向模板现有 id 的 `aria-labelledby`；拒绝 `placeholder`、`title`、空值和不可证明的动态绑定。
- 新增 `repo-guard form-labels`、`guard:form-labels`、doctor 诊断、统一 AI 修复报告和 `vue/form-control-label` 精确结构化例外。
- 在 `PUBLISHING.md` 与仓库 `AGENTS.md` 中固化发布版本规则：小型兼容功能升补丁版本，大型门禁或工作流升次版本，不兼容变更先审查主版本及迁移方案。

## 0.12.12

- 新增 `preCommit.stylelint.complexity` 配置和 `repo-guard style-complexity` 全项目命令，默认限制复合选择器段数与样式嵌套深度为 3。
- Stylelint 就绪的新项目默认启用复杂度规则；已有配置迁移后保持关闭，`enable styleComplexity` 会同步启用 Stylelint。
- 复杂度规则复用业务项目的 Vue/SCSS/Less 自定义语法，但不能被同名项目规则、override、ignore 或源码 disable 注释关闭。
- 新增 `style/*` 精确结构化例外和针对选择器拆分、语义化 class、降低嵌套的统一 AI 修复指令。

## 0.12.11

- 新增 `dependencyPolicy` 配置、`repo-guard dependencies` 显式命令和可开关的 `pre-commit` 依赖治理；新项目默认开启，已有配置迁移后保持关闭。
- 默认要求非 peer 依赖使用精确版本，限制 Git、HTTP、GitHub shorthand 和本地路径等未批准来源，并检查非 peer 分组重复及项目禁用包。
- 要求 npm lockfile v2+，逐项校验根依赖声明；暂存门禁读取 Git index，覆盖部分暂存和只删除锁文件的场景。
- 所有发现支持精确结构化例外，并输出禁止关闭门禁、扩大来源或伪造锁文件的独立 AI 修复指令。

## 0.12.10

- 依赖架构门禁失败时，为每条 error 违规输出可独立复制给 AI 的完整中文修复指令，包含项目根目录、规则、依赖关系、循环链路、修复建议、修改范围和验证命令。
- AI 指令明确禁止关闭、删除、降级或忽略规则，以及缩小扫描范围、扩大排除和伪造 dependency-cruiser 结果。
- 兼容 dependency-cruiser 17/18 的对象循环链路格式，不再把循环模块显示为 `[object Object]`。

## 0.12.9

- 修复 dependency-cruiser 16、17 和 18 仅通过 ESM `import` 条件导出入口时被误报为未安装的问题。
- 依赖架构门禁现在直接解析项目本地包元数据与 CLI，不再要求 dependency-cruiser 提供 CommonJS `require` 入口。
- 增加 ESM-only dependency-cruiser 安装形态的架构门禁和 doctor 回归测试。

## 0.12.8

- 新增始终启用的 Vue `target="_blank"` 安全门禁，要求同一标签具有可静态验证的 `rel="noopener noreferrer"`，并拒绝冲突的 `opener` token。
- 支持静态属性以及简单的 `:target="'_blank'"`、`v-bind:target` 和字面量 `:rel`，动态 `rel` 不会被错误判定为安全。
- 新增 `repo-guard target-blank` 与 `guard:target-blank` 全项目检查，输出缺失 token、精确位置和统一 AI 修复指令。
- 新增 `vue/target-blank-security` 精确结构化例外，并报告批准例外的 ID 和到期日。
- 将 Vue SFC 模板扫描提取为复用模块，`v-html` 与链接安全规则共享相同的标签、属性和位置解析。

## 0.12.7

- 新增始终启用的 Vue `v-html` 安全门禁，检查暂存 `.vue` 文件的根模板区域，不依赖业务项目 ESLint 配置或可选开关。
- 新增 `repo-guard unsafe-html` 与 `guard:unsafe-html` 全项目检查，统一输出精确文件、行、列和可交给 AI 的修复要求。
- `v-html` 仅在精确命中当前有效的 `vue/no-v-html` 结构化例外时放行，并报告例外 ID 与到期日。
- 扫描器忽略脚本、HTML 注释和模板插值字符串，支持嵌套 `<template>` 与跨行属性。
- `doctor` 现在明确报告硬性 Vue 安全门禁状态。

## 0.12.6

- 新增通用 `exceptions` 结构化例外登记表，要求唯一 ID、命名空间规则、精确文件与行列、原因、责任人、独立审批人、工单和日期。
- 默认最长有效期 90 天、提前 14 天预警；过期和未来日期条目会阻断普通 repo-guard 命令。
- 新增只读 `repo-guard exceptions` 统一报告和 `guard:exceptions` 项目脚本，不提供自动新增或延期能力。
- 新增精确位置例外匹配 API，供后续不安全 HTML、链接安全、依赖和样式规则复用。
- `init` 与 `doctor --fix` 增量维护 `AGENTS.md` 结构化例外硬性要求，禁止 AI 通过新增、延期或篡改审批信息绕过。

## 0.12.5

- 新增基于业务项目本地 dependency-cruiser 的依赖架构门禁，由 repo-guard 统一生成配置、执行和解析 JSON 报告。
- 默认阻止循环依赖、无法解析的导入和生产代码反向导入测试代码；支持自定义 `sourcePaths`、`tsConfig`、排除正则及 `from`/`to` 规则。
- 新增 `repo-guard architecture`、`enable/disable architecture`、pre-push 编排、doctor 诊断和 `guard:architecture` 项目脚本。
- 启用时增量维护 `AGENTS.md` 架构硬性要求，明确禁止降低规则、缩小扫描范围或扩大排除项绕过。
- 旧配置迁移后架构门禁保持关闭；新项目仅在 dependency-cruiser 和源码路径均可用时自动开启。

## 0.12.4

- 新增结构化 `unitTest.coverage` 门禁，强制 Vitest 生成新鲜的 `coverage-summary.json` 和 `lcov.info`，统一报告并阻断全局行、语句、函数和分支覆盖率不足。
- 新增基于本次推送精确 Git diff 的变更行覆盖率，列出缺少 LCOV 数据的源码和未覆盖的 `file:line`；默认全局阈值为 80%，变更行阈值为 90%。
- 保留 `coverage: true/false` 兼容模式，已有项目不会因升级自动启用新阈值；结构化门禁会强制源码 include 和测试/生成路径 exclude，避免未导入源码逃逸。

## 0.12.3

- 新增可配置的 `unitTest.mappings`，使用 `{dir}`、`{name}`、`{path}` 和 `{ext}` 将源码映射到多个候选测试路径。
- 默认支持 JS、MJS、CJS、JSX、TS、MTS、CTS、TSX 和 Vue 源码，以及 `.spec`、`.test`、同目录和 `__tests__` 测试布局。
- 映射按顺序采用第一条命中规则，任一候选文件包含有效测试即可通过；缺失测试提示会列出建议路径和全部允许位置。

## 0.12.2

- 新增项目自有 npm 脚本驱动的独立生产构建门禁，支持 `repo-guard build` 显式执行和受管理 `pre-push` 自动阻断。
- 新项目存在 `build` 脚本时自动开启；已有配置迁移后保持关闭，并可通过 `repo-guard enable build` 渐进启用。
- 增加脚本存在性、超时配置、doctor 诊断和面向 AI 的失败修复要求；独立构建与 Lighthouse 使用同一脚本时只构建一次。

## 0.12.1

- 新增项目自有 npm 脚本驱动的 TypeScript 类型检查门禁，支持 `repo-guard typecheck` 显式执行和受管理 `pre-push` 自动阻断。
- 新项目存在 `typecheck` 脚本时自动开启；已有配置迁移后保持关闭，并可通过 `repo-guard enable typeCheck` 渐进启用。
- 增加脚本存在性、超时配置、doctor 诊断和面向 AI 的失败修复要求；类型检查不进入 pre-commit，也不内置 TypeScript 工具链。

## 0.12.0

- 新增默认开启的可配置文件归位门禁，内置资源文件统一进入 assets 目录、Markdown 文档统一进入 docs 等目录的规则。
- 默认 `newFiles` 模式只拦截新增、复制和重命名后的错位文件，避免升级后因历史文件普通修改而突然阻断提交；也可切换为 `changedFiles` 严格治理存量文件。
- 失败时为每个错位文件输出可直接交给 AI 的移动、引用更新和验证指令，并支持项目自定义文件类型、允许目录、例外和建议目录。
- 新增 `repo-guard file-placement` / `npm run guard:file-placement` 全项目专项检查，覆盖已跟踪和未忽略的未跟踪文件。

## 0.11.0

- 让自动 `pre-push` 从待推送提交读取配置，并在质量门禁启用时要求单一的当前 `HEAD` 和干净工作区，确保 Vitest、构建与 Lighthouse 验证的就是实际推送内容。
- 保留多个待推送提交中同路径的独立变更记录，并对无法安全验证的多提交推送给出拆分提示。
- 单元测试静态检查忽略注释和字面量，拒绝 `.skipIf/.todo`，并支持 `.mjs/.cjs/.jsx` 源码映射。
- 加强托管 Hook 标记识别、人工文本保留、Git Remote 凭据脱敏和 Stylelint 无效选项诊断。

## 0.10.0

- 增加面向纯 JavaScript/Vue 项目的可配置 Vitest 单元测试门禁，在 `pre-push` 中先于 Lighthouse 自动执行。
- 默认以本次推送的精确 Git 范围检查新增目标源码是否存在同目录 `.spec.js`，支持切换为检查所有变更源码，并可配置源码、测试和排除 glob。
- 拒绝没有 `it/test` 用例的空测试，以及本次变更测试文件中的 `describe/it/test.skip` 和 `.only`；失败时输出可直接交给 AI 的中文修复指令。
- 启用单元测试时增量维护根目录 `AGENTS.md` 的受管理测试规范，保留已有人工内容，并由 `doctor` 验证和修复。
- 增加测试脚本、超时和覆盖率开关；测试框架、Vue Test Utils、运行环境、Mock 和覆盖率阈值继续由业务项目控制。
- 托管 Hook 升级为 v4，继续识别并升级 v1、v2、v3 Hook。

## 0.9.0

- 增加可配置的最终暂存文件物理行数门禁，默认限制 Vue 文件 700 行、JS/JSX/TS/TSX 文件 1000 行。
- 行数检查在 Stylelint/ESLint 最终复检之后运行，并通过 `lint-staged` 正确隔离部分暂存文件的未暂存内容。
- 新项目默认启用行数门禁；已有配置迁移时保持关闭，可通过 `repo-guard enable maxFileLines` 开启。
- 支持按仓库相对 glob 配置多条限制和排除生成文件，超限时为每个文件输出可单独复制给 AI 的完整重构指令。
- 增加默认 85% 的非阻断预警，以及允许存量超限文件持平或缩短的 `noRegression` 渐进治理模式。
- Vue 超限提示增加 `template`、`script`、`style` 有效内容行数和最大区域的针对性拆分建议。
- 增加由 `preCommit.eslint.preset` 开关控制的 AI 可维护性规则基线，不需要项目手动导入 repo-guard 配置。
- ESLint 基线通过 `baseConfig` 使用业务项目安装的 `@eslint/js`，并按安装情况自动加入 `eslint-plugin-vue` 和 `typescript-eslint`；项目原有 Flat Config 后加载并可覆盖基线。
- 新项目默认开启 ESLint 基线；已有配置迁移保持关闭。自动基线要求 ESLint `>=9.19`，`doctor` 会检查版本和依赖。
- ESLint 基线不启用类型感知检查，避免在 pre-commit 中引入 TypeScript 类型检查。

## 0.8.0

- 增加仅面向 Vue 项目的 `repo-guard lighthouse`，使用业务项目本地 `@lhci/cli` 和 `lighthouserc.*`。
- Lighthouse 执行项目 npm 构建脚本后依次运行 `collect` 和 `assert`，支持 `--skip-build`。
- 增加默认关闭的 Lighthouse `pre-push` 门禁、环境诊断和 `.lighthouseci/` 忽略维护。
- 托管 Hook 升级为 v3，兼容识别和升级 v1、v2 Hook。

## 0.7.0

- 增加使用业务项目本地安装和配置的暂存文件 Stylelint 自动修复门禁。
- 固定质量流水线为 Stylelint 修复、ESLint 修复、Prettier、Stylelint 复检、ESLint 复检。
- Stylelint 修复失败或后续门禁失败时恢复整个质量流水线修改，并保留部分暂存文件的未暂存内容。
- `init` 仅在本地 Stylelint 和项目配置都存在时自动启用，不安装依赖、不生成规则、不探测语言组合。
- 同一个 Vue 文件混用多种 `<style lang>` 时直接阻止提交；未修复问题输出编号式中文 AI 修复指令。
- 增加可选 peer dependency `stylelint >=16 <18`，Node.js 最低版本保持 `18.12.0`。

## 0.6.0

- 增加默认开启的项目级 `notification.enabled` 企业微信通知开关。
- 增加 `repo-guard enable notification` 和 `repo-guard disable notification`。
- 通知关闭后仍识别并记录受保护文件，但不校验通知参数、不发送请求且不阻止提交。
- ESLint 无法修复时，为每个问题生成带编号、可单独复制给 AI 的中文修复指令。
- 修复指令包含相对路径、行列、规则、原始错误和禁止绕过规则的约束。

## 0.5.0

- 新项目执行 `init` 时默认启用 ESLint 修复、Prettier 格式化和 9 条通知级保护规则。
- 增加幂等的 `repo-guard migrate`，补齐缺失配置但保留项目规则和显式设置。
- 增加 `repo-guard enable eslint prettier`，显式快速启用暂存质量门禁。
- 增加 `repo-guard doctor --fix`，修复托管 Hook、项目脚本和受管理仓库文件。
- 安装器写入前预检全部 Hook，遇到自定义 Hook 时不再产生部分升级。
- 初始化和修复时增加 `guard:migrate`、`guard:enable-quality` 项目脚本。
- 配置仍使用 `version: 1`，升级包不会使旧项目配置失效。

## 0.4.0

- 增加可配置的暂存文件 Prettier 自动格式化和只检查门禁。
- 统一编排 ESLint 修复、Prettier 格式化和 ESLint 最终复检。
- 使用业务项目本地的 Prettier 3、项目格式规则和忽略文件。
- 增加质量流水线级文件快照，任一步失败时恢复全部修改。
- `doctor` 增加 Prettier 版本和项目配置检查。
- 保持 v1 配置向后兼容，未显式启用 Prettier 的项目行为不变。

## 0.3.0

- 增加可配置的暂存文件 ESLint 自动修复门禁。
- 使用 `lint-staged` 隔离部分暂存文件中的未暂存内容。
- 修复后复检，再执行保护文件识别、指纹和企业微信通知。
- 增加项目本地 ESLint 解析和忽略文件识别。
- Hook 升级为 v2，并兼容自动迁移 v1 托管 Hook。
- `doctor` 增加 ESLint 配置和过期 Hook 检查。
- 不包含 TypeScript 类型检查。

## 0.2.0

- 增加本地 `.env.config` 通知配置模板和泄漏保护。
- 初始化时增量维护 `.gitignore`。

## 0.1.0

- 提供受保护文件规则、企业微信通知、暂存指纹和 Git Hook 安装。
- CI JSON 输出限制在未跟踪、非符号链接的 `reports/**/*.json`，避免报告参数覆盖业务文件。
- GitLab 自动集成采用保守 YAML 识别，并对托管模板和根 Job 执行完整防篡改诊断。
