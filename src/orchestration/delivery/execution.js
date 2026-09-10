import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { configurationError, executionError } from '../../core/error/repo-guard-error.js';
import { runStreamingProcess } from '../../core/execution/streaming-process.js';
import { sanitizeProcessOutput } from '../../core/execution/output-safety.js';
import { writeConsoleMessage, writeGateResultConsole } from '../../core/report/console-renderer.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { aggregateGateResults, gateResultToExitCode, processExecutionToStatus } from '../../core/result/exit-code.js';
import { gateRegistry } from '../../gates/registry.js';
import { deliveryDigest, deliveryPath, deliverySubject, deliveryTestDigest, hasUncommittedDeliveryChanges, readDeliveryJson, receiptPayload, validateReceipt } from '../../policies/delivery-contract/collaboration.js';
import { createChangeSet, createGateContext } from '../../core/capability/gate-context.js';
import { collectProjectFiles } from '../../policies/file-placement.js';
import { loadExecutionTarget } from '../workspace/project-selection.js';
import { orchestratePlan } from '../orchestrator.js';
import { readSigningKey, receiptPath, signedEnvelope, writeDeliveryJson, readDeliveryEvidence } from './storage.js';

export function assertCleanSubject(workspace, expectedCommit = null) {
  if (hasUncommittedDeliveryChanges(workspace.root)) throw configurationError('delivery/uncommitted-subject', '记录交付证据前必须提交代码与合同配置；未提交或未跟踪文件不能冒充已验证提交');
  const subject = deliverySubject(workspace);
  if (expectedCommit !== null && subject.commit !== expectedCommit) {
    throw configurationError('delivery/subject-changed', '当前代码提交与实际验证的提交不一致，不能记录完成证据');
  }
  return subject;
}
async function executeCommand(check, root, env = process.env) {
  const result = await runStreamingProcess({ command: check.command, argumentsList: check.args, timeoutMs: check.timeoutMs, root, env });
  writeConsoleMessage(`第三方原始诊断：退出码 ${result.status ?? '无'}；终止信号 ${result.signal ?? '无'}。`);
  if (result.stdout) writeConsoleMessage(sanitizeProcessOutput(result.stdout, { root }).text);
  if (result.stderr) writeConsoleMessage(sanitizeProcessOutput(result.stderr, { root }).text, 'stderr');
  const status = processExecutionToStatus(result, { failureStatus: 'violation' });
  const summary = status === 'passed' ? '交付检查命令已通过。'
    : status === 'violation' ? '交付检查命令正常结束，但检查未通过。'
    : result.timedOut ? '交付检查命令执行超时，未获得有效结果。'
    : result.signal ? '交付检查命令被信号中断，未获得有效结果。'
    : '交付检查命令未能正常执行，请检查命令和运行环境。';
  return {
    gateResult: createGateResult({ gateId: `delivery.${check.id}`, status, summary,
      error: status === 'execution-error' ? executionError('delivery/command-execution-failed', summary) : null }),
    resultDigest: deliveryDigest({ exitCode: result.status, signal: result.signal, stdout: result.stdout,
      stderr: result.stderr, timedOut: result.timedOut, errorCode: result.error?.code ?? null }),
  };
}

export function reportDeliveryViolation(code, message) {
  const result = createGateResult({ gateId: 'delivery.contract', status: 'violation', summary: message,
    findings: [{ ruleId: code, code, severity: 'error', message }] });
  writeGateResultConsole(result);
  return gateResultToExitCode(result);
}

