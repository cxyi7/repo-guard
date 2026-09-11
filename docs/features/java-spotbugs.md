# Java 字节码缺陷检查：SpotBugs

`javaSpotbugs` 调用消费项目准备的 Maven 与 SpotBugs，检查编译后的 Java 生产代码，寻找空指针、资源使用、相等性实现、并发等通用缺陷模式。它不判断业务需求是否正确，也不保证检测到所有缺陷；发现的问题需要结合代码复核。

工具即使没有 stdout/stderr，也会在统一 `diagnostics` 中保留原始退出码；启动失败、超时或信号终止仍是执行错误。隐式启动参数在执行前预检，有效 POM 在 `clean` 后生成并校验；不能把后者描述为所有 Maven 操作开始前完成。

| 项目 | 当前约定 |
| --- | --- |
| 配置 | Java 应用的 `checks.javaSpotbugs`，默认关闭 |
| 命令 | `repo-guard java-spotbugs --project api` |
| 门禁标识 | `java.spotbugs` |
| 原生工具 | 项目提供的 JDK、Maven、固定版本 SpotBugs Maven 插件 4.x |
| 自动阶段 | 可进入 pre-push、CI full 和 release-ready；不进入 pre-commit |
| 修改范围 | 不修复源码；Maven 会清理并重新生成应用构建目录中的产物 |
| 当前边界 | Maven Java 应用、生产类、每模块独立原生 XML；不包含 Gradle 适配 |

## 配置与开启

将以下内容合入 Java 应用现有的 `checks`。这是带说明的 JSONC 示例；写入 JSON 配置文件时删除注释。多应用项目的所有路径相对于该 Java 应用的根目录，不是 Git 仓库根目录。

```jsonc
{
  "version": 2, // 当前配置版本。
  "project": { "id": "api", "role": "backend", "stack": "java", "preset": "java-maven" }, // 明确应用身份与工具链。
  "checks": {
    "javaSpotbugs": {
      "enabled": true, // 布尔值；默认 false。配置完整后才开启。
      "executable": "mvn", // 已安装 Maven 的命令或路径；不执行 mvnw/mvnw.cmd。
      "pom": "pom.xml", // 应用内的具体 POM 路径，不允许 ../ 或通配符。
      "pluginVersion": "4.10.3.0", // 必填固定版本；只接受 4.x 四段数字，不接受 LATEST、范围或 SNAPSHOT。
      "offline": true, // 默认 true；仅使用已经准备好的本地依赖。false 明确允许 Maven 解析并下载依赖。
      "timeoutMs": 180000, // 整个检查的总超时，含清理、POM 核验、编译和分析；正整数，最大 2147483647。
      "arguments": [], // 仅允许 -P名称、-Dmaven.repo.local=缓存路径、-DrepoGuard.属性=值；不得覆盖工具控制参数。
      "priority": "normal", // high：只阻断原生优先级 1；normal：1、2；low：1、2、3。默认 normal。
      "excludeBugPatterns": [], // 显式豁免的原生规则 ID，例如 DM_DEFAULT_ENCODING；不允许通配符和重复值。
      "modules": [ // 启用时至少声明一个实际包含生产类的模块；聚合 POM 本身不能充当模块证据。
        {
          "name": "api", // 必填且唯一的模块名称，用于报告定位。
          "directory": ".", // 模块目录；默认当前应用目录。多个模块不能使用相同目录。
          "reports": ["target/spotbugsXml.xml"] // 必须只有这一个原生报告；子模块须加模块目录前缀。
        }
      ]
    }
  }
}
```

`priority` 是 SpotBugs 的置信优先级筛选，不等于安全漏洞严重程度。采集器始终以 `Max` 分析力度和 `Low` 报告阈值收集全部普通缺陷，再由公共配置决定哪些缺陷阻断。被优先级或 `excludeBugPatterns` 排除的缺陷仍保留在原生 XML 中，报告同时给出原始缺陷数和实际阻断数。

固定插件版本后，由人或负责环境适配的 AI 提前准备相容的 JDK、Maven 和插件依赖。本功能不自动选择工具版本，不修改 `pom.xml`，不自动安装工具。可以在项目 POM 中明确声明与 `pluginVersion` 相同的 `com.github.spotbugs:spotbugs-maven-plugin`；没有声明时使用配置中的完整插件坐标调用，不进行版本推断。

```powershell
repo-guard doctor --project api
repo-guard java-spotbugs --project api
```

