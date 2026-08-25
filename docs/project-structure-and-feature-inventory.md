# repo-guard 项目结构与功能清单

## 1. 文档范围

本文说明 `@cxyi7/repo-guard` 当前代码结构、模块职责、生命周期和已经实现的功能，适用于版本 `1.19.0`。

当前最新功能分支具有递进关系：

```text
1.17.0 Commit 提交信息全生命周期门禁
  └─ 1.18.0 AGENTS.md 集中托管规范目录与同步门禁
       └─ 1.19.0 图片资源命名、重复、压缩与 WebP 转换治理
```

因此，`1.19.0` 已包含此前版本的全部能力。本文只描述当前有效实现，不把历史迁移过程或计划中的能力列为已完成功能。

## 2. 已完成功能总览

- [x] 项目初始化、配置迁移、托管 Git Hook 安装和环境诊断。
- [x] 将全部可配置功能、官方门禁和关键独立工作流集中投影为 7 组 `AGENTS.md` 托管规范，并通过原子同步、旧 marker 迁移和只读 CI 门禁保持一致。
- [x] 使用消费项目自身的 Stylelint、ESLint 和 Prettier，对暂存文件执行修复与只读复检。
- [x] 保留部分暂存文件中的未暂存内容，失败时恢复执行前状态。
- [x] 按 include、exclude 和扩展名白名单选择暂存文件，并按 Git 记录维护标准文件头。
- [x] 按 include、exclude 和扩展名白名单选择函数源文件，用 AST 同步暂存函数 JSDoc。
- [x] 按 AST 绑定和 Vue 生命周期匹配异步资源创建与释放，启用后以错误阻断无法证明安全的资源泄漏。
- [x] 在 `camelCase` 与 `kebab-case` 中选择项目唯一规范，统一检查指定范围内的全部已跟踪文件名和文件夹名。
- [x] 按项目范围治理图片命名、真实格式、精确/像素重复和压缩机会，并提供显式、安全且保留原图的 WebP 转换。
- [x] 动态代码执行安全检查，包括 `eval` 和 `Function` 构造器。
- [x] Vue `v-html`、`target="_blank"`、表单 label 和图片 alt 硬门禁。
- [x] 文件归位、单文件行数、依赖声明、依赖锁文件和依赖架构治理。
- [x] 使用消费项目 Knip 检查未使用文件、导出、依赖、缺失依赖与无效入口，并以不可扩张基线治理历史债务。
- [x] 使用同一 Conventional Commit 策略校验本地提交、推送区间、CI 和发布准备，并分生命周期治理临时提交与不兼容变更。
- [x] 指定代码只能出现在一个或多个允许文件中的代码位置门禁。
- [x] 保护文件 `audit`、`notify` 和不可变 `block` 三级策略。
- [x] Vitest 单元测试映射、空测试、跳过测试、聚焦测试和覆盖率门禁。
- [x] Stryker 10.x 变异测试、中文报告、构建前硬门槛与失败通知。
- [x] 复用消费项目 Axios 请求工厂的手动接口性能外部门禁，按延迟分位数和错误率生成中文报告。
- [x] 使用消费项目本机 k6 的手动并发压测外部门禁，按受控负载和阈值生成机器摘要与中文报告。
- [x] Vue 组件真实交互测试语义检查。
- [x] axe 组件与 E2E 可访问性测试门禁。
- [x] TypeScript、项目构建、dependency-cruiser 架构和 Lighthouse 独立门禁。
- [x] GitLab CI `policy`、`full` 和 `release-ready` 三种固定配置档。
- [x] 可选的 GitLab 应用交付托管标准，统一 Job、分支规则、依赖安装、缓存和发布触发语义，由消费项目通过固定 `ci:*` npm scripts 持有业务发布实现。
- [x] 受控外部门禁，可通过精确 npm script 接入项目自有测试。
- [x] 结构化例外、统一 `GateResult`、统一退出码、console/JSON 报告和中文修复指引。
- [x] 报告路径、artifact、敏感信息、符号链接和本地通知凭据安全检查。
- [x] 发布就绪检查，但不会自动执行 npm 发布或部署。
- [x] 采用 MIT 开源许可证，并明确以强制、可审计的工程门禁约束 AI 辅助开发。

## 3. 仓库目录结构

```text
repo/
├─ bin/                              CLI 启动器
├─ docs/                             使用说明与长期维护清单
│  ├─ usage-guide.md                 安装、配置、命令与门禁接入说明
│  └─ project-structure-and-feature-inventory.md  项目结构、职责与完整功能清单
├─ scripts/                          仓库自身的语法与中文文案检查脚本
├─ src/
│  ├─ config/                        配置默认值、加载、验证和路径匹配
│  ├─ core/                          稳定领域契约与无业务偏好的基础能力
│  │  ├─ capability/                 Gate、Registry、Execution Plan、GateContext
│  │  ├─ error/                      RepoGuardError 和错误分类
│  │  ├─ execution/                  文件快照、暂存文件、可取消进程和实时输出安全
│  │  ├─ policy/                     单区块与多区块受管理文本生命周期基础能力
│  │  ├─ project/                    Node、package 和项目文本事实
│  │  ├─ report/                     console 与 JSON renderer
│  │  └─ result/                     GateResult、finding、artifact 和退出码
│  ├─ gates/                         门禁决策、finding 和结果适配
│  │  ├─ accessibility/              Vue 可访问性门禁
│  │  ├─ quality/                    lint、格式化、异步资源、无效代码、类型、架构、构建、Lighthouse
│  │  ├─ release/                    发布就绪检查与 GitLab CI 结果通知交付
│  │  ├─ repository/                 AGENTS 同步、提交信息、依赖、路径/图片命名、文件位置、代码位置和保护文件策略
│  │  ├─ security/                   动态代码与 Vue 安全门禁
│  │  └─ testing/                    单元测试、覆盖率、变异测试、接口性能、axe 和外部门禁
│  ├─ git/                           Git 命令、提交信息、变更范围、二进制对象、revision/索引内容、已跟踪路径和仓库状态
│  ├─ integrations/                  消费项目工具和第三方协议适配
│  │  ├─ api-performance/            Axios 性能配置、场景执行、报告生命周期与中文报告
│  │  ├─ axe/                        axe 集成发现
│  │  ├─ dependency-cruiser/         依赖架构执行
│  │  ├─ eslint/                     ESLint 项目事实和执行
│  │  ├─ lighthouse/                 Lighthouse 项目事实和执行
│  │  ├─ k6/                         k6 配置、脚本校验、受控执行、摘要解析与中文报告
│  │  ├─ knip/                       Knip 项目解析、执行与 JSON 报告校验
│  │  ├─ images/                     消费项目 Sharp/SVGO 解析、压缩候选和像素事实
│  │  ├─ npm/                        npm script、包元数据和发布环境
│  │  ├─ prettier/                   Prettier 项目事实和执行
│  │  ├─ stylelint/                  Stylelint 项目事实和执行
│  │  ├─ stryker/                    Stryker 项目解析、执行、报告校验与中文报告
│  │  ├─ vitest/                     Vitest、覆盖率和测试源码事实
│  │  ├─ vue/                        Vue 模板、script、异步资源与交互事实
│  │  └─ wecom/                      企业微信发送适配
│  ├─ orchestration/                 CLI、Hook、CI、doctor 和初始化编排
│  │  ├─ ci/                         CI 范围、固定计划和报告持久化
│  │  ├─ cli/                        CLI 参数与命令路由
│  │  ├─ commit-message/             提交信息摘要准备、校验与定稿编排
│  │  ├─ doctor/                     项目准备状态诊断
│  │  ├─ pre-commit/                 暂存隔离、质量段和最终策略段
│  │  ├─ pre-push/                   精确推送范围与独立重型门禁
│  │  └─ setup/                      配置、Hook、CI 和受管理文件安装
│  └─ policies/                      纯策略判定、AGENTS 规范目录与渲染、CI 通知内容策略
├─ test/                             配置、行为、端到端和架构边界测试
├─ config.schema.json                项目配置 Schema
├─ api-performance-config.schema.json Axios 接口性能配置 Schema
├─ k6-load-config.schema.json          k6 接口压测配置 Schema
├─ external-report.schema.json       外部门禁报告 Schema
├─ gate-result.schema.json           统一 GateResult Schema
├─ LICENSE                           MIT 开源许可证
├─ package.json                      npm 包入口、依赖和维护脚本
└─ README.md                         项目定位、已完成功能与文档导航
```

