import { createPublicKey } from 'node:crypto';
import path from 'node:path';
import { configValidationError, assertKnownProperties } from './validation-primitives.js';

export const DELIVERY_CONFIG_FILE = 'repo-guard.delivery.json';
export const DELIVERY_ID = /^[a-z][a-z0-9-]{0,63}$/;
export const DELIVERY_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function object(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw configValidationError(`${label} 必须是对象`);
  assertKnownProperties(value, new Set(fields), label);
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw configValidationError(`${label} 必须是非空文本`);
}
function id(value, label) {
  if (typeof value !== 'string' || !DELIVERY_ID.test(value)) throw configValidationError(`${label} 必须使用小写字母开头的短横线标识`);
}
function entries(value, label) {
  if (!Array.isArray(value)) throw configValidationError(`${label} 必须是数组`);
  const ids = new Set();
  for (const entry of value) {
    id(entry?.id, `${label}.id`);
    if (ids.has(entry.id)) throw configValidationError(`${label} 的标识不得重复`);
    ids.add(entry.id);
  }
  return ids;
}
function references(value, allowed, label) {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length
    || value.some((item) => !allowed.has(item))) throw configValidationError(`${label} 必须引用不重复的已声明标识`);
}
export function deliveryRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\\')
    || [...value].some((character) => character.charCodeAt(0) < 32)
    || value.startsWith('/') || value.includes(':') || value.split('/').some((part) => !part || part === '..')) {
    throw configValidationError(`${label} 必须使用所属目录内的相对路径`);
  }
  return value;
}
function publicKey(value, label) {
  let valid = false;
  try {
    valid = typeof value === 'string' && value.trim().startsWith('-----BEGIN PUBLIC KEY-----')
      && createPublicKey(value).asymmetricKeyType === 'ed25519';
  } catch { /* 统一转换为配置错误，避免暴露底层加密错误。 */ }
  if (!valid) throw configValidationError(`${label} 必须是 Ed25519 公钥`);
}
function validateCheck(check, integration = false) {
  object(check, ['id', 'kind', 'gateId', 'command', 'args', 'timeoutMs', 'testFiles', ...(integration ? ['participants'] : [])], '交付检查');
  id(check.id, '交付检查 id');
  if (check.testFiles !== undefined) {
    if (!Array.isArray(check.testFiles) || !check.testFiles.length || new Set(check.testFiles).size !== check.testFiles.length) throw configValidationError('testFiles 必须是不重复的测试文件路径数组');
    check.testFiles.forEach((file) => deliveryRelativePath(file, 'testFiles'));
  }
  if (!['gate', 'command'].includes(check.kind) || (integration && check.kind !== 'command')) {
    throw configValidationError('交付检查 kind 必须为 gate 或 command；联合验证使用 command');
  }
  if (check.kind === 'gate') {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(check.gateId ?? '')
      || ['command', 'args', 'timeoutMs'].some((field) => Object.hasOwn(check, field))) {
      throw configValidationError('工程检查必须仅声明 gateId，不能覆盖其执行命令');
    }
  } else {
    text(check.command, '交付检查 command');
    if (!Array.isArray(check.args) || check.args.some((arg) => typeof arg !== 'string') || Object.hasOwn(check, 'gateId')
      || !Number.isInteger(check.timeoutMs) || check.timeoutMs < 1000 || check.timeoutMs > 1800000) {
      throw configValidationError('命令检查必须声明字符串参数数组和 1000～1800000 毫秒超时，不能声明 gateId');
    }
  }
}

/** 交付配置不加载工程预设，也不依赖 package.json。 */
export function validateDeliveryBinding(value) {
  object(value, ['version', 'enabled', 'contract', 'contractDigest', 'participants', 'keyFile', 'evidenceDirectory'], '交付配置');
  if (value.version !== 2 || typeof value.enabled !== 'boolean') throw configValidationError('交付配置必须使用 version: 2 并声明 enabled');
  deliveryRelativePath(value.contract, 'contract');
  if (!/^[a-f0-9]{64}$/.test(value.contractDigest ?? '')) throw configValidationError('contractDigest 必须是完整 SHA-256 指纹');
  if (!Array.isArray(value.participants) || !value.participants.length || new Set(value.participants).size !== value.participants.length) {
    throw configValidationError('participants 必须声明本仓库不重复的参与方标识');
  }
  value.participants.forEach((item) => id(item, 'participants'));
  deliveryRelativePath(value.keyFile, 'keyFile');
  deliveryRelativePath(value.evidenceDirectory, 'evidenceDirectory');
  if (!value.keyFile.startsWith('.repo-guard/local/')) throw configValidationError('签名私钥必须保存在本地 .repo-guard/local/ 目录中');
  if (!value.evidenceDirectory.startsWith('reports/')) throw configValidationError('交付证据目录必须位于 reports/ 下');
  return structuredClone(value);
}

