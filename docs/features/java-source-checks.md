# Java 源码检查

源码工具与 Maven 工具复用公共原始进程诊断，保留退出码、超时和信号；即使工具没有输出，也不能丢失原始状态。源码适配器不另建原始码报告逻辑，最终门禁结果仍由报告完整性与规则共同判定。

八项源码能力分别登记为门禁，分别开关和配置。所有 `enabled` 默认都是 `false`；`java-maven` 预设声明项目类型，不会自动下载、安装或启用 Java 检查工具。多应用仓库把这些配置写在所属应用根目录的 `repo-guard.config.json` 中。

完整项目接入见 [Java 接入说明](../java-quality-integration.md)，结构化状态和退出码见 [门禁结果与报告](gate-result-and-reporting.md)。源码根目录与 Maven 目录约束由独立的 `javaFiles` 检查负责；本页的 `javaLayout` 负责源码包声明与目录后缀的一致性，两项可组合启用。

## 能力与入口

| 配置项 | 门禁标识 | 手动命令 | 执行工具 | 自动阶段 |
| --- | --- | --- | --- | --- |
| `javaFormat` | `java.format` | `repo-guard java-format` | google-java-format | pre-commit、pre-push、ci-full、release-ready |
| `javaNaming` | `java.naming` | `repo-guard java-naming` | Checkstyle | pre-commit、pre-push、ci-full、release-ready |
| `javaLayout` | `java.layout` | `repo-guard java-layout` | Checkstyle | pre-commit、pre-push、ci-full、release-ready |
| `javaImports` | `java.imports` | `repo-guard java-imports` | Checkstyle | pre-commit、pre-push、ci-full、release-ready |
| `javaSize` | `java.size` | `repo-guard java-size` | Checkstyle | pre-commit、pre-push、ci-full、release-ready |
| `javaDocs` | `java.docs` | `repo-guard java-docs` | Checkstyle | pre-commit、pre-push、ci-full、release-ready |
| `javaLint` | `java.lint` | `repo-guard java-lint` | PMD 7.x | pre-commit、pre-push、ci-full、release-ready |
| `javaDuplication` | `java.duplication` | `repo-guard java-duplication` | PMD 7.x CPD | pre-push、ci-full、release-ready |

表中阶段表示门禁适用阶段；还需启用对应检查，并通过现有阶段策略安排运行。重复代码需要比较文件集合，因此不进入 pre-commit。源码 CI 检查使用 `all-files` 范围，不提供 `changed-files` 模式。

## 配置示例

以下工具文件是消费项目自己准备的固定版本；路径仅展示配置方式。Checkstyle 应使用包含运行依赖的 JAR，PMD 可以使用发行包 `lib` 中的依赖。运行目录始终是应用根目录。

```json
{
  "version": 2,
  "project": {
    "id": "api",
    "role": "backend",
    "stack": "java",
    "preset": "java-maven"
  },
  "checks": {
    "javaFormat": {
      "enabled": true,
      "command": "java",
      "args": ["-jar", "tools/google-java-format.jar"],
      "style": "google"
    },
    "javaNaming": {
      "enabled": true,
      "command": "java",
      "args": ["-jar", "tools/checkstyle-all.jar"]
    },
    "javaLayout": {
      "enabled": true,
      "command": "java",
      "args": ["-jar", "tools/checkstyle-all.jar"]
    },
    "javaImports": {
      "enabled": true,
      "command": "java",
      "args": ["-jar", "tools/checkstyle-all.jar"]
    },
    "javaSize": {
      "enabled": true,
      "command": "java",
      "args": ["-jar", "tools/checkstyle-all.jar"],
      "maxFileLines": 1000,
      "maxMethodLines": 100,
      "maxParameters": 7,
      "maxCyclomaticComplexity": 15,
      "maxNestingDepth": 3
    },
    "javaDocs": {
      "enabled": true,
      "command": "java",
      "args": ["-jar", "tools/checkstyle-all.jar"],
      "scope": "public"
    },
    "javaLint": {
      "enabled": true,
      "command": "java",
      "args": ["-cp", "tools/pmd/lib/*", "net.sourceforge.pmd.cli.PmdCli"]
    },
    "javaDuplication": {
      "enabled": true,
      "command": "java",
      "args": ["-cp", "tools/pmd/lib/*", "net.sourceforge.pmd.cli.PmdCli"],
      "minimumTokens": 100
    }
  }
}
```