### 3.1 依赖方向

项目使用 dependency-cruiser 以错误级规则固定以下边界：

- `core` 不依赖 `gates`、`orchestration` 或 `integrations`。
- `config` 不依赖 Git、policy、gate、integration 或 orchestration 运行域。
- `git` 只提供仓库事实，不依赖策略和运行编排。
- `policies` 可以消费稳定事实，但不能调用 gate 或 orchestration。
- `integrations` 只提供外部工具事实，不拥有策略决策和用户输出。
- `gates` 可以使用 core、config、Git、policy 和 integration，但不能依赖 orchestration 或 renderer。
- `orchestration` 只通过 Gate Registry 和 Execution Plan 调度能力，不直接调用具体 integration。
- 不同 gate 领域不能互相深层导入，组合统一放在 Registry 和 Execution Plan。
- 循环依赖和无法解析的本地导入均为错误。

这一结构将“事实获取、策略判断、结果表达、生命周期编排”分开，避免 CLI、Hook 和 CI 各自维护一套业务规则。

GitLab CI 内置通知沿用该方向：`policies/gitlab-ci-notification.js` 只判断受控的最终状态并生成经过清理和长度限制的中文内容；`gates/release/gitlab-ci-notification.js` 校验配置与受信 CI 环境，并通过企业微信 integration 完成唯一的外部写入；CLI 只调用该 release 能力，不直接依赖第三方发送适配。

文件头功能也遵守同一职责方向：`git/file-history.js` 只读取当前 Git 提交身份和文件首次新增记录；`policies/file-header.js` 只负责范围筛选、注释格式和内容重建；`orchestration/pre-commit/file-header-normalizer.js` 负责读取及写回暂存隔离环境中的文件，并由 `quality-runner.js` 在受保护质量计划之前调用。

函数文档功能将配置验证、纯策略和暂存写回继续分层：`config/function-doc-validation.js` 规范化范围与扩展名；`policies/function-documentation.js` 使用 Babel AST 判定函数签名、返回值和异常路径，不依赖 Git 或编排层；`orchestration/pre-commit/function-documentation-normalizer.js` 只负责在 `lint-staged` 隔离环境中读写 UTF-8 文件。

异步资源清理功能同样保持事实、决策和结果分离：`integrations/vue/async-resource-facts.js` 只解析脚本并提取资源创建、释放、绑定与生命周期事实；`policies/async-resource-cleanup.js` 负责范围选择、配对和违规判定；`gates/quality/vue-async-resource-cleanup-gate.js` 只适配统一 GateResult。该门禁只读，不自动改写业务代码。

路径命名功能由 `config/path-naming-validation.js` 验证项目唯一规范与作用范围，`git/tracked-paths.js` 只读取最终 Git 索引中的完整已跟踪路径事实，`policies/path-naming.js` 纯粹判断文件名和祖先文件夹名，`gates/repository/path-naming-gate.js` 负责环境适配和统一 GateResult。该门禁不自动重命名，也不按目录派生第二套规范。

图片资源治理继续分离 Git 二进制事实、第三方工具事实、纯策略和写入边界：`git/binary-content.js` 批量读取索引或 revision 中的 blob 标识与大小，`integrations/images/` 只解析消费项目的 Sharp/SVGO 并生成候选及像素事实，多帧资源同时保留和比较帧数、帧高、播放延迟及循环次数；`policies/image-assets.js` 负责范围、命名、真实格式、重复分组和收益阈值，增量重复分组优先保留未变更的存量资源，`canonicalRoots` 支持仓库内目录或 glob；`gates/repository/image-assets-gate.js` 形成只读 GateResult。显式优化由同领域 `image-assets-optimizer.js` 持有唯一文件写入边界，原格式安全替换保留权限并拒绝临时路径、备份路径和悬空链接碰撞；默认只预览，Hook 与 CI 永不写图片、删除资源或修改引用。

提交信息治理由 `config/commit-message-validation.js` 规范化类型、scope 和特殊提交生命周期；`policies/commit-message.js` 只负责 Conventional Commit、merge/revert、`fixup!`/`squash!` 与不兼容变更判定；`git/commit-messages.js` 只读取精确 revision 范围内的真实提交对象；`gates/repository/commit-message-gate.js` 形成统一中文 GateResult，并只在 release-ready 比较基准与当前 package major；`orchestration/commit-message/runner.js` 在本地自动文件摘要定稿前复用同一策略。pre-push 和 CI 会重新读取提交对象，因此跳过本地 Hook 不能绕过共享历史校验。

AGENTS 托管规范使用集中目录和单一写入边界：`policies/agent-policy-catalog.js` 声明 7 个分组以及功能、官方 Gate 和独立工作流的覆盖关系，并仅依据规范化配置和受控 package script 事实生成中文规则；`policies/agent-policies.js` 负责读取项目事实、识别四类旧 marker、构造当前区块和单次写入；`core/policy/managed-text-block.js` 在修改前统一校验全部 marker，并保留 marker 外的人工内容；`gates/repository/repository-policy-gates.js` 中的 `repository.agent-policy` 只读检查当前投影。初始化、功能启停、迁移、Doctor 修复和 CI 安装复用同一同步入口，Git Hook 不修改 `AGENTS.md`。

后续能力扩展必须同时维护托管规范覆盖关系：新增可配置功能时在目录项的 `features` 中登记配置功能名，新增官方 Gate 时在 `gates` 中登记 Gate ID；两类清单都与现有 Registry/配置功能表做精确集合测试，遗漏或残留登记都会失败。无独立配置键、也不注册官方 Gate 的工作流使用稳定 `capabilities` 标识，并同步更新明确枚举的契约测试。新规则优先并入现有 7 个职责分组；只有职责确实独立时才新增 marker，重命名 marker 时必须把旧 marker 加入迁移清单。任何扩展都必须继续满足确定性渲染、敏感值排除、marker 外人工内容保留、一次写入和只读 CI 校验。

