# Changelog

## 1.4.88

- 将只读诊断、CI 模式检查、Gate setup 巡检与结果输出从 `src/commands/doctor.js` 迁入 `src/orchestration/doctor/runner.js`；CLI runner 与定向测试直接依赖所属编排模块，删除旧路径且不保留兼容转发。
- 保持 Node 契约与仓库修复的独立职责、诊断行为、配置、Hook、CI、公共 exports 和退出码不变，并增加 doctor 归属、旧路径以及过渡 `commands` 层清零测试。

## 1.4.87

- 将 `doctor --fix` 的配置创建/迁移、受管策略维护和 Hook 重装写操作拆入 `src/orchestration/setup/repository-repair.js`，doctor 通过 `{ repairs, repairErrors }` 结果消费修复编排。
- 保持只读 doctor、修复范围、安全约束、输出、配置、Hook、CI、公共 exports 和退出码不变，并增加诊断与仓库修复职责分离测试。

## 1.4.86

- 将最低 Node.js 版本契约、版本解析和支持判断从 doctor 编排拆入 `src/core/project/node-version.js`，doctor 只消费项目运行时事实。
- 保持 Node.js `>=22.23.2` 要求、诊断结果、配置、Hook、CI、公共 exports 和退出码不变，并将版本边界测试定向到所属 core 模块。

## 1.4.85

- 将能力探测、配置创建、受管 Hook 安装、策略维护与初始化结果输出从 `src/commands/init.js` 迁入 `src/orchestration/setup/project-initialization.js`；CLI runner 直接依赖 setup 编排模块，删除旧命令路径且不保留兼容转发。
- 保持 `install-hooks` CLI 适配的独立职责、初始化行为、配置、Hook、CI、公共 exports 和退出码不变，并增加项目初始化归属与旧路径防回归测试。

## 1.4.84

- 将 `install-hooks` 的 CLI 适配、可选 Git 仓库处理和结果输出从项目初始化入口拆入 `src/orchestration/cli/install-hooks.js`，CLI runner 直接依赖该单一职责模块。
- 保持受管 Hook 内容与旧标记升级兼容、项目初始化、配置、CI、公共 exports 和退出码不变，并增加 Hook 安装命令与初始化职责分离测试。

## 1.4.83

- 将推送范围收集、GateContext 构造和固定 Execution Plan 编排从 `src/commands/pre-push.js` 迁入 `src/orchestration/pre-push/runner.js`；CLI runner 与定向测试直接依赖所属编排模块，删除旧命令路径且不保留兼容转发。
- 保持推送配置与精确快照解析的独立职责、门禁顺序、跳过语义、Hook、CI、公共 exports 和退出码不变，并增加 pre-push 编排归属与旧路径防回归测试。

## 1.4.82

- 将推送修订配置加载、门禁启用判断及精确 HEAD/干净工作区快照校验从 pre-push 生命周期入口拆入 `src/orchestration/pre-push/push-configuration.js`，runner 只消费解析结果并编排门禁。
- 保持推送范围、删除 ref 与缺失配置的跳过语义、多修订阻断、配置错误、门禁顺序、Hook、CI、公共 exports 和退出码不变，并增加配置解析与执行编排职责边界测试。

## 1.4.81

- 将 pre-commit 生命周期、暂存配置读取和保护策略执行从 `src/commands/pre-commit.js` 迁入 `src/orchestration/pre-commit/runner.js`；CLI runner 与定向测试直接依赖所属编排模块，删除旧命令路径且不保留兼容转发。
- 保持 `quality-files` CLI 适配的独立职责、固定质量检查顺序、lint-staged 暂存隔离、保护文件门禁、配置、Hook、CI、公共 exports 和退出码不变，并增加 pre-commit 编排归属与旧路径防回归测试。

## 1.4.80

- 将 `quality-files` 的 CLI 适配职责从 pre-commit 生命周期入口拆入 `src/orchestration/pre-commit/quality-command.js`，CLI runner 直接依赖该模块；保留 `src/commands/pre-commit.js` 仅承载尚待独立迁移的 pre-commit 生命周期编排。
- 保持固定质量检查顺序、lint-staged 暂存隔离、配置加载、结构化错误、保护文件门禁、配置、Hook、CI、公共 exports 和退出码不变，并增加职责分离与依赖方向回归测试。

## 1.4.79

- 将 CI 命令边界、配置与报告路径校验、失败报告回退和退出码转换从 `src/commands/ci.js` 迁入 `src/orchestration/ci/command.js`，CLI runner 与定向测试直接依赖所属 CI 编排模块；删除旧命令路径且不保留兼容转发。
- 保持 CI runner 与报告持久化的独立职责、profile、变更范围、配置错误和执行错误报告、报告路径安全、控制台输出、配置、Hook、公共 exports 和退出码不变，并扩展 CI 编排与旧路径防回归测试。

## 1.4.78

- 将只服务手动 CLI 的暂存区受保护文件门禁编排从 `src/commands/gate.js` 迁入 `src/orchestration/cli/gate.js`，CLI runner 与定向测试直接依赖所属模块；删除旧命令路径且不保留兼容转发。
- 保持手动执行计划、暂存变更收集、dry-run、强制通知、注入上下文、结构化错误、控制台输出、配置、Hook、CI、公共 exports 和退出码不变，并增加手动门禁归属与旧路径防回归测试。

## 1.4.77

- 将 `prepare-commit-msg`、`commit-msg` 与 `post-commit` 共用的提交信息 Hook 生命周期编排从 `src/commands/hook-message.js` 迁入 `src/orchestration/commit-message/runner.js`，CLI runner 只负责分发；删除旧命令路径且不保留兼容转发。
- 保持模式校验、仓库与配置加载、prepare/finalize/cleanup 调用顺序、提交信息摘要策略、受管 Hook 内容与版本、配置、CI、公共 exports、输出和退出码不变，并增加提交信息编排归属与旧路径防回归测试。

## 1.4.76

- 将只服务 CLI 的 GitLab CI 安装参数接线与结果展示从 `src/commands/install-ci.js` 迁入 `src/orchestration/cli/install-ci.js`，CLI runner 直接调用同层模块；删除旧命令路径且不保留兼容转发。
- 保持 provider 校验、仓库发现、安装与 dry-run 行为、复杂配置的手动回退提示、控制台输出、配置、Hook、CI、公共 exports 和退出码不变，并增加 CI 安装 CLI 归属与旧路径防回归测试。

## 1.4.75

- 将只服务 CLI 的配置迁移、功能启用和功能禁用编排从 `src/commands/configure.js` 迁入 `src/orchestration/cli/configuration.js`，CLI runner 直接调用同层模块；删除旧命令路径且不保留兼容转发。
- 保持配置迁移、功能开关、架构/可访问性/单元测试 AI 策略同步、控制台输出、配置、Hook、CI、公共 exports 和退出码不变，并增加配置 CLI 归属与旧路径防回归测试。

## 1.4.74

- 将仅服务手动 CLI 的受保护工作区检查从 `src/commands/check.js` 迁入 `src/orchestration/cli/check.js`，CLI runner 直接调用所属编排模块；删除旧命令路径且不保留兼容转发。
- 保持配置加载、本地环境暂存泄露阻断、工作区变更收集、保护规则分类、finding、控制台输出、配置、Hook、CI、公共 exports 和退出码不变，并增加 CLI check 归属与旧路径防回归测试。

## 1.4.73

- 将 CLI 帮助生成、命令分发、运行期参数接线与统一错误呈现从根级 `src/cli.js` 迁入 `src/orchestration/cli/runner.js`，npm `bin` 启动器直接调用所属编排模块；删除旧根路径且不保留兼容转发。
- 保持 npm `bin` 名称与启动器边界、命令顺序、帮助文本、参数语义、错误分类与呈现、配置、Hook、CI、公共 exports、输出和退出码不变，并增加 CLI 编排归属与根目录防回归测试。

## 1.4.72

- 删除根级 `src/config.js`，将完整配置验证与结构化错误包装归入 `src/config/configuration-validation.js`，将配置文件读取和过期例外检查归入 `src/config/configuration-loader.js`；内部消费者直接依赖所需模块，不保留兼容转发。
- 保持 npm 根入口的 `loadConfig`/`validateConfig` 对象身份、配置结果、读取与错误行为、过期例外阻断、schema、CLI、Hook、CI、输出和退出码不变，并增加配置生命周期归属与根目录防回归测试。

## 1.4.71

- 删除 `src/config.js` 对默认值、路径匹配、验证基础符号和 `SUPPORTED_LEVELS` 的内部兼容转发，仓库内部消费者与测试改为直接依赖各符号的所属配置模块；配置入口只保留加载和完整配置验证职责。
- npm 根入口仍只从 `src/config.js` 公开 `loadConfig` 与 `validateConfig`，正式 npm exports、配置行为、schema、CLI、Hook、CI、输出和退出码保持不变，并增加无兼容转发的职责边界防回归测试。

## 1.4.70

- 将 CLI 无值选项校验和带值选项解析从 `src/cli.js` 迁入 `src/orchestration/cli/argument-parsing.js`，入口分发器只在命令分支声明各自支持的参数。
- 保持支持项、未知选项、缺失值、重复值覆盖及错误文本不变；命令分发、帮助文本、错误呈现、配置、Hook、CI、公共 exports、输出和退出码均不变，并增加参数行为与职责边界防回归测试。

## 1.4.69

- 将各配置领域的验证与规范化编排函数 `validateConfigValue` 从 `src/config.js` 迁入 `src/config/configuration-validation.js`，配置入口只保留公共导出、统一错误包装和文件加载职责。
- 保持领域调用顺序、默认值、规范化结果及错误优先级不变；根契约、保护文件和 staged-code 质量配置继续由各自模块负责，schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加编排行为与职责边界防回归测试。

