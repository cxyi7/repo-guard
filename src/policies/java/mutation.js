import { executionError } from '../../core/error/repo-guard-error.js';
import { createPitClassMatcher } from '../../integrations/java/mutation/scope.js';

function finding(rule, message, file) { return { ruleId: `java/mutation-${rule}`, severity: 'error', message, ...(file ? { location: { path: file } } : {}) }; }
export function evaluateMutationBaseline(modules) {
  return modules.flatMap((module) => [
    ...(!module.executed ? [finding('baseline-empty', `模块 ${module.name} 的基线测试没有实际执行，空测试或全部跳过不能通过`)] : []),
    ...(module.failed ? [finding('baseline-failed', `模块 ${module.name} 的基线测试有 ${module.failed} 项失败，先修复原始测试再运行变异检查`)] : []),
    ...(module.executed && !module.targetTestsExecuted ? [finding('baseline-scope-empty', `模块 ${module.name} 未执行 targetTests 范围内的基线测试`)] : []),
  ]);
}
export function evaluateJavaMutation(facts, config) {
  const baseline = evaluateMutationBaseline(facts.modules);
  if (facts.baselineFailed) return baseline;
  const findings = [...baseline];
  for (const module of facts.modules) {
    const mutations = module.mutations ?? [];
    const matches = createPitClassMatcher(module.targetClasses);
    for (const mutation of mutations) {
      if (!['KILLED', 'SURVIVED', 'NO_COVERAGE'].includes(mutation.status)) throw executionError('java/pit-incomplete-mutation', `模块 ${module.name} 的变异执行出现异常状态 ${mutation.status}，不能作为通过证据`);
      if (!matches(mutation.className)) throw executionError('java/pit-scope-mismatch', `模块 ${module.name} 的变异报告包含目标范围以外的类`);
    }
    if (!mutations.length) findings.push(finding('empty', `模块 ${module.name} 没有生成变异，不能通过`, module.mutationReport));
    const covered = mutations.filter((entry) => entry.status !== 'NO_COVERAGE').length;
    if (mutations.length && !covered) findings.push(finding('uncovered', `模块 ${module.name} 的变异全部未被测试覆盖，不能通过`, module.mutationReport));
    const killed = mutations.filter((entry) => entry.status === 'KILLED').length;
    const score = mutations.length ? killed * 100 / mutations.length : 0;
    if (mutations.length && score < config.threshold) findings.push(finding('threshold', `模块 ${module.name} 的变异得分为 ${score.toFixed(2)}%，低于 ${config.threshold}%；请补充能发现错误的测试断言`, module.mutationReport));
  }
  return findings;
}
