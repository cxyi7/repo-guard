import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { writeConsoleMessage } from '../../core/report/console-renderer.js';
import { EXIT_CODES, gateStatusToExitCode } from '../../core/result/exit-code.js';
import { findRepositoryRoot } from '../../git/repository.js';
import { collectRevisionChanges, collectWorkingTreeChanges } from '../../git/change-collection.js';
import { contractDefinition, inspectDeliveryBoundary, loadDeliveryWorkspace, signDelivery } from '../../policies/delivery-contract/collaboration.js';
import { bindDelivery, createDeliveryKey, importDeliveryReceipt, initializeDelivery, readDeliveryEvidence, readSigningKey, signedEnvelope, writeDeliveryJson } from '../delivery/storage.js';
import { reportDeliveryViolation, runDeliveryCheck, runDeliveryIntegration } from '../delivery/execution.js';
import { validateDeliveryContract } from '../../config/delivery-workspace.js';
import { receiptPath } from '../delivery/storage.js';
import { readDeliveryJson, validateReceipt } from '../../policies/delivery-contract/collaboration.js';
import { syncDeliverySkills } from '../setup/delivery-skills.js';
import { parseValuedOptions } from './argument-parsing.js';

const OPTIONS = {
  keygen: ['--name'], init: ['--id', '--participant', '--repository', '--role', '--reviewer-public-key'],
  bind: ['--contract', '--participant'], approve: ['--key-file'], check: [], status: [], verify: [],
  run: ['--check'], import: ['--from'], integrate: ['--check', '--key-file'], accept: ['--key-file', '--by'],
  enable: [], disable: [],
  feedback: ['--id', '--requirement', '--description', '--check', '--improvement', '--improvement-check'],
};
function required(values, field) {
  const value = values[field];
  if (!value) throw configurationError('delivery/option-required', `必须指定 ${field}`);
  return value;
}
function currentChanges(root, participant) {
  return [...collectRevisionChanges(root, participant.baselineCommit), ...collectWorkingTreeChanges(root)];
}

