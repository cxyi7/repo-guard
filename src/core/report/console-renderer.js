const STREAM_BY_LEVEL = Object.freeze({
  log: 'stdout',
  info: 'stdout',
  warn: 'stderr',
  error: 'stderr',
});
const ISSUE_KIND_LABELS = Object.freeze({
  violation: '规则违规',
  configuration: '配置错误',
  execution: '执行错误',
  range: '范围错误',
  security: '安全错误',
  internal: '内部错误',
  cancellation: '执行取消',
});
const SEVERITY_LABELS = Object.freeze({
  info: '提示',
  warning: '警告',
  error: '错误',
});
const AI_ACTION_LABELS = Object.freeze({
  'modify-code': '修改代码',
  'update-configuration': '修改配置',
  'review-security-impact': '审查安全影响',
  'inspect-diagnostics-and-modify-code': '检查诊断并修改代码',
});

function resultStream(result) {
  return result.status === 'passed' || result.status === 'skipped' ? 'stdout' : 'stderr';
}

function findingLocation(location) {
  if (!location) return '';
  const position = [location.line, location.column]
    .filter((value) => value != null)
    .join(':');
  return ` ${location.path}${position ? `:${position}` : ''}`;
}

function renderIssue(issue, index, total) {
  const stream = issue.severity === 'info' ? 'stdout' : 'stderr';
  const location = findingLocation(issue.location).trim() || '（无具体文件位置）';
  const lines = [
    { stream, message: `问题 ${index + 1}/${total} [${issue.id}] [${issue.ruleId}] ${location}` },
    { stream, message: `   类型: ${ISSUE_KIND_LABELS[issue.kind] ?? '未知类型'}（${issue.kind}）` },
    { stream, message: `   规则: ${issue.ruleId}` },
    { stream, message: `   代码: ${issue.code}` },
    { stream, message: `   严重级别: ${SEVERITY_LABELS[issue.severity] ?? '未知级别'}（${issue.severity}）` },
    { stream, message: `   位置: ${location}` },
    { stream, message: `   问题: ${issue.message}` },
  ];
  for (const evidence of issue.evidence) {
    const evidenceLocation = findingLocation(evidence.location).trim();
    lines.push({
      stream,
      message: `   证据: ${evidence.message}${evidenceLocation ? ` (${evidenceLocation})` : ''}`,
    });
  }
  lines.push({ stream, message: `   预期: ${issue.expected}` });
  lines.push({ stream, message: `   修复目标: ${issue.remediation.goal}` });
  issue.remediation.steps.forEach((step, stepIndex) => {
    lines.push({ stream, message: `      ${stepIndex + 1}. ${step}` });
  });
  if (issue.remediation.constraints.length > 0) {
    lines.push({ stream, message: `   约束: ${issue.remediation.constraints.join('；')}` });
  }
  if (issue.remediation.verification.length > 0) {
    lines.push({ stream, message: `   验证: ${issue.remediation.verification.join('；')}` });
  }
  lines.push({
    stream,
    message: `   处理方式: ${AI_ACTION_LABELS[issue.decision.aiAction] ?? '按机器动作标识处理'}`,
  });
  lines.push({
    stream,
    message: `   需要人工确认: ${issue.decision.humanApprovalRequired ? '是' : '否'}`,
  });
  lines.push({ stream, message: `   机器动作标识: ${issue.decision.aiAction}` });
  lines.push({ stream, message: `   指纹: ${issue.fingerprint}` });
  return lines;
}

export function renderGateResultConsole(result, { label = result.gateId } = {}) {
  const failureStream = result.status === 'passed' || result.status === 'skipped'
    ? null
    : 'stderr';
  const lines = result.diagnostics.map((diagnostic) => ({
    stream: failureStream ?? STREAM_BY_LEVEL[diagnostic.level],
    message: diagnostic.message,
  }));
  const issues = result.issues;
  issues.forEach((issue, index) => lines.push(...renderIssue(issue, index, issues.length)));
  if (result.diagnostics.length === 0 && issues.length === 0) {
    lines.push({ stream: resultStream(result), message: result.summary });
  }
  if (result.status === 'skipped') {
    lines.push({ stream: 'stdout', message: `跳过  ${label}` });
  } else if (result.status === 'passed') {
    lines.push({ stream: 'stdout', message: `通过  ${label}` });
  } else if (result.status === 'violation') {
    lines.push({ stream: 'stderr', message: `未通过  ${label}` });
  } else lines.push({ stream: 'stderr', message: `错误  ${label}` });
  return lines;
}

export function writeGateResultConsole(result, options) {
  const groups = [];
  for (const line of renderGateResultConsole(result, options)) {
    const current = groups.at(-1);
    if (current?.stream === line.stream) current.messages.push(line.message);
    else groups.push({ stream: line.stream, messages: [line.message] });
  }
  for (const group of groups) {
    writeConsoleMessage(group.messages.join('\n'), group.stream);
  }
}

export function writeConsoleMessage(message, stream = 'stdout') {
  if (stream === 'stderr') console.error(message);
  else console.log(message);
}
