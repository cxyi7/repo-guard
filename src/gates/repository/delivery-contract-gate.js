import { defineGate } from '../../core/capability/gate-definition.js';
import { changeSetEntries } from '../../core/capability/gate-context.js';
import { findingFromPolicy, passedResult, skippedResult, violationResult } from '../native-result.js';
import { inspectDeliveryContract } from '../../policies/delivery-contract/repository.js';
import { inspectDeliveryContractSetup } from '../../policies/delivery-contract/setup.js';

function deliveryFinding(item, severity = 'error') {
  return findingFromPolicy(item, {
    severity,
    expected: '当前变更由唯一、已确认且未越界的交付合同覆盖。',
    remediation: {
      goal: '修正交付合同、功能归属、Git 绑定、需求快照或变更边界',
      steps: [
        '根据问题中的实际值修正合同或当前变更',
        '合同定义发生变化时提升 contractRevision、重新计算指纹并由人工重新确认',
        '重新暂存合同及配套文件后运行 repo-guard delivery-contract',
      ],
      constraints: [
        '不得由 AI 代替人工确认 HUMAN-* 事项',
        '不得通过扩大 allowedPaths、删除任务或关闭门禁来绕过问题',
      ],
      verification: ['确认 repository.delivery-contract 重新检查后通过'],
    },
  });
}

export const deliveryContractGate = defineGate({
  id: 'repository.delivery-contract',
  configKey: 'deliveryContract',
  featureName: 'deliveryContract',
  featureOrder: 85,
  configVersions: [1],
  environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
  mutation: 'read-only',
  defaultTimeoutMs: 120000,
  manualCommand: 'delivery-contract',
  manualOrder: 25,
  doctorOrder: 125,
  packageScript: 'guard:delivery-contract',
  rules: [
    'delivery-contract/unique-contract',
    'delivery-contract/feature-registry',
    'delivery-contract/path-boundary',
    'delivery-contract/definition-digest',
    'delivery-contract/revision-history',
    'delivery-contract/target-branch',
    'delivery-contract/historical-feedback',
  ],
  inspectSetup: inspectDeliveryContractSetup,
  plan: ({ config, changes, environment }) => ({
    config: config.deliveryContract,
    changes: changeSetEntries(changes),
    enabled: config.deliveryContract.enabled,
    environment,
  }),
  run({ root, plan }) {
    if (!plan.enabled) return skippedResult('repository.delivery-contract', '交付合同门禁已禁用');
    const result = inspectDeliveryContract({
      root,
      config: plan.config,
      changes: plan.changes,
      environment: plan.environment,
    });
    if (result.issues.length > 0) {
      return violationResult(
        'repository.delivery-contract',
        `交付合同发现 ${result.issues.length} 项违规`,
        {
          findings: [
            ...result.issues.map((item) => deliveryFinding(item)),
            ...result.warnings.map((item) => deliveryFinding(item, 'warning')),
          ],
          metrics: {
            changedEntries: result.changes?.length ?? 0,
            violations: result.issues.length,
            warnings: result.warnings.length,
          },
        },
      );
    }
    if (!result.selected) {
      return skippedResult('repository.delivery-contract', '当前变更未命中 deliveryContract.requiredFor，且当前分支没有活动合同');
    }
    return passedResult('repository.delivery-contract', `交付合同 ${result.selected.parsed.data.contractId} 已通过`, {
      diagnostics: [
        { level: 'info', message: `功能：${result.selected.parsed.data.featureId}` },
        { level: 'info', message: `合同修订：${result.selected.parsed.data.contractRevision}` },
        { level: 'info', message: `定义指纹：${result.definitionDigest}` },
      ],
      findings: result.warnings.map((item) => deliveryFinding(item, 'warning')),
      metrics: {
        changedEntries: result.changes.length,
        contractRevision: result.selected.parsed.data.contractRevision,
        warnings: result.warnings.length,
      },
    });
  },
});
