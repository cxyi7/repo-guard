import { normalizeGitPath } from '../config.js';
import { executionError } from '../core/error/repo-guard-error.js';
import { runGit } from '../git.js';

function malformedNameStatusError(code, message, { index, status }) {
  return executionError(code, message, {
    details: {
      evidence: [{
        type: 'git-name-status-protocol',
        message: `entry index: ${index}; status: ${status || '<missing>'}`,
      }],
    },
    expected: 'Git --name-status -z 为每条变更提供完整的状态和路径字段。',
    remediation: {
      goal: '恢复可靠的 Git 变更范围收集',
      steps: [
        '在同一仓库中直接运行对应的 git diff --name-status -z 命令',
        '检查 Git 安装、仓库对象和调用参数是否完整',
        '修复 Git 输出问题后重新运行原门禁',
      ],
      constraints: [
        '不得把无法解析的变更记录当作空变更跳过',
        '不得在范围不完整时继续执行受影响文件审查',
      ],
      verification: [
        '确认 Git 输出中的普通记录包含状态和路径',
        '确认重命名或复制记录包含状态、原路径和新路径',
      ],
    },
  });
}

export function parseNameStatus(output) {
  const entries = output.split('\0');
  const changes = [];
  let index = 0;

  while (index < entries.length) {
    const status = entries[index];
    index += 1;

    if (!status) {
      continue;
    }

    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = entries[index];
      const filePath = entries[index + 1];
      if (oldPath == null || filePath == null) {
        throw malformedNameStatusError(
          'git-changes/incomplete-rename-or-copy-entry',
          'Git 变更输出中的重命名或复制记录不完整',
          { index: index - 1, status },
        );
      }
      changes.push({
        status,
        oldPath: normalizeGitPath(oldPath),
        path: normalizeGitPath(filePath),
      });
      index += 2;
      continue;
    }

    const filePath = entries[index];
    if (filePath == null) {
      throw malformedNameStatusError(
        'git-changes/incomplete-file-entry',
        'Git 变更输出中的文件记录不完整',
        { index: index - 1, status },
      );
    }
    changes.push({
      status,
      oldPath: null,
      path: normalizeGitPath(filePath),
    });
    index += 1;
  }

  return changes;
}

function diffChanges(root, args) {
  const output = runGit(
    [
      'diff',
      ...args,
      '--name-status',
      '-z',
      '--diff-filter=ACMRDTUXB',
      '--find-renames',
    ],
    { cwd: root },
  ).stdout;
  return parseNameStatus(output);
}

export function collectRevisionChanges(root, base, head = 'HEAD') {
  return diffChanges(root, [base, head]).map((change) => ({
    ...change,
    baseSha: base,
    headSha: head,
  }));
}

export function collectStagedChanges(root, base = null) {
  const args = ['--cached'];
  if (base) {
    args.push(base);
  }
  return diffChanges(root, args);
}

export function collectWorkingTreeChanges(root) {
  const combined = new Map();

  const append = (change, state) => {
    const key = `${change.oldPath || ''}\0${change.path}`;
    const current = combined.get(key) || {
      ...change,
      states: new Set(),
    };
    current.states.add(state);
    combined.set(key, current);
  };

  for (const change of collectStagedChanges(root)) {
    append(change, 'staged');
  }

  for (const change of diffChanges(root, [])) {
    append(change, 'unstaged');
  }

  const untracked = runGit(
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: root },
  ).stdout
    .split('\0')
    .filter(Boolean);

  for (const filePath of untracked) {
    append(
      {
        status: '??',
        oldPath: null,
        path: normalizeGitPath(filePath),
      },
      'untracked',
    );
  }

  return [...combined.values()].map((change) => ({
    ...change,
    states: [...change.states].sort(),
  }));
}
