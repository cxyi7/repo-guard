# 2.0 重构剩余工作清单

更新日期：2026-09-09。工作分支：`refactor/node-engineering-2.0.0`。目标版本：`2.0.0`。

**当前是阶段性成果，尚未完成全部内部重构。** 前端与 Node 后端已接入显式项目配置，多应用调度、独立运维入口和测试分组已经实现；但新配置仍被转换为旧的内部执行结构，旧 CI 发布模板与通知也尚未完全退出。本次提交用于保存现有成果和后续工作依据，不代表完成发布验收。

[项目结构与能力总览](project-structure-and-feature-inventory.md) · [功能索引](features/README.md) · [使用说明](usage-guide.md)

## 已实现的范围

| 范围 | 当前成果 |
|---|---|
| 显式项目身份 | 人或 AI 配置 `project.id / role / stack / preset`；支持 Vue 和 Node 的 JavaScript / TypeScript 预设，不猜测项目类型 |
| 配置与工作区 | 外部配置使用 v2；支持单应用、多应用、自定义应用配置路径和 `--project` 目标选择 |
| Node 工程检查 | 按项目身份复用通用代码、依赖、架构、测试与构建能力，跳过不适用的 Vue 专项；使用消费项目的工具和配置 |
| Git 与 CI | 按应用隔离索引、推送快照、规则和报告；保留部分暂存恢复、失败汇总和配置删除阻断 |
| 独立运维 | 通过 `repo-guard.ops.json` 生成按应用区分的 GitLab 质量、构建、产物和部署任务，生产部署手动触发 |
| 测试和资料 | 测试已按功能目录分组；README、配置 Schema、功能手册和架构图已更新到当前外部模型 |

这些成果不等于内部模型已经统一。以下待办应完成后，再判断本次重构是否收尾。

## 本次重构必须完成的工作

### R1：统一内部执行配置

- [ ] 建立明确的内部执行模型，使配置校验、默认值、Gate、执行计划和规则启停共同使用这一模型。
- [ ] 迁移仍依赖旧字段的调用者，删除仅为外部 v2 转回内部 v1 而存在的映射。
- [ ] 核对 Gate 的配置版本声明、初始化入口和 AGENTS 规则映射，避免只修改版本数字而留下旧行为。

**当前证据：** [project-configuration.js](../src/config/project-configuration.js) 的预设和仓库归一化仍创建 `version: 1` 对象，再附加 `configVersion: 2`；[project-feature-paths.js](../src/config/project-feature-paths.js) 将 `checks` 映射到 `preCommit`、`unitTest` 等旧字段。[configuration-validation.js](../src/config/configuration-validation.js) 和 [gate-definition.js](../src/core/capability/gate-definition.js) 仍以旧执行模型为基础。

**验收标准：** 新项目的加载、启停、Doctor、Hook、CI 和手动检查使用同一套执行模型；日常执行不依赖旧项目配置解析器。允许为执行需要做归一化，但不再靠转换为旧版项目配置驱动检查。既有规则开关、阈值、例外范围和检查顺序保持有效。

### R2：移除质量配置中的旧发布设置

- [ ] 从常规质量配置的默认值、校验、复制逻辑和调用者中移除 `ci.pipeline`。
- [ ] 将旧发布字段的读取限制在迁移边界，质量配置只负责质量执行策略。
- [ ] 核对质量 Schema 的说明文字，清除仍将应用部署描述为质量配置职责的内容。

**当前证据：** 外部 Schema 已移除 `ci.pipeline`，但 [defaults.js](../src/config/defaults.js) 仍定义 `DEFAULT_CI_PIPELINE_CONFIG`，[ci-validation.js](../src/config/ci-validation.js) 仍校验旧构建、部署、分支和通知设置，[config-copy.js](../src/orchestration/setup/config-copy.js) 仍复制这些字段。

**验收标准：** 新配置及其执行对象中不存在旧发布字段；运维只从独立配置读取发布设置。历史字段只在迁移及必要的旧托管文件升级处理和测试中保留。

