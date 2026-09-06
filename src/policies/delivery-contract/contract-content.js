import { sectionHasContent } from './markdown.js';

const OBLIGATION_ID = /^[A-Z][A-Z0-9-]*-\d{3}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ISO_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const FINDING_ACTORS = new Set(['ai', 'human', 'gate', 'ci', 'production']);
const FINDING_PHASES = new Set([
  'development',
  'self-test',
  'ci',
  'test-environment',
  'human-acceptance',
  'production',
]);
const FINDING_STATES = new Set([
  'reported',
  'investigating',
  'reproduced',
  'classified',
  'planned',
  'fixing',
  'verified',
  'human-retested',
  'closed',
  'rejected',
  'deferred',
]);
const TERMINAL_FINDING_STATES = new Set(['closed', 'rejected', 'deferred']);
const INLINE_SECTION = Object.freeze({
  design: 'Design',
  examples: 'Examples',
  spec: 'Spec',
  tasks: 'Tasks',
  visuals: 'Visuals',
});

function problem(issues, message) {
  issues.push({ rule: 'delivery-contract/content', message });
}

function hasCompletedDetail(value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== 'pending';
}

function requiredSections(parsed, issues) {
  for (const name of ['交付目标', '非目标', '验收条件']) {
    if (!parsed.sections.has(name)) problem(issues, `Markdown 正文缺少“## ${name}”章节`);
  }
  for (const name of ['交付目标', '非目标', '验收条件']) {
    if (!sectionHasContent(parsed, name)) problem(issues, `“## ${name}”章节不得为空`);
  }
  for (const name of ['交付执行清单', '交付发现']) {
    if (parsed.sections.has(name)) {
      problem(issues, `schemaVersion 2 主合同不得包含“## ${name}”；请使用独立组成文件`);
    }
  }
  for (const [name, item] of Object.entries(parsed.data.artifactPlan?.items ?? {})) {
    if (INLINE_SECTION[name] && item.mode === 'inline' && !sectionHasContent(parsed, INLINE_SECTION[name])) {
      problem(issues, `${name} 计划为 inline 时，“## ${INLINE_SECTION[name]}”章节不得为空`);
    }
  }
}

function validateObligations(parsed, issues) {
  const items = parsed.obligations;
  if (items.length === 0) {
    problem(issues, 'obligations 组成文件必须至少包含一个受约束的 GFM 复选项');
    return new Map();
  }
  const byId = new Map();
  for (const item of items) {
    if (!OBLIGATION_ID.test(item.id)) {
      problem(issues, `清单 id ${item.id} 必须为大写稳定标识并以三位数字结尾`);
    }
    if (byId.has(item.id)) problem(issues, `清单 id 重复：${item.id}`);
    byId.set(item.id, item);
    if (!['ai', 'gate', 'human'].includes(item.details['执行者'])) {
      problem(issues, `清单 ${item.id} 必须通过“执行者”声明 ai、gate 或 human`);
    }
    if (item.details['执行者'] === 'gate' && !hasCompletedDetail(item.details['门禁'])) {
      problem(issues, `Gate 清单 ${item.id} 必须登记可重新执行的“门禁”`);
    }
    if (
      item.checked
      && ['ai', 'gate'].includes(item.details['执行者'])
      && !hasCompletedDetail(item.details['证据'])
    ) {
      problem(issues, `已完成清单 ${item.id} 必须登记可复核的“证据”`);
    }
  }
  const planItems = items.filter(({ id }) => id.startsWith('HUMAN-PLAN-'));
  const acceptanceItems = items.filter(({ id }) => id.startsWith('HUMAN-ACCEPT-'));
  if (planItems.length !== 1) problem(issues, '清单必须且只能包含一个 HUMAN-PLAN-* 合同确认事项');
  if (acceptanceItems.length !== 1) problem(issues, '清单必须且只能包含一个 HUMAN-ACCEPT-* 最终验收事项');
  const planItem = planItems[0];
  const confirmation = parsed.data.confirmation;
  if (planItem) {
    if (planItem.details['执行者'] !== 'human') problem(issues, `${planItem.id} 的执行者必须为 human`);
    if (!planItem.checked) problem(issues, `${planItem.id} 必须由人工确认后勾选`);
    if (planItem.details['确认人'] !== confirmation?.confirmedBy) {
      problem(issues, `${planItem.id} 的确认人必须与 confirmation.confirmedBy 一致`);
    }
    if (planItem.details['确认时间'] !== confirmation?.confirmedAt) {
      problem(issues, `${planItem.id} 的确认时间必须与 confirmation.confirmedAt 一致`);
    }
    if (planItem.details['绑定定义指纹'] !== confirmation?.definitionDigest) {
      problem(issues, `${planItem.id} 必须绑定当前 confirmation.definitionDigest`);
    }
  }
  for (const trace of parsed.data.traceability ?? []) {
    for (const taskId of trace.tasks ?? []) {
      if (!byId.has(taskId)) problem(issues, `追踪关系中的任务 ${taskId} 未出现在交付执行清单`);
    }
    for (const verificationId of trace.verification ?? []) {
      if (!byId.has(verificationId)) {
        problem(issues, `追踪关系中的验证 ${verificationId} 未出现在交付执行清单`);
      }
    }
  }
  return byId;
}

