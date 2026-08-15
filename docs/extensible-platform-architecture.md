# 可扩展纯门禁平台架构

## 1. 文档目的

本文定义 `@cxyi7/repo-guard` 作为“纯门禁平台”的长期架构，并评估当前实现与该目标的符合程度。

这里的“纯门禁平台”是指：

> `repo-guard` 只在开发、提交、推送、CI 和发布准备阶段检查仓库是否满足策略，不向消费项目的生产代码提供任何运行时功能，也不执行发布或部署本身。

平台可以检查接口测试、页面测试、性能、OpenAPI 或构建结果，但不实现项目的请求客户端、业务接口、页面流程或部署系统。具体能力始终由消费项目及其工具链拥有，`repo-guard` 负责发现、校验、编排、判定和报告。

本文描述目标架构和渐进迁移方案，不表示所有目标模块已经实现。当前行为仍以实际代码、README 和配置 Schema 为准。

## 2. 产品边界

### 2.1 repo-guard 负责什么

- pre-commit、pre-push、CI 和发布准备阶段的门禁；
- 项目配置、迁移、Schema、doctor 和环境诊断；
- Git 变更范围、暂存快照和精确推送范围识别；
- 调用消费项目已有的 lint、测试、类型检查、构建和审计工具；
- 通用且稳定的静态仓库规则；
- 门禁排序、依赖、超时、取消、退出状态和报告；
- 结构化例外、保护文件、备案和审计信息；
- GitLab CI 等交付平台的保守接入；
- 面向人和自动化系统的诊断及修复建议。

### 2.2 repo-guard 不负责什么

- HTTP Request Client、Axios/fetch 封装或 Token 刷新；
- 业务 API SDK、接口路径、参数或响应 Schema；
- 项目业务成功码、错误提示、路由跳转或状态管理；
- 页面组件、业务流程、测试账号或业务测试数据；
- 替代 ESLint、Stylelint、Prettier、Vitest、Playwright 或 Lighthouse；
- 自动访问业务后端、生产环境或共享测试环境；
- 发布 npm 包、部署应用、批准变更或自动创建例外；
- 进入消费项目的浏览器或服务端生产构建。

因此，本包保持为开发依赖。任何需要进入项目生产产物的通用功能都应该位于其他专用包中。

## 3. 当前架构是否符合

结论：**1.4.0 已完成阶段 8 的目录依赖边界自动化，1.4.1 将项目依赖解析迁入 `core/project`，1.4.2 至 1.4.5 完成 Lighthouse integration、quality gate 与 setup orchestration 归位，1.4.3 同时纠正结构化进程失败 guidance 的结果模型归属，1.4.6 将 Stylelint 项目事实与 setup readiness 分别归入 integration 和 quality gate，1.4.7 将共享 Vue 模板静态解析事实迁入 `integrations/vue`，1.4.8 至 1.4.9 将 build 与 typecheck 的执行、结构化判定和初始化 readiness 分别归入 npm integration 与 quality gate，1.4.10 将 dependency-cruiser 执行事实与架构策略判定分层，1.4.11 将 axe 项目/执行事实与可访问性测试策略判定分层，1.4.12 将 CI 执行与报告持久化归入 orchestration，1.4.13 将 Vitest 覆盖率报告事实与 testing gate 阈值判定分层，1.4.14 将 Vitest 项目/执行事实与单元测试策略判定分层，1.4.15 将 package/Git index 元数据事实与依赖治理判定分层，1.4.16 将 ESLint 项目/执行事实与 quality policy 判定分层，1.4.17 将 Prettier 项目/格式化事实与 quality policy 判定分层，1.4.18 将 Stylelint 项目/执行事实与 quality policy 判定分层，1.4.19 将 staged quality 执行迁入 `orchestration/pre-commit`；顶层 `*-project.js` 与 runner/policy/parser 待迁移清单均已清空，阶段 8 的目录迁移和公共 API 收敛已完成。**

### 3.1 已经符合的部分

| 维度 | 当前情况 | 结论 |
| --- | --- | --- |
| 生产边界 | 当前没有浏览器请求运行时、业务 SDK 或生产组件 | 符合 |
| 工具所有权 | ESLint、Prettier、Stylelint、Vitest、dependency-cruiser、LHCI 等使用消费项目安装和配置 | 符合 |
| pre-commit | 只处理暂存内容，并通过 `lint-staged` 保留部分暂存和未暂存修改 | 符合 |
| pre-push | 读取推送提交配置，并要求精确 HEAD 和干净工作区后运行重型门禁 | 符合 |
| CI | 提供只读 `policy`、`full`、`release-ready` profile 和结构化 JSON 报告 | 符合 |
| 职责拆分 | 保护文件检查与暂存代码质量检查是独立模块 | 符合 |
| 安全规则 | 动态代码和 Vue 硬规则不依赖消费项目 ESLint 配置 | 符合 |
| 例外治理 | 例外精确、限时、独立审批，且不能由工具自动新增或续期 | 符合 |
| 配置演进 | 配置迁移幂等，显式配置优先；缺省字段采用当前平台默认值，不保留旧默认语义 | 符合 |
| 交付安全 | Lighthouse 不隐式上传，CI 报告路径受到保护 | 符合 |

这些原则应视为平台不变量，后续内部重构不能改变。

### 3.2 尚未完全符合的部分

| 问题 | 当前表现 | 影响 |
| --- | --- | --- |
| 文件结构偏平 | `src` 根目录仍保留一组迁移前 runner、policy 和 parser | 已冻结清单且不能继续扩张，但仍需随独立功能逐项迁入目标目录 |

