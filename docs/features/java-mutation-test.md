# Java 变异测试

`javaMutationTest` 调用消费项目已经准备好的 Maven 和 PIT，检查现有测试是否能发现生产代码中的小错误。它与 Node 的 `mutationTest` 独立配置，不要求启用 `javaTest`，也不涉及接口协议、身份权限或具体业务规则。

共用 Maven 字段的配置错误指向实际配置文件及 `checks.javaMutationTest`，不会要求修改 `javaTest`。工具原始退出码在统一 `diagnostics` 中保留，即使 stdout/stderr 为空；对外仍按公共规则返回结果。启动参数先预检，有效 POM 在 `clean test` 后生成并校验，必须在接受检查通过证据前完成。

例如 PIT 把 `count >= 0` 临时变成 `count > 0`。如果已有测试在边界值 `0` 上失败，这个变异记为 `KILLED`；测试仍通过则记为 `SURVIVED`；没有测试覆盖则记为 `NO_COVERAGE`。工具在编译产物上执行变异，不改写源码。

## 接入条件

- 项目身份为 `role: "backend"`、`stack: "java"`、`preset: "java-maven"`。Node 用于运行 repo-guard，项目自行准备与代码兼容的 JDK、Maven、PIT 1.x 正式版本和测试框架插件。
- 在消费项目 `pom.xml` 的 `build.plugins` 中声明 `org.pitest:pitest-maven`，固定版本并与 `pluginVersion` 一致；JUnit 5 项目还需准备兼容的 PIT JUnit 5 插件。repo-guard 不下载、安装或改写这些配置。
- 必须显式设置 PIT 的 `<parseSurefireConfig>false</parseSurefireConfig>`，防止从 Surefire 配置导入忽略失败的行为。本轮不接受 PIT 的 `executions` 区块；项目已有生命周期绑定应在接入时由人或 AI 调整为插件公共配置。
- 所需依赖、构建插件和 PIT 测试插件应提前缓存。默认 `offline: true`；明确设置为 `false` 才允许 Maven 按项目仓库配置解析缺失依赖。
- 所有声明路径相对当前应用根目录。源码、规则和测试归项目维护，报告属于构建输出，不应提交到 Git。
- 本仓库原生验证的 PIT 版本为 `1.17.3`。配置允许固定的其他 `1.x.y`，但不保证其协议兼容；升级前必须核对原生用户属性清单、XML 状态与结构，并完成消费项目的原生回归，不能只修改版本号。

消费项目 Maven 插件配置示例（版本为经过本仓库原生测试的组合，不代表适合所有 JDK 和测试框架）：

```xml
<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>1.17.3</version>
  <configuration>
    <!-- 必须为 false：不从 Surefire 导入忽略失败、测试过滤等设置。 -->
    <parseSurefireConfig>false</parseSurefireConfig>
  </configuration>
  <!-- JUnit 5 项目需要；使用其他测试框架时按该框架准备兼容插件。 -->
  <dependencies>
    <dependency>
      <groupId>org.pitest</groupId>
      <artifactId>pitest-junit5-plugin</artifactId>
      <version>1.2.2</version>
    </dependency>
  </dependencies>
</plugin>
```

## 配置

以下 JSONC 用于解释字段，保存到 `.json` 时删除注释，并合并到当前 Java 应用配置，不覆盖已有团队规则。