## 1.4.68

- 将根配置对象、顶层已知字段及配置版本校验从 `validateConfigValue` 迁入 `src/config/root-configuration-validation.js`，主配置验证器仅在原时序点调用根配置契约后继续编排各领域结果。
- 保持根对象要求、允许字段集合、版本 1 契约及错误顺序不变；各领域配置、保护文件、staged-code 质量配置、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加根契约行为与职责边界防回归测试。

## 1.4.67

- 将 `preCommit` 容器形状验证及 file-placement、max-file-lines、Stylelint、Prettier、ESLint 五类 staged-code 质量配置编排从 `validateConfigValue` 迁入 `src/config/pre-commit-validation.js`，主配置验证器只负责编排规范化后的 `preCommit` 结果。
- 保持容器对象与已知字段校验、五类子配置验证顺序、默认值及返回结构不变；保护文件检查继续保持独立，Hook 执行顺序、其他门禁、加载、schema、CLI、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.66

- 将项目通知开关配置验证从 `validateConfigValue` 迁入 `src/config/notification-validation.js`，由领域模块直接返回规范化后的 `notification`，主配置验证器只负责编排该结果。
- 保持通知对象、已知字段、布尔开关及默认值校验不变；通知文本策略、企业微信网络集成、保护文件、staged-code 质量配置、其他门禁、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.65

- 将根级保护文件 `rules`/`exclusions` 的集合预检、规则字段验证、路径清洗与 matcher 编译从 `validateConfigValue` 迁入 `src/config/protected-file-validation.js`，与 pre-commit staged-code 质量配置保持独立；主配置验证器仅在原时序点调用形状预检和规范化结果。
- 保持至少一条规则、排除项数组、pattern/category/level、`notify`/`audit` 级别、首条规则匹配、排除优先级、Git 路径规范化、错误顺序及 `SUPPORTED_LEVELS` 兼容导出不变；其他门禁、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.64

- 将 pre-commit ESLint 暂存代码质量配置验证从 `validateConfigValue` 迁入 `src/config/eslint-validation.js`，由领域模块直接返回规范化后的 `eslint`，主配置验证器只负责编排该结果。
- 保持对象与开关校验、托管 preset、文件模式、自动修复、最大警告数、字符串清洗及默认值不变；file-placement、max-file-lines、Stylelint、Prettier、其他门禁、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.63

- 将 pre-commit Prettier 暂存格式化配置验证从 `validateConfigValue` 迁入 `src/config/prettier-validation.js`，由领域模块直接返回规范化后的 `prettier`，主配置验证器只负责编排该结果。
- 保持对象与开关校验、文件模式、自动修复、配置文件要求、字符串清洗及默认值不变；file-placement、max-file-lines、Stylelint、ESLint、其他门禁、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.62

- 将 pre-commit Stylelint 顶层执行参数、选择器/嵌套复杂度与样式治理配置验证从 `validateConfigValue` 迁入 `src/config/stylelint-validation.js`，由内聚领域模块直接返回规范化后的 `stylelint`，主配置验证器只负责编排该结果。
- 保持对象与开关校验、文件模式、自动修复、最大警告数、配置要求、复杂度阈值、specificity/ID/important 治理、全局样式路径、父子启用依赖、字符串清洗及默认值不变；file-placement、max-file-lines、Prettier、ESLint、其他门禁、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.61

- 将 pre-commit 单文件行数配置验证从 `validateConfigValue` 迁入 `src/config/max-file-lines-validation.js`，由领域模块直接返回规范化后的 `maxFileLines`，主配置验证器只负责编排该结果。
- 保持对象与开关校验、严格/不回退模式、预警比例、文件匹配规则、最大行数、排除路径、字符串清洗及默认值不变；file-placement、Stylelint、Prettier、ESLint、其他门禁、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.60

- 将 pre-commit 文件归位配置验证从 `validateConfigValue` 迁入 `src/config/file-placement-validation.js`，由领域模块直接返回规范化后的 `filePlacement`，主配置验证器只负责编排该结果。
- 保持对象与开关校验、检查模式、规则结构、匹配/允许/例外路径、建议目录约束、字符串清洗及默认值不变；max-file-lines、Stylelint、Prettier、ESLint、其他门禁、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.59

- 将 Vitest 单元测试、覆盖率、组件交互、文件匹配与测试映射配置验证从 `validateConfigValue` 迁入 `src/config/unit-test-validation.js`，由内聚领域模块直接返回规范化后的 `unitTest`，主配置验证器只负责编排该结果。
- 保持对象与开关校验、npm 脚本名、超时、覆盖率目录与阈值、组件交互依赖、文件模式、映射占位符、字符串清洗及默认值不变；pre-commit、其他门禁、通知、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.58

- 将 axe 可访问性测试配置验证从 `validateConfigValue` 迁入 `src/config/accessibility-validation.js`，由领域模块直接返回规范化后的 `accessibilityTest`，主配置验证器只负责编排该结果。
- 保持对象与开关校验、npm 脚本名、超时、测试文件匹配模式、字符串清洗及默认值不变；unit-test、pre-commit、外部门禁、通知、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.57

- 将 build、Vue Lighthouse 与 TypeScript 三类外部执行型质量门禁配置验证从 `validateConfigValue` 迁入 `src/config/execution-gate-validation.js`，由内聚模块直接返回规范化后的 `build`、`lighthouse` 与 `typeCheck`，主配置验证器只负责编排结果。
- 保持各门禁对象与开关校验、npm 脚本名、超时、Lighthouse 配置路径、可空构建脚本、字符串清洗及默认值不变；accessibility/unit-test、pre-commit、通知、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加三类领域行为与职责边界防回归测试。

## 1.4.56

- 将依赖架构配置验证从 `validateConfigValue` 迁入 `src/config/architecture-validation.js`，由领域模块直接返回规范化后的 `architecture`，主配置验证器只负责编排该结果。
- 保持启用开关、超时、源路径、TypeScript 配置路径、排除正则、规则名称与严重级别、from/to 条件正则及条件深拷贝行为不变；构建、其他质量门禁、通知、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.55

- 将依赖治理配置验证从 `validateConfigValue` 迁入 `src/config/dependency-policy-validation.js`，由领域模块直接返回规范化后的 `dependencyPolicy`，主配置验证器只负责编排该结果。
- 保持启用开关、精确版本与锁文件策略、协议名称校验和去重、禁用包唯一性、原因长度、替代包清洗及默认值不变；架构、构建、质量门禁、通知、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.54

- 将结构化例外配置验证从 `validateConfigValue` 迁入 `src/config/exception-validation.js`，由领域模块直接返回规范化后的 `exceptions`，主配置验证器只负责编排该结果。
- 保持 `warningDays`、`maxDays`、ID 与目标唯一性、命名空间规则、精确仓库路径、行列位置、理由与工单长度、owner/approvedBy 分离、ISO 日期和生命周期约束不变；依赖治理、架构、质量门禁、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.53

- 将 CI 配置、受保护文件动作与外部项目门禁验证从 `validateConfigValue` 迁入 `src/config/ci-validation.js`，由领域模块直接返回规范化后的 `ci` 与 `externalGates`，主配置验证器只负责编排该结果。
- 保持 CI 默认值、profile、报告路径、外部门禁字段、环境、脚本、超时、Windows 保留名防护、大小写不敏感的报告路径唯一性和数组复制行为不变；通知、例外、依赖、质量门禁、加载、schema、CLI、Hook、CI 输出和退出码均不变，并增加领域行为与职责边界防回归测试。

## 1.4.52

- 将配置文件名、结构化配置错误、已知字段检查、ISO 日期、仓库内相对模式、模式列表与 CI 报告路径校验迁入 `src/config/validation-primitives.js`，内部消费者直接依赖归类后的基础模块，配置入口继续显式重导出既有公开名称。
- 保持错误代码与修复指引、日期有效性、路径越界防护、反斜杠规范化、空列表策略和 `reports/*.json` 约束不变；完整配置验证、默认值、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加基础校验行为与职责边界防回归测试。

## 1.4.51

- 将 Git 路径规范化、glob 编译和配置规则匹配从 `src/config.js` 迁入 `src/config/path-matching.js`，内部消费者和公共入口直接依赖归类后的模块，配置入口继续显式重导出原有函数名称。
- 保持反斜杠与 `./` 规范化、`*`、`**`、`?` glob 语义、正则字符转义、排除项优先级、首条规则匹配和返回结构不变；配置默认值、验证、加载、schema、CLI、Hook、CI、公共 exports、输出和退出码均不变，并增加路径匹配行为与职责边界防回归测试。

## 1.4.50

- 将 `src/config.js` 中独立的 22 组平台默认配置迁入 `src/config/defaults.js`，由配置入口显式导入并重导出原有常量名称；配置验证、加载、路径匹配和 schema 均不在本版本扩展范围内。
- 保持所有默认开关、脚本名、超时、glob、架构规则、覆盖率阈值、文件归位规则、嵌套 `Object.freeze` 结构和现有导入契约不变，并增加默认值模块职责边界与打包面防回归测试。

## 1.4.49

- 删除混合职责的顶层 `src/git.js`：将 Git 子进程执行与可选值读取迁入 `src/git/execution.js`，将仓库根目录发现与 Git 元数据路径解析迁入 `src/git/repository.js`，不保留兼容转发。
- 保持 `core.quotepath=false`、失败容忍与 fallback、类型化执行/配置错误、Windows 隐藏窗口、仓库发现和相对 Git 路径解析行为不变；配置 schema、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加 Git 基础设施职责边界防回归测试。

