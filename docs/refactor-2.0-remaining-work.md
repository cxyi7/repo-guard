# 2.0 重构工作清单与验收记录

更新日期：2026-09-09。工作分支：`refactor/node-engineering-2.0.0`。目标版本：`2.0.0`。

本轮基于远端提交 `9912a95e222520c06dedb512c270cfe35da01a27` 完成原生 v2 重构。按最新确认，不再保留旧配置、旧 Hook/AGENTS 标记或自有 v1 数据格式；只接受当前格式，全部生成器、校验器、Schema 和 Skill 同步更新。追加收口后的全量复测已通过，结果及首次失败观察记录如下。本记录不代表已提交、合并或发布 npm 包。

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
| Java 后端 | 仅预留 Maven / Gradle 身份与环境需求，当前明确拒绝执行 | 单独接入 Java 工具、报告、测试和构建适配；仍需 Node 运行 repo-guard，另需 JDK 运行 Java 检查 |
| 工具自动接入 | 开启检查不会自动安装包或生成第三方配置 | 根据显式身份、环境与已有依赖制定兼容安装计划；安装不进入日常 Hook |
| 跨仓协作 | 按各仓库独立检查和生成本仓发布任务 | 单独设计协调与权限边界，不默认触发其他团队部署 |

这些后续能力不属于 R1—R7 的内部重构收口范围。本次不新增业务接口输入输出、身份认证或权限规则。

## 最终验证记录

以下均为最新格式收口后的实际验证；定向测试与全量范围重叠，不重复累计。

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
