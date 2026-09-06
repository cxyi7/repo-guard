# repo-guard 项目结构与能力总览

## 1. 文档定位

本文是 `@cxyi7/repo-guard` 的项目级入口文档，适用于版本 `1.23.1`。repo-guard 是接入消费项目的工程门禁平台：它基于可信的项目和 Git 事实执行统一规则，为人工与 AI 辅助开发提供可阻断、可追踪、可复核的质量约束。

| npm 包版本 | Node.js | 项目配置契约 | 交付合同契约 |
|---|---|---|---|
| `1.23.1` | `>=22.23.2` | `version: 1` | `schemaVersion: 2` |

本文只回答以下问题：

- repo-guard 解决什么问题、如何工作；
- 能力在什么生命周期进入；
- 当前包含哪些能力领域；
- 代码目录分别承担什么职责；
- 更详细的使用方式和单项功能说明应从哪里查找。

本文不保存版本分支关系、不展开每项功能的完整配置和算法，也不重复 CLI 使用手册。历史变化统一记录在 [CHANGELOG](../CHANGELOG.md)，操作方式统一记录在[使用说明](usage-guide.md)，单项功能从[功能说明文档索引](features/README.md)进入。

## 2. repo-guard 工作模型

![repo-guard 工作模型](images/repo-guard-work-model.svg)

repo-guard 的核心不是一组彼此独立的脚本，而是一条稳定的判断链：

| 环节 | 回答的问题 | 主要来源或产物 |
|---|---|---|
| 可信事实 | 当前项目、Git 快照和交付资料实际上是什么状态 | 配置与 Schema、Git、消费项目工具、合同与证据 |
| 统一判断 | 哪条规则适用，当前状态是否满足要求 | Policies、Gate Registry、Gate Contract |
| 生命周期编排 | 在什么入口、按什么固定顺序执行哪些能力 | init/doctor、Git Hook、pre-push、CI、release-ready、手动命令 |
| 可复核输出 | 人和自动化如何得到同一结论 | GateResult、中文修复指引、JSON、artifact、Evidence Run |

同一个 Gate 不因从 CLI、Git Hook 或 CI 进入而复制另一套规则。入口只负责建立可信上下文并选择执行计划；Gate 负责判断并返回统一结果。

## 3. 生命周期入口

| 生命周期 | 主要入口 | 这一阶段的职责 |
|---|---|---|
| 项目接入与维护 | `init`、`migrate`、`doctor`、`install-hooks`、`install-ci` | 建立配置、托管文件、Hook、CI 和消费项目工具准备状态 |
| 本地提交 | `prepare-commit-msg`、`pre-commit`、`commit-msg`、`post-commit` | 在最终暂存快照上执行轻量、可快速修复或必须即时阻断的规则 |
| 本地推送 | `pre-push` | 对真实推送 revision 范围执行类型、测试、架构、构建和可选性能检查 |
| 中央验证 | `ci --profile policy|full` | 在可信 Git 范围内只读复核仓库策略或完整质量计划，并保存机器报告 |
| 验收与发布准备 | `ci --profile release-ready` | 复核项目检查、测试、构建、包一致性以及可选交付证据 |
| 人工专项 | `gate`、`external` 和各专项命令 | 显式执行全量审计、项目自有门禁、性能测试或基线维护 |

各阶段的详细顺序、开关和命令参数见[使用说明](usage-guide.md)。README 中的“生命周期能力分层图”用于从用户操作阶段理解能力；本文的“工作模型”用于理解这些阶段为何能够复用同一套规则和结果。

## 4. 能力领域