## 1.4.48

- 删除混合职责的顶层 `src/git-changes.js`：将 Git `--name-status -z` 解析、revision/staged/working-tree 变更收集迁入跨入口共享的 `src/git/change-collection.js`，将规则分类与展示路径迁入 `src/policies/change-classification.js`，不保留兼容转发。
- 保持重命名/复制解析、类型化协议错误、变更状态合并、未跟踪文件收集、规则回退匹配与展示文本不变；配置 schema、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加跨层架构防回归测试。

## 1.4.47

- 删除顶层 `src/config-management.js`，将消费项目配置的初始化、迁移、功能启停与写回生命周期迁入 `src/orchestration/setup/config-management.js`，不保留兼容转发。
- 保持 starter 默认值、深拷贝隔离、迁移前验证、过期例外阻断、功能依赖联动、CI profile 配置和幂等写入行为不变；配置 schema、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加 setup 架构防回归测试。

## 1.4.46

- 删除顶层 `src/exception-registry.js`，将结构化例外有效期分类、当前性断言与精确匹配策略迁入 `src/policies/exception-registry.js`，不保留兼容转发。
- 保持 active/expiring/expired/future 分类、UTC 日期边界、人工复审约束和规则/路径/行列精确匹配不变；配置 schema、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并同步架构与错误契约防回归测试。

## 1.4.45

- 删除顶层 `src/vue-unsafe-html.js`，将 Vue `v-html` 安全规则、诊断与结构化例外应用迁入 `src/policies/vue-unsafe-html.js`，不保留兼容转发。
- 保持仅分析 Vue template、忽略脚本字符串与注释、识别参数和修饰符、精确位置及结构化例外行为不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.44

- 删除顶层 `src/vue-target-blank.js`，将 Vue `target="_blank"` 安全规则、诊断与结构化例外应用迁入 `src/policies/vue-target-blank.js`，不保留兼容转发。
- 保持静态与字面量绑定分析、`noopener noreferrer` 必需 token、`opener` 禁止 token、动态 rel 诊断、精确位置和结构化例外行为不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.43

- 删除顶层 `src/vue-style-languages.js`，将 Vue style 语言收集与单文件语言一致性策略迁入 `src/policies/vue-style-languages.js`，不保留兼容转发。
- 保持缺省 CSS、单双引号与无引号 lang、大小写归一、去重排序、非 Vue 文件跳过，以及同一 Vue 文件混用多种 style 语言时的结构化配置错误不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.42

- 删除顶层 `src/vue-image-alt.js`，将 Vue 原生图片替代文本规则、诊断与结构化例外应用迁入 `src/policies/vue-image-alt.js`，不保留兼容转发。
- 保持 alt/role 静态语义、装饰图片标记、动态与批量绑定拒绝、重复属性检测、空白引用、泛化替代文本、文件名替代文本及精确例外匹配不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.41

- 删除顶层 `src/vue-form-label.js`，将 Vue 原生表单控件无障碍名称规则、诊断与结构化例外应用迁入 `src/policies/vue-form-label.js`，不保留兼容转发。
- 保持可见 `label` 包裹与 `for`/`id` 关联、静态 `aria-label`、`aria-labelledby` 引用校验、动态绑定拒绝、无需文本名称的 input 类型排除及精确例外匹配不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.40

- 删除顶层 `src/vue-component-interaction.js`，将 Vue 模板交互入口与 `@vue/test-utils` 测试 AST 分析迁入 `src/integrations/vue/component-interaction.js`，不保留兼容转发。
- 保持 `v-model`/`v-on`/`@` 入口识别、JavaScript/TypeScript/JSX/TSX 解析、组件导入别名、`mount`、wrapper 查询与交互、结果断言及其执行顺序判定不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.39

- 删除顶层 `src/style-governance.js`，将 Vue 样式作用域、全局逃逸与普通样式文件位置规则迁入 `src/policies/style-governance.js`，不保留兼容转发。
- 保持 `scoped`/`module` 判定、`:global()`/`::v-global()` 检测、CSS Modules 与允许路径放行、注释和脚本示例跳过、诊断位置及结构化例外语义不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.38

- 删除顶层 `src/max-file-lines.js`，将物理行数统计、Vue 分区分析、规则选择与基线比较迁入 `src/policies/max-file-lines.js`，不保留兼容转发。
- 保持 `strict`/`noRegression` 模式、首条匹配与排除规则、临界值告警、重命名文件基线回退和既有超限文件不增长语义不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.37

- 删除顶层 `src/file-placement.js`，将文件归位规则判断与全项目 Git 文件范围收集迁入 `src/policies/file-placement.js`，不保留兼容转发。
- 保持 `newFiles`/`changedFiles` 模式、大小写不敏感的规则匹配、exceptions/allowedPatterns、建议目录、删除文件跳过，以及 tracked 与非忽略 untracked 文件收集并排除已删除文件不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.36

- 删除顶层 `src/commit-message.js`，将 `prepare-commit-msg`、`commit-msg` 与 `post-commit` 使用的受管提交信息摘要策略迁入 `src/policies/commit-message-summary.js`，不保留兼容转发。
- 保持初始提交与 `commit` source 的 base 解析、暂存树指纹、受保护文件分类、受管标记块替换、手写提交信息保留、索引变化时重建状态和提交后清理不变；配置格式、CLI、Hook 内容与顺序、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.35

- 删除顶层 `src/wecom.js`，将企业微信通知配置校验与文本生成迁入 `src/policies/wecom-notification.js`，将 HTTPS 发送和响应处理迁入 `src/integrations/wecom/notification.js`，不保留兼容转发。
- 保持可信 webhook 端点与手机号校验、Git 元数据脱敏、UTF-8 消息截断、请求载荷、10 秒超时、API 响应判定和结构化错误代码不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.34

- 删除顶层 `src/local-env.js`，将本地凭据文件解析、受管模板与 `.gitignore` 维护、Git 状态检查和暂存泄露阻断迁入 `src/policies/local-environment.js`，不保留兼容转发。
- 保持 `.env.config` 格式与变量白名单、系统环境变量优先级、敏感值不进入诊断、已跟踪/未忽略检查、删除已跟踪凭据的放行语义和结构化错误不变；配置格式、CLI、Hook、CI、公共 exports、输出和退出码均保持不变，并增加架构防回归测试。

## 1.4.33

- 删除顶层 `src/gitlab-ci.js`，将受管 GitLab CI 模板安装、根流水线接入和 doctor 检查迁入 `src/orchestration/setup/gitlab-ci.js`，不保留兼容转发。
- 保持三种 CI profile、受管 marker、现有 stage 选择、复杂 YAML 冲突转人工片段、非受管模板拒绝覆盖、dry-run 预览和幂等更新不变；配置格式、CLI、生成的 CI 内容、输出、退出码和公共 exports 均保持不变，并增加架构防回归测试。

## 1.4.32

- 删除顶层 `src/hook-installer.js`，将受管 Git Hook 安装与升级编排迁入 `src/orchestration/setup/hook-installer.js`，不保留兼容转发。
- 保持 v1/v2/v3 旧 marker 识别但只生成 v4、全部 Hook 预检先于任何写入、非受管 Hook 与已有 `core.hooksPath` 拒绝覆盖、安装结果、package scripts、`.gitattributes`、本地环境和 Lighthouse ignore 编排不变；配置格式、CLI、Hook 内容与顺序、CI、公共 exports、输出和退出码保持不变，并增加架构防回归测试。

## 1.4.31

- 删除顶层 `src/quality-gate.js`，将独立 `lint-staged` 隔离边界迁入 `src/orchestration/pre-commit/lint-staged-gate.js`，不保留兼容转发。
- 保持 `lint-staged` 隔离边界、质量执行 runner 与 protected-file plan 为三个独立模块，继续隔离部分暂存文件的未暂存内容；`lint-staged` 参数、`quality-files` 命令、固定 pre-commit 顺序、配置格式、CLI、Hook、CI、公共 exports、输出和退出码保持不变，并扩展架构防回归测试。

## 1.4.30

- 删除顶层 `src/state.js`，将 Git 元数据目录中的通知与提交信息状态持久化迁入 `src/integrations/git/repository-state.js`，不保留兼容转发。
- 保持状态文件名、JSON 格式、通知 ISO 时间戳、指纹匹配、缺失或损坏状态文件的安全 fallback 和提交信息状态清理不变，配置格式、CLI、Hook、CI、公共 exports、输出和退出码保持不变；增加直接持久化测试与架构防回归测试。

## 1.4.29

- 删除顶层 `src/git-attributes.js`，将 `.gitattributes` 托管文本块维护迁入 `src/orchestration/setup/git-attributes.js`，不保留兼容转发。
- 保持人工内容、托管标记、`.githooks/*` 与配置文件 LF 属性、幂等写入和安装结果不变，配置格式、CLI、Hook 顺序、CI、公共 exports、输出和退出码保持不变；增加行为测试与架构防回归测试，固定 setup 所有权。

## 1.4.28

- 删除顶层 `src/pre-push-changes.js`，将 pre-push 协议解析和精确推送范围收集迁入 `src/orchestration/pre-push/change-range.js`，不保留兼容转发。
- 保持空输入 fallback、删除引用跳过、新分支基线选择、rename 检测、跨 revision 去重、稳定错误代码和 ChangeSet 内容不变，配置格式、CLI、Hook、CI、公共 exports、输出和退出码保持不变；增加架构防回归测试，固定 pre-push 范围所有权。

## 1.4.27

