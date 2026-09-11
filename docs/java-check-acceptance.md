# Java 检查验收清单

本文用于验收当前 `2.0.0` 开发版本的 18 项 Java 检查及其平台接入。验收同时确认“能发现违规”和“无法完成检查时不会误报通过”，并核对配置、入口、应用隔离、报告和统一工程规范。使用步骤与配置说明见 [Java 工程检查接入](java-quality-integration.md)。

范围为显式配置的 Java Maven 应用及语言无关的团队工程规则。Gradle、业务逻辑、接口输入输出、鉴权、部署与自动安装适配不在本轮验收范围。`repositoryFilePlacement` 是独立的仓库公共能力，不计入这 18 项；其验收项目单独列在本文后半部分。

### 2026-09-11 非 CI 验收修复

本轮修复同根应用的公共提交/交付规范遗漏、Java 工程问题缺少语义证据与模块标识冲突、第三方空输出失败原始码丢失、PIT 配置提示指错功能，以及有效 POM 校验时机的文档表述。新增回归分别位于 [规范同步](../test/setup/repository-file-placement-policies.test.js)、[工程报告](../test/gates/java/engineering-report.test.js)、[进程诊断](../test/gates/java/process-diagnostics.test.js)、[公共诊断](../test/core/process-output.test.js) 与 [PIT 配置](../test/config/java-mutation.test.js)。

**CI 目标提交绑定问题按当前决定暂不修复。** 普通 CI 仍可能读取当前工作树/索引，与报告声明的 head 不一致；仅在本地暂存删除目标提交中的违规产物，就可能改变 CI 判定。该问题仍为完整验收阻断项，不能因其他问题修复而标记 Java 全部验收通过。消费项目现场与其他平台验证仍需独立记录。

本轮修复后实际验证（2026-09-11，Windows、Node 22.23.2、JDK 17.0.16、Maven 3.9.11）：

| 验证 | 本轮结果 | 本地日志 |
| --- | --- | --- |
| 完整回归 | 1317 项，1308 通过、0 失败、9 跳过 | `test/.tmp/java-acceptance-fixes-full.log` |
| 修复定向回归 | 42/42 通过；新增源码原始码回归另在全量中通过 | `test/.tmp/java-acceptance-fixes-targeted-final.log` |
| 真实 Java 工具 | Maven 1/1、ArchUnit/JaCoCo 与 SpotBugs 3/3、PIT 3/3，均无跳过 | `java-acceptance-fixes-native-maven.log`、`java-acceptance-fixes-native-extended-spotbugs.log`、`java-acceptance-fixes-native-pit.log`，均位于 `test/.tmp/` |
| 规范检查 | lint、语法、中文及架构检查通过；358 个模块、1508 条依赖无边界违规 | `test/.tmp/java-acceptance-fixes-check-final.log` |
| 打包核对 | 463 项，包含新问题语义模块，不包含测试、临时缓存或 JAR | `test/.tmp/java-acceptance-fixes-pack.log` |
| 实际 CLI 消费样例 | 同一缺失规范样例先被 Doctor 阻断，修复后公共与 Java 规范齐全，再次诊断通过 | `test/.tmp/java-acceptance-fixes-cli-results.json` |

全量默认跳过的 7 项 Java 原生测试已另行启用并通过；另外 2 项为外网 k6 和 Windows 不适用的 POSIX 信号样例，未执行。定向及原生结果不重复计入全量通过数。日志为本地验证产物，不随 npm 分发；本轮没有提交或发布。

## 1. 如何判定完成

需要同时具备以下三类证据，不能仅凭开启成功或命令返回成功判定完成：

1. **代码与配置契约**：实现、公共注册、Schema、帮助、开关、Doctor、生命周期和文档一致。
2. **仓库回归与原生工具验证**：正常、违规、缺少证据、工具异常及跨应用边界均有实际断言；可选原生测试必须单独记录是否真正执行。
3. **消费项目现场验收**：团队实际使用的 JDK、Maven、插件、模块、测试、路径和 CI 环境能够提供本次有效证据；项目维护者确认规则与范围完整。

以下“已有证据”指已存在的测试和上轮执行记录，不代表本轮变更之后已重新通过。带复选框的项目应由最终验收人员在当前代码上复核后确认。

### 上轮验证基线

本表整理自本地 `test/.tmp/` 的上一轮最终日志。该目录是开发验证产物，不随 Git 或 npm 包分发；重新验收应保存本次日志和对应代码版本。

| 验证项 | 上轮记录 | 证据文件与解释 |
| --- | --- | --- |
| 完整测试 | 1264 项，1255 通过、9 跳过、0 失败 | `java-expansion-full-final.log`；不能写成“1264 项全部通过” |
| 仓库规范检查 | lint、架构依赖、语法与中文检查通过 | `java-expansion-check-final.log`；当时架构扫描 354 个模块、1491 条依赖，历史英文债务为 0/0 |
| 配置与文档契约 | 28/28 通过 | `java-expansion-contract-final.log` |
| 文档回归 | 25/25 通过 | `java-expansion-docs-final.log` |
| Maven、ArchUnit、JaCoCo 原生回归 | 两次调用各 1 项通过，共 2 项 | `java-engineering-native-final.log` |
| SpotBugs 原生回归 | 2/2 通过 | `java-spotbugs-native-final.log` |
| PIT 原生回归 | 3/3 通过 | `java-pit-native-final.log` |
| npm 打包清单 | 457 个条目；包含 Java 功能文档及两份公共 Schema | `java-expansion-pack-final.log`；当时不包含 `test/`、临时缓存或 JAR 工具文件 |

