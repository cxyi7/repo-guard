# 功能说明文档索引

CI 首次分支推送已补齐默认分支共同祖先基准，仍拒绝不完整历史；Windows 超时测试核对真实进程退出，仓库测试默认并发为 4。

蓝绿部署默认仅切换应用并保留当前数据；可通过 `blueGreen.backup.enabled: true` 启用已声明资源的快照与恢复。普通模式保留旧应用直到新入口健康检查通过，失败后验证回退结果；恢复失败保持维护并通知。

- [蓝绿部署与数据恢复](blue-green-deployment.md)：2.1.0 独立新增；GitLab／手动共用发布入口、Java Maven 构建、维护窗口、数据恢复与飞书／企业微信部署通知。

当前 CI 已取消公开档位，统一按项目配置执行；本地使用、公共必查项、独立企业微信/飞书通知与接入测试见 [CI 使用说明](ci.md)。最终验收使用独立 delivery-check 命令。

两个固定 Vue TypeScript／Java Maven 消费项目的安装产物、真实流水线、失败恢复、退出码与飞书通知见 [2026-09-14 CI 验收记录](../ci-acceptance-2026-09-14.md)。合同与发布部署仍属于独立运维待办。

本轮全部新增功能统一归入 2.0.0 重构；链接中的 2.1.0～7.2.0 审查文件保留为历史开发记录，不代表独立发布。

完整流程的六项跟踪工作见 [AI 接入、合同交付与发布流程待办](../end-to-end-workflow-backlog.md)：T05 已完成，基础蓝绿已实现；其余自动接入、验收矩阵、合同接口验收、受控挑拣和合同发布联动仍有待办。清单分别登记功能缺项、真实验收缺项与本轮提交合并收尾。

给出最佳配置与接入预设时，统一遵守[消费项目预设设计原则](consumer-preset-design-principles.md)：假设待接入项目尚无规范，先建立规则并确认覆盖范围，不能依赖代码已经符合建议的命名和目录。

- [Token 指定值与生成 CSS 校验](ui-token-values.md)：源码定义必须符合明确约定；可选在真实构建后核对 CSS 输出，失败不登记构建证据。

当前接入只使用新格式：自有结构化配置、登记表、基线与报告统一为 v2，Hook 仅接受当前 v5，AGENTS 仅接受当前托管区块；旧文件拒绝处理且不自动转换。公共写入口先检查相关托管格式，避免拒绝旧输入时留下部分写入；无法识别的执行锁也保留并阻断。格式清单与重新接入边界见[配置管理与规则启停](configuration-management.md)。

每项能力都提供用途、接入或调用方式、执行范围、判断依据、失败处理以及实现和测试入口。安装与日常操作从[使用说明](../usage-guide.md)开始；内部模块职责见[维护者架构说明](../project-structure-and-feature-inventory.md)。

所有命令、Hook、CI 和交付入口复用[统一结果与退出码](gate-result-and-reporting.md)：`0` 成功或非阻断，`1` 配置/执行错误，`2` 违规或交付条件未满足，`3` 范围错误。多应用按固定优先级汇总，查询成功、只报告和跳过仍需按各自语义阅读，不能仅凭 `0` 判定交付完成。

交付相关能力统一维护在[交付合同手册](delivery-contract.md)：功能登记、合同、证据和反馈是同一条流程，下面按环节链接到同页相应位置。

v2 工程能力按应用维护：`checks`、应用 `repository` 策略及 `ci.externalGates` 独立配置。构建基线和 UI Token 契约保护写入所属应用；仓库公共配置只管理提交信息、公共 CI 流程、通知动画和基础文件保护。子应用使用 `project.schema.json`，完整归属见[前后端与多应用配置](project-workspace.md)。

