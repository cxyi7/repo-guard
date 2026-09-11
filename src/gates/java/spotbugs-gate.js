import { JAVA_SPOTBUGS_DEFAULTS, validateJavaSpotbugsChecks } from '../../config/java-spotbugs.js';
import { errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { collectSpotbugsFacts, inspectSpotbugsSetup } from '../../integrations/java/spotbugs/collect.js';
import { evaluateSpotbugs } from '../../policies/java/spotbugs.js';
import { definePlatformGate, readyGateSetup } from '../platform-gate.js';

function nativeDiagnostics(executions, root) {
  return executions.flatMap((execution) => processOutputDiagnostics(execution, { source: '第三方 Maven 与 SpotBugs 原始诊断', root }));
}
export async function runJavaSpotbugsGate({ root, config, signal, collect = collectSpotbugsFacts }) {
  const startedAt = Date.now();
  let diagnostics = [];
  try {
    config = validateJavaSpotbugsChecks({ javaSpotbugs: config }).javaSpotbugs;
    if (!config.enabled) return createGateResult({ gateId: 'java.spotbugs', status: 'skipped', summary: 'Java SpotBugs 检查已关闭' });
    const facts = await collect({ root, config, signal });
    diagnostics = [
      ...nativeDiagnostics(facts.executions, root),
      ...facts.modules.flatMap((module) => module.report.bugs.filter((bug) => bug.rawMessage).map((bug) => ({
        source: '第三方 SpotBugs 原生缺陷说明', level: 'log', message: `${module.name} / ${bug.type}: ${bug.rawMessage}`,
      }))),
    ];
    const findings = evaluateSpotbugs(facts, config);
    return createGateResult({
      gateId: 'java.spotbugs', status: findings.length ? 'violation' : 'passed',
      summary: `Java SpotBugs 检查${findings.length ? '未通过' : '已通过'}`,
      findings, diagnostics,
      artifacts: facts.modules.flatMap((module) => [module.reports[0], module.effectivePom].map((file) => ({
        path: file, type: 'java-native-output', description: `模块 ${module.name} 的 SpotBugs 原生证据`,
      }))),
      metrics: {
        modules: facts.modules.length,
        analyzedClasses: facts.modules.reduce((sum, module) => sum + module.report.classes.length, 0),
        detectedBugs: facts.modules.reduce((sum, module) => sum + module.report.bugs.length, 0),
        violations: findings.length,
      },
      durationMs: Date.now() - startedAt,
    });
  } catch (cause) {
    if (cause.javaExecutions) diagnostics = nativeDiagnostics(cause.javaExecutions, root);
    const error = toRepoGuardError(cause, { code: 'java/spotbugs-failed', message: 'Java SpotBugs 检查无法完成' });
    return createGateResult({ gateId: 'java.spotbugs', status: errorStatus(error), summary: error.message, error, diagnostics, durationMs: Date.now() - startedAt });
  }
}
export const javaSpotbugsGate = definePlatformGate({
  id: 'java.spotbugs', configKey: 'checks.javaSpotbugs', featureName: 'javaSpotbugs',
  featureOrder: 580, doctorOrder: 580, manualOrder: 580,
  manualCommand: 'java-spotbugs', packageScript: 'guard:java-spotbugs',
  environments: ['manual', 'pre-push', 'ci-full', 'release-ready'], ciScopes: ['all-files'],
  defaultTimeoutMs: JAVA_SPOTBUGS_DEFAULTS.javaSpotbugs.timeoutMs, supportsCancellation: true,
  inspectSetup: ({ root, config }) => {
    const check = validateJavaSpotbugsChecks({ javaSpotbugs: config.checks.javaSpotbugs }).javaSpotbugs;
    if (check.enabled) inspectSpotbugsSetup(root, check);
    return readyGateSetup(check.enabled ? 'Java SpotBugs 配置已就绪，插件与报告在执行时核验' : 'Java SpotBugs 检查已关闭');
  },
  plan: ({ config }) => ({ enabled: config.checks.javaSpotbugs?.enabled ?? false }),
  run: ({ root, config, plan, signal }) => runJavaSpotbugsGate({
    root, signal,
    config: { ...(config.checks.javaSpotbugs ?? JAVA_SPOTBUGS_DEFAULTS.javaSpotbugs), enabled: plan?.enabled ?? config.checks.javaSpotbugs?.enabled ?? false },
  }),
});