- 删除顶层 `src/ci-changes.js`，将 CI 的 Git base/head 校验和精确 revision range 解析迁入 `src/orchestration/ci/change-range.js`，不保留兼容转发。
- 保持显式参数、GitLab 环境变量优先级、零 SHA 拒绝、非 GitLab 父提交 fallback、错误代码和 ChangeSet 内容不变，配置格式、CLI、Hook、CI 执行步骤、公共 exports 和退出码保持不变；增加架构防回归测试，固定 CI 范围所有权且避免编排入口直接依赖 integrations。

## 1.4.26

- 删除顶层 `src/fingerprint.js`，将 Git 暂存状态指纹迁入更明确的 `src/integrations/git/staged-fingerprint.js`，不保留兼容转发。
- 保持 `HEAD`/初始仓库标识、index tree、受保护变更复制排序、字段选择和 SHA-256 输出格式不变，通知去重、配置格式、CLI、Hook、CI、公共 exports 和退出码保持不变；增加架构防回归测试，禁止 Git 事实能力返回顶层或接管策略判定。

## 1.4.25

- 删除顶层 `src/staged-files.js`，将暂存文件路径规范化、去重和仓库边界校验迁入 `src/core/execution/staged-files.js`，不保留兼容转发。
- 保持仓库外路径拒绝、绝对/相对路径结果、分隔符规范化、Stylelint/ESLint/Prettier 和单文件行数门禁行为、固定 pre-commit 顺序、配置格式、CLI、Hook、CI、公共 exports 和退出码不变；增加架构防回归测试，禁止该执行基础能力返回顶层。

## 1.4.24

- 删除顶层 `src/file-snapshot.js`，将文件内容捕获与恢复迁入 `src/core/execution/file-snapshot.js`，不保留兼容转发。
- 保持二进制内容原样捕获和恢复、暂存质量门禁失败回滚、执行顺序、配置格式、CLI、Hook、CI、公共 exports 和退出码不变；增加架构防回归测试，禁止该执行基础能力返回顶层。

## 1.4.23

- 为所有 `defineGate` 能力增加不可变的 `resultModel: "GateResult"` 元数据，使统一内部结果模型成为 Registry 显式契约，而不再只由实现约定。
- 冻结 24 个官方门禁的 ID、配置键、执行环境、副作用上限、超时、关系依赖、工具/项目脚本/环境/Secret、artifact 及修复/取消能力；新增、删除或改变官方能力描述符必须显式更新受审清单。Execution Plan、配置格式、CLI、Hook、CI、输出和退出码保持不变。

## 1.4.22

- 冻结唯一 npm `bin` 启动器及 `runCli` 调用边界，并用隔离进程证明导入 `src/cli.js` 只装载能力：除 Node 从 `node_modules` 读取依赖代码外，不得读取消费项目配置、写入文件、启动子进程、访问网络、产生输出或设置退出码。
- 移除 CLI 模块图中的本包元数据顶层读取；Hook 仅在实际安装时读取包名，doctor 使用受测试的 Node.js 运行时下限常量。CLI、Hook、CI、配置格式、门禁顺序和退出码保持不变。

## 1.4.21

- 冻结本包受审的 npm 发布根目录、`src` 顶层平台目录和既有入口文件，新增未审查的顶层业务 API、页面、服务或部署发布面必须先显式更新架构契约并完成代码审查。
- 禁止本包声明自动安装及生产运行脚本 `preinstall`、`install`、`postinstall`、`prepare`、`start`、`serve`、`deploy` 及其命名空间，提供作为被动 `devDependency` 安装的防回归证明；通用消费项目 `release-ready` 语义不变。

## 1.4.20

- 为包根公共 API 增加隔离进程动态防回归测试，导入真实 `src/index.js` 时阻断文件读取检查与写入、子进程、DNS、Socket、HTTP(S)、fetch/WebSocket 和进程退出，并验证无输出、无退出码、无落盘文件。
- 将“公共 API 导入零副作用”从静态 exports 审查提升为最终验收的可执行证明；公共 exports、运行时实现、CLI、Hook、CI、配置格式和消费项目行为不变。

## 1.4.19

- 删除顶层 `src/quality-runner.js`，将暂存文件选择、执行配置构造、GateContext 创建、固定 Execution Plan 编排、结果渲染与失败回滚迁入 `src/orchestration/pre-commit/quality-runner.js`，不保留兼容转发。
- 保持 `quality-gate.js` 的独立 `lint-staged` 边界和部分暂存/未暂存内容保护；Stylelint fix、ESLint fix、Prettier、只读 Stylelint/ESLint 验证、其他 staged-only 门禁及最后的 protected-file gate 顺序、错误代码、结果、CLI 和公共 exports 不变。
- 增加阶段 8 防回归测试，确认 staged quality runner 只编排 Registry Gate，不直接调用消费项目工具或引入 project-wide 门禁，并将顶层 runner/policy/parser 待迁移清单收敛为空。

## 1.4.18

- 删除顶层 `src/stylelint-runner.js`，将消费项目 Stylelint 加载、项目配置解析与 lint 调用迁入 `src/integrations/stylelint`，将复杂度/样式治理规则、项目规则去重、结构化例外、warning 阈值、findings、回滚和 GateResult 判定迁入 `src/gates/quality/stylelint-gate.js`，不保留兼容转发。
- 保持消费项目 Stylelint 安装、配置和 custom syntax 所有权，继续只修复暂存文件并由 `lint-staged` 保护部分暂存/未暂存内容；硬性规则、错误代码、结果、CLI、公共 exports 及固定 pre-commit 顺序不变。
- 增加阶段 8 防回归测试，确认 Stylelint integrations 不持有 policy/result/例外/回滚判定、quality gate 不直接加载或调用 Stylelint API，并从顶层 runner 待迁移清单移除 Stylelint runner。

## 1.4.17

- 删除顶层 `src/prettier-runner.js`，将消费项目 Prettier 解析加载、ignore/config/parser 事实、格式化调用和文件写入迁入 `src/integrations/prettier`，将配置与 parser 判定、格式差异 findings、失败回滚和 GateResult 判定迁入 `src/gates/quality/prettier-gate.js`，不保留兼容转发。
- 保持消费项目 Prettier 安装、配置、插件、EditorConfig 和 ignore 文件所有权，继续只格式化暂存文件并由 `lint-staged` 保护部分暂存/未暂存内容；错误代码、结果、CLI、公共 exports 及固定 pre-commit 顺序不变。
- 增加阶段 8 防回归测试，确认 Prettier integrations 不持有 policy/result/回滚判定、quality gate 不直接加载或调用 Prettier API，并从顶层 runner 待迁移清单移除 Prettier runner。

## 1.4.16

- 删除顶层 `src/eslint-runner.js` 与 `src/eslint-config.js`，将消费项目 ESLint/插件解析加载、忽略判断和 lint/fix 执行迁入 `src/integrations/eslint`，将 preset、warning 阈值、findings、回滚和 GateResult 判定迁入 `src/gates/quality`，不保留兼容转发。
- 保持消费项目 ESLint 安装、Flat Config 和覆盖顺序，继续只修复暂存文件并由 `lint-staged` 保护部分暂存/未暂存内容；错误代码、结果、CLI、公共 exports 及 Stylelint fix → ESLint fix → Prettier → 只读 Stylelint/ESLint → protected-file 的顺序不变。
- 增加阶段 8 防回归测试，确认 ESLint integrations 不持有 policy/result/回滚判定、quality gate 不直接加载或调用 ESLint API，并从顶层 runner 待迁移清单移除 ESLint runner。

## 1.4.15

- 删除顶层 `src/dependency-policy.js`，将 package/lock JSON 与 Git index 暂存元数据事实分别迁入 `src/integrations/npm/package-metadata.js` 和 `src/integrations/git/staged-package-metadata.js`，将依赖治理与结构化例外判定迁入 `src/gates/repository/dependency-policy.js`，不保留兼容转发。
- 暂存依赖门禁改为直接消费只读 Git index 内容，不再创建临时目录或写入快照；保持声明、来源、精确版本、分组、lockfile 一致性规则、位置、错误代码、例外语义、pre-commit 顺序、CLI 和公共 exports 不变。
- 增加阶段 8 防回归测试，确认 integrations 不持有依赖策略或例外判定、gate 不直接运行 Git 或写临时文件，并从顶层 runner/policy 待迁移清单移除 dependency policy。

## 1.4.14

- 删除顶层 `src/unit-test-runner.js`，将消费项目包与 Vitest/Vue Test Utils 事实、测试源码调用事实解析和 npm 测试执行迁入 `src/integrations/vitest`，将 setup readiness、测试映射与绕过判定、finding 和 GateResult 判定拆入 `src/gates/testing`，不保留兼容转发。
- 保持消费项目 Vitest、测试环境、配置和测试所有权，以及测试映射、精确 Git 范围、绕过检测、Vue 交互语义、覆盖率衔接、错误代码、pre-push/CI 顺序和公共 exports 不变。
- 增加阶段 8 防回归测试，确认 Vitest integrations 只返回项目、执行与测试源码事实且不持有 ChangeSet、finding 或 GateResult 策略，testing policy 不执行子进程，并从顶层 runner/policy 待迁移清单移除 unit-test runner。

## 1.4.13

- 删除顶层 `src/coverage-runner.js`，将 Vitest 覆盖率参数、报告文件准备、summary/LCOV 解析和变更行覆盖事实迁入 `src/integrations/vitest/coverage.js`，将阈值判定与结构化 finding 迁入 `src/gates/testing/coverage-gate.js`，不保留兼容转发。
- 保持消费项目 Vitest、coverage provider、配置和报告目录所有权，以及 coverage 配置、全局与变更行阈值算法、错误代码、单元测试执行顺序、pre-push/CI 顺序和公共 exports 不变。
- 增加阶段 8 防回归测试，确认 integration 不持有阈值通过判定或修复建议、testing gate 显式消费覆盖率事实，并从顶层 runner/policy 待迁移清单移除 coverage runner。

