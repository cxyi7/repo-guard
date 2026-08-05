import path from 'node:path';
import micromatch from 'micromatch';
import { collectStagedChanges } from './git-changes.js';
import { runGit } from './git.js';

function matches(filePath, patterns, { nocase = false } = {}) {
  return micromatch.isMatch(filePath, patterns, {
    dot: true,
    nocase,
  });
}

function isDeleted(change) {
  return change.status.startsWith('D');
}

function isNewLocation(change) {
  return change.status === '??'
    || change.status.startsWith('A')
    || change.status.startsWith('C')
    || change.status.startsWith('R');
}

function shouldCheck(change, mode) {
  if (isDeleted(change)) {
    return false;
  }
  return mode === 'changedFiles' || isNewLocation(change);
}

export function inspectFilePlacement({ changes, config, files = null }) {
  const includedFiles = files ? new Set(files) : null;
  const violations = [];
  let checkedCount = 0;

  for (const change of changes) {
    if (
      !shouldCheck(change, config.mode)
      || (includedFiles && !includedFiles.has(change.path))
    ) {
      continue;
    }
    const rule = config.rules.find(({ patterns }) => (
      matches(change.path, patterns, { nocase: true })
    ));
    if (!rule) {
      continue;
    }
    checkedCount += 1;
    if (
      matches(change.path, rule.exceptions)
      || matches(change.path, rule.allowedPatterns)
    ) {
      continue;
    }
    violations.push({
      ...change,
      rule,
      suggestedPath: `${rule.suggestedDirectory}/${path.posix.basename(change.path)}`,
    });
  }

  return { checkedCount, violations };
}

export function buildFilePlacementAiInstructions(
  violations,
  { conclusion = '提交已停止。' } = {},
) {
  const lines = [
    '文件位置规范检查失败，可将以下指令分别交给 AI 修复：',
  ];

  violations.forEach((violation, index) => {
    const current = violation.oldPath
      ? `${violation.oldPath} -> ${violation.path}`
      : violation.path;
    lines.push(
      '',
      `${index + 1}. 请移动位置不符合规范的${violation.rule.name}。`,
      `   当前文件：${current}`,
      `   建议目标：${violation.suggestedPath}`,
      '   允许位置：',
      ...violation.rule.allowedPatterns.map((pattern) => `   - ${pattern}`),
      '   修改要求：移动文件后，同步更新 Vue、JavaScript、CSS、HTML 和 Markdown 中的全部引用路径。',
      '   验证要求：确认没有失效引用或重复资源，并运行项目已有的 lint、测试和构建命令。',
      '   禁止绕过：不要复制出重复文件，不要修改门禁规则、关闭开关或加入 exceptions。',
      '   完成后重新暂存移动后的文件、原路径删除记录和全部引用修改。',
    );
  });

  lines.push('', `共 ${violations.length} 个文件位置不符合规范，${conclusion}`);
  return lines.join('\n');
}

export function runFilePlacementFiles({ root, files, config }) {
  const changes = collectStagedChanges(root);
  const result = inspectFilePlacement({
    changes,
    config,
    files: files.map(({ relative }) => relative),
  });
  if (result.violations.length > 0) {
    console.error(buildFilePlacementAiInstructions(result.violations));
    return 1;
  }

  console.log(`File placement passed: ${result.checkedCount} staged file(s) checked.`);
  return 0;
}

export function collectProjectFiles(root) {
  const parsePaths = (output) => output
    .split('\0')
    .filter(Boolean)
    .map((filePath) => filePath.replace(/\\/g, '/'));
  const deleted = new Set(parsePaths(runGit(
    ['ls-files', '--deleted', '-z'],
    { cwd: root },
  ).stdout));

  return parsePaths(runGit(
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root },
  ).stdout).filter((filePath) => !deleted.has(filePath));
}

export function runFilePlacementProject({ root, config }) {
  const files = collectProjectFiles(root);
  const result = inspectFilePlacement({
    changes: files.map((filePath) => ({
      status: 'A',
      oldPath: null,
      path: filePath,
    })),
    config: { ...config, mode: 'changedFiles' },
  });
  if (result.violations.length > 0) {
    console.error(buildFilePlacementAiInstructions(
      result.violations,
      { conclusion: '全仓检查未通过。' },
    ));
    return 1;
  }

  console.log(
    `File placement project check passed: ${result.checkedCount} of ${files.length} file(s) matched rules.`,
  );
  return 0;
}