以上问题不意味着当前实现错误；它们是从“已有门禁工具”继续扩展为“门禁平台”时需要解决的结构性限制。

## 4. 核心架构原则

### 4.1 只检查，不拥有业务功能

门禁可以验证某项能力，但不能成为该能力的生产实现：

```text
消费项目：实现、配置和运行具体功能
repo-guard：验证前置条件、编排检查、解释结果、决定是否放行
```

例如，接口测试扩展应运行项目的 `test:api` 脚本并验证报告，而不是由 repo-guard 保存 endpoint 或主动组织真实业务请求。

### 4.2 使用消费项目工具链

门禁不得私自引入另一套业务规则或运行环境：

- lint 使用项目安装和配置；
- 测试使用项目脚本、测试框架和 fixture；
- 页面测试使用项目 Playwright、Chrome、路由和账号注入；
- 构建使用项目 build 脚本；
- Lighthouse 使用项目路由、assertions 和报告策略；
- CI Secret 只由交付平台注入，不进入仓库配置和报告。

### 4.3 门禁与编排分离

单个门禁只负责一类判定。编排器负责：

- 选择门禁；
- 验证执行环境；
- 解析依赖和固定顺序；
- 提供变更范围与执行上下文；
- 聚合结果和决定最终退出码。

门禁不得自行调用下一个门禁，也不得知道自己位于 CLI、Hook 还是 CI。

### 4.4 默认只读，修改必须受控

每个门禁必须声明自己的副作用等级：

- `read-only`：只读取并报告；
- `working-tree-fix`：可以修改被授权的工作区文件；
- `managed-files`：只修改 repo-guard 明确管理的文件块；
- `external-write`：外部写操作，默认禁止在门禁执行中使用。

pre-commit 自动修复是受控例外，必须继续通过 `lint-staged` 隔离暂存内容并支持整体恢复。CI 和发布准备门禁默认只读。

### 4.5 失败分类稳定

内部结果必须区分：

- `passed`：策略通过；
- `skipped`：配置明确关闭或没有适用对象；
- `violation`：发现策略违规；
- `configuration-error`：配置或环境不完整；
- `execution-error`：工具崩溃、超时或报告损坏；
- `range-error`：无法可信确定 Git 检查范围。

CLI 再将内部状态稳定映射为现有退出码，避免每个 runner 自己解释数字。

所有失败统一进入 `GateResult` JSON v2。规则违规返回 `kind: violation` finding；配置、执行、范围、安全、内部和取消异常由 `RepoGuardError` 分类。面向 AI 的 `issues` 必须自包含稳定代码、相对位置、证据、预期、结构化修复步骤/约束/验证、审批要求和指纹。原始工具输出只能作为带来源、流、脱敏和截断元数据的 diagnostics，不能替代可操作问题。

仓库维护的 `src` 与 `test` 禁止构造裸 `Error`/`AggregateError` 或直接重抛未分类异常。第三方异常必须在最接近其语义的边界转换；只有不可进入业务报告的参数契约可以在静态白名单内使用 `TypeError`。递归静态测试排除 `.tmp`、构建缓存和第三方依赖，防止仓库自有代码退回泛化错误。

## 5. 目标模块结构

目标结构保持一个 npm 包，但仅包含 Node.js 门禁平台能力：

```text
@cxyi7/repo-guard
│
├─ core/
│  ├─ capability/               门禁定义、注册、依赖图和选择
│  ├─ config/                   配置、迁移、Schema 和归一化
│  ├─ execution/                子进程、超时、取消和并发
│  ├─ changes/                  staged、push、revision 变更范围
│  ├─ result/                   状态、finding、artifact 和摘要
│  ├─ report/                   console、JSON、JUnit 等 renderer
│  ├─ policy/                   受管文本块和策略生命周期
│  ├─ project/                  根目录、路径、依赖和工具发现
│  └─ security/                 Secret 脱敏、路径和 artifact 安全
│
├─ gates/
│  ├─ repository/               保护文件、文件归位、文件规模
│  ├─ quality/                  ESLint、Prettier、Stylelint
│  ├─ security/                 动态代码、Vue 安全规则
│  ├─ accessibility/            label、alt、axe 编排
│  ├─ dependencies/             声明、锁文件、来源策略
│  ├─ architecture/             dependency-cruiser
│  ├─ testing/                  单测策略、覆盖率、外部测试报告
│  ├─ build/                    typecheck 和 build 脚本
│  └─ performance/              Lighthouse 和性能报告预算
│
├─ policies/                    集中的 AGENTS.md 受管提示目录
│
├─ orchestration/
│  ├─ cli/                      命令解析和展示
│  ├─ hooks/                    Hook 安装和消息生命周期
│  ├─ pre-commit/               固定暂存流水线
│  ├─ pre-push/                 精确推送快照流水线
│  ├─ ci/                       policy、full 和 release-ready
│  └─ doctor/                   基于门禁元数据聚合诊断
│
└─ integrations/
   ├─ git/
   ├─ gitlab/
   ├─ npm/
   ├─ lint-staged/
   ├─ eslint/
   ├─ prettier/
   ├─ stylelint/
   ├─ vue/
   ├─ dependency-cruiser/
   ├─ vitest/
   ├─ axe/
   └─ lighthouse/
```

目录是依赖边界的结果，不是第一阶段目标。应先建立协议和测试，再随独立功能逐步迁移文件，避免一次性重排整个仓库。

### 5.1 依赖方向

