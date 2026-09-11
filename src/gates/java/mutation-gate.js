import { JAVA_MUTATION_DEFAULTS, validateJavaMutationChecks } from '../../config/java-mutation.js';
import { errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { processOutputDiagnostics } from '../../core/execution/process-output.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { collectJavaMutationFacts, inspectJavaMutationSetup } from '../../integrations/java/mutation/collect.js';
import { evaluateJavaMutation } from '../../policies/java/mutation.js';
import { definePlatformGate, readyGateSetup } from '../platform-gate.js';

const gateId = 'java.mutation-test';
function diagnostics(executions, root) {
  return executions.flatMap((execution) => processOutputDiagnostics(execution, { source: '第三方 Maven / PIT 原始诊断', root }));
}
export async function runJavaMutationGate({ root, config, signal, collect = collectJavaMutationFacts }) {
  const startedAt = Date.now();
  let executions = [];
  try {
    config = validateJavaMutationChecks({ javaMutationTest: config }).javaMutationTest;
    if (!config.enabled) return createGateResult({ gateId, status: 'skipped', summary: 'Java 变异测试已关闭' });
    const facts = await collect({ root, config, signal });
    executions = facts.executions;
    const findings = evaluateJavaMutation(facts, config);
    const mutations = facts.modules.flatMap((module) => module.mutations ?? []);
    return createGateResult({
      gateId, status: findings.length ? 'violation' : 'passed', summary: `Java 变异测试${findings.length ? '未通过' : '已通过'}`, findings,
      diagnostics: diagnostics(executions, root),
      artifacts: facts.modules.flatMap((module) => [...module.reports.map((report) => report.path), ...(module.mutations ? [module.mutationReport, module.effectivePom].filter(Boolean) : [])].map((file) => ({ path: file, type: 'java-native-output', description: `模块 ${module.name} 的原生测试或变异检查报告` }))),
      metrics: { modules: facts.modules.length, executedTests: facts.modules.reduce((total, module) => total + module.executed, 0), mutations: mutations.length, killed: mutations.filter((entry) => entry.status === 'KILLED').length, survived: mutations.filter((entry) => entry.status === 'SURVIVED').length, uncovered: mutations.filter((entry) => entry.status === 'NO_COVERAGE').length, violations: findings.length },
      durationMs: Date.now() - startedAt,
    });
  } catch (cause) {
    const error = toRepoGuardError(cause, { code: 'java/pit-check-failed', message: 'Java 变异测试无法完成' });
    return createGateResult({ gateId, status: errorStatus(error), summary: error.message, error, diagnostics: diagnostics(cause.javaExecutions ?? executions, root), durationMs: Date.now() - startedAt });
  }
}
export const javaMutationGate = definePlatformGate({
  id: gateId, configKey: 'checks.javaMutationTest', featureName: 'javaMutationTest', featureOrder: 590, doctorOrder: 590, manualOrder: 590,
  manualCommand: 'java-mutation-test', packageScript: 'guard:java-mutation-test',
  environments: ['manual', 'pre-push', 'ci-full', 'release-ready'], ciScopes: ['all-files'],
  defaultTimeoutMs: JAVA_MUTATION_DEFAULTS.javaMutationTest.timeoutMs, supportsCancellation: true,
  inspectSetup: ({ root, config }) => {
    const check = validateJavaMutationChecks({ javaMutationTest: config.checks.javaMutationTest }).javaMutationTest;
    if (check.enabled) inspectJavaMutationSetup(root, check);
    return readyGateSetup(check.enabled ? 'Java 变异测试路径和工具配置已就绪，PIT 有效配置将在运行时核对' : 'Java 变异测试已禁用');
  },
  plan: ({ config }) => ({ enabled: config.checks.javaMutationTest?.enabled ?? false }),
  run: ({ root, config, plan, signal }) => runJavaMutationGate({ root, signal, config: { ...(config.checks.javaMutationTest ?? JAVA_MUTATION_DEFAULTS.javaMutationTest), enabled: plan?.enabled ?? config.checks.javaMutationTest?.enabled ?? false } }),
});
