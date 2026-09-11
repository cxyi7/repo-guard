# Java 工程检查

Java 工程检查通过独立的工具采集、原生报告解析、策略判断和门禁入口实现。当前支持显式声明的 Maven 项目；Gradle 不在本轮支持范围。所有检查默认关闭，不自动安装 Maven、插件或规则，不修改消费项目配置，也不检查业务逻辑。

违规报告保留模块、报告或文件位置、观测证据、预期与修复步骤。测试问题包含失败/跳过用例的类名及名称；文件问题说明命中的禁止模式或允许源码目录；覆盖率与依赖问题说明具体维度或坐标。`ruleId` 保持固定，模块名及规则对象作为 `code` 的编码后缀，由公共机制生成稳定问题标识，避免不同模块或同一报告内不同问题相互混淆。`modules[].name` 应保持稳定，变更名称会改变问题标识。

Maven 原始退出码、超时和信号独立保留在 `diagnostics`，包括工具没有输出的情况；它们不直接成为 repo-guard 退出码。修复后按问题中的命令重新运行检查，不编辑原生报告或降低门槛。

| 配置               | 命令                           | 检查证据                                                            |
| ------------------ | ------------------------------ | ------------------------------------------------------------------- |
| `javaArchitecture` | `repo-guard java-architecture` | 现有架构测试的 JUnit XML，逐模块验证 `requiredTestClasses` 实际执行 |
| `javaDependencies` | `repo-guard java-dependencies` | Maven 有效 POM、解析后的 JSON 依赖树、指定 Enforcer 执行            |
| `javaFiles`        | `repo-guard java-files`        | Git 路径与显式允许的源码目录、禁止提交路径                          |
| `javaCompile`      | `repo-guard java-compile`      | 本次编译生成的指定 `.class` 文件及编译结果                          |
| `javaBuild`        | `repo-guard java-build`        | 本次打包生成的指定 `.jar`、`.war` 或 `.ear` 产物                    |
| `javaTest`         | `repo-guard java-test`         | 本次 JUnit XML 的实际测试用例和失败状态                             |
| `javaCoverage`     | `repo-guard java-coverage`     | 本次 JUnit XML、JaCoCo XML 与执行会话，逐模块判断覆盖率             |

除文件检查外，工程检查只运行于手动、可选 pre-push、CI 完整检查及发布准备阶段。文件检查也可进入 pre-commit 和 CI 策略检查。文件门禁不读取或分析 Java 语义，不要求所有项目使用 Controller、Service、Repository 分层。

## 显式配置

以下为单个 Maven 项目的配置示例，保存到项目根目录 `repo-guard.config.json`。模块路径及报告路径相对于当前项目根目录；所有报告和产物必须逐项填写具体路径，不接受通配符。`modules` 是本项目必须交付的模块清单，聚合 POM 本身可不作为产物模块，不能省略实际需要检查的子模块。

```json
{
  "version": 2,
  "project": {
    "id": "java-app",
    "role": "backend",
    "stack": "java",
    "preset": "java-maven"
  },
  "checks": {
    "javaCompile": {
      "enabled": true,
      "modules": [
        {
          "name": "app",
          "directory": ".",
          "outputs": ["target/classes/example/App.class"]
        }
      ]
    },
    "javaBuild": {
      "enabled": true,
      "modules": [{ "name": "app", "outputs": ["target/app-1.0.0.jar"] }]
    },
    "javaTest": {
      "enabled": true,
      "modules": [
        {
          "name": "app",
          "reports": ["target/surefire-reports/TEST-example.AppTest.xml"]
        }
      ]
    },
    "javaCoverage": {
      "enabled": true,
      "thresholds": { "line": 80, "branch": 80, "instruction": 80 },
      "modules": [
        {
          "name": "app",
          "reports": ["target/surefire-reports/TEST-example.AppTest.xml"],
          "coverageReport": "target/site/jacoco/jacoco.xml"
        }
      ]
    },
    "javaArchitecture": {
      "enabled": true,
      "modules": [
        {
          "name": "app",
          "reports": [
            "target/surefire-reports/TEST-example.ArchitectureTest.xml"
          ],
          "requiredTestClasses": ["example.ArchitectureTest"]
        }
      ]
    },
    "javaDependencies": {
      "enabled": true,
      "enforcerExecution": "enforce-dependencies",
      "requiredEnforcerRules": ["dependencyConvergence"],
      "banSnapshots": true,
      "bannedDependencies": ["example:forbidden:*"],
      "modules": [
        {
          "name": "app",
          "directory": ".",
          "effectivePom": "target/repo-guard-effective-pom.xml",
          "dependencyTree": "target/repo-guard-dependencies.json"
        }
      ]
    },
    "javaFiles": {
      "enabled": true,
      "forbidden": ["**/target/**", "**/*.class", "**/*.jar"],
      "allowedJavaRoots": [
        "src/main/java/**",
        "src/test/java/**",
        "**/src/main/java/**",
        "**/src/test/java/**"
      ]
    }
  }
}
```

