import { createHash, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { validateDeliveryBinding, validateDeliveryContract, DELIVERY_CONFIG_FILE, DELIVERY_SHA, deliveryRelativePath } from '../../config/delivery-workspace.js';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { runGit } from '../../git/execution.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export function deliveryDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function contractDefinition(contract) {
  return Object.fromEntries(Object.entries(contract).filter(([key]) => key !== 'approval'));
}
export function signDelivery(value, key) {
  return sign(null, Buffer.from(deliveryDigest(value)), key).toString('base64');
}
export function verifyDelivery(value, signature, key) {
  try { return verify(null, Buffer.from(deliveryDigest(value)), key, Buffer.from(signature ?? '', 'base64')); }
  catch { return false; }
}
export function deliveryPath(root, relative) {
  deliveryRelativePath(relative, '交付文件路径');
  const target = path.resolve(root, relative);
  let existing = target;
  while (!existsSync(existing)) existing = path.dirname(existing);
  const actual = path.relative(realpathSync(root), realpathSync(existing));
  if (actual === '..' || actual.startsWith(`..${path.sep}`) || path.isAbsolute(actual)) {
    throw configurationError('delivery/path-outside', '交付文件不能通过符号链接越出所属目录');
  }
  return target;
}
export function readDeliveryJson(root, relative) {
  try { return JSON.parse(readFileSync(deliveryPath(root, relative), 'utf8')); }
  catch (error) { throw configurationError('delivery/read-failed', `无法读取交付文件 ${relative}：${error.message}`, { cause: error }); }
}
export function hasDeliveryBinding(root) {
  if (existsSync(path.join(root, DELIVERY_CONFIG_FILE))) return true;
  if (runGit(['ls-files', '--error-unmatch', '--', DELIVERY_CONFIG_FILE], { cwd: root, allowFailure: true }).status === 0) return true;
  return runGit(['log', '-1', '--format=%H', '--', DELIVERY_CONFIG_FILE], { cwd: root, allowFailure: true }).stdout.trim() !== '';
}
export function resolveLocalDeliveryParticipants(contract, participantIds) {
  const participants = participantIds.map((id) => contract.participants.find((participant) => participant.id === id));
  if (participants.some((item) => !item) || new Set(participants.map(({ repositoryId }) => repositoryId)).size !== 1) {
    throw configurationError('delivery/participant-missing', '本地参与方必须存在于合同中，并属于同一仓库标识');
  }
  const required = contract.participants.filter(({ repositoryId }) => repositoryId === participants[0].repositoryId);
  if (required.some(({ id }) => !participantIds.includes(id))) {
    throw configurationError('delivery/incomplete-local-participants', '本仓库必须完整绑定合同中同一仓库标识下的全部参与方，不能遗漏其他应用的交付约束');
  }
  return participants;
}
export function loadDeliveryWorkspace(root, { requireApproval = true, participantId, source = 'manual' } = {}) {
  const readDocument = (file) => {
    if (source !== 'pre-commit') return readDeliveryJson(root, file);
    deliveryPath(root, file);
    const snapshot = runGit(['show', `:${file}`], { cwd: root, allowFailure: true });
    if (snapshot.status !== 0) throw configurationError('delivery/staged-file-missing', `暂存区缺少交付配置或合同：${file}`);
    try { return JSON.parse(snapshot.stdout); }
    catch { throw configurationError('delivery/staged-file-invalid', `暂存区交付 JSON 无效：${file}`); }
  };
  const binding = validateDeliveryBinding(readDocument(DELIVERY_CONFIG_FILE));
  const contract = validateDeliveryContract(readDocument(binding.contract));
  const digest = deliveryDigest(contractDefinition(contract));
  if (binding.contractDigest !== digest) throw configurationError('delivery/contract-drift', '合同内容与绑定指纹不一致；请复核合同修订并重新绑定');
  const localParticipants = resolveLocalDeliveryParticipants(contract, binding.participants);
  const participant = participantId === undefined ? localParticipants[0] : localParticipants.find(({ id }) => id === participantId);
  if (!participant) throw configurationError('delivery/participant-missing', '所选参与方不属于当前仓库');
  if (requireApproval && binding.enabled && !verifyDelivery(contractDefinition(contract), contract.approval, contract.reviewerPublicKey)) {
    throw configurationError('delivery/approval-required', '交付合同尚未取得有效的人工确认签名；修改后的合同需要重新确认');
  }
  return { root, binding, contract, participant, localParticipants, digest, applicationRoot: deliveryPath(root, participant.root) };
}
export function deliverySubject(workspace) {
  const result = runGit(['rev-parse', '--verify', 'HEAD'], { cwd: workspace.root });
  return { participant: workspace.participant.id, repositoryId: workspace.participant.repositoryId, commit: result.stdout.trim() };
}
export function hasUncommittedDeliveryChanges(root) {
  return runGit(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root }).stdout.trim() !== '';
}
export function inspectDeliveryBoundary(workspace, changes = []) {
  const { root, participant } = workspace;
  const branch = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, allowFailure: true }).stdout.trim();
  if (branch && branch !== participant.workingBranch) throw configurationError('delivery/branch-mismatch', `当前参与方必须在合同声明的分支 ${participant.workingBranch} 工作`);
  const ancestor = runGit(['merge-base', '--is-ancestor', participant.baselineCommit, 'HEAD'], { cwd: root, allowFailure: true });
  if (ancestor.status !== 0) throw configurationError('delivery/baseline-mismatch', '当前仓库历史不包含合同声明的参与方基线');
  const normalizedRoot = path.posix.normalize(participant.root);
  const prefix = normalizedRoot === '.' ? '' : `${normalizedRoot}/`;
  const allowed = participant.tasks.flatMap((task) => task.allowedPaths);
  const violations = changes.flatMap((change) => [change.path, change.oldPath].filter(Boolean)).filter((file) => {
    const belongs = process.platform === 'win32'
      ? file.toLowerCase().startsWith(prefix.toLowerCase()) : file.startsWith(prefix);
    if (!belongs) return false;
    const relative = file.slice(prefix.length);
    return !micromatch.isMatch(relative, allowed, { dot: true });
  });
  if (violations.length) throw configurationError('delivery/change-outside', `变更超出当前参与方任务边界：${[...new Set(violations)].join('、')}`);
}
export function receiptPayload(workspace, checks) {
  return {
    version: 2, documentType: 'delivery-receipt', contractId: workspace.contract.id,
    contractRevision: workspace.contract.revision, contractDigest: workspace.digest,
    subject: deliverySubject(workspace), checks,
  };
}
export function deliveryTestDigest(workspace, check) {
  if (!check.testFiles?.length) return null;
  return deliveryDigest(check.testFiles.map((file) => ({ path: file,
    content: createHash('sha256').update(readFileSync(deliveryPath(workspace.applicationRoot, file))).digest('hex') })));
}
export function validateReceipt(workspace, envelope) {
  const payload = envelope?.payload;
  const participant = workspace.contract.participants.find(({ id }) => id === payload?.subject?.participant);
  if (!participant || payload?.version !== 2 || payload.documentType !== 'delivery-receipt'
    || payload.contractId !== workspace.contract.id || payload.contractRevision !== workspace.contract.revision
    || payload.contractDigest !== workspace.digest || payload.subject.repositoryId !== participant.repositoryId
    || !DELIVERY_SHA.test(payload.subject.commit ?? '')
    || !verifyDelivery(payload, envelope.signature, participant.publicKey)) {
    throw configurationError('delivery/receipt-untrusted', '交付证据的参与方、合同版本或执行签名无效');
  }
  if (!Array.isArray(payload.checks)
    || payload.checks.some((check) => !check || typeof check !== 'object' || Array.isArray(check))
    || new Set(payload.checks.map(({ id }) => id)).size !== payload.checks.length) {
    throw configurationError('delivery/checks-invalid', '交付证据中的检查结果必须是无重复的数组');
  }
  for (const check of payload.checks) {
    const definition = participant.checks.find(({ id }) => id === check.id);
    if (!definition || check.definitionDigest !== deliveryDigest(definition)
      || !['passed', 'failed'].includes(check.status) || !/^[a-f0-9]{64}$/.test(check.resultDigest ?? '')) {
      throw configurationError('delivery/check-not-passed', '交付检查必须对应合同中的定义并实际通过；跳过或关闭不能代替完成');
    }
  }
  return payload;
}
export function currentDeliveryReceipts(receipts, digest) {
  return receipts.filter((item) => {
    if (!item?.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)
      || typeof item.payload.contractDigest !== 'string') {
      throw configurationError('delivery/receipt-untrusted', '交付证据必须包含有效的签名载荷和合同指纹');
    }
    return item.payload.contractDigest === digest;
  });
}