变异测试继续遵循配置、第三方适配、门禁决策、通知策略和 CLI 编排分层：`config/mutation-test-validation.js` 规范化 Stryker 与受保护构建设置；`integrations/stryker/` 只解析消费项目的 `@stryker-mutator/core`、执行 Stryker、校验报告并生成中文 HTML；`gates/testing/mutation-test-gate.js` 依据报告和进程事实产生统一 GateResult；`policies/mutation-test-notification.js` 只生成不含源码片段的企业微信内容；`gates/release/mutation-test-notification.js` 持有唯一的企业微信发送适配；`orchestration/cli/guarded-build.js` 负责先测后构建和通知时机。原始构建仍由既有 npm build integration 执行。

Axios 接口性能功能保持为项目外部门禁辅助能力：`integrations/api-performance/` 验证项目配置与精确测试目标、调用消费项目提供的客户端工厂、执行低并发场景、维护未跟踪报告并渲染中文 HTML；`gates/testing/api-performance-external-runner.js` 只根据 p95、p99 和错误率形成 `repo-guard-json-v1` 决策；`orchestration/cli/api-performance-runner.js` 只解析项目外部门禁并强制 manual-only 与非自动化环境。该能力不注册到静态 Registry，不新增官方 Gate，也不进入任何固定 Execution Plan。

k6 接口压测能力遵守相同的外部门禁边界：`integrations/k6/` 负责纯 JSON 配置、目标确认、AST 脚本限制、本机 k6 进程、机器摘要和中文 HTML；`gates/testing/k6-external-runner.js` 负责阈值 findings 与外部门禁报告；`orchestration/cli/k6-runner.js` 负责 manual-only 外部门禁解析和自动化环境拒绝。受控入口拥有 `options` 与 `handleSummary`，消费者只持有业务场景；该能力不注册静态 Registry、不新增官方 Gate，也不进入任何固定 Execution Plan。

无效代码治理继续分离工具事实、历史债务策略、门禁决策和人工维护命令：`integrations/knip/` 只解析消费项目安装的 Knip 6.x、执行 CLI 并校验 JSON，其中 repo-guard 的统一 `dependencies` 策略类型会显式映射 Knip 的普通依赖、开发依赖和可选 peer 依赖；Knip 自定义 reporter 是共享控制台渲染边界之外唯一允许直接写 stdout 的窄适配器，只输出带固定标记的配置提示元数据供父进程解析；`git/revision-content.js` 只读取跟踪状态和指定 revision 内容；`policies/dead-code-baseline.js` 只负责稳定指纹、计数、当前债务比较和重命名映射；`gates/quality/dead-code-gate.js` 形成中文 GateResult，`dead-code-baseline-management.js` 在相同受控边界内执行显式基线写入；`orchestration/cli/dead-code-baseline.js` 只负责命令路由和中文结果输出。Knip 配置和项目入口仍由消费项目拥有。

`core/project/repo-guard-package.js` 只提供 npm 包自身的精确版本事实。受管通知 Job 使用该版本生成固定的官方 npm 安装命令，显式清空项目 `before_script`，并携带生成器专用 CI 标记；通知命令不重新加载项目配置，从而不依赖前序 Job 的项目依赖安装或配置校验结果。

## 4. 核心运行模型

### 4.1 Gate Capability

每个官方门禁通过 `defineGate` 声明稳定元数据，包括：

- 唯一 `id`；
- 配置键和可启停功能名；
- 支持的执行环境；
- `read-only`、`working-tree-fix` 或 `external-write` 副作用；
- 超时、取消、所需工具和项目脚本；
- manual 命令、doctor 顺序和项目 `guard:*` 脚本；
- `inspectSetup`、`plan` 和 `run` 生命周期。

当前静态 Registry 包含 32 个官方 Gate。消费项目配置的 `externalGates` 会在官方 Registry 之后动态追加，但不能替换或重排官方能力。

| 领域 | 官方 Gate ID |
|---|---|
| 安全 | `security.dynamic-code`、`security.vue-unsafe-html`、`security.vue-target-blank` |
| Vue 可访问性 | `accessibility.vue-form-label`、`accessibility.vue-image-alt` |
| 仓库治理 | `repository.structured-exceptions`、`repository.agent-policy`、`repository.commit-message`、`dependencies.policy`、`repository.path-naming`、`repository.image-assets`、`repository.file-placement`、`repository.code-placement`、`repository.maximum-file-lines`、`repository.protected-files` |
| 质量与测试 | `quality.stylelint`、`quality.eslint`、`quality.prettier`、`quality.vue-async-resource-cleanup`、`quality.dead-code`、`quality.typecheck`、`quality.unit-test`、`quality.mutation-test`、`quality.accessibility-test`、`quality.architecture`、`quality.build`、`quality.lighthouse`、`quality.style-complexity`、`quality.style-governance` |
| 发布准备 | `release.check`、`release.test`、`release.package` |

`coverage` 和 `componentInteraction` 是 `quality.unit-test` 的子能力；Stylelint 复杂度和样式治理在提交门禁中由 `quality.stylelint` 执行，同时提供独立的全项目审计 Gate。

### 4.2 GateContext 与 ChangeSet

CLI、pre-commit、pre-push 和 CI 统一使用不可变 `GateContext`。Git 变更由 `ChangeSet` 提供，包含来源、变更条目和可选 revision 范围。Gate 不得自行重新收集一套变更范围；路径命名门禁读取完整 Git 索引是独立的仓库状态事实，不把它冒充本次变更范围。

### 4.3 GateResult

所有门禁返回同一结构：

- 状态：`passed`、`skipped`、`violation`、`configuration-error`、`execution-error`、`range-error`；
- `findings` 和面向 AI 的规范入口 `issues`；
- `metrics`、`artifacts` 和经过脱敏的 `diagnostics`；
- 规则、位置、证据、期望结果、修复步骤、约束、验证方式和稳定指纹。

console 和 CI JSON 都从同一个结果渲染，不允许 Gate 直接决定进程退出或自行输出另一套错误文案。

统一退出码为：

| 退出码 | 含义 |
|---:|---|
| `0` | 通过或明确跳过 |
| `1` | 配置错误或执行错误 |
| `2` | 策略违规 |
| `3` | Git/CI 变更范围不可信 |

## 5. 功能清单

### 5.1 初始化、迁移与诊断

| 功能 | 已实现行为 |
|---|---|
| `init` | 创建当前配置、安装托管 Hook、设置 `core.hooksPath`、维护忽略文件和项目脚本，并按项目工具准备情况启用能力 |
| `install-hooks` | 安装 `pre-commit`、`pre-push`、`prepare-commit-msg`、`commit-msg`、`post-commit` 五个 Hook |
| Hook 升级 | 接受已知旧 marker，但只生成当前 `repo-guard-managed:v4` |
| `migrate` | 补齐当前配置契约、保留已有显式值并同步当前 AGENTS 托管规范，不保留已删除的旧字段兼容分支 |
| `doctor` | 检查 Node、配置、Hook、工具、脚本、通知、结构化例外、AGENTS 托管规范和外部门禁准备状态 |
| `doctor --fix` | 只修复 repo-guard 管理的配置、Hook、CI、忽略项、AGENTS 托管规范和项目脚本 |
| `doctor --ci` | 检查 GitLab CI 集成，不要求本地 Hook 或企业微信凭据 |
| 托管文本换行兼容 | 比较最新状态时统一 LF、CRLF 和 CR，避免 Windows `core.autocrlf` 造成误报或无意义重写；其他内容仍严格匹配 |

