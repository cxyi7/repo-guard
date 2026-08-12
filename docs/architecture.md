# 架构说明

## Vue target=_blank 安全门禁

`vue-template-parser` 统一解析 Vue SFC 根模板的标签、属性和值位置，供 `v-html` 和链接安全规则复用。`vue-target-blank` 识别静态 `_blank` 以及可解析为 `_blank` 的简单 `v-bind:target` 字面量，并要求同一标签的静态或绑定字面量 `rel` 同时包含 `noopener`、`noreferrer`；动态 `rel` 无法证明安全，因此阻止提交。

每个问题以 `target` 属性名的精确行列和固定规则 ID `vue/target-blank-security` 匹配结构化例外。暂存门禁在 `v-html` 检查之后运行，全项目命令为 `repo-guard target-blank`，报告会区分缺失 token 与动态 `rel`。

## Vue v-html 安全门禁

`vue-unsafe-html` 直接扫描 Vue SFC 的根 `<template>`，跳过顶层脚本、自定义块、HTML 注释和模板插值字符串，并记录 `v-html` 属性名的精确行列。它不依赖业务项目是否安装 ESLint 或 `eslint-plugin-vue`，也没有关闭开关；暂存检查由 `quality-runner` 在格式化和只读 lint 复检之后执行，全项目检查由 `repo-guard unsafe-html` 执行。

每个发现使用固定规则 ID `vue/no-v-html` 调用结构化例外登记表。只有规则、路径、行、列和有效期全部匹配才会放行；报告同时列出批准例外的 ID 和到期日，未经批准的发现输出独立 AI 修复指令并阻止提交。

## 结构化例外

`exception-registry` 将配置中的精确位置登记项分类为 active、expiring、expired 或 future，并为其他规则提供统一匹配 API。只有规则 ID、仓库相对路径、行和列全部一致且当前有效的条目才能豁免发现；过期和未来日期条目在配置加载阶段阻断普通命令。

`exception-policy` 维护 `AGENTS.md` 的禁止绕过要求；`repo-guard exceptions` 只读取和报告，不提供自动创建、续期或扩大范围的写操作。配置文件继续由保护规则和既有通知流程审计。

## 依赖架构门禁

业务项目提供兼容自身 Node.js 版本的 dependency-cruiser；repo-guard 的 `architecture-runner` 读取 `repo-guard.config.json`，在系统临时目录生成一次性 dependency-cruiser JSON 配置，以 `json` reporter 执行完整依赖图检查，然后统一输出 error/warn 统计和逐项依赖路径。临时配置在成功或失败后都会清理。

`architecture-policy` 将实际启用的规则和禁止绕过方式写入 `AGENTS.md` 受管理区块。`pre-push` 的顺序为 TypeScript、单元测试与覆盖率、依赖架构、独立构建、Lighthouse；架构门禁不进入只处理暂存文件的 `pre-commit`。

## 依赖声明治理

`dependency-policy` 静态解析根 `package.json` 和 npm lockfile v2+，检查非 peer 精确版本、批准来源、非 peer 分组唯一、根锁声明同步和项目禁用包。它不依赖业务项目额外安装工具；`repo-guard dependencies` 执行全项目审计，启用后的 `pre-commit` 只在根清单或锁文件变化时执行。

暂存门禁在 lint-staged 完成格式化、只读复检、单文件行数和文件归位检查，并将结果写回 index 后运行。`runStagedDependencyPolicy` 从 Git index 读取清单和锁文件并写入系统临时目录分析，确保部分暂存和删除场景使用实际提交内容；临时目录始终清理。依赖治理通过后才进入保护文件门禁。违规使用 `dependencies/*` 精确结构化例外，失败报告包含可独立交给 AI 的修复与验证指令。

## 职责边界