完整测试中的 9 项跳过分别为：Windows 上不适用的 POSIX 自终止信号场景 1 项、需显式启用的真实 k6 场景 1 项，以及上述另行执行的 Maven、SpotBugs、PIT 原生场景共 7 项。源码真实工具测试在该轮运行中未跳过。后续新增能力、修改代码或更新工具版本，均不能直接复用本表作为本次全部通过的结论。

## 2. 18 项能力逐项验收

下表中的测试名称链接到维护位置。共用测试套件包含多项规则，验收时应检查该项的具体正常与违规断言，不能仅统计测试文件数量。

| 配置名 | 应证明的行为及边界 | 对应回归与原生验证 |
| --- | --- | --- |
| `javaFormat` | 能发现格式、BOM、换行和文本卫生问题；修复后只读复核通过；提交时只修复选中的暂存 Java 文件 | [源码配置](../test/config/java-source.test.js)、[源码门禁](../test/gates/java/source.test.js)、[真实工具](../test/integrations/java/source/real-tools.test.js)、[部分暂存事务](../test/hooks/java-source-isolation.test.js) |
| `javaNaming` | Checkstyle 发现 Java 标识符命名违规，正常命名通过；不要与文件路径命名混为一项 | [源码门禁](../test/gates/java/source.test.js)、[原生报告解析](../test/integrations/java/source/native-reports.test.js)、[真实工具](../test/integrations/java/source/real-tools.test.js) |
| `javaLayout` | 包路径、文件与顶层类型等规则实际生效；包描述符正常处理；工具不能解析模块声明时明确报错 | [源码门禁](../test/gates/java/source.test.js)、[原生报告解析](../test/integrations/java/source/native-reports.test.js)、[真实工具的包与模块场景](../test/integrations/java/source/real-tools.test.js) |
| `javaImports` | 声明的导入规则能够检出违规；检查工具失败不能当成没有导入问题 | [源码配置](../test/config/java-source.test.js)、[源码门禁](../test/gates/java/source.test.js)、[真实工具](../test/integrations/java/source/real-tools.test.js) |
| `javaSize` | 文件、方法等规模限制按实际配置判断，边界值和越界值分别验证 | [源码配置](../test/config/java-source.test.js)、[源码门禁](../test/gates/java/source.test.js)、[真实工具](../test/integrations/java/source/real-tools.test.js) |
| `javaDocs` | Javadoc 存在性、位置及要求的标签规则生效；不宣称能判断注释是否正确解释业务 | [源码门禁](../test/gates/java/source.test.js)、[原生报告解析](../test/integrations/java/source/native-reports.test.js)、[真实工具](../test/integrations/java/source/real-tools.test.js) |
| `javaLint` | PMD 的 `BrokenNullCheck`、`AvoidPrintStackTrace`、`EmptyCatchBlock`、`SystemPrintln` 四项规则分别检出；语法错误及规则抑制不能静默通过 | [源码门禁](../test/gates/java/source.test.js)、[原生报告解析](../test/integrations/java/source/native-reports.test.js)、[真实 PMD 四规则与抑制场景](../test/integrations/java/source/real-tools.test.js) |
| `javaDuplication` | CPD 检出达到配置阈值的重复片段；明确或 Unicode 编码的抑制不能隐藏证据；不推断语义重复 | [源码配置](../test/config/java-source.test.js)、[源码门禁](../test/gates/java/source.test.js)、[真实 CPD 场景](../test/integrations/java/source/real-tools.test.js) |
| `javaArchitecture` | 项目声明的 `requiredTestClasses` 真正执行，违规或缺少必需测试类阻断；架构规则由项目提供并评审 | [工程门禁](../test/gates/java/engineering-gates.test.js)、[JUnit 报告](../test/integrations/java/engineering/reports.test.js)、[真实 ArchUnit](../test/integrations/java/engineering/native-extended.test.js) |
| `javaDependencies` | 逐模块核验有效 POM、已解析依赖树与指定 Enforcer 规则的实际执行；不以源码 POM 猜测传递依赖 | [工程采集](../test/integrations/java/engineering/collect.test.js)、[报告与规则证据](../test/integrations/java/engineering/reports.test.js)、[真实 Maven 与 Enforcer](../test/integrations/java/engineering/native-maven.test.js) |
| `javaFiles` | 完整 Git 索引中的 Java 文件位置与禁止提交产物按配置判断；不是扫描所有未跟踪文件，也不解析 Java 语义 | [工程门禁](../test/gates/java/engineering-gates.test.js)、[Java 工作区 Hook](../test/hooks/java-workspace.test.js)、[真实 Git 结构规则](../test/hooks/java-structure.test.js)；此项不启动 Java 工具 |
| `javaCompile` | 生产与测试代码编译，生成声明的本次 `.class` 产物；编译失败和缺少产物分别分类 | [工程采集](../test/integrations/java/engineering/collect.test.js)、[工程门禁](../test/gates/java/engineering-gates.test.js)、[真实 Maven 编译](../test/integrations/java/engineering/native-maven.test.js) |
| `javaBuild` | 实际打包并核验声明的本次 `.jar`、`.war` 或 `.ear`；不把旧产物或仅返回成功的命令当成有效交付 | [工程采集](../test/integrations/java/engineering/collect.test.js)、[工程边界](../test/integrations/java/engineering/boundary.test.js)、[真实 Maven 打包](../test/integrations/java/engineering/native-maven.test.js) |
| `javaTest` | 每个必需模块存在真实执行的 JUnit 用例；失败、零执行、全部跳过、缺报告和损坏报告不能通过 | [JUnit 报告](../test/integrations/java/engineering/reports.test.js)、[工程门禁](../test/gates/java/engineering-gates.test.js)、[真实 Maven 测试](../test/integrations/java/engineering/native-maven.test.js) |
| `javaCoverage` | 本次 JUnit 与 JaCoCo 会话及计数可信；逐模块检查行、分支、指令阈值，不以平均值掩盖低覆盖模块 | [覆盖率报告](../test/integrations/java/engineering/reports.test.js)、[工程采集](../test/integrations/java/engineering/collect.test.js)、[真实 JaCoCo](../test/integrations/java/engineering/native-extended.test.js) |
| `javaPathNaming` | 文件命名、包目录命名和目录限定后缀规则独立生效；描述符例外明确；配置变更后重新检查完整索引 | [配置](../test/config/java-path-naming.test.js)、[策略](../test/policies/java/path-naming.test.js)、[门禁](../test/gates/java/path-naming.test.js)、[真实 Git 多入口](../test/hooks/java-structure.test.js)；此项不启动 Java 工具 |
| `javaSpotbugs` | 本次字节码与原生报告中的分析类范围一致；按缺陷优先级和显式排除判断；缺类、缺报告及跳过分析不能通过 | [配置](../test/config/java-spotbugs.test.js)、[采集](../test/integrations/java/spotbugs/collect.test.js)、[报告](../test/integrations/java/spotbugs/reports.test.js)、[门禁](../test/gates/java/spotbugs.test.js)、[真实单模块与相依模块](../test/integrations/java/spotbugs/native.test.js) |
| `javaMutationTest` | 原始测试基线通过后，对显式目标运行 PIT；各模块单独核验变异范围与得分；零变异、全部无覆盖或不完整状态不能通过 | [配置](../test/config/java-mutation.test.js)、[范围](../test/integrations/java/mutation/scope.test.js)、[采集](../test/integrations/java/mutation/collect.test.js)、[报告](../test/integrations/java/mutation/reports.test.js)、[门禁](../test/gates/java/mutation.test.js)、[真实 PIT 与同名类多模块](../test/integrations/java/mutation/native-pit.test.js) |

