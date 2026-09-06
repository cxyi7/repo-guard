import { defineGate } from '../../core/capability/gate-definition.js';
import { changeSetEntries } from '../../core/capability/gate-context.js';
import { findingFromPolicy, passedResult, skippedResult, violationResult } from '../native-result.js';
import { inspectDeliveryContract } from '../../policies/delivery-contract/repository.js';
import { inspectDeliveryEvidence } from '../../policies/delivery-contract/evidence.js';
import { inspectDeliveryContractSetup } from '../../policies/delivery-contract/setup.js';

function finding(item) {
  return findingFromPolicy(item, {
    expected: '当前合同的全部必需事项、人工验收、交付发现和证据指纹均可复核。',
    remediation: {
      goal: '补齐并重新验证当前交付证据',
      steps: [
        '完成未勾选事项并为 AI、Gate 和人工事项记录对应证据',
        '关闭正式交付发现，并为实现缺陷保留同一测试的红—绿证明',
        '重新计算技术证据和执行状态指纹后，由人工绑定代码提交并验收',
      ],
      constraints: [
        '不得仅修改复选框或手写 release-ready 状态代替实际验证',
        '不得删除未完成事项、未关闭问题或失效证据来通过门禁',
      ],
      verification: ['运行 release-ready 档案并确认所有官方步骤通过'],
    },
  });
}

export const deliveryEvidenceGate = defineGate({
  id: 'release.delivery-evidence',
  configVersions: [1],
  environments: ['manual', 'release-ready'],
  mutation: 'read-only',
  defaultTimeoutMs: 120000,
  after: ['release.package'],
  manualCommand: 'delivery-evidence',
  manualOrder: 28,
  packageScript: 'guard:delivery-evidence',
  rules: [
    'delivery-evidence/obligations',
    'delivery-evidence/human-acceptance',
    'delivery-evidence/findings',
    'delivery-evidence/digests',
    'delivery-evidence/evidence-run',
    'delivery-evidence/gate-result-content',
    'delivery-evidence/integration-analysis',
  ],
  artifactTypes: ['delivery-evidence'],
  inspectSetup: inspectDeliveryContractSetup,
  plan: ({ config, changes, environment, priorResults = [] }) => ({
    config: config.deliveryContract,
    changes: changeSetEntries(changes),
    enabled: config.deliveryContract.enabled,
    environment,
    priorResults,
  }),
  run({ root, plan }) {
    if (!plan.enabled) return skippedResult('release.delivery-evidence', '交付证据门禁已禁用');
    const inspection = inspectDeliveryContract({
      root,
      config: plan.config,
      changes: plan.changes,
      environment: plan.environment,
    });
    if (inspection.issues.length > 0) {
      return violationResult('release.delivery-evidence', '交付合同边界尚未有效，不能复核交付证据', {
        diagnostics: [{ level: 'info', message: '当前推导状态：specified' }],
        findings: inspection.issues.map(finding),
        metrics: { violations: inspection.issues.length },
      });
    }
    if (!inspection.selected) {
      return skippedResult('release.delivery-evidence', '当前执行没有适用的活动交付合同');
    }
    const result = inspectDeliveryEvidence({
      root,
      inspection,
      priorResults: plan.priorResults,
      requireCurrentGateResults: plan.environment === 'release-ready',
    });
    if (result.issues.length > 0) {
      return violationResult('release.delivery-evidence', `交付证据尚未达到 release-ready：${result.issues.length} 项待处理`, {
        diagnostics: [{ level: 'info', message: `当前推导状态：${result.state}` }],
        findings: result.issues.map(finding),
        metrics: { violations: result.issues.length },
      });
    }
    const evidence = inspection.selected.parsed.data.deliveryEvidence;
    return passedResult('release.delivery-evidence', `交付合同 ${inspection.selected.parsed.data.contractId} 已达到 release-ready`, {
      artifacts: [{ type: 'delivery-evidence', path: evidence.evidenceRunPath }],
      diagnostics: [
        { level: 'info', message: `当前推导状态：${result.state}` },
        { level: 'info', message: `交付证据批次：${evidence.evidenceRunPath}` },
        { level: 'info', message: `证据批次文件指纹：${evidence.evidenceRunDigest}` },
        { level: 'info', message: `技术证据指纹：${result.technicalEvidenceDigest}` },
        { level: 'info', message: `执行状态指纹：${result.executionDigest}` },
      ],
      metrics: { violations: 0 },
    });
  },
});
