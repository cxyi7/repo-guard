import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createStarterConfig, CONFIGURABLE_FEATURES } from '../src/orchestration/setup/config-management.js';
import { officialGates } from '../src/gates/registry.js';
import { agentPolicyGate } from '../src/gates/repository/repository-policy-gates.js';
import { runEnable, runDisable } from '../src/orchestration/cli/configuration.js';
import { runGit } from '../src/git/execution.js';
import {
  agentPolicyCatalog,
  agentPolicyGroups,
  managedAgentPolicyCapabilities,
  managedAgentPolicyFeatures,
  managedAgentPolicyGateIds,
} from '../src/policies/agent-policy-catalog.js';
import {
  agentPolicies,
  inspectAgentPolicies,
  syncAgentPolicies,
} from '../src/policies/agent-policies.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function fixture() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'agent-policy-'));
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'agent-policy-fixture',
    version: '1.0.0',
    scripts: {
      'test:k6': 'repo-guard k6-runner --gate-id project.k6',
    },
  }, null, 2)}\n`);
  return root;
}

test('每个可配置功能和既有官方门禁都归入托管规范目录', () => {
  const groupIds = agentPolicyGroups.map(({ id }) => id);
  const entryIds = agentPolicyCatalog.map(({ id }) => id);
  assert.equal(new Set(groupIds).size, groupIds.length);
  assert.equal(new Set(entryIds).size, entryIds.length);
  assert.ok(agentPolicyCatalog.every(({ groupId }) => groupIds.includes(groupId)));
  for (const field of ['features', 'gates', 'capabilities']) {
    const assignments = agentPolicyCatalog.flatMap((entry) => entry[field]);
    assert.equal(new Set(assignments).size, assignments.length);
  }
  assert.deepEqual(
    [...managedAgentPolicyFeatures].sort(),
    [...CONFIGURABLE_FEATURES].sort(),
  );
  assert.deepEqual(
    [...managedAgentPolicyGateIds].sort(),
    officialGates
      .map(({ id }) => id)
      .filter((id) => id !== 'repository.agent-policy')
      .sort(),
  );
  assert.deepEqual(agentPolicies.map(({ id }) => id), agentPolicyGroups.map(({ id }) => id));
  assert.deepEqual(managedAgentPolicyCapabilities, [
    'dead-code-baseline',
    'guarded-build',
    'external-gates',
    'api-performance',
    'k6',
  ]);
});

test('原子迁移旧 marker，保留人工内容并按配置增删托管规则', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'AGENTS.md'), [
    '# 人工规范',
    '',
    '这里的内容由项目维护。',
    '',
    '<!-- repo-guard:architecture-policy:start -->',
    '旧架构策略',
    '<!-- repo-guard:architecture-policy:end -->',
    '',
    '<!-- repo-guard:exception-policy:start -->',
    '旧例外策略',
    '<!-- repo-guard:exception-policy:end -->',
    '',
    '<!-- repo-guard:unit-test-policy:start -->',
    '旧单元测试策略',
    '<!-- repo-guard:unit-test-policy:end -->',
    '',
    '<!-- repo-guard:accessibility-test-policy:start -->',
    '旧无障碍测试策略',
    '<!-- repo-guard:accessibility-test-policy:end -->',
    '',
    '旧托管块之后的人工内容也必须保留。',
    '',
  ].join('\n'));
  const config = createStarterConfig();
  config.commitMessage.enabled = true;
  config.commitMessage.fixup.allowLocal = true;
  config.commitMessage.fixup.allowPush = true;
  config.commitMessage.fixup.allowCi = false;
  config.preCommit.fileHeader.enabled = true;
  config.imageAssets.enabled = true;
  config.architecture.enabled = true;
  config.codePlacement.enabled = true;
  config.codePlacement.rules = [{
    name: '支付签名',
    content: '绝不能写入托管规范的敏感匹配内容',
    allowedFiles: ['src/payment/signature.js'],
    scanPatterns: ['src/**/*.js'],
  }];
  config.externalGates = [{
    id: 'project.k6',
    enabled: true,
    environments: ['manual'],
    script: 'test:k6',
    timeoutMs: 1000,
    report: { format: 'repo-guard-json-v1', path: 'reports/k6.json' },
  }];

  assert.equal(syncAgentPolicies(root, config).changed, true);
  assert.equal(syncAgentPolicies(root, config).changed, false);
  const enabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(enabledContent, /# 人工规范/);
  assert.match(enabledContent, /旧托管块之后的人工内容也必须保留。/);
  assert.ok(
    enabledContent.indexOf('# 人工规范')
      < enabledContent.indexOf('旧托管块之后的人工内容也必须保留。'),
  );
  assert.ok(
    enabledContent.indexOf('旧托管块之后的人工内容也必须保留。')
      < enabledContent.indexOf('<!-- repo-guard:repository-governance-policy:start -->'),
  );
  for (const legacyId of [
    'architecture-policy',
    'exception-policy',
    'unit-test-policy',
    'accessibility-test-policy',
  ]) {
    assert.doesNotMatch(enabledContent, new RegExp(`repo-guard:${legacyId}:(?:start|end)`));
  }
  assert.match(enabledContent, /repo-guard:dependency-health-policy:start/);
  assert.match(enabledContent, /文件头由 repo-guard 依据 Git 记录维护/);
  assert.match(enabledContent, /fixup!\/squash! 在本地允许、pre-push 阶段允许、CI 阶段禁止/);
  assert.match(enabledContent, /k6 并发压测/);
  assert.match(enabledContent, /图片资源必须遵守/);
  assert.match(enabledContent, /Hook 与 CI 只能检查/);
  assert.doesNotMatch(enabledContent, /\bundefined\b/);
  assert.doesNotMatch(enabledContent, /绝不能写入托管规范的敏感匹配内容/);

  config.imageAssets.naming.enabled = false;
  assert.equal(syncAgentPolicies(root, config).changed, true);
  const namingDisabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(namingDisabledContent, /`camelCase` 命名/);
  assert.match(namingDisabledContent, /扩展名与真实格式一致/);

  config.preCommit.fileHeader.enabled = false;
  config.imageAssets.enabled = false;
  config.architecture.enabled = false;
  config.codePlacement.enabled = false;
  config.externalGates = [];
  assert.equal(syncAgentPolicies(root, config).changed, true);
  const disabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(disabledContent, /文件头由 repo-guard 依据 Git 记录维护/);
  assert.doesNotMatch(disabledContent, /k6 并发压测/);
  assert.doesNotMatch(disabledContent, /图片资源必须遵守/);
  assert.doesNotMatch(disabledContent, /修改模块依赖后必须运行/);
});

test('marker 异常时拒绝任何写入', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const malformed = [
    '<!-- repo-guard:testing-policy:start -->',
    '缺少结束标记',
    '',
  ].join('\n');
  writeFileSync(path.join(root, 'AGENTS.md'), malformed);

  assert.throws(
    () => syncAgentPolicies(root, createStarterConfig()),
    (error) => error.code === 'managed-text/malformed-markers',
  );
  assert.equal(readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), malformed);
});

test('中央 CI 门禁只读识别过期内容，并在同步后通过', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const config = createStarterConfig();
  const gateContext = { root, config };

  assert.equal(inspectAgentPolicies(root, config).changed, true);
  assert.equal(agentPolicyGate.run(gateContext).status, 'violation');
  syncAgentPolicies(root, config);
  assert.equal(agentPolicyGate.run(gateContext).status, 'passed');
});

test('启用和禁用图片治理会同步 AGENTS.md 托管规则', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(['init'], { cwd: root });
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(createStarterConfig(), null, 2)}\n`,
    'utf8',
  );

  assert.equal(runEnable(['imageAssets'], root), 0);
  const enabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(enabledContent, /图片资源必须遵守/);
  assert.match(enabledContent, /Hook 与 CI 只能检查/);

  assert.equal(runDisable(['imageAssets'], root), 0);
  const disabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(disabledContent, /图片资源必须遵守/);
  assert.match(disabledContent, /repo-guard:repository-governance-policy:start/);
});

test('启用无效图片资源会把静态引用和动态声明边界写入 AGENTS.md', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(['init'], { cwd: root });
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(createStarterConfig(), null, 2)}\n`,
    'utf8',
  );

  assert.equal(runEnable(['unusedImageAssets'], root), 0);
  const enabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(enabledContent, /无效图片资源按 `changedFiles` 模式治理/);
  assert.match(enabledContent, /imageAssets\.unused\.dynamicReferences/);
  assert.match(enabledContent, /不得使用整个仓库通配或未经确认自动删除图片/);

  assert.equal(runDisable(['unusedImageAssets'], root), 0);
  const disabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(disabledContent, /无效图片资源按/);
});