项目要求 Node.js `>=22.23.2`。repo-guard 不自动安装消费项目的 ESLint、Prettier、Stylelint、TypeScript、Vitest、dependency-cruiser、axe、Lighthouse 或 Chrome。

### 5.2 暂存代码质量

| 能力 | 配置位置 | 主要行为 |
|---|---|---|
| Stylelint | `preCommit.stylelint` | 使用项目本地 Stylelint 和配置，对暂存 CSS/预处理器/Vue 样式执行修复与只读复检 |
| 样式复杂度 | `preCommit.stylelint.complexity` | 强制复合选择器数量和嵌套深度，不允许项目配置、ignore 或 disable 注释关闭硬规则 |
| 样式治理 | `preCommit.stylelint.governance` | 限制 specificity、ID、`!important`、未批准全局样式和 Vue 样式作用域逃逸 |
| Vue 样式语言 | Stylelint 门禁内置 | 同一 Vue 文件可以有多个同语言 style 块，但不能混用不同语言 |
| ESLint | `preCommit.eslint` | 使用项目本地 ESLint；可注入 AI 可维护性基线，项目配置仍拥有最终覆盖权 |
| Prettier | `preCommit.prettier` | 使用项目本地 Prettier、配置和 ignore；可以修复或只读检查暂存文件 |
| 文件头同步 | `preCommit.fileHeader` | 默认关闭；按仓库相对 include、exclude 和扩展名白名单选择暂存文件，保留人工 Description，并用 Git 记录重建作者与编辑信息 |
| 函数文档同步 | `preCommit.functionDocs` | 默认关闭；按 AST 签名同步暂存 JavaScript、TypeScript 和 Vue script 中的 `@param`/`@returns`，保留人工说明，并提示缺失的 `@throws`；Vue 顶层 script 边界由 `integrations/vue` 共享扫描器提供，不会把注释或 template 文本当成源码 |
| Vue 异步资源清理 | `preCommit.asyncResourceCleanup` | 默认关闭；按 include、exclude 和扩展名选择 Vue 页面与 composable，匹配定时器、动画帧、监听器、Observer、连接、Worker、订阅、定位监听和请求取消；启用后全部按错误阻断且不自动修复 |
| 统一路径命名 | `preCommit.pathNaming` | 默认关闭；项目在 camelCase 与 kebab-case 中选择唯一规范，按 include、exclude 检查完整 Git 索引中的文件名和文件夹名；全部按错误阻断且不自动重命名 |

pre-commit 从不运行项目级 fix。`lint-staged` 只暴露本次暂存快照，完成后把修复写回索引，并恢复同一文件中的未暂存内容；任一步失败都会恢复执行前状态。文件头与函数文档同步均发生在同一暂存快照中。文件头使用匹配源文件的注释形式，并以 Git 记录重建受管字段；函数文档仅处理配置范围内的具名实现，不猜测 Description、参数说明或异常语义，解构参数与 Generator 使用非阻断人工维护提示。

### 5.3 安全与 Vue 静态规则

| 能力 | 检查内容 |
|---|---|
| 动态代码 | AST 检查 `eval` 和 `Function` 构造器，忽略注释与字符串中的普通文本 |
| Vue 异步资源清理 | AST 按绑定身份和生命周期配对资源创建与释放；不能证明句柄、监听参数、请求 signal 或清理时机可靠时直接报告错误 |
| Vue 不安全 HTML | 检查模板中的 `v-html`，要求精确且有效的结构化例外 |
| 新窗口链接 | `target="_blank"` 必须静态证明同时包含 `noopener` 和 `noreferrer` |
| Vue 表单标签 | 原生表单控件必须具有可静态验证的可访问名称 |
| Vue 图片替代文本 | 原生图片必须具有符合规则的 `alt` |

这些 Vue 规则不依赖项目额外安装 lint 插件，并在 pre-commit 与 CI policy 中执行；异步资源清理默认关闭，启用后以阻断错误执行，其余表内静态规则为硬门禁。结构化例外必须精确匹配规则、文件和位置，并受生效时间、到期时间和维护者信息约束。

### 5.4 仓库文件与代码治理

| 能力 | 配置位置 | 主要行为 |
|---|---|---|
| 文件归位 | `preCommit.filePlacement` | 通过 glob 限制文件允许目录；支持只检查新位置或检查所有变更文件，并给出建议目录 |
| 统一路径命名 | `preCommit.pathNaming` | 一个项目只能配置 `camelCase` 或 `kebab-case` 中的一种；全部 include 范围共用该规范，pre-commit 与 CI 检查完整已跟踪路径，排除范围优先，Git 空目录不在检查范围内 |
| 图片资源治理 | `imageAssets` | 默认关闭；检查作用范围内的图片命名、大小写碰撞、扩展名与真实格式、精确重复和压缩机会；`compression.enabled` 统一控制原格式压缩与 WebP 转换，非轻量阶段可独立配置解码像素重复，所有 Hook 与 CI 路径保持只读 |
| 单文件行数 | `preCommit.maxFileLines` | 检查最终暂存文件完整行数；支持严格模式、存量不恶化模式、接近上限警告和 Vue 分区统计 |
| 代码位置 | `codePlacement` | 一段精确代码文本只能出现在一个或多个允许文件；pre-commit 读取最终 Git 索引，CI 扫描完整提交 |
| 保护文件审计 | 顶层 `rules`、`exclusions` | 第一条匹配规则生效，排除项优先；记录 Git 状态、原路径和目标路径 |
| 企业微信通知 | `notification` 与 `notify` 规则 | 通知开启时要求发送成功；使用暂存指纹避免重复通知 |
| 不可变文件 | 顶层规则 `level: "block"` | 修改、删除、重命名或移动匹配文件都会硬阻断；旧路径的 block 不能被目标路径普通规则降级 |

保护文件规则级别：

- `audit`：只记录，不通知、不阻断。
- `notify`：记录；通知开启时发送企业微信，发送失败会阻止提交。
- `block`：始终阻断，且在返回违规前不会发送外部通知。

精确锁定文件示例：

```json
{
  "rules": [
    {
      "pattern": "src/security/permission-map.ts",
      "category": "不可变安全文件",
      "level": "block"
    }
  ]
}
```

代码位置规则支持多文件白名单：

```json
{
  "codePlacement": {
    "enabled": true,
    "rules": [
      {
        "name": "支付签名实现",
        "content": "const signature = createPaymentSignature(payload);",
        "allowedFiles": [
          "src/payment/signature.ts",
          "src/admin/payment-signature.ts"
        ],
        "scanPatterns": ["src/**/*.{js,jsx,ts,tsx,vue}"]
      }
    ]
  }
}
```