```text
orchestration ─────▶ core/capability + core/report
       │
       └───────────▶ gates

gates ─────────────▶ core
  │
  └────────────────▶ integrations

integrations ───────▶ core 的稳定类型
core ───────────────▶ Node.js 标准库和最小通用依赖
```

禁止：

- `core` 导入具体 gate；
- 一个 gate 深层导入另一个 gate；
- gate 导入 CLI、Hook、CI 或 console renderer；
- integration 决定策略是否通过；
- orchestration 重复实现 gate 的检查规则；
- 包中出现浏览器生产入口或业务项目源码。

需要组合的规则通过 Capability 依赖表达，不通过模块互相调用表达。

这些边界必须最终由 dependency-cruiser 和仓库测试强制，而不是只写在文档中。至少应验证：

- `core` 不依赖 `gates`、`orchestration` 或具体 integration；
- `gates` 不依赖 `orchestration`，不同 gate 不进行深层互相导入；
- gate 不直接使用 `console`、设置 `process.exitCode` 或重新收集 Git 范围；
- integration 不产生策略判定，只返回工具或平台事实；
- `orchestration` 不包含具体规则实现；
- 不再新增未归类的顶层 runner、policy 或 parser；
- 外部门禁配置不能形成任意 shell 执行入口。

架构规则先以 warning 观察现状，再随模块迁移逐项升级为 error；已经升级为 error 的边界不能为了迁移便利重新降级。

## 6. Gate Capability 协议

### 6.1 定义

每项官方门禁使用内部协议声明：

```ts
defineGate({
  id: 'quality.eslint',
  configKey: 'preCommit.eslint',
  environments: ['manual', 'pre-commit', 'ci-full'],
  mutation: 'working-tree-fix',
  defaultTimeoutMs: 120000,
  requires: [],
  before: ['quality.prettier'],
  inspectSetup,
  plan,
  run,
});
```

统一元数据至少包含：

- 稳定且唯一的 ID；
- 配置位置和支持的配置版本；
- 支持的执行环境；
- 副作用等级；
- 默认超时和取消能力；
- 依赖、前置、后置和互斥关系；
- 所需项目工具、脚本、环境变量和 Secret 类型；
- 是否生成 artifact；
- 是否支持自动修复；
- setup 诊断、执行计划和运行函数。

### 6.2 执行上下文

编排器向门禁传入统一且不可变的上下文：

```ts
interface GateContext {
  root: string;
  environment: GateEnvironment;
  config: NormalizedConfig;
  changes: ChangeSet;
  revision: RevisionRange | null;
  signal: AbortSignal;
  artifactDirectory: string | null;
  logger: StructuredLogger;
}
```

门禁不能自行重新推断另一套 Git 范围。所有需要变更信息的门禁必须使用同一个 `ChangeSet`，从而保证保护文件、测试策略和变更行覆盖率看到的是同一份事实。

### 6.3 结果模型

门禁返回数据，不直接决定进程退出：

```ts
interface GateResult {
  gateId: string;
  status: GateStatus;
  summary: string;
  findings: Finding[];
  issues: ActionableIssue[];
  artifacts: Artifact[];
  metrics: Record<string, number>;
  diagnostics: Diagnostic[];
  durationMs: number;
  error?: NormalizedError;
}

interface ActionableIssue {
  id: string;
  kind: 'violation' | 'configuration' | 'execution' | 'range' | 'security' | 'internal' | 'cancellation';
  gateId: string;
  ruleId: string;
  code: string;
  severity: 'info' | 'warning' | 'error';
  location: Location | null;
  message: string;
  evidence: Evidence[];
  expected: string;
  remediation: { goal: string; steps: string[]; constraints: string[]; verification: string[] };
  decision: { aiAction: string; humanApprovalRequired: boolean };
  fingerprint: string;
}
```

`Finding` 是 `kind: violation` 的 `ActionableIssue`。console、JSON 和未来 JUnit 由 renderer 根据同一结果生成，避免规则同时维护多套文案和结构。

AI 使用 JSON `issues` 作为规范输入；console 只负责将同一字段排版为可读块，不维护另一套修复指令。

写入 `AGENTS.md` 的长期 AI 约束与一次门禁执行的 finding 分属不同生命周期，但同样不能散落在 runner 或规则文件。受管块的 marker、幂等写入和 current 校验统一位于 `core/policy`，例外、架构、单元测试和 axe 的模板统一注册在 `policies/managed-policies.js`；进程失败 remediation 则由 `core/result` 的 process failure guidance 按稳定 Gate ID 提供，`core/report` 只负责 renderer。

所有官方门禁必须直接返回结构化 finding 和 metric，不得以 console 文本或数字退出码作为内部事实来源。0.x 迁移期曾使用的数字 runner adapter、旧 facade 和重复 command wrapper 已在 1.0.0 删除；后续阶段不得重新引入兼容旁路。

### 6.4 注册与校验

官方门禁使用仓库内部静态注册表，不允许运行时从任意 npm 包自动发现代码。启动时应在运行任何门禁前验证：

- ID 和配置键是否重复；
- 依赖是否存在；
- 排序是否形成环；
- 当前环境是否允许该门禁和副作用；
- 配置启用项是否存在对应门禁；
- 所需工具、脚本和 Secret 是否满足。

静态注册比自动插件扫描更容易审计、测试和保持发布兼容性。

### 6.5 Registry 与 Execution Plan

Gate Registry 是“平台拥有哪些能力”的唯一事实来源，负责提供：