## 1.4.12

- 删除顶层 `src/ci-runner.js`，将 policy/full/release-ready 执行计划编排迁入 `src/orchestration/ci/runner.js`，将 CI 报告路径安全检查与 JSON 持久化拆入 `src/orchestration/ci/report.js`。
- 保持 Gate Registry、固定步骤顺序、可信外部门禁条件、变更范围、报告格式、符号链接与 tracked-file 防护、状态、退出码、控制台输出和公共 exports 不变；旧路径不保留兼容转发。
- 增加阶段 8 防回归测试，确认 CI runner 不直接持有文件写入，report 模块不接管 Gate 编排，并从顶层 runner/policy 待迁移清单移除 ci-runner。

## 1.4.11

- 将顶层 `src/accessibility-test-runner.js` 按职责拆分为 axe 项目 integration、npm 执行 integration、testing setup 与 testing gate；外部事实、准备检查和结构化判定不再混在同一 runner。
- 保持支持的 axe 集成、扫描与零违规断言规则、绕过检测、消费项目依赖与脚本所有权、managed AGENTS policy、CLI、pre-push/CI 顺序、超时、错误代码、输出脱敏和公共 exports 不变；删除旧 runner 且不保留兼容转发。
- 增加阶段 8 防回归测试，确认 integrations 不生成 GateResult、finding 或策略修复建议，testing gate/setup 显式消费 integration facts，并从顶层 runner/policy 待迁移清单移除 accessibility-test。

## 1.4.10

- 将顶层 `src/architecture-runner.js` 按职责拆分为 `src/integrations/dependency-cruiser/architecture.js`、`src/gates/quality/architecture-gate.js` 与 `src/gates/quality/architecture-setup.js`：integration 负责消费项目 dependency-cruiser 的解析、配置、执行和 JSON 协议事实，gate 负责结构化判定、finding 与 diagnostic，setup 负责 init readiness。
- 保持架构规则、managed AGENTS policy、CLI、pre-push/CI 固定顺序、临时文件清理、超时、稳定错误代码、输出脱敏和公共 exports 不变；删除旧 runner 且不保留兼容转发。
- 增加阶段 8 防回归测试，确认 dependency-cruiser integration 不产生 GateResult 或策略修复建议、quality gate 和 setup 显式消费 integration facts，并从顶层 runner/policy 待迁移清单移除 architecture。

## 1.4.9

- 将顶层 `src/typecheck-runner.js` 按职责拆分为 `src/integrations/npm/typecheck.js`、`src/gates/quality/typecheck-gate.js` 与 `src/gates/quality/typecheck-setup.js`：integration 只验证并执行消费项目自己的 npm typecheck 脚本，gate 负责 GateResult、finding 与 diagnostic，setup 负责 init readiness。
- 保持 TypeScript 门禁不进入 pre-commit，并保持配置、CLI、pre-push/CI 固定顺序、Windows/npm 启动方式、超时、稳定错误代码、输出脱敏和公共 exports 不变；删除旧 runner 且不保留兼容转发。
- 增加阶段 8 防回归测试，确认 typecheck integration 不产生 GateResult 或策略 finding、quality gate 和 setup 显式消费 integration facts，并从顶层 runner/policy 待迁移清单移除 typecheck。

## 1.4.8

- 将顶层 `src/build-runner.js` 按职责拆分为 `src/integrations/npm/build.js`、`src/gates/quality/build-gate.js` 与 `src/gates/quality/build-setup.js`：integration 只验证并执行消费项目自己的 npm build 脚本，gate 负责 GateResult、finding 与 diagnostic，setup 负责 init readiness。
- 保持 build 配置、CLI、pre-push/CI/release-ready 固定顺序、Windows/npm 启动方式、超时、稳定错误代码、输出脱敏和公共 exports 不变；删除旧 runner 且不保留兼容转发。
- 增加阶段 8 防回归测试，确认 build integration 不产生 GateResult 或策略 finding、quality gate 和 setup 显式消费 integration facts，并从顶层 runner/policy 待迁移清单移除 build。

## 1.4.7

- 将共享的顶层 `src/vue-template-parser.js` 迁入 `src/integrations/vue/template-parser.js`，明确 Vue 源码标签、属性、元素层级和位置解析只提供静态事实，安全与可访问性策略仍由各自 gate 规则负责。
- 保持模板扫描、注释与 mustache 跳过、raw-text 元素、嵌套 template、属性偏移和源码位置行为不变；所有调用方直接使用目标路径，删除旧根路径且不保留兼容转发。
- 增加阶段 8 防回归测试，确认 integration 不创建 GateResult、finding 或分类异常，并将顶层 runner/policy/parser 待迁移清单移除 `vue-template-parser.js`。

## 1.4.6

- 将顶层 `src/stylelint-project.js` 按职责拆分为 `src/integrations/stylelint/project.js` 与 `src/gates/quality/stylelint-setup.js`：integration 提供消费项目 Stylelint 包与配置事实，gate setup 将可选工具状态转换为 init readiness。
- 保持 Stylelint 配置文件发现、`package.json#stylelint`、项目安装解析、ESM 入口兼容、初始化自动启用和现有错误行为不变；runner 与 platform capability 使用 integration，`commands/init` 只使用 gate-owned setup，不保留旧路径兼容转发。
- 增加阶段 8 防回归测试，确认事实与 readiness 边界、旧根路径删除，并将顶层 `*-project.js` 审查清单正式收敛为空。

## 1.4.5

- 将安装期维护 Lighthouse 与 coverage 输出忽略项的顶层 `src/lighthouse-ignore.js` 迁入 `src/orchestration/setup/lighthouse-ignore.js`，明确它属于 init/doctor/hook 安装编排，不属于运行 integration 或质量 gate。
- 保持 `.gitignore` managed marker、默认 `.lighthouseci/`、配置化 coverage 目录、路径规范化、幂等写入和安装结果不变；删除旧路径且不保留兼容转发。
- 增加阶段 8 防回归测试，确认旧根文件不存在且 setup orchestration 实现存在；Lighthouse 的项目/执行事实、结构化判定和安装期仓库状态现已分别归入 integration、gate 与 orchestration。

## 1.4.4

- 将顶层 `src/lighthouse-runner.js` 按职责拆分为 `src/integrations/lighthouse/execution.js` 与 `src/gates/quality/lighthouse-gate.js`：integration 只执行消费项目 build 和 LHCI phase，gate 只负责结构化判定、finding、diagnostic 与 artifact。
- 保持 Windows/npm 启动方式、build/collect/assert 顺序、skip-build、超时和失败状态、`lighthouse/*` 错误代码、Lighthouse 输出与消费项目工具所有权不变；删除旧 runner 且不保留兼容转发。
- 增加阶段 8 防回归测试，确认 execution integration 不产生 GateResult 或策略 finding、quality gate 显式消费 execution facts，并从待迁移顶层 runner 清单移除 Lighthouse。

## 1.4.3

- 将仅生成结构化 finding、evidence、remediation 与 AI decision 的进程失败 guidance 从 `src/core/report/guidance-catalog.js` 迁入 `src/core/result/process-failure-guidance.js`，不保留旧路径兼容转发。
- 保持全部进程失败规则 ID、错误代码、消息、修复步骤、约束、验证方式和 runner 行为不变；本次只纠正 guidance 的结果模型归属，使 `core/report` 专注于 console、JSON 和例外登记表 renderer。
- 增加阶段 8 防回归测试，确认旧 guidance 路径不存在、目标结果模块存在，并要求 `core/report` 中的文件全部是 renderer，为后续 runner 迁入 `gates` 清除错误依赖边界。

## 1.4.2

- 将消费项目 Lighthouse 配置发现、Vue 项目识别和 `@lhci/cli` 元数据解析从顶层 `src/lighthouse-project.js` 迁入 `src/integrations/lighthouse/project.js`，不保留旧路径兼容转发。
- 保持 `lighthouse/invalid-setup` 错误代码、配置格式、Lighthouse runner 行为和“必须使用消费项目 Lighthouse CI/Chrome 环境”的所有权不变；本次仅完成 Lighthouse 外部事实边界归位。
- 扩充阶段 8 静态测试，确认旧路径不存在、Lighthouse integration 实现存在，并将待迁移的顶层 `*-project.js` 清单收敛为 `stylelint-project.js`。

## 1.4.1

- 将消费项目 package.json、项目依赖包清单与运行入口解析从顶层 `src/project-package.js` 迁入 `src/core/project/package.js`，所有调用方直接使用目标目录，不保留旧路径兼容转发。
- 保持 `project-package/*` 稳定错误代码、typed configuration error、修复建议、公共 exports 和消费项目工具所有权不变；本次仅完成项目依赖解析边界归位。
- 扩充阶段 8 静态测试，确认旧路径不存在、目标实现存在，并冻结仍待迁移的顶层 gate-specific `*-project.js` 清单，禁止项目发现基础设施重新堆回 `src` 根目录。

## 1.4.0