代码位置匹配只统一 CRLF/CR 为 LF，不忽略其他空白，也不把语义相似但文本不同的代码视为相同。

### 5.5 提交、依赖与架构治理

| 能力 | 配置位置 | 主要行为 |
|---|---|---|
| 依赖声明 | `dependencyPolicy` | 检查精确版本、允许协议、禁用包、依赖分组和结构化例外 |
| 提交信息 | `commitMessage` | 校验 Conventional Commit、类型与 scope、标题长度、merge/revert、临时提交生命周期和不兼容变更声明 |
| 锁文件 | `dependencyPolicy.requireLockfile` | `package.json` 与 `package-lock.json` 必须同步，删除或缺失锁文件会阻断 |
| 暂存快照 | 依赖门禁内置 | pre-commit 使用最终 Git 索引中的 package/lock 内容，不受未暂存副本影响 |
| 依赖架构 | `architecture` | 使用消费项目的 dependency-cruiser 和配置，执行项目声明的模块方向规则 |
| 无效代码 | `deadCode` | 使用消费项目 Knip 的完整项目图检查文件、导出、依赖与解析问题；支持严格模式和只减不增基线 |

repo-guard 不替业务项目设计依赖层级；它负责验证项目已有架构配置能够执行并把违规转换为统一结果。

提交信息门禁默认关闭。启用后，普通提交必须符合 `type(scope)!: 简要说明`，项目可限制类型、scope 和 Unicode 标题长度。不兼容变更可要求标题 `!` 与 `BREAKING CHANGE:` 正文同时存在；merge 在本地通过 `MERGE_HEAD`、在已提交历史中通过父节点数量识别，不能把 revert/cherry-pick 的 Hook 来源误认为 merge；revert 必须保留 Git 生成的标题与回退 SHA。`fixup!`/`squash!` 默认只允许本地整理，pre-push 与 CI 强制阻断；release-ready 只在提交范围含不兼容变更时要求目标提交中的 package major 高于基准版本。

### 5.6 测试、覆盖率与可访问性测试

| 能力 | 配置位置 | 主要行为 |
|---|---|---|
| 单元测试映射 | `unitTest` | 按源码 glob 和映射模板要求新增或变更源码存在对应 `.spec/.test` 文件 |
| 测试语义 | `unitTest` | 拒绝空测试文件以及 `.skip`、`.skipIf`、`.todo`、`.only` 绕过 |
| Vitest 执行 | `unitTest.script` | 运行项目精确 npm script，并保留结构化 diagnostics |
| 组件交互 | `unitTest.componentInteraction` | 对交互型 Vue 组件要求 mount、真实 trigger/setValue 等交互及交互后断言 |
| 覆盖率 | `unitTest.coverage` | 强制生成新 `json-summary` 和 LCOV，检查全局行/语句/函数/分支及 Git 变更行覆盖率 |
| 变异测试 | `mutationTest` | 使用消费项目的 Stryker 10.x 和配置，强制本地报告、非原地变异，并按 `thresholds.break` 阻断 |
| axe 测试 | `accessibilityTest` | 支持 vitest-axe、jest-axe、Playwright、Cypress 和 axe-core；要求真实扫描与零违规断言 |

覆盖率只统计 LCOV 中可执行的变更行；缺少目标源码记录会失败，避免未导入文件逃逸。repo-guard 不复用旧报告，不允许通过降低阈值或扩大排除项修复违规。

变异测试仅在手动命令和受保护构建中运行，不进入 pre-commit、pre-push 或固定 CI 计划。执行时强制覆盖 Stryker 的 `reporters`、`jsonReporter`、`htmlReporter` 和 `inPlace`，因此不会继承 `dashboard` 上传，也不会原地修改业务源码；消费项目仍拥有 mutate 范围、测试运行器、插件和硬门槛配置，其中 `thresholds.break` 必须是 0 到 100 之间的数值，缺失时也会阻断。报告目录必须位于 `reports/` 且被 Git 忽略；每次执行前删除旧文件，并拒绝未知 schema、状态、阈值、绝对/穿越路径、符号链接和已跟踪报告覆盖。中文 HTML 转义所有第三方动态文本，Stryker 原文只在明确标记的原始诊断中展示。

`mutationTest.guardedBuilds` 可声明多个任意原始 npm 构建脚本及各自的 `guard:build:*` 别名、构建超时和失败通知开关。别名执行固定闭环：变异测试通过后才运行原始脚本；得分不足、没有可评分变异、执行失败、报告缺失或无效时立即阻断。`repo-guard init` 只补充缺失别名，不覆盖同名自定义脚本；doctor 同时验证原始脚本、精确别名、Stryker 依赖、配置文件和报告忽略规则。企业微信通知复用现有本地凭据；受管 GitLab 流水线通知已启用时抑制重复消息。

### 5.7 类型、构建与 Lighthouse

| 能力 | 配置位置 | 执行位置 | 主要行为 |
|---|---|---|---|
| TypeScript | `typeCheck` | manual、pre-push、CI full | 运行项目精确 typecheck npm script；pre-push 实时显示脱敏输出，不进入 pre-commit |
| 构建 | `build` | manual、pre-push、CI full、release-ready | 运行项目构建脚本，检查脚本存在性、超时和进程失败；pre-push 实时显示脱敏输出 |
| Lighthouse | `lighthouse` | manual、pre-push、release-ready | 使用项目的 `@lhci/cli`、Chrome、路由和断言，只执行 collect/assert |

Lighthouse 不进入 pre-commit 或普通 CI policy/full，不猜测 Vue Router 路由，不隐式执行 LHCI upload。

### 5.8 外部门禁

`externalGates` 用于接入 API 合约、页面、视觉等业务项目自有测试，而不把业务接口或页面语义写入 repo-guard。

已实现约束：

- ID 必须位于 `project.<kebab-case>` 命名空间。
- 只允许运行 `package.json` 中精确 npm script，不接受任意 shell 片段。
- 只支持 manual、受信 CI full 和 release-ready，不进入 pre-commit、pre-push 或 CI policy。
- 外部门禁固定追加在全部官方步骤之后，不能插入或重排官方计划。
- 报告必须符合 `repo-guard-json-v1`，并与进程退出码一致。
- 报告位于 `reports/`，最大 1 MiB；artifact 最多 20 个，单个最大 10 MiB。
- 拒绝旧报告、未知字段、敏感数据、已跟踪文件覆盖、路径穿越和符号链接穿越。
- 超时、取消或输出超限会终止完整 npm 进程树。

### 5.9 Axios 手动接口性能外部门禁

Axios 接口性能能力通过 `project.api-performance` 外部门禁接入，不属于静态 Registry 中的官方 Gate。消费项目必须为它提供精确 npm script，外部门禁 `environments` 必须且只能是 `["manual"]`；runner 还会拒绝常见 CI、GitLab CI、GitHub Actions、Azure Pipelines 和 Jenkins 环境标记。因此它不会进入 pre-commit、pre-push、CI policy/full、release-ready、受保护构建或打包流程，只能由用户在本地终端显式运行 `repo-guard external project.api-performance`。

