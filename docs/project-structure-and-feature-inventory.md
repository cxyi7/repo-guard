# repo-guard 项目结构与功能清单

## 1. 文档范围

本文说明 `@cxyi7/repo-guard` 当前代码结构、模块职责、生命周期和已经实现的功能，适用于版本 `1.6.3`。

当前最新功能分支具有递进关系：

```text
1.5.0 中文用户文案硬性契约
  └─ 1.6.0 代码位置门禁
       └─ 1.6.1 不可变保护文件门禁
            └─ 1.6.2 Windows 托管文本换行兼容修复
                 └─ 1.6.3 pre-push 实时进程输出
```

因此，`1.6.3` 已包含此前版本的全部能力。本文只描述当前有效实现，不把历史迁移过程或计划中的能力列为已完成功能。

## 2. 已完成功能总览

- [x] 项目初始化、配置迁移、托管 Git Hook 安装和环境诊断。
- [x] 使用消费项目自身的 Stylelint、ESLint 和 Prettier，对暂存文件执行修复与只读复检。
- [x] 保留部分暂存文件中的未暂存内容，失败时恢复执行前状态。
- [x] 动态代码执行安全检查，包括 `eval` 和 `Function` 构造器。
- [x] Vue `v-html`、`target="_blank"`、表单 label 和图片 alt 硬门禁。
- [x] 文件归位、单文件行数、依赖声明、依赖锁文件和依赖架构治理。
- [x] 指定代码只能出现在一个或多个允许文件中的代码位置门禁。
- [x] 保护文件 `audit`、`notify` 和不可变 `block` 三级策略。
- [x] Vitest 单元测试映射、空测试、跳过测试、聚焦测试和覆盖率门禁。
- [x] Vue 组件真实交互测试语义检查。
- [x] axe 组件与 E2E 可访问性测试门禁。
- [x] TypeScript、项目构建、dependency-cruiser 架构和 Lighthouse 独立门禁。
- [x] GitLab CI `policy`、`full` 和 `release-ready` 三种固定配置档。
- [x] 受控外部门禁，可通过精确 npm script 接入项目自有测试。
- [x] 结构化例外、统一 `GateResult`、统一退出码、console/JSON 报告和中文修复指引。
- [x] 报告路径、artifact、敏感信息、符号链接和本地通知凭据安全检查。
- [x] 发布就绪检查，但不会自动执行 npm 发布或部署。

## 3. 仓库目录结构

