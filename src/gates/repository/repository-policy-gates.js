import path from 'node:path';
import { defineGate } from '../../core/capability/gate-definition.js';
import { changeSetEntries } from '../../core/capability/gate-context.js';
import { inspectDependencyPolicy, inspectStagedDependencyPolicy } from './dependency-policy.js';
import { inspectExceptionLifecycle } from '../../config/exception-lifecycle.js';
import { inspectFilePlacement } from '../../policies/file-placement.js';
import {
  evaluateMaxFileLines,
  selectMaxFileLineFiles,
} from '../../policies/max-file-lines.js';
import { findingFromPolicy, passedResult, skippedResult, violationResult } from '../native-result.js';
import { classifyChanges, displayPath } from '../../policies/change-classification.js';
import { createStagedFingerprint } from '../../git/staged-fingerprint.js';
import {
  assertLocalEnvironmentNotStaged,
  resolveNotificationEnvironment,
} from '../../policies/local-environment.js';
import { notificationWasSent, saveNotificationState } from '../../git/repository-state.js';
import { sendWecomNotification } from '../../integrations/wecom/notification.js';
import {
  buildNotificationText,
  loadNotificationConfig,
} from '../../policies/wecom-notification.js';
import { codePlacementGate } from './code-placement-gate.js';

const CONFIG_VERSION = [1];

function ready(summary) { return { status: 'ready', summary }; }

function projectFiles(context) {
  return context.files.map((file) => {
    if (typeof file !== 'string') return file;
    return { relative: file, absolute: path.join(context.root, file) };
  });
}

function policyFinding(item, fallbackRule, fallbackRemediation = null) {
  return findingFromPolicy({ ...item, rule: item.rule ?? fallbackRule }, {
    remediation: item.remediation ?? fallbackRemediation,
  });
}

function protectedFileFinding(change, action) {
  const immutable = change.level === 'block';
  const blocking = action === 'fail' || immutable;
  const affectedPath = displayPath(change);
  let message = `${affectedPath} 受保护（${change.category}）`;
  let expected = '受保护文件变更必须按项目策略完成记录或通知';
  let remediation = null;

  if (immutable) {
    message = `${affectedPath} 命中了不可变文件规则（${change.category}），不允许修改、删除、重命名或移动`;
    expected = `文件必须保持在 ${change.oldPath ?? change.path}，且内容不得变更`;
    remediation = {
      goal: '撤销不可变文件的本次变更',
      steps: [
        `恢复 ${change.oldPath ?? change.path} 的原始路径和内容`,
        '如果业务确实需要变更，先由维护者评审并调整对应保护规则',
      ],
      constraints: ['不得通过重命名、移动、删除后重建或改写内容绕过不可变文件规则'],
      verification: ['重新暂存变更并再次运行提交门禁'],
    };
  } else if (blocking) {
    message = `${affectedPath} 受保护（${change.category}），当前 CI 策略要求阻断`;
    expected = '当前 CI 策略不允许受保护文件变更进入目标分支';
    remediation = {
      goal: '处理当前受保护文件变更',
      steps: ['撤销该变更，或按项目流程完成评审后调整 CI 保护文件策略'],
      constraints: ['不得跳过或绕过 CI 保护文件门禁'],
      verification: ['重新运行 repo-guard ci 并确认保护文件步骤通过'],
    };
  }

  return {
    ruleId: 'repository/protected-file',
    severity: blocking ? 'error' : 'warning',
    message,
    location: { path: change.path },
    evidence: [
      { message: `Git 变更状态：${change.status}` },
      { message: `保护级别：${change.level}` },
    ],
    expected,
    remediation,
  };
}

export const exceptionRegistryGate = defineGate({
  id: 'repository.structured-exceptions', configKey: 'exceptions', configVersions: CONFIG_VERSION,
  environments: ['manual', 'ci-policy', 'ci-full', 'release-ready'], mutation: 'read-only', defaultTimeoutMs: 30000,
  manualCommand: 'exceptions', manualOrder: 10, packageScript: 'guard:exceptions',
  inspectSetup: () => ready('结构化例外注册表'), plan: () => ({}),
  run({ config }) {
    const result = inspectExceptionLifecycle(config.exceptions);
    const invalid = [...result.expired, ...result.future];
    if (invalid.length === 0) return passedResult('repository.structured-exceptions', `结构化例外均在有效期内（${result.active.length} 条生效）`, { metrics: { entries: result.entries.length, active: result.active.length, expiring: result.expiring.length } });
    return violationResult('repository.structured-exceptions', '结构化例外包含无效日期', {
      findings: invalid.map((entry) => ({
        ruleId: 'exceptions/invalid-date',
        severity: 'error',
        message: `例外 ${entry.id} 状态为${result.expired.includes(entry) ? '已过期' : '创建日期晚于当前日期'}`,
        remediation: '删除该例外，或经过人工复审后更新其日期。',
      })),
    });
  },
});