```jsonc
{
  "version": 2, // 当前应用配置格式版本。
  "project": {
    "id": "api", // 当前 Java 应用标识，按仓库实际应用名称填写。
    "role": "backend", // Java 工程使用后端角色。
    "stack": "java", // 显式选择 Java 技术栈。
    "preset": "java-maven" // 当前支持 Maven 项目。
  },
  "checks": {
    "javaMutationTest": {
      "enabled": true, // 默认 false；关闭时不启动 Maven 或 PIT。
      "executable": "mvn", // PATH 中的 Maven 或已准备的可执行文件路径；不支持 Maven Wrapper。
      "pom": "pom.xml", // 应用根目录内的具体 POM 路径；不能越界或使用通配符。
      "offline": true, // 默认 true；缺少缓存时报告执行错误，不自动联网补齐。
      "timeoutMs": 600000, // 整个检查共用时间预算；整数 1～2147483647，默认 10 分钟。
      "arguments": [], // 仅允许 -Pprofile、-Dmaven.repo.local=路径、-DrepoGuard.自定义名=值；禁止直接注入 PIT 工具属性。
      "pluginVersion": "1.17.3", // 启用时必填；固定的 1.x.y 正式版本，不接受 LATEST、SNAPSHOT、版本范围。
      "threshold": 80, // 每个必需模块的最低变异得分，0～100，允许小数；默认 80。
      "modules": [ // 启用时至少一个模块；名称、目录和证据路径不能重复。
        {
          "name": "api", // 必填：报告中显示的非空模块名称。
          "directory": ".", // 模块根目录，相对应用根目录；默认 .；子模块必须有 pom.xml。
          "reports": [ // 必填：本次 clean test 生成的全部必需 JUnit XML；具体路径，不支持通配符。
            "target/surefire-reports/TEST-com.example.AppTest.xml"
          ],
          "mutationReport": "target/pit-reports/mutations.xml", // 必填：所属模块 target/ 或 reports/ 内，文件名必须为 mutations.xml。
          "targetClasses": ["com.example.*"], // 必填：要变异的 Java 完整类名模式，至少一个；* 可匹配包和内部类。
          "targetTests": ["com.example.*Test"] // 必填：参与 PIT 的测试类名模式；基线必须执行范围内测试。
        }
      ]
    }
  }
}
```

`targetClasses`、`targetTests` 各自最多 32 个模式，每个最多 256 字符、总长度最多 2048 字符。仅接受字母、数字、点、下划线、美元符和 `*`，不能用文件路径、逗号或复杂正则。精确类名不会自动包含内部类，需要时写成 `com.example.App*`。检查范围由团队显式声明，不自动推断业务分层或测试充分性。

匹配采用动态规划，不把用户模式转换为回溯正则；报告类名最多 1024 字符，每个模块的每组模式共用 1600 万匹配步骤预算，同名类结果缓存复用。超过预算会返回执行错误，需收窄模式或拆分检查模块，不能通过超复杂模式阻塞后续退出处理。

`arguments` 采用允许名单。普通自定义参数放入 `repoGuard.` 命名空间，例如 `-DrepoGuard.mode=production`；如果该参数被 POM 用于工具配置，仍以解析后的有效配置进行校验。有效 POM（包括激活 profile 合并后的 `properties`）不允许直接定义 PIT 原生工具属性，例如 `avoidCallsTo`、`mutators`、`targetClasses`、`pit.dryRun`；这些隐藏属性可能绕过插件配置检查，因此会明确阻断。

每个模块还会在 `target/repo-guard-pit-effective-pom.xml` 生成本次有效 POM。该文件与基线报告、变异报告一起进行路径边界、符号链接和 Git 跟踪保护检查；不能把这些输出配置到受版本管理的文件上。

## 运行与生命周期

```bash
repo-guard doctor --project api
repo-guard java-mutation-test --project api
```

单应用可以省略 `--project api`。先填完整配置，再使用 `repo-guard enable javaMutationTest --project api`；关闭使用对应 `disable` 命令。

门禁默认关闭。启用后可手动运行，或进入可选 pre-push、CI `full`、`release-ready` 检查。它不进入 pre-commit 和 CI `policy`；CI 还需要启用公共 CI 能力，并根据模式配置继承、报告或阻断策略。

执行顺序：

1. 预检应用、模块、POM、输出路径和工具链，确认 Maven 清理不会覆盖已跟踪文件。
2. 从应用 POM 执行 `clean test`，读取本次声明的 JUnit 报告。报告缺失、过期、格式损坏是执行错误；失败、空测试、全部跳过或目标范围内没有基线测试均不能继续作为通过证据。
3. 对每个模块采集有效 POM，核对 PIT 版本、执行模式、输出和目标范围。
4. 逐模块执行固定坐标 `org.pitest:pitest-maven:<版本>:mutationCoverage`，关闭递归执行，强制 XML、UTF-8、非时间戳目录和本次完整执行。
5. 读取本次新生成的 `mutations.xml`，检查状态和范围，逐模块计算 `KILLED ÷ 全部变异 × 100`。比较时不四舍五入，避免边界值误放行。

