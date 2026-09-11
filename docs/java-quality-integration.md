# Java 工程检查接入

适用于当前 `2.0.0` 源码。Java Maven 应用使用独立预设和 18 个可配置检查，仍由 Node 运行 repo-guard、JDK 与项目工具执行 Java 检查。Gradle 工程预设与 Java 运维部署尚未接入。

## 使用方式

同仓时为 Java 应用登记独立目录，例如 `apps/api`；前端与 Java 各自保存配置、工具及规则。分仓时各自初始化。应用目录不能重叠，不要求统一前后端的开发者、框架或构建工具。

CLI 已在环境中可用时，在纯 Java Git 仓库执行：

```bash
repo-guard init --project api --role backend --stack java --preset java-maven
repo-guard doctor
```

Java 仓库无需创建 `package.json`。如果使用本地 npm 安装，也可以通过 `npx repo-guard` 执行。初始化不下载 JDK、Maven、Checkstyle、PMD 或格式化工具，不替项目修改 Maven 插件与测试配置。

18 项 Java 检查默认关闭。先准备相应工具并填写配置，再启用检查；配置字段、可填值、约束与例子分别维护在以下文档：

| 检查 | 说明 |
|---|---|
| `javaFormat`、`javaNaming`、`javaLayout`、`javaImports`、`javaSize`、`javaDocs`、`javaLint`、`javaDuplication` | [Java 源码检查](features/java-source-checks.md) |
| `javaArchitecture`、`javaDependencies`、`javaFiles`、`javaCompile`、`javaBuild`、`javaTest`、`javaCoverage` | [Java 工程验证](features/java-engineering.md) |
| `javaPathNaming` | [Java 文件与目录命名](features/java-path-naming.md)：文件大驼峰、包目录小写、按目录要求文件后缀 |
| `javaSpotbugs` | [SpotBugs 字节码检查](features/java-spotbugs.md)：原生缺陷报告与团队优先级 |
| `javaMutationTest` | [PIT 变异测试](features/java-mutation-test.md)：原始测试、变异结果与逐模块得分 |

准备好配置后，可单独验证，例如：

```bash
repo-guard java-format
repo-guard java-test
# 在根配置启用 CI，再按应用执行
repo-guard enable ci
# 同仓项目通过应用标识选择本方
repo-guard ci --project api --profile full
```

这些 Java 专项命令遵守各自开关；关闭状态会明确记录跳过。检查结果和中文诊断复用统一结果模型，错误不会被隐藏成通过。

## 执行阶段与隔离

| 阶段 | Java 检查范围 |
|---|---|
| 提交 | 暂存 Java 格式修复与只读复核、命名、包路径、导入、规模、文档、静态问题、工程文件、路径命名与文件归位 |
| 推送 | 只读源码、路径命名、工程文件、重复代码、依赖、架构、编译、SpotBugs、测试、覆盖率、PIT 与打包 |
| CI policy | 工程文件、路径命名、文件归位与适用的公共仓库策略 |
| CI full / release-ready | 默认继承已启用的全部 Java 检查；release-ready 还复核交付证据 |
| 手动 | 运行明确选择且已启用的专项检查 |

Java 格式修复复用现有 lint-staged 事务，保留部分暂存和未暂存内容。编译、测试、SpotBugs、PIT 与打包不会塞进 pre-commit。每个应用只读取本方配置与工具，不使用前端 ESLint、Vitest 或 npm 依赖策略替 Java 作判断。CI 的 `inherit` 遵循检查开关；`report` / `enforce` 可临时激活适用的检查，仍要求工具及完整配置，前者只报告、后者阻断；`off` 跳过。

## 目录、命名与保护文件

三类规则分别解决“文件放哪里”“文件叫什么”“哪些文件不得变更”，均保存在本方应用配置中，不继承前端的规则。以下片段合并到已初始化的 Java 配置；数组整体替换，团队既有规则应一起保留：

```json
{
  "checks": {
    "javaFiles": { "enabled": true },
    "javaPathNaming": { "enabled": true },
    "filePlacement": {
      "enabled": true,
      "mode": "changedFiles",
      "rules": [
        {
          "name": "Java 测试文件",
          "patterns": ["**/*Test.java"],
          "allowedPatterns": ["**/src/test/java/**"],
          "exceptions": [],
          "suggestedDirectory": "src/test/java"
        },
        {
          "name": "Java 源文件",
          "patterns": ["**/*.java"],
          "allowedPatterns": ["**/src/main/java/**", "**/src/test/java/**"],
          "exceptions": [],
          "suggestedDirectory": "src/main/java"
        }
      ]
    }
  },
  "repository": {
    "rules": [
      { "pattern": "pom.xml", "category": "构建与依赖配置", "level": "block" },
      { "pattern": "repo-guard.config.json", "category": "团队工程规则", "level": "block" }
    ],
    "exclusions": []
  }
}
```

