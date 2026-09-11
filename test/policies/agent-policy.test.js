import { stringifyProjectFixture } from '../helpers/project-config.js';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createStarterConfig,
  CONFIGURABLE_FEATURES,
} from '../../src/orchestration/setup/config-management.js';
import { officialGates } from '../../src/gates/registry.js';
import { agentPolicyGate } from '../../src/gates/repository/repository-policy-gates.js';
import {
  runEnable,
  runDisable,
} from '../../src/orchestration/cli/configuration.js';
import { runGit } from '../../src/git/execution.js';
import {
  agentPolicyCatalog,
  agentPolicyGroups,
  managedAgentPolicyCapabilities,
  managedAgentPolicyFeatures,
  managedAgentPolicyGateIds,
  renderAgentPolicyGroups,
} from '../../src/policies/agent-policy-catalog.js';

test('根规范说明应用隔离与独立合同，不要求在公共入口登记应用例外', () => {
  const config = createStarterConfig();
  delete config.project;
  const document = renderAgentPolicyGroups({ config, packageJson: {} }).flatMap(({ lines }) => lines).join('\n');
  assert.match(document, /应用工程规则、依赖、例外与外部门禁必须配置在所属应用/);
  assert.doesNotMatch(document, /例外只能登记在/);
  assert.match(document, /repo-guard\.delivery\.json/);
  assert.match(document, /AI 不得读取、保管或使用验收人的签名私钥/);
});

test('仓库归位生成根 AI 规范并明确范围，应用默认不复制根规则', () => {
  const config = createStarterConfig();
  delete config.project;
  config.repository.filePlacement = {
    enabled: true,
    rules: [{ name: 'SQL 归位', patterns: ['**/*.sql'], allowedPatterns: ['database/sql/**'], exceptions: [], suggestedDirectory: 'database/sql' }],
  };
  const document = renderAgentPolicyGroups({ config, packageJson: {} }).flatMap(({ lines }) => lines).join('\n');
  assert.match(document, /完整 Git 索引/);
  assert.match(document, /应用自己的规则或例外不能豁免仓库规则/);
  assert.match(document, /database\/sql\/\*\*/);
  assert.match(document, /repo-guard repository-file-placement/);
  const applicationDocument = renderAgentPolicyGroups({ config: createStarterConfig(), packageJson: {} }).flatMap(({ lines }) => lines).join('\n');
  assert.doesNotMatch(applicationDocument, /SQL 归位|repo-guard repository-file-placement/);
});
import {
  agentPolicies,
  inspectAgentPolicies,
  syncAgentPolicies,
} from '../../src/policies/agent-policies.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

test('UI Token 托管规范随语言和图标选择器配置同步并说明变量来源限制', () => {
  const starter = createStarterConfig();
  const config = {
    ...starter,
    checks: {
      ...starter.checks,
      uiTokens: {
        ...starter.checks.uiTokens,
        enabled: true,
        languages: ['css', 'sass', 'less'],
        iconSelectors: ['.app-icon'],
      },
    },
  };
  const document = renderAgentPolicyGroups({ config, packageJson: {} })
    .flatMap(({ lines }) => lines).join('\n');
  assert.match(document, /UI Token 门禁检查.*css.*sass.*less/);
  assert.match(document, /\.app-icon/);
  assert.match(document, /变量只能在来源文件定义/);
  assert.match(document, /CSS 断点长度别名只用于 CSS/);
  assert.doesNotMatch(document, /UnoCSS|Attributify|shortcut/);
});

function fixture() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'agent-policy-'));
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'agent-policy-fixture',
        version: '1.0.0',
        scripts: {
          'test:k6': 'repo-guard k6-runner --gate-id project.k6',
        },
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

test('每个可配置功能和既有官方门禁都归入托管规范目录', () => {
  const groupIds = agentPolicyGroups.map(({ id }) => id);
  const entryIds = agentPolicyCatalog.map(({ id }) => id);
  assert.equal(new Set(groupIds).size, groupIds.length);
  assert.equal(new Set(entryIds).size, entryIds.length);
  assert.ok(
    agentPolicyCatalog.every(({ groupId }) => groupIds.includes(groupId)),
  );
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
  assert.deepEqual(
    agentPolicies.map(({ id }) => id),
    agentPolicyGroups.map(({ id }) => id),
  );
  assert.deepEqual(managedAgentPolicyCapabilities, [
    'dead-code-baseline',
    'guarded-build',
    'build-artifact-baseline',
    'external-gates',
    'api-performance',
    'k6',
  ]);
});

