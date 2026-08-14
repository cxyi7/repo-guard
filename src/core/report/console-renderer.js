const STREAM_BY_LEVEL = Object.freeze({
  log: 'stdout',
  info: 'stdout',
  warn: 'stderr',
  error: 'stderr',
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
    { stream, message: `   类型: ${issue.kind}` },
    { stream, message: `   规则: ${issue.ruleId}` },
    { stream, message: `   代码: ${issue.code}` },
    { stream, message: `   严重级别: ${issue.severity}` },
    { stream, message: `   位置: ${location}` },
    { stream, message: `   问题: ${issue.message}` },
  ];
  for (const evidence of issue.evidence) {
    const evidenceLocation = findingLocation(evidence.location).trim();
    lines.push({
      stream,
      message: `   证据 Evidence: ${evidence.message}${evidenceLocation ? ` (${evidenceLocation})` : ''}`,
    });
  }
  lines.push({ stream, message: `   预期: ${issue.expected}` });
  lines.push({ stream, message: `   修复 Remediation: ${issue.remediation.goal}` });
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
    message: `   决策: ${issue.decision.aiAction}; humanApprovalRequired=${issue.decision.humanApprovalRequired}`,
  });
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
    lines.push({ stream: 'stdout', message: `SKIP  ${label}` });
  } else if (result.status === 'passed') {
    lines.push({ stream: 'stdout', message: `PASS  ${label}` });
  } else if (result.status === 'violation') {
    lines.push({ stream: 'stderr', message: `FAIL  ${label}` });
  } else lines.push({ stream: 'stderr', message: `ERROR ${label}` });
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
