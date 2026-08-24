const CONVENTIONAL_HEADER = /^([a-z][a-z0-9-]*)(?:\(([a-z0-9][a-z0-9._/@-]*)\))?(!)?: (.+)$/u;
const FIXUP_HEADER = /^(fixup|squash)! (.+)$/u;
const REVERT_HEADER = /^Revert "[^"\r\n]+"$/u;
const REVERT_FOOTER = /^This reverts commit [0-9a-f]{7,40}\.$/imu;
const BREAKING_FOOTER = /(?:^|\n\n)(?:BREAKING CHANGE|BREAKING-CHANGE):[ \t]+\S/iu;

function issue(rule, message) {
  return Object.freeze({ rule, message });
}

function normalizedCommentCharacter(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value || value === 'auto') return '#';
  return [...value][0];
}

export function normalizeCommitMessage(value, commentCharacter = null) {
  const comment = normalizedCommentCharacter(commentCharacter);
  const lines = String(value).replace(/^\uFEFF/u, '').replace(/\r\n?|\n/g, '\n').split('\n');
  const scissors = comment == null
    ? -1
    : lines.findIndex((line) => (
        line.includes('------------------------ >8 ------------------------')
      ));
  const relevant = scissors >= 0 ? lines.slice(0, scissors) : lines;
  return relevant
    .filter((line) => comment == null || !line.trimStart().startsWith(comment))
    .join('\n')
    .trim();
}

function fixupAllowed(config, environment) {
  if (environment === 'local') return config.fixup.allowLocal;
  if (environment === 'pre-push') return config.fixup.allowPush;
  return config.fixup.allowCi;
}

function headerLengthIssue(header, config) {
  const length = [...header].length;
  return length > config.headerMaxLength
    ? issue(
        'commit-message/header-length',
        `提交标题有 ${length} 个字符，超过上限 ${config.headerMaxLength}`,
      )
    : null;
}

function inspectConventionalMessage(
  message,
  config,
  { headerOnly = false, inspectHeaderLength = true } = {},
) {
  const [header = ''] = message.split('\n');
  const issues = [];
  const lengthProblem = inspectHeaderLength ? headerLengthIssue(header, config) : null;
  if (lengthProblem) issues.push(lengthProblem);
  const match = CONVENTIONAL_HEADER.exec(header);
  if (!match || header !== header.trim()) {
    issues.push(issue(
      'commit-message/format',
      '提交标题必须使用 type(scope)!: 简要说明 格式；scope 和 ! 可以按配置省略',
    ));
    return Object.freeze({
      breakingChange: false,
      header,
      issues: Object.freeze(issues),
      kind: 'conventional',
    });
  }
  const [, type, scope = null, marker = '', subject] = match;
  if (!config.types.includes(type)) {
    issues.push(issue(
      'commit-message/type',
      `提交类型 ${type} 不在允许列表中：${config.types.join('、')}`,
    ));
  }
  if (config.requireScope && !scope) {
    issues.push(issue('commit-message/scope-required', '提交标题必须包含 scope'));
  }
  if (scope && config.allowedScopes.length > 0 && !config.allowedScopes.includes(scope)) {
    issues.push(issue(
      'commit-message/scope',
      `提交 scope ${scope} 不在允许列表中：${config.allowedScopes.join('、')}`,
    ));
  }
  if (!subject.trim() || subject !== subject.trim()) {
    issues.push(issue('commit-message/subject', '提交标题的简要说明不得为空或包含首尾空格'));
  }
  const hasMarker = marker === '!';
  const hasFooter = !headerOnly && BREAKING_FOOTER.test(message);
  const breakingChange = hasMarker || hasFooter;
  if (breakingChange && !config.breakingChange.allowed) {
    issues.push(issue('commit-message/breaking-not-allowed', '项目不允许提交不兼容变更声明'));
  } else if (breakingChange && config.breakingChange.requireMarker && !hasMarker) {
    issues.push(issue('commit-message/breaking-marker', '不兼容变更的标题必须在冒号前使用 ! 标记'));
  }
  if (!headerOnly
    && breakingChange
    && config.breakingChange.allowed
    && config.breakingChange.requireFooter
    && !hasFooter) {
    issues.push(issue(
      'commit-message/breaking-footer',
      '不兼容变更必须在正文中提供 BREAKING CHANGE: 迁移说明',
    ));
  }
  return Object.freeze({
    breakingChange,
    header,
    issues: Object.freeze(issues),
    kind: 'conventional',
  });
}

export function inspectCommitMessage({
  message,
  parents = [],
  commentCharacter = null,
}, config, environment) {
  const normalized = normalizeCommitMessage(message, commentCharacter);
  if (!normalized) {
    return Object.freeze({
      breakingChange: false,
      header: '',
      issues: Object.freeze([issue('commit-message/empty', '提交信息不得为空')]),
      kind: 'empty',
    });
  }
  const [header = ''] = normalized.split('\n');
  const isMerge = parents.length > 1;
  if (isMerge) {
    return Object.freeze({
      breakingChange: false,
      header,
      issues: Object.freeze(config.merge.allowed
        ? []
        : [issue('commit-message/merge-not-allowed', '项目不允许创建 merge commit')]),
      kind: 'merge',
    });
  }
  if (REVERT_HEADER.test(header)) {
    const valid = REVERT_FOOTER.test(normalized);
    const issues = [];
    if (!config.revert.allowed) {
      issues.push(issue('commit-message/revert-not-allowed', '项目不允许创建 revert commit'));
    } else if (!valid) {
      issues.push(issue(
        'commit-message/revert-format',
        'revert commit 必须保留 Git 生成的被回退提交 SHA',
      ));
    }
    return Object.freeze({
      breakingChange: false,
      header,
      issues: Object.freeze(issues),
      kind: 'revert',
    });
  }
  const fixup = FIXUP_HEADER.exec(header);
  if (fixup) {
    const inspected = inspectConventionalMessage(fixup[2], config, {
      headerOnly: true,
      inspectHeaderLength: false,
    });
    const lengthProblem = headerLengthIssue(header, config);
    const lifecycleIssues = fixupAllowed(config, environment)
      ? []
      : [issue(
          'commit-message/temporary-commit',
          `${fixup[1]}! 是临时整理提交，必须在${environment === 'pre-push' ? '推送' : '进入 CI'}前完成 autosquash`,
        )];
    return Object.freeze({
      breakingChange: false,
      header,
      issues: Object.freeze([
        ...lifecycleIssues,
        ...(lengthProblem ? [lengthProblem] : []),
        ...inspected.issues,
      ]),
      kind: fixup[1],
    });
  }
  return inspectConventionalMessage(normalized, config);
}
