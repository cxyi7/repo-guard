import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collectStagedChanges } from '../git/change-collection.js';
import { classifyChanges, displayPath } from './change-classification.js';
import { gitValue, runGit } from '../git/execution.js';
import { resolveGitPath } from '../git/repository.js';
import { configurationError } from '../core/error/repo-guard-error.js';
import {
  clearCommitMessageState,
  readCommitMessageState,
  saveCommitMessageState,
} from '../git/repository-state.js';

const AUTO_HEADING = '【自动变更文件】';
const MARKER_BEGIN = '<!-- repo-guard:files:start -->';
const MARKER_END = '<!-- repo-guard:files:end -->';
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const STATE_VERSION = 2;

function readCurrentCommitMessageState(root) {
  const state = readCommitMessageState(root);
  const target = resolveGitPath(root, 'repo-guard-commit-message.json');
  if (state === null && !existsSync(target)) return null;
  if (state?.version !== STATE_VERSION) {
    throw configurationError(
      'commit-message/unsupported-state-version',
      `提交信息临时状态仅支持 version: ${STATE_VERSION}；旧版、未知或无法解析的状态已保留，请人工确认后重新提交。`,
      {
        details: { location: { path: target } },
        expected: '只使用本版本生成的提交信息状态，不改写或清理无法识别的状态文件。',
        remediation: {
          goal: '保留原始提交内容并重新建立当前格式的临时状态。',
          steps: ['确认没有仍在运行的 Git 提交，再人工核对并处理遗留状态文件。', '重新运行 git commit，由当前 Hook 创建状态。'],
          constraints: ['不要改写版本号绕过校验或删除仍被使用的状态文件。'],
          verification: ['本轮 Hook 不再报告 commit-message/unsupported-state-version。'],
        },
      },
    );
  }
  return state;
}

function resolveMessagePath(root, messageFile) {
  return path.isAbsolute(messageFile) ? messageFile : path.join(root, messageFile);
}

function resolveBase(root, source, sourceCommit) {
  if (source === 'commit' && sourceCommit) {
    return gitValue(['rev-parse', `${sourceCommit}^`], EMPTY_TREE, root);
  }
  return gitValue(['rev-parse', '--verify', 'HEAD'], EMPTY_TREE, root);
}

function buildState(root, config, base, { source = '', sourceCommit = '' } = {}) {
  const changes = collectStagedChanges(root, base);
  const classified = new Map(
    classifyChanges(changes, config).map((change) => [
      `${change.oldPath || ''}\0${change.path}`,
      change,
    ]),
  );

  return {
    version: STATE_VERSION,
    base,
    source,
    sourceCommit,
    indexTree: runGit(['write-tree'], { cwd: root }).stdout.trim(),
    changes: changes.map((change) => {
      const protectedChange = classified.get(`${change.oldPath || ''}\0${change.path}`);
      return protectedChange
        ? {
            ...change,
            category: protectedChange.category,
            level: protectedChange.level,
          }
        : change;
    }),
  };
}

function buildBlock(state, marked) {
  const protectedCount = state.changes.filter(({ category }) => Boolean(category)).length;
  const lines = [
    AUTO_HEADING,
    `文件总数：${state.changes.length}`,
    `受保护文件：${protectedCount}`,
  ];

  if (state.changes.length === 0) {
    lines.push('- 无文件变化（仅修改提交信息）');
  } else {
    for (const change of state.changes) {
      const suffix = change.category
        ? `（受保护：${change.level}/${change.category}）`
        : '';
      lines.push(`- ${change.status} ${displayPath(change)}${suffix}`);
    }
  }

  return marked
    ? [MARKER_BEGIN, ...lines, MARKER_END].join('\n')
    : lines.join('\n');
}

function removeAutoBlock(message) {
  const markerExpression = new RegExp(
    `(?:\\r?\\n)*${MARKER_BEGIN}[\\s\\S]*?${MARKER_END}(?:\\r?\\n)*`,
    'g',
  );
  let cleaned = message.replace(markerExpression, '\n').trimEnd();

  const headingIndex = cleaned.lastIndexOf(AUTO_HEADING);
  if (headingIndex >= 0) {
    const beforeHeading = cleaned.slice(0, headingIndex);
    const candidate = cleaned.slice(headingIndex);
    if (/^【自动变更文件】\r?\n文件总数：/.test(candidate)) {
      cleaned = beforeHeading.trimEnd();
    }
  }

  return cleaned;
}

function writeMessage(root, messageFile, state, marked) {
  const target = resolveMessagePath(root, messageFile);
  const original = readFileSync(target, 'utf8');
  const cleaned = removeAutoBlock(original);
  const separator = cleaned ? '\n\n' : '';
  writeFileSync(target, `${cleaned}${separator}${buildBlock(state, marked)}\n`, 'utf8');
}

export function prepareCommitMessage(root, config, messageFile, source = '', sourceCommit = '') {
  readCurrentCommitMessageState(root);
  const base = resolveBase(root, source, sourceCommit);
  const state = buildState(root, config, base, { source, sourceCommit });
  saveCommitMessageState(root, state);
  writeMessage(root, messageFile, state, true);
}

export function readPreparedCommitMessage(root, messageFile) {
  const state = readCurrentCommitMessageState(root);
  const target = resolveMessagePath(root, messageFile);
  return Object.freeze({
    message: removeAutoBlock(readFileSync(target, 'utf8')),
    source: state?.source ?? '',
    sourceCommit: state?.sourceCommit ?? '',
  });
}

export function finalizeCommitMessage(root, config, messageFile) {
  let state = readCurrentCommitMessageState(root);
  const currentTree = runGit(['write-tree'], { cwd: root }).stdout.trim();

  if (!state || state.indexTree !== currentTree) {
    const base = state?.base || gitValue(['rev-parse', '--verify', 'HEAD'], EMPTY_TREE, root);
    state = buildState(root, config, base, {
      source: state?.source ?? '',
      sourceCommit: state?.sourceCommit ?? '',
    });
    saveCommitMessageState(root, state);
  }

  writeMessage(root, messageFile, state, false);
}

export function cleanupCommitMessage(root) {
  readCurrentCommitMessageState(root);
  clearCommitMessageState(root);
}