/** 验收绑定各仓库独立版本；任何参与方或合同变更都会使旧联合证据失效。 */
export function evaluateDelivery(workspace, receipts, integration, acceptance) {
  const subjects = [];
  const pending = [];
  if (hasUncommittedDeliveryChanges(workspace.root)) {
    pending.push('本仓库存在未提交或未跟踪变更，当前代码缺少通过证据');
  }
  const ids = new Set();
  for (const receipt of receipts) {
    const payload = validateReceipt(workspace, receipt);
    if (ids.has(payload.subject.participant)) throw configurationError('delivery/duplicate-receipt', '同一参与方不能同时使用多个交付证据版本');
    ids.add(payload.subject.participant);
    subjects.push(payload.subject);
    if (workspace.localParticipants.some(({ id }) => id === payload.subject.participant) && payload.subject.commit !== deliverySubject(workspace).commit) {
      pending.push(`${payload.subject.participant} 的证据不是当前代码版本，缺少通过证据`);
    }
    const participant = workspace.contract.participants.find(({ id }) => id === payload.subject.participant);
    for (const check of participant.checks) if (!payload.checks.some(({ id, status }) => id === check.id && status === 'passed')) pending.push(`${participant.id} / ${check.id} 缺少通过证据`);
  }
  for (const participant of workspace.contract.participants) if (!ids.has(participant.id)) pending.push(`等待参与方 ${participant.id}`);
  for (const finding of workspace.contract.findings ?? []) {
    const participant = workspace.contract.participants.find(({ id }) => id === finding.participant);
    const definition = participant.checks.find(({ id }) => id === finding.regressionCheck);
    const red = finding.redReceipt.payload;
    const redCheck = Array.isArray(red.checks) ? red.checks.find((check) => check?.id === finding.regressionCheck) : null;
    const green = receipts.find((item) => item.payload.subject.participant === finding.participant)?.payload;
    const greenCheck = green?.checks.find(({ id }) => id === finding.regressionCheck);
    if (!verifyDelivery(red, finding.redReceipt.signature, participant.publicKey)
      || red.subject?.participant !== participant.id || red.subject.repositoryId !== participant.repositoryId
      || red.contractId !== workspace.contract.id || redCheck?.status !== 'failed'
      || redCheck.definitionDigest !== deliveryDigest(definition) || !redCheck.testDigest
      || greenCheck?.status !== 'passed' || greenCheck.testDigest !== redCheck.testDigest
      || green.subject.commit === red.subject.commit
      || !green.checks.some((check) => check.id === finding.improvement.checkId && check.status === 'passed')) {
      pending.push(`反馈 ${finding.id} 缺少同一测试的红绿证据或反向改进验证`);
    }
  }
  subjects.sort((a, b) => a.participant.localeCompare(b.participant));
  const baseline = { contractDigest: workspace.digest, subjects };
  const baselineDigest = deliveryDigest(baseline);
  for (const check of workspace.contract.integration.checks) {
    const proof = integration.find((item) => item?.payload?.checkId === check.id);
    if (!proof || proof.payload.baselineDigest !== baselineDigest || proof.payload.status !== 'passed'
      || proof.payload.definitionDigest !== deliveryDigest(check)
      || !verifyDelivery(proof.payload, proof.signature, workspace.contract.integration.publicKey)) {
      pending.push(`联合验证 ${check.id} 缺少当前版本的通过证据`);
    }
  }
  const evidenceDigest = deliveryDigest({ baseline, receipts, integration });
  if (!acceptance || acceptance.payload?.evidenceDigest !== evidenceDigest
    || acceptance.payload?.baselineDigest !== baselineDigest
    || !verifyDelivery(acceptance.payload, acceptance.signature, workspace.contract.reviewerPublicKey)) {
    pending.push('等待人工验收当前代码版本和交付证据');
  }
  return { status: pending.length ? 'pending' : 'passed', pending, baseline, baselineDigest, evidenceDigest };
}