示例字段及未展开的公共选项说明如下。表中“必填”表示对应检查启用后必须显式提供；默认关闭状态下可以保留空模块清单。

| 字段                                     | 含义、可填值及约束                                                                                                                                                                                                       | 默认值                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `version`                                | 当前配置格式，只能填写整数 `2`                                                                                                                                                                                           | 必填                                         |
| `project.id`                             | 项目标识，小写英文开头，后接小写英文、数字或连字符                                                                                                                                                                       | 必填                                         |
| `project.role`                           | 该 Java 项目角色，填写 `backend`                                                                                                                                                                                         | 必填                                         |
| `project.stack`                          | 技术栈，填写 `java`                                                                                                                                                                                                      | 必填                                         |
| `project.preset`                         | 工程方案，填写 `java-maven`                                                                                                                                                                                              | 必填                                         |
| 各项 `enabled`                           | 是否启用当前检查，布尔值；CI 强制启用仍必须满足该项必填配置                                                                                                                                                              | `false`                                      |
| 公共 `executable`                        | 已准备好的 Maven 程序名称或路径；不支持 Wrapper，不接受命令拼接字符                                                                                                                                                      | `mvn`                                        |
| 公共 `pom`                               | 当前项目内实际 Maven POM 相对路径，不能使用通配符或越界路径                                                                                                                                                              | `pom.xml`                                    |
| 公共 `timeoutMs`                         | 执行时限，整数，范围为 `1` 到 `2147483647` 毫秒                                                                                                                                                                          | `180000`                                     |
| 公共 `offline`                           | 是否要求离线执行，布尔值；缺少已缓存依赖时返回执行错误                                                                                                                                                                   | `true`                                       |
| 公共 `arguments`                         | 额外 profile 或普通属性，例如 `-Pquality`；不接受生命周期、跳过或报告重定向参数                                                                                                                                          | `[]`                                         |
| 公共 `modules`                           | 必需模块对象数组；每个模块必须有独立名称、独立目录和独立证据路径                                                                                                                                                         | 关闭时 `[]`，启用时必填                      |
| `modules[].name`                         | 非空模块名称，用于结果归属，同一检查中不能重复                                                                                                                                                                           | 必填                                         |
| `modules[].directory`                    | 模块目录，相对当前项目根目录；子模块内必须存在 `pom.xml`                                                                                                                                                                 | `.`                                          |
| `modules[].outputs`                      | 编译填实际 `.class` 文件清单，构建填实际 `.jar`、`.war` 或 `.ear` 文件清单；必须位于所属模块                                                                                                                             | 编译与构建必填                               |
| `modules[].reports`                      | 实际 JUnit XML 文件清单，包含该模块的所有必需套件；不能跨模块复用、使用通配符或引用旧报告                                                                                                                                | 架构、测试与覆盖率必填                       |
| `modules[].requiredTestClasses`          | 必须实际执行的架构测试完整类名字符串数组，按精确类名匹配；必须对应项目已经维护的架构规则                                                                                                                                 | 架构必填                                     |
| `modules[].effectivePom`                 | 当前模块的有效 POM 输出路径，必须为所属模块 `target/` 或 `reports/` 内的 `.xml` 文件                                                                                                                                     | 依赖必填                                     |
| `modules[].dependencyTree`               | 当前模块解析后的依赖树输出路径，必须为所属模块 `target/` 或 `reports/` 内的 `.json` 文件                                                                                                                                 | 依赖必填                                     |
| `modules[].coverageReport`               | 当前模块的 JaCoCo XML 具体路径，必须包含当前运行的执行会话和生产类数据                                                                                                                                                   | 覆盖率必填                                   |
| `javaDependencies.enforcerExecution`     | 项目已有的 Enforcer 执行标识，只能含英文、数字、下划线、点或连字符                                                                                                                                                       | 关闭时空字符串，启用时必填                   |
| `javaDependencies.requiredEnforcerRules` | 必需规则非空数组；可填 `dependencyConvergence`、`requireUpperBoundDeps`、`banDuplicatePomDependencyVersions`、`bannedDependencies`、`requireReleaseDeps`、`requirePluginVersions`、`bannedPlugins`、`banDynamicVersions` | `["dependencyConvergence"]`                  |
| `javaDependencies.banSnapshots`          | 是否禁止解析后的依赖使用 `-SNAPSHOT` 版本，布尔值                                                                                                                                                                        | `true`                                       |
| `javaDependencies.bannedDependencies`    | 禁止的 `groupId:artifactId:version` 模式数组，支持 glob；空数组表示不增加坐标禁用规则                                                                                                                                    | `[]`                                         |
| `javaCoverage.thresholds.line`           | 每模块最低行覆盖率，数字，范围 `0` 到 `100`                                                                                                                                                                              | `80`                                         |
| `javaCoverage.thresholds.branch`         | 每模块最低分支覆盖率，数字，范围 `0` 到 `100`；没有分支时按 `100` 计算                                                                                                                                                   | `80`                                         |
| `javaCoverage.thresholds.instruction`    | 每模块最低指令覆盖率，数字，范围 `0` 到 `100`                                                                                                                                                                            | `80`                                         |
| `javaFiles.forbidden`                    | 禁止进入 Git 的相对路径 glob 数组，空数组表示无额外禁止路径                                                                                                                                                              | `["**/target/**", "**/*.class", "**/*.jar"]` |
| `javaFiles.allowedJavaRoots`             | 允许 `.java` 源文件出现的相对路径 glob 非空数组，按完整路径匹配                                                                                                                                                          | 示例中的四项 Maven 源码模式                  |