- 门禁 ID、配置键和可启停信息；
- manual command 和 doctor 元数据；
- 支持的生命周期、副作用和前置条件；
- CI 可选择的门禁及其结果类型；
- README 能力矩阵和 Schema 同步检查所需元数据。

Registry 不负责决定某个生命周期的最终执行顺序。顺序由经过代码评审的 Execution Plan 定义：

```ts
defineExecutionPlan({
  id: 'pre-commit',
  locked: true,
  steps: [
    'quality.stylelint-fix',
    'quality.eslint-fix',
    'quality.prettier',
    'quality.stylelint-verify',
    'quality.eslint-verify',
    'security.hard-rules',
    'repository.maximum-file-lines',
    'repository.file-placement',
    'dependencies.staged-policy',
    'repository.protected-files',
  ],
});
```

二者职责必须保持独立：

- Registry 回答“有什么、能在哪里运行”；
- Execution Plan 回答“本次运行什么、按什么顺序”；
- 项目配置只能启停允许配置的门禁，不能修改 locked plan 的顺序；
- plan 中引用的门禁必须存在于 Registry，并在执行前完成依赖和环境校验；
- CLI、doctor、CI 和 Hook 不得保留与 Registry 平行的第二份能力清单。

## 7. 三类门禁

### 7.1 内建规则门禁

适用于 repo-guard 可以稳定、通用地解释的仓库规则，例如：

- 保护文件；
- 文件归位和行数；
- 依赖声明与锁文件；
- 动态代码执行；
- Vue `v-html`、`target=_blank`、label 和 alt；
- 结构化例外。

这些门禁可以直接读取仓库文件，但必须输出统一结果。

### 7.2 工具适配门禁

适用于已有专业工具：

- ESLint、Prettier、Stylelint；
- dependency-cruiser；
- Vitest 和覆盖率；
- axe、Lighthouse；
- TypeScript 和项目构建。

repo-guard 负责检查工具是否存在、以受控参数运行、归一化结果和防止明显绕过；规则与环境仍属于消费项目。

### 7.3 项目脚本门禁

适用于 API 测试、页面测试、视觉回归、OpenAPI diff、包体积或其他项目特有验证。repo-guard 不理解其业务实现，只执行声明的项目脚本并验证标准报告。

配置示例：

```json
{
  "externalGates": [
    {
      "id": "project.api-test",
      "enabled": true,
      "environments": ["manual", "ci-full", "release-ready"],
      "script": "test:api",
      "timeoutMs": 300000,
      "report": {
        "format": "repo-guard-json-v1",
        "path": "reports/api-test.json"
      }
    }
  ]
}
```

安全约束：

- 只能运行 `package.json` 中已存在的精确脚本名；
- 不接受任意 shell 命令、命令拼接或内联脚本；
- pre-commit 默认禁止项目脚本门禁；
- CI 外部门禁只允许 GitLab 明确标记为受保护引用的 CI full 或 release-ready；
- 每项门禁有超时、取消和 artifact 上限，并在固定计划中串行执行；
- 报告必须通过版本化 Schema 校验；
- repo-guard 不加载项目 JavaScript 作为进程内插件；
- 报告在汇总前执行路径检查和敏感信息检查。

这种机制允许扩展项目检查范围，同时不把项目接口或页面逻辑放入 npm 包。

## 8. 生命周期编排

### 8.1 Manual

显式命令用于本地诊断和单项检查。manual 可以运行门禁的全项目模式，但仍遵守副作用声明和项目配置。单项命令逐步由注册表生成，避免 CLI switch 持续膨胀。

### 8.2 Pre-commit

pre-commit 的现有固定顺序必须保持：

```text
lint-staged 隔离暂存内容
  → Stylelint fix
  → ESLint fix
  → Prettier
  → Stylelint verify
  → ESLint verify
  → 硬性静态安全与可访问性规则
  → 最大文件行数
  → 文件归位
  → 恢复未暂存内容并写回最终暂存结果
  → 暂存依赖策略
  → 独立的保护文件门禁
  → 提交信息文件清单
```

这里不追求完全自由排序。平台协议必须能表达“受保护的固定流水线”，防止配置或新增能力破坏安全顺序。

pre-commit 禁止：

- 项目级全仓 fix；
- TypeScript 类型检查；
- Lighthouse、页面或真实接口测试；
- 需要 Secret 的网络检查；
- 无法恢复的工作区修改。

### 8.3 Pre-push

pre-push 继续读取待推送提交中的配置，并在启用重型门禁时验证精确 HEAD 和干净工作区。默认顺序保持：

```text
typecheck
  → unit test / coverage / component interaction
  → axe accessibility test
  → architecture
  → build
  → Lighthouse
```

项目脚本门禁只有显式配置后才能进入 pre-push；需要共享环境或高权限 Secret 的门禁应留在 CI。

### 8.4 CI

保留现有 profile 语义：

- `policy`：结构化例外、硬性规则、依赖策略、文件规则、变更测试策略和保护文件；
- `full`：在 policy 基础上运行已启用的全项目 lint、类型检查、测试、架构和构建。

`release-ready` 执行计划只回答“是否具备发布条件”，不执行 publish 或 deploy。典型内容包括：

- `npm run check`；
- 完整测试；
- 包内容和依赖审计；
- 构建与 artifact 完整性；
- 版本、changelog 和配置 Schema 同步；
- 项目显式声明的发布前外部门禁。

profile 应由“已审核的执行计划”选择门禁，不能允许任意配置重排 pre-commit 的固定顺序。

### 8.5 生命周期矩阵

