import { validateJavaPathNamingChecks } from "../../config/java-path-naming.js";
import {
  errorStatus,
  toRepoGuardError,
} from "../../core/error/repo-guard-error.js";
import { createGateResult } from "../../core/result/gate-result.js";
import { listIndexFiles } from "../../git/index-content.js";
import { evaluateJavaPathNaming } from "../../policies/java/path-naming.js";
import { definePlatformGate, readyGateSetup } from "../platform-gate.js";

export const javaPathNamingGate = definePlatformGate({
  id: "java.path-naming",
  configKey: "checks.javaPathNaming",
  featureName: "javaPathNaming",
  featureOrder: 570,
  doctorOrder: 570,
  manualOrder: 570,
  manualCommand: "java-path-naming",
  packageScript: "guard:java-path-naming",
  environments: [
    "manual",
    "pre-commit",
    "pre-push",
    "ci-policy",
    "ci-full",
    "release-ready",
  ],
  ciScopes: ["all-files"],
  defaultTimeoutMs: 30000,
  supportsCancellation: false,
  inspectSetup: ({ config }) => {
    const check = validateJavaPathNamingChecks(config.checks).javaPathNaming;
    return readyGateSetup(
      `Java 路径命名检查${check.enabled ? "配置已就绪" : "已禁用"}`,
    );
  },
  plan: ({ config }) => ({
    enabled: config.checks.javaPathNaming?.enabled ?? false,
  }),
  run: async ({ root, config, plan }) => {
    const startedAt = Date.now();
    try {
      const configured = validateJavaPathNamingChecks(
        config.checks,
      ).javaPathNaming;
      const check = validateJavaPathNamingChecks({
        javaPathNaming: {
          ...configured,
          enabled: plan?.enabled ?? configured.enabled,
        },
      }).javaPathNaming;
      if (!check.enabled)
        return createGateResult({
          gateId: "java.path-naming",
          status: "skipped",
          summary: "Java 路径命名检查已关闭",
        });
      const paths = listIndexFiles(root);
      const findings = evaluateJavaPathNaming(paths, check);
      return createGateResult({
        gateId: "java.path-naming",
        status: findings.length ? "violation" : "passed",
        summary: `Java 路径命名检查${findings.length ? "未通过" : "已通过"}`,
        findings,
        metrics: { indexedFiles: paths.length, violations: findings.length },
        durationMs: Date.now() - startedAt,
      });
    } catch (cause) {
      const error = toRepoGuardError(cause, {
        code: "java/path-naming-failed",
        message: "Java 路径命名检查无法完成",
      });
      return createGateResult({
        gateId: "java.path-naming",
        status: errorStatus(error),
        summary: error.message,
        error,
        durationMs: Date.now() - startedAt,
      });
    }
  },
});