Maven 检查共有 `executable`（默认 `mvn`）、`pom`（默认 `pom.xml`）、`timeoutMs`（默认 180000，上限 2147483647）、`offline`（默认 `true`）、`arguments`（默认空数组）。`executable` 仅支持已准备好的 Maven 可执行程序。本轮拒绝 `mvnw`、`mvnw.cmd` 和 `mvnw.bat`，因为 Wrapper 启动阶段可能在 Maven 离线参数生效前下载发行版；不会把用户指定的 Wrapper 静默换成全局 Maven。使用 Wrapper 管理版本的项目应预先准备对应版本 Maven，并显式配置它的路径。离线模式缺少缓存依赖或插件时报告执行错误；需要联网解析时由项目明确设置 `offline: false`。`arguments` 仅用于显式 profile 和普通属性，禁止跳过测试、重定向报告或缩小 Maven 反应堆范围。

## 隐式参数与启动环境

所有使用 Maven 的 Java 工程门禁，包括 SpotBugs 与 PIT，统一在准备检查和每次启动进程前核验隐式参数。Maven 会从本次 `-f` 指定的 POM 所在目录逐级向文件系统根查找最近的 `.mvn`；祖先目录即使在当前应用之外，也可能影响运行，因此同样纳入检查。

| 隐式入口 | 当前约束 |
| --- | --- |
| 生效的 `.mvn/maven.config` | 仅允许空白和 Maven 3.9 风格整行注释；实际参数必须迁入相应门禁允许的显式 `arguments`，禁止隐藏跳过、筛选或其他执行目标 |
| 生效的 `.mvn/jvm.config` | 只允许下述严格资源参数，禁止系统属性、Java Agent、参数文件和命令拼接 |
| `MAVEN_OPTS`、`MAVEN_DEBUG_OPTS`、`JVM_CONFIG_MAVEN_PROPS`、`JAVA_TOOL_OPTIONS`、`_JAVA_OPTIONS`、`JDK_JAVA_OPTIONS` | 只允许下述严格资源参数，其余值返回配置错误 |
| `MAVEN_ARGS`、`MAVEN_CONFIG`、`MAVEN_BASEDIR`、`MAVEN_PROJECTBASEDIR`、`MAVEN_EXT_CLASS_PATH`、`JDK_JAVAC_OPTIONS`、`MAVEN_BATCH_PAUSE` | 必须为空，避免隐式选项、配置根重定向、扩展或交互暂停影响检查 |
| Maven RC 启动脚本 | 工程检查通过 Maven 官方 `MAVEN_SKIP_RC=1` 禁用 RC；若现有 RC 非空且调用环境没有明确设置该变量，先返回配置错误，避免静默丢弃原有环境配置 |