- 新增仓库自用的 dependency-cruiser 17.4.3 架构检查，以 error 级别拒绝无法解析和循环依赖，强制 `core`、`gates`、`orchestration` 与 `integrations` 的依赖方向，并纳入标准 `npm run check`。
- 禁止 core 反向依赖平台层、gate 依赖编排或 renderer、不同 gate 领域深层互相导入、integration 决定策略/渲染以及 orchestration 绕过 gate 直接调用 integration。
- 新增阶段 8 防回归测试：用故意违规、无法解析和循环的临时依赖图证明全部规则可触发，冻结现有顶层 runner/policy/parser 与 gate 入口迁移清单，禁止 gate 接管进程退出或重新收集 Git 范围，并锁定已审查的包根 exports 及目标。
- 本版本只完成目录依赖边界自动化，不批量移动现有顶层文件；后续目录迁移必须作为独立阶段逐项评审。

## 1.3.0

- 消费项目工具解析现在会对缺失 package.json、缺失项目依赖和无法解析的包入口返回带稳定代码与修复步骤的 typed configuration error。
- Git 变更收集现在会将不完整的普通、重命名和复制记录报告为带协议证据的 typed execution error，不再依赖编排层生成泛化错误。
- 清理仓库维护的 `src` 与 `test` 中全部裸 `Error`/`AggregateError` 和未分类重抛：配置、Git/CI、Hook、外部门禁、工具 runner、通知与发布准备边界现在直接产生带稳定代码的 typed error；仅允许白名单内的 API 参数契约使用 `TypeError`，并由排除生成目录与第三方代码的递归静态测试防回归。
- 将内部 JSON 报告升级为 `GateResult` schema v2：新增面向 AI 的统一 `issues`，每项固定包含问题类型、稳定代码、仓库相对位置、结构化证据、预期、修复目标/步骤/约束/验证、AI 决策和去重指纹；新增可发布的 `gate-result.schema.json`。
- 新增 `RepoGuardError` 分类与稳定状态映射，配置、执行、范围、安全、内部、取消和超时错误不再按调用阶段猜测；规则违规继续返回 finding，不使用异常代替策略结果。
- diagnostics 统一携带 `source/stream/level/redacted/truncated`，所有子进程文本经过同一凭据脱敏、仓库根路径替换和长度限制；Vue 图片、表单 label 与 axe 设置问题移除 `reason/repair` 兼容字段。
- 将官方门禁输出收口为统一 `GateResult` 报告链：规则与 runner 只产生结构化 finding、diagnostic、metric 和 artifact，console/CI JSON 由 `core/report` 统一渲染，JSON `gateResult` 现在完整保留 diagnostics。
- TypeScript、build、单元测试、axe 与 Lighthouse 子进程改为捕获 stdout/stderr 后写入 diagnostics，不再通过继承 stdio 或 runner 内部 console 绕过报告层；配置、执行和范围错误也使用同一状态与 console renderer。
- 将例外、架构、单元测试和 axe 的 `AGENTS.md` 提示模板收口到统一 managed-policy catalog；进程失败修复建议由 guidance catalog 生成，coverage 与架构不再维护专属文本 formatter，源码中的 console 写入也只允许出现在共享 renderer。
- 删除各规则专属 AI/console renderer、隐藏的 `lint-files` 命令、未使用 exceptions command 与保护文件直调旁路；新增输出依赖边界测试，并保持 pre-commit 固定顺序、消费项目工具所有权和 Lighthouse 生命周期不变。

## 1.2.0

- 新增只读 `release-ready` CI profile 与固定 Execution Plan，复用 CI policy、项目 `check`/`test`、build、可选 Lighthouse，并在官方步骤末尾追加显式声明且仅限受保护引用的外部门禁。
- 新增版本、lockfile、changelog、draft 2020-12 Schema、exports/bin 与 npm pack 文件清单一致性检查；pack dry-run 忽略 lifecycle scripts、不生成 tarball，并拒绝敏感发布文件。
- 发布准备子进程仅接收运行所需环境变量白名单，拒绝 publish/deploy 脚本；GitLab 模板、CLI、配置 Schema、README 与架构进度同步更新，整个计划只证明“可以发布”，不会发布或部署。

## 1.1.0

- 新增严格的 `externalGates` 配置和 `repo-guard-json-v1` 报告 Schema，项目可通过精确 npm script 在 manual 与 CI full 接入 API、页面或视觉等自有门禁。
- 项目 Registry 从官方静态 Registry 派生，启用的 `project.*` 门禁只能固定追加到 CI full 官方步骤末尾，不能进入 pre-commit、pre-push、CI policy 或重排安全流水线。
- 新增报告新鲜度、状态/退出码一致性、未知字段、标准路径/符号链接、tracked file、大小、artifact 和敏感内容验证，并对外部脚本输出进行脱敏；超时、取消或输出超限会终止完整 npm 进程树。

## 1.0.0

- 将所有官方门禁收口为原生 `GateResult` Capability，删除数字 runner adapter、旧动态代码 facade、重复 command wrapper 和可旁路统一编排的数字执行入口。
- 收缩包根公共 API，只公开当前配置、Gate 定义/上下文/Registry 与结构化结果契约；这是明确的不兼容主版本重构。
- 缺省配置直接采用当前平台默认值，不再为旧项目保留 ESLint、Prettier、依赖治理和单文件行数门禁的关闭语义；托管 Hook 仍按仓库安全要求识别已知旧标记，但只生成当前版本。

## 0.20.0

- 将 pre-commit 固化为启动时校验的受保护执行计划，锁定 Stylelint fix、ESLint fix、Prettier、只读复检、硬性暂存检查、依赖策略和保护文件顺序；拒绝项目配置调序以及全项目修复、类型检查、测试、构建和网络门禁进入。
- 暂存质量段与最终策略段由同一计划派生并通过通用 orchestrator 传递 `GateResult`，删除 runner 内部数字结果协议；保护文件与暂存代码质量仍是独立 Capability。
- 保留 `lint-staged` 暂存隔离、文件快照、部分暂存和失败恢复以及 Hook 的 0/1 外部语义；修正 Prettier 3 配置文件搜索锚点，确保只从消费仓库内开始查找项目配置。

## 0.19.0

- 新增不可变 `GateContext` 与 `ChangeSet`，manual CLI、CI policy/full 和 pre-push 通过同一通用 orchestrator 执行，统一处理逐 gate 超时、上游取消、失败短路、结果聚合和最终退出码。
- CI 的保护文件、测试策略、单元测试和变更行覆盖率复用同一 Git 变更事实；pre-push 保持既定顺序与精确推送快照约束，并迁移为支持超时/取消的异步编排。
- 本次架构重构删除 `GateResult.legacyExitCode`、旧退出码保留选项、同步编排入口及兼容 CI 步骤退出语义；尚未原生化的数字 runner 只在组合边界转换为统一 `GateResult`。

## 0.18.0

- 建立全平台静态 Gate Registry，集中声明稳定 ID、配置键、生命周期、允许的副作用、超时、所需工具/项目脚本、artifact、manual command 和依赖关系；启动时拒绝重复 ID/配置键/命令、未知关系、排序环路和未声明的副作用降级。
- 新增不可变的 pre-commit、pre-push、CI policy 与 CI full Execution Plan；项目配置只能启停允许配置的能力，不能改变受审顺序，pre-commit 的 Stylelint fix、ESLint fix、Prettier、只读验证和保护文件顺序保持不变。
- manual CLI 帮助、命令发现、参数白名单与项目脚本从 Registry 派生；CI、pre-push 和 staged quality 按 Execution Plan 遍历，原生只读 gate 的 manual/CI 路径统一执行异步 setup、plan 和 run，旧 runner 继续通过组合层适配。

## 0.17.0

- 完成首个 Gate Capability 纵向试点：动态代码门禁注册为只读 `security.dynamic-code`，统一声明 manual、pre-commit、CI 生命周期、规则、超时、配置版本与 setup 诊断。
- 动态代码扫描器迁入 `src/gates/security` 并原生返回结构化 finding、metric 和诊断；文件范围由编排层显式提供，console renderer 在 Registry 组合边界挂接，CLI、pre-commit、CI 与 doctor 从同一能力目录取得能力，旧包根 API 通过兼容导出继续可用。
- CI 的动态代码步骤在保留既有 `name/status/exitCode/durationMs` 和控制台文案的同时附带版本化 `gateResult`，供新消费者读取稳定规则位置、证据、修复建议和指标。

## 0.16.0

- 新增内部统一门禁结果模型，稳定区分通过、跳过、策略违规、配置错误、执行错误和范围错误，并统一表示 finding、artifact、metric、诊断与标准退出码。
- 新增旧 runner 兼容适配层以及 console、版本化 JSON renderer；CI 步骤聚合已使用同一个 `GateResult` 生成现有控制台输出和兼容 JSON，保持原有命令文案、步骤结构及退出码。
- 新平台模块从 `src/core/result` 与 `src/core/report` 进入目标目录，语法检查同步改为递归覆盖 `src`；本版本只实施架构阶段 1，不提前引入 Registry、Execution Plan 或具体门禁迁移。

## 0.15.0

- 新增平台无关的 `repo-guard ci` 只读远程门禁，支持 GitLab MR/分支 SHA、`policy`/`full` profile、全仓硬规则、变更测试策略、保护文件 report/fail 和始终落盘的 JSON 报告。
- 新增 `repo-guard install-ci --provider gitlab`，生成受管理的本地 GitLab CI 模板；简单现有流水线通过 `include + extends` 幂等接入，复杂 include 或 stage 冲突时保留根 CI 并输出人工审查片段。
- 新增 `repo-guard doctor --ci`，CI 环境不要求本地 Hook 或企业微信密钥，并验证模板、根 include、非手动/非 allow_failure Job 与 Node.js 22.23.2；配置、Schema、公共 API、项目脚本和文档同步更新。

## 0.14.0