function integrationReportResult(check, observed, baseline, baselineDigest) {
  const valid = observed?.version === 2 && ['passed', 'failed'].includes(observed.status)
    && typeof observed.baselineDigest === 'string' && /^[a-f0-9]{64}$/.test(observed.baselineDigest)
    && Array.isArray(observed.subjects)
    && observed.subjects.every((subject) => subject && typeof subject === 'object'
      && typeof subject.participant === 'string' && subject.participant.length > 0
      && typeof subject.repositoryId === 'string' && subject.repositoryId.length > 0
      && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(subject.commit ?? ''));
  if (!valid) {
    const summary = '联合验证未提供有效结果报告，请检查报告输出位置及当前格式要求。';
    return createGateResult({ gateId: `delivery.${check.id}`, status: 'execution-error', summary,
      error: executionError('delivery/integration-report-invalid', summary) });
  }
  const confirmed = observed.status === 'passed' && observed.baselineDigest === baselineDigest
    && deliveryDigest(observed.subjects) === deliveryDigest(baseline.subjects);
  return createGateResult({ gateId: `delivery.${check.id}`, status: confirmed ? 'passed' : 'violation',
    summary: confirmed ? '联合验证结果与目标代码版本一致。' : '联合验证未通过或观察到的代码版本与目标不一致，不能记录通过。' });
}
export function recordDeliveryGateResults(workspace, results, { preservePassed = false } = {}) {
  const subject = assertCleanSubject(workspace);
  const file = receiptPath(workspace);
  let previous = [];
  let previousEnvelope = null;
  if (existsSync(deliveryPath(workspace.root, file))) {
    const envelope = readDeliveryJson(workspace.root, file);
    if (envelope?.payload?.contractDigest === workspace.digest) {
      const payload = validateReceipt(workspace, envelope);
      if (payload.subject.commit === subject.commit) {
        previous = payload.checks;
        previousEnvelope = envelope;
      }
    }
  }
  const ids = new Set(results.map(({ id }) => id));
  // 发布复核保留同一代码与测试的已通过证据；本轮真实结果仍完整写入 CI 报告。
  const verified = results.map((result) => {
    const existing = previous.find(({ id }) => id === result.id);
    return preservePassed && result.status === 'passed' && existing?.status === 'passed'
      && existing.definitionDigest === result.definitionDigest && existing.testDigest === result.testDigest
      ? existing : result;
  });
  const checks = [...previous.filter(({ id }) => !ids.has(id)), ...verified].sort((a, b) => a.id.localeCompare(b.id));
  if (previousEnvelope && deliveryDigest(checks) === deliveryDigest(previous)) return previousEnvelope;
  const key = readSigningKey(workspace.root, workspace.binding.keyFile, workspace.participant.publicKey);
  const receipt = signedEnvelope(receiptPayload(workspace, checks), key);
  writeDeliveryJson(workspace.root, file, receipt);
  writeDeliveryJson(workspace.root, `${workspace.binding.evidenceDirectory}/history/${deliveryDigest(receipt)}.json`, receipt);
  return receipt;
}
export async function runDeliveryCheck(workspace, checkId) {
  const check = workspace.participant.checks.find(({ id }) => id === checkId);
  if (!check) throw configurationError('delivery/check-missing', '当前参与方未声明该交付检查');
  const before = assertCleanSubject(workspace);
  let result;
  if (check.kind === 'gate') {
    const gate = gateRegistry.get(check.gateId);
    if (!gate?.environments.includes('ci-full') || !gate.allowedMutations.includes('read-only') || ['repository.delivery-contract', 'release.delivery-evidence'].includes(check.gateId)) {
      throw configurationError('delivery/gate-unavailable', '合同工程检查必须是可独立执行的工程门禁，不能递归调用交付门禁');
    }
    const target = loadExecutionTarget(workspace.applicationRoot);
    const context = createGateContext({ ...target, environment: 'ci-full', files: collectProjectFiles(target.root),
      changes: createChangeSet({ source: 'delivery', changes: [] }) });
    const execution = await orchestratePlan({ registry: gateRegistry, context,
      plan: { id: `delivery:${check.id}`, steps: [{ id: gate.id, gateId: gate.id, mutation: 'read-only' }] } });
    const output = execution.results.at(-1);
    result = {
      gateResult: output.status === 'skipped'
        ? createGateResult({ ...output, status: 'violation', summary: '合同要求的工程检查被跳过，不能作为完成证据。' })
        : output,
      resultDigest: deliveryDigest(output),
    };
  } else result = await executeCommand(check, workspace.applicationRoot);
  const after = assertCleanSubject(workspace);
  if (after.commit !== before.commit) throw configurationError('delivery/subject-changed', '验证过程中代码提交发生变化，不能记录完成证据');
  recordDeliveryGateResults(workspace, [{ id: check.id, definitionDigest: deliveryDigest(check), testDigest: deliveryTestDigest(workspace, check),
    status: result.gateResult.status === 'passed' ? 'passed' : 'failed', resultDigest: result.resultDigest }]);
  writeGateResultConsole(result.gateResult);
  return gateResultToExitCode(result.gateResult);
}
export async function runDeliveryIntegration(workspace, checkId, keyFile) {
  const check = workspace.contract.integration.checks.find(({ id }) => id === checkId);
  if (!check) throw configurationError('delivery/integration-missing', '合同未声明该联合验证检查');
  const before = assertCleanSubject(workspace);
  const key = readSigningKey(workspace.root, keyFile, workspace.contract.integration.publicKey);
  const evidence = readDeliveryEvidence(workspace);
  if (evidence.evaluation.pending.some((item) => item.startsWith('等待参与方') || item.includes('缺少通过证据'))) {
    return reportDeliveryViolation('delivery/participants-pending', '参与方尚未完成必需检查，不能记录联合验证通过');
  }
  const baselineDigest = evidence.evaluation.baselineDigest;
  const reportFile = `${workspace.binding.evidenceDirectory}/integration-output/${checkId}-${randomUUID()}.json`;
  const reportPath = deliveryPath(workspace.root, reportFile);
  mkdirSync(path.dirname(reportPath), { recursive: true });
  const result = await executeCommand(check, workspace.root, { ...process.env,
    REPO_GUARD_DELIVERY_BASELINE: JSON.stringify(evidence.evaluation.baseline),
    REPO_GUARD_DELIVERY_BASELINE_DIGEST: baselineDigest,
    REPO_GUARD_DELIVERY_REPORT: reportPath });
  let observed = null;
  try { observed = readDeliveryJson(workspace.root, reportFile); } catch { /* 缺失或无效报告按失败处理，不能沿用旧结果。 */ }
  const outputs = [result.gateResult];
  // 命令已失败时保留其失败类别；只有成功的命令才必须提供可验证的联合报告。
  if (result.gateResult.status === 'passed') outputs.push(integrationReportResult(check, observed, evidence.evaluation.baseline, baselineDigest));
  const after = assertCleanSubject(workspace);
  if (after.commit !== before.commit) throw configurationError('delivery/subject-changed', '联合验证过程中代码提交发生变化，不能记录完成证据');
  if (readDeliveryEvidence(workspace).evaluation.baselineDigest !== baselineDigest) {
    throw configurationError('delivery/integration-drift', '联合验证期间参与方代码版本发生变化，请重新验证');
  }
  const outcome = aggregateGateResults(outputs);
  const status = outcome.status === 'passed' ? 'passed' : 'failed';
  const payload = { checkId, baselineDigest, definitionDigest: deliveryDigest(check), resultDigest: result.resultDigest, status,
    observedDigest: observed ? deliveryDigest(observed) : null };
  writeDeliveryJson(workspace.root, `${workspace.binding.evidenceDirectory}/integration/${checkId}.json`, signedEnvelope(payload, key));
  writeGateResultConsole(outcome.decisiveResult);
  return outcome.exitCode;
}