### 能力表述必须准确

- **Java 源码自动修复只有 `javaFormat`。** 其他检查报告问题，不自动重命名、移动文件、补写注释或重写业务代码。Maven 检查会执行项目声明的生命周期并清理、生成构建产物，这与源码自动修复不同。
- `javaArchitecture` 验证项目已有架构测试是否执行及其结果。团队必须提供实际的包依赖、分层或其他架构断言；测试类名称本身不能证明规则有效。
- `javaDependencies` 支持的 Enforcer 规则为 `dependencyConvergence`、`requireUpperBoundDeps`、`banDuplicatePomDependencyVersions`、`bannedDependencies`、`requireReleaseDeps`、`requirePluginVersions`、`bannedPlugins`、`banDynamicVersions`。具体参数由项目配置；解析后依赖树的快照或禁用坐标检查，不等于依赖漏洞扫描，也不等于禁止所有原始版本范围。
- `javaTest`、`javaCoverage`、`javaMutationTest` 不替项目生成测试。测试报告清单和必需模块由团队完整声明；未列入的报告不提供通过证据。JUnit 部分跳过可以保留，但每个必需模块必须实际执行用例。
- 没有生产行或指令计数的模块不能以“覆盖率 100%”通过。确实不存在分支时的原生 `0/0` 可以按 100% 处理。覆盖率不证明断言有效；PIT 得分也不证明所有业务场景正确。
- SpotBugs 当前保留项目原生源码抑制注解；团队应评审这些抑制。不能把 PMD 的抑制处理规则套用到 SpotBugs 并宣称所有工具都禁止抑制。
- 文件归位、保护文件、最大文件行数等语言无关能力可用于 Java，但不应重复计入 18 项 Java 专项检查。

## 3. 配置契约与公共注册