```text
repo/
├─ bin/                              CLI 启动器
├─ docs/                             长期维护的项目结构与功能清单
├─ scripts/                          仓库自身的语法与中文文案检查脚本
├─ src/
│  ├─ config/                        配置默认值、加载、验证和路径匹配
│  ├─ core/                          稳定领域契约与无业务偏好的基础能力
│  │  ├─ capability/                 Gate、Registry、Execution Plan、GateContext
│  │  ├─ error/                      RepoGuardError 和错误分类
│  │  ├─ execution/                  文件快照、暂存文件、可取消进程和实时输出安全
│  │  ├─ policy/                     受管理文本块和策略生命周期基础能力
│  │  ├─ project/                    Node、package 和项目文本事实
│  │  ├─ report/                     console 与 JSON renderer
│  │  └─ result/                     GateResult、finding、artifact 和退出码
│  ├─ gates/                         门禁决策、finding 和结果适配
│  │  ├─ accessibility/              Vue 可访问性门禁
│  │  ├─ quality/                    lint、格式化、类型、架构、构建、Lighthouse
│  │  ├─ release/                    发布就绪检查
│  │  ├─ repository/                 依赖、文件、代码位置和保护文件策略
│  │  ├─ security/                   动态代码与 Vue 安全门禁
│  │  └─ testing/                    单元测试、覆盖率、axe 和外部门禁
│  ├─ git/                           Git 命令、变更范围、索引内容和仓库状态
│  ├─ integrations/                  消费项目工具和第三方协议适配
│  │  ├─ axe/                        axe 集成发现
│  │  ├─ dependency-cruiser/         依赖架构执行
│  │  ├─ eslint/                     ESLint 项目事实和执行
│  │  ├─ lighthouse/                 Lighthouse 项目事实和执行
│  │  ├─ npm/                        npm script、包元数据和发布环境
│  │  ├─ prettier/                   Prettier 项目事实和执行
│  │  ├─ stylelint/                  Stylelint 项目事实和执行
│  │  ├─ vitest/                     Vitest、覆盖率和测试源码事实
│  │  ├─ vue/                        Vue 模板与交互事实
│  │  └─ wecom/                      企业微信发送适配
│  ├─ orchestration/                 CLI、Hook、CI、doctor 和初始化编排
│  │  ├─ ci/                         CI 范围、固定计划和报告持久化
│  │  ├─ cli/                        CLI 参数与命令路由
│  │  ├─ commit-message/             提交信息文件清单
│  │  ├─ doctor/                     项目准备状态诊断
│  │  ├─ pre-commit/                 暂存隔离、质量段和最终策略段
│  │  ├─ pre-push/                   精确推送范围与独立重型门禁
│  │  └─ setup/                      配置、Hook、CI 和受管理文件安装
│  └─ policies/                      不依赖运行入口的纯策略判定
├─ test/                             配置、行为、端到端和架构边界测试
├─ config.schema.json                项目配置 Schema
├─ external-report.schema.json       外部门禁报告 Schema
├─ gate-result.schema.json           统一 GateResult Schema
├─ package.json                      npm 包入口、依赖和维护脚本
└─ README.md                         安装、配置与使用说明
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

当前静态 Registry 包含 25 个官方 Gate。消费项目配置的 `externalGates` 会在官方 Registry 之后动态追加，但不能替换或重排官方能力。

| 领域 | 官方 Gate ID |
|---|---|
| 安全 | `security.dynamic-code`、`security.vue-unsafe-html`、`security.vue-target-blank` |
| Vue 可访问性 | `accessibility.vue-form-label`、`accessibility.vue-image-alt` |
| 仓库治理 | `repository.structured-exceptions`、`dependencies.policy`、`repository.file-placement`、`repository.code-placement`、`repository.maximum-file-lines`、`repository.protected-files` |
| 质量与测试 | `quality.stylelint`、`quality.eslint`、`quality.prettier`、`quality.typecheck`、`quality.unit-test`、`quality.accessibility-test`、`quality.architecture`、`quality.build`、`quality.lighthouse`、`quality.style-complexity`、`quality.style-governance` |
| 发布准备 | `release.check`、`release.test`、`release.package` |

`coverage` 和 `componentInteraction` 是 `quality.unit-test` 的子能力；Stylelint 复杂度和样式治理在提交门禁中由 `quality.stylelint` 执行，同时提供独立的全项目审计 Gate。

### 4.2 GateContext 与 ChangeSet

CLI、pre-commit、pre-push 和 CI 统一使用不可变 `GateContext`。Git 变更由 `ChangeSet` 提供，包含来源、变更条目和可选 revision 范围。Gate 不得自行重新收集一套 Git 范围。

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
| `migrate` | 补齐当前配置契约并保留已有显式值，不保留已删除的旧字段兼容分支 |
| `doctor` | 检查 Node、配置、Hook、工具、脚本、通知、结构化例外和外部门禁准备状态 |
| `doctor --fix` | 只修复 repo-guard 管理的配置、Hook、CI、忽略项、AGENTS 策略块和项目脚本 |
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

pre-commit 从不运行项目级 fix。`lint-staged` 只暴露本次暂存快照，完成后把修复写回索引，并恢复同一文件中的未暂存内容；任一步失败都会恢复执行前状态。

### 5.3 安全与 Vue 静态规则

| 能力 | 检查内容 |
|---|---|
| 动态代码 | AST 检查 `eval` 和 `Function` 构造器，忽略注释与字符串中的普通文本 |
| Vue 不安全 HTML | 检查模板中的 `v-html`，要求精确且有效的结构化例外 |
| 新窗口链接 | `target="_blank"` 必须静态证明同时包含 `noopener` 和 `noreferrer` |
| Vue 表单标签 | 原生表单控件必须具有可静态验证的可访问名称 |
| Vue 图片替代文本 | 原生图片必须具有符合规则的 `alt` |

这些原生 Vue 规则不依赖项目额外安装 lint 插件，并在 pre-commit 与 CI policy 中执行。结构化例外必须精确匹配规则、文件和位置，并受生效时间、到期时间和维护者信息约束。

### 5.4 仓库文件与代码治理

| 能力 | 配置位置 | 主要行为 |
|---|---|---|
| 文件归位 | `preCommit.filePlacement` | 通过 glob 限制文件允许目录；支持只检查新位置或检查所有变更文件，并给出建议目录 |
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

### 5.5 依赖与架构治理

| 能力 | 配置位置 | 主要行为 |
|---|---|---|
| 依赖声明 | `dependencyPolicy` | 检查精确版本、允许协议、禁用包、依赖分组和结构化例外 |
| 锁文件 | `dependencyPolicy.requireLockfile` | `package.json` 与 `package-lock.json` 必须同步，删除或缺失锁文件会阻断 |
| 暂存快照 | 依赖门禁内置 | pre-commit 使用最终 Git 索引中的 package/lock 内容，不受未暂存副本影响 |
| 依赖架构 | `architecture` | 使用消费项目的 dependency-cruiser 和配置，执行项目声明的模块方向规则 |

repo-guard 不替业务项目设计依赖层级；它负责验证项目已有架构配置能够执行并把违规转换为统一结果。

### 5.6 测试、覆盖率与可访问性测试

| 能力 | 配置位置 | 主要行为 |
|---|---|---|
| 单元测试映射 | `unitTest` | 按源码 glob 和映射模板要求新增或变更源码存在对应 `.spec/.test` 文件 |
| 测试语义 | `unitTest` | 拒绝空测试文件以及 `.skip`、`.skipIf`、`.todo`、`.only` 绕过 |
| Vitest 执行 | `unitTest.script` | 运行项目精确 npm script，并保留结构化 diagnostics |
| 组件交互 | `unitTest.componentInteraction` | 对交互型 Vue 组件要求 mount、真实 trigger/setValue 等交互及交互后断言 |
| 覆盖率 | `unitTest.coverage` | 强制生成新 `json-summary` 和 LCOV，检查全局行/语句/函数/分支及 Git 变更行覆盖率 |
| axe 测试 | `accessibilityTest` | 支持 vitest-axe、jest-axe、Playwright、Cypress 和 axe-core；要求真实扫描与零违规断言 |

覆盖率只统计 LCOV 中可执行的变更行；缺少目标源码记录会失败，避免未导入文件逃逸。repo-guard 不复用旧报告，不允许通过降低阈值或扩大排除项修复违规。

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

### 5.9 GitLab CI

| 配置档 | 固定能力 |
|---|---|
| `policy` | 结构化例外、安全与 Vue 可访问性、依赖、文件归位、代码位置、行数、测试策略和保护文件 |
| `full` | `policy` 加只读 Stylelint、ESLint、Prettier、类型检查、完整单元测试/覆盖率、axe、架构和构建 |
| `release-ready` | `policy` 加项目 `check`、项目 `test`、构建、可选 Lighthouse 和发布包一致性检查 |

CI 使用明确 base/head 或 GitLab 提供的可信范围。浅克隆缺少基准提交时返回范围错误，不会把未知范围当成空变更。

CI 始终只读：不执行 fix、不安装 Hook、不读取本地企业微信凭据、不发送通知。报告写入 `reports/` 下经过验证的 JSON 路径，并可以作为 GitLab artifact 保留。

### 5.10 发布就绪

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

### 6.1 pre-commit

顺序由锁定 Execution Plan 固定，项目配置不能重排：

```text
Stylelint fix
  → ESLint fix
  → Prettier
  → Stylelint read-only verify
  → ESLint read-only verify
  → dynamic-code
  → Vue v-html
  → Vue target=_blank
  → Vue form label
  → Vue image alt
  → maximum-file-lines
  → file-placement
  → dependency-policy（最终 Git 索引）
  → code-placement（最终 Git 索引）
  → protected-files（最后执行）