| 门禁类型 | Manual | Pre-commit | Pre-push | CI policy | CI full | Release-ready |
| --- | --- | --- | --- | --- | --- | --- |
| 内建硬规则 | 是 | 是 | 通常否 | 是 | 是 | 是 |
| 暂存自动修复 | 可选 | 是 | 否 | 否 | 否 | 否 |
| lint 全项目只读 | 是 | 否 | 否 | 否 | 是 | 是 |
| typecheck / unit / build | 是 | 否 | 是 | 否 | 是 | 是 |
| Lighthouse | 是 | 否 | 可选 | 否 | 可配置 | 可配置 |
| 项目外部门禁 | 是 | 默认否 | 显式启用 | 默认否 | 显式启用 | 显式启用 |
| publish / deploy | 否 | 否 | 否 | 否 | 否 | 否 |

## 9. 标准外部门禁报告

项目脚本通过标准文件与 repo-guard 交换结果，而不是向 repo-guard 注册业务代码。

最低报告结构：

```json
{
  "schemaVersion": 1,
  "gateId": "project.api-test",
  "status": "passed",
  "summary": "12 cases passed",
  "findings": [],
  "metrics": {
    "cases": 12
  },
  "artifacts": []
}
```

要求：

- `gateId` 必须与配置一致；
- `status` 不能与脚本退出状态矛盾；
- 未生成、过期、损坏或 Schema 不匹配的报告视为执行错误；
- 报告只接受当前 Schema 明确定义的字段；协议升级必须同步修改 Schema、实现、测试和文档，不接受未知字段或旧协议兼容分支；
- artifact 必须位于允许目录，不能覆盖已跟踪文件或穿越符号链接；
- 日志和报告禁止包含 Token、Cookie、密码、私钥或完整敏感请求体；
- repo-guard 只汇总结果，不推断项目接口语义。

JSON 是统一汇总协议；JUnit 可以作为附加 artifact 保留给 GitLab 等平台展示，不能替代机器可验证的主报告。

## 10. 配置演进

### 10.1 严格使用当前配置契约

当前平台只接受 `version: 1` 的现行 Schema。配置迁移可以补齐当前字段并保留显式值，但不得接受已删除的字段形态、旧类型或旧默认语义。以下顶层字段构成当前契约：

- `preCommit`；
- `dependencyPolicy`；
- `architecture`；
- `typeCheck`；
- `unitTest`；
- `accessibilityTest`；
- `build`；
- `lighthouse`；
- `ci`；
- `notification`；
- `rules`、`exclusions` 和 `exceptions`。

缺省字段直接使用当前默认值。任何不兼容变更都必须作为明确的主版本发布，并同步代码、测试、README、Schema 与 changelog；不设置双读、别名、静默回退或临时兼容 adapter。

### 10.2 新配置只表达门禁

未来配置允许增加：

- 外部门禁脚本和标准报告；
- profile 选择；
- 通用超时、并发和 artifact 限制；
- 不涉及业务语义的门禁阈值。

配置禁止包含：

- 真实接口、base URL 和业务路由；
- 账号、Token、Cookie、密码或私钥；
- 业务请求参数、响应 Schema 和测试数据；
- publish token 或部署凭据；
- 任意 shell command。

### 10.3 单一能力目录

当前多处重复的可配置功能列表应逐步由 Gate Registry 派生：

- CLI `enable` / `disable` 支持项；
- doctor 检查项；
- Schema 中的能力元数据；
- manual 命令路由；
- CI 和 Hook 可用门禁；
- README 能力矩阵。

Schema 和 README 仍应生成后提交并接受人工评审，不能在安装时动态改变。

## 11. Doctor 模型

doctor 应从每个 Gate Capability 的 `inspectSetup` 聚合诊断，统一状态：

- `ready`：启用且前置条件完整；
- `disabled`：明确关闭；
- `unavailable`：项目未安装可选工具；
- `misconfigured`：启用但配置不完整；
- `outdated`：受管理文件或集成版本落后；
- `unsafe`：发现 Secret、被篡改集成或不安全报告路径。

`doctor --fix` 只能执行声明为 `managed-files` 的修复：

- 配置迁移；
- 托管 Hook；
- 托管 CI 模板；
- `.gitattributes`、`.gitignore` 和本地环境模板；
- AGENTS.md 中有明确标记的受管理块；
- 项目 `guard:*` 脚本。

它不能安装项目工具、填写 Secret、修改业务代码、降低规则、创建例外或执行发布。

## 12. 安全与信任边界

- pre-commit 输入是不可信的暂存代码，但不得获得业务 Secret；
- pre-push 默认使用本地开发者权限，因此网络门禁必须显式启用；
- CI policy Job 不应获得业务环境 Secret；
- fork MR 和不可信分支不得执行带 Secret 的外部门禁；
- CI full 和 release-ready 对 Secret 使用最小权限和受保护环境；
- 子进程使用参数数组或精确 npm script，不拼接 shell 命令；
- 所有子进程必须支持超时、终止和输出上限；
- artifact 路径必须限制在仓库内允许目录并拒绝符号链接穿越；
- 日志、结果和通知必须统一脱敏；
- 门禁失败不能通过自动关闭规则、扩大 ignore、降低阈值或伪造报告修复。

## 13. 渐进实施方案

每个阶段作为独立功能、独立评审和独立发布，不能捆绑到已完成评审的版本中。

从第一阶段起，所有新平台模块直接进入目标目录；旧文件不批量移动，而是在被改造时随对应功能迁移。1.0.0 起不允许新增兼容层，也不能继续把新 runner 写入当前扁平 `src` 根目录。