export function validateDeliveryContract(value) {
  object(value, ['version', 'documentType', 'id', 'revision', 'title', 'requirements', 'participants', 'integration', 'reviewerPublicKey', 'approval', 'findings'], '联合交付合同');
  if (value.version !== 2 || value.documentType !== 'delivery-contract') throw configValidationError('联合交付合同仅支持 version: 2 和 delivery-contract 文档类型');
  id(value.id, '合同 id');
  text(value.title, '合同 title');
  if (!Number.isInteger(value.revision) || value.revision < 1) throw configValidationError('合同 revision 必须为正整数');
  const requirements = entries(value.requirements, 'requirements');
  if (requirements.size === 0) throw configValidationError('合同至少需要一个需求');
  for (const requirement of value.requirements) {
    object(requirement, ['id', 'description', 'acceptance'], '需求');
    text(requirement.description, '需求 description');
    if (!Array.isArray(requirement.acceptance) || !requirement.acceptance.length
      || new Set(requirement.acceptance).size !== requirement.acceptance.length) throw configValidationError('需求必须声明不重复的验收标准');
    requirement.acceptance.forEach((item) => text(item, '验收标准'));
  }
  const participants = entries(value.participants, 'participants');
  if (!participants.size) throw configValidationError('合同至少需要一个参与方');
  const covered = new Set();
  const rootsByRepository = new Map();
  for (const participant of value.participants) {
    object(participant, ['id', 'repositoryId', 'role', 'root', 'baselineCommit', 'workingBranch', 'publicKey', 'tasks', 'checks'], '参与方');
    id(participant.repositoryId, 'repositoryId');
    if (!['frontend', 'backend'].includes(participant.role)) throw configValidationError('参与方 role 必须为 frontend 或 backend');
    deliveryRelativePath(participant.root, '参与方 root');
    const normalizedRoot = path.posix.normalize(participant.root).toLowerCase();
    const roots = rootsByRepository.get(participant.repositoryId) ?? [];
    if (roots.some((root) => root === normalizedRoot || root === '.' || normalizedRoot === '.'
      || root.startsWith(`${normalizedRoot}/`) || normalizedRoot.startsWith(`${root}/`))) {
      throw configValidationError('同一仓库的交付参与方目录不得重叠，不支持前后端文件混放');
    }
    rootsByRepository.set(participant.repositoryId, [...roots, normalizedRoot]);
    if (!DELIVERY_SHA.test(participant.baselineCommit ?? '')) throw configValidationError('参与方 baselineCommit 必须是完整 Git 提交号');
    text(participant.workingBranch, '参与方 workingBranch');
    publicKey(participant.publicKey, '参与方 publicKey');
    const checks = entries(participant.checks, '参与方 checks');
    participant.checks.forEach((check) => validateCheck(check));
    const tasks = entries(participant.tasks, '参与方 tasks');
    if (!tasks.size) throw configValidationError('每个参与方至少需要一个任务');
    for (const task of participant.tasks) {
      object(task, ['id', 'description', 'requirementIds', 'allowedPaths', 'checks'], '交付任务');
      text(task.description, '任务 description');
      references(task.requirementIds, requirements, '任务 requirementIds');
      task.requirementIds.forEach((item) => covered.add(item));
      references(task.checks, checks, '任务 checks');
      if (!Array.isArray(task.allowedPaths) || !task.allowedPaths.length
        || new Set(task.allowedPaths).size !== task.allowedPaths.length) throw configValidationError('任务必须声明不重复的 allowedPaths');
      task.allowedPaths.forEach((item) => deliveryRelativePath(item, '任务 allowedPaths'));
    }
  }
  if (covered.size !== requirements.size) throw configValidationError('每项需求都必须分配到参与方任务');
  object(value.integration, ['publicKey', 'checks'], 'integration');
  publicKey(value.integration.publicKey, 'integration.publicKey');
  entries(value.integration.checks, 'integration.checks');
  if (participants.size > 1 && !value.integration.checks.length) throw configValidationError('多个参与方必须声明联合验证检查');
  const integrated = new Set();
  value.integration.checks.forEach((check) => {
    validateCheck(check, true);
    references(check.participants, participants, '联合验证 participants');
    check.participants.forEach((participant) => integrated.add(participant));
  });
  if (participants.size > 1 && integrated.size !== participants.size) throw configValidationError('联合验证必须覆盖全部交付参与方');
  publicKey(value.reviewerPublicKey, 'reviewerPublicKey');
  entries(value.findings ?? [], 'findings');
  for (const finding of value.findings ?? []) {
    object(finding, ['id', 'participant', 'requirementId', 'description', 'regressionCheck', 'redReceipt', 'improvement'], '交付反馈');
    const participant = value.participants.find(({ id }) => id === finding.participant);
    if (!participant || !requirements.has(finding.requirementId)
      || !participant.tasks.some((task) => task.requirementIds.includes(finding.requirementId))) throw configValidationError('交付反馈必须引用已声明的参与方及其负责的需求');
    const check = participant.checks.find(({ id }) => id === finding.regressionCheck);
    if (!check?.testFiles?.length) throw configValidationError('实现缺陷的回归检查必须声明 testFiles，用于核验同一测试的红绿证据');
    text(finding.description, '反馈 description');
    object(finding.improvement, ['description', 'checkId'], '反向改进');
    text(finding.improvement.description, '反向改进 description');
    if (!participant.checks.some(({ id }) => id === finding.improvement.checkId)) throw configValidationError('反向改进必须绑定本方的一项验证检查');
    if (!finding.redReceipt?.payload || !finding.redReceipt?.signature) throw configValidationError('实现缺陷必须保留带执行签名的失败证据');
  }
  if (value.approval !== null && typeof value.approval !== 'string') throw configValidationError('approval 必须是签名文本或 null');
  return structuredClone(value);
}
