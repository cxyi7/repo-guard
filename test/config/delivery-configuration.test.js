import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateDeliveryBinding, validateDeliveryContract } from '../../src/config/delivery-workspace.js';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const contract = () => ({
  version: 2, documentType: 'delivery-contract', id: 'delivery', revision: 1, title: '前后端共同交付',
  requirements: [{ id: 'requirement', description: '完成团队确认的需求', acceptance: ['必需检查全部通过'] }],
  participants: [{ id: 'api', repositoryId: 'api-repo', role: 'backend', root: '.',
    baselineCommit: 'a'.repeat(40), workingBranch: 'main', publicKey,
    tasks: [{ id: 'implement', description: '完成后端任务', requirementIds: ['requirement'], allowedPaths: ['**/*'], checks: ['verify'] }],
    checks: [{ id: 'verify', kind: 'command', command: 'node', args: ['--version'], timeoutMs: 1000, testFiles: ['test/regression.js'] }],
  }], integration: { publicKey, checks: [] }, reviewerPublicKey: publicKey, approval: null,
});
const binding = () => ({ version: 2, enabled: true, contract: 'docs/delivery/contract.json',
  contractDigest: 'a'.repeat(64), participants: ['api'], keyFile: '.repo-guard/local/runner.pem', evidenceDirectory: 'reports/delivery' });

const ajv = new Ajv2020({ strict: false });
const schema = (file) => ajv.compile(JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')));
const validateContractSchema = schema('delivery-contract.schema.json');
const validateBindingSchema = schema('delivery.schema.json');

test('独立交付合同与绑定无需声明语言或工程预设，Schema 与运行时接受当前格式', () => {
  assert.equal(validateContractSchema(contract()), true, JSON.stringify(validateContractSchema.errors));
  assert.equal(validateDeliveryContract(contract()).participants[0].role, 'backend');
  assert.equal(validateBindingSchema(binding()), true, JSON.stringify(validateBindingSchema.errors));
  assert.equal(validateDeliveryBinding(binding()).version, 2);
  for (const version of [1, 3, '2']) {
    assert.equal(validateContractSchema({ ...contract(), version }), false);
    assert.throws(() => validateDeliveryContract({ ...contract(), version }));
    assert.equal(validateBindingSchema({ ...binding(), version }), false);
    assert.throws(() => validateDeliveryBinding({ ...binding(), version }));
  }
});

test('独立绑定拒绝路径逃逸、私钥位置错误和未知配置', () => {
  for (const patch of [{ contract: '../contract.json' }, { contract: 'docs/../contract.json' },
    { contract: 'D:/contract.json' }, { contract: 'docs\\contract.json' },
    { keyFile: 'runner.pem' }, { evidenceDirectory: 'src/evidence' }, { project: {} }]) {
    const value = { ...binding(), ...patch };
    assert.equal(validateBindingSchema(value), false, JSON.stringify(patch));
    assert.throws(() => validateDeliveryBinding(value));
  }
});

test('合同不接受私钥、非完整提交号和混合检查定义', () => {
  const values = [];
  const privateContract = contract();
  privateContract.reviewerPublicKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  values.push(privateContract);
  for (const size of [7, 41, 63, 65]) {
    const value = contract();
    value.participants[0].baselineCommit = 'a'.repeat(size);
    values.push(value);
  }
  const mixed = contract();
  mixed.participants[0].checks[0].gateId = 'quality.eslint';
  values.push(mixed);
  const invalidTimeout = contract();
  invalidTimeout.participants[0].checks[0].timeoutMs = 0;
  values.push(invalidTimeout);
  for (const value of values) {
    assert.equal(validateContractSchema(value), false);
    assert.throws(() => validateDeliveryContract(value));
  }
});

test('联合合同要求每个参与方都有任务、检查和联合验证，拒绝同仓库重叠目录', () => {
  const value = contract();
  value.participants.push({ ...structuredClone(value.participants[0]), id: 'web', repositoryId: 'web-repo', role: 'frontend' });
  assert.throws(() => validateDeliveryContract(value), /联合验证/);
  assert.equal(validateContractSchema(value), false);
  value.integration.checks = [{ id: 'joint', kind: 'command', command: 'node', args: ['--version'], timeoutMs: 1000, participants: ['api', 'web'] }];
  assert.equal(validateDeliveryContract(value).participants.length, 2);
  assert.equal(validateContractSchema(value), true, JSON.stringify(validateContractSchema.errors));
  value.integration.checks[0].participants = ['api'];
  assert.throws(() => validateDeliveryContract(value), /覆盖全部/);
  value.integration.checks[0].participants = ['api', 'web'];
  value.participants[1].repositoryId = 'api-repo';
  for (const [left, right] of [['.', 'apps/web'], ['src', './src'], ['src', 'src/web'], ['src', 'SRC']]) {
    value.participants[0].root = left;
    value.participants[1].root = right;
    assert.throws(() => validateDeliveryContract(value), /不得重叠/);
  }
});