```text
业务项目
├─ repo-guard.config.json       项目级保护和质量门禁开关
├─ Stylelint/ESLint/Prettier + 项目配置   样式、代码及格式规则
├─ tsc/vue-tsc + typecheck npm 脚本       全项目 TypeScript 类型检查
├─ 项目 build npm 脚本                    独立生产构建
├─ Vitest + *.spec/*.test                 JS/TS/Vue 单元测试和项目断言
├─ @lhci/cli + lighthouserc.*             Vue 页面运行质量规则
└─ @cxyi7/repo-guard
   ├─ config management        配置迁移和功能开关
   ├─ lint-staged              暂存内容隔离、写回和失败恢复
   ├─ stylelint-runner         样式检查、修复、复检
   ├─ style complexity        强制选择器复合段与样式嵌套深度
   ├─ stylelint-diagnostics    编号化 AI 修复指令
   ├─ eslint-runner            检查、修复、复检
   ├─ eslint-diagnostics       编号化 AI 修复指令
   ├─ eslint-config            由 JSON 开关控制的 AI 可维护性基础规则
   ├─ prettier-runner          检查、格式化
   ├─ max-file-lines          行数预警、Vue 区域分析和 strict/noRegression 门禁
   ├─ build-runner            项目生产构建脚本验证和执行
   ├─ typecheck-runner        项目 TypeScript 脚本验证和执行
   ├─ unit-test-policy        受管理的 AGENTS.md AI 测试规范
   ├─ unit-test-runner        缺失测试/绕过检查和 Vitest 执行
   ├─ coverage-runner         全局覆盖率、Git 变更行覆盖率和统一报告
   ├─ dependency-policy       依赖版本、来源、分组、禁用包和 npm 锁文件治理
   ├─ pre-push-changes        精确计算本次推送的 Git 变更范围
   ├─ lighthouse-runner       Vue 构建、LHCI 收集和断言
   ├─ protected-file gate      规则、指纹和通知
   └─ hook installer           Hook 生命周期
```

repo-guard 负责流程编排，不替换业务项目的 Stylelint、ESLint、Prettier、TypeScript、Vitest 或
Lighthouse 安装。项目负责选择版本、插件、解析器、测试环境、Mock、页面、断言和忽略范围。
`preCommit.eslint.preset` 开启时，`eslint-runner` 从业务项目加载 `@eslint/js`，并
按已安装情况加载 `eslint-plugin-vue` 和 `typescript-eslint`，然后通过 ESLint
`baseConfig` 注入 repo-guard 规则。项目的 `eslint.config.*` 随后正常加载，因此
项目同名规则、忽略范围和 `eslint-config-prettier` 拥有最终优先级。Lighthouse
仅运行 `collect` 和 `assert`，不会隐式上传报告。

Stylelint 复杂度采用独立的只读检查通道：先解析业务项目针对每个文件的配置以取得 `customSyntax`，
再只注入 repo-guard 拥有的 `selector-max-compound-selectors` 与 `max-nesting-depth`。该通道直接读取
暂存隔离后的文件内容，不使用项目 ignore 或 disable 注释；普通 Stylelint 修复和复检仍使用完整项目配置。
两路结果合并后统一应用结构化例外并生成 AI 修复指令。

## Pre-commit 状态流

```text
开始
  ↓
读取并校验项目配置
  ↓
质量门禁均未启用 ──────────────────────────┐
  ↓ 任一启用                               │
lint-staged 备份 Git 状态                   │
  ↓                                        │
隐藏部分暂存文件的未暂存内容                │
  ↓                                        │
Stylelint 修复 → ESLint 修复 → Prettier → Stylelint 复检 → ESLint 复检
  ↓
最终暂存文件物理行数检查
  ↓ 成功                                   │
写回暂存区并恢复未暂存内容                  │
  └────────────────────────────────────────┘
  ↓
保护文件门禁
  ↓
通知关闭 ────────────────┐
  ↓ 通知开启             │
notify 规则发送企业微信  │
  └──────────────────────┘
  ↓
提交继续
```

任一 Stylelint/ESLint/Prettier 配置错误、运行错误、最终规则错误或文件行数超限都会返回非零退出码。
lint-staged 负责恢复备份，保护文件门禁不会在失败状态下运行。

行数门禁在隔离后的最终暂存文件上统计物理行数。`strict` 直接执行阈值；`noRegression`
只在当前文件超限时读取 `HEAD` 基线，允许存量文件持平或缩短，并对新增文件保持严格限制。
达到 `warnAt` 的文件只输出预警。Vue 文件额外分析 `template`、`script`、`style` 有效内容，
用于生成更具体、可直接交给 AI 的拆分指令。

ESLint 无法自动修复时，`eslint-diagnostics` 从结构化结果中提取项目相对路径、
行列、规则和原始错误。每个问题生成一段带编号、可独立复制给 AI 的完整指令，
不输出源代码内容，也不建议关闭规则或扩大忽略范围。

## Pre-push TypeScript、单元测试、构建与 Lighthouse 状态流