复核源码：[项目能力映射](../src/config/project-feature-paths.js)、[Gate 注册表](../src/gates/registry.js)、[公共 Schema](../config.schema.json)、[应用 Schema](../project.schema.json)。

- [ ] 18 项在运行时配置、Schema 和公共能力注册中名称一致；默认均关闭。检查键拼写错误、未知字段、非布尔开关、越界数值必须报配置错误，关闭项也不能容纳错误字段。
- [ ] Java 应用明确配置 `role: backend`、`stack: java`、`preset: java-maven`。Java 不能开启 Node 专属检查，Node 不能开启 Java 专属检查；语言无关能力仍可独立配置。
- [ ] 启用后确实校验工具、模块、具体证据路径及阈值等必填条件；CI 的 `report` / `enforce` 临时激活检查时，同样不能绕过这些条件。
- [ ] `enable`、`disable`、CLI 帮助、Doctor、生成脚本及托管规范区块使用同一份公共能力信息，不能只在一个入口注册新能力。
- [ ] 纯 Java 仓库不要求伪造 `package.json`；初始化和 Doctor 不替项目下载工具或悄悄变更 POM、测试规则。只接受当前 v2 配置与托管格式。
- [ ] 文档示例能被真实校验器接受；每个字段说明用途、默认值、允许值、必填条件、路径基准及范围限制。

已有回归：[Java 应用隔离](../test/config/java-project-isolation.test.js)、[生命周期配置契约](../test/config/config-lifecycle-contract.test.js)、[公共能力描述](../test/core/gate-capability.test.js)、[Java 初始化与 Doctor](../test/setup/java-workspace.test.js)、[应用配置管理](../test/config/project-config-management.test.js)、[配置示例契约](../test/config/project-fixture-contract.test.js)、[文档当前格式](../test/docs/v2-only-configuration.test.js)。

## 4. 架构解耦与源码规范

| 层 | 验收职责 | 不应出现的耦合 |
| --- | --- | --- |
| `src/config/` | 字段、默认值、Schema 与配置校验 | 在 CLI、Hook 或规则判定中另建一套默认值或放宽校验 |
| `src/integrations/java/` | 启动项目工具、读取并核验原生事实 | 根据终端输出美化需求改写规则结论；以进程成功代替有效报告 |
| `src/policies/java/` | 根据事实与团队规则判定 | 启动 Maven、改写源码、安装工具、直接退出主进程 |
| `src/gates/java/` | 组合配置、采集和判定，产生统一 `GateResult` | SpotBugs 依赖 PIT 开关，或以另一个 Gate 的结果代替本项证据 |
| `src/orchestration/` | 按应用和生命周期选择、执行、汇总 | 自建 Java 退出码表、绕开公共 CI 策略或渲染协议 |

- [ ] 新文件位于对应责任目录；源码、工程、路径命名、SpotBugs、PIT 分别维护。共享 Maven 进程、文件边界、隐式参数和报告读取逻辑由公共适配层复用。
- [ ] `npm run architecture:check` 无违规依赖；[架构边界](../test/architecture/architecture-boundaries.test.js)与[配置职责边界](../test/architecture/architecture-config-boundaries.test.js)无回归。
- [ ] 配置和调用方输入不被意外修改；不把检查工具当作可执行任意项目插件的沙箱。团队仍需审查自己的 Maven 生命周期、插件、扩展及自定义清理行为。

## 5. 全入口、生命周期与文件修改

按[Java 步骤声明](../src/orchestration/java-check-plans.js)和[公共执行计划](../src/orchestration/execution-plans.js)核验：

| 入口或阶段 | 18 项 Java 检查中的适用范围 | 重点断言 |
| --- | --- | --- |
| 手动命令 | 全部 18 项 | 遵循本项开关；多应用的 `--project` 选择准确；仅格式检查有源码修复能力 |
| pre-commit | 格式、命名、布局、导入、规模、文档、静态问题、工程文件、路径命名 | 格式先修复再复核；不加入 CPD、编译、测试、构建、SpotBugs、PIT |
| 可选 pre-push | 全部 18 项 | 使用只读源码检查及工程验证；受开关与阶段配置控制 |
| CI policy | `javaFiles`、`javaPathNaming` | 与适用的公共仓库策略一起执行；不启动完整 Java 构建链 |
| CI full / release-ready | 全部 18 项 | `inherit` 遵循开关；`report` 只报告、`enforce` 阻断、`off` 跳过；发布准备另核验交付证据 |

- [ ] 每项至少验证关闭、成功、违规、配置或执行失败四种结果；需要 Git 范围的入口另验证范围不可信。跳过必须明确显示，不能充当交付通过证据。
- [ ] Hook 中不运行全项目修复；部分暂存文件的未暂存内容保留。后续规则失败时，格式修复和索引事务按既有机制恢复，不损失用户修改。
- [ ] 仅修改 Java 配置时，只读规则使用对应应用索引快照复核既有 Java 文件；格式修复仍限于选中文件。只删除文件和无 Java 源码变更也不能绕过适用的结构规则。
- [ ] 保护文件独立于代码质量检查，保留既定末尾执行顺序；关闭通知不能把 `block` 保护降为通过。
- [ ] CI `report` 返回成功时，报告仍保留真实 `execution-error` 或违规；不能被交付流程错误引用为已通过。

