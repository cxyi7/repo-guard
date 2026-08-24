import { configurationError, rangeError } from '../../core/error/repo-guard-error.js';
import { defineGate } from '../../core/capability/gate-definition.js';
import { collectCommitMessages } from '../../git/commit-messages.js';
import { readFileAtRevision } from '../../git/revision-content.js';
import { inspectCommitMessage } from '../../policies/commit-message.js';
import { passedResult, skippedResult, violationResult } from '../native-result.js';

const GATE_ID = 'repository.commit-message';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function versionMajor(value, label) {
  const match = SEMVER.exec(value);
  if (!match) {
    throw configurationError(
      'commit-message/invalid-package-version',
      `${label}必须是精确 SemVer 版本，当前值为 ${String(value)}`,
      { details: { location: { path: 'package.json' } } },
    );
  }
  return Number(match[1]);
}

function previousPackageVersion(root, base) {
  const result = readFileAtRevision(root, base, 'package.json');
  if (!result.exists) return null;
  try {
    return JSON.parse(result.content).version;
  } catch (error) {
    throw configurationError(
      'commit-message/unreadable-previous-package-version',
      `无法读取基准提交中的 package.json 版本：${error.message}`,
      { cause: error, details: { location: { path: 'package.json' } } },
    );
  }
}

function currentPackageVersion(root, head) {
  const result = readFileAtRevision(root, head, 'package.json');
  if (!result.exists) {
    throw configurationError(
      'commit-message/missing-package-version',
      '无法读取目标提交中的 package.json 版本',
      { details: { location: { path: 'package.json' } } },
    );
  }
  try {
    return JSON.parse(result.content).version;
  } catch (error) {
    throw configurationError(
      'commit-message/unreadable-package-version',
      `无法读取目标提交中的 package.json 版本：${error.message}`,
      { cause: error, details: { location: { path: 'package.json' } } },
    );
  }
}

function commitFinding(record, problem) {
  const shortSha = record.sha ? record.sha.slice(0, 12) : '当前提交';
  const header = String(record.message).replace(/^\uFEFF/u, '').split(/\r?\n/)[0].trim();
  return {
    ruleId: problem.rule,
    code: problem.rule,
    severity: 'error',
    message: `${shortSha}：${problem.message}`,
    evidence: [
      { type: 'git-commit', message: `提交：${shortSha}` },
      { type: 'commit-header', message: `标题：${header || '<empty>'}` },
    ],
    expected: '提交信息使用 type(scope)!: 简要说明 格式，并满足项目配置的类型、scope 和特殊提交策略。',
    remediation: {
      goal: '将提交信息改为符合项目规范且能够准确说明变更意图的内容',
      steps: record.sha
        ? ['使用 git rebase -i 修改对应提交信息；fixup!/squash! 提交应先完成 autosquash']
        : ['修改 Git 提交消息文件后重新提交'],
      constraints: ['不得通过 --no-verify、伪造 Merge/Revert 标题或关闭门禁绕过校验'],
      verification: [record.sha ? '重新推送并确认提交信息门禁通过' : '重新执行 git commit'],
    },
  };
}

function versionFinding(previousVersion, currentVersion) {
  return {
    ruleId: 'commit-message/breaking-version',
    code: 'commit-message/breaking-version',
    severity: 'error',
    message: `发布范围包含不兼容变更，但版本 ${previousVersion} → ${currentVersion} 没有提升 major`,
    location: { path: 'package.json' },
    evidence: [{
      type: 'semver-release',
      message: `基准版本：${previousVersion}；当前版本：${currentVersion}`,
    }],
    expected: '包含 BREAKING CHANGE 的发布必须提升 package.json 的 major 版本。',
    remediation: {
      goal: '按照 SemVer 为不兼容变更选择新的 major 版本',
      steps: ['更新 package.json、package-lock.json、README 和 CHANGELOG 中的版本'],
      constraints: ['不得删除 BREAKING CHANGE 声明来规避 major 版本要求'],
      verification: ['重新运行 release-ready 并确认提交信息门禁通过'],
    },
  };
}

export function createCommitMessageResult({
  records,
  config,
  environment,
  previousVersion = null,
  currentVersion = null,
}) {
  const inspected = records.map((record) => ({
    record,
    result: inspectCommitMessage(record, config, environment),
  }));
  const findings = inspected.flatMap(({ record, result }) => (
    result.issues.map((problem) => commitFinding(record, problem))
  ));
  const breakingChanges = inspected.filter(({ result }) => result.breakingChange).length;
  if (environment === 'release-ready'
    && breakingChanges > 0
    && config.breakingChange.requireMajorVersionOnRelease
    && previousVersion != null
    && versionMajor(currentVersion, '当前 package.json 版本')
      <= versionMajor(previousVersion, '基准提交 package.json 版本')) {
    findings.push(versionFinding(previousVersion, currentVersion));
  }
  const metrics = {
    commits: records.length,
    breakingChanges,
    violations: findings.length,
  };
  return findings.length === 0
    ? passedResult(GATE_ID, `提交信息门禁已通过：检查 ${records.length} 条提交`, { metrics })
    : violationResult(GATE_ID, `提交信息门禁发现 ${findings.length} 项违规`, { findings, metrics });
}

export const commitMessageGate = defineGate({
  id: GATE_ID,
  configKey: 'commitMessage',
  featureName: 'commitMessage',
  featureOrder: 70,
  configVersions: [1],
  environments: ['pre-push', 'ci-policy', 'ci-full', 'release-ready'],
  mutation: 'read-only',
  defaultTimeoutMs: 30000,
  doctorOrder: 15,
  rules: [
    'commit-message/empty',
    'commit-message/header-length',
    'commit-message/format',
    'commit-message/type',
    'commit-message/scope-required',
    'commit-message/scope',
    'commit-message/subject',
    'commit-message/breaking-not-allowed',
    'commit-message/breaking-marker',
    'commit-message/breaking-footer',
    'commit-message/breaking-version',
    'commit-message/merge-not-allowed',
    'commit-message/revert-not-allowed',
    'commit-message/revert-format',
    'commit-message/temporary-commit',
  ],
  inspectSetup: ({ config }) => ({
    status: 'ready',
    summary: config.commitMessage.enabled ? '提交信息门禁已启用' : '提交信息门禁已禁用',
  }),
  plan: ({ config, revision }) => ({
    enabled: config.commitMessage.enabled,
    revision,
  }),
  run({ root, config, environment, plan }) {
    if (!plan.enabled) return skippedResult(GATE_ID, '提交信息门禁已禁用');
    if (!plan.revision?.base || !plan.revision?.head) {
      throw rangeError(
        'commit-message/revision-missing',
        '提交信息门禁无法确定待检查的 Git base/head 范围',
      );
    }
    const records = collectCommitMessages(root, plan.revision);
    const requireVersion = environment === 'release-ready'
      && config.commitMessage.breakingChange.requireMajorVersionOnRelease;
    return createCommitMessageResult({
      records,
      config: config.commitMessage,
      environment,
      previousVersion: requireVersion
        ? previousPackageVersion(root, plan.revision.base)
        : null,
      currentVersion: requireVersion
        ? currentPackageVersion(root, plan.revision.head)
        : null,
    });
  },
});
