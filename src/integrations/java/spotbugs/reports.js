import { executionError } from '../../../core/error/repo-guard-error.js';
import { parseJavaXml } from '../engineering/reports.js';

function invalid(message) {
  throw executionError('java/spotbugs-invalid-report', `SpotBugs 原生报告无效：${message}`);
}
function integer(value, label, minimum = 0) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) {
    invalid(`${label} 必须是有效整数`);
  }
  return Number(value);
}
function one(node, name) {
  const matches = node.children.filter((item) => item.name === name);
  if (matches.length !== 1) invalid(`必须包含唯一的 ${name}`);
  return matches[0];
}
function sourceLocation(bug) {
  const locations = bug.children.filter((item) => item.name === 'SourceLine');
  const source = locations.find((item) => item.attributes.primary === 'true') ?? locations[0];
  if (!source) return null;
  const file = source.attributes.sourcepath;
  if (!file || file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.replaceAll('\\', '/').split('/').includes('..')) return null;
  const start = source.attributes.start;
  return { path: file.replaceAll('\\', '/'), ...(start && /^\d+$/.test(start) && Number(start) > 0 ? { line: Number(start) } : {}) };
}
export function parseSpotbugsReport(content) {
  const document = parseJavaXml(content, 'BugCollection');
  const rootElements = new Set(['Project', 'BugInstance', 'BugCategory', 'BugPattern', 'BugCode', 'Errors', 'FindBugsSummary', 'ClassFeatures', 'History', 'SuppressionFilter']);
  if (document.children.some((item) => !rootElements.has(item.name))) invalid('报告包含当前格式不支持的根级元素');
  if (!/^4\./.test(document.attributes.version ?? '')) invalid('仅支持 SpotBugs 4.x 原生 XML');
  const analysisTimestamp = integer(document.attributes.analysisTimestamp, 'analysisTimestamp', 1);
  const errors = one(document, 'Errors');
  if (integer(errors.attributes.errors, 'errors') !== 0 || integer(errors.attributes.missingClasses, 'missingClasses') !== 0
    || errors.children.some((item) => ['Error', 'MissingClass'].includes(item.name))) invalid('分析存在错误或缺少依赖类，不能作为通过证据');
  const summary = one(document, 'FindBugsSummary');
  const classCount = integer(summary.attributes.total_classes, 'total_classes', 1);
  const classes = summary.children.filter((item) => item.name === 'PackageStats')
    .flatMap((item) => item.children.filter((entry) => entry.name === 'ClassStats').map((entry) => entry.attributes.class));
  if (classes.length !== classCount || classes.some((item) => !item) || new Set(classes).size !== classes.length) invalid('类统计缺失、重复或与汇总不一致');
  const bugs = document.children.filter((item) => item.name === 'BugInstance').map((bug) => {
    const type = bug.attributes.type;
    const priority = integer(bug.attributes.priority, 'priority', 1);
    if (!/^[A-Z][A-Z0-9_]+$/.test(type ?? '') || priority > 3) invalid('缺陷类型或优先级无效');
    const rawMessage = bug.children.find((item) => item.name === 'LongMessage')?.text.trim() ?? '';
    return { type, priority, location: sourceLocation(bug), rawMessage };
  });
  if (integer(summary.attributes.total_bugs, 'total_bugs') !== bugs.length) invalid('缺陷总数与明细不一致');
  for (const priority of [1, 2, 3]) {
    if (integer(summary.attributes[`priority_${priority}`] ?? '0', `priority_${priority}`) !== bugs.filter((bug) => bug.priority === priority).length) {
      invalid('优先级统计与缺陷明细不一致');
    }
  }
  const project = one(document, 'Project');
  if (!project.children.some((item) => item.name === 'Jar' && item.text.trim())) invalid('缺少被分析的字节码输入');
  return { analysisTimestamp, classes, bugs };
}