项目通过受 Schema 约束的 `.json` 配置声明目标环境变量名、精确主机白名单、确认变量、客户端工厂、场景模块、预热次数、正式样本数、1 到 5 的低并发和默认阈值。runner 先解析纯 JSON 并完成目标环境确认，再加载明确列出的客户端与场景 `.mjs`。客户端工厂由消费项目持有，可以复用业务 Axios 工厂、拦截器、Token 注入、错误转换和重试；repo-guard 不依赖或安装 Axios，也不向生产实例动态注入拦截器。耗时从场景调用前开始，到 Promise 成功或失败结束，表示客户端实际感知总耗时；预热样本不参与统计，正式样本不删除异常值。

每个场景声明名称、方法、不含查询参数的稳定路径标签和实际调用函数，可单独覆盖 p95、p99 和错误率阈值。默认只允许 `GET`、`HEAD` 和 `OPTIONS`；写方法必须同时获得配置级和场景级授权，并提供 `cleanup`。所有场景共享唯一 `runId` 以便隔离测试数据；场景完成、正式样本失败或预热失败时都会尝试清理，清理失败按执行错误处理并且不生成主报告。进程被操作系统强制终止时无法保证 JavaScript 清理逻辑执行，因此写接口仍必须使用测试账号、幂等数据和服务端过期清理，默认关闭写请求是最终安全边界。

目标 URL 必须使用 HTTPS，不得包含凭据、查询参数或片段；解析后的主机必须同时匹配配置白名单和本次运行确认环境变量。报告目录必须位于 `reports/`、被 `.gitignore` 忽略、未被 Git 跟踪且不穿过符号链接。runner 最后写入 `repo-guard-json-v1` 主报告和经过 HTML 转义的中文报告；通用外部门禁随后再次检查报告新鲜度、退出码、Schema、大小、路径和敏感信息。通过、阈值违规和执行错误分别使用退出码 `0`、`2` 和 `1`。

### 5.10 k6 手动接口压测外部门禁

k6 接口压测通过 `project.k6-load` 外部门禁接入，必须配置 `environments: ["manual"]` 并由本地终端显式执行 `repo-guard external project.k6-load`。runner 拒绝常见自动化环境标记，不进入 pre-commit、pre-push、CI policy/full、release-ready、受保护构建或打包；本期只使用本机 k6 `1.5.0` 至 `2.x`，不自动安装 k6、Docker 或扩展，不调用 k6 cloud，也不上传报告。

独立 Schema 约束 HTTPS 目标环境变量、精确主机白名单、本次运行确认变量、仓库内 `.js`/`.ts` 场景、阈值和负载配置。确认值同时覆盖主机、配置档、执行器、最大 VU、到达率或阶段总时长、读写模式，防止只确认主机后误用更高负载。支持 `ramping-vus` 和 `constant-arrival-rate`；VU、到达率、单次时长、阶段数量和外部门禁总超时都有硬上限或闭环校验。

repo-guard 生成临时受控入口并独占 k6 `options`、thresholds 与 `handleSummary`。阈值和报告只读取当前 `scenario` 的标签子指标，使正式负载与 `setup`/`teardown` 中的登录、造数和清理流量相互隔离。消费脚本必须默认导出场景函数、从指定 `__ENV` 读取基础地址、直接调用可静态识别的 `k6/http` 方法并产生 `check`；递归本地依赖只允许仓库内相对 `.js`/`.ts` 和 k6 内置模块。远程模块、裸包、`k6/x/*`、动态 import、硬编码 HTTP 地址、动态请求方法、转存 HTTP 绑定以及消费者自定义 `options`/`handleSummary` 均被拒绝。

子进程仅获得操作系统启动所需变量、项目显式 `environment.pass`、基础地址和随机 `REPO_GUARD_K6_RUN_ID`，并关闭使用情况上报和自动扩展解析。默认只允许 `GET`、`HEAD`、`OPTIONS`；写请求必须显式启用 `safety.allowWrites`，同时导出 `teardown`，并在其中使用 runId 发出可静态验证的直接清理请求。teardown 在强制终止时无法得到保证，因此写压测仍要求测试账号、幂等或可过期数据和服务端兜底清理。

执行前使用 `k6 inspect --execution-requirements` 预检受控入口。正式执行不启用可选的新机器摘要，因为 k6 1.x/2.x 当前的新格式不包含阈值创建的场景子指标；受控 `handleSummary` 保留聚合指标对象，再从当前场景子指标校验必要样本、实际最大 VU 和进程退出码，同时解析器仍兼容无需场景过滤的新格式。通过时 k6 与 runner 均返回 `0`；阈值违规要求 k6 返回 `99`，runner 生成 `violation` 并对外返回 `2`；其他退出、超时、摘要缺失、敏感内容或判定不一致返回 `1` 且不写主报告。报告目录必须位于已忽略、未跟踪、无符号链接的 `reports/`，保留 k6 原始机器摘要、转义后的中文 HTML 和外部门禁 JSON。

测试套件以伪 k6 覆盖稳定的通过、违规和执行错误分支，并提供由 `REPO_GUARD_REAL_K6_BIN` 显式启用的真实集成测试。真实测试固定使用 k6 官方演示站点、1 VU 和 1 秒负载；默认测试流程不联网。

### 5.11 GitLab CI

| 配置档 | 固定能力 |
|---|---|
| `policy` | 结构化例外、AGENTS 托管规范、安全与 Vue 可访问性、依赖、文件归位、代码位置、行数、测试策略和保护文件 |
| `full` | `policy` 加只读 Stylelint、ESLint、Prettier、类型检查、完整单元测试/覆盖率、axe、架构和构建 |
| `release-ready` | `policy` 加项目 `check`、项目 `test`、构建、可选 Lighthouse 和发布包一致性检查 |

CI 使用明确 base/head 或 GitLab 提供的可信范围。浅克隆缺少基准提交时返回范围错误，不会把未知范围当成空变更。

CI 门禁始终只读：不执行 fix、不安装 Hook、不读取本地企业微信凭据、不发送通知。`repository.agent-policy` 在结构化例外之后、其他项目规则之前验证 `AGENTS.md` 已同步，失败时要求在受控写入阶段运行 `repo-guard doctor --fix`。报告写入 `reports/` 下经过验证的 JSON 路径，并可以作为 GitLab artifact 保留。可选应用交付 Job 属于独立层，调用消费项目显式提供的固定验证/部署 npm scripts；开启通知时再由包内命令读取 GitLab CI 受保护变量并发送结果。

`ci.gatePolicy` 在现有固定计划之上提供 CI 专属的 Gate 激活和阻断策略：`inherit` 保持原行为，`off` 在 setup 前跳过，`report` 执行但不影响 CI 总退出码，`enforce` 执行并阻断失败。该策略不进入 pre-commit 或 pre-push；显式 `report/enforce` 只修改单个 CI 步骤的不可变上下文副本。

CI Gate 集合由 Registry 中声明的 `ci-policy`、`ci-full`、`release-ready` environment 自动派生。每个官方 CI Gate 必须至少出现在一个受审计划，否则仓库测试失败；计划内的每一步由统一策略控制器自动处理。文件型 Gate 可以通过 Registry `ciScopes` 声明是否支持 `changed-files`，未声明的 Gate 只能使用 `all-files`。