### 阶段 0：固化当前行为

- 记录所有 CLI 命令、参数、关键 console 输出和退出码；
- 固化 pre-commit、pre-push、CI policy、CI full 和 release-ready 的实际执行顺序；
- 为部分暂存、失败恢复、保护文件独立执行和精确推送快照补充特征测试；
- 生成当前模块依赖图并记录已知反向依赖；
- 审计包根 exports，区分已承诺公共 API 与偶然导出的内部 API；
- 建立迁移前后行为对照 fixture，覆盖通过、策略违规、配置错误、执行错误和范围错误。

验收：后续任一阶段都能自动证明用户可观察行为是否发生变化。

### 阶段 1：统一结果模型

实施状态：`0.16.0` 建立统一模型，1.0.0 删除临时 adapter，1.3.0 完成报告与提示链收口，1.4.3 将结构化进程失败 guidance 从 renderer 目录归入 `core/result`。统一模型与进程修复 guidance 位于 `src/core/result`，renderer 位于 `src/core/report`，受管策略生命周期位于 `src/core/policy`，`AGENTS.md` 模板位于 `src/policies`；所有官方门禁原生生成同一结果，消费项目子进程输出先进入 diagnostics，console 与 CI JSON 不再存在 gate/runner 专属旁路。

- 定义 `GateStatus`、`Finding`、`Artifact` 和 `GateResult`；
- 新模块直接创建在 `core/result` 和 `core/report`；
- 迁移期曾建立旧 runner adapter；该临时实现已在 1.0.0 删除；
- 建立 console 和 JSON renderer；
- 由唯一状态映射器产生 CLI 退出码。

验收：同一结果可以无损生成当前 console 输出和 CI JSON。

### 阶段 2：完成一个纵向试点

实施状态：`0.17.0` 完成动态代码试点；1.0.0 已删除旧包根 facade。动态代码门禁位于 `src/gates/security`，以 `security.dynamic-code` 注册到内部 Registry，原生返回 finding、metric 和诊断；manual CLI、pre-commit、CI 与 doctor 使用同一能力定义。

- 选择一个低副作用、只读且已有充分测试的门禁，例如动态代码或文件归位；
- 完整接通配置、Gate Definition、Registry、`inspectSetup`、manual CLI、CI、doctor 和 renderer；
- 让该门禁原生返回 finding、metric 和 artifact；
- 验证 GateContext 是否足以表达文件、变更范围、超时和诊断需求；
- 删除该门禁在 CLI、doctor 和 CI 中已经被 Registry 替代的重复清单。

验收：该门禁不再以 console 或退出码作为内部事实，且迁移前后特征测试完全一致。只有纵向试点通过后，才能批量迁移其他门禁。

### 阶段 3：内部 Gate Registry 与 Execution Plan

实施状态：`0.18.0` 建立静态 Registry 和 Execution Plan；1.0.0 已将全部官方门禁原生化并删除组合层数字适配。Registry 覆盖 Capability 的生命周期、副作用、超时、所需工具/项目脚本、artifact 和发现元数据，并校验重复 ID、配置键、manual command、未知关系、排序环路及未声明的副作用降级。

- 定义 `defineGate` 和静态注册表；
- 定义 `defineExecutionPlan`，建立 locked pre-commit plan 和已审核的 pre-push、CI plan；
- 按同一种纵向方式逐项注册硬性只读规则和独立命令；
- 从 Registry 派生 doctor、manual command 和可启停能力信息；
- 增加重复 ID、依赖缺失和环路测试。
- 增加测试，禁止 CLI、doctor、CI 和 Hook 新建平行能力清单；
- 保证项目配置不能重排 locked plan。

验收：Registry 成为唯一能力目录；新增一个简单只读门禁不需要修改 doctor、CLI 和 CI 的多个中央列表，生命周期顺序只由 Execution Plan 决定。

### 阶段 4：编排器收敛

实施状态：`0.19.0` 已完成。manual CLI、CI policy/full 与 pre-push 统一使用不可变 `GateContext`、同一 `ChangeSet`、逐 gate 超时/取消、结果聚合和唯一退出码映射；CI 的保护文件、测试策略、单元测试与变更行覆盖率共享同一范围事实，pre-push 保留既定顺序和精确推送快照约束。1.0.0 后不存在未原生化 runner。

- 提取统一 `GateContext`、ChangeSet、超时和取消；
- 将 CI 的步骤执行和结果聚合迁入通用 orchestrator；
- 保留 `policy`、`full` 的外部语义；
- 再让 pre-push 使用同一结果模型，但保持原有执行顺序和快照约束。
- 禁止 gate 自行收集 Git 范围，保护文件、测试策略和覆盖率统一使用同一 ChangeSet；
- 让 CLI 退出码只由统一状态映射器产生。

验收：CI 与 pre-push 不再重复解释门禁退出状态。

### 阶段 5：保护 pre-commit 固定流水线

实施状态：`0.20.0` 已完成。pre-commit 的完整步骤、顺序和副作用由专用受保护计划在启动时校验，暂存质量段与最终依赖/保护文件策略段只能从该计划派生；两段均通过统一 orchestrator 传递 `GateResult`，不保留 runner 内部数字结果协议。保护文件与暂存代码质量仍为独立 Capability，`lint-staged` 隔离、文件快照、部分暂存及失败恢复保持不变，Hook 外部仍使用既有 0/1 成败语义。计划明确拒绝全项目修复、类型检查、测试、构建和 Lighthouse 等网络门禁。

