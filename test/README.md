# 测试组织与执行

测试按被验证的功能职责归属，不再直接放在 `test/` 根目录。相同功能的单元测试和小型集成测试放在一起；只有跨多个模块、验证完整用户流程的测试才放入 `e2e/`。

| 目录 | 维护范围 |
| --- | --- |
| `core/` | 执行计划、结果、进程、Git 事实及测试入口 |
| `config/` | 配置字段、默认值、校验和生命周期契约 |
| `profiles/` | 前端、Node 后端及后续 Java 技术栈预设 |
| `policies/` | 纯规则、AI 指引、例外和交付约定 |
| `gates/repository/` | 文件、目录、依赖、提交信息和受保护内容 |
| `gates/quality/` | 代码规范、类型、架构、资源和构建 |
| `gates/testing/` | 单元测试、覆盖率、变异测试及外部测试适配 |
| `gates/security/` | 通用代码安全规则 |
| `gates/release/` | 交付就绪检查与门禁通知 |
| `integrations/` | 外部工具调用、结果解析与适配 |
| `setup/` | CLI 参数、初始化、启停、迁移和 Doctor |
| `provisioning/` | 工具安装、基础配置准备及就绪验证 |
| `hooks/` | Hook 安装、暂存隔离、并发锁和提交动画 |
| `ci/` | CI 中的质量执行、检查范围和报告 |
| `operations/` | 独立运维配置、流水线、发布和部署 |
| `architecture/` | 源码依赖、模块职责和发布包边界 |
| `docs/` | 文档版本、示例、技能资源和中文输出 |
| `e2e/` | 跨模块完整流程及混合应用场景 |
| `helpers/` | 可复用测试辅助，不自动执行 |
| `fixtures/` | 测试项目、配置和工具报告样例，不自动执行 |
| `.tmp/` | 执行期间生成的临时内容，不提交、不自动执行 |

`integrations/`、`provisioning/`、`e2e/` 是已登记的职责分组，按实际测试需要创建；其中 `provisioning/` 预留给后续工具自动接入功能。尚未创建测试的分组不会在完整运行中伪报通过，显式选择空分组会报错。

新旧配置契约测试统一归属 `config/`，多应用调度归属 `ci/`，运维、Doctor 和 Hook 测试分别归属 `operations/`、`setup/` 和 `hooks/`；不再按版本号另建测试目录。

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