允许的资源参数为 `-Xms`、`-Xmx`、`-Xss`、`-XX:MaxMetaspaceSize=`、`-XX:MetaspaceSize=`、`-XX:ReservedCodeCacheSize=`，后接正整数，可加 `k`、`m`、`g` 单位（大小写均可），多个参数以空白分隔。例如 `-Xms64m -Xmx512m -Xss1m`。不接受引号、`@参数文件`、任意 `-D` 属性或其他 JVM 选项；repo-guard 不会替用户删除这些配置后继续运行。

隐式文件必须是大小不超过 64 KiB 的普通 UTF-8 文件，不能经过 `.mvn` 符号链接或使用配置文件符号链接。显式 `arguments` 也不能设置 Maven 配置根、扩展路径、用户目录和有效 POM 的 `artifact` 等启动或采集控制属性。遇到配置错误时，先按提示整理对应入口，保留所需规则，然后重新运行原命令。

这是防止常见隐藏参数改变检查范围的边界，不是执行任意构建插件的安全沙箱；JDK、Maven 安装、项目插件与扩展仍由团队准备和审查。入口行为核对 [Maven 官方配置说明](https://maven.apache.org/configure.html)及 Maven 3.9.11 的官方启动脚本。

## 执行与报告边界

编译执行 `clean test-compile`，同时编译生产和测试代码；构建执行 `clean package`，架构、测试及覆盖率执行 `clean verify`。这些生命周期会使用消费项目现有 Maven 插件及其配置，也会运行项目声明的其他生命周期任务。`clean` 由消费项目现有清理配置执行；启用前应确保该配置只清理本项目构建产物，不包含业务文件。repo-guard 不直接删除消费项目文件。必需 `.class` 和归档文件用于验证实际交付输出，不等同于检查每个源文件或归档内部的业务正确性。

启动 Maven 前会预检入口、必需模块及 POM 中声明的子模块，包括全部 profile 的模块声明。模块必须位于当前应用内且不能经过符号链接；本轮不解析动态模块路径，单份 POM 上限为 2 MiB，最多读取 256 份。声明式 `build.directory`、`outputDirectory`、`testOutputDirectory` 与 `reporting.outputDirectory` 必须位于应用内，不能指向应用根目录；支持基于 `basedir`、`project.basedir`、`pom.basedir` 和 `project.build.directory` 的已知输出表达式，其他未解析表达式会明确阻断。

模块与输出路径禁止进入 `.git` 元数据目录。同应用内可读取的本地父 POM 会按子模块目录重新解析继承的输出路径，包含父子 profile 的保守候选组合；循环父 POM 或超过 1024 个候选组合会阻断。输出及清理目录还会与本应用 Git 索引核对：报告、产物或清理目录内存在已跟踪文件时，启动前返回配置错误并保留原文件。这是声明式路径预检，不是 Maven 进程的文件系统沙箱；远程或应用外父 POM、插件自定义文件操作和额外清理集合仍须由团队审查，不能把检查器的应用选择机制当作任意构建代码的隔离环境。

依赖检查按必需模块执行 `clean help:effective-pom`、`dependency:tree` 和 `enforcer:enforce@<执行标识>`。项目必须已有固定版本的 Enforcer 配置、指定执行和必需规则，dependency 插件必须支持 JSON 输出。依赖输出仅可写入所属模块 `target/` 或 `reports/` 的 XML/JSON 文件。有效 POM 与依赖树坐标必须一致；检查不使用源码 POM 推测继承、profile 或传递依赖。所支持的八项规则见字段表，插件版本、禁止插件和动态版本策略分别使用项目已有的 `requirePluginVersions`、`bannedPlugins`、`banDynamicVersions` 配置，规则具体参数由消费项目维护。仅对解析后的依赖树检查快照或禁用坐标时，不声明禁止所有原始版本范围。

插件与动态版本规则已核对 Apache Maven 的 [requirePluginVersions 文档](https://maven.apache.org/enforcer/enforcer-rules/requirePluginVersions.html)、[bannedPlugins 文档](https://maven.apache.org/enforcer/enforcer-rules/bannedPlugins.html) 和 [banDynamicVersions 文档](https://maven.apache.org/enforcer/enforcer-rules/banDynamicVersions.html)，并以 Enforcer `3.5.0` 的实际规则类验证兼容性。

本轮不接受 Enforcer 配置中的 `combine.self` 或 `combine.children` 合并控制，也不接受 `rulesToSkip`、`rulesToExecute` 选择性执行配置；遇到这类配置返回配置错误。每项必需规则必须使用 `ERROR` 级别，不能以规则内部的 `<level>WARN</level>` 降级。`skip`、`fail` 大小写按布尔值处理，未解析的控制表达式不能作为有效配置。原生执行成功时，每项必需规则还必须有对应 Apache 内置规则完整类名的实际执行结果，自定义同名实现不能代替；规则未执行、日志被静默或工具版本无法提供该证据时不能通过。第三方规则报告 `failed` 或 `warned` 都不能作为通过证据。

架构检查要求项目预先提供 ArchUnit 等实际类型或字节码架构测试，并在 `requiredTestClasses` 明确列出这些测试类。检查器确认这些类执行及其结果，不使用包名正则推断语义，也不会把普通测试通过描述为所有分层、循环或内部包规则通过。具体规则内容和覆盖范围由消费项目维护及评审。

JUnit XML 必须包含实际用例，计数必须一致。每个必需模块都必须执行至少一个用例；零测试、全部跳过、缺报告或缺必需架构类均不能通过。部分跳过会保留在原生报告中，当前规则不要求所有用例均不可跳过。显式报告清单应覆盖该模块所有必需的测试套件；未列出的报告不会提供通过证据。

JaCoCo 必须包含行、指令计数和本次执行会话；有分支代码时还必须包含分支计数。所有必需模块分别满足阈值，不以模块平均值掩盖低覆盖模块。没有生产行或指令计数不能通过；生产代码没有分支且子级数据也没有正分支计数时，允许原生报告省略分支汇总，按 `0/0` 和 100% 处理。覆盖率检查不接受从旧 `.exec` 数据重新生成的报告作为本次执行证据。

报告和产物必须为项目内普通文件；路径越界、路径链上的符号链接、旧输出、无效编码、破损 XML/JSON 或重复 JUnit 用例计数均阻断。严格 XML 解析不加载外部实体，只接受 JaCoCo 的标准文档类型声明。旧报告不会因为 Maven 返回成功而被接受。

工具启动失败、超时、信号终止、无法识别的工具失败以及缺失或损坏报告采用统一配置/执行错误；明确编译错误、测试失败、Enforcer 规则失败及覆盖率阈值不足采用违规。所有结果由公共退出码映射处理，第三方原始退出码仅保留诊断。本地 Hook 可被绕过，强制合并要求仍需受保护分支的必需 CI 检查。

## 原生工具验证

开发验证固定使用 JDK 17、Maven 3.9.11、Surefire 3.2.5、JUnit Jupiter 5.10.2、ArchUnit 1.3.0 和 JaCoCo 0.8.12。架构夹具使用 [ArchUnit 官方的包依赖规则与字节码导入方式](https://www.archunit.org/userguide/html/000_Index.html)，覆盖率夹具使用 [JaCoCo 官方的 prepare-agent 与 report 生命周期](https://www.jacoco.org/jacoco/trunk/doc/maven.html)。这些版本用于验证报告协议，不表示检查器会安装它们或强制消费项目迁移版本。

可选原生回归分别位于 `test/integrations/java/engineering/native-maven.test.js` 和 `native-extended.test.js`。显式设置 `REPO_GUARD_JAVA_NATIVE_TESTS=1` 或 `REPO_GUARD_JAVA_NATIVE_EXTENDED=1`，以及 `REPO_GUARD_JAVA_MAVEN_REPOSITORY` 指向已经准备好的 Maven 缓存，再通过 `node --test` 执行对应文件。测试期间所有门禁以离线模式运行；开发用固定版本缓存的准备是独立操作。普通测试不要求安装 Java 工具。

原生夹具验证生产与测试编译、JAR 打包、JUnit 通过与失败、有效 POM 和真实依赖树、Enforcer 禁止插件失败、ArchUnit 越层失败，以及 JaCoCo 覆盖率通过、阈值不足和缺失数据。报告解析和模块、路径、CI 强制启用边界另有不依赖 Maven 的回归测试。
