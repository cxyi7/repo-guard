import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collectStagedChanges } from '../git/change-collection.js';
import { classifyChanges, displayPath } from './change-classification.js';
import { gitValue, runGit } from '../git.js';
import {
  clearCommitMessageState,
  readCommitMessageState,
  saveCommitMessageState,
} from '../integrations/git/repository-state.js';

const AUTO_HEADING = '【自动变更文件】';
const MARKER_BEGIN = '<!-- repo-guard:files:start -->';
const MARKER_END = '<!-- repo-guard:files:end -->';
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function resolveMessagePath(root, messageFile) {
  return path.isAbsolute(messageFile) ? messageFile : path.join(root, messageFile);
}

function resolveBase(root, source, sourceCommit) {
  if (source === 'commit' && sourceCommit) {
    return gitValue(['rev-parse', `${sourceCommit}^`], EMPTY_TREE, root);
  }
  return gitValue(['rev-parse', '--verify', 'HEAD'], EMPTY_TREE, root);
}

function buildState(root, config, base) {
  const changes = collectStagedChanges(root, base);
  const classified = new Map(
    classifyChanges(changes, config).map((change) => [
      `${change.oldPath || ''}\0${change.path}`,
      change,
    ]),
  );

  return {
    version: 1,
    base,
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
  const base = resolveBase(root, source, sourceCommit);
  const state = buildState(root, config, base);
  saveCommitMessageState(root, state);
  writeMessage(root, messageFile, state, true);
}

export function finalizeCommitMessage(root, config, messageFile) {
  let state = readCommitMessageState(root);
  const currentTree = runGit(['write-tree'], { cwd: root }).stdout.trim();

  if (!state || state.version !== 1 || state.indexTree !== currentTree) {
    const base = state?.base || gitValue(['rev-parse', '--verify', 'HEAD'], EMPTY_TREE, root);
    state = buildState(root, config, base);
    saveCommitMessageState(root, state);
  }

  writeMessage(root, messageFile, state, false);
}

export function cleanupCommitMessage(root) {
  clearCommitMessageState(root);
}