已有完整配置但暂时关闭时，可以使用 `repo-guard enable javaSpotbugs --project api` 开启。CI 是否执行及是否阻断，仍由该应用的 CI 策略决定；只报告或跳过结果不能作为交付通过证据。

## 多模块

例如 `pom.xml` 管理 `api` 与 `worker` 两个 Maven 子模块：

```jsonc
{
"modules": [
  {
    "name": "api", // 独立核验该模块，不能借用 worker 的报告或字节码。
    "directory": "api",
    "reports": ["api/target/spotbugsXml.xml"]
  },
  {
    "name": "worker",
    "directory": "worker",
    "reports": ["worker/target/spotbugsXml.xml"]
  }
]
}
```

各模块报告、生产字节码与源码目录必须属于自己的模块；报告和输入不能复用。应声明所有需要作为交付证据的生产模块。Maven 仍按根 POM 的 reactor 执行，因此可能编译或分析 POM 中其他模块；不把 `modules` 声明误当作构建范围过滤器。编译与 SpotBugs 目标在同一次 reactor 调用中运行，保留模块间的编译依赖关系。

## 如何避免“没检查也通过”

执行顺序为清理构建产物、生成并核验各模块有效 POM、编译生产代码、执行固定版本 SpotBugs、读取并核验原生报告、按团队规则判定。

- 每个模块必须有本次生成的非空 `.class` 输入；原生报告中的分析类集合必须与它一致。
- `BugCollection`、类汇总、缺陷明细和优先级计数必须完整一致；零类、缺少依赖类、工具分析错误、陈旧或损坏 XML 都不能通过。
- 分析时间和文件新鲜度都要属于本次运行；不接受上次的零缺陷报告。
- POM 中的 `skip`、过滤文件、`onlyAnalyze`、部分检测器、引擎依赖覆盖或报告重定向不能悄悄改变必需检查。发现不支持的覆盖配置会报配置错误；豁免统一放在 `excludeBugPatterns`。
- 所有 Java Maven 门禁共享[隐式参数预检](java-engineering.md#隐式参数与启动环境)：应用及祖先的 `.mvn/maven.config`、JVM 配置和环境变量不能隐藏 `omitVisitors` 等跳过参数；不支持的参数会明确报错，不会静默删掉后继续执行。
- 运行前复用 Maven 文件边界预检，禁止报告或清理目录覆盖 Git 已跟踪文件，禁止路径越过当前应用或经过符号链接。

当前固定模块构建目录为 `target`，生产字节码目录必须在该模块的 `target/` 内。自定义报告目录、聚合 SpotBugs 报告、测试类检查和额外检测器插件不在本次支持范围。SpotBugs 自身支持的源代码抑制注解仍属于原生工具行为，团队如需禁止这类注解，应另用源码规则约束。

## 结果与维护

命中需阻断的规则返回统一违规状态和退出码 `2`；配置不满足要求、缺少工具、超时、取消、原生进程异常或证据不足返回统一错误状态和退出码 `1`；通过或关闭返回 `0`，关闭状态始终为 `skipped`。第三方原始退出码只保留为诊断。主要解释使用中文，原生英文缺陷说明单独标记为第三方诊断。

维护入口：

- `src/config/java-spotbugs.js`：配置默认值、Schema 与验证。
- `src/integrations/java/spotbugs/`：Maven 调度、有效 POM 核验、字节码和原生 XML 证据。
- `src/policies/java/spotbugs.js`：置信优先级与显式豁免判定。
- `src/gates/java/spotbugs-gate.js`：平台生命周期与统一报告。
- `test/config/java-spotbugs.test.js`、`test/integrations/java/spotbugs/`、`test/gates/java/spotbugs.test.js`：配置、边界、原生工具与结果语义测试。

原生兼容性夹具固定 Maven 插件 `4.10.3.0`、SpotBugs `4.10.3` 和 JDK 17。其他 4.x 固定版本只有满足相同原生报告和配置约定才可通过；更换版本应重新运行项目检查。仓库真实工具测试通过 `REPO_GUARD_JAVA_SPOTBUGS_NATIVE_TESTS=1` 显式开启，并可用 `REPO_GUARD_JAVA_SPOTBUGS_REPOSITORY` 指定预先准备的本地 Maven 缓存。

原生工具约定参考：[SpotBugs Maven 目标参数](https://spotbugs.github.io/spotbugs-maven-plugin/spotbugs-mojo.html)、[SpotBugs 运行方式](https://spotbugs.readthedocs.io/en/stable/running.html)。
