# 2.0 重构工作清单与验收记录

最新补充（2026-09-11）：当前工作区为 `feat/repository-file-placement-2.0.0`，继续收口 Java 与仓库归位验收问题，目标版本 `2.0.0`；未提交或发布。

- 同根应用 AI 规范合成、Java 工程报告、原始进程诊断、PIT 配置定位及文档时机已补充修复与回归，见 [Java 验收记录](java-check-acceptance.md)。
- **待处理且本轮明确延期：普通 CI 的受检工作树/索引与目标 head 绑定。** 本地未提交修复可能使目标提交的违规漏检，仍阻止完整验收；本轮没有修改此执行路径。
- 团队真实消费项目与其他 JDK/系统组合仍待验证；Windows 超时样例曾出现清理目录 EBUSY，稳定性根因尚未独立定位，保留后续核验项。

此前记录（2026-09-10）：工作分支为 `refactor/node-engineering-2.0.0`；工程隔离、样式 Token 与统一退出码已汇入此重构分支。下文保留当时的收口依据。

此前基于远端提交 `9912a95e222520c06dedb512c270cfe35da01a27` 完成原生 v2 重构。按确认的要求，不再保留旧配置、旧 Hook/AGENTS 标记或自有 v1 数据格式；只接受当前格式，全部生成器、校验器、Schema 和 Skill 同步更新。下文 R1—R7 与 945 项测试为此前收口记录；9 月 10 日追加的应用隔离与独立交付见文末，不能复用此前全量结果代表这次改动已验证。本记录不代表已提交、合并或发布 npm 包。

[项目结构与能力总览](project-structure-and-feature-inventory.md) · [功能索引](features/README.md) · [使用说明](usage-guide.md)

## 本次完成范围

| 范围 | 完成结果 |
|---|---|
| 配置与执行 | 加载、启停、Doctor、Hook、CI、手动检查共同使用原生 v2 的 `checks / repository / reporting / ci`，不再转回 v1 执行 |
| 应用身份 | 保留显式 `project.id / role / stack / preset`；按前端或 Node 后端身份判定适用检查，不猜测项目类型 |
| 多应用 | 保留目标选择、配置快照、暂存索引隔离、跨应用重命名、配置删除阻断和失败汇总 |
| 质量与运维 | 质量 CI 仅生成质量任务；独立运维负责构建、产物、部署和流水线通知，保护人工修改 |
| 发布前复核 | `release-ready` 统一执行消费项目工程检查；repo-guard 自身 npm 发布仍使用维护者发布 Skill |
| 旧配置处理 | 非 v2 直接拒绝且不改写原文件；没有解析器、转换器、迁移命令或迁移 API |

## R1：统一内部执行配置

- [x] 配置校验、默认值、Gate、执行计划和启停使用同一原生 v2 模型。
- [x] 迁移旧字段调用者，删除 v2 转 v1 的执行映射和 `configVersion` 分流。
- [x] 同步 Gate 配置路径与版本声明、初始化和 AGENTS 规则映射。

实现依据：[配置归一化](../src/config/project-configuration.js)、[统一校验](../src/config/configuration-validation.js)、[扁平检查校验](../src/config/checks-validation.js)、[字段路径](../src/config/project-feature-paths.js)、[能力定义](../src/core/capability/gate-definition.js)、[规则目录](../src/policies/agent-policy-catalog.js)。领域分析器可组合关联检查参数，但不再生成旧版项目配置驱动执行。

验证依据：[原生模型与拒绝边界](../test/config/v2-runtime-contract.test.js)、[配置测试](../test/config/project-configuration.test.js)、[能力测试](../test/core/gate-capability.test.js)、[多应用 Hook 测试](../test/hooks/workspace-hooks.test.js)。固定暂存检查顺序、规则阈值、例外和适用性继续验证；未向 pre-commit 加入类型检查、Lighthouse 或全项目修复。

## R2：移除质量配置中的旧发布设置

- [x] 常规默认值、校验、复制及调用者不再读取 `ci.pipeline`。
- [x] 删除历史发布字段转换与旧托管文件转换器，不保留特殊兼容入口。
- [x] 质量配置职责与独立运维 Schema、文档保持一致。

实现依据：[质量 CI 校验](../src/config/ci-validation.js)、[默认值](../src/config/defaults.js)、[配置复制](../src/orchestration/setup/config-copy.js)、[质量 Schema](../config.schema.json)、[运维 Schema](../operations.schema.json)。新执行对象的 `ci` 只承载质量策略及外部门禁；应用发布设置从 `repo-guard.ops.json` 读取。

验证依据：[CI 配置测试](../test/config/config-ci-validation.test.js)、[原生配置架构测试](../test/architecture/architecture-config-boundaries.test.js)、[运维配置测试](../test/operations/configuration.test.js)。

## R3：拆净旧 GitLab 发布模板及通知入口

- [x] 质量安装器只生成质量检查内容，独立运维负责构建、产物和部署。
- [x] 删除旧发布渲染器、setup/Gate 薄桥及旧模板识别转换模块。
- [x] 质量模板仅接受当前可验证内容；运维片段要求当前标记和有效摘要，不再自动接管无摘要片段。
- [x] 独立运维支持 `notifications.enabled`，默认关闭；生成成功、失败和尽力取消通知。
- [x] 变异测试通知改读 `reporting.notification`，通过独立运维标记避免重复通知。