function hasChecklistPart(finding, token) {
  return finding.checklist.some(({ id }) => id.includes(token));
}

function validatePromotionDecision(finding, issues) {
  const promotion = finding.checklist.find(({ id }) => id.includes('PROMOTION'));
  if (!promotion) return;
  for (const key of [
    '测试升级',
    '合同升级',
    '设计升级',
    '任务模板升级',
    '门禁升级',
    '结论',
    '确认人',
  ]) {
    if (!hasCompletedDetail(promotion.details[key])) {
      problem(issues, `交付发现 ${finding.id} 的升级决策缺少“${key}”`);
    }
  }
  if (!ISO_TIMEZONE.test(promotion.details['确认时间'] ?? '')) {
    problem(issues, `交付发现 ${finding.id} 的升级决策缺少有效人工确认时间`);
  }
}

function validateHumanRetest(finding, issues) {
  const retest = finding.checklist.find(({ id }) => id.includes('HUMAN-RETEST'));
  if (!retest) {
    problem(issues, `测试环境交付发现 ${finding.id} 缺少 HUMAN-RETEST 人工复测事项`);
    return;
  }
  if (retest.details['执行者'] !== 'human') {
    problem(issues, `${retest.id} 的执行者必须为 human`);
  }
  if (!hasCompletedDetail(retest.details['确认人'])) {
    problem(issues, `${retest.id} 缺少人工复测确认人`);
  }
  if (!ISO_TIMEZONE.test(retest.details['确认时间'] ?? '')) {
    problem(issues, `${retest.id} 缺少有效人工复测确认时间`);
  }
  if (!COMMIT.test(retest.details['测试环境部署提交'] ?? '')) {
    problem(issues, `${retest.id} 必须绑定测试环境实际部署的完整提交哈希`);
  }
}