/** 独立交付入口不调用工程配置加载器；工程检查仅由合同显式引用时执行。 */
export async function runDeliveryCommand(argumentsList, cwd = process.cwd()) {
  const [command, ...rest] = argumentsList;
  if (!Object.hasOwn(OPTIONS, command)) throw configurationError('delivery/unknown-command', `交付命令支持：${Object.keys(OPTIONS).join('、')}`);
  const { values } = parseValuedOptions(rest, { flags: new Set(), values: new Set([...OPTIONS[command], '--participant']) });
  const root = findRepositoryRoot(cwd);
  if (command === 'keygen') {
    const key = createDeliveryKey(root, required(values, '--name'));
    writeConsoleMessage(`交付密钥已建立。公钥：${key.publicPath}；私钥保存在忽略目录中。`);
    return EXIT_CODES.success;
  }
  if (command === 'init') {
    const binding = initializeDelivery(root, { id: required(values, '--id'), participant: required(values, '--participant'),
      repository: required(values, '--repository'), role: required(values, '--role'), reviewerPublicKey: required(values, '--reviewer-public-key') });
    writeConsoleMessage(`已建立交付草案：${binding.contract}。请完善需求、任务和必需检查，再由验收人确认。`);
    return EXIT_CODES.success;
  }
  if (command === 'bind') {
    bindDelivery(root, required(values, '--contract'), required(values, '--participant'));
    writeConsoleMessage('已绑定指定合同版本和参与方。');
    return EXIT_CODES.success;
  }
  const workspace = loadDeliveryWorkspace(root, { requireApproval: !['approve', 'enable', 'disable'].includes(command), participantId: values['--participant'] });
  if (['enable', 'disable'].includes(command)) {
    writeDeliveryJson(root, 'repo-guard.delivery.json', { ...workspace.binding, enabled: command === 'enable' });
    syncDeliverySkills(root, command === 'enable');
    writeConsoleMessage(command === 'enable' ? '独立交付合同已开启，工程配置保持独立。' : '独立交付合同已关闭，已有资料与工程配置保留。');
    return EXIT_CODES.success;
  }
  if (!workspace.binding.enabled) throw configurationError('delivery/disabled', '交付合同已关闭；不能生成通过证据或验收结果');
  if (command === 'approve') {
    const key = readSigningKey(root, required(values, '--key-file'), workspace.contract.reviewerPublicKey);
    const contract = { ...workspace.contract, approval: signDelivery(contractDefinition(workspace.contract), key) };
    writeDeliveryJson(root, workspace.binding.contract, contract);
    writeConsoleMessage('已签署当前合同定义；请提交合同确认记录。');
    return EXIT_CODES.success;
  }
  for (const participant of workspace.localParticipants) inspectDeliveryBoundary({ ...workspace, participant }, currentChanges(root, participant));
  if (command === 'feedback') {
    if (workspace.localParticipants.length > 1) required(values, '--participant');
    const receipt = readDeliveryJson(root, receiptPath(workspace));
    const payload = validateReceipt(workspace, receipt);
    const checkId = required(values, '--check');
    if (!payload.checks.some((check) => check.id === checkId && check.status === 'failed')) {
      throw configurationError('delivery/feedback-needs-failure', '登记实现缺陷必须引用实际失败的回归检查');
    }
    const contract = validateDeliveryContract({ ...workspace.contract, revision: workspace.contract.revision + 1, approval: null,
      findings: [...(workspace.contract.findings ?? []), { id: required(values, '--id'), participant: workspace.participant.id,
        requirementId: required(values, '--requirement'), description: required(values, '--description'), regressionCheck: checkId,
        redReceipt: receipt, improvement: { description: required(values, '--improvement'), checkId: required(values, '--improvement-check') } }] });
    writeDeliveryJson(root, workspace.binding.contract, contract);
    bindDelivery(root, workspace.binding.contract, workspace.binding.participants.join(','));
    writeConsoleMessage('反馈已归入合同；请在权威来源评审本次修订、重新确认并同步各参与方，再完成修复、复测与反向改进。');
    return EXIT_CODES.success;
  }
  if (command === 'check') {
    writeConsoleMessage(`交付合同 ${workspace.contract.id} 的确认、版本和本方任务边界有效。`);
    return EXIT_CODES.success;
  }
  if (command === 'run') {
    if (workspace.localParticipants.length > 1) required(values, '--participant');
    return runDeliveryCheck(workspace, required(values, '--check'));
  }
  if (command === 'integrate') return runDeliveryIntegration(workspace, required(values, '--check'), required(values, '--key-file'));
  if (command === 'import') {
    importDeliveryReceipt(workspace, path.resolve(cwd, required(values, '--from')));
    writeConsoleMessage('参与方证据已验证来源并导入。');
    return EXIT_CODES.success;
  }
  const evidence = readDeliveryEvidence(workspace);
  if (command === 'accept') {
    if (evidence.evaluation.pending.some((item) => !item.startsWith('等待人工验收'))) {
      return reportDeliveryViolation('delivery/not-ready-for-acceptance', `尚不能验收：${evidence.evaluation.pending.join('；')}`);
    }
    const key = readSigningKey(root, required(values, '--key-file'), workspace.contract.reviewerPublicKey);
    const payload = { baselineDigest: evidence.evaluation.baselineDigest, evidenceDigest: evidence.evaluation.evidenceDigest,
      acceptedBy: required(values, '--by'), acceptedAt: new Date().toISOString() };
    writeDeliveryJson(root, `${workspace.binding.evidenceDirectory}/acceptance.json`, signedEnvelope(payload, key));
    writeConsoleMessage('已记录针对当前代码组合和交付证据的人工验收签名。');
    return EXIT_CODES.success;
  }
  writeConsoleMessage(evidence.evaluation.status === 'passed' ? '整体交付已通过验收。' : `整体交付待完成：\n${evidence.evaluation.pending.map((item) => `- ${item}`).join('\n')}`);
  return command === 'status' ? EXIT_CODES.success
    : gateStatusToExitCode(evidence.evaluation.status === 'passed' ? 'passed' : 'violation');
}