test('保留人工内容并按当前配置增删托管规则，重复同步保持幂等', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    path.join(root, 'AGENTS.md'),
    [
      '# 人工规范',
      '',
      '这里的内容由项目维护。',
      '',
      '另一段人工内容也必须保留。',
      '',
    ].join('\n'),
  );
  const config = createStarterConfig();
  config.repository.commitMessage.enabled = true;
  config.repository.commitMessage.fixup.allowLocal = true;
  config.repository.commitMessage.fixup.allowPush = true;
  config.repository.commitMessage.fixup.allowCi = false;
  config.checks.fileHeader.enabled = true;
  config.checks.imageAssets.enabled = true;
  config.checks.architecture.enabled = true;
  config.repository.deliveryContract.enabled = true;
  config.repository.codePlacement.enabled = true;
  config.repository.codePlacement.rules = [
    {
      name: '支付签名',
      content: '绝不能写入托管规范的敏感匹配内容',
      allowedFiles: ['src/payment/signature.js'],
      scanPatterns: ['src/**/*.js'],
    },
  ];
  config.ci.externalGates = [
    {
      id: 'project.k6',
      enabled: true,
      environments: ['manual'],
      script: 'test:k6',
      timeoutMs: 1000,
      report: { format: 'repo-guard-json-v2', path: 'reports/k6.json' },
    },
  ];

  assert.equal(syncAgentPolicies(root, config).changed, true);
  assert.equal(syncAgentPolicies(root, config).changed, false);
  const enabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(enabledContent, /# 人工规范/);
  assert.match(enabledContent, /另一段人工内容也必须保留。/);
  assert.ok(
    enabledContent.indexOf('# 人工规范') <
      enabledContent.indexOf('另一段人工内容也必须保留。'),
  );
  assert.ok(
    enabledContent.indexOf('另一段人工内容也必须保留。') <
      enabledContent.indexOf(
        '<!-- repo-guard:repository-governance-policy:start -->',
      ),
  );
  assert.match(enabledContent, /repo-guard:dependency-health-policy:start/);
  assert.match(enabledContent, /文件头由 repo-guard 依据 Git 记录维护/);
  assert.match(
    enabledContent,
    /fixup!\/squash! 在本地允许、pre-push 阶段允许、CI 阶段禁止/,
  );
  assert.match(enabledContent, /k6 并发压测/);
  assert.match(enabledContent, /图片资源必须遵守/);
  assert.match(enabledContent, /Hook 与 CI 只能检查/);
  assert.match(enabledContent, /当前分支唯一的活动 Markdown 交付合同/);
  assert.match(enabledContent, /五个流程 Skill/);
  assert.match(enabledContent, /schemaVersion: 2/);
  assert.match(enabledContent, /AI 不得代填或勾选 HUMAN-\* 事项/);
  assert.doesNotMatch(enabledContent, /\bundefined\b/);
  assert.doesNotMatch(enabledContent, /绝不能写入托管规范的敏感匹配内容/);

  config.checks.imageAssets.naming.enabled = false;
  assert.equal(syncAgentPolicies(root, config).changed, true);
  const namingDisabledContent = readFileSync(
    path.join(root, 'AGENTS.md'),
    'utf8',
  );
  assert.doesNotMatch(namingDisabledContent, /`camelCase` 命名/);
  assert.match(namingDisabledContent, /扩展名与真实格式一致/);

  config.checks.fileHeader.enabled = false;
  config.checks.imageAssets.enabled = false;
  config.checks.architecture.enabled = false;
  config.repository.deliveryContract.enabled = false;
  config.repository.codePlacement.enabled = false;
  config.ci.externalGates = [];
  assert.equal(syncAgentPolicies(root, config).changed, true);
  const disabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(disabledContent, /文件头由 repo-guard 依据 Git 记录维护/);
  assert.doesNotMatch(disabledContent, /k6 并发压测/);
  assert.doesNotMatch(disabledContent, /图片资源必须遵守/);
  assert.doesNotMatch(disabledContent, /当前分支唯一的活动 Markdown 交付合同/);
  assert.doesNotMatch(disabledContent, /修改模块依赖后必须运行/);
});