export const dependencyPolicyGate = defineGate({
  id: 'dependencies.policy', configKey: 'dependencyPolicy', featureName: 'dependencies', featureOrder: 80,
  configVersions: CONFIG_VERSION, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'], mutation: 'read-only', defaultTimeoutMs: 120000,
  manualCommand: 'dependencies', manualOrder: 20, doctorOrder: 120, packageScript: 'guard:dependencies',
  inspectSetup: ({ config }) => ready(config.dependencyPolicy.enabled ? '依赖策略已启用' : '依赖策略已禁用'),
  plan: ({ config, changes, environment }) => ({
    enabled: environment === 'manual' || config.dependencyPolicy.enabled,
    applicable: environment !== 'pre-commit' || changeSetEntries(changes).some((change) => ['package.json', 'package-lock.json'].includes(change.path ?? change.relative)),
  }),
  run({ root, config, plan, environment }) {
    if (!plan.enabled) return skippedResult('dependencies.policy', '依赖策略已禁用');
    if (!plan.applicable) return skippedResult('dependencies.policy', '根包元数据未变更');
    const result = environment === 'pre-commit'
      ? inspectStagedDependencyPolicy({ root, config: config.dependencyPolicy, exceptions: config.exceptions })
      : inspectDependencyPolicy({ root, config: config.dependencyPolicy, exceptions: config.exceptions });
    if (result.violations.length === 0) return passedResult('dependencies.policy', '依赖策略已通过', { metrics: { approvedExceptions: result.approved.length } });
    return violationResult('dependencies.policy', `依赖策略发现 ${result.violations.length} 项违规`, {
      findings: result.violations.map((item) => policyFinding(
        item,
        item.rule,
        '请更新 package.json，运行 npm install --package-lock-only，并提交同步后的 package-lock.json；同时保留精确版本、已批准来源和锁文件完整性。',
      )),
      metrics: { violations: result.violations.length, approvedExceptions: result.approved.length },
    });
  },
});

export const filePlacementGate = defineGate({
  id: 'repository.file-placement', configKey: 'preCommit.filePlacement', featureName: 'filePlacement', featureOrder: 40,
  configVersions: CONFIG_VERSION, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'], mutation: 'read-only', defaultTimeoutMs: 120000,
  manualCommand: 'file-placement', manualOrder: 150, doctorOrder: 150, packageScript: 'guard:file-placement',
  inspectSetup: ({ config }) => ready(config.preCommit.filePlacement.enabled ? '文件归类策略已启用' : '文件归类策略已禁用'),
  plan: ({ config, changes, files, environment }) => ({
    enabled: environment === 'manual' || config.preCommit.filePlacement.enabled,
    changes: environment === 'manual'
      ? files.map((file) => ({ status: 'A', oldPath: null, path: typeof file === 'string' ? file : file.relative }))
      : changeSetEntries(changes),
  }),
  run({ config, plan }) {
    if (!plan.enabled) return skippedResult('repository.file-placement', '文件归类策略已禁用');
    const result = inspectFilePlacement({ changes: plan.changes, config: config.preCommit.filePlacement });
    if (result.violations.length === 0) return passedResult('repository.file-placement', '文件归类策略已通过', { diagnostics: [{ level: 'info', message: `文件归类项目检查已通过：${result.checkedCount} 个文件匹配规则。` }], metrics: { checkedFiles: result.checkedCount } });
    return violationResult('repository.file-placement', `文件归类策略发现 ${result.violations.length} 项违规`, {
      findings: result.violations.map((item) => ({ ruleId: 'repository/file-placement', severity: 'error', message: `${item.path} 必须放置在允许的目录下`, location: { path: item.path }, remediation: `将其移动到 ${item.suggestedPath}` })),
      metrics: { checkedFiles: result.checkedCount, violations: result.violations.length },
    });
  },
});

