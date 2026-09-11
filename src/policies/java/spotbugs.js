import path from 'node:path';

const priorities = Object.freeze({ high: 1, normal: 2, low: 3 });
const priorityLabels = Object.freeze({ 1: '高', 2: '普通', 3: '低' });

export function evaluateSpotbugs(facts, config) {
  return facts.modules.flatMap((module) => module.report.bugs
    .filter((bug) => bug.priority <= priorities[config.priority] && !config.excludeBugPatterns.includes(bug.type))
    .map((bug) => ({
      ruleId: `java/spotbugs/${bug.type}`,
      severity: 'error',
      message: `模块 ${module.name} 命中 SpotBugs 规则 ${bug.type}（${priorityLabels[bug.priority]}置信优先级），请复核并修复对应代码`,
      ...(bug.location ? { location: { ...bug.location, path: path.posix.join(module.sourceDirectory, bug.location.path) } } : {}),
      expected: '生产代码通过团队声明的 SpotBugs 通用缺陷检查。',
    })));
}