| 字段 | 含义、可填值与要求 |
|---|---|
| `javaFiles.enabled` | 布尔值，默认 `false`；开启后按默认源码根目录与禁止产物规则检查完整 Git 索引 |
| `javaPathNaming.enabled` | 布尔值，默认 `false`；开启后默认检查标准源码目录内 Java 文件的大驼峰与包目录的小写，描述符文件有明确例外 |
| `filePlacement.enabled` / `mode` | Java 默认关闭；模式为 `newFiles` 或 `changedFiles`，后者覆盖选中变更中的全部非删除文件 |
| `rules[].name` / `patterns` | 规则名称和非空文件匹配数组；第一条匹配规则生效，因此测试文件规则放在通用 Java 规则之前 |
| `allowedPatterns` / `exceptions` | 非空允许路径数组和可为空的例外数组，均相对应用根目录；`**` 可覆盖单模块及多模块 |
| `suggestedDirectory` | 失败时建议的目录，不自动移动文件；多模块项目按实际所属模块修正提示路径 |
| `repository.rules[].pattern` / `category` / `level` | 保护路径、中文类别与级别；`audit` 审计、`notify` 按通知设置处理、`block` 阻断匹配的新增、修改、删除或移动 |
| `repository.exclusions` | 保护排除数组，优先于保护规则；示例为空，没有排除项 |

配置文件名如在多应用清单中改成 `repo-guard.project.json`，保护路径也应改为实际文件名。配置治理需要明确的团队评审流程，不要把整个源码目录全部设为 `block`。按目录指定 `*Controller.java`、`*Service.java` 等名称的规则及全部字段见 [Java 路径命名](features/java-path-naming.md)；无需强制所有 Java 项目采用这些分层名称。

```bash
repo-guard doctor --fix
repo-guard java-files
repo-guard java-path-naming
repo-guard file-placement
repo-guard dry-run
```

`java-files` 和 `java-path-naming` 检查完整 Git 索引；新文件暂存后进入检查，删除后退出范围。`file-placement` 手动入口审计工作区，自动入口按相应 Git 变更范围；`dry-run` 仅预览保护判断。多应用给上述应用命令添加 `--project api`，保护流程则由仓库入口汇总本次各应用变更。

必需模块、产物、测试类及报告必须按项目明确声明。工具缺失、进程异常、报告缺失或损坏属于配置/执行错误；实际检测到违反规则属于违规。测试命令返回成功不等于测试已实际执行，零执行、全部跳过和旧报告不能充当本次证据。统一语义见[结果与退出码](features/gate-result-and-reporting.md)。

## 模块边界

需要约束整个仓库的 SQL 或配置文件时，另在根 `repo-guard.config.json` 配置 `repository.filePlacement`。例如使用 `patterns: ["**/*.sql"]` 和 `allowedPatterns: ["database/sql/**"]`，即可限制前端、Java 后端及公共目录的 SQL 位置。它与 Java 应用自己的规则独立，应用开关和例外不能放宽根规则；完整字段说明及配置见[仓库级文件归位](features/repository-file-placement.md)。

本项在提交前读取完整 Git 索引，在推送和 CI 读取目标提交完整文件树，不只检查变更文件。手动执行 `repo-guard repository-file-placement` 会审计工作区，包含未忽略的新文件。无需 JDK 或 Maven，其他技术栈也可使用。

```mermaid
flowchart LR
  A[本应用 v2 配置] --> B[独立 Java Gate]
  B --> C[Java 工具适配器]
  C --> D[原生报告与工程事实]
  D --> E[独立规则判定]
  E --> F[统一 GateResult]
  F --> G[手动 / Hook / CI / 交付]
```

`config` 校验字段，`integrations/java` 调用工具并解析事实，`policies/java` 判断规则，`gates/java` 返回统一结果，`orchestration` 决定执行阶段。源码、路径命名、SpotBugs 与 PIT 分别维护；工具适配复用 Maven 进程、文件边界和 XML 读取基础设施，不互相调用对方的 Gate，也不以另一个开关的结果代替本次检查。路径命名仅需要 Git 索引，不启动 Java 工具。

## 团队仍需明确的内容

- 项目使用的 JDK 与编译目标、Maven 及插件版本；不统一强迫升级最新版。
- 架构测试中的包边界和禁止依赖规则；测试名称不能自动推导团队架构。
- 必需模块、测试范围、构建产物、覆盖率阈值及允许排除的范围。
- CI Runner 中的 Node、JDK 与工具环境；本轮不改造 Java 部署流水线。

检查内容限定通用工程规则，不判断接口输入输出、身份权限或业务语义。PIT 能检验测试对指定变异的检测能力，但不证明测试覆盖全部真实业务要求。工具安装、项目适配与基础配置由后续 Skill 负责。

Java、Node、Python 仍可共同使用[独立交付合同](features/delivery-contract.md#独立交付与跨仓库协作)。合同本身不依赖某个技术栈，记录各方任务、实际检查、签名证据、联合验证和人工验收。

功能是否完成、是否符合统一规范，以及消费项目还需验证哪些负面场景，见 [Java 工程检查验收清单](java-check-acceptance.md)。它逐项列出 18 个开关的测试位置，并区分源码回归、原生工具证据与项目现场验收。