- 将最低运行环境从 Node.js 18.12.0 提升到 Node.js 22.23.2，并同步包元数据、锁文件、README、配置 Schema 与架构文档。
- `doctor` 现在直接读取 `package.json` 的 `engines.node` 并进行完整主、次、补丁版本比较，避免运行时诊断与发布元数据不一致。

## 0.13.3

- 新增 `preCommit.stylelint.governance` 样式治理增强，强制执行 `selector-max-specificity`、`selector-max-id` 和 `declaration-no-important`；默认最大权重为 `0,3,0`、禁止 ID 选择器和 `!important`。
- 新增非预期全局样式检查：Vue 组件样式必须使用 `scoped/module` 且不得通过 `:global()` 逃逸，普通样式文件必须位于明确白名单或采用 CSS Modules。
- 新增 `repo-guard style-governance`、CLI 开关、doctor、Schema、精确结构化例外及面向 AI 的修复指令。规则不可被项目配置、ignore 或 disable 注释关闭；已有项目迁移后默认关闭。

## 0.13.2

- 新增 `unitTest.componentInteraction` Vue 组件交互测试语义门禁，复用现有测试映射、变更范围、Vitest 脚本和覆盖率流程，不重复执行测试。
- 对范围内含 `v-on/@事件` 或 `v-model` 的组件，要求同一正常用例直接导入组件、使用 Vue Test Utils `mount`、触发 wrapper 交互并在其后断言可见结果、emit、路由、Store 或 Mock 调用。
- 拒绝仅检查组件定义、`wrapper.exists()`、无异常挂载、快照或交互前状态等弱测试；新增配置迁移、Schema、doctor 和面向 AI 的逐项补全指令。已有项目迁移后默认关闭。

## 0.13.1

- 新增始终启用的动态代码执行安全门禁，覆盖 JavaScript、TypeScript、JSX、TSX 和 Vue `<script>` 中的 `eval` 与 `Function` 构造器。
- 识别直接、间接、全局对象、可选链、方括号访问和简单别名获取，同时跳过注释、普通字符串、正则、模板文本与 Vue 非脚本区域。
- 新增 `repo-guard dynamic-code`、`guard:dynamic-code`、doctor 诊断、结构化例外规则和可直接交给 AI 的风险说明、替代方案与验证要求。

## 0.13.0

- 新增 `accessibilityTest` axe 组件/E2E 可访问性测试门禁，支持 vitest-axe、jest-axe、@axe-core/playwright、cypress-axe 和 axe-core。
- 静态要求每个匹配文件包含真实测试用例、axe 扫描和零违规断言，并拒绝禁用或筛选规则、排除节点、影响级别过滤、空脚本和 skip/only/todo 绕过。
- 新增 `repo-guard accessibility-test`、pre-push 编排、项目能力检测、doctor 诊断修复、受管理 AGENTS.md AI 规范和配置 Schema；已有项目迁移后保持关闭。

## 0.12.14

- 新增始终启用的 Vue 原生图片 alt 门禁，要求内容图片提供可静态验证且符合用途的替代文本，纯装饰图片同时使用空 alt 与静态 none/presentation 角色。
- 拒绝缺失或不可证明的动态 alt、未明确装饰语义的空 alt、冲突装饰角色、泛化占位词、图片文件名、重复语义属性和可能覆盖语义的对象批量绑定。
- 新增 `repo-guard image-alt`、`guard:image-alt`、doctor 诊断、统一 AI 修复报告和 `vue/img-alt` 精确结构化例外。

## 0.12.13

- 新增始终启用的 Vue 原生表单控件 label 门禁，覆盖 `input`、`select` 和 `textarea`。
- 接受静态 `for/id`、外层 `label`、非空 `aria-label` 及指向模板现有 id 的 `aria-labelledby`；拒绝 `placeholder`、`title`、空值和不可证明的动态绑定。
- 新增 `repo-guard form-labels`、`guard:form-labels`、doctor 诊断、统一 AI 修复报告和 `vue/form-control-label` 精确结构化例外。
- 在 `PUBLISHING.md` 与仓库 `AGENTS.md` 中固化发布版本规则：小型兼容功能升补丁版本，大型门禁或工作流升次版本，不兼容变更先审查主版本及迁移方案。

## 0.12.12

- 新增 `preCommit.stylelint.complexity` 配置和 `repo-guard style-complexity` 全项目命令，默认限制复合选择器段数与样式嵌套深度为 3。
- Stylelint 就绪的新项目默认启用复杂度规则；已有配置迁移后保持关闭，`enable styleComplexity` 会同步启用 Stylelint。
- 复杂度规则复用业务项目的 Vue/SCSS/Less 自定义语法，但不能被同名项目规则、override、ignore 或源码 disable 注释关闭。
- 新增 `style/*` 精确结构化例外和针对选择器拆分、语义化 class、降低嵌套的统一 AI 修复指令。

## 0.12.11

- 新增 `dependencyPolicy` 配置、`repo-guard dependencies` 显式命令和可开关的 `pre-commit` 依赖治理；新项目默认开启，已有配置迁移后保持关闭。
- 默认要求非 peer 依赖使用精确版本，限制 Git、HTTP、GitHub shorthand 和本地路径等未批准来源，并检查非 peer 分组重复及项目禁用包。
- 要求 npm lockfile v2+，逐项校验根依赖声明；暂存门禁读取 Git index，覆盖部分暂存和只删除锁文件的场景。
- 所有发现支持精确结构化例外，并输出禁止关闭门禁、扩大来源或伪造锁文件的独立 AI 修复指令。

## 0.12.10

- 依赖架构门禁失败时，为每条 error 违规输出可独立复制给 AI 的完整中文修复指令，包含项目根目录、规则、依赖关系、循环链路、修复建议、修改范围和验证命令。
- AI 指令明确禁止关闭、删除、降级或忽略规则，以及缩小扫描范围、扩大排除和伪造 dependency-cruiser 结果。
- 兼容 dependency-cruiser 17/18 的对象循环链路格式，不再把循环模块显示为 `[object Object]`。

## 0.12.9

- 修复 dependency-cruiser 16、17 和 18 仅通过 ESM `import` 条件导出入口时被误报为未安装的问题。
- 依赖架构门禁现在直接解析项目本地包元数据与 CLI，不再要求 dependency-cruiser 提供 CommonJS `require` 入口。
- 增加 ESM-only dependency-cruiser 安装形态的架构门禁和 doctor 回归测试。

## 0.12.8

- 新增始终启用的 Vue `target="_blank"` 安全门禁，要求同一标签具有可静态验证的 `rel="noopener noreferrer"`，并拒绝冲突的 `opener` token。
- 支持静态属性以及简单的 `:target="'_blank'"`、`v-bind:target` 和字面量 `:rel`，动态 `rel` 不会被错误判定为安全。
- 新增 `repo-guard target-blank` 与 `guard:target-blank` 全项目检查，输出缺失 token、精确位置和统一 AI 修复指令。
- 新增 `vue/target-blank-security` 精确结构化例外，并报告批准例外的 ID 和到期日。
- 将 Vue SFC 模板扫描提取为复用模块，`v-html` 与链接安全规则共享相同的标签、属性和位置解析。

## 0.12.7

- 新增始终启用的 Vue `v-html` 安全门禁，检查暂存 `.vue` 文件的根模板区域，不依赖业务项目 ESLint 配置或可选开关。
- 新增 `repo-guard unsafe-html` 与 `guard:unsafe-html` 全项目检查，统一输出精确文件、行、列和可交给 AI 的修复要求。
- `v-html` 仅在精确命中当前有效的 `vue/no-v-html` 结构化例外时放行，并报告例外 ID 与到期日。
- 扫描器忽略脚本、HTML 注释和模板插值字符串，支持嵌套 `<template>` 与跨行属性。
- `doctor` 现在明确报告硬性 Vue 安全门禁状态。

## 0.12.6

- 新增通用 `exceptions` 结构化例外登记表，要求唯一 ID、命名空间规则、精确文件与行列、原因、责任人、独立审批人、工单和日期。
- 默认最长有效期 90 天、提前 14 天预警；过期和未来日期条目会阻断普通 repo-guard 命令。
- 新增只读 `repo-guard exceptions` 统一报告和 `guard:exceptions` 项目脚本，不提供自动新增或延期能力。
- 新增精确位置例外匹配 API，供后续不安全 HTML、链接安全、依赖和样式规则复用。
- `init` 与 `doctor --fix` 增量维护 `AGENTS.md` 结构化例外硬性要求，禁止 AI 通过新增、延期或篡改审批信息绕过。

## 0.12.5

- 新增基于业务项目本地 dependency-cruiser 的依赖架构门禁，由 repo-guard 统一生成配置、执行和解析 JSON 报告。
- 默认阻止循环依赖、无法解析的导入和生产代码反向导入测试代码；支持自定义 `sourcePaths`、`tsConfig`、排除正则及 `from`/`to` 规则。
- 新增 `repo-guard architecture`、`enable/disable architecture`、pre-push 编排、doctor 诊断和 `guard:architecture` 项目脚本。
- 启用时增量维护 `AGENTS.md` 架构硬性要求，明确禁止降低规则、缩小扫描范围或扩大排除项绕过。
- 旧配置迁移后架构门禁保持关闭；新项目仅在 dependency-cruiser 和源码路径均可用时自动开启。

## 0.12.4