test('旧版、未知和新旧混合规范 marker 均拒绝，不改原文件或追加当前区块', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const config = createStarterConfig();
  const file = path.join(root, 'AGENTS.md');
  syncAgentPolicies(root, config);
  const current = readFileSync(file, 'utf8');
  for (const id of ['architecture-policy', 'exception-policy', 'unit-test-policy', 'accessibility-test-policy', 'unknown-policy']) {
    const unsupported = `<!-- repo-guard:${id}:start -->\n人工待确认的旧规范\n<!-- repo-guard:${id}:end -->\n`;
    for (const content of [unsupported, `${current}\n${unsupported}`, unsupported.replaceAll('\n', '\r\n')]) {
      writeFileSync(file, content);
      assert.throws(() => syncAgentPolicies(root, config), { code: 'managed-text/unsupported-markers' });
      assert.throws(() => inspectAgentPolicies(root, config), { code: 'managed-text/unsupported-markers' });
      assert.equal(readFileSync(file, 'utf8'), content);
    }
  }
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
    `${stringifyProjectFixture(createStarterConfig(), null, 2)}\n`,
    'utf8',
  );

  assert.equal(runEnable(['imageAssets'], root), 0);
  const enabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(enabledContent, /图片资源必须遵守/);
  assert.match(enabledContent, /Hook 与 CI 只能检查/);

  assert.equal(runDisable(['imageAssets'], root), 0);
  const disabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(disabledContent, /图片资源必须遵守/);
  assert.match(
    disabledContent,
    /repo-guard:repository-governance-policy:start/,
  );
});

test('启用和禁用交付合同会同步项目级流程 Skills', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(['init'], { cwd: root });
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${stringifyProjectFixture(createStarterConfig(), null, 2)}\n`,
    'utf8',
  );

  assert.equal(runEnable(['deliveryContract'], root), 0);
  assert.equal(
    existsSync(path.join(root, '.repo-guard', 'managed-skills.json')),
    true,
  );
  assert.equal(
    existsSync(
      path.join(
        root,
        '.agents',
        'skills',
        'repo-guard-delivery-contract',
        'SKILL.md',
      ),
    ),
    true,
  );
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /五个流程 Skill/,
  );

  assert.equal(runDisable(['deliveryContract'], root), 0);
  assert.equal(
    existsSync(path.join(root, '.repo-guard', 'managed-skills.json')),
    false,
  );
  assert.equal(
    existsSync(
      path.join(
        root,
        '.agents',
        'skills',
        'repo-guard-delivery-contract',
        'SKILL.md',
      ),
    ),
    false,
  );
});

test('启用无效图片资源会把静态引用和动态声明边界写入 AGENTS.md', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(['init'], { cwd: root });
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${stringifyProjectFixture(createStarterConfig(), null, 2)}\n`,
    'utf8',
  );

  assert.equal(runEnable(['unusedImageAssets'], root), 0);
  const enabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(enabledContent, /无效图片资源按 `changedFiles` 模式治理/);
  assert.match(enabledContent, /checks\.unusedImageAssets\.dynamicReferences/);
  assert.match(enabledContent, /不得使用整个仓库通配或未经确认自动删除图片/);

  assert.equal(runDisable(['unusedImageAssets'], root), 0);
  const disabledContent = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(disabledContent, /无效图片资源按/);
});

test('构建产物预算按项目唯一平台写入 AGENTS.md 托管规范', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const config = createStarterConfig({
    buildEnabled: true,
  });
  config.checks.build.artifactBudget = {
    ...config.checks.build.artifactBudget,
    enabled: true,
    platform: 'miniProgram',
    outputDirectory: 'unpackage/dist/build/mp-weixin',
    pc: null,
    miniProgram: {
      provider: 'weixin',
      appConfig: 'app.json',
      limits: {
        mainPackageBytes: 2097152,
        defaultSubPackageBytes: 2097152,
        totalPackageBytes: 20971520,
        maxSingleFileBytes: null,
        maxPreloadBytes: null,
      },
      subPackages: [],
      expectedSubPackages: [],
      exclusions: [],
    },
  };

  syncAgentPolicies(root, config);
  const content = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(content, /当前项目构建平台固定为 `miniProgram`/);
  assert.match(content, /主包、每个分包、总包、单文件和 preloadRule/);
  assert.match(content, /禁止使用 report 或基线模式降级/);
});
