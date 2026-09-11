import micromatch from "micromatch";
import {
  executionError,
  configurationError,
} from "../../../core/error/repo-guard-error.js";
import {
  javaEngineeringFinding as finding,
  javaModuleReportPath,
  javaTestEvidence,
} from "./findings.js";
export function evaluateJavaFiles(files, config) {
  return files.flatMap((file) => {
    const relative =
      typeof file === "string" ? file : (file.relative ?? file.path);
    if (typeof relative !== "string")
      throw configurationError(
        "java/files-missing-path",
        "Java 文件事实缺少项目相对路径",
      );
    if (micromatch.isMatch(relative, config.forbidden, { dot: true }))
      return [
        finding("forbidden-file", "文件位于禁止提交的 Java 产物或缓存路径", {
          file: relative,
          evidence: [
            {
              type: "java-file-rule",
              message: `命中禁止路径：${config.forbidden.filter((pattern) => micromatch.isMatch(relative, pattern, { dot: true })).join("、")}`,
            },
          ],
          expected: "Git 中不得包含命中禁止路径的 Java 产物或缓存文件。",
          steps: [
            "从 Git 跟踪范围移除该产物或缓存，并在 .gitignore 中声明对应生成目录；保留需要的本地文件。",
          ],
          command: "java-files",
        }),
      ];
    if (
      relative.endsWith(".java") &&
      !micromatch.isMatch(relative, config.allowedJavaRoots, { dot: true })
    )
      return [
        finding("source-root", "Java 源文件不在项目声明的源码目录内", {
          file: relative,
          evidence: [
            {
              type: "java-file-rule",
              message: `允许的源码路径：${config.allowedJavaRoots.join("、")}`,
            },
          ],
          expected: `Java 源文件路径须匹配以下模式之一：${config.allowedJavaRoots.join("、")}。`,
          steps: [
            "将源码移动到符合允许模式的源码目录，并同步 package 声明及引用；暂存移动后的文件。",
          ],
          command: "java-files",
        }),
      ];
    return [];
  });
}
function tests(
  module,
  architecture,
  command = architecture ? "java-architecture" : "java-test",
) {
  const findings = [];
  const context = {
    module,
    file: javaModuleReportPath(module),
    evidence: javaTestEvidence(module),
    command,
  };
  if (!module.executed)
    findings.push(
      finding(
        "tests-not-executed",
        `模块 ${module.name} 没有执行测试，空测试或全部跳过不能通过`,
        {
          ...context,
          expected: `模块 ${module.name} 至少实际执行一项必需测试。`,
          steps: [
            "检查报告中的跳过用例及测试选择配置，恢复必需测试的执行并重新生成报告。",
          ],
        },
      ),
    );
  if (module.failed)
    findings.push(
      finding(
        architecture ? "architecture-rule-failed" : "test-failed",
        `模块 ${module.name} 有 ${module.failed} 项测试失败`,
        {
          ...context,
          expected: `模块 ${module.name} 的必需${architecture ? "架构" : ""}测试全部通过。`,
          steps: [
            "打开所列报告，按测试类和用例定位失败断言，修复代码或测试根因后重新运行检查。",
          ],
        },
      ),
    );
  if (architecture)
    for (const required of module.requiredTestClasses) {
      if (
        !module.cases.some(
          (item) => item.classname === required && !item.skipped,
        )
      )
        findings.push(
          finding(
            "architecture-not-executed",
            `模块 ${module.name} 没有执行必需架构测试类 ${required}`,
            {
              ...context,
              subject: required,
              expected: `架构测试类 ${required} 至少实际执行一项用例。`,
              steps: [
                `检查 ${required} 的测试发现、类名及包含配置，恢复执行后重新生成本次报告。`,
              ],
            },
          ),
        );
    }
  return findings;
}
function coverage(module, config, startedAt) {
  const findings = [];
  const now = Date.now();
  if (
    module.coverage.sessions.some(
      (session) =>
        session.start < startedAt ||
        session.dump < session.start ||
        session.start > now ||
        session.dump > now,
    )
  )
    throw executionError(
      "java/stale-coverage-session",
      `模块 ${module.name} 包含非本次运行的 JaCoCo 执行数据`,
    );
  for (const [type, threshold] of Object.entries(config.thresholds)) {
    const counter = module.coverage.counters[type];
    const total = counter.covered + counter.missed;
    if (!total && type !== "branch")
      findings.push(
        finding(
          "coverage-empty",
          `模块 ${module.name} 的 ${type} 没有可验证的生产代码覆盖数据`,
          {
            module,
            file: module.coverageReport,
            subject: type,
            evidence: [
              {
                type: "java-coverage-counter",
                message: `${type}：覆盖 ${counter.covered}，未覆盖 ${counter.missed}`,
              },
            ],
            expected: `${type} 必须包含可验证的生产代码覆盖数据。`,
            steps: [
              "核对 JaCoCo 对生产代码的插桩、测试执行和报告生成配置，重新运行测试并生成报告。",
            ],
            command: "java-coverage",
          },
        ),
      );
    const percentage = total ? (counter.covered * 100) / total : 100;
    if (percentage < threshold)
      findings.push(
        finding(
          "coverage-threshold",
          `模块 ${module.name} 的 ${type} 覆盖率为 ${percentage.toFixed(2)}%，低于 ${threshold}%`,
          {
            module,
            file: module.coverageReport,
            subject: type,
            evidence: [
              {
                type: "java-coverage-counter",
                message: `${type}：覆盖 ${counter.covered}，未覆盖 ${counter.missed}，阈值 ${threshold}%`,
              },
            ],
            expected: `模块 ${module.name} 的 ${type} 覆盖率至少达到 ${threshold}%。`,
            steps: [
              "查看报告中的未覆盖代码，补充有实际断言的测试，并重新生成本次覆盖报告。",
            ],
            command: "java-coverage",
          },
        ),
      );
  }
  return findings;
}
function dependencies(module, config) {
  const findings = [];
  const { effective, tree } = module;
  if (effective.unsupportedMerging)
    throw configurationError(
      "java/enforcer-merge-controls",
      `模块 ${module.name} 的 Enforcer 配置使用了本轮不支持的合并控制，无法确认必需规则实际生效`,
    );
  if (effective.selectiveRules)
    throw configurationError(
      "java/enforcer-selective-rules",
      `模块 ${module.name} 的 Enforcer 配置选择性执行或跳过规则，无法作为完整规则检查证据`,
    );
  if (
    !effective.enforcerConfigured ||
    !/^\d+(?:\.\d+)*(?:[-.][A-Za-z0-9]+)*$/.test(effective.enforcerVersion) ||
    effective.enforcerVersion.endsWith("-SNAPSHOT") ||
    effective.skip !== false ||
    effective.fail !== true
  )
    throw configurationError(
      "java/enforcer-not-configured",
      `模块 ${module.name} 缺少有效、阻断式的 Enforcer 执行配置`,
    );
  for (const rule of config.requiredEnforcerRules) {
    if (!effective.rules.includes(rule))
      throw configurationError(
        "java/enforcer-rule-missing",
        `模块 ${module.name} 的 Enforcer 执行缺少必需规则 ${rule}`,
      );
    if (effective.ruleLevels?.[rule] !== "ERROR")
      throw configurationError(
        "java/enforcer-rule-level",
        `模块 ${module.name} 的必需规则 ${rule} 必须使用阻断级别 ERROR`,
      );
    const events =
      module.enforcer?.events.filter((event) => event.rule === rule) ?? [];
    if (events.some((event) => event.outcome !== "passed"))
      findings.push(
        finding(
          "dependency-enforcer",
          `模块 ${module.name} 的必需规则 ${rule} 未通过，详见第三方原始诊断`,
          {
            module,
            file: module.effectivePom ?? javaModuleReportPath(module),
            subject: rule,
            evidence: [
              {
                type: "java-enforcer-rule",
                message: `规则 ${rule} 的原生结果：${events.map((event) => event.outcome).join("、")}`,
              },
            ],
            expected: `必需 Enforcer 规则 ${rule} 执行并通过。`,
            steps: [
              "对照有效 POM 与第三方原始诊断修正依赖或插件声明，保留必需规则及阻断级别。",
            ],
            command: "java-dependencies",
          },
        ),
      );
    if (module.enforcer?.status === 0 && !events.length)
      throw executionError(
        "java/enforcer-rule-not-executed",
        `模块 ${module.name} 缺少必需规则 ${rule} 的原生执行结果`,
      );
  }
  if (!module.enforcer)
    throw executionError(
      "java/enforcer-evidence-missing",
      `模块 ${module.name} 缺少 Enforcer 原生执行证据`,
    );
  if (
    effective.groupId !== tree.root.groupId ||
    effective.artifactId !== tree.root.artifactId ||
    effective.version !== tree.root.version
  )
    throw executionError(
      "java/dependency-module-mismatch",
      `模块 ${module.name} 的有效 POM 与依赖树不属于同一项目`,
    );
  for (const dependency of tree.dependencies) {
    const coordinate = `${dependency.groupId}:${dependency.artifactId}:${dependency.version}`;
    if (config.banSnapshots && dependency.version.endsWith("-SNAPSHOT"))
      findings.push(
        finding(
          "snapshot-dependency",
          `模块 ${module.name} 使用快照依赖 ${coordinate}`,
          {
            module,
            file: module.dependencyTree ?? javaModuleReportPath(module),
            subject: coordinate,
            evidence: [
              { type: "java-dependency", message: `依赖坐标：${coordinate}` },
            ],
            expected: "依赖版本必须是团队允许的非 SNAPSHOT 版本。",
            steps: [
              "根据依赖树定位直接或传递依赖来源，在对应 POM 中替换快照版本并重新解析依赖。",
            ],
            command: "java-dependencies",
          },
        ),
      );
    if (micromatch.isMatch(coordinate, config.bannedDependencies))
      findings.push(
        finding(
          "banned-dependency",
          `模块 ${module.name} 使用禁止依赖 ${coordinate}`,
          {
            module,
            file: module.dependencyTree ?? javaModuleReportPath(module),
            subject: coordinate,
            evidence: [
              {
                type: "java-dependency",
                message: `依赖 ${coordinate} 命中禁止模式：${config.bannedDependencies.filter((pattern) => micromatch.isMatch(coordinate, pattern)).join("、")}`,
              },
            ],
            expected: "直接和传递依赖均不得匹配团队禁止的依赖模式。",
            steps: [
              "根据依赖树移除或替换被禁止的依赖，并核对引入它的上游依赖声明。",
            ],
            command: "java-dependencies",
          },
        ),
      );
    if (
      dependency.version.includes("${") ||
      /[[\](),]/.test(dependency.version)
    )
      throw executionError(
        "java/unresolved-dependency",
        `模块 ${module.name} 的依赖树含未解析版本`,
      );
  }
  return findings;
}
export function evaluateJavaEngineering(key, facts, config) {
  const findings = facts.modules.flatMap((module) => {
    if (key === "javaDependencies") return dependencies(module, config);
    if (["javaCompile", "javaBuild"].includes(key)) return [];
    return [
      ...tests(
        module,
        key === "javaArchitecture",
        key === "javaCoverage" ? "java-coverage" : undefined,
      ),
      ...(key === "javaCoverage"
        ? coverage(module, config, facts.startedAt)
        : []),
    ];
  });
  for (const execution of facts.executions)
    if (execution.status !== 0) {
      if (
        execution.status === 1 &&
        key === "javaDependencies" &&
        execution.goals.some((goal) => goal.startsWith("enforcer:")) &&
        /EnforcerRuleException|failed with message|rule failures/i.test(
          execution.stdout + execution.stderr,
        )
      )
        findings.push(
          finding(
            "dependency-enforcer",
            "项目 Enforcer 依赖策略未通过，详见第三方原始诊断",
            {
              file: config.pom ?? "pom.xml",
              subject: execution.goals.join(" "),
              evidence: [
                {
                  type: "java-process",
                  message: `Maven 目标：${execution.goals.join(" ")}；原始退出码：${execution.status}`,
                },
              ],
              expected: "项目必需的 Enforcer 依赖策略执行并全部通过。",
              steps: [
                "查看第三方 Maven 原始诊断中的 Enforcer 失败规则，修正对应 POM 和依赖声明。",
              ],
              command: "java-dependencies",
            },
          ),
        );
      else if (
        execution.status === 1 &&
        ["javaCompile", "javaBuild"].includes(key) &&
        /COMPILATION ERROR|Compilation failure/i.test(
          execution.stdout + execution.stderr,
        )
      )
        findings.push(
          finding("compilation-failed", "Java 编译未通过，详见第三方原始诊断", {
            file: config.pom ?? "pom.xml",
            evidence: [
              {
                type: "java-process",
                message: `Maven 目标：${execution.goals.join(" ")}；原始退出码：${execution.status}`,
              },
            ],
            expected: "生产源码与必需测试源码编译通过。",
            steps: [
              "根据第三方 Maven 编译诊断中的源码路径和行号修复语法、类型或依赖引用错误。",
            ],
            command: key === "javaCompile" ? "java-compile" : "java-build",
          }),
        );
      else if (
        !(
          execution.status === 1 &&
          findings.some((item) =>
            ["java/test-failed", "java/architecture-rule-failed"].includes(
              item.ruleId,
            ),
          )
        )
      )
        throw executionError(
          "java/native-process-failed",
          "Java 原生工具执行失败，未取得可识别的质量违规证据",
          { details: { processExitCode: execution.status } },
        );
    }
  return findings;
}