`ci.pipeline` 是独立于 Gate 策略的可选 GitLab 应用交付层。它复用原有受管 include 与 `install-ci`/`doctor --ci`，固定生成门禁、验证、测试发布、生产发布和可选快速发布 Job；消费项目不能通过配置注入 shell 命令，只能提供固定名称的验证/部署 npm scripts。模板只识别并生成当前 v2 marker，不保留旧模板兼容分支。

交付配置仅包含阶段、验证/发布镜像、测试/生产分支、Runner 标签、旧 peer dependency 兼容、快速发布与通知开关。`repo_guard` 固定在 `.pre` stage，受管验证与发布 Job 只会在门禁通过后继续。开启通知后，生成器在保留的 `.post` 阶段增加 `when: on_success` 与 `when: on_failure` 两个互斥 Job，任意阻断性 Job 失败会发送一次失败通知，全部成功则发送一次成功通知。运行中的受管 Job 被手动或自动取消时，`after_script` 发送“已取消（canceled）”通知；前置门禁和验证 Job 可自动中断，部署 Job 不改为可自动中断。取消 pending Job 或强制取消时 GitLab 不执行 `after_script`，因此无 Runner 内通知入口。提交标题最多显示前 10 个字符并追加省略号。通知包从 npm 官方 tarball URL 安装到 Job 唯一隔离目录，禁用 lifecycle scripts，并通过绝对路径执行，不使用消费项目的本地可执行文件。通知 Job 使用 `allow_failure: true` 保持原流水线结果。Webhook 来自 `REPO_GUARD_WECOM_WEBHOOK`，可选手机号来自 `REPO_GUARD_MENTION_MOBILES`，二者只从 GitLab CI 变量读取。实际微信小程序上传、Web 镜像构建、蓝绿切换、其他密钥、端口和外部服务地址均由消费项目脚本或 GitLab 受保护变量拥有。`ci.pipeline` 不改变 pre-commit、pre-push 或 `ci.gatePolicy` 的语义。

### 5.12 发布就绪

`release-ready` 会验证：

- 项目精确 `check` 和 `test` script；
- 已启用构建和可选 Lighthouse；
- `package.json` 与 lockfile 名称、版本一致；
- 当前版本存在对应 `CHANGELOG.md` 标题，并与 `README.md` 的当前版本声明一致；
- Schema、exports、bin 和实际 npm pack 文件一致；
- `pack:check` 精确使用 `npm pack --dry-run --json --ignore-scripts`；
- 打包内容不包含凭据、私钥、Token 或其他敏感发布文件。

该流程只证明“可以发布”，不会生成正式 tarball，不运行 lifecycle script，不执行 `npm publish`、deploy 或任何生产写操作。

## 6. 固定生命周期

托管 `prepare-commit-msg` 先保存 Git 来源并追加带 marker 的自动变更文件摘要；托管 `commit-msg` 先移除该摘要得到人工消息，复用 `repository.commit-message` 的本地策略，校验通过后才定稿摘要。校验失败保留可编辑消息与 marker 并返回策略违规退出码；`post-commit` 只清理临时状态。该流程不改变受保护 pre-commit Execution Plan 的顺序。

### 6.1 pre-commit

顺序由锁定 Execution Plan 固定，项目配置不能重排：

启用 `preCommit.fileHeader` 或 `preCommit.functionDocs` 时，对应同步先作为 `lint-staged` 快照预处理执行，不属于下列受保护计划，也不改变计划步骤或顺序。

```text
Stylelint fix
  → ESLint fix
  → Prettier
  → Stylelint read-only verify
  → ESLint read-only verify
  → Vue async-resource-cleanup（启用时阻断）
  → path-naming（启用时检查全部已跟踪路径）
  → dynamic-code
  → Vue v-html
  → Vue target=_blank
  → Vue form label
  → Vue image alt
  → maximum-file-lines
  → file-placement
  → dependency-policy（最终 Git 索引）
  → image-assets（启用时读取最终 Git 索引二进制内容）
  → code-placement（最终 Git 索引）
  → protected-files（最后执行）
```

禁止加入 pre-commit 的能力：TypeScript 类型检查、Knip 全项目无效代码、单元测试、变异测试、axe、dependency-cruiser 项目架构、构建和 Lighthouse。

### 6.2 pre-push

```text
commit-message
  → typecheck
  → dead-code
  → unit-test（包含可选 coverage/componentInteraction）
  → accessibility-test
  → architecture
  → build
  → lighthouse
```

每项按配置启用状态决定执行或跳过，并对本次推送使用精确变更范围。

`commit-message` 是 pre-push 的第一步，直接读取待推送 revision 范围中的真实提交对象。默认本地允许的 `fixup!`/`squash!` 会在此被阻断，要求推送前完成 rebase/autosquash。

pre-push 的 TypeScript、单元测试、axe 和构建脚本通过统一异步进程能力执行：门禁开始前立即显示中文进度，子进程 stdout/stderr 经路径和敏感信息脱敏后实时写入终端，同时保留执行结果用于失败判定。超时或计划取消会终止完整进程树。Knip 和 dependency-cruiser 的 stdout 是结构化 JSON，不直接转发，但对应门禁会在分析开始前显示进度。

### 6.3 CI 与 release-ready

CI 使用锁定计划聚合所有结果，并将每一步的 GateResult 写入统一报告。CI policy/full 和 release-ready 都在结构化例外之后校验提交信息；CI 默认拒绝残留的 `fixup!`/`squash!`。release-ready 额外把不兼容变更声明与 package major 版本闭环。`full` 不运行 Lighthouse；Lighthouse 只在 manual、可选 pre-push 和 release-ready 中运行。

## 7. CLI 命令清单

### 7.1 项目与生命周期命令

| 命令 | 用途 |
|---|---|
| `repo-guard init` | 初始化配置、Hook、受管理文件和项目脚本 |
| `repo-guard install-hooks` | 安装或升级托管 Hook |
| `repo-guard migrate` | 迁移到当前配置契约 |
| `repo-guard enable <feature>` | 启用一个或多个可配置能力 |
| `repo-guard disable <feature>` | 禁用一个或多个可配置能力 |
| `repo-guard doctor [--fix|--ci]` | 诊断或修复受管理设置 |
| `repo-guard install-ci --provider gitlab ...` | 安装 GitLab CI 模板 |
| `repo-guard ci --profile ...` | 执行 CI 固定计划并生成 JSON 报告 |
| `repo-guard pre-commit` | 执行提交前固定计划 |
| `repo-guard pre-push` | 执行推送前固定计划 |
| `repo-guard check` | 检查工作树中的保护文件变更 |
| `repo-guard gate [--dry-run|--force-notify]` | 执行保护文件 Gate |
| `repo-guard dry-run` | 预览保护文件通知，不发送网络请求 |
| `repo-guard external <project.id>` | 手动执行一个项目外部门禁 |
| `repo-guard k6-runner --gate-id <project.id> --config <path>` | 受控执行 manual-only k6 外部门禁的项目脚本入口 |
| `repo-guard guarded-build <npm-script>` | 先执行变异测试，通过后运行已配置的原始构建脚本 |
| `repo-guard dead-code-baseline init|prune` | 初始化无效代码历史债务基线，或只删除已经解决的条目 |
| `repo-guard image-optimize [--to webp] [--write] [--allow-lossy] -- <paths...>` | 预览或显式写入图片压缩/WebP 候选；不删除原图或改写引用 |