export function inspectCollaborativeDelivery(root, { changes = [], evidence = false, source = 'manual' } = {}) {
  if (!hasDeliveryBinding(root)) return null;
  const workspace = loadDeliveryWorkspace(root, { source, requireApproval: false });
  if (!workspace.binding.enabled) return { status: 'skipped', pending: ['独立交付合同已关闭'] };
  if (!verifyDelivery(contractDefinition(workspace.contract), workspace.contract.approval, workspace.contract.reviewerPublicKey)) {
    throw configurationError('delivery/approval-required', '交付合同尚未取得有效的人工确认签名；修改后的合同需要重新确认');
  }
  for (const participant of workspace.localParticipants) inspectDeliveryBoundary({ ...workspace, participant }, changes);
  if (!evidence) return { status: 'passed', pending: [] };
  const read = (directory) => {
    const relative = `${workspace.binding.evidenceDirectory}/${directory}`;
    const absolute = deliveryPath(root, relative);
    return existsSync(absolute) ? readdirSync(absolute).filter((file) => file.endsWith('.json')).sort()
      .map((file) => readDeliveryJson(root, `${relative}/${file}`)) : [];
  };
  const acceptancePath = `${workspace.binding.evidenceDirectory}/acceptance.json`;
  const acceptance = existsSync(deliveryPath(root, acceptancePath)) ? readDeliveryJson(root, acceptancePath) : null;
  return evaluateDelivery(workspace, currentDeliveryReceipts(read('participants'), workspace.digest), read('integration'), acceptance);
}