- 将质量步骤表示为不可由项目重排的受保护执行计划；
- 保持 Stylelint、ESLint、Prettier、只读复检和保护文件的既定顺序；
- 保持 `lint-staged`、文件快照、部分暂存和失败恢复；
- 只替换内部结果传递，不改变用户可观察行为。
- 继续保持保护文件门禁与暂存代码质量门禁为独立 Capability；
- 明确禁止 project-wide fix、类型检查和网络门禁进入该计划。

验收：现有 pre-commit 回归测试全部不变，并增加执行计划不可被配置重排的测试。

### 阶段 6：外部门禁脚本

实施状态：`1.1.0` 已完成。项目配置通过严格 `externalGates` 声明 `project.*` 能力，项目 Registry 从官方静态 Registry 派生；manual 使用统一 `external` 入口，CI full 只在全部官方步骤末尾追加已启用能力。执行器只调用精确 npm script，验证 `repo-guard-json-v1`、退出码、超时/取消、报告新鲜度、artifact 路径/大小、符号链接和敏感内容；不接受旧 runner、任意 shell command、JavaScript 插件或报告协议兼容分支。

- 定义 `externalGates` Schema；
- 定义 `repo-guard-json-v1` 报告 Schema；
- 实现 npm script 校验、超时、artifact 安全和脱敏；
- 首先只允许 manual 与受信 CI；
- 用不含真实接口的 fixture 验证 API 测试、页面测试等场景。

验收：消费项目可接入一种新的测试类型，而 repo-guard 不需要新增业务 runner。

### 阶段 7：发布准备计划

实施状态：`1.2.0` 已完成。`release-ready` 是新的可选 CI profile 和锁定 Execution Plan，复用 CI policy、项目精确 `check`/`test` scripts、build、可选 Lighthouse，并通过忽略 lifecycle scripts 的 npm pack dry-run 核验版本、lockfile、changelog、Schema 和发布 artifact。该生命周期只允许只读 Gate，使用环境变量白名单移除发布/部署/云凭证，拒绝发布或部署脚本，外部门禁仅能在受保护引用上固定追加；计划不生成 tarball，不执行 publish、deploy 或凭证操作。

- 在 CI 编排中增加可选 `release-ready` 计划；
- 复用 check、test、pack、build 和外部门禁结果；
- 检查版本、changelog、Schema 和 artifact 一致性；
- 明确不包含 npm publish、部署和凭据处理。

验收：平台能证明“可以发布”，但不会替用户执行发布。

### 阶段 8：完成目录迁移和公共 API 收敛

实施状态：`1.4.0` 已完成依赖边界自动化和公共 exports 防回归。dependency-cruiser 以 error 级别拒绝无法解析和循环依赖，并强制 `core`、`gates`、`orchestration`、`integrations` 的允许方向；迁移前的 commands/CLI 同样按 orchestration 入口约束。仓库测试用故意违规依赖图验证每条规则，禁止 gate 接管进程退出、重新收集 Git 范围或跨领域深层导入，冻结现有顶层 runner/policy/parser 与 gate 入口清单，并锁定公共 exports 的名称及目标。`1.4.1` 将项目依赖包清单和入口解析迁入 `core/project/package.js`；`1.4.2` 至 `1.4.5` 依次将 Lighthouse 项目发现与执行、结构化判定和安装期 ignore 状态归入 integration、quality gate 与 setup orchestration，并将进程失败 guidance 纠正到 `core/result`；`1.4.6` 将 Stylelint 包/配置事实迁入 `integrations/stylelint/project.js`，将 init readiness 迁入 `gates/quality/stylelint-setup.js`，顶层 `*-project.js` 清单收敛为空；`1.4.7` 将共享 Vue 模板标签、属性、元素和位置事实迁入 `integrations/vue/template-parser.js`，从顶层迁移清单移除最后一个 parser；`1.4.8` 将消费项目 build 脚本验证与执行迁入 `integrations/npm/build.js`，将结构化判定与 init readiness 分别迁入 `gates/quality/build-gate.js` 和 `build-setup.js`，从顶层迁移清单移除 build runner；`1.4.9` 以同样边界将 typecheck 脚本事实迁入 `integrations/npm/typecheck.js`，将判定与 readiness 迁入 `gates/quality/typecheck-gate.js` 和 `typecheck-setup.js`，从顶层迁移清单移除 typecheck runner；`1.4.10` 将 dependency-cruiser 的安装解析、CLI 执行、临时配置与 JSON 协议处理迁入 `integrations/dependency-cruiser/architecture.js`，将策略判定与 readiness 迁入 `gates/quality/architecture-gate.js` 和 `architecture-setup.js`，从顶层迁移清单移除 architecture runner；`1.4.11` 将 axe 集成识别、包解析和 npm 执行分别迁入 `integrations/axe/project.js` 与 `integrations/npm/accessibility.js`，将静态测试策略、readiness 和结构化判定迁入 `gates/testing`，从顶层迁移清单移除 accessibility-test runner；`1.4.12` 将 CI Execution Plan 编排迁入 `orchestration/ci/runner.js`，将报告路径安全与 JSON 持久化迁入 `orchestration/ci/report.js`，从顶层迁移清单移除 ci-runner；`1.4.13` 将 Vitest 覆盖率执行参数、报告准备与解析、精确 Git 变更行覆盖事实迁入 `integrations/vitest/coverage.js`，将阈值判定与 finding 迁入 `gates/testing/coverage-gate.js`，从顶层迁移清单移除 coverage runner；`1.4.14` 将消费项目包与 Vitest/Vue Test Utils 解析、测试源码调用事实解析和 npm 测试执行迁入 `integrations/vitest`，将 readiness、测试映射与绕过判定、Vue 交互策略、finding 和 GateResult 判定迁入 `gates/testing`，从顶层迁移清单移除 unit-test runner；`1.4.15` 将 package/lock JSON 和 Git index 暂存元数据事实迁入 `integrations/npm` 与 `integrations/git`，将依赖治理与例外判定迁入 `gates/repository/dependency-policy.js`，从顶层迁移清单移除最后一个 policy；`1.4.16` 将消费项目 ESLint/插件加载、忽略判断和 lint/fix 执行迁入 `integrations/eslint`，将 preset、warning 阈值、findings、失败回滚和 GateResult 判定迁入 `gates/quality`，从顶层迁移清单移除 ESLint runner；`1.4.17` 将消费项目 Prettier 加载、ignore/config/parser 检查、格式化和文件写入迁入 `integrations/prettier`，将配置/parser 判定、findings、失败回滚和 GateResult 判定迁入 `gates/quality`，从顶层迁移清单移除 Prettier runner；`1.4.18` 将消费项目 Stylelint 加载、项目配置解析和 lint 执行迁入 `integrations/stylelint`，将复杂度/样式治理规则、项目规则去重、结构化例外、warning 阈值、findings、失败回滚和 GateResult 判定迁入 `gates/quality`，从顶层迁移清单移除 Stylelint runner；`1.4.19` 将暂存文件选择、执行配置、GateContext、固定 Execution Plan 编排、结果渲染和失败回滚迁入 `orchestration/pre-commit/quality-runner.js`，保留独立的 `quality-gate.js` lint-staged 边界，并清空顶层 runner/policy/parser 待迁移清单。各版本均删除旧路径且不保留兼容转发；阶段 8 的目录迁移和公共 API 收敛已完成。