实现依据：[质量安装器](../src/operations/gitlab/gitlab-ci.js)、[运维安装器](../src/operations/gitlab/installation.js)、[托管内容保护](../src/operations/gitlab/managed-content.js)、[运维渲染器](../src/operations/gitlab/renderer.js)、[流水线通知](../src/operations/notifications/gitlab-ci-notification.js)、[变异测试通知](../src/gates/release/mutation-test-notification.js)。旧模板、人工修改和无摘要片段均拒绝覆盖。预览可展示计划与冲突，实际安装不能绕过冲突；当前可验证的托管内容仍支持更新。质量安装保留选中的配置档，冲突时不修改质量配置。

验证依据：[模板拒绝与更新边界](../test/operations/quality-ci-upgrade.test.js)、[安装一致性](../test/operations/quality-installation.test.js)、[运维流水线](../test/operations/pipeline.test.js)、[运维通知](../test/operations/notifications.test.js)、[通知执行](../test/ci/gitlab-ci-notification.test.js)。通知行为及取消限制见[独立运维说明](features/operations.md)。

审查追补：成功、失败通知作业原先遗漏 `rules`，导致 MR 流水线缺少统一通知。现已与质量、构建复用同一套 MR／分支规则，并保留各自状态条件。新增 YAML 结构回归先在旧实现失败、修复后通过；关闭通知、去重、生产人工部署与失败处理的既有断言保持有效。

本轮追加复核发现 CLI 安装入口在省略 `--profile` 时错误补为 `policy`，现已修复为沿用既有配置；只有显式指定才覆盖。CLI 回归覆盖 `full`、`release-ready` 的预览不写入、实际安装保留及显式覆盖，并核对配置与 YAML 一致，修前失败、修后通过。

## R4：统一发布前检查计划

- [x] 前端、Node 后端和多应用消费目标统一使用工程检查计划。
- [x] 删除按 `configVersion` 选择两套计划的分支，以及内置 `release.check / release.test / release.package` 门禁。
- [x] 区分消费项目发布前复核与 repo-guard 自身 npm 发布验证。

实现依据：[执行计划](../src/orchestration/execution-plans.js)、[Gate 注册](../src/gates/registry.js)、[交付证据复核](../src/gates/release/delivery-evidence-gate.js)。`release-ready` 复用完整质量检查，随后执行适用的 Lighthouse、外部门禁和交付证据复核；不要求消费项目具备 npm 发布脚本。项目自定义检查仍可通过外部门禁接入。

验证依据：[执行计划测试](../test/core/execution-plan.test.js)、[发布前复核测试](../test/gates/release/release-ready.test.js)。专题及合同证据示例已改用实际存在的工程 Gate 标识，见[发布前检查说明](features/release-ready.md)。

## R5：删除旧项目配置兼容层

- [x] 删除 v1 解析、冻结默认值、字段转换和迁移配套文件回滚模块。
- [x] 删除迁移 CLI、公开及内部迁移 API、迁移脚本生成和 `migrated` 返回字段。
- [x] 所有非 v2 项目配置统一报 `config/unsupported-version`，拒绝前不改写原文件。
- [x] 保留原生 v2 初始化、启停、Doctor、配置联动及托管文件同步。
- [x] 显式非法空值、旧字段和布尔覆盖率简写直接拒绝；子应用不接受仓库公共分区。

实现依据：[版本边界](../src/config/root-configuration-validation.js)、[配置管理](../src/orchestration/setup/config-management.js)、[CLI 入口](../src/orchestration/cli/runner.js)、[公开 API](../src/index.js)。不会生成转换结果、备份或迁移报告；人工保存原资料并按新架构重新建立配置。

验证依据：[原生配置与拒绝边界](../test/config/v2-runtime-contract.test.js)、[配置管理测试](../test/setup/config-management.test.js)、[CLI 测试](../test/setup/configure-cli.test.js)、[架构约束](../test/architecture/architecture-config-boundaries.test.js)。操作见[配置管理与规则启停](features/configuration-management.md)。

## R6：让测试直接验证新模型

- [x] 常规夹具直接构造 v2，旧配置仅作为必须拒绝的输入反例。
- [x] 删除辅助层中的 v1 转换和将结果转回旧字段的断言适配。
- [x] 删除已移除迁移能力的成功、备份、报告和回滚专属用例；保留原生模型、计划、通知和拒绝输入的行为断言。

实现依据：[原生配置夹具](../test/helpers/project-config.js)、[夹具契约测试](../test/config/project-fixture-contract.test.js)、[测试维护说明](../test/README.md)。回归继续覆盖暂存修复顺序、部分暂存与恢复、快照、跨应用重命名、配置删除、例外范围和 CI 失败汇总，没有通过跳过既有断言来迁就新模型。

## R7：完成文档与整体回归

- [x] 同步 README、使用说明、功能索引和专题、Schema、结构图与 CHANGELOG。
- [x] 删除过渡执行模型说明和旧迁移操作指南，明确只支持原生 v2。
- [x] 完成最新格式收口后的静态检查、全量测试、打包及文档链接复核，回填最终结果。

资料依据：[README](../README.md)、[结构与能力总览](project-structure-and-feature-inventory.md)、[功能索引](features/README.md)、[使用说明](usage-guide.md)、[架构图](images/repo-guard-v2-architecture.svg)、[变更记录](../CHANGELOG.md)。功能索引、总览及专题的本地链接已复核；文档示例通过实际 Schema 和运行时校验，架构图已同步原生 v2 分区与独立运维职责，并渲染检查。

审查追补：单应用及工作区 Schema 的四处 CI/profile 说明已移除旧部署与 npm 包发布职责，统一使用中文。新增 [CI Schema 边界回归](../test/docs/ci-schema-boundary.test.js)，同时核验子应用引用与公共 CI 归属；旧说明下两项失败，修正后三项全部通过。

