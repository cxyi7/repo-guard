# Java 检查接入方式与实施建议

当前 `2.0.0` 源码可以通过独立交付合同执行 Java 项目的现有检查命令；Java 工程预设、Doctor 工具检查和 Java 运维适配仍未实现。本文区分当前可用入口与建议的后续实现，不将预留能力视为已支持。

## 当前可用：先让 Java 项目自己完成检查

使用项目已经选择的 Maven 或 Gradle，按照项目生效配置约束 Wrapper、JDK、插件与依赖版本。构建、测试和静态检查由 Java 工具执行，Node 只负责运行 repo-guard 和记录交付结果。不要求统一升级到最新版；运行构建工具的 JDK、编译目标与测试 JVM 应分别按项目约定校验，可以使用 Toolchains 管理。[Gradle Toolchains](https://docs.gradle.org/current/userguide/toolchains.html)、[Maven Enforcer](https://maven.apache.org/enforcer/maven-enforcer-plugin/)

将团队选定的检查绑定到同一个入口：

| 环境 | Maven | Gradle |
|---|---|---|
| Windows PowerShell | `.\mvnw.cmd -B verify` | `.\gradlew.bat --no-daemon check` |
| Linux / macOS | `./mvnw -B verify` | `./gradlew --no-daemon check` |

必须在 `pom.xml` 或 Gradle 构建配置中接入实际检查与失败条件。`verify` / `check` 不会凭命令名自动提供下面全部质量能力；只生成 HTML 报告、跳过测试或把失败忽略，都不能作为团队的通过标准。[Maven 构建生命周期](https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle)、[Gradle 测试与 check](https://docs.gradle.org/current/userguide/java_testing.html)

## 接入当前 repo-guard

以下命令假定 `repo-guard` CLI 已可用。Java 仓库无需创建 `package.json`，也不要执行尚未支持的工程 `init --stack java`。

1. 准备已有 Git 提交、工作分支、JDK 和可执行的项目 Wrapper。在 `.gitignore` 中排除 `target/`、`build/`、`.gradle/` 等生成目录。
2. 按[独立交付合同手册](features/delivery-contract.md#独立交付与跨仓库协作)建立合同。负责人保管验收私钥，检查执行者使用独立的 runner 密钥。

```bash
repo-guard delivery keygen --name reviewer
repo-guard delivery init --id java-quality --participant api --repository api-repo --role backend --reviewer-public-key .repo-guard/reviewer.pub
```

3. 完善生成的 `docs/delivery/java-quality.json`：填写真实需求、验收条件、任务允许路径；在 `participants[].checks` 中声明检查，并让任务的 `checks` 引用它。下面是单个检查对象，不能当作完整合同粘贴：

```json
{
  "id": "java-verify",
  "kind": "command",
  "command": "cmd.exe",
  "args": ["/d", "/s", "/c", "mvnw.cmd -B verify"],
  "timeoutMs": 600000
}
```

| 字段 | 含义与约束 |
|---|---|
| `id` | 本参与方唯一检查标识，任务通过此标识引用检查 |
| `kind` | 当前使用 `command`，不依赖 Java 工程 Gate |
| `command / args` | 在参与方 `root` 执行的程序与字符串参数；Windows Wrapper 需要显式 `cmd.exe`；Linux / macOS 使用 `command: "./mvnw"`、`args: ["-B", "verify"]` |
| `timeoutMs` | 示例为十分钟；合法范围为 `1000～1800000` 毫秒 |

Gradle 可将 Windows 命令替换为 `gradlew.bat --no-daemon check`；Linux / macOS 使用 `command: "./gradlew"` 和对应参数。程序不经过隐式 shell 展开。当前命令检查依据实际进程完成状态判断结果，不会自动解析 Java 静态检查和覆盖率报告，因此应由项目构建配置可靠地阻断质量失败。

4. 重新绑定合同，由负责人审阅并签署，然后提交代码、合同与绑定，保持工作区干净：

```bash
repo-guard delivery bind --contract docs/delivery/java-quality.json --participant api
repo-guard delivery approve --key-file .repo-guard/local/reviewer.pem
```

5. 运行检查，检查结果绑定当前提交和合同指纹，并生成签名证据：

```bash
repo-guard delivery run --participant api --check java-verify
repo-guard delivery status
```

执行前后要求工作区干净且 HEAD 不变。多参与方还需要各方证据与合同要求的联合验证；负责人完成真实验收后才能执行 `delivery accept`，最后用 `delivery verify` 确认完整条件。`status` 成功只代表读到了状态，不等于通过验收。完整命令和密钥边界见[执行、联调与验收](features/delivery-contract.md#执行联调与验收)。

## 建议的 Java 质量基线

第一批可通过项目构建入口接入以下六类硬性检查。规则必须通用、明确且可重复判定，不内置具体业务判断；检查是否启用及其阈值由项目配置声明。当前 repo-guard 只执行命令并记录结果，下表中的规则需要由消费项目的工具与失败条件落实，不代表已经原生支持 Java。

| 层面 | 建议规范与检查 | 工具依据 |
|---|---|---|
| 编译与构建 | 生产代码与测试代码是否通过编译，打包任务是否成功，项目声明的必需产物是否生成；产物校验需配置到项目检查入口 | [Maven 构建生命周期](https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle) |
| 代码格式 | 缩进、空格、换行、花括号与导入顺序是否符合项目选定的格式；检查失败应使构建失败 | [Spotless](https://github.com/diffplug/spotless) |
| 明确的源码规范 | 按配置检查命名模式、禁止或重复导入及 Javadoc 结构；不判断名称和文档是否符合业务含义 | [Checkstyle](https://checkstyle.org/checks.html) |
| 依赖与环境约束 | 按项目生效配置与实际解析结果校验 JDK、Wrapper、插件、依赖版本和明确声明的冲突或禁止依赖规则；不默认要求最新版本 | [Maven Enforcer](https://maven.apache.org/enforcer/maven-enforcer-plugin/)、[Gradle Toolchains](https://docs.gradle.org/current/userguide/toolchains.html) |
| 已有测试结果 | 执行项目声明的必需单元、集成、契约或端到端测试，阻断测试失败；测试由项目或 AI 提供，repo-guard 不生成测试、不推断业务预期 | [JUnit](https://docs.junit.org/current/user-guide/)、[Gradle 测试](https://docs.gradle.org/current/userguide/java_testing.html) |
| 测试执行完整性 | 核验必需套件实际运行、零测试或全部跳过、本次报告缺失或损坏；需要项目端验证器或后续 Java 报告适配 | [Surefire 配置](https://maven.apache.org/surefire/maven-surefire-plugin/test-mojo.html)、[Gradle 测试](https://docs.gradle.org/current/userguide/java_testing.html) |

测试命令返回成功不能单独证明必需测试已经执行。零测试、跳过、过滤范围错误、忽略失败和旧报告都可能造成假通过。若项目要求验证本次实际执行，应在项目端配置失败条件或提供验证器，核对必需套件、实际执行数量及本次报告；当前 repo-guard 不自动完成这些报告检查。缓存与增量结果也不能冒充本次实际执行的证据。原生报告适配属于后续实现。

覆盖率可作为项目主动启用的门禁：使用 JaCoCo 明确生产代码范围、排除项及行或分支阈值，并让检查失败使构建失败。覆盖率只能证明执行范围，不能证明断言有效或业务正确。[JaCoCo](https://www.jacoco.org/jacoco/trunk/doc/check-mojo.html)

文件与方法规模、参数数量、嵌套深度、复杂度、重复代码和架构依赖也可以按项目声明的范围与阈值阻断，不设置适用于所有项目的统一门槛。

静态缺陷分析、架构依赖、变异测试与漏洞扫描按需单独配置。SpotBugs 等推断型告警应选择经过确认的规则；ArchUnit 只校验项目声明的边界，不强制固定业务分层；PIT 提供测试检错能力证据，存活变异可能与原程序等价；漏洞结果还受数据库更新与组件匹配影响。这些能力不默认全量阻断，也不能保证 AI 生成的测试预期正确。[SpotBugs](https://spotbugs.readthedocs.io/en/latest/introduction.html)、[ArchUnit](https://www.archunit.org/)、[PIT](https://pitest.org/)、[OWASP Dependency-Check](https://dependency-check.github.io/DependencyCheck/)

具体业务行为只由项目测试的断言验证。门禁不根据方法名、注释或代码推测权限、金额、事务等业务规则，也不以断言数量判断测试是否有效。

建议在编辑器和显式命令中格式化；提交前只做能保持暂存隔离的轻量检查。推送或 CI 执行已配置的编译、规范、测试、构建与可选门禁。变异测试、较重的漏洞扫描和压测按成本单独安排，不在 Hook 中运行全项目修复。

## 后续原生适配需要补齐什么

| 位置 | 应实现内容 |
|---|---|
| `profiles` | 明确 Maven / Gradle 身份，完成对应验收后再标记为支持 |
| `config` 与 Schema | Java 源码与测试目录、JDK、Wrapper、检查和报告配置；不套用 Node 默认工具 |
| `integrations/java` | 调用消费项目 Wrapper，处理 Windows / Linux 入口，解析静态检查、测试和覆盖率报告 |
| Gate、Registry 与结果 | 对接统一能力，输出中文问题、位置、修复建议和独立原始诊断；区分违规、启动/超时错误及报告异常 |
| Doctor 与执行计划 | 验证 JDK、Wrapper 和已启用插件是否就绪；按明确支持的能力加入手动、推送和 CI，保持提交阶段的暂存约束 |
| 运维 | 若需要 Java 发布，另加 Java 构建产物与部署适配；当前 Node 运维提供方不能直接视作 Java 支持 |
| 回归与验收 | 使用真实 Maven / Gradle 单模块和多模块项目，验证缺 JDK、测试失败、报告缺失/损坏、超时、零测试或跳过测试策略，以及 Vue＋Java 工作区隔离 |

原生适配应复用现有调度、退出码、进程清理和交付证据，不再复制另一套 Hook 或 CI 引擎。自动安装工具属于独立准备流程，日常检查不能顺便升级依赖。