- 新增结构化 `unitTest.coverage` 门禁，强制 Vitest 生成新鲜的 `coverage-summary.json` 和 `lcov.info`，统一报告并阻断全局行、语句、函数和分支覆盖率不足。
- 新增基于本次推送精确 Git diff 的变更行覆盖率，列出缺少 LCOV 数据的源码和未覆盖的 `file:line`；默认全局阈值为 80%，变更行阈值为 90%。
- 保留 `coverage: true/false` 兼容模式，已有项目不会因升级自动启用新阈值；结构化门禁会强制源码 include 和测试/生成路径 exclude，避免未导入源码逃逸。

## 0.12.3

- 新增可配置的 `unitTest.mappings`，使用 `{dir}`、`{name}`、`{path}` 和 `{ext}` 将源码映射到多个候选测试路径。
- 默认支持 JS、MJS、CJS、JSX、TS、MTS、CTS、TSX 和 Vue 源码，以及 `.spec`、`.test`、同目录和 `__tests__` 测试布局。
- 映射按顺序采用第一条命中规则，任一候选文件包含有效测试即可通过；缺失测试提示会列出建议路径和全部允许位置。

## 0.12.2

- 新增项目自有 npm 脚本驱动的独立生产构建门禁，支持 `repo-guard build` 显式执行和受管理 `pre-push` 自动阻断。
- 新项目存在 `build` 脚本时自动开启；已有配置迁移后保持关闭，并可通过 `repo-guard enable build` 渐进启用。
- 增加脚本存在性、超时配置、doctor 诊断和面向 AI 的失败修复要求；独立构建与 Lighthouse 使用同一脚本时只构建一次。

## 0.12.1

- 新增项目自有 npm 脚本驱动的 TypeScript 类型检查门禁，支持 `repo-guard typecheck` 显式执行和受管理 `pre-push` 自动阻断。
- 新项目存在 `typecheck` 脚本时自动开启；已有配置迁移后保持关闭，并可通过 `repo-guard enable typeCheck` 渐进启用。
- 增加脚本存在性、超时配置、doctor 诊断和面向 AI 的失败修复要求；类型检查不进入 pre-commit，也不内置 TypeScript 工具链。

## 0.12.0

- 新增默认开启的可配置文件归位门禁，内置资源文件统一进入 assets 目录、Markdown 文档统一进入 docs 等目录的规则。
- 默认 `newFiles` 模式只拦截新增、复制和重命名后的错位文件，避免升级后因历史文件普通修改而突然阻断提交；也可切换为 `changedFiles` 严格治理存量文件。
- 失败时为每个错位文件输出可直接交给 AI 的移动、引用更新和验证指令，并支持项目自定义文件类型、允许目录、例外和建议目录。
- 新增 `repo-guard file-placement` / `npm run guard:file-placement` 全项目专项检查，覆盖已跟踪和未忽略的未跟踪文件。

## 0.11.0

- 让自动 `pre-push` 从待推送提交读取配置，并在质量门禁启用时要求单一的当前 `HEAD` 和干净工作区，确保 Vitest、构建与 Lighthouse 验证的就是实际推送内容。
- 保留多个待推送提交中同路径的独立变更记录，并对无法安全验证的多提交推送给出拆分提示。
- 单元测试静态检查忽略注释和字面量，拒绝 `.skipIf/.todo`，并支持 `.mjs/.cjs/.jsx` 源码映射。
- 加强托管 Hook 标记识别、人工文本保留、Git Remote 凭据脱敏和 Stylelint 无效选项诊断。

## 0.10.0

- 增加面向纯 JavaScript/Vue 项目的可配置 Vitest 单元测试门禁，在 `pre-push` 中先于 Lighthouse 自动执行。
- 默认以本次推送的精确 Git 范围检查新增目标源码是否存在同目录 `.spec.js`，支持切换为检查所有变更源码，并可配置源码、测试和排除 glob。
- 拒绝没有 `it/test` 用例的空测试，以及本次变更测试文件中的 `describe/it/test.skip` 和 `.only`；失败时输出可直接交给 AI 的中文修复指令。
- 启用单元测试时增量维护根目录 `AGENTS.md` 的受管理测试规范，保留已有人工内容，并由 `doctor` 验证和修复。
- 增加测试脚本、超时和覆盖率开关；测试框架、Vue Test Utils、运行环境、Mock 和覆盖率阈值继续由业务项目控制。
- 托管 Hook 升级为 v4，继续识别并升级 v1、v2、v3 Hook。

## 0.9.0

- 增加可配置的最终暂存文件物理行数门禁，默认限制 Vue 文件 700 行、JS/JSX/TS/TSX 文件 1000 行。
- 行数检查在 Stylelint/ESLint 最终复检之后运行，并通过 `lint-staged` 正确隔离部分暂存文件的未暂存内容。
- 新项目默认启用行数门禁；已有配置迁移时保持关闭，可通过 `repo-guard enable maxFileLines` 开启。
- 支持按仓库相对 glob 配置多条限制和排除生成文件，超限时为每个文件输出可单独复制给 AI 的完整重构指令。
- 增加默认 85% 的非阻断预警，以及允许存量超限文件持平或缩短的 `noRegression` 渐进治理模式。
- Vue 超限提示增加 `template`、`script`、`style` 有效内容行数和最大区域的针对性拆分建议。
- 增加由 `preCommit.eslint.preset` 开关控制的 AI 可维护性规则基线，不需要项目手动导入 repo-guard 配置。
- ESLint 基线通过 `baseConfig` 使用业务项目安装的 `@eslint/js`，并按安装情况自动加入 `eslint-plugin-vue` 和 `typescript-eslint`；项目原有 Flat Config 后加载并可覆盖基线。
- 新项目默认开启 ESLint 基线；已有配置迁移保持关闭。自动基线要求 ESLint `>=9.19`，`doctor` 会检查版本和依赖。
- ESLint 基线不启用类型感知检查，避免在 pre-commit 中引入 TypeScript 类型检查。

## 0.8.0

- 增加仅面向 Vue 项目的 `repo-guard lighthouse`，使用业务项目本地 `@lhci/cli` 和 `lighthouserc.*`。
- Lighthouse 执行项目 npm 构建脚本后依次运行 `collect` 和 `assert`，支持 `--skip-build`。
- 增加默认关闭的 Lighthouse `pre-push` 门禁、环境诊断和 `.lighthouseci/` 忽略维护。
- 托管 Hook 升级为 v3，兼容识别和升级 v1、v2 Hook。

## 0.7.0

- 增加使用业务项目本地安装和配置的暂存文件 Stylelint 自动修复门禁。
- 固定质量流水线为 Stylelint 修复、ESLint 修复、Prettier、Stylelint 复检、ESLint 复检。
- Stylelint 修复失败或后续门禁失败时恢复整个质量流水线修改，并保留部分暂存文件的未暂存内容。
- `init` 仅在本地 Stylelint 和项目配置都存在时自动启用，不安装依赖、不生成规则、不探测语言组合。
- 同一个 Vue 文件混用多种 `<style lang>` 时直接阻止提交；未修复问题输出编号式中文 AI 修复指令。
- 增加可选 peer dependency `stylelint >=16 <18`，Node.js 最低版本保持 `18.12.0`。

## 0.6.0

- 增加默认开启的项目级 `notification.enabled` 企业微信通知开关。
- 增加 `repo-guard enable notification` 和 `repo-guard disable notification`。
- 通知关闭后仍识别并记录受保护文件，但不校验通知参数、不发送请求且不阻止提交。
- ESLint 无法修复时，为每个问题生成带编号、可单独复制给 AI 的中文修复指令。
- 修复指令包含相对路径、行列、规则、原始错误和禁止绕过规则的约束。

## 0.5.0

- 新项目执行 `init` 时默认启用 ESLint 修复、Prettier 格式化和 9 条通知级保护规则。
- 增加幂等的 `repo-guard migrate`，补齐缺失配置但保留项目规则和显式设置。
- 增加 `repo-guard enable eslint prettier`，显式快速启用暂存质量门禁。
- 增加 `repo-guard doctor --fix`，修复托管 Hook、项目脚本和受管理仓库文件。
- 安装器写入前预检全部 Hook，遇到自定义 Hook 时不再产生部分升级。
- 初始化和修复时增加 `guard:migrate`、`guard:enable-quality` 项目脚本。
- 配置仍使用 `version: 1`，升级包不会使旧项目配置失效。

## 0.4.0

- 增加可配置的暂存文件 Prettier 自动格式化和只检查门禁。
- 统一编排 ESLint 修复、Prettier 格式化和 ESLint 最终复检。
- 使用业务项目本地的 Prettier 3、项目格式规则和忽略文件。
- 增加质量流水线级文件快照，任一步失败时恢复全部修改。
- `doctor` 增加 Prettier 版本和项目配置检查。
- 保持 v1 配置向后兼容，未显式启用 Prettier 的项目行为不变。

## 0.3.0

- 增加可配置的暂存文件 ESLint 自动修复门禁。
- 使用 `lint-staged` 隔离部分暂存文件中的未暂存内容。
- 修复后复检，再执行保护文件识别、指纹和企业微信通知。
- 增加项目本地 ESLint 解析和忽略文件识别。
- Hook 升级为 v2，并兼容自动迁移 v1 托管 Hook。
- `doctor` 增加 ESLint 配置和过期 Hook 检查。
- 不包含 TypeScript 类型检查。

## 0.2.0

- 增加本地 `.env.config` 通知配置模板和泄漏保护。
- 初始化时增量维护 `.gitignore`。

## 0.1.0

- 提供受保护文件规则、企业微信通知、暂存指纹和 Git Hook 安装。
- CI JSON 输出限制在未跟踪、非符号链接的 `reports/**/*.json`，避免报告参数覆盖业务文件。
- GitLab 自动集成采用保守 YAML 识别，并对托管模板和根 Job 执行完整防篡改诊断。