已有回归：[执行计划](../test/core/execution-plan.test.js)、[Hook 生命周期锁定](../test/hooks/pre-commit-lifecycle-lock.test.js)、[Java 部分暂存](../test/hooks/java-source-isolation.test.js)、[Java 结构多入口](../test/hooks/java-structure.test.js)、[SpotBugs/PIT 真实 CLI 与 CI](../test/e2e/java-advanced-entrypoints.test.js)、[工作区 CI 策略](../test/ci/workspace-gate-policy.test.js)。

## 6. 前后端与多模块隔离

消费项目至少准备一个 `apps/web` 前端和一个 `apps/api` Java 后端，分别配置不同规则。应用目录不重叠，不考虑同一目录内混放前后端源码。

| 场景 | 应核验的结果 |
| --- | --- |
| 仅前端变更 | Java 应用不因前端源码变化被误选；Java 工具和规则不作用于前端文件 |
| 仅 Java 变更 | Java 使用本方配置与工具，前端格式或 npm 规则不作用于后端源码 |
| 同次提交双方变更 | 双方都进入受影响应用集合，各自规则分别执行；不能只检查第一项应用 |
| 修改应用配置 | 重新检查本应用受影响的规则范围，不把未暂存配置当成本次提交配置 |
| 修改仓库公共配置或明确的共享路径 | 按公共配置和 `sharedPaths` 声明选择所有受影响应用；“已选中”不等于所有无适用文件的门禁都运行 |
| 跨应用移动文件 | 旧路径与新路径所属应用均参与选择；移出保护路径与移入不允许目录都应被正确判断 |
| Maven 多模块及本地父 POM | 模块和声明式输出必须留在本应用内；每个必需模块独立提供报告，不能借用另一模块证据 |
| 路径越界、符号链接或 Junction | 明确报错，不能读取、清理或把另一应用的产物计入本方证据 |

**提交和推送采用阶段顺序执行，并在首个阻断失败后停止后续步骤。** 因此前端先失败时，不保证 Java 后续检查仍全部完成；这属于提交整体被阻断，不能把尚未执行的后端标为通过。验收“双方均可检查”时先用双方都能通过的样例，再分别制造单方失败并核验报告与停止位置。

已有回归：[工作区配置隔离](../test/config/workspace-isolation.test.js)、[Java 配置隔离](../test/config/java-project-isolation.test.js)、[Git 应用范围](../test/core/git-project-scope.test.js)、[工作区 Hook](../test/hooks/workspace-hooks.test.js)、[Java Hook](../test/hooks/java-workspace.test.js)、[工作区 CI](../test/ci/workspace-ci.test.js)、[Maven 模块与清理边界](../test/integrations/java/engineering/boundary.test.js)。

### 文件归位与保护的附加验收

- [ ] 应用自己的 `checks.filePlacement` 能匹配 SQL、YAML、properties 等文件并限制允许目录；匹配规则的顺序、例外、`newFiles` / `changedFiles` 模式按文档执行。不检查 SQL 或配置内容的业务语义。
- [ ] `javaPathNaming` 的“某目录内必须采用指定后缀”与 `filePlacement` 的“某类文件只能放在指定目录”分别验证，不能只开一项却宣称同时完成两种约束。
- [ ] `repository.rules` 的 `block` 覆盖新增、修改、删除及移动；保护是一项提交门禁，不是将文件设置为操作系统只读。
- [ ] 应用外的仓库文件不能被“已检查某个应用”误当成已覆盖；使用下面的仓库公共归位能力单独验收。

已有回归：[通用文件归位策略](../test/policies/file-placement.test.js)、[通用文件归位配置](../test/config/config-file-placement-validation.test.js)、[Java 文件归位与保护](../test/hooks/java-structure.test.js)。使用边界见[文件归位](features/file-placement.md)和[保护文件](features/protected-files.md)。

### 仓库公共归位功能

`repositoryFilePlacement` / `repository.global-file-placement` 已接入独立根配置；本表用于复核实际项目的范围与规则，不改变 18 项 Java 专项能力的统计。仓库实现的本轮验证结果见末尾记录。

- [ ] 仓库根配置声明全仓规则，路径基准固定为仓库根目录；根规则与应用 `filePlacement` 可分别开启，不依赖前端、Java 或其他后端技术栈。
- [ ] 根目录、应用目录、未登记给任何应用的目录中的 SQL 或配置文件均能被全仓规则覆盖；不能只遍历已选中的应用而漏掉仓库其他位置。
- [ ] 同次提交前后端文件及应用外违规文件，必须发现应用外问题；只提交应用外文件也应触发相同公共门禁。
- [ ] 公共规则与本应用规则同时适用时分别判断，报告能区分仓库规则与应用规则；前端自己的私有规则不能传播到后端。
- [ ] 新增、改名、跨应用移动、移至应用外、仅删除、仅改规则和部分暂存均有真实 Git 回归；明确存量文件何时全量复核。
- [ ] 手动、Hook、CI 与公共注册、配置开关、Schema、Doctor、中文报告、统一退出码及 npm 文档同步；最终补充本次实际测试位置与结果。