```

禁止加入 pre-commit 的能力：TypeScript 类型检查、单元测试、axe、dependency-cruiser 项目架构、构建和 Lighthouse。

### 6.2 pre-push

```text
typecheck
  → unit-test（包含可选 coverage/componentInteraction）
  → accessibility-test
  → architecture
  → build
  → lighthouse
```

每项按配置启用状态决定执行或跳过，并对本次推送使用精确变更范围。

pre-push 的 TypeScript、单元测试、axe 和构建脚本通过统一异步进程能力执行：门禁开始前立即显示中文进度，子进程 stdout/stderr 经路径和敏感信息脱敏后实时写入终端，同时保留执行结果用于失败判定。超时或计划取消会终止完整进程树。dependency-cruiser 的 stdout 是结构化 JSON，不直接转发，但架构门禁会在分析开始前显示进度。

### 6.3 CI 与 release-ready

CI 使用锁定计划聚合所有结果，并将每一步的 GateResult 写入统一报告。`full` 不运行 Lighthouse；Lighthouse 只在 manual、可选 pre-push 和 release-ready 中运行。

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

### 7.2 官方专项命令

```text
exceptions
dependencies
build
architecture
typecheck
unit-test
dynamic-code
unsafe-html
target-blank
form-labels
image-alt
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
styleComplexity
styleGovernance
maxFileLines
filePlacement
codePlacement
dependencies
architecture
build
lighthouse
typeCheck
unitTest
accessibilityTest
componentInteraction
coverage
notification
ci
```

原生动态代码与 Vue 安全/静态可访问性规则没有关闭开关。

## 8. 配置结构

当前配置版本固定为 `version: 1`，顶层字段如下：

| 字段 | 职责 |
|---|---|
| `$schema` | 引用 npm 包导出的配置 Schema |
| `version` | 当前配置契约版本，只接受 `1` |
| `notification` | 企业微信通知开关 |
| `ci` | CI 开关、配置档、报告路径和保护文件行为 |
| `externalGates` | 项目自有外部门禁声明 |
| `codePlacement` | 精确代码文本允许位置规则 |
| `exceptions` | 精确、限时、可审计的结构化例外 |
| `dependencyPolicy` | 依赖声明与 lockfile 治理 |
| `architecture` | dependency-cruiser 门禁 |
| `build` | 独立构建门禁 |
| `lighthouse` | Lighthouse 配置和自动执行开关 |
| `typeCheck` | TypeScript 脚本门禁 |
| `accessibilityTest` | axe 测试策略和脚本 |
| `unitTest` | 单元测试、组件交互和覆盖率 |
| `preCommit` | Stylelint、ESLint、Prettier、行数和文件归位 |
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
- `@cxyi7/repo-guard/external-report.schema.json`；
- `@cxyi7/repo-guard/gate-result.schema.json`。

内部 runner、具体 Gate、integration 和 orchestration 不属于公共 API。

## 10. 中文输出与安全约束

- repo-guard 自有状态、警告、错误、证据、期望和修复说明必须使用简体中文。
- 机器 ID、命令、路径、包名、协议枚举和第三方规则 ID 保持稳定原值。
- 第三方原始输出只能进入标记了 source/stream 的 diagnostics，或作为经过脱敏的 pre-push 实时输出；不能替代主要中文问题说明。
- 标准检查使用零英文债务基线；新增功能不能扩大或重新生成该基线。
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
- 不允许外部门禁配置任意 shell command 或加载任意 JavaScript 插件。
- 不隐式上传 Lighthouse 或其他报告。
- 不自动关闭规则、降低阈值、扩大排除项或生成绕过例外。
- 不执行 npm 发布、部署、生产环境写入或凭据操作。

## 12. 维护要求

- 新能力必须先确定所属领域，保持事实、策略、Gate 和编排职责分离。
- Registry 是能力目录的单一事实来源，Execution Plan 是生命周期顺序的单一事实来源。
- 每个行为变化必须同步测试、README、配置 Schema 和 changelog。
- 本文档是长期维护的项目结构与功能事实清单；新增、修改或删除功能，以及调整仓库目录、模块职责或依赖方向时，必须在同一变更中同步更新对应章节。
- 每个可独立发布的功能单独评审和版本化，不与下一个功能捆绑。
- 发布前必须执行 `npm run check`、`npm test` 和 `npm run pack:check`。
- 文档功能清单应以当前 Registry、Execution Plan、配置 Schema 和实际测试为准，不以历史 changelog 推断当前行为。