### R3：拆净旧 GitLab 发布模板及通知入口

- [ ] 让质量 CI 安装器只生成质量检查内容，让独立运维入口负责构建、产物和部署。
- [ ] 删除不再使用的旧发布模板及薄桥；仍需支持的旧托管文件识别放入明确的升级处理逻辑。
- [ ] 明确旧流水线通知的去向：若保留，补齐独立运维配置、作业生成和验证；若移除，给出迁移提示及文档说明。
- [ ] 移除变异测试通知对旧 `ci.pipeline.notifications` 的依赖。

**当前证据：** [gitlab-ci.js](../src/operations/gitlab/gitlab-ci.js) 仍生成旧 pipeline 基类，并在安装和检查时读取 `config.ci.pipeline`；[gitlab-managed-pipeline.js](../src/operations/gitlab/gitlab-managed-pipeline.js) 保留旧发布渲染器。[旧 setup 桥接](../src/orchestration/setup/gitlab-managed-pipeline.js) 和 [旧 Gate 通知桥接](../src/gates/release/gitlab-ci-notification.js) 仍存在。

[旧通知实现](../src/operations/notifications/gitlab-ci-notification.js) 仍依赖旧流水线环境标记；[新运维渲染器](../src/operations/gitlab/renderer.js) 尚未生成对应通知作业。[mutation-test-notification.js](../src/gates/release/mutation-test-notification.js) 仍读取旧通知开关。实现文件迁入 `operations` 目录，不等于通知功能已经接入新运维流程。

**验收标准：** 质量模板不生成旧发布任务；新运维流程可独立安装、检查和执行。应用作业、产物与环境保持隔离；已有托管文件仍能识别，人工修改和冲突不会被覆盖。通知是否发送、由谁配置及失败如何处理都有一致实现和测试，不再依赖旧发布字段。

### R4：统一发布前检查计划

- [ ] 让消费项目的 `release-ready` 按项目适用能力执行通用工程检查。
- [ ] 清理按新旧配置版本选择两套计划的分支，核对旧计划导出及调用者的兼容处理。
- [ ] 明确区分消费项目发布前检查与 repo-guard 自身的 npm 发布验证。

**当前证据：** [execution-plans.js](../src/orchestration/execution-plans.js) 仍保留 `release.check / release.test / release.package` 旧计划，并通过 `configVersion === 2` 切换到新的工程检查流程。

**验收标准：** 前端、Node 后端及多应用目标使用明确且一致的发布前检查计划，不因历史配置标记执行另一套检查；不默认将消费项目视为要发布的 npm 包。本仓库自身的 npm 发布检查仍按维护者发布流程执行。

### R5：隔离旧配置迁移并完善提示

- [ ] 将 v1 读取、历史默认值和字段转换集中到迁移模块，避免新运行时复用旧配置校验链路。
- [ ] 对不能自动转换的运维设置给出字段、原值含义、目标配置位置和处理要求，避免只有笼统报错。
- [ ] 保留原文件和既有备份保护；迁移失败不能写出半套配置或丢失团队规则。

**当前证据：** [migrateProjectConfig](../src/orchestration/setup/config-management.js) 调用 [migrateLegacyConfig](../src/config/project-configuration.js)，仍复用现有内部校验器。当前只要旧 pipeline 与默认值不同，就会阻断迁移并要求人工拆分；尚未实现逐字段迁移报告，也没有自动转换部署设置。即使旧 pipeline 已关闭，但保留了定制值，也可能触发这一阻断。

**验收标准：** 普通 v1 配置转换后保留可适用的规则、阈值、开关和例外；不适用或无法转换的设置有具体说明。旧运维设置不会被静默丢弃，原配置保持可恢复；重复迁移及备份冲突有测试。v1 只作为显式迁移输入存在，不进入正常执行路径。

### R6：让测试直接验证新模型

- [ ] 将常规测试数据改为新配置或新执行模型；只在迁移测试中构造旧项目配置。
- [ ] 清理将 v2 测试结果转回旧字段再断言的辅助逻辑。
- [ ] 随 R1—R5 更新模型、计划、通知和迁移边界测试，不降低既有行为断言。