任一检查可单独配置为 `{ "enabled": false }`。各项不会借用其他项的 `command`、`args` 或范围配置。门禁直接启动可执行程序，参数不经过 shell 展开；Windows 推荐使用上述 `java` 启动方式，不把 `.bat` 脚本当作直接可执行程序。

### 八项共有字段

| 字段 | 类型与可选值 | 默认值 | 作用与限制 |
| --- | --- | --- | --- |
| `enabled` | 布尔值 | `false` | 独立启用当前检查 |
| `command` | 非空字符串或 `null` | `null` | 消费项目已准备的可执行文件名称或路径；启用时必须为非空字符串；不允许换行或空字符 |
| `args` | 非空字符串组成的数组 | `[]` | 仅为工具启动前缀，如 `-jar`、JAR 路径或 `-cp`、类路径与主类；不能覆盖源码、规则、报告、跳过或修复选项 |
| `timeoutMs` | 整数，1～2147483647 | `120000` | 包括版本查询和该门禁所有文件、所有批次检查的总时限，单位毫秒 |
| `include` | 至少一个相对 glob 字符串 | `["**/*.java"]` | 从应用根目录内的候选文件选取 `.java` 源码 |
| `exclude` | 相对 glob 字符串数组，可为空 | `["**/target/**", "**/build/**"]` | 从本项范围排除生成文件；每项独立配置 |

文件范围使用正斜杠及应用相对路径。拒绝范围外路径、符号链接和不受支持的普通文件输入；不会读取其他应用的源码。单个源码文件读取上限为 16 MiB，工作树文件在加载内容前先检查大小，索引读取也限制输出缓冲区；原生 XML 报告和单次工具输出上限为 32 MiB。超过上限、文件不存在或内容不能按 UTF-8 解码，均不能作为通过结果。

## javaFormat：格式与文本卫生

`style` 为 `google` 或 `aosp`，默认 `google`，其他字段使用共有字段。门禁用选定风格生成完整格式化源码并逐字比较，检查 UTF-8、无 BOM、LF 行尾、无行尾空格或制表符，以及恰好一个末尾换行。无法解码的输入返回配置错误；可解码但不符合格式或文本卫生的输入返回违规。

pre-commit 在 `lint-staged` 隔离后，只对其选中的 Java 文件执行格式修复，再执行只读复核。其余源码检查只读。手动 `repo-guard java-format --fix` 显式允许写回当前范围；不带 `--fix`、pre-push、CI 与交付检查均为只读。写回前确认文件没有在运行期间发生变化，写回后再次调用格式化工具确认稳定。