维护依据：[配置与开关](../test/config/repository-file-placement.test.js)、[完整 Git 路径及新增意向](../test/core/repository-file-paths.test.js)、[统一 Gate 与错误](../test/gates/repository/global-file-placement.test.js)、[真实 CLI / Hook / CI](../test/hooks/repository-file-placement.test.js)、[同根应用规范同步](../test/setup/repository-file-placement-policies.test.js)。前端与 Java 共仓、公共目录和历史 SQL、工作区与索引区分、附注标签及同根应用分别有回归。

## 7. 报告可信度与异常必须阻断

| 复核方式 | 预期结果 | 已有维护位置 |
| --- | --- | --- |
| 命令返回成功但删除、损坏或复用旧报告 | 不能通过；报告错误保留所属应用、模块和路径 | [工程报告](../test/integrations/java/engineering/reports.test.js)、[工程采集](../test/integrations/java/engineering/collect.test.js)、[SpotBugs 采集](../test/integrations/java/spotbugs/collect.test.js)、[PIT 采集](../test/integrations/java/mutation/collect.test.js) |
| XML 外部实体、错误编码、无效结构、重复用例或不一致计数 | 明确拒绝，不能降级为零问题 | [源码报告](../test/integrations/java/source/native-reports.test.js)、[工程报告](../test/integrations/java/engineering/reports.test.js)、[SpotBugs 报告](../test/integrations/java/spotbugs/reports.test.js)、[PIT 报告](../test/integrations/java/mutation/reports.test.js) |
| 两个模块同名类、其中一方报告缺失或得分低 | 每模块独立判断；另一模块的成功不能抵消 | [真实 PIT 多模块](../test/integrations/java/mutation/native-pit.test.js)、[真实 SpotBugs 相依模块](../test/integrations/java/spotbugs/native.test.js)、[工程报告](../test/integrations/java/engineering/reports.test.js) |
| 注入跳过、历史复用、筛选类、修改报告或检测器参数 | 隐式启动参数在执行前预检；有效 POM 在生成后校验（PIT 位于 clean test 后，SpotBugs 位于 clean 后）；均须在接受通过证据前阻断，不能静默缩小检查范围 | [PIT 配置](../test/config/java-mutation.test.js)、[PIT 有效 POM](../test/integrations/java/mutation/reports.test.js)、[SpotBugs 配置](../test/config/java-spotbugs.test.js)、[SpotBugs 有效 POM](../test/integrations/java/spotbugs/reports.test.js) |
| 用 Maven profile、`.mvn/maven.config`、JVM 环境或 RC 隐藏参数 | 共享预检发现实际生效入口；不自行删除配置后继续执行 | [共享隐式参数边界](../test/integrations/java/engineering/implicit-configuration.test.js)、[真实 SpotBugs 隐藏检测器参数](../test/integrations/java/spotbugs/native.test.js)、[真实 PIT profile](../test/integrations/java/mutation/native-pit.test.js) |
| 工具不存在、超时、取消、信号终止或无法识别的失败 | 配置或执行错误；停止有关子进程，不沿用第三方退出码 | [Java 门禁](../test/gates/java/engineering-gates.test.js)、[进程树](../test/core/process-tree.test.js)、[门禁超时](../test/core/gate-timeout.test.js)、[真实 CLI 错误](../test/e2e/java-advanced-entrypoints.test.js) |
| 长类名、多星号匹配等极端输入 | 在限定输入和计算预算内返回或报错，不能阻塞检查线程 | [PIT 范围预算](../test/integrations/java/mutation/scope.test.js)、[路径命名策略](../test/policies/java/path-naming.test.js) |