**当前证据：** [test/helpers/project-config.js](../test/helpers/project-config.js) 仍将旧配置转换成 v2 文件，并在解析后返回旧字段供断言使用。目录重组已经完成，测试模型切换尚未完成。

**验收标准：** 测试直接证明新模型生效，而不是证明旧模型经过转换仍能运行。继续覆盖固定 Hook 顺序、部分暂存与回滚、配置快照、跨应用重命名、配置删除阻断、项目例外范围和 CI 失败汇总。测试按功能放置，不重新堆回 `test` 根目录。

### R7：完成文档与整体回归

- [ ] 对照最终代码同步 README、使用说明、功能索引与专题、Schema、结构图和 CHANGELOG。
- [ ] 删除仅描述过渡实现的说明，明确旧配置迁移与独立协议兼容的边界。
- [ ] 完成静态检查、全量测试和打包检查，并用前端、Node 后端及同仓多应用消费项目复核主要入口。
- [ ] 逐条回填本清单的完成结果与验证依据，再判断是否可以发布。

**验收标准：** 文档示例通过真实 Schema 与运行时校验；安装包包含所需配置和运行模块；上述 R1—R6 的验收均有证据。测试通过不能代替架构待办完成的判断。

## 建议执行顺序

先确定 R1 的统一模型和 R5 的迁移边界，再推进 R2；随后拆净 R3 的模板与通知，完成 R4 的执行计划。R6 随各项修改同步进行，最后执行 R7 的整体回归。保持每一步可运行、可评审，避免一次性删除历史字段后再修补全部调用者。

## 不应当作旧项目配置删除的内容

以下版本各自属于独立协议，不能因为出现 `version: 1` 或 `v1` 就批量替换：

- [UI Token 契约](../ui-token-manifest.schema.json)、构建产物基线、交付合同与证据的格式版本。
- `repo-guard-json-v1` 外部门禁报告、CI 单目标报告等数据协议。
- 已发布的托管 Hook 标记：按照仓库规范继续接受已知旧标记，只生成当前标记。

旧项目配置解析应退出日常执行；这些独立协议是否升级，必须根据各自格式变化单独判断。

## 后续扩展，尚未实施

| 扩展 | 当前边界 | 后续工作 |
|---|---|---|
| Java 后端 | 仅预留 Maven / Gradle 身份与环境需求，当前明确拒绝执行 | 接入 Java 工具、报告、测试和构建适配；仍需 Node 运行 repo-guard，另需 JDK 运行 Java 检查 |
| 工具自动接入 | 开启检查不会自动安装包或生成第三方配置 | 根据显式项目身份、运行环境和已有依赖制定兼容安装计划，生成基础配置并验证就绪；安装不进入日常 Hook |
| 跨仓协作 | 当前按各仓库独立检查和生成本仓发布任务 | 如需联动，单独设计显式协调和权限边界，不默认触发其他团队部署 |

这些是后续能力建设，不应混入“清理旧内部结构”的完成标准。本次范围保持通用工程规范，不新增业务接口输入输出、身份认证或权限规则。

## 当前验证基线

以下是本阶段代码的既有验证结果，不代表上面的待办已经完成：

| 检查 | 结果 |
|---|---|
| `npm run check` | 通过；包括代码规范、架构依赖、语法和中文文案检查 |
| `npm test -- --test-concurrency=4` | 896 项，895 通过、0 失败、1 跳过；跳过项为需显式开启的真实 k6 集成测试 |
| `npm pack --dry-run --json --ignore-scripts` | 通过；已核对新增 Schema 与运行模块进入包，临时测试文件未进入包 |
| 本次文档整理后的复核 | 文档测试 19 项全部通过，新清单的 22 个相对链接目标均存在；`git diff --check` 通过 |

后续实现变化后需要重新验证，并更新这里的结果。提交远程用于保存当前进度，不自动执行合并、打标签或 npm 发布。