function validateFinding(finding, obligationById, allIds, issues) {
  if (allIds.has(finding.id)) problem(issues, `交付发现 id 重复：${finding.id}`);
  allIds.add(finding.id);
  const required = [
    '发现者',
    '发现阶段',
    '发现时间',
    '问题版本',
    '类型',
    '严重程度',
    '重复特征',
    '关联任务',
    '当前状态',
  ];
  for (const key of required) {
    if (!finding.details[key] || finding.details[key] === 'pending') {
      problem(issues, `交付发现 ${finding.id} 缺少有效的“${key}”`);
    }
  }
  if (!FINDING_ACTORS.has(finding.details['发现者'])) {
    problem(issues, `交付发现 ${finding.id} 的发现者不受支持`);
  }
  if (!FINDING_PHASES.has(finding.details['发现阶段'])) {
    problem(issues, `交付发现 ${finding.id} 的发现阶段不受支持`);
  }
  if (!ISO_TIMEZONE.test(finding.details['发现时间'] ?? '')) {
    problem(issues, `交付发现 ${finding.id} 的发现时间必须是带时区的 ISO 8601 时间`);
  }
  if (!COMMIT.test(finding.details['问题版本'] ?? '')) {
    problem(issues, `交付发现 ${finding.id} 的问题版本必须是完整 Git 提交哈希`);
  }
  if (!FINDING_STATES.has(finding.details['当前状态'])) {
    problem(issues, `交付发现 ${finding.id} 的当前状态不属于完整反馈状态集合`);
  }
  const phase = finding.details['发现阶段'];
  const terminalState = TERMINAL_FINDING_STATES.has(finding.details['当前状态']);
  if (['test-environment', 'human-acceptance'].includes(phase)
    && !COMMIT.test(finding.details['测试环境部署提交'] ?? '')) {
    problem(issues, `测试环境交付发现 ${finding.id} 必须记录测试环境实际部署的完整提交哈希`);
  }
  const relatedTask = finding.details['关联任务'];
  if (hasCompletedDetail(relatedTask) && !obligationById.has(relatedTask)) {
    problem(issues, `交付发现 ${finding.id} 的关联任务 ${relatedTask} 不存在`);
  }
  if (hasCompletedDetail(relatedTask) && obligationById.has(relatedTask)
    && !terminalState
    && obligationById.get(relatedTask).checked) {
    problem(issues, `交付发现 ${finding.id} 尚未关闭，关联任务 ${relatedTask} 必须重新打开`);
  }
  if (finding.checklist.length === 0) problem(issues, `交付发现 ${finding.id} 缺少处理清单`);
  for (const item of finding.checklist) {
    if (allIds.has(item.id)) problem(issues, `合同中的清单 id 重复：${item.id}`);
    allIds.add(item.id);
    if (!OBLIGATION_ID.test(item.id)) {
      problem(issues, `交付发现清单 id ${item.id} 必须为大写稳定标识并以三位数字结尾`);
    }
    if (!['ai', 'gate', 'human'].includes(item.details['执行者'])) {
      problem(issues, `交付发现清单 ${item.id} 必须声明执行者 ai、gate 或 human`);
    }
  }
  for (const token of ['REGISTER', 'PROMOTION']) {
    if (!hasChecklistPart(finding, token)) problem(issues, `交付发现 ${finding.id} 缺少 ${token} 处理事项`);
  }
  if (['rejected', 'deferred'].includes(finding.details['当前状态'])) {
    if (!hasChecklistPart(finding, 'INVESTIGATE')) {
      problem(issues, `交付发现 ${finding.id} 在拒绝或延期前必须包含 INVESTIGATE 调查事项`);
    }
    for (const key of ['关闭原因', '确认人']) {
      if (!hasCompletedDetail(finding.details[key])) {
        problem(issues, `交付发现 ${finding.id} 状态为 ${finding.details['当前状态']} 时缺少“${key}”`);
      }
    }
    if (!ISO_TIMEZONE.test(finding.details['确认时间'] ?? '')) {
      problem(issues, `交付发现 ${finding.id} 的拒绝或延期结论缺少有效人工确认时间`);
    }
  } else {
    for (const token of ['REPRODUCE', 'CLASSIFY', 'VERIFY']) {
      if (!hasChecklistPart(finding, token)) problem(issues, `交付发现 ${finding.id} 缺少 ${token} 处理事项`);
    }
    if (finding.details['类型'] === 'implementation-gap') {
      for (const token of ['RED-TEST', 'FIX', 'GREEN-TEST']) {
        if (!hasChecklistPart(finding, token)) {
          problem(issues, `实现缺陷 ${finding.id} 缺少 ${token} 红—绿回归事项`);
        }
      }
    }
    if (['test-environment', 'human-acceptance'].includes(phase)) {
      validateHumanRetest(finding, issues);
    }
  }
  validatePromotionDecision(finding, issues);
  if (terminalState && finding.checklist.some(({ checked }) => !checked)) {
    problem(issues, `交付发现 ${finding.id} 进入终态时处理清单必须全部完成`);
  }
}

export function inspectContractContent(parsed) {
  const issues = [];
  requiredSections(parsed, issues);
  const obligationById = validateObligations(parsed, issues);
  const allIds = new Set(obligationById.keys());
  for (const finding of parsed.findings) {
    validateFinding(finding, obligationById, allIds, issues);
  }
  return { issues, obligationById };
}
