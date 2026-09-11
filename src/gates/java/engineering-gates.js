import {
  JAVA_ENGINEERING_DEFAULTS,
  validateJavaEngineeringChecks,
} from "../../config/java-engineering.js";
import {
  errorStatus,
  toRepoGuardError,
} from "../../core/error/repo-guard-error.js";
import { createGateResult } from "../../core/result/gate-result.js";
import { processOutputDiagnostics } from "../../core/execution/process-output.js";
import { listIndexFiles } from "../../git/index-content.js";
import {
  collectJavaEngineeringFacts,
  inspectJavaEngineeringSetup,
} from "../../integrations/java/engineering/collect.js";
import {
  evaluateJavaEngineering,
  evaluateJavaFiles,
} from "../../policies/java/engineering/evaluate.js";
import { definePlatformGate, readyGateSetup } from "../platform-gate.js";

const definitions = [
  ["javaArchitecture", "architecture", "架构"],
  ["javaDependencies", "dependencies", "依赖"],
  ["javaFiles", "files", "文件"],
  ["javaCompile", "compile", "编译"],
  ["javaBuild", "build", "构建"],
  ["javaTest", "test", "测试"],
  ["javaCoverage", "coverage", "覆盖率"],
];
export async function runJavaEngineeringGate({
  root,
  key,
  config,
  files,
  signal,
  collect = collectJavaEngineeringFacts,
}) {
  const definition = definitions.find(([candidate]) => candidate === key);
  const gateId = `java.${definition[1]}`;
  const startedAt = Date.now();
  let diagnostics = [];
  try {
    config = validateJavaEngineeringChecks({ [key]: config })[key];
    if (!config.enabled)
      return createGateResult({
        gateId,
        status: "skipped",
        summary: `Java ${definition[2]}检查已关闭`,
      });
    const facts =
      key === "javaFiles" ? null : await collect({ root, key, config, signal });
    diagnostics = (facts?.executions ?? []).flatMap((execution) =>
      processOutputDiagnostics(execution, {
        source: "第三方 Maven 原始诊断",
        root,
      }),
    );
    const findings = facts
      ? evaluateJavaEngineering(key, facts, config)
      : evaluateJavaFiles(files ?? listIndexFiles(root), config);
    const artifacts = (facts?.modules ?? []).flatMap((module) =>
      [
        ...(module.reports ?? []).map((report) => report.path),
        ...(module.outputs ?? []).map((output) => output.path),
        module.coverageReport,
        module.effectivePom,
        module.dependencyTree,
      ]
        .filter(Boolean)
        .map((file) => ({
          path: file,
          type: "java-native-output",
          description: `模块 ${module.name} 的 Java 原生报告或产物`,
        })),
    );
    return createGateResult({
      gateId,
      status: findings.length ? "violation" : "passed",
      summary: `Java ${definition[2]}检查${findings.length ? "未通过" : "已通过"}`,
      findings,
      diagnostics,
      artifacts,
      metrics: {
        modules: facts?.modules.length ?? 0,
        violations: findings.length,
        executedTests: (facts?.modules ?? []).reduce(
          (sum, module) => sum + (module.executed ?? 0),
          0,
        ),
      },
      durationMs: Date.now() - startedAt,
    });
  } catch (cause) {
    if (cause.javaExecutions)
      diagnostics = cause.javaExecutions.flatMap((execution) =>
        processOutputDiagnostics(execution, {
          source: "第三方 Maven 原始诊断",
          root,
        }),
      );
    const error = toRepoGuardError(cause, {
      code: "java/check-failed",
      message: `Java ${definition[2]}检查无法完成`,
    });
    return createGateResult({
      gateId,
      status: errorStatus(error),
      summary: error.message,
      error,
      diagnostics,
      durationMs: Date.now() - startedAt,
    });
  }
}
export const javaEngineeringGates = Object.freeze(
  definitions.map(([key, suffix, label], index) =>
    definePlatformGate({
      id: `java.${suffix}`,
      configKey: `checks.${key}`,
      featureName: key,
      featureOrder: 500 + index * 10,
      doctorOrder: 500 + index * 10,
      manualOrder: 500 + index * 10,
      manualCommand: `java-${suffix}`,
      packageScript: `guard:java-${suffix}`,
      environments: [
        "manual",
        ...(key === "javaFiles" ? ["pre-commit", "ci-policy"] : []),
        "pre-push",
        "ci-full",
        "release-ready",
      ],
      ciScopes: ["all-files"],
      defaultTimeoutMs: JAVA_ENGINEERING_DEFAULTS[key].timeoutMs ?? 30000,
      supportsCancellation: key !== "javaFiles",
      inspectSetup: ({ root, config }) => {
        const check = validateJavaEngineeringChecks({
          [key]: config.checks[key],
        })[key];
        if (!check.enabled) return readyGateSetup(`Java ${label}检查已禁用`);
        if (check.enabled && key !== "javaFiles")
          inspectJavaEngineeringSetup(root, check);
        return readyGateSetup(`Java ${label}检查配置已就绪`);
      },
      plan: ({ config }) => ({ enabled: config.checks[key]?.enabled ?? false }),
      run: ({ root, config, plan, signal }) =>
        runJavaEngineeringGate({
          root,
          key,
          config: {
            ...(config.checks[key] ?? JAVA_ENGINEERING_DEFAULTS[key]),
            enabled: plan?.enabled ?? config.checks[key]?.enabled ?? false,
          },
          signal,
        }),
    }),
  ),
);
