import { loadConfig } from '../../config/configuration-loader.js';
import { validateConfig } from '../../config/configuration-validation.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import { configurationError, rangeError } from '../../core/error/repo-guard-error.js';
import { gitValue, runGit } from '../../git/execution.js';
import { assertExceptionLifecycleCurrent } from '../../config/exception-lifecycle.js';
import { parsePrePushUpdates } from './change-range.js';

const ZERO_SHA = /^0+$/;

function loadConfigAtRevision(root, revision) {
  const result = runGit(
    ['show', `${revision}:${CONFIG_FILE}`],
    { allowFailure: true, cwd: root },
  );
  if (result.status !== 0) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw configurationError(
      'pre-push/invalid-pushed-config',
      `无法解析 ${CONFIG_FILE}，来源为已推送提交 ${revision.slice(0, 12)}: `
      + error.message,
    );
  }
  const config = validateConfig(parsed, CONFIG_FILE);
  assertExceptionLifecycleCurrent(config.exceptions);
  return config;
}

function usesPrePushGate(config) {
  return config?.accessibilityTest.enabled
    || config?.typeCheck.enabled
    || config?.unitTest.enabled
    || config?.architecture.enabled
    || config?.build.enabled
    || config?.lighthouse.enabled;
}

function assertExactPushSnapshot(root, revision) {
  const head = gitValue(['rev-parse', '--verify', 'HEAD'], '', root);
  const pushedCommit = gitValue(
    ['rev-parse', '--verify', `${revision}^{commit}`],
    '',
    root,
  );
  if (!head || !pushedCommit || head !== pushedCommit) {
    throw rangeError('pre-push/snapshot-mismatch', [
      '预推送质量门禁只能验证当前检出的 HEAD。',
      `Pushed commit: ${(pushedCommit || revision).slice(0, 12)}; `
      + `checked-out HEAD: ${head.slice(0, 12) || 'unknown'}.`,
      '请检出待推送分支，并单独推送该分支。',
    ].join('\n'));
  }

  const status = runGit(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: root },
  ).stdout.trim();
  if (status) {
    const changed = status.split(/\r?\n/).slice(0, 10);
    throw rangeError('pre-push/dirty-working-tree', [
      '预推送质量门禁要求工作树保持干净，以便准确测试待推送提交。',
      ...changed.map((line) => `- ${line}`),
      ...(status.split(/\r?\n/).length > changed.length ? ['- ...'] : []),
      '请提交、暂存或移除这些变更，然后重新推送。',
    ].join('\n'));
  }
}

export function resolvePushConfig(root, input) {
  if (!String(input || '').trim()) {
    return { config: loadConfig(root), skip: false };
  }

  const updates = parsePrePushUpdates(input)
    .filter(({ localSha }) => !ZERO_SHA.test(localSha));
  if (updates.length === 0) {
    return {
      config: null,
      skip: true,
      skipMessage: '输入中仅包含已删除的引用',
    };
  }

  const revisions = [...new Set(updates.map(({ localSha }) => localSha))];
  const revisionConfigs = revisions.map((revision) => ({
    config: loadConfigAtRevision(root, revision),
    revision,
  }));
  const gated = revisionConfigs.filter(({ config }) => usesPrePushGate(config));
  if (gated.length === 0) {
    const config = revisionConfigs.find((entry) => entry.config)?.config;
    if (!config) {
      return {
        config: null,
        skip: true,
        skipMessage: `待推送提交不包含 ${CONFIG_FILE}`,
      };
    }
    return { config, skip: false };
  }
  if (revisions.length !== 1) {
    throw rangeError(
      'pre-push/multiple-revisions',
      'pre-push 质量门禁无法安全地同时校验多个不同提交。 '
      + '请分别推送每个分支或标签。',
    );
  }

  assertExactPushSnapshot(root, revisions[0]);
  return { config: revisionConfigs[0].config, skip: false };
}