export const maximumFileLinesGate = defineGate({
  id: 'repository.maximum-file-lines', configKey: 'preCommit.maxFileLines', featureName: 'maxFileLines', featureOrder: 50,
  configVersions: CONFIG_VERSION, environments: ['pre-commit', 'ci-policy', 'ci-full', 'release-ready'], mutation: 'read-only', defaultTimeoutMs: 120000, doctorOrder: 140,
  ciScopes: ['all-files', 'changed-files'],
  inspectSetup: ({ config }) => ready(config.preCommit.maxFileLines.enabled ? '最大文件行数策略已启用' : '最大文件行数策略已禁用'),
  plan: ({ root, config, files, revision, changes }) => ({
    enabled: config.preCommit.maxFileLines.enabled,
    files: selectMaxFileLineFiles(projectFiles({ root, files }), config.preCommit.maxFileLines),
    baselineRef: revision?.base ?? null,
    changes: changeSetEntries(changes),
  }),
  run({ root, config, plan }) {
    if (!plan.enabled || plan.files.length === 0) return skippedResult('repository.maximum-file-lines', '最大文件行数策略没有适用文件');
    const result = evaluateMaxFileLines({ root, files: plan.files, config: config.preCommit.maxFileLines, baselineRef: plan.baselineRef, changes: plan.changes });
    const warningFindings = result.warnings.map((item) => ({
      ruleId: 'repository/maximum-file-lines',
      severity: 'warning',
      message: `${item.path} 有 ${item.lineCount} 行；上限为 ${item.maxLines}`,
      location: { path: item.path },
      remediation: '在文件超过配置上限前将其拆分。',
    }));
    if (result.violations.length === 0) return passedResult('repository.maximum-file-lines', '最大文件行数策略已通过', { findings: warningFindings, metrics: { checkedFiles: plan.files.length, warnings: result.warnings.length } });
    return violationResult('repository.maximum-file-lines', `最大文件行数策略发现 ${result.violations.length} 项违规`, {
      findings: result.violations.map((item) => ({ ruleId: 'repository/maximum-file-lines', severity: 'error', message: `${item.path} 有 ${item.lineCount} 行；上限为 ${item.maxLines}`, location: { path: item.path }, remediation: `重构文件，使其不超过 ${item.passLineCount ?? item.maxLines} 行，且不得削弱已配置规则。` })),
      metrics: { checkedFiles: plan.files.length, violations: result.violations.length },
    });
  },
});

export const protectedFilesGate = defineGate({
  id: 'repository.protected-files',
  configVersions: CONFIG_VERSION,
  environments: ['pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
  mutation: 'external-write',
  allowedMutations: ['external-write', 'read-only'],
  defaultTimeoutMs: 120000,
  inspectSetup: () => ready('受保护文件策略'),
  plan: ({ config, changes, step, dryRun = false, forceNotify = false }) => ({
    action: step?.mutation === 'read-only' ? config.ci.protectedFiles.action : 'notify',
    protectedChanges: classifyChanges(changeSetEntries(changes), config),
    stagedChanges: changeSetEntries(changes),
    dryRun,
    forceNotify,
  }),
  async run({ root, config, plan }) {
    assertLocalEnvironmentNotStaged(plan.stagedChanges);
    const findings = plan.protectedChanges.map((change) => (
      protectedFileFinding(change, plan.action)
    ));
    if (findings.length === 0) {
      return passedResult('repository.protected-files', '没有受保护文件发生变更', {
        metrics: { protectedChanges: 0 },
      });
    }
    const blockedChanges = findings.filter(({ severity }) => severity === 'error');
    if (blockedChanges.length > 0) {
      return violationResult('repository.protected-files', `受保护文件策略阻止 ${blockedChanges.length} 项变更`, {
        findings,
        metrics: {
          blockedChanges: blockedChanges.length,
          protectedChanges: findings.length,
        },
      });
    }
    const notifyChanges = plan.protectedChanges.filter(({ level }) => level === 'notify');
    const diagnostics = findings.map(({ message }) => ({ level: 'warn', message }));
    if (notifyChanges.length === 0 || !config.notification.enabled) {
      return passedResult('repository.protected-files', findings.length === 0
        ? '没有受保护文件发生变更'
        : `已记录 ${findings.length} 项受保护文件变更`, {
        diagnostics,
        metrics: { protectedChanges: findings.length },
      });
    }
    const fingerprint = createStagedFingerprint(root, notifyChanges);
    const content = buildNotificationText(root, notifyChanges, fingerprint);
    if (plan.dryRun) diagnostics.push({ level: 'info', message: content });
    else if (!plan.forceNotify && notificationWasSent(root, fingerprint)) {
      diagnostics.push({ level: 'info', message: '已跳过重复的受保护文件通知' });
    } else {
      const { webhook, mentionMobiles } = loadNotificationConfig(resolveNotificationEnvironment(root));
      await sendWecomNotification(webhook, content, mentionMobiles);
      saveNotificationState(root, fingerprint);
      diagnostics.push({ level: 'info', message: '已发送企业微信受保护文件通知' });
    }
    return passedResult('repository.protected-files', `已处理 ${findings.length} 项受保护文件变更`, {
      diagnostics,
      metrics: { protectedChanges: findings.length, notifications: notifyChanges.length },
    });
  },
});

export const repositoryPolicyGates = Object.freeze([
  exceptionRegistryGate,
  dependencyPolicyGate, filePlacementGate, codePlacementGate,
  maximumFileLinesGate, protectedFilesGate,
]);