SpotBugs 与 PIT 的显式额外参数采用受限允许范围；更换插件版本时，必须重新核对原生参数、有效 POM 属性及报告协议。当前隐式 Maven 参数约束见[Java 工程检查](features/java-engineering.md#隐式参数与启动环境)，不能仅验证直接传入的命令行参数。

## 8. 统一退出码与中文报告

权威实现为 [exit-code.js](../src/core/result/exit-code.js)。验收时同时检查进程退出码和结构化结果，不能仅观察终端颜色。

| 场景 | 对外语义 |
| --- | --- |
| 成功、关闭或非阻断结果 | `0`；关闭仍必须保留 `skipped`，不是 `passed` |
| 配置错误、工具执行错误、缺少可信报告 | `1`，保留各自错误状态 |
| 已确认规则违规或交付条件不满足 | `2` |
| Git 检查范围不可信 | `3` |
| 同时存在多个阻断结果 | 先选择阻断项，再按执行错误、配置错误、范围错误、违规的优先级汇总 |

- [ ] CLI、Hook、CI、多应用及交付均复用公共常量和映射，不返回自定义数字，不取首个非零码，不直接透传 Maven 或 Java 的原始码。
- [ ] 只有 `bin/repo-guard.js` 写入主进程退出码；失败后没有各入口自行降级或覆盖最终结果。
- [ ] 主摘要、期望、修复建议、约束和验证指导均为简体中文；原始英文工具输出独立标注“第三方原始诊断”。结果包含可追溯的规则、应用、模块或文件定位。
- [ ] 只报告 CI 允许返回 `0`，但实际失败结果仍写入报告；交付证据不能把跳过、未运行或执行失败当作已通过。

已有回归：[公共退出码](../test/core/exit-code.test.js)、[源码退出码边界](../test/architecture/exit-code-boundary.test.js)、[Hook 退出码](../test/hooks/quality-exit-codes.test.js)、[交付跨入口退出码](../test/e2e/delivery-exit-codes.test.js)、[报告边界](../test/architecture/reporting-boundary.test.js)、[中文约束](../test/docs/user-facing-language.test.js)。

## 9. 工具版本与现场兼容性

下面是已记录的验证组合，不是所有版本均兼容的承诺。配置接受某个版本字符串，也不代表该版本已经过原生回归。

| 工具 | 已记录验证版本 | 换版本时必须复核 |
| --- | --- | --- |
| Node | 包要求 `>=22.23.2` | 本地 CLI、Hook 和 CI 都使用满足要求的运行时 |
| JDK / Maven | JDK 17 / Maven 3.9.11 | 工具运行 JDK、源码语法与编译目标三者兼容；实际启动脚本与隐式配置行为 |
| google-java-format | 1.22.0 | 格式风格、源码语法支持、只读与修复结果 |
| Checkstyle | 12.3.1；10.21.4 也验证过普通源码及模块语法限制 | 当前规则名和配置、XML 报告、包描述符及模块语法 |
| PMD / CPD | 7.10.0 | 四项规则、抑制处理、重复报告与工具退出状态 |
| Surefire / JUnit Jupiter | 3.2.5 / 5.10.2 | 实际测试执行、报告格式、跳过与失败计数 |
| ArchUnit / JaCoCo | 1.3.0 / 0.8.12 | 实际架构断言、字节码支持、执行会话与计数结构 |
| Maven Enforcer | 3.5.0 | 八项内置规则类、执行证据、有效 POM 与真实依赖树 |
| SpotBugs Maven / SpotBugs | 4.10.3.0 / 4.10.3 | 有效配置约束、分析类集合、原生 XML 及缺陷定位 |
| PIT / PIT JUnit 5 插件 | 1.17.3 / 1.2.2 | 原生用户属性、状态与 XML、目标范围、计分及同名类多模块 |

- [ ] 在团队实际 JDK 与源码版本上运行，不把 JDK 17 的样例验证扩大为所有 Java 版本均支持。已验证 Checkstyle 不能解析 `module-info.java`；项目必须明确选用支持的工具组合或显式声明排除范围，排除文件不算已验证。
- [ ] Maven 可执行程序已准备，当前不支持 Wrapper。默认离线检查所需依赖与插件已缓存；缺缓存应报错，检查器不自动联网安装。项目明确设置 `offline: false` 时另行确认实际网络条件。
- [ ] Maven profile、父 POM、模块输出、清理目录、报告路径和测试清单与真实项目一致；不能照抄单模块例子而遗漏后端子模块。
- [ ] PIT 各模块必需的兄弟依赖可以从现有环境解析；当前不代替项目安装模块，也不提供跨模块测试模式。
- [ ] `javaFiles`、`javaPathNaming` 及通用路径规则不依赖 JDK；不要要求仅用这些检查的项目安装整套 Java 分析工具。
- [ ] Windows、团队实际 Linux CI Runner、不同用户名和含空格路径分别现场验证；上轮 Windows 验证不能代替其他平台验证。

## 10. 文档、打包与测试组织

- [ ] [README](../README.md)、[使用说明](usage-guide.md)、[能力索引](features/README.md)、[架构与能力清单](project-structure-and-feature-inventory.md)、[Java 接入](java-quality-integration.md)及五份 Java 功能文档描述一致；链接、字段说明和命令可用。
- [ ] 测试按 `test/config`、`test/gates/java`、`test/policies/java`、`test/integrations/java`、`test/hooks`、`test/e2e` 等职责组织；原生夹具与对应适配器放在一起，不把所有测试堆到 `test/` 根目录。
- [ ] `npm run pack:check` 确认当前包包含运行源码、Schema、CLI 与文档；不包含临时工程、工具缓存、测试日志、JAR 下载或本地验证凭据。
- [ ] 从当前打包产物接入一个独立纯 Java 示例仓库，验证命令、配置 Schema、Doctor、Hook 和文档中的路径都能使用，不依赖本源码仓库的 `test/.tmp`。
- [ ] 上轮包的 457 个条目只是历史记录；新增本清单和仓库公共归位文档后以当前打包清单为准，不把固定条目数当成长期验收目标。

## 11. 本次执行与交接记录

### 仓库维护者复核

在完成本轮代码和文档后执行公共检查，不在仍变化的工作区提前写“全量通过”：

```bash
npm run check
npm test
npm run pack:check
```

发生 Java 报告、工具调用或模块范围变化时，除普通测试外还需执行相应原生回归。原生测试需要预先准备工具与离线缓存，开启方式见[源码检查](features/java-source-checks.md#验证与维护位置)、[工程检查](features/java-engineering.md#原生工具验证)、[SpotBugs](features/java-spotbugs.md)、[PIT](features/java-mutation-test.md#维护与验证)。测试显示 `SKIP` 时应记录缺失条件，不填写“原生验证通过”。

### 消费项目现场验收

由项目维护者或负责适配的 AI 在可恢复的验收分支完成以下操作，并保留结果：

1. 使用团队真实前端和 Java 配置，从正常样例开始，让已启用检查全部执行成功，确认没有遗漏模块或缺工具。
2. 分别引入命名、文件归位、PMD、SpotBugs、架构和依赖违规，确认能指出正确位置；修复后再通过。
3. 制造编译失败、测试失败、全部跳过、低覆盖率、低变异得分，确认具体检查阻断；删除报告、使用旧报告、停止工具时确认返回配置或执行错误。
4. 同次提交前后端文件，分别测试前端失败和后端失败；检查双方隔离、首个失败停止、部分暂存保留及跨目录移动。
5. 使用当前 npm 打包产物在 CI 运行适用检查，再核对结构化报告和交付证据。需要强制团队遵循时，在托管平台配置受保护分支的必需 CI 检查；仅安装本地 Hook 不能防止绕过。

### 本轮验证记录（2026-09-11）

| 记录项 | 本轮结果 |
| --- | --- |
| 验收日期、分支与提交；如未提交，记录工作区变更范围 | 2026-09-11；`feat/repository-file-placement-2.0.0`，基线提交 `761d07b3ecfa4011316da169fe5837be2e17afc8`。工作区保留已有 Java 实现，增加仓库归位及统一入口修正；未提交、推送或发布 |
| Node、JDK、Maven、分析工具与测试插件实际版本 | 本轮为 Windows、Node `22.23.2`；Java 原生工具组合沿用上轮记录与各功能文档，本轮没有扩大版本兼容声明 |
| `npm run check` 与完整测试统计、跳过原因 | lint、架构、语法、中文检查通过。完整回归 1307 项：1298 通过、9 跳过、0 失败，约 427 秒；跳过为 7 项需显式启用的 Java 原生测试、1 项真实 k6 测试及 1 项 Windows 不适用的 POSIX 信号场景 |
| 最后边界修复后的验证范围 | 全量回归执行后补充了无应用变更时的同根 AGENTS 修复；最终代码执行全部 CI 测试与相关规范、Hook 边界，共 82 项，全部通过，无跳过；该补充结果独立于前一行的全量统计 |
| 本轮真正执行的原生测试及日志位置 | 本轮未重跑 Java 原生工具；此前 7 项原生回归的通过记录见本文上轮基线。此次没有改动 Java 工具适配、原生报告或规则判定实现，不把默认跳过计为原生通过 |
| `repositoryFilePlacement` 跨应用与全仓验收结果 | 配置、公共注册、完整索引/目标提交、公共目录、历史 SQL、工作区隔离、附注标签、新增意向、同根规范与空变更 CI 均有通过回归；手动/提交/推送/CI 真实命令测试 8 项，同根规范测试最终 5 项，包含在上述对应回归中 |
| 文档与当前 npm 包清单 | 文档回归 25 项通过；打包预览 462 个条目，包含新配置模块、Git 路径事实、独立 Gate 和两份新文档；未包含测试、缓存、临时日志、JAR 或仓库维护 Skill |
| 独立消费项目现场验收 | 尚未在用户真实业务仓库或从打包产物新安装的纯 Java 项目中执行；需按上方现场流程确认具体工具版本、模块、规则与 CI 环境 |
| 仍未覆盖的版本、平台与明确排除范围 | 未声称所有 JDK、Maven、插件或操作系统组合均已验证；仓库归位不进入 Git 子模块内部，不扫描被忽略且未跟踪的本地文件；Gradle、业务校验、自动安装和 Java 部署仍不在本轮范围 |
| 维护者结论 | 仓库归位实现及其公共配置、架构、生命周期、报告与文档接入已完成验证。Java 的 18 项实现与既有证据已逐项整理；实际消费项目的配置完整性和工具兼容性仍需现场确认 |

本轮日志均在被忽略的 `test/.tmp/`：`repository-placement-full-verified.log`、`repository-placement-ci-final.log`、`repository-placement-check-complete.log`、`repository-placement-boundary-final.log`、`repository-placement-docs-final.log` 与 `repository-placement-pack-verified.log`。日志不随 Git 或 npm 包分发；团队验收时应保存自己的代码版本与运行证据。

只有当本轮仓库回归、适用的原生验证和目标消费项目验收分别有可追溯结果时，才按实际覆盖范围确认 Java 检查完成。工具升级或团队规则、模块、路径发生变化后，重新执行受影响部分的验收。
