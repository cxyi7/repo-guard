import { loadWorkspace } from '../../config/configuration-loader.js';
import { CONFIG_FILE } from '../../config/validation-primitives.js';
import { configurationError, rangeError } from '../../core/error/repo-guard-error.js';
import { gitValue, runGit } from '../../git/execution.js';
import { readOptionalSnapshotFile } from '../../git/snapshot-content.js';
import { parsePrePushUpdates } from './change-range.js';
import { loadWorkspaceSnapshot } from '../workspace/configuration-snapshot.js';
import { DELIVERY_CONFIG_FILE } from '../../config/delivery-workspace.js';

const ZERO_SHA = /^0+$/;

function loadConfigAtRevision(root, revision) {
  const content = readOptionalSnapshotFile(root, revision, CONFIG_FILE);
  if (content === null) {
    const history = runGit(['log', '-1', '--format=%H', revision, '--', CONFIG_FILE], { cwd: root });
    if (history.stdout.trim()) {
      throw configurationError('pre-push/pushed-config-deleted', `待推送提交删除了已接入的 ${CONFIG_FILE}；请恢复配置后重新推送。`);
    }
    const binding = readOptionalSnapshotFile(root, revision, DELIVERY_CONFIG_FILE);
    if (binding !== null) return loadWorkspaceSnapshot(root, revision, { lazyProjects: true });
    const deliveryHistory = runGit(['log', '-1', '--format=%H', revision, '--', DELIVERY_CONFIG_FILE], { cwd: root });
    if (deliveryHistory.stdout.trim()) {
      throw configurationError('pre-push/pushed-delivery-config-deleted', `待推送提交删除了已接入的 ${DELIVERY_CONFIG_FILE}；请恢复交付配置后重新推送。`);
    }
    return null;
  }

  return loadWorkspaceSnapshot(root, revision, { lazyProjects: true });
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
      `待推送提交：${(pushedCommit || revision).slice(0, 12)}；`
      + `当前检出的 HEAD：${head.slice(0, 12) || 'unknown'}。`,
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
    const workspace = loadWorkspace(root, { lazyProjects: true });
    return { workspace, config: workspace.repositoryConfig, skip: false };
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
    workspace: loadConfigAtRevision(root, revision),
    revision,
  }));
  const gated = revisionConfigs.filter(({ workspace }) => (
    workspace?.projects.length > 0 || workspace?.deliveryOnly
  ));
  if (gated.length === 0) {
    const workspace = revisionConfigs.find((entry) => entry.workspace)?.workspace;
    if (!workspace) {
      return {
        config: null,
        skip: true,
        skipMessage: `待推送提交不包含 ${CONFIG_FILE}`,
      };
    }
    return { workspace, config: workspace.repositoryConfig, skip: false };
  }
  if (revisions.length !== 1) {
    throw rangeError(
      'pre-push/multiple-revisions',
      'pre-push 质量门禁无法安全地同时校验多个不同提交。 '
      + '请分别推送每个分支或标签。',
    );
  }

  assertExactPushSnapshot(root, revisions[0]);
  const workspace = revisionConfigs[0].workspace;
  return { workspace, config: workspace.repositoryConfig, skip: false };
}