google-java-format 不提供任意缩进参数。本项固定使用该工具的两种风格；使用 Spotless 的项目可继续在构建中保留 Spotless，本项不会隐式调用 Maven 插件或接受任意格式命令的退出码作为格式证据。工具行为参见 [google-java-format 官方说明](https://github.com/google/google-java-format)。

## javaNaming：声明命名

本项只有共有字段。生成的 Checkstyle 规则包括：

- `PackageName`：包名匹配 `^[a-z]+(\.[a-z][a-z0-9]*)*$`。
- `TypeName`：类型名匹配 `^[A-Z][a-zA-Z0-9]*$`。
- `MethodName`、`MemberName`、`StaticVariableName`、`LocalVariableName`、`ParameterName`、`CatchParameterName`：名称匹配 `^[a-z][a-zA-Z0-9]*$`。
- `ConstantName`：采用 Checkstyle 的大写下划线常量命名规则及其规则内特殊常量处理。

这是声明形式检查，不判断名称是否表达业务含义，也不按 `Service`、`DTO` 等业务后缀分类。具体受检声明由所列规则定义；不宣称覆盖一切 Java 声明种类。见 [Checkstyle 命名规则](https://checkstyle.org/checks/naming/index.html)。

## javaLayout：包路径与代码结构

本项只有共有字段。`PackageDeclaration` 设置 `matchDirectoryStructure=true`，要求包声明存在并与文件所在目录后缀匹配。例如 `package sample.api;` 对应 `sample/api` 目录；实际源码根目录另由 `javaFiles` 约束。

其余规则为 `OneTopLevelClass`、`NeedBraces`、`OneStatementPerLine`、`MultipleVariableDeclarations`、`ModifierOrder`、`OuterTypeFilename`、`EmptyStatement`，分别约束单个顶层类型、控制语句花括号、单行语句、多变量声明、修饰符顺序、外部类型与文件名及多余空语句。见 [PackageDeclaration](https://checkstyle.org/checks/coding/packagedeclaration.html) 与 [OneTopLevelClass](https://checkstyle.org/checks/design/onetoplevelclass.html)。

`package-info.java` 可按正常包描述符参与检查。已验证的 Checkstyle 10.21.4 与 12.3.1 无法解析 `module-info.java`；文件处于范围内时会明确返回执行错误，不会默默排除或宣称检查通过。使用模块声明的项目必须选择支持该语法与所需规则的工具组合，或在各项 `exclude` 中明确声明本项不检查模块描述符；排除范围不能作为该文件已经验证的证据。工具运行 JDK 版本与源码支持版本是两个不同约束。

## javaImports：导入规则

本项只有共有字段，固定启用 `AvoidStarImport`、`RedundantImport`、`UnusedImports` 和 `IllegalImport`。禁止通配符导入、冗余导入和规则能识别的未使用导入；默认仅禁止 `sun`、`jdk.internal` 包及其子包，不把整个 `com.sun` 命名空间视为内部接口，例如 `com.sun.net.httpserver.HttpServer` 可以参与正常检查。

未使用导入是单文件语法检查；静态导入重载、同名方法及 Javadoc 引用按 Checkstyle 的支持范围处理，不能替代编译器或跨文件类型分析。见 [Checkstyle 导入规则](https://checkstyle.org/checks/imports/index.html)。

## javaSize：可配置规模上限

| 特有字段 | 类型与范围 | 默认值 | 规则与计量方式 |
| --- | --- | --- | --- |
| `maxFileLines` | 整数，1～2147483647 | `1000` | `FileLength`：单文件物理行数 |
| `maxMethodLines` | 整数，1～2147483647 | `100` | `MethodLength`：方法或构造器物理行数，包含空行与注释 |
| `maxParameters` | 整数，1～2147483647 | `7` | `ParameterNumber`：方法或构造器参数数量 |
| `maxCyclomaticComplexity` | 整数，1～2147483647 | `15` | `CyclomaticComplexity`：按 Checkstyle 语法节点定义计算的圈复杂度 |
| `maxNestingDepth` | 整数，1～2147483647 | `3` | `NestedIfDepth`、`NestedForDepth`、`NestedTryDepth`：各自同类结构的嵌套深度 |

其余字段使用共有字段。嵌套上限分别作用于三类规则，不等于所有控制结构混合后的总深度。达到这些阈值只说明规模指标合规，不证明设计质量或可维护性。见 [Checkstyle 规模规则](https://checkstyle.org/checks/sizes/index.html) 与 [圈复杂度规则](https://checkstyle.org/checks/metrics/cyclomaticcomplexity.html)。

## javaDocs：文档存在性与标签

`scope` 为 `public`、`protected`、`package` 或 `private`，默认 `public`。所选范围包含比它更公开的声明；其余字段使用共有字段。

规则为 `MissingJavadocType`、`MissingJavadocMethod`、`JavadocMethod`、`InvalidJavadocPosition`。不启用 getter/setter 缺失文档豁免；参数、返回值标签与 Javadoc 位置按规则验证。`validateThrows=false`，不推断方法会抛出的所有异常。`@Override` 等规则自带的继承文档处理保留；本项检查形式和存在性，不能证明注释准确、完整或解释了业务。见 [Checkstyle Javadoc 规则](https://checkstyle.org/checks/javadoc/index.html)。

## javaLint：四项固定源码规则

本项只有共有字段，使用 PMD 7.x 自行生成且不可通过前缀参数替换的规则集：

| PMD 规则 | 本项约束 |
| --- | --- |
| `BrokenNullCheck` | 识别规则支持的空值判断与短路逻辑错误形式 |
| `AvoidPrintStackTrace` | 禁止直接调用 `printStackTrace` |
| `EmptyCatchBlock` | 禁止空 catch；仅写注释或把异常变量命名为 `ignored` 仍不豁免 |
| `SystemPrintln` | 禁止直接调用 `System.out`、`System.err` 的打印方法 |

PMD 使用 `--no-cache` 和新建 XML 报告，并启用被抑制违规输出；发现必需规则被源码注释或注解抑制，返回执行错误。源码解析错误、规则配置错误同样阻断。规则依据语法和工具支持的分析能力报告，不证明所有路径不会空指针，也不替代完整编译或运行测试。本项不执行 PMD 全量规则、异常业务语义推断或测试断言含义检查；字节码缺陷使用独立的 [SpotBugs 检查](java-spotbugs.md)，测试对代码变异的检测能力使用 [PIT 变异测试](java-mutation-test.md)。

规则定义见 [PMD Java errorprone](https://pmd.github.io/pmd/pmd_rules_java_errorprone.html) 与 [PMD Java bestpractices](https://pmd.github.io/pmd/pmd_rules_java_bestpractices.html)。

## javaDuplication：词法重复

`minimumTokens` 是 1～2147483647 的整数，默认 `100`，表示报告重复片段需要达到的最少词法标记数；其余字段使用共有字段。

本项使用 PMD 7.x 的 CPD 比较所选文件，不启用忽略标识符、忽略字面量、跳过重复文件或跳过词法错误的参数。结果包含重复片段的各文件位置和标记数，不把相似代码判断为语义相同，也不能判断抽象是否合理。相同标记数量不等于相同行数。

CPD 原生 XML 不暴露源码抑制区间。本项因此保守拒绝源码中出现 `CPD-OFF`、`CPD-ON`、`CPD-START`、`CPD-END` 标记，包括 Java Unicode 转义后的等价文本；该限制也包括注释之外的同名文字。需移除这些标记后再检查，不能凭静默跳过的结果认定完整通过。机制见 [CPD 官方说明](https://pmd.github.io/pmd/pmd_userdocs_cpd.html)。

## 输入范围、原生报告与错误分类

普通 pre-commit 只接收当前 `lint-staged` 选中的 Java 文件。配置发生暂存变更时，只读验证构造索引快照，读取该应用全部受控 Java 文件，并用选中文件在隔离环境中修复后的内容覆盖快照；不把未暂存工作树内容冒充提交内容。格式修复仍只写回选中文件，不进行全项目 Hook 修复。

手动与 CI 入口使用调度器提供的本应用工作树候选文件，包含未被 Git 忽略的未跟踪文件；底层适配器没有收到候选集合时才回退到应用内 Git 跟踪文件。空范围返回 `skipped`，不能作为交付通过证据。候选范围再应用本项 `include`、`exclude`。

Checkstyle 每组独立生成规则，每批最多 32 个文件，并按保守字符预算进一步拆分，避免 Windows 命令行长度限制。每批报告必须覆盖该批全部文件、只有该功能允许的规则，且违规数与原生退出码相符。PMD 和 CPD 使用文件清单；PMD 写入新建报告文件，CPD 的 XML 标准输出写入新建报告。所有临时文件在结束时清理，不复用上次报告或缓存。

XML 采用严格解析，拒绝外部实体、DOCTYPE、异常结构、未知字段、范围外位置、非法数值、缺失或截断报告，以及工具错误与报告不一致的状态。PMD 无违规时不会为每个文件生成 XML 节点，因此完整执行还依赖受控命令、新鲜报告以及原生错误状态共同确认。门禁先确认工具原生版本，再依据实际源码结果判断，任意返回成功的命令不构成通过证据。

统一状态为：有效违规返回 `violation`；错误配置、未配置工具或不可用输入返回 `configuration-error`；工具启动失败、超时、信号终止、取消、源码语法解析失败或不完整报告返回 `execution-error`。公共退出码模块分别映射为违规 `2`、配置或执行错误 `1`；不透传第三方退出码。第三方原文及原始退出码仅进入明确标记的 `diagnostics`，问题正文、说明与修复建议使用中文。

## 验证与维护位置

已用本地 JDK 17、google-java-format 1.22.0、Checkstyle 12.3.1 和 PMD 7.10.0 验证八项正常与违规路径、文本卫生、包路径、包描述符、单个顶层类型、PMD 四规则和抑制处理、重复代码、真实手动入口、真实 `lint-staged` 的部分暂存修复及失败恢复。Checkstyle 10.21.4 也验证了普通源码与模块语法限制。这些版本是验证记录，消费项目仍负责固定并提供符合自身 JDK 和源码版本要求的工具。

`command` 使用的运行 JDK 决定工具能否启动；项目编译目标与 Maven Toolchains 由独立工程检查负责。源码工具通过不证明项目按期望 Java 版本编译，也不证明测试在目标 JDK 运行。

实现分别位于 `src/config/java-source.js`、`src/config/java-source-schema.js`、`src/policies/java/source-rules.js`、`src/integrations/java/source/`、`src/gates/java/source-*`。测试位于 `test/config/java-source.test.js`、`test/gates/java/source.test.js`、`test/integrations/java/source/` 与 `test/hooks/java-source-isolation.test.js`。真实工具测试只在开发者预先准备工具时运行，通过 `REPO_GUARD_JAVA_SOURCE_TOOLS` 指定含 `classpath.txt` 与 `google-java-format.jar` 的目录；测试不会自动安装工具。