| 能力领域 | 主要价值 | 代表能力 | 详细入口 |
|---|---|---|---|
| 接入与托管 | 把规范可靠地接入消费项目并持续诊断 | 配置迁移、托管 Hook、AGENTS 规范、GitLab CI | [功能说明索引](features/README.md#接入与托管) |
| 提交质量与安全 | 在提交前保护暂存内容并阻止明确风险 | lint/format、文档同步、UI Token、Vue 安全与可访问性 | [功能说明索引](features/README.md#提交阶段质量与安全) |
| 仓库与代码治理 | 约束文件、依赖、资源、代码和交付边界 | 路径与归位、图片、依赖、保护文件、交付合同 | [功能说明索引](features/README.md#仓库与代码治理) |
| 测试、构建与性能 | 复用消费项目已有工具形成更重的质量证明 | Vitest、覆盖率、Stryker、axe、类型、架构、构建、Lighthouse、接口性能 | [功能说明索引](features/README.md#测试构建与性能) |
| CI、报告与发布准备 | 让本地与中央验证共享结论并形成可追溯证据 | 固定 CI 计划、外部门禁、统一 GateResult、交付流水线、release-ready | [功能说明索引](features/README.md#ci报告与发布准备) |

本表只登记能力边界，不替代单项文档。一个能力的启用方式、配置字段、执行范围、失败判定和安全限制应维护在自己的说明文档中。

## 5. 项目结构与职责

```text
repo/
├─ .agents/skills/       仓库维护者使用的本地 Codex Skill
├─ bin/                  CLI 启动器
├─ docs/
│  ├─ features/          单项功能说明与索引
│  ├─ images/            文档中的技术图
│  ├─ usage-guide.md     安装、配置和命令手册
│  └─ contract-driven-delivery.md
│                        合同驱动交付格式
├─ scripts/              仓库自身维护检查
├─ skills/               安装到消费项目的交付流程 Skill 源文件
├─ src/
│  ├─ config/            配置加载、默认值、验证和路径匹配
│  ├─ core/              稳定领域契约、结果、错误和基础执行能力
│  ├─ git/               Git 仓库、索引、revision 和 Worktree 事实
│  ├─ integrations/      消费项目工具与第三方协议适配
│  ├─ policies/          不带编排和外部写入的策略判断
│  ├─ gates/             策略到统一 GateResult 的能力适配
│  └─ orchestration/     CLI、Hook、CI、Doctor 和初始化编排
├─ test/                 单元、集成、端到端和架构边界测试
├─ *.schema.json         对外配置与报告 Schema
├─ package.json          npm 包入口、版本和维护脚本
└─ README.md             用户第一入口
```

### 5.1 分层职责

| 层 | 应负责 | 不应负责 |
|---|---|---|
| `config` | 加载、默认值、字段和跨字段验证 | Git 查询、运行门禁、生命周期编排 |
| `core` | Gate、Context、Result、Error、Execution Plan 等稳定契约 | 具体业务规则或第三方工具语义 |
| `git` | 提供索引、提交、范围、分支和 Worktree 事实 | 决定策略是否通过 |
| `integrations` | 调用并解析消费项目工具或第三方协议 | 拥有最终策略和用户主结论 |
| `policies` | 对已获得的事实进行确定性判断 | 执行外部命令、编排生命周期 |
| `gates` | 形成 finding、artifact 和统一 GateResult | 决定 CLI/Hook/CI 的总执行顺序 |
| `orchestration` | 建立上下文、选择固定计划、执行并汇总结果 | 复制具体 Gate 的判断逻辑 |

### 5.2 依赖方向

- `core` 不依赖 `gates`、`orchestration` 或 `integrations`。
- `config` 不依赖 Git、policy、gate、integration 或 orchestration 运行域。
- `git` 只提供仓库事实，不依赖策略和编排。
- `policies` 可以消费稳定事实，但不调用 gate 或 orchestration。
- `integrations` 不拥有策略决策和用户输出。
- `gates` 可以组合 core、config、Git、policy 和 integration，但不依赖 orchestration 或 renderer。
- `orchestration` 通过 Gate Registry 和 Execution Plan 调度能力，不直接调用具体 integration。
- 不同 gate 领域不互相深层导入；组合只放在 Registry 和 Execution Plan。
- 循环依赖和无法解析的本地导入都是错误。

这些边界由仓库测试与 dependency-cruiser 配置共同保护。结构变更必须先判断属于事实、策略、能力适配还是生命周期编排，不能因为调用方便而跨层复制实现。

## 6. 稳定契约与输出

| 契约 | 作用 | 事实来源 |
|---|---|---|
| 配置 Schema | 约束允许字段、类型、枚举和公开配置边界 | 根目录 `*.schema.json` 与运行时配置验证 |
| Gate Contract | 声明稳定 ID、环境、副作用、超时、所需工具和执行生命周期 | `src/core/capability/` |
| Gate Registry | 官方能力目录；项目外部门禁只能追加，不能替换或重排官方能力 | Registry 定义与集合测试 |
| GateContext / ChangeSet | 让每个 Gate 使用同一个执行环境和 Git 变更范围 | 编排层建立的不可变上下文 |
| GateResult | 统一通过、跳过、违规和错误状态，以及 finding、artifact、diagnostic | 所有官方 Gate |
| Execution Plan | 固定 pre-commit、pre-push 和 CI 的能力顺序 | `src/orchestration/` 与计划测试 |
| Delivery Contract / Evidence Run | 绑定功能归属、需求事实、任务、反馈、人工确认与执行证据 | Git 中受跟踪的 Markdown 合同包和报告 |

npm 包根入口只公开稳定的配置、Gate 构造、Context、Result 和错误契约；具体 runner、Gate、integration 和 orchestration 属于内部实现。公开 Schema 以 `package.json` 的 `exports` 与实际 npm 打包结果为准。

## 7. 文档导航

| 需要了解的内容 | 文档 |
|---|---|
| 项目定位、价值和生命周期能力 | [README](../README.md) |
| 安装、配置、命令和接入步骤 | [使用说明](usage-guide.md) |
| 每项能力的独立说明及编写状态 | [功能说明文档索引](features/README.md) |
| 合同、需求快照、执行清单、发现与证据格式 | [合同驱动交付格式](contract-driven-delivery.md) |
| 版本变化 | [CHANGELOG](../CHANGELOG.md) |
| 本仓库版本判断和 npm 发布流程 | [repo-guard-publishing Skill](../.agents/skills/repo-guard-publishing/SKILL.md) |

## 8. 明确边界

repo-guard 当前明确不做以下事情：

- 不承载消费项目的业务接口、页面路由、请求参数或生产运行时代码。
- 不自动安装或替换消费项目的 lint、测试、构建、压测和浏览器工具。
- 不允许项目重排官方 pre-commit、pre-push 或 CI 计划。
- 不在 Git Hook 中运行全项目修复，也不把类型检查、测试、构建或 Lighthouse 放入 pre-commit。
- 不允许通用外部门禁执行任意 shell 片段；外部能力只能走受约束的项目脚本和报告契约。
- 不隐式上传 Lighthouse、压测或其他报告。
- 不自动关闭规则、降低阈值、扩大排除项或生成绕过例外。
- 不自动发布 npm 包、部署应用或执行生产环境写入。

具体能力的附加安全限制应写在对应功能文档中，不继续堆叠到本总览。

## 9. 维护规则

- 本文与 `docs/features/` 共同构成长效能力文档：本文维护项目级模型，功能目录维护单项事实。
- 新增、修改或删除能力时，必须更新[功能说明文档索引](features/README.md)和对应单项文档；只有能力领域、生命周期、目录结构、模块职责或依赖方向变化时才同步修改本文。
- 单项功能尚无文档时，在索引中使用“待编写”和不可点击的计划路径；不得把占位入口标记为已经维护。
- README 只保留面向首次使用者的定位、生命周期能力图和最短接入路径，不复制完整功能说明。
- 历史版本和分支关系只写入 CHANGELOG，不进入当前能力总览。
- Registry 是官方 Gate 目录的单一事实来源，Execution Plan 是生命周期顺序的单一事实来源；文档不得依靠历史 changelog 推断当前行为。
- 每个行为变化仍必须同步代码测试、相关 README/功能文档、配置 Schema 和 CHANGELOG。
- 发布前必须执行 `npm run check`、`npm test` 和 `npm run pack:check`。