- 清理尚未随功能迁移的旧文件和临时 adapter；
- 使用 dependency-cruiser 强制 `core`、`gates`、`orchestration`、`integrations` 的依赖方向；
- 禁止 gate 直接 console、设置退出码、重新收集 Git 范围或跨 gate 深层导入；
- 禁止再向 `src` 根目录新增 runner、policy 和 parser；
- 审计包根 exports，区分承诺的公共 API 和内部 API；
- 包根公共导出已在 1.0.0 主版本直接收缩为当前平台契约；后续不得重新导出内部 runner。

验收：目标目录已形成，临时兼容层已有归零证明，依赖边界由自动化规则保证，且无消费项目生产代码依赖本包。

## 14. 不建议的改造方式

- 不要一次性移动全部 `src` 文件；
- 不要等到最后一阶段才开始使用目标目录，新模块从创建之初就应归位；
- 不要先公开第三方 JavaScript 插件 API；
- 不要允许配置任意 shell 命令；
- 不要为了“平台化”把每个小函数都抽象成插件；
- 不要让自由依赖图改变 pre-commit 的安全顺序；
- 不要把现有消费项目 API、页面流程或兼容层放入本仓库；
- 不要让 repo-guard 自动安装或替换消费项目工具；
- 不要把 publish、deploy 或生产环境写操作包装成门禁；
- 不要在同一版本同时实施结果模型、目录重排和多个新门禁。

## 15. 最终验收标准

纯门禁平台架构必须同时满足：

- 包可以始终作为消费项目的 `devDependency`；`1.4.21` 已冻结无自动安装或生产运行脚本的被动安装契约；
- npm 包不包含业务接口、请求运行时、页面功能或部署实现；`1.4.21` 已冻结受审的发布根目录、平台目录和既有顶层入口；
- 所有能力只在显式 CLI、Hook 或 CI 生命周期中运行；`1.4.22` 已冻结唯一 npm `bin` 启动器和 `runCli` 调用边界，并证明 CLI 模块导入不会读取消费项目配置或触发运行副作用；
- 导入包公共 API 不触发检查、文件写入、网络访问或进程执行；`1.4.20` 已用隔离进程动态阻断与空目录快照提供防回归证明；
- 每个门禁具有稳定 ID、执行环境、副作用、依赖和结果模型；
- Registry 是能力唯一事实来源，Execution Plan 是生命周期顺序唯一事实来源；
- 每个迁移完成的门禁原生返回结构化结果，而不是永久包装旧退出码；
- pre-commit 的固定顺序、部分暂存保护和失败恢复不变；
- 保护文件门禁与代码质量门禁继续分离；
- TypeScript、Lighthouse、页面测试和真实接口测试不进入 pre-commit；
- 外部工具继续使用消费项目安装、配置和运行环境；
- 项目特有检查可以通过受控 npm script 和版本化报告接入；
- repo-guard 无需理解项目接口、路由或业务响应即可判定外部门禁结果；
- doctor、CLI、CI 和报告从统一 Gate Registry 与结果模型获得能力信息；
- `core`、`gates`、`orchestration` 和 `integrations` 的依赖方向由自动化架构规则强制；
- CI 默认只读、Secret 最小授权、报告和通知默认脱敏；
- 发布准备只验证，不执行 publish 或 deploy；
- 所有行为变化均有测试，并同步 README、配置 Schema 和 changelog。

达到这些条件后，`repo-guard` 的长期定位可以稳定表述为：

> 一个使用消费项目现有工具链、覆盖提交前到发布准备阶段、可扩展且可审计的仓库质量门禁平台。