## 当前格式与拒绝旧输入

本轮不再保留之前的旧标记识别或自有 v1 格式例外：

- 功能登记表、托管 Skill 清单、[UI Token 契约](../ui-token-manifest.schema.json)、无效代码与构建产物基线全部升级 v2；合同包、Evidence Run 和 GateResult 已是 v2，继续只接受 v2。
- 外部门禁升级为 `repo-guard-json-v2` / `schemaVersion: 2`，API 性能与 k6 报告生成器同步；CI 单应用、工作区、跳过及错误报告统一 `version: 2`。
- Hook 只接受当前 v5，AGENTS 只接受当前职责区块；删除旧标记映射和转换，不自动覆盖或追加新旧并存内容。仓库 AGENTS 约束同步修改。
- 执行锁和内部状态只接受当前格式；遇到旧状态拒绝且保留文件，不能误判为失效状态后删除或覆盖。
- 中文文案基线只更新格式号到 2，豁免仍为 0 条，未增加、替换或放宽任何文案豁免。

第三方 Stryker/k6 原生报告、Git 输出格式和摘要算法标识遵循其实际协议，不通过改名伪造格式。所有 repo-guard 自有格式的清单见[配置管理](features/configuration-management.md#当前格式清单)。

交叉复核追加修复并保留回归：

- [托管格式写入前预检](../src/orchestration/setup/managed-format-preflight.js)让初始化、配置启停、修复、Hook 和 CI 安装在相关旧格式冲突时先停止，避免只修改一半；[实际 CLI 回归](../test/setup/managed-format-preflight.test.js)覆盖 15 个文件保持原样的拒绝场景。
- [CI 报告版本检查](../src/orchestration/ci/report.js)不只检查外层 `version: 2`，还检查存在的 GateResult 与工作区子报告，禁止嵌套旧格式；关闭结果内嵌时可省略整个 GateResult 字段。[回归](../test/ci/ci-report-version.test.js)确认拒绝时不覆盖已有报告。
- [生命周期锁](../src/orchestration/pre-commit/lifecycle-lock.js)只回收元数据有效、版本为 2 且确认持有进程退出的锁；损坏 JSON、非法 PID/令牌和进程探测异常都保留并阻断，不再按文件时间删除。[回归](../test/hooks/pre-commit-lifecycle-lock.test.js)同时保留正常重入与失效锁恢复验证。

v1 项目配置不再执行或转换。无效图片增量检查若读取到含旧配置的 Git 基线会明确阻断；需按[配置管理说明](features/configuration-management.md)建立经团队确认的有效 v2 基线，不能静默用当前配置替代历史规则。

## 后续扩展，尚未实施

| 扩展 | 当前边界 | 后续工作 |
|---|---|---|
| Java 工程预设 | Maven 已接入 18 项源码与工程检查，独立合同继续支持团队声明的命令 | Gradle、Java 运维部署、工具自动准备仍待实现；仍需 Node 运行 CLI，另需 JDK 执行 Java 检查 |
| 工具自动接入 | 开启检查不会自动安装包或生成第三方配置 | 根据显式身份、环境与已有依赖制定兼容安装计划；安装不进入日常 Hook |
| 跨仓部署协调 | 独立共同合同已支持固定版本、交换签名证据、联合验证和人工验收；不联动另一团队部署 | 后续按团队权限设计运维协调，不默认触发其他团队环境 |

这些后续能力不属于 R1—R7 的内部重构收口范围。本次不新增业务接口输入输出、身份认证或权限规则。

## 此前 R1—R7 的验证记录

以下为此前格式收口后的实际验证；定向测试与全量范围重叠，不重复累计。它们早于下方应用隔离与独立交付实现。

| 检查 | 本轮最终结果 |
|---|---|
| `npm run check` | 通过；包含 ESLint、架构依赖、语法与中文文案检查。300 个模块、1212 条依赖无违规，历史英文债务仍为 0/0 |
| `npm test -- --test-concurrency=4` | 最终全量复测：945 项，944 通过、0 失败、0 取消、1 跳过；跳过项为需显式开启的真实 k6 集成测试 |
| 定向回归 | 相关正常配置、初始化、Hook 与 CI 90 项通过；15 个实际 CLI 旧格式拒绝场景由 3 项测试覆盖；完整 pre-commit 47 项通过；Skill 结构验证通过 |
| `npm pack --dry-run --json --ignore-scripts` | 通过；396 个文件，包含新预检模块及当前 Skill 资产。旧配置转换器、旧模板转换器及旧迁移手册不进入包；测试目录、临时文件及仓库维护 Skill 不进入消费安装包 |
| 文档与链接 | 61 份维护文档的 580 个本地链接均有效；配置示例通过真实 Schema 与运行时校验，架构 SVG 与 HTML 同步并完成渲染检查 |
| 差异检查 | `git diff HEAD --check` 通过；依赖版本未改动。中文文案基线仅格式号改为 2，裁剪后仍为 0 条豁免 |

全量日志保存在本地忽略目录 `test/.tmp/latest-only-final-rerun.log`；首次结果保留在 `test/.tmp/latest-only-final.log`。未复用上轮 921 项测试的结果。

消费场景采用本地临时 Git 仓库复核：前端与 Node 后端身份、真实 lint-staged 暂存修复与失败恢复、多应用配置快照和跨应用重命名、Doctor、质量 CI、发布前检查及报告隔离。相关依据包括[多应用 Hook](../test/hooks/workspace-hooks.test.js)、[多应用 CI](../test/ci/workspace-ci.test.js)、[多应用 Doctor](../test/setup/workspace-doctor.test.js)和[消费项目发布前检查](../test/gates/release/release-ready.test.js)。这些是本地消费场景回归，不等同于真实 GitLab Runner 部署验收。

最新格式首轮全量曾出现两项失败：锁测试新增的原生 `Error` 构造违反既有错误类型约束，已改用类型化测试错误，架构及锁定向测试 15 项通过；另一次函数文档用例在修改前读取暂存配置时返回 `config/staged-root-missing`，单项及完整 pre-commit 测试组 47 项复跑均未复现。首次日志未保留底层 Git 的退出诊断，尚不能确定读取失败根因；保留首次失败记录，不据复跑通过声称该根因已修复，也未放宽配置缺失阻断或增加自动重试。

独立复核持续检查配置拒绝边界、原生生命周期与 CLI 行为。旧解析器、转换器、发布渲染器与薄桥已删除，历史实现可从 Git 恢复；未删除消费项目资料。

MR 通知规则遗漏及 Schema 旧职责说明已修复，保留防回退测试。已接入的消费项目需重新执行 `repo-guard ops install` 并提交生成片段；旧模板、无摘要或人工修改按冲突提示处理，由人工保存原资料并按当前设计重新接入。本轮未运行真实 GitLab Runner。

本轮未提交、推送、合并、打标签或发布 npm 包，也未向真实环境部署。若准备发布，仍须由维护者按发布 Skill 确认版本、远端状态及发布权限；全量测试通过不等于获得发布授权。

## 2026-09-10：多应用目录归属漏检修复

审查发现 `projects[].root` 使用 `./apps/web` 或 `apps//web` 时，加载器保留原字符串作为运行相对目录，无法匹配 Git 返回的 `apps/web/...` 路径，导致提交阶段部分应用策略拿到空变更列表。

已在[工作区加载器](../src/config/workspace-configuration.js)中，从完成边界校验的应用绝对路径统一计算仓库相对路径，根目录使用 `.`。磁盘和 Git 快照共用该处理；原配置内容不改写，目录越界及重叠限制继续保留。

验证采用先复现、再修复：新增 6 项回归在旧实现上有 5 项失败，规范目录的对照用例通过；修复后全部通过。覆盖真实暂存图片命名阻断、跨应用重命名、根目录应用、磁盘与快照以及不改写配置。[配置测试](../test/config/project-configuration.test.js)与[多应用 Hook 测试](../test/hooks/workspace-hooks.test.js)共 28 项通过，相关 CI、运维、文档和架构测试 214 项通过，合计 242 项，0 失败。`npm run check` 与差异检查通过。本次为针对该修复的验证，不替换上文全量回归记录。

## 2026-09-10：应用隔离与独立共同合同

本次按已确认设计实施，支持同一 Git 仓库内不重叠的应用目录，以及不同仓库、磁盘和电脑上的参与方；不支持前后端源码混在同一目录，也不增加业务接口、鉴权或权限校验。

| 范围 | 实现内容 |
|---|---|
| 公共约定 | 根配置维护提交信息、公共基础文件保护、CI 流程、通知和动画；共同交付另有独立入口 |
| 应用自治 | 代码检查、依赖、例外、文件归位、保护规则及外部门禁由本方配置，工具、脚本和路径按应用目录解析 |
| 选择与加载 | 提交、推送、普通 CI 按变更选择；`sharedPaths` 声明共享影响，根清单变化触发全部应用；显式选择时不加载无关应用工程配置 |
| 整体复核 | `release-ready` 默认选择全部应用；按应用保存结果，聚合同名 Gate 时保留来源与最严重状态 |
| 独立交付 | `repo-guard.delivery.json` 固定一个共同合同版本、本仓参与方、执行密钥和证据目录；可单独启用或与工程检查同时使用 |
| 跨栈执行 | 合同引用实际工程 Gate 或团队声明的命令；Java、Python 不需要 Node 工程预设，执行相应命令仍需对应运行环境 |
| 证据与验收 | 实际检查生成绑定参与方和提交的签名证据；联合命令输出本轮观察报告，人工验收绑定当前版本组合与完整证据 |
| 真实反馈 | 失败证据关联需求和责任方，修订后要求同一测试内容在修复提交上通过，并完成反向改进检查 |
| 文档与 AI | 同步使用说明、配置/CI/报告/诊断手册和五个交付 Skills，区分独立模式与仓库内合同包，不让 AI 使用人工验收私钥 |

独立交付与 `repository.deliveryContract` 仓库内合同包属于两种当前组织方式，不能同时启用；保留原文件并要求明确选择，不自动转换。签名验证来源与传输完整性，不证明远端尚未同步的最新提交或业务正确性。发布、依赖自动接入和后续部署完善继续留到另行实施。

实现依据：[应用作用域](../src/config/workspace-scopes.js)、[受影响目标选择](../src/orchestration/workspace/targets.js)、[独立交付字段](../src/config/delivery-workspace.js)、[共同合同策略](../src/policies/delivery-contract/collaboration.js)、[真实执行与证据](../src/orchestration/delivery/execution.js)。回归入口：[隔离配置](../test/config/workspace-isolation.test.js)、[真实交付工作流](../test/e2e/delivery-workflow.test.js)、[多应用 CI](../test/ci/workspace-ci.test.js)。

本轮已完成应用隔离与交付证据链的并行审查，修复目录等价写法、重命名源路径、未提交代码沿用验收、同仓漏绑参与方、目标配置错误处理，以及 CI 签证版本错配等问题。发布复核还补充了真实回归：成功复核保留同版本已验收证据；本轮失败、关闭或跳过在最终证据门禁前生效，不能出现命令通过而随后验收失效的矛盾结果。

| 最终验证 | 结果 |
|---|---|
| 静态与架构检查 | `npm run check` 通过；306 个模块、1275 条依赖无架构违规，中文文案历史债务仍为 0/0 |
| 全量回归 | `npm test -- --test-concurrency=4`：987 项，986 通过、0 失败、0 取消、1 跳过；跳过项是需显式启用的真实 k6 集成测试 |
| 最后验收修复的影响范围复测 | 全量之后补充的发布复核一致性修复，已重新执行 CI、端到端交付、发布门禁和策略组，160 项全部通过；与全量覆盖重叠，不累计为新的总数 |
| 打包检查 | `npm pack --dry-run --json --ignore-scripts` 通过；404 个文件，包含两个独立交付 Schema；测试目录、临时文件、私钥及仓库维护 Skill 均未进入包 |
| 差异检查 | `git diff --check` 通过 |

首次完整回归的 10 项失败均由旧测试配置归属或推送步骤断言造成，已按应用自治模型调整测试样例并保留原业务断言；修复后取得上面的全量通过结果。随后新增验收回归先复现了单应用命令通过但验收失效、以及多应用成功复核刷新证据的问题，修复后完成 160 项影响范围验证。

本轮日志保存在忽略目录 `test/.tmp/collaboration-final-tests.log`、`test/.tmp/collaboration-delivery-final-tests.log`、`test/.tmp/collaboration-final-check.log` 和 `test/.tmp/collaboration-final-pack.json`。这些是本地真实临时仓库与执行器验证，未运行真实 GitLab Runner 或跨团队部署。上述验收完成时工作分支为 `refactor/node-engineering-2.0.0`，未提交、推送或发布。

## 2026-09-10：样式 Token 语言收敛与扩展

本次独立功能在 `feat/style-token-languages-2.0.0` 实施，保留此前尚未提交的重构内容。按确认范围支持原生 CSS、SCSS/Sass、Less 和 Vue 对应内联样式块，移除 UnoCSS，不接入 Stylus。

| 范围 | 实施内容 |
|---|---|
| 配置简化 | 统一 `checks.uiTokens.languages`，可选 `css`、`sass`、`less`；默认 `["css"]` 且功能仍默认关闭；图标范围统一为 `iconSelectors` |
| 当前清单 | 保留 `version: 2`、真实来源及 SHA-256、12 类 Token；别名只允许 `css`、`sass`、`less`；不保留 `shortcuts` |
| 语言规则 | CSS 普通声明使用完整且无回退的 `var(--name)`，断点使用登记的正 `px` / `em` / `rem` 长度；Sass/Less 使用各自完整别名，普通声明也可使用 CSS 别名 |
| 实际解析 | 使用消费项目 Stylelint 与对应语法配置提取独立样式文件和 Vue 内联块；解析错误明确失败，不执行预处理器或项目级修复 |
| 规则边界 | 已登记变量只能在清单来源中定义；受控组件中的同名重定义产生 `ui-token/unapproved-definition`；普通布局属性继续不受 Token 管理 |
| 移除内容 | UnoCSS 类名、配置、动态拼接与 shortcut 分析；旧 `adapters`、`icon`、`aliases.unocss` 和 `shortcuts` 直接拒绝，不迁移 |
| 应用隔离 | 继续只适用于前端；清单保护、例外和 AI 规范归所属应用；来源或配置变化触发该应用范围内只读复查 |
| 使用资料 | 同步 README、使用说明、能力索引、完整字段说明、维护者架构与 CHANGELOG，说明工具准备及扫描边界 |

本轮完成配置、解析、策略、应用隔离与文档的并行审查，补齐属性插值、变量重定义、命名空间引用、颜色计算、类别错配、断点边界和显式空配置的回归。配置文件单独变更时，提交和 CI 均按应用实际配置路径触发复查；无关应用的配置不会扩大该应用的扫描范围。

| 最终验证 | 结果 |
|---|---|
| 全量回归 | `npm test -- --test-concurrency=4`：1038 项，1037 通过、0 失败、0 取消、1 跳过；跳过项为需显式启用的真实 k6 集成测试 |
| 样式功能验收 | 策略、配置、实际解析、清单、真实暂存变更、CI 配置变更和错误边界共 79 项全部通过；与全量覆盖重叠，不累计为新的总数 |
| 静态与架构检查 | `npm run check` 通过；305 个模块、1268 条依赖无架构违规，中文文案历史债务为 0/0 |
| 打包检查 | `npm run pack:check` 通过；403 个文件，包含样式解析器及相关 Schema 和文档，测试目录、仓库维护 Skill 与已删除的 UnoCSS 模块未进入包 |
| 差异检查 | `git diff --check` 通过 |

首次全量运行发现一处错误包装不符合架构约束，已修复并通过回归；同次运行的 Windows 进程树清理测试受沙箱权限影响而等待。使用正常进程清理权限重跑两组相关测试，13 项全部通过，随后取得上表完整全量结果；未修改这些既有进程清理测试或其运行逻辑。

最终日志保存在忽略目录 `test/.tmp/style-token-full-tests-final.log`、`test/.tmp/style-token-acceptance-tests.log`、`test/.tmp/style-token-process-tests.log`、`test/.tmp/style-token-check.log` 和 `test/.tmp/style-token-pack.json`。上文 987 项及 160 项结果保留为此前交付重构的历史记录。本轮工作分支为 `feat/style-token-languages-2.0.0`，未提交、推送或发布。

## 2026-09-10：统一退出码与跨入口汇总

本轮在 `fix/unified-exit-codes-2.0.0` 修复退出码分散处理，保留此前尚未提交的应用隔离、独立交付和样式 Token 改动。

| 范围 | 实施内容 |
|---|---|
| 公共契约 | `src/core/result/exit-code.js` 维护唯一 `0/1/2/3` 码表、状态映射、输入校验、进程结果归类与汇总优先级 |
| 入口一致 | 手动、Hook、CI、交付和运维入口复用公共处理；不再将 Hook 违规压成执行错误 |
| 多应用 | 按执行错误、配置错误、范围错误、违规汇总阻断结果，避免应用顺序改变最终码 |
| 独立交付 | 正常命令非零与运行异常分别返回 `2`、`1`；工程 Gate 保留结果分类；验收条件未满足的 `verify` 与 `accept` 均返回 `2` |
| 非阻断语义 | CI 只报告与成功的状态查询保留 `0`；跳过不等于检查通过，签名证据仍使用当前 `passed / failed` 格式 |
| 后续维护 | AGENTS 明确单一维护入口；AST 架构测试禁止本地数字映射、原始进程状态透传、重复码表和非统一进程出口，生成运维脚本注入公共常量 |
| 文档 | 同步 README、使用说明、功能索引、结果报告、Hook、CI、外部门禁、交付合同与维护者架构说明 |

本轮完成并行实现与交叉审查。除原有 Hook 压码、交付错误分类和多应用首个失败汇总外，还修复 CI 将 Git 执行错误误标为范围错误的问题，以及质量子进程在真正检查前退出 `0` 时缺少完成证据的漏洞。普通暂存和仅删除文件均要求本次运行的完整结果记录；暂存隔离、失败恢复与检查顺序继续由原流程保证。

| 最终验证 | 结果 |
|---|---|
| 全量回归 | `npm test -- --test-concurrency=4`：1070 项，1068 通过、0 失败、0 取消、2 跳过；分别为需显式开启的真实 k6 集成，以及当前 Windows 不适用的 POSIX 信号终止场景 |
| 跨入口验证 | 覆盖手动命令、实际子 CLI、Hook、交付及多应用 CI；验证违规 `2`、配置/执行错误 `1`、范围错误 `3`，以及只报告和状态查询不阻断 |
| 暂存与结果传递 | 验证部分暂存恢复、并发锁、普通与仅删除文件、子进程提前退出 `0`、篡改进程退出码、结果缺失与通道损坏；不会因单纯退出 `0` 宣称检查完成 |
| 静态与架构检查 | `npm run check` 通过；308 个模块、1308 条依赖无架构违规，中文文案历史债务为 0/0；新增 AST 出口边界检查通过 |
| 打包与文档 | `npm run pack:check` 通过；406 个文件，包含公共退出码和两个 Hook 内部辅助模块；测试、临时文件、私钥及仓库维护 Skill 未进入包；356 个本地文档链接有效 |
| 差异检查 | `git diff --check` 通过 |

早期定向验证中，临时导入语法问题与原先把 Hook 违规期待为 `1` 的断言已修正；全跳过的聚合结果也已按统一契约保留 `skipped`。随后完成上表完整回归，没有以早期失败或旧版全量记录代替最终验证。签名交付证据仍使用当前 `passed / failed` 格式，未增加旧格式读取或迁移路径。

最终日志保存在忽略目录 `test/.tmp/exit-code-full-tests.log`、`test/.tmp/exit-code-check-final.log` 和 `test/.tmp/exit-code-pack-final.json`。上文全量测试保留为此前样式 Token 与交付重构的历史记录。本轮在 `fix/unified-exit-codes-2.0.0` 完成，未提交、推送或发布。

## 2026-09-10：合并后的统一性审查修复

本轮基于 `refactor/node-engineering-2.0.0` 的 `f6f3c64` 收口工程隔离与统一退出码合并后的审查问题，目标版本仍为 `2.0.0`。

| 审查问题 | 修复与验证依据 |
|---|---|
| 提升安装的工具未导出清单时误报缺失 | 从应用及祖先的本地 `node_modules` 按就近顺序定位，支持作用域包与包目录链接；损坏清单明确失败，不混用不同安装的清单与入口；真实 `--preserve-symlinks` 回归见[工具定位测试](../test/core/project-package.test.js) |
| 超时或取消后无法确认进程退出，清理失败被隐藏 | 流式执行与外部 npm 共用[进程树清理](../src/core/execution/process-tree.js)，清理等待最多 2000ms，失败尝试直杀并释放管道、保留失败事实；覆盖 taskkill 缺失、失败、挂起及 Unix 进程组错误 |
| 实时输出无换行时缓冲无上限 | 单行展示缓冲限制为 1 MiB，超限丢弃该行并在换行后恢复；固定长度状态继续辨认跨数据块私钥标记，[流式回归](../test/core/streaming-process.test.js)覆盖持续输出、恢复展示和截断边界脱敏 |
| Git 英文原文直接成为主错误，异常详情未进入结果 | 中文错误、退出事实与第三方诊断分离，GateResult 统一继承并规范化错误诊断，控制台明确标记来源；[Git 回归](../test/core/git-execution.test.js)及[报告回归](../test/core/gate-result.test.js)验证脱敏、截断与重复规范化 |
| Stylelint 解析错误的诊断结构与公共结果不一致 | 转成标准诊断，在 JSON 序列化前处理路径与敏感信息；[真实样式门禁回归](../test/integrations/ui-tokens/style-gate.test.js)覆盖解析失败进入完整编排与报告，保留原始配置错误分类 |
| 配置快照读取失败被当成配置缺失或删除 | [快照读取](../src/git/snapshot-content.js)先确认索引或树中条目，再读取固定 blob；真实缺失、未合并条目、目录、对象缺失和索引损坏分别处理；[配置错误回归](../test/config/snapshot-errors.test.js)保留首次无 HEAD 接入和真实删除阻断 |
| CI 公共步骤重复维护 | `full` 直接组合 `policy`，`release-ready` 组合 `full`；保持既有步骤、报告名称及证据末尾顺序，沿用[计划回归](../test/core/execution-plan.test.js) |

此前偶发的 `config/staged-root-missing` 记录仍保留。此次已经真实复现并修复“Git 读取失败误分类”，没有证据证明这就是历史偶发问题的根因，也没有添加自动重试或重置索引来掩盖问题。

Java Maven 工程检查已在后续功能变更中接入；Gradle、自动依赖安装与配置接入仍未实现。真实 GitLab Runner、真实部署环境及默认跳过的真实 k6 需要对应环境验收，不能用本地回归结果代替。这些边界继续在[项目总览](project-structure-and-feature-inventory.md#测试组织与扩展边界)中维护。下方历史收口记录只描述当时范围，当前 Java 能力以 [Java 接入说明](java-quality-integration.md)为准。

| 最终验证 | 结果 |
|---|---|
| 全量回归 | `npm test -- --test-concurrency=4`：1132 项，1130 通过、0 失败、0 取消、2 跳过；跳过项为需显式开启的真实 k6 集成，以及当前 Windows 不适用的 POSIX 信号场景 |
| 静态与架构检查 | `npm run check` 通过；311 个模块、1321 条依赖无架构违规；中文历史债务 0/0，安全裁剪基线后未增加例外 |
| 打包 | `npm run pack:check` 通过；409 个文件，包含新增公共模块，测试目录、维护 Skill 与临时文件未进入包 |
| 文档与差异 | 61 份维护文档的 579 个本地链接有效；`git diff --check` 通过 |

首轮全量暴露了 Stylelint 诊断结构不符合统一结果的问题，修复后定向测试通过，再对收敛后的完整源码重跑取得上表结果。最终日志保存在忽略目录 `test/.tmp/unification-tests-final.log`、`test/.tmp/unification-check.log` 和 `test/.tmp/unification-pack.json`。本轮修复保留在重构分支工作区，未提交、推送或发布。

## 2026-09-10：CI 默认模式继承与架构说明偏差修复

- 子应用只填写 `ci.gatePolicy.gates` 时继续继承仓库默认模式，显式填写应用 `defaultMode` 后才覆盖；根具体 Gate 覆盖不向应用继承。非法容器、空值和未知字段继续拒绝，原配置保持不变。
- 新增配置与实际 CI 调度回归：根 `enforce` 继续激活并阻断违规检查，`report` 继续执行但不阻断，`off` 继续在执行前跳过；应用局部覆盖不会重置其他 Gate。相关配置、策略、多应用 CI 与外部门禁测试 48 项通过，回归在修复前已确认失败。
- SVG 与可导出 HTML 同步补上独立绑定、Gate 或命令检查、签名证据、跨仓交换、联合验证和人工验收。总览将待扩展内容明确为跨仓自动协调发布，Java 原生检查与自动接入仍为未实现。
- 静态检查通过，311 个模块、1321 条依赖无架构违规，中文债务为 0/0；11 项相关文档测试、SVG XML 与 HTML 内嵌图一致性检查通过。已渲染并目视检查布局；未将浏览器导出路径标记为已验证。
- 打包检查通过；Java 当前命令接入、质量基线建议与后续原生适配范围已单独说明，不代表本轮已实现 Java 执行器。本轮在现有重构分支完成，未提交、推送或发布。

上节 1132 项全量结果是此次追加修复前的基线；本节记录此次变更对应的定向验证，不将旧全量结果冒充本次完整回归。

## 2026-09-10：提交前最终验证

本次将上述统一性修复、CI 默认模式继承、架构图与 Java 接入说明一并收口到 `refactor/node-engineering-2.0.0`。Java 说明按确认范围仅列通用检查，使用消费项目的依赖与版本配置，执行已有测试；测试执行完整性需要项目验证器或后续报告适配，未增加 Java 原生能力。

| 验证 | 结果 |
|---|---|
| 完整回归 | `npm test -- --test-concurrency=4`：1141 项，1139 通过、0 失败、0 取消、2 跳过；跳过项为需显式启用的真实 k6 集成和当前 Windows 不适用的 POSIX 信号场景 |
| 静态与架构检查 | `npm run check` 通过；311 个模块、1321 条依赖无架构违规，中文历史债务 0/0 |
| 最新说明复核 | 文档测试 25 项全部通过；提交前定向代码复核未发现新的阻断级问题 |
| 打包检查 | `npm run pack:check` 通过，410 个文件；测试、维护 Skill、私钥和临时文件未进入包 |

日志保存在忽略目录 `test/.tmp/pre-push-full-tests-20260910.log`、`test/.tmp/pre-push-check-20260910.log`、`test/.tmp/pre-push-docs-20260910.log` 和 `test/.tmp/pre-push-pack-20260910.json`。上述完整回归包含此前追加的 CI 策略修复；本次不执行 npm 发布。

## 2026-09-11：Java Maven 检查与目录规则收口

本轮在 `feat/java-engineering-checks-2.0.0` 保留并完善 Java 检查实现。当前源码共有 49 个可配置功能，其中 18 项为 Java 专用检查；本次增补文件与目录命名、SpotBugs、PIT，Gradle、自动安装与配置适配仍不在本轮范围。当前能力与接入要求以 [Java 接入说明](java-quality-integration.md)为准，上文未提供 Java 执行器的描述属于历史记录。

| 范围 | 当前实现 |
|---|---|
| 文件与目录 | `javaPathNaming` 使用完整 Git 索引，分别检查文件名、包目录及团队后缀；`javaFiles` 管理源码位置与禁止入库产物，复用独立 `filePlacement` 与保护文件规则 |
| SpotBugs | 使用固定版本原生工具分析生产字节码，核验本次输入与报告、逐模块范围、置信优先级及显式豁免 |
| PIT | 核验原始测试、有效 POM、本次变异报告与逐模块得分；零执行、全部跳过、异常状态及陈旧报告不能通过 |
| 执行边界 | Maven 门禁共用隐式参数预检，拦截 `.mvn`、环境变量、RC 与启动控制属性中的不支持覆盖；保留明确的资源参数，不静默丢弃项目配置 |
| 解耦与隔离 | 配置、采集、原生报告、策略、Gate 和生命周期分别维护；前端、Node 与 Java 各自配置；重型工具不进入 pre-commit |
| 维护 | README、两个公共 Schema、功能索引、三份专项文档、Java 接入、架构总览与按功能组织的测试同步更新；字段提供用途、可填值及约束 |

独立审查复现并修复了 PIT 参数及有效 POM 属性缩小检查范围、复杂通配符阻塞，以及 Maven 隐式参数关闭 SpotBugs 检测器的问题。修复后重新验证原绕过路径，在工具启动前明确返回配置错误；原阻塞样例改用有预算的动态规划后能立即返回。也补齐了多模块同名类、输入与报告归属、累计超时、取消及统一错误边界的验证。

| 最终验证 | 结果 |
|---|---|
| 全量回归 | `npm test -- --test-concurrency=4`：1264 项，1255 通过、0 失败、0 取消、9 跳过，耗时约 395 秒 |
| Java 原生复验 | 单独启用上述跳过项中的 7 项 Java 测试，全部通过：既有 Maven/ArchUnit/JaCoCo 2 项，SpotBugs 2 项，PIT 3 项；均使用已有离线缓存 |
| 原生失败对照 | 覆盖编译和测试失败、Enforcer 跳过及 WARN 降级、架构越层、覆盖率不足和缺报告、空指针、PIT 得分不足和全部跳过，以及隐藏参数绕过 |
| 静态与架构检查 | `npm run check` 通过，354 个模块、1491 条依赖无架构违规；中文历史债务 0/0 |
| 文档与打包 | 文档测试 25 项通过；打包预览 457 项，包含新增运行模块、Schema 与文档，测试、缓存和仓库维护 Skill 未入包 |

全量默认跳过项中的另外两项为显式开启的真实 k6 远端测试，以及当前 Windows 不适用的 POSIX 信号场景，本轮没有把它们计为通过。原生版本组合和适配范围分别记在功能文档中，不能将这些验证推广成所有 Maven、JDK 或插件版本均已验收。

早期回归中的异常类型与文档示例问题已修复。两项 Windows 进程清理测试首次在沙箱内失败，使用正常清理权限完成上述全量回归；没有放宽既有进程清理逻辑或测试断言。

最终日志位于忽略目录：`test/.tmp/java-expansion-full-final.log`、`test/.tmp/java-expansion-check-final.log`、`test/.tmp/java-expansion-docs-final.log`、`test/.tmp/java-expansion-pack-final.log`、`test/.tmp/java-engineering-native-final.log`、`test/.tmp/java-spotbugs-native-final.log` 与 `test/.tmp/java-pit-native-final.log`。本轮源码保留在当前功能分支工作区，未提交、推送或发布。

## 2026-09-11 仓库级文件归位与 Java 验收清单

在 `feat/repository-file-placement-2.0.0` 上保留已有 Java 成果并补充独立仓库能力。根字段 `repository.filePlacement` 默认关闭，启用前明确配置规则；功能名为 `repositoryFilePlacement`，统一 Gate 为 `repository.global-file-placement`。可配置能力总数增至 50，Java 专项仍为 18。

- 根规则按仓库路径检查全部应用及公共目录，应用规则与例外不能覆盖；共同复用文件归位策略，配置、Git 路径事实、Gate 与生命周期分别维护。
- 提交阶段覆盖完整实际待提交索引；推送与 CI 覆盖完整目标提交；手动审计受控及未忽略工作区文件。历史错位文件、应用筛选、仅修改公共文件均不会缩小根检查范围。
- 独立审查修正了推送入口的可变 HEAD 与附注标签解析、`git add -N` 占位路径误判，以及 `root: "."` 时遗漏公共 AI 规范的问题。实际应用配置不因规范合成而继承根规则。
- 统一报告提供来源、完整提交标识、覆盖与匹配数量、排除的子模块数和中文修复指引；Git 读取失败与不可信范围保持统一错误分类。
- 完整回归发现一处旧图片测试样例未剥离新根字段，已将其移回样例根配置，保留原图片检查断言；相关边界测试 25 项通过。

完整回归 1307 项：1298 通过、9 条件跳过、0 失败。随后补齐空变更 CI 同根规范场景，最终全部 CI 与相关边界测试 82 项通过。静态与架构检查、文档 25 项回归及 462 条打包清单检查通过；本轮未重跑既有 7 项 Java 原生测试，不把默认跳过计为通过。

字段、规则优先顺序和边界见[仓库级文件归位](features/repository-file-placement.md)。18 项 Java 功能的测试映射、原生工具证据和团队实际项目复核要求统一维护在 [Java 验收清单](java-check-acceptance.md)，最终验证统计与本轮日志见该文档末尾。本轮不执行提交、推送或发布。