[独立交付合同](delivery-contract.md#独立交付与跨仓库协作)使用 `repo-guard.delivery.json`，既可单独开启，也可与工程检查同时开启。同仓或分仓的前后端共同遵循合同，Java、Python 参与方不需要声明 Node 工程预设。合同绑定实际代码、检查证据、联合验证、人工验收和反馈改进。

当前配置加载、功能启停和各执行入口共同使用原生 v2 模型；质量检查与运维发布独立维护。具体改动与验收依据见 [2.0 重构工作清单](../refactor-2.0-remaining-work.md)。下表“已维护”表示已有对应功能文档，不表示已发布到 npm。

## 接入与托管

前端四项工具支持[内联预设与原生配置合并](frontend-tool-presets.md)：启用时保存可修改的 options，项目原生配置优先，支持最终配置查询和接入依赖要求。

| 功能 | 说明文档 | 状态 |
|---|---|---|
| 项目初始化 | [docs/features/project-initialization.md](project-initialization.md) | 已维护 |
| 显式前后端身份与多应用工作区 | [docs/features/project-workspace.md](project-workspace.md) | 已维护，统一目录与工具定位，局部 Gate 覆盖保留仓库默认模式 |
| 配置管理与规则启停 | [docs/features/configuration-management.md](configuration-management.md) | 已维护 |
| Doctor 诊断与受管修复 | [docs/features/doctor.md](doctor.md) | 已维护，共用应用工具定位与损坏安装诊断 |
| 托管 Git Hook | [docs/features/managed-git-hooks.md](managed-git-hooks.md) | 已维护，区分快照缺失与 Git 执行失败 |
| 小猫与小狗提交动画（十种类型道具、内置彩蛋、中断恢复） | [docs/features/commit-animation.md](commit-animation.md) | 已维护，含动图预览 |
| AGENTS 托管规范 | [docs/features/managed-agent-policies.md](managed-agent-policies.md) | 已维护，核验仓库及所选应用规范一致性 |
| GitLab CI 安装与触发 | [docs/features/gitlab-ci.md](gitlab-ci.md) | 已维护，项目配置驱动、公共必检、独立通知与 Bash 退出码保留 |

## 提交阶段质量与安全

Java Maven 的 18 项能力独立于 Node 检查，完整接入流程见 [Java 接入说明](../java-quality-integration.md)，逐项复核见 [Java 验收清单](../java-check-acceptance.md)。源码、路径、字节码、构建与测试分别维护；启用检查不会自动安装工具。

Java 工程问题按模块和规则对象提供可定位证据及修复步骤，Maven/SpotBugs/PIT 的原始进程状态通过公共诊断保留。同根应用托管规范合并公共提交、交付和归位要求；不会改变本方工程开关。相关约定见[统一报告](gate-result-and-reporting.md)与[AI 规范维护](managed-agent-policies.md)。

| Java 功能 | 说明文档 | 状态 |
|---|---|---|
| 格式、命名、包路径、导入、规模、Javadoc、静态问题与重复代码 | [docs/features/java-source-checks.md](java-source-checks.md) | 已维护 |
| 文件与目录命名、按目录约束文件后缀 | [docs/features/java-path-naming.md](java-path-naming.md) | 已维护 |
| SpotBugs 字节码缺陷与优先级门禁 | [docs/features/java-spotbugs.md](java-spotbugs.md) | 已维护 |
| PIT 变异测试、原始测试与逐模块得分 | [docs/features/java-mutation-test.md](java-mutation-test.md) | 已维护 |
| 架构、依赖、文件放置、编译、构建、测试与覆盖率 | [docs/features/java-engineering.md](java-engineering.md) | 已维护 |

| 功能 | 说明文档 | 状态 |
|---|---|---|
| 暂存隔离与跨进程重入保护 | [docs/features/staged-isolation-and-lifecycle-lock.md](staged-isolation-and-lifecycle-lock.md) | 已维护，索引与对象损坏保留执行错误 |
| Stylelint | [docs/features/stylelint.md](stylelint.md) | 已维护 |
| ESLint | [docs/features/eslint.md](eslint.md) | 已维护 |
| Prettier | [docs/features/prettier.md](prettier.md) | 已维护 |
| 文件头同步 | [docs/features/file-header.md](file-header.md) | 已维护 |
| 函数文档同步 | [docs/features/function-documentation.md](function-documentation.md) | 已维护 |
| Vue 异步资源清理 | [docs/features/async-resource-cleanup.md](async-resource-cleanup.md) | 已维护 |
| Stylelint 子能力：Token 检查：CSS、SCSS/Sass、Less | [docs/features/ui-tokens.md](ui-tokens.md) | 已维护，已移除图标尺寸推断，解析失败保留配置错误及独立 Stylelint 诊断 |
| Stylelint 子规则：复杂度 | [docs/features/style-complexity.md](style-complexity.md) | 已维护 |
| Stylelint 子能力：隔离与全局目录 | [docs/features/style-governance.md](style-governance.md) | 已维护 |

## 仓库与代码治理

| 功能 | 说明文档 | 状态 |
|---|---|---|
| 路径命名 | [docs/features/path-naming.md](path-naming.md) | 已维护 |
| 文件归位 | [docs/features/file-placement.md](file-placement.md) | 已维护 |
| 仓库级文件归位 | [docs/features/repository-file-placement.md](repository-file-placement.md) | 已维护，全索引或完整目标提交，不受应用筛选影响 |
| 单文件行数 | [docs/features/maximum-file-lines.md](maximum-file-lines.md) | 已维护 |
| 代码位置 | [docs/features/code-placement.md](code-placement.md) | 已维护 |
| 保护文件 | [docs/features/protected-files.md](protected-files.md) | 已维护 |
| 企业微信通知 | [docs/features/wecom-notification.md](wecom-notification.md) | 已维护 |
| 图片资源质量 | [docs/features/image-assets.md](image-assets.md) | 已维护 |
| 图片安全优化与应用选择 | [docs/features/image-optimization.md](image-optimization.md) | 已维护 |
| 无效图片资源与 Git 基线 | [docs/features/unused-image-assets.md](unused-image-assets.md) | 已维护，支持应用历史配置 |
| 依赖声明、三种包管理器锁文件与工具就绪 | [docs/features/dependency-policy.md](dependency-policy.md) | 已维护 |
| 提交信息生命周期 | [docs/features/commit-message.md](commit-message.md) | 已维护 |
| 结构化例外 | [docs/features/structured-exceptions.md](structured-exceptions.md) | 已维护，按应用隔离批准范围 |
| 树形功能登记 | [交付合同手册 · 功能登记与合同规划](delivery-contract.md#功能登记与合同规划) | 已维护 |
| 交付合同门禁 | [docs/features/delivery-contract.md](delivery-contract.md) | 已维护 |
| 交付证据复核 | [交付合同手册 · 交付证据与两轮复核](delivery-contract.md#交付证据与两轮复核) | 已维护 |
| 真实反馈反向升级 | [交付合同手册 · 真实测试反馈与反向升级](delivery-contract.md#真实测试反馈与反向升级) | 已维护 |

## 测试、构建与性能

| 功能 | 说明文档 | 状态 |
|---|---|---|
| 单元测试 | [docs/features/unit-test.md](unit-test.md) | 已维护 |
| 覆盖率 | [docs/features/coverage.md](coverage.md) | 已维护 |
| 变异测试 | [docs/features/mutation-test.md](mutation-test.md) | 已维护 |
| 受保护构建 | [docs/features/guarded-build.md](guarded-build.md) | 已维护 |
| TypeScript 类型检查 | [docs/features/typecheck.md](typecheck.md) | 已维护 |
| dependency-cruiser 架构检查 | [docs/features/architecture.md](architecture.md) | 已维护 |
| Knip 无效代码与基线 | [docs/features/dead-code.md](dead-code.md) | 已维护 |
| 项目构建 | [docs/features/build.md](build.md) | 已维护 |
| 单平台构建产物预算 | [docs/features/build-artifact-budget.md](build-artifact-budget.md) | 已维护 |
| 前端构建与性能预设 | [docs/features/frontend-performance-presets.md](frontend-performance-presets.md) | 已维护 |
| Skill 接入待办清单 | [docs/features/skill-integration-backlog.md](skill-integration-backlog.md) | 仅记录，Skill 待实现 |
| 包体积分析 | [docs/features/bundle-analysis.md](bundle-analysis.md) | 已维护 |
| Lighthouse | [docs/features/lighthouse.md](lighthouse.md) | 已维护 |
| Axios 接口性能 | [docs/features/api-performance.md](api-performance.md) | 已维护 |
| k6 接口压测 | [docs/features/k6-load-test.md](k6-load-test.md) | 已维护 |

## CI、报告与发布准备

| 功能 | 说明文档 | 状态 |
|---|---|---|
| 官方 Gate Registry | [docs/features/gate-registry.md](gate-registry.md) | 已维护，CI 计划逐级复用公共步骤 |
| GateResult 与报告 | [docs/features/gate-result-and-reporting.md](gate-result-and-reporting.md) | 已维护，中文问题与第三方诊断独立保留和展示 |
| 项目外部门禁 | [docs/features/external-gates.md](external-gates.md) | 已维护，共用有时限的进程树清理 |
| GitLab 应用交付流水线 | [docs/features/managed-delivery-pipeline.md](managed-delivery-pipeline.md) | 已维护 |
| 独立运维与各应用发布 | [docs/features/operations.md](operations.md) | 已维护，独立 ops 配置，通知覆盖 MR 与分支流水线 |
| 发布就绪检查 | [docs/features/release-ready.md](release-ready.md) | 已维护 |

## 单项文档约定

普通能力按独立主题维护；交付合同按完整流程集中维护，用同页锚点定位各环节。每个主题至少回答：

1. 解决什么问题，边界是什么；
2. 如何启用、配置或调用；配置示例旁逐项说明字段用途、可填值、默认值与约束；
3. 在哪些生命周期执行，读取什么范围；
4. 通过、跳过和失败如何判断，产生哪些证据；
5. 失败后如何修复和复核；
6. 有哪些安全限制、明确不做的事情；
7. 实现入口与对应测试位于哪里。

单项文档描述当前有效实现；版本演进和历史变化只记录在 [CHANGELOG](../../CHANGELOG.md)。

### 配置示例怎么读、怎么维护

- JSON 示例保持标准 JSON，复制时不需要删除注释；紧随其后的字段表解释用途、可选值、默认值、数值范围、路径格式及字段联动。YAML 和 JavaScript 支持注释，可在字段同一行说明。
- 表头注明字段所在对象，例如 `checks.pathNaming`；`entries[].reason` 表示数组中每个对象的 `reason`。中间对象用于分组，不能把子字段直接移到配置根级。
- 默认值指省略字段时的补缺值；示例值是当前示例的选择。首次初始化依据显式预设生成基础开关，不会根据依赖探测自动启用其他功能，不能把示例中的 `true` 一律写成默认开启。
- `false`、`null`、`0` 和 `[]` 含义不同，不能互换；可为空、可省略、必填及“关闭检查”等语义必须按对应字段说明。数组配置会整项替换，修改主配置片段时保留其他已有字段。
- 枚举必须列出所有允许值，数字说明单位和上下限，路径说明相对哪个目录、是否支持 glob、是否允许为空以及排除优先级。涉及脚本、报告、凭据环境变量或人工确认时，写明前置条件和绑定要求。
- 新增或修改字段时，同时修改示例及旁边的说明；用配置 Schema、补缺默认值和实际校验逻辑交叉核对，不从字段名猜测含义。

## 文档随功能一起维护

| 发生什么变化 | 同步哪些内容 |
|---|---|
| 新增、修改或移除功能 | 对应功能说明、此索引、使用说明入口及开关描述；领域或生命周期变化时同步项目总览 |
| 开关、默认值、范围、联动改变 | 使用说明的能力开关表、相关专题的配置示例与字段说明、配置 Schema 与测试 |
| CLI、Hook、CI 或报告变化 | 操作示例、执行范围、错误处理、相应流程图与回归测试 |
| 交付字段或验收规则变化 | 统一交付手册的流程、时序、反馈图、字段参考，以及 Skill 模板与测试 |
| 模块或依赖边界变化 | 维护者架构说明与架构测试 |

新能力在交付时就应有可用说明，不登记尚不存在的文档链接。维护时核对源码、Schema、执行计划和测试；检查示例可解析、开关不遗漏、相对链接与锚点可达，SVG 与 Mermaid 源文件含义一致。历史演进只写入 CHANGELOG。

- [前端文件组织与维护预设](frontend-maintenance-presets.md)：目录归位、统一命名、文件规模、分层和公开函数文档；不限制依赖包内部路径。

公共方法测试支持自定义目录和文件名，单元测试映射、覆盖率与变异范围遵循用户配置，详见[单元测试](unit-test.md)与[变异测试](mutation-test.md)。

| 前端图片治理预设 | [docs/features/frontend-image-presets.md](frontend-image-presets.md) | 已维护 |

前端图片治理的完整审查范围、反例与真实浏览器验证见 [3.2.0 审查记录](../reviews/frontend-image-governance-3.2.0.md)。

| 六组源码安全检查 | [docs/features/source-security.md](source-security.md) | 已维护 |

已删除能力：[表单标签与图片替代文本门禁删除说明](template-accessibility-removal.md)。

依赖声明、三种包管理器及工具就绪的实现审查见 [7.0.0 审查记录](../reviews/dependency-managers-7.0.0.md)。

特殊引用处理已修正为跳过对应依赖，不产生不支持违规；同一清单中的普通依赖继续检查，详见依赖策略及 7.0.0 审查记录。

图片检查接入示例已同步 Sharp 0.35.4；开发依赖漏洞修复及验证见 [2026-09-13 审计记录](../reviews/npm-dependency-audit-2026-09-13.md)。

7.1.0 前端新建及显式启用默认开启 [Knip 核心检查](dead-code.md)，支持 checks.deadCode.options 与项目原生配置合并；特殊依赖引用跳过，显式空匹配与零分析阻断。接入 Skill 仅记录，入口和动态使用仍需实际核对。

前端 Knip 默认预设与原生配置合并的真实复现、修复和验证见[7.1.0 审查记录](../reviews/frontend-dead-code-7.1.0.md)。

7.1.1 [提交规范](commit-message.md)新预设默认开启并禁止 merge commit，保留本地自动文件摘要；[接口验收与受控挑拣](delivery-contract.md#后续计划接口验收与受控挑拣未实现)仅登记为交付合同后续计划，尚未实现。

提交规范预设的真实 Git 验证见[7.1.1 审查记录](../reviews/commit-message-preset-7.1.1.md)。

7.1.2 修正前端 TypeScript 的[类型检查](typecheck.md)新建开关，并默认开启 Stylelint 的 [UI Tokens](ui-tokens.md) 主开关；既有配置保持原值，清单等接入缺项仍必须补齐。

默认开关遗漏与真实工具验证见[7.1.2 审查记录](../reviews/frontend-default-switches-7.1.2.md)。

前端 22 项应用配置和 Node 后端适用性见[前端与 Node 后端审查记录](../reviews/frontend-node-audit-7.1.3.md)；[Node 后端使用边界](node-backend.md)列出默认规范、可选检查、接入条件与真实验证。

7.1.4 的 [Node 后端默认规范](node-backend.md)写入新建项目，既有配置保持；Java 检查未随 Node 开关调整。

默认开关与真实验证结果见 [Node 默认配置审查](../reviews/node-default-presets-7.1.4.md)。

Java 新建模板默认开关及接入缺项见 [Java 接入说明](../java-quality-integration.md)；18 项均默认开启，未完成接入时严格阻断。

Java 默认全开模板与阻断边界见 [7.1.5 审查记录](../reviews/java-default-presets-7.1.5.md)。

[目录职责与路径绑定](directory-roles.md)为 Java、Node、前端提供可编辑的目录约定，检查范围从目录引用解析；绑定不替代原生工具接入与业务验证。

目录功能的复现、修复与真实执行证据见 [7.2.0 审查记录](../reviews/directory-roles-7.2.0.md)。

目录职责二次审查已覆盖前端与 Node 的四种语言预设；完整默认路径及用途见[通用目录模板](directory-roles.md#前端与-node-的通用模板)。局部目录校验与 Schema 均拒绝显式 null 绑定。

CI 通知已覆盖 GitLab 按提交检出时的分支展示，并区分合并请求源分支与标签；详见 [CI](ci.md)。