### 7.2 官方专项命令

```text
exceptions
dependencies
build
architecture
dead-code
typecheck
unit-test
mutation-test
async-resource-cleanup
path-naming
dynamic-code
unsafe-html
target-blank
form-labels
image-alt
image-assets
accessibility-test
style-complexity
style-governance
file-placement
code-placement
lighthouse [--skip-build]
```

manual 专项命令使用同一个 Gate Registry 和 GateResult，不维护独立规则实现。

### 7.3 可启停功能名

```text
stylelint
eslint
prettier
fileHeader
functionDocs
asyncResourceCleanup
pathNaming
imageAssets
styleComplexity
styleGovernance
maxFileLines
filePlacement
codePlacement
dependencies
architecture
deadCode
build
lighthouse
typeCheck
unitTest
mutationTest
accessibilityTest
componentInteraction
coverage
notification
ci
```

原生动态代码与 Vue 安全/静态可访问性规则在提交门禁中没有关闭开关；CI 可以通过独立的 `ci.gatePolicy` 配置 `off`、`report` 或 `enforce`，不会改变提交门禁行为。

## 8. 配置结构

当前配置版本固定为 `version: 1`，顶层字段如下：

| 字段 | 职责 |
|---|---|
| `$schema` | 引用 npm 包导出的配置 Schema |
| `version` | 当前配置契约版本，只接受 `1` |
| `notification` | 企业微信通知开关 |
| `ci` | CI 开关、配置档、报告路径、保护文件行为和独立 Gate 策略 |
| `externalGates` | 项目自有外部门禁声明 |
| `codePlacement` | 精确代码文本允许位置规则 |
| `exceptions` | 精确、限时、可审计的结构化例外 |
| `dependencyPolicy` | 依赖声明与 lockfile 治理 |
| `commitMessage` | Commit 提交信息与生命周期治理 |
| `deadCode` | Knip 项目级无效代码检查与历史债务基线 |
| `imageAssets` | 图片范围、命名、重复、压缩、WebP 转换、收益阈值和安全上限 |
| `architecture` | dependency-cruiser 门禁 |
| `build` | 独立构建门禁 |
| `lighthouse` | Lighthouse 配置和自动执行开关 |
| `typeCheck` | TypeScript 脚本门禁 |
| `accessibilityTest` | axe 测试策略和脚本 |
| `unitTest` | 单元测试、组件交互和覆盖率 |
| `mutationTest` | Stryker 配置、报告目录、运行超时和多个受保护构建别名 |
| `preCommit` | 文件头同步、函数文档同步、异步资源清理、统一路径命名、Stylelint、ESLint、Prettier、行数和文件归位 |
| `rules` | 保护文件规则 |
| `exclusions` | 保护文件排除项 |

配置 Schema 是允许字段、类型和枚举的正式契约；运行时验证负责补充跨字段关系、路径安全和工具准备条件。

## 9. 公共 API 与 Schema

npm 包根入口只公开稳定构造和结果契约：

- 配置：`loadConfig`、`validateConfig`、`matchRule`；
- 能力：`defineGate`、`createGateRegistry`、`createGateContext`、`createChangeSet`、`createStructuredLogger`；
- 错误：`RepoGuardError` 及配置、执行、范围、安全、内部、取消错误构造器；
- 结果：`createGateResult`、`createFinding`、`createArtifact`、状态和退出码映射。

包还公开：

- `@cxyi7/repo-guard/config.schema.json`；
- `@cxyi7/repo-guard/api-performance-config.schema.json`；
- `@cxyi7/repo-guard/k6-load-config.schema.json`；
- `@cxyi7/repo-guard/external-report.schema.json`；
- `@cxyi7/repo-guard/gate-result.schema.json`。

内部 runner、具体 Gate、integration 和 orchestration 不属于公共 API。

## 10. 中文输出与安全约束

- repo-guard 自有状态、警告、错误、证据、期望和修复说明必须使用简体中文。
- 机器 ID、命令、路径、包名、协议枚举和第三方规则 ID 保持稳定原值。
- 第三方原始输出只能进入标记了 source/stream 的 diagnostics，或作为经过脱敏的 pre-push 实时输出；不能替代主要中文问题说明。
- 标准检查使用零英文债务基线；纯英文和中英文混合说明都会被识别，新增功能不能扩大或重新生成该基线。
- 命令、路径、包名、规则 ID、配置字段和受控状态枚举作为稳定机器文本保留；不得把说明性英文伪装成机器文本白名单。
- 输出会脱敏常见 Token、Cookie、密码、Authorization 和私钥，并限制长度。
- finding、error、artifact 和 evidence 的路径只保留仓库相对路径或安全占位。
- `.env.config` 必须被 Git 忽略；即使强制暂存也会被门禁阻止。
- CI 和外部门禁报告不能覆盖已跟踪文件或穿过符号链接。

## 11. 明确不包含的能力

当前项目有意不实现以下行为：

- 不承载业务接口、页面路由、业务请求参数或生产运行时代码。
- 不自动安装或替换消费项目的 lint、测试、构建和浏览器工具。
- 不允许消费项目重排官方 pre-commit、pre-push 或 CI 计划。
- 不在 Git Hook 中执行全项目修复。
- 不把 TypeScript、测试、构建或 Lighthouse 放入 pre-commit。
- 通用外部门禁不允许配置任意 shell command 或加载任意 JavaScript 插件；Axios 性能 runner 只在目标环境确认后加载配置中逐个明确列出的客户端和场景 `.mjs`；k6 runner 只加载经过 AST 校验的仓库内场景和本地依赖。
- k6 runner 不自动安装本机工具、Docker 或扩展，不调用云端压测，不进入自动化流程，也不保证操作系统强制终止时执行消费者 teardown。
- 不隐式上传 Lighthouse 或其他报告。
- 不自动关闭规则、降低阈值、扩大排除项或生成绕过例外。
- 不宣称 WebP 对所有图片都有固定压缩率，不自动删除原图、修改源码引用或在 Hook/CI 中写入图片。
- 不执行 npm 发布、部署、生产环境写入或凭据操作。

## 12. 维护要求

- 新能力必须先确定所属领域，保持事实、策略、Gate 和编排职责分离。
- Registry 是能力目录的单一事实来源，Execution Plan 是生命周期顺序的单一事实来源。
- 每个行为变化必须同步测试、README、配置 Schema 和 changelog。
- 本文档是长期维护的项目结构与功能事实清单；新增、修改或删除功能，以及调整仓库目录、模块职责或依赖方向时，必须在同一变更中同步更新对应章节。
- 每个可独立发布的功能单独评审和版本化，不与下一个功能捆绑。
- 发布前必须执行 `npm run check`、`npm test` 和 `npm run pack:check`。
- 文档功能清单应以当前 Registry、Execution Plan、配置 Schema 和实际测试为准，不以历史 changelog 推断当前行为。
