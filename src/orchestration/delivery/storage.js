import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { DELIVERY_CONFIG_FILE, DELIVERY_ID, validateDeliveryBinding, validateDeliveryContract } from '../../config/delivery-workspace.js';
import { contractDefinition, currentDeliveryReceipts, deliveryDigest, deliveryPath, evaluateDelivery, readDeliveryJson, resolveLocalDeliveryParticipants, signDelivery, validateReceipt } from '../../policies/delivery-contract/collaboration.js';
import { runGit } from '../../git/execution.js';
import { syncDeliverySkills } from '../setup/delivery-skills.js';

export function writeDeliveryJson(root, relative, value) {
  const file = deliveryPath(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export function createDeliveryKey(root, name) {
  if (!DELIVERY_ID.test(name ?? '')) throw configurationError('delivery/key-name-invalid', '密钥名称必须使用小写短横线标识');
  const privatePath = `.repo-guard/local/${name}.pem`;
  const publicPath = `.repo-guard/${name}.pub`;
  if (existsSync(deliveryPath(root, privatePath)) || existsSync(deliveryPath(root, publicPath))) {
    throw configurationError('delivery/key-exists', '指定的交付密钥已存在，不能覆盖');
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const ignorePath = deliveryPath(root, '.gitignore');
  const original = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : '';
  const additions = ['/.repo-guard/local/', '/reports/'].filter((line) => !original.split(/\r?\n/).includes(line));
  if (additions.length) writeFileSync(ignorePath, `${original}${original.endsWith('\n') || !original ? '' : '\n'}${additions.join('\n')}\n`);
  mkdirSync(path.dirname(deliveryPath(root, privatePath)), { recursive: true });
  writeFileSync(deliveryPath(root, privatePath), privateKey, { mode: 0o600, flag: 'wx' });
  writeFileSync(deliveryPath(root, publicPath), publicKey, { flag: 'wx' });
  return { privatePath, publicPath, publicKey };
}
export function readSigningKey(root, relative, expectedPublicKey) {
  const key = readFileSync(deliveryPath(root, relative), 'utf8');
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' });
  if (publicKey !== expectedPublicKey) throw configurationError('delivery/wrong-signing-key', '签名密钥不属于合同指定的执行方或验收人');
  return key;
}
export function bindDelivery(root, contractPath, participantId) {
  const contract = validateDeliveryContract(readDeliveryJson(root, contractPath));
  const participants = participantId.split(',');
  const binding = validateDeliveryBinding({ version: 2, enabled: true, contract: contractPath,
    contractDigest: deliveryDigest(contractDefinition(contract)), participants,
    keyFile: '.repo-guard/local/runner.pem', evidenceDirectory: 'reports/delivery' });
  resolveLocalDeliveryParticipants(contract, participants);
  syncDeliverySkills(root, true);
  writeDeliveryJson(root, DELIVERY_CONFIG_FILE, binding);
  return binding;
}
export function initializeDelivery(root, options) {
  if (existsSync(deliveryPath(root, DELIVERY_CONFIG_FILE))) throw configurationError('delivery/already-initialized', '交付配置已存在，请使用 bind 显式更新绑定');
  if (![options.id, options.participant, options.repository].every((value) => DELIVERY_ID.test(value ?? ''))
    || !['frontend', 'backend'].includes(options.role)) throw configurationError('delivery/identity-required', '初始化必须声明合同、参与方、仓库标识和 frontend/backend 角色');
  const reviewerPublicKey = readFileSync(deliveryPath(root, options.reviewerPublicKey), 'utf8');
  const runner = existsSync(deliveryPath(root, '.repo-guard/runner.pub'))
    ? { publicKey: readFileSync(deliveryPath(root, '.repo-guard/runner.pub'), 'utf8') }
    : createDeliveryKey(root, 'runner');
  const contractPath = `docs/delivery/${options.id}.json`;
  if (existsSync(deliveryPath(root, contractPath))) throw configurationError('delivery/contract-exists', '目标合同文件已存在，不能覆盖');
  const contract = validateDeliveryContract({ version: 2, documentType: 'delivery-contract', id: options.id, revision: 1,
    title: '待确认的交付需求', requirements: [{ id: 'requirement', description: '请填写本次交付需求', acceptance: ['请填写可验证的验收标准'] }],
    participants: [{ id: options.participant, repositoryId: options.repository, role: options.role, root: '.',
      baselineCommit: runGit(['rev-parse', 'HEAD'], { cwd: root }).stdout.trim(),
      workingBranch: runGit(['symbolic-ref', '--short', 'HEAD'], { cwd: root }).stdout.trim(), publicKey: runner.publicKey,
      tasks: [{ id: 'implementation', description: '请填写本方任务和变更边界', requirementIds: ['requirement'], allowedPaths: ['**/*'], checks: ['diff-check'] }],
      checks: [{ id: 'diff-check', kind: 'command', command: 'git', args: ['diff', '--check'], timeoutMs: 30000 }] }],
    integration: { publicKey: runner.publicKey, checks: [] }, reviewerPublicKey, approval: null });
  writeDeliveryJson(root, contractPath, contract);
  return bindDelivery(root, contractPath, options.participant);
}
export function signedEnvelope(payload, key) { return { payload, signature: signDelivery(payload, key) }; }
export function receiptPath(workspace, participant = workspace.participant.id) {
  return `${workspace.binding.evidenceDirectory}/participants/${participant}.json`;
}
export function readDeliveryEvidence(workspace) {
  const read = (directory) => {
    const absolute = deliveryPath(workspace.root, `${workspace.binding.evidenceDirectory}/${directory}`);
    return existsSync(absolute) ? readdirSync(absolute).filter((file) => file.endsWith('.json')).sort()
      .map((file) => readDeliveryJson(workspace.root, `${workspace.binding.evidenceDirectory}/${directory}/${file}`)) : [];
  };
  const acceptancePath = `${workspace.binding.evidenceDirectory}/acceptance.json`;
  const receipts = currentDeliveryReceipts(read('participants'), workspace.digest);
  const integration = read('integration');
  const acceptance = existsSync(deliveryPath(workspace.root, acceptancePath)) ? readDeliveryJson(workspace.root, acceptancePath) : null;
  return { receipts, integration, acceptance, evaluation: evaluateDelivery(workspace, receipts, integration, acceptance) };
}
export function importDeliveryReceipt(workspace, sourceFile) {
  const envelope = JSON.parse(readFileSync(sourceFile, 'utf8'));
  const payload = validateReceipt(workspace, envelope);
  writeDeliveryJson(workspace.root, receiptPath(workspace, payload.subject.participant), envelope);
}
