# 测试组织与执行

测试按被验证的功能职责归属，不再直接放在 `test/` 根目录。相同功能的单元测试和小型集成测试放在一起；只有跨多个模块、验证完整用户流程的测试才放入 `e2e/`。

| 目录 | 维护范围 |
| --- | --- |
| `core/` | 执行计划、结果、进程、Git 事实、完整仓库路径清单及测试入口 |
| `config/` | 配置字段、默认值、校验和生命周期契约；包括根与子应用配置边界 |
| `profiles/` | 前端、Node 后端与 Java Maven 技术栈预设 |
| `policies/` | 纯规则、AI 指引、例外和交付约定 |
| `gates/repository/` | 仓库级与应用级文件归位、目录、依赖、提交信息和受保护内容 |
| `gates/quality/` | 代码规范、类型、架构、资源和构建 |
| `gates/testing/` | 单元测试、覆盖率、变异测试及外部测试适配 |
| `gates/security/` | 通用代码安全规则 |
| `gates/release/` | 交付就绪检查与门禁通知 |
| `gates/java/` | Java 源码规范与工程验证的 Gate 行为；多模块问题身份、证据与修复指引，以及空输出失败的最终进程诊断 |
| `policies/java/` | Java 路径命名的目录、文件与后缀组合规则 |
| `integrations/java/engineering/` | 共享 Maven 进程、隐式参数预检、模块边界、原生工程证据 |
| `integrations/java/spotbugs/`、`integrations/java/mutation/` | SpotBugs/PIT 原生报告、受控 Maven 执行、边界与真实工具回归 |
| `integrations/` | 外部工具调用、结果解析与适配 |
| `integrations/java/` | Java 工具、XML 报告、快照和异常处理 |
| `setup/` | CLI 参数、初始化、启停和 Doctor |
| `provisioning/` | 工具安装、基础配置准备及就绪验证 |
| `hooks/` | Hook 安装、暂存隔离、并发锁、提交动画与跨入口全仓检查 |
| `ci/` | CI 中的质量执行、检查范围和报告 |
| `operations/` | 独立运维配置、流水线、发布和部署 |
| `architecture/` | 源码依赖、模块职责和发布包边界 |
| `docs/` | 文档版本、示例、技能资源和中文输出 |
| `e2e/` | 跨模块完整流程及混合应用场景 |
| `helpers/` | 可复用测试辅助，不自动执行 |
| `fixtures/` | 测试项目、配置和工具报告样例，不自动执行 |
| `.tmp/` | 执行期间生成的临时内容，不提交、不自动执行 |

`integrations/`、`provisioning/`、`e2e/` 是已登记的职责分组，按实际测试需要创建；其中 `provisioning/` 预留给后续工具自动接入功能。尚未创建测试的分组不会在完整运行中伪报通过，显式选择空分组会报错。

配置契约测试统一归属 `config/`，多应用调度归属 `ci/`，运维、Doctor 和 Hook 测试分别归属 `operations/`、`setup/` 和 `hooks/`；不按版本号另建测试目录。

所有常规项目夹具直接使用 `version: 2` 的 `project / checks / repository / reporting / ci` 契约。`helpers/project-config.js` 仅负责补齐 v2 默认值、剥离编译后的路径匹配器并序列化；读回断言直接检查真实 v2 文档。repo-guard 自有的登记表、Skill 清单、UI Token、基线和报告均使用当前 v2，Hook 只接受当前 v5，AGENTS 只接受当前职责区块。旧输入仅作为拒绝且原文件不变的反例，不测试旧结构转换；同时覆盖 CLI 在任何配置或托管文件写入前完成格式预检。第三方 Stryker/k6 原生报告、Git 输出及摘要算法仍按其自身规范构造，不能只修改数字伪造协议。

## 仓库级文件归位的验证范围

根 `repository.filePlacement` 的开关名为 `repositoryFilePlacement`，Gate ID 为 `repository.global-file-placement`。它与应用 `checks.filePlacement` 独立：全仓公共检查执行一次，子应用不继承、不能覆盖，也不能通过应用例外放行。字段和运行说明见[仓库级文件归位](../docs/features/repository-file-placement.md)。

| 测试 | 核心边界 |
|---|---|
| [配置与启停](config/repository-file-placement.test.js) | 默认关闭、开启须有规则、拒绝空值/未知字段、公共 Schema、禁止子配置、启停保留子文件原字节 |
| [Git 路径事实](core/repository-file-paths.test.js) | 提交读取完整索引；推送/CI 读取可信 head 的完整提交树；手动读取实际存在的受控与未忽略文件；排除 gitlink、拒绝冲突与不完整清单 |
| [Gate 适配](gates/repository/global-file-placement.test.js) | 复用第一匹配规则、输出违规位置和建议目录、隔离应用豁免、保留范围及执行错误 |
| [真实 CLI/Hook](hooks/repository-file-placement.test.js) | 从子目录或选择应用也不缩小全仓范围；根规则与应用规则分别执行；公共退出码跨入口保持一致 |
| [配置架构](architecture/architecture-config-boundaries.test.js) | 根配置独立归一化，仅复用规则结构，不依赖 Git、工具或编排层 |

Java 的报告解析测试和实际工具执行测试分别维护；原生版本、通过/失败场景及仍需验证的条件见 [Java 检查验收记录](../docs/java-check-acceptance.md)。没有运行原生工具的夹具测试不能替代原生验收证据。

## 执行方式

```sh
# 完整测试，限制并发可减轻 Windows 集成测试的资源争用
npm test -- --test-concurrency=4

# 一个或多个功能组
npm test -- --suite=config,core --test-concurrency=4
npm test -- --suite=gates/testing --test-concurrency=4

# 按测试名称筛选；参数由 Node 处理
npm test -- --suite=hooks --test-name-pattern="提交动画"

# 仅列出将执行的测试文件
npm test -- --list
```

统一入口为 `scripts/run-tests.mjs`。它固定在仓库根目录执行，只从已登记的目录收集 `*.test.js`，不依赖 shell 通配符；排除隐藏目录、`fixtures`、`helpers`、`node_modules` 和符号链接。测试失败、无法启动或没有找到测试均返回非零退出码，避免 CI 将空测试误认为成功。

新增功能优先使用现有职责目录。新增顶层测试组时，必须同步登记 `TEST_SUITES`，并补充本说明。样例里的测试不能依靠自动发现执行，应由相应集成测试明确调用。