```text
git push
  ↓
读取 pre-push stdin，计算每个 ref 的实际提交范围
  ↓
TypeScript 未启用 ────────────────────────┐
  ↓ 已启用                               │
npm run typecheck                        │
  └──────────────────────────────────────┘
  ↓
单元测试未启用 ───────────────────────────┐
  ↓ 已启用                               │
按映射检查新建/变更源码的候选测试           │
  ↓                                      │
扫描本次变更测试中的 .skip/.only           │
  ↓                                      │
npm run test:unit                         │
  ↓ 结构化 coverage 已启用               │
解析新生成的 json-summary/lcov            │
  ↓                                      │
检查全局四项和精确 Git 变更行覆盖率         │
  └──────────────────────────────────────┘
  ↓
独立构建未启用 ───────────────────────────┐
  ↓ 已启用                               │
npm run build                            │
  └──────────────────────────────────────┘
  ↓
Lighthouse 未启用 → 推送继续
  ↓ 已启用
验证 Vue、@lhci/cli、lighthouserc 和 build 脚本
  ↓
npm run build → lhci collect → lhci assert
  ├─ 成功 → 推送继续
  └─ 任一门禁失败 → 阻止推送
```

已有远端 ref 使用 `remoteSha..localSha`，新分支优先以远端默认分支或 `main/master` 的
merge-base 为基线；因此不会把仓库所有历史文件误判为本次新增。默认策略只强制新增/复制
的目标源码有测试，但始终运行完整测试套件。`changedFiles` 可将静态要求提升至所有变更源码。
启用测试时，初始化和修复流程维护 `AGENTS.md` 中带版本标记边界的测试规范，保留其余人工内容。

Vue Router 页面由业务项目在 `lighthouserc.*` 中显式配置。LHCI 的原始输出写入
`.lighthouseci/`，安装器将其加入受管理的 `.gitignore` 区块。

## 配置维护状态流

```text
旧项目配置 → migrate 补齐缺失默认值 → enable/disable 修改功能 → doctor 验证
                                                       ↑
doctor --fix → 配置迁移 + 托管安装状态修复 ──────────────┘
```

新建配置默认启用 ESLint、Prettier、单文件行数门禁、企业微信通知和 9 条通知级保护规则；已有
`typecheck` 脚本时同时启用 TypeScript 门禁，已有 `build` 脚本时同时启用独立构建门禁；只有
本地 Stylelint 和项目配置均存在时才自动启用 Stylelint，只有 Vitest 与 `test:unit` 脚本均存在时
才自动启用单元测试并维护 AI 规范。通知关闭时
`notify` 规则仍参与保护文件识别和提交信息记录，但 gate 不读取凭据、不发送请求。
迁移只物化旧项目已有的默认行为，不主动开启质量门禁。`doctor --fix` 只修复
repo-guard 可安全拥有的内容；自定义 Hook、其他 hooksPath、已跟踪密钥和业务
依赖仍需人工处理。

## 兼容策略

- 配置格式继续使用 `version: 1`，新增字段均为可选。
- 新项目初始化默认启用 ESLint、repo-guard ESLint 规则基线、Prettier 和单文件行数门禁，并按已有 Stylelint 配置及 Vitest 测试环境决定是否启用对应门禁；已有配置升级时新规则基线、行数门禁和单元测试保持关闭。
- 行数门禁缺少 `mode` 和 `warnAt` 时分别使用 `strict` 和 `0.85`；默认覆盖 Vue、JS/JSX 和 TS/TSX 常见扩展名。
- 单元测试默认支持 JS/TS/Vue、`.spec/.test`、同目录和 `__tests__` 候选映射及 `newFiles` 渐进策略；项目可配置映射、目标源码、测试和排除 glob，或切换为 `changedFiles`。
- 结构化覆盖率默认关闭；启用后强制生成 `json-summary` 和 `lcov`，全局行/语句/函数/分支默认阈值为 80%，精确 Git 变更行默认阈值为 90%。旧布尔覆盖率配置保持只向 Vitest 追加参数的兼容行为。
- 缺少 `preCommit` 时按质量门禁未启用处理，保持旧版本行为。
- 缺少 `notification` 时按启用处理，保持旧版本的通知行为。
- Hook 生成版本为 v4，安装器可识别并升级 v1、v2、v3。
- Node.js 最低版本为 18.12.0，与 `lint-staged@15.5.2` 一致。
- Stylelint、ESLint、Prettier 和 Vitest 是可选 peer dependency；启用门禁时必须由业务项目安装。
- 自动 ESLint 基线要求业务项目提供 ESLint `>=9.19` 和 `@eslint/js`；`eslint-plugin-vue` 和 `typescript-eslint` 是按项目安装情况自动启用的可选 peer dependency。
- repo-guard ESLint 基线只启用无需类型信息的 TypeScript 规则；类型感知配置和 `tsc`/`vue-tsc` 留在项目独立 CI，不进入 pre-commit。
- `@lhci/cli` 是可选 peer dependency；Vue Lighthouse 启用时必须由业务项目安装并提供 Chrome。
- Stylelint 不内置规则或语言探测；同一个 Vue 文件出现多种 `<style lang>` 时会在执行前失败。