多模块项目中的基线测试由应用根 POM 执行；PIT 按模块 POM 独立运行。模块之间的依赖必须能在项目现有 Maven 配置和缓存中正确解析。本功能不执行 `install`，不支持 PIT 跨模块测试模式。不同模块可以有相同的完整类名，各模块按自己的代码和报告独立计分；同一报告内部重复变异仍会阻断。需要跨模块测试的项目应由后续适配 Skill 明确调整检查模块和依赖准备方式。

PIT XML 中的 `partial="true"` 表示原生的部分测试覆盖信息模式（例如找到第一个杀死变异的测试后不继续收集全部测试矩阵），并不表示 XML 被截断或变异未完成。当前接受 `true` 和 `false`，同时要求文档完整、每项变异状态有效；`STARTED`、`NOT_STARTED` 等未完成状态仍然阻断。

## 通过与失败

| 情况 | 结果 |
| --- | --- |
| 各模块都有变异、至少有测试覆盖，得分达到阈值 | 通过 |
| 基线测试失败、没有执行测试、全部跳过 | 违规，停止后续变异分析 |
| 零变异、全部 `NO_COVERAGE` | 违规；即使阈值为 0 也不能通过 |
| 有 `SURVIVED` 或 `NO_COVERAGE` 导致模块分数不足 | 违规，提示补充有效断言或边界用例 |
| 超时、信号终止、启动失败、Maven 未识别的非零退出 | 执行错误 |
| PIT 的 `TIMED_OUT`、`MEMORY_ERROR`、`RUN_ERROR`、`NON_VIABLE`、`NOT_STARTED`、`STARTED`、`EQUIVALENT` 或未知状态 | 执行错误；不当作杀死变异提高分数 |
| 报告缺失、过期、重复变异、无效 XML、范围不一致 | 执行错误 |
| 未固定版本、输出冲突、POM 开启跳过、干运行或历史复用 | 配置错误 |

统一退出码由公共结果模块处理：成功或非阻断为 `0`，配置/执行错误为 `1`，违规为 `2`；门禁不透传 Maven 原始退出码。Maven / PIT 原始诊断单独标注，与中文主要结论分开。

POM 采用允许字段校验，未知字段也会拒绝。不能通过历史文件、`withHistory`、`dryRun`、跳过失败、`crossModule`、自定义合并、额外过滤、高级 features、`mutators` 或 `avoidCallsTo` 缩减本次证据。POM 中若显式配置目标范围、输出目录或格式，必须与当前模块声明一致。阈值由 repo-guard 统一计算，因此 PIT 的原生阈值应留空或为 `0`，`maxSurviving` 应留空或为 `-1`。可调整执行资源：`threads` 为 1～256 的整数、`timeoutFactor` 为 0.01～100、`timeoutConstant` 为 0～2147483647 的整数毫秒；这些参数导致的超时仍作为执行错误。

变异测试成本高于普通单元测试。存活变异可能暴露弱断言，也可能属于等价变异，需要人或 AI 分析后改进测试；本功能不会自动修改业务代码、断言或阈值。

## 维护与验证

- 配置契约：`src/config/java-mutation.js`。
- Maven / PIT 采集与严格 XML 读取：`src/integrations/java/mutation/`。
- 质量判定：`src/policies/java/mutation.js`；门禁入口：`src/gates/java/mutation-gate.js`。
- 测试按配置、集成和门禁分别位于 `test/config/java-mutation.test.js`、`test/integrations/java/mutation/`、`test/gates/java/mutation.test.js`。
- 原生测试使用 `REPO_GUARD_JAVA_NATIVE_PIT=1` 和显式 `REPO_GUARD_JAVA_MAVEN_REPOSITORY` 启动；在已准备缓存后验证离线成功、阈值失败、基线失败和全部跳过，默认单元测试不下载 PIT。

原生协议依据：[PIT Maven 接入](https://pitest.org/quickstart/maven/)、[PIT 状态定义](https://github.com/hcoles/pitest/blob/master/pitest/src/main/java/org/pitest/mutationtest/DetectionStatus.java)、[PIT XML 输出实现](https://github.com/hcoles/pitest/blob/master/pitest-entry/src/main/java/org/pitest/mutationtest/report/xml/XMLReportListener.java)。
