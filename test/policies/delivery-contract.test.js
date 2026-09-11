import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';
import { validateConfig } from '../../src/config/configuration-validation.js';
import {
  calculateArtifactPlanDigest,
  calculateDefinitionDigest,
  calculateExecutionDigest,
  calculateGateResultDigest,
  calculateRequirementFactsDigest,
  calculateSourceBundleDigest,
  calculateTechnicalEvidenceDigest,
  sha256Digest,
} from '../../src/policies/delivery-contract/digests.js';
import { inspectDeliveryEvidence } from '../../src/policies/delivery-contract/evidence.js';
import { inspectContractSchema } from '../../src/policies/delivery-contract/contract-schema.js';
import { inspectFeatureRegistry } from '../../src/policies/delivery-contract/feature-registry.js';
import { parseDeliveryContractMarkdown } from '../../src/policies/delivery-contract/markdown.js';
import { inspectDeliveryContract } from '../../src/policies/delivery-contract/repository.js';
import { inspectDeliveryContractSetup } from '../../src/policies/delivery-contract/setup.js';
import { deliveryEvidenceGate } from '../../src/gates/release/delivery-evidence-gate.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
const CONTRACT_ID = 'DC-20260906-001';
const CONTRACT_PATH = `docs/delivery/contracts/${CONTRACT_ID}.md`;
const TRACEABILITY_PATH = `docs/delivery/contracts/${CONTRACT_ID}/traceability.md`;
const OBLIGATIONS_PATH = `docs/delivery/contracts/${CONTRACT_ID}/obligations.md`;
const EVIDENCE_RUN_PATH = `docs/delivery/contracts/${CONTRACT_ID}/evidence/runs/RUN-20260906-001.md`;
const SOURCE_PATH = `docs/delivery/contracts/${CONTRACT_ID}/requirements/rev-001/sources/SRC-001__20260906T143022+0800__需求.txt`;
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, argumentsList) {
  const result = spawnSync('git', argumentsList, {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(root, relativePath, content) {
  const absolute = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function readContractSource(root) {
  return readFileSync(path.join(root, ...CONTRACT_PATH.split('/')), 'utf8');
}

function readObligationsSource(root) {
  return readFileSync(path.join(root, ...OBLIGATIONS_PATH.split('/')), 'utf8');
}

function body() {
  return `# 交付合同：测试功能

## 交付目标

交付一个可验证的测试功能。

## 非目标

不修改测试范围外的系统。

## Spec

REQ-001 要求测试功能可以执行。

## Design

DES-001 使用一个小型模块实现。

## Tasks

TASK-001 实现模块，TEST-001 验证需求。

## 验收条件

AC-001 对应测试通过且人工验收完成。
`;
}

function obligationsBody({
  complete,
  confirmedAt = '2026-09-06T15:00:00+08:00',
  definitionDigest,
  subjectCommit = 'pending',
  technicalDigest = 'pending',
}) {
  const mark = complete ? 'x' : ' ';
  const taskEvidence = complete ? 'EVD-COMMIT-001' : 'pending';
  const gateEvidence = complete ? 'EVD-GATE-001' : 'pending';
  return `# 交付执行清单

## 交付执行清单

- [x] \`HUMAN-PLAN-001\` 人工确认合同定义和资料计划
  - 执行者：\`human\`
  - 确认人：产品负责人
  - 确认时间：${confirmedAt}
  - 绑定定义指纹：\`${definitionDigest}\`

- [${mark}] \`TASK-001\` 实现测试功能
  - 执行者：\`ai\`
  - 证据：\`${taskEvidence}\`

- [${mark}] \`TEST-001\` 回归测试通过
  - 执行者：\`gate\`
  - 门禁：\`quality.unit-test\`
  - 证据：\`${gateEvidence}\`

- [${mark}] \`HUMAN-ACCEPT-001\` 人工最终验收通过
  - 执行者：\`human\`
  - 确认人：${complete ? '产品负责人' : 'pending'}
  - 确认时间：${complete ? '2026-09-06T16:00:00+08:00' : 'pending'}
  - 绑定提交：\`${subjectCommit}\`
  - 绑定定义指纹：\`${definitionDigest}\`
  - 技术证据指纹：\`${technicalDigest}\`
`;
}

function contractData({
  baseline,
  sourceDigest,
  bundleDigest,
  definitionDigest = `sha256:${'0'.repeat(64)}`,
}) {
  return {
    schemaVersion: 2,
    contractId: CONTRACT_ID,
    contractRevision: 1,
    featureId: 'sample-feature',
    type: 'feature',
    lifecycle: 'active',
    summary: '交付测试功能。',
    relations: {},
    historicalFeedbackApplied: [],
    repository: {
      workingBranch: 'feat/delivery-contract',
      targetBranch: 'main',
      baselineCommit: baseline,
      changeBoundary: {
        allowedPaths: ['**/*'],
        forbiddenPaths: ['secrets/**'],
      },
      worktree: { policy: 'any' },
    },
    materials: {
      requirements: 'requirements/rev-001/requirements.md',
      traceability: 'traceability.md',
      obligations: 'obligations.md',
      findingsDirectory: 'findings',
    },
    requirements: {
      revision: 1,
      confirmation: {
        status: 'confirmed',
        revision: 1,
        confirmedAt: '2026-09-06T14:30:22+08:00',
        confirmedBy: '产品负责人',
        comment: '确认本地需求快照。',
        sourceBundleDigest: bundleDigest,
      },
      sources: [
        {
          id: 'SRC-001',
          name: '原始需求',
          acquisition: 'download',
          originalUrl: 'https://example.com/requirement',
          files: [
            {
              path: SOURCE_PATH,
              mediaType: 'text/plain',
              digestAlgorithm: 'sha256-bytes-v1',
              digest: sourceDigest,
            },
          ],
        },
      ],
      sourceBundleDigest: bundleDigest,
      facts: [
        {
          id: 'REQ-001',
          summary: '测试功能可以执行。',
          sourceId: 'SRC-001',
          locator: '第 1 行',
        },
      ],
      blockingQuestions: [],
    },
    artifactPlan: {
      generatedBy: 'ai',
      generatedAt: '2026-09-06T14:40:00+08:00',
      items: {
        spec: { mode: 'inline', paths: [], reason: '需求较短，适合内联。' },
        design: { mode: 'inline', paths: [], reason: '设计较短，适合内联。' },
        tasks: { mode: 'inline', paths: [], reason: '任务较少，适合内联。' },
        examples: { mode: 'not-needed', paths: [], reason: '没有可复用示例。' },
        visuals: { mode: 'not-needed', paths: [], reason: '不包含界面变化。' },
      },
      confirmation: {
        status: 'confirmed',
        confirmedAt: '2026-09-06T15:00:00+08:00',
        confirmedBy: '产品负责人',
        comment: '确认资料计划。',
      },
    },
    traceability: [
      {
        factId: 'REQ-001',
        design: ['DES-001'],
        tasks: ['TASK-001'],
        artifacts: [],
        verification: ['TEST-001'],
      },
    ],
    confirmation: {
      status: 'confirmed',
      confirmedAt: '2026-09-06T15:00:00+08:00',
      confirmedBy: '产品负责人',
      comment: '确认合同。',
      definitionDigest,
    },
  };
}

function markdown(data, content) {
  return `---\n${stringify(data).trimEnd()}\n---\n\n${content}`;
}

function mainContractData(data) {
  const main = { ...data };
  delete main.requirements;
  delete main.traceability;
  return main;
}

function requirementsDocument(data) {
  return {
    schemaVersion: 2,
    documentType: 'requirements',
    contractId: data.contractId,
    ...data.requirements,
  };
}

function traceabilityDocument(data) {
  return {
    schemaVersion: 2,
    documentType: 'traceability',
    contractId: data.contractId,
    entries: data.traceability,
  };
}

function obligationsDocument(data, content) {
  return markdown(
    {
      schemaVersion: 2,
      documentType: 'obligations',
      contractId: data.contractId,
    },
    content,
  );
}

function findingDocument(data, findingContent) {
  const findingId = findingContent.match(/### `([^`]+)`/)?.[1];
  return {
    content: markdown(
      {
        schemaVersion: 2,
        documentType: 'finding',
        contractId: data.contractId,
        findingId,
      },
      `# 交付发现\n\n## 交付发现\n\n${findingContent}\n`,
    ),
    path: `docs/delivery/contracts/${data.contractId}/findings/${findingId}.md`,
  };
}

function parsedForDigest(data, options) {
  const main = parseDeliveryContractMarkdown(
    markdown(mainContractData(data), body(options)),
  );
  const obligations = parseDeliveryContractMarkdown(
    obligationsDocument(data, obligationsBody(options)),
  );
  const findings =
    options.findingContent && options.findingContent !== '暂无正式交付发现。'
      ? parseDeliveryContractMarkdown(
          findingDocument(data, options.findingContent).content,
        ).findings
      : [];
  return {
    ...main,
    data,
    mainData: main.data,
    obligations: obligations.obligations,
    findings,
  };
}

function writeContractBundle(root, data, options) {
  write(root, CONTRACT_PATH, markdown(mainContractData(data), body(options)));
  write(
    root,
    `docs/delivery/contracts/${data.contractId}/${data.materials.requirements}`,
    markdown(requirementsDocument(data), '# 需求事实\n'),
  );
  write(
    root,
    TRACEABILITY_PATH,
    markdown(traceabilityDocument(data), '# 追踪关系\n'),
  );
  write(
    root,
    OBLIGATIONS_PATH,
    obligationsDocument(data, obligationsBody(options)),
  );
  if (
    options.findingContent &&
    options.findingContent !== '暂无正式交付发现。'
  ) {
    const finding = findingDocument(data, options.findingContent);
    write(root, finding.path, finding.content);
  }
}

function writeAuxiliaryContractBundle(
  root,
  { allowedPaths, contractId, findingContent = null },
) {
  const contractRoot = `docs/delivery/contracts/${contractId}`;
  const data = {
    schemaVersion: 2,
    contractId,
    contractRevision: 1,
    featureId: 'sample-feature',
    type: 'feature',
    lifecycle: 'closed',
    summary: '历史合同。',
    relations: {},
    historicalFeedbackApplied: [],
    repository: {
      workingBranch: `feat/${contractId.toLowerCase()}`,
      targetBranch: 'main',
      baselineCommit: '0'.repeat(40),
      changeBoundary: { allowedPaths, forbiddenPaths: [] },
      worktree: { policy: 'any' },
    },
    materials: {
      requirements: 'requirements/rev-001/requirements.md',
      traceability: 'traceability.md',
      obligations: 'obligations.md',
      findingsDirectory: 'findings',
    },
    artifactPlan: {},
    confirmation: {},
  };
  write(
    root,
    `docs/delivery/contracts/${contractId}.md`,
    markdown(data, '# 历史合同\n'),
  );
  write(
    root,
    `${contractRoot}/requirements/rev-001/requirements.md`,
    markdown(
      {
        schemaVersion: 2,
        documentType: 'requirements',
        contractId,
        revision: 1,
        confirmation: {},
        sources: [],
        sourceBundleDigest: `sha256:${'0'.repeat(64)}`,
        facts: [],
        blockingQuestions: [],
      },
      '# 历史需求\n',
    ),
  );
  write(
    root,
    `${contractRoot}/traceability.md`,
    markdown(
      {
        schemaVersion: 2,
        documentType: 'traceability',
        contractId,
        entries: [],
      },
      '# 历史追踪\n',
    ),
  );
  write(
    root,
    `${contractRoot}/obligations.md`,
    markdown(
      {
        schemaVersion: 2,
        documentType: 'obligations',
        contractId,
      },
      '# 历史清单\n\n## 交付执行清单\n\n- [ ] `TASK-HISTORY-001` 历史任务\n',
    ),
  );
  if (findingContent) {
    const finding = findingDocument({ contractId }, findingContent);
    write(root, finding.path, finding.content);
  }
}

function featureRegistry() {
  return {
    schemaVersion: 2,
    features: [
      {
        id: 'sample-feature',
        name: '测试功能',
        status: 'active',
        confirmedAt: '2026-09-06T14:00:00+08:00',
        confirmedBy: '产品负责人',
        requirementSource: 'https://example.com/requirement',
        uiSource: null,
        description: '用于验证合同驱动交付。',
        children: [],
        deliveryContracts: [{ id: CONTRACT_ID, path: CONTRACT_PATH }],
      },
    ],
  };
}

function projectConfig() {
  return validateConfig({
    version: 2,
    project: {
      id: 'web',
      role: 'frontend',
      stack: 'node',
      preset: 'vue-javascript',
    },
    repository: {
      deliveryContract: {
        enabled: true,
        registryPath: 'docs/delivery/feature-registry.json',
        contractsDirectory: 'docs/delivery/contracts',
        requiredFor: ['**/*'],
        exclude: ['reports/**'],
      },
      rules: [
        {
          pattern: '**/*',
          category: '测试文件',
          level: 'audit',
        },
      ],
    },
  }).repository.deliveryContract;
}

function fixture(context) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'delivery-contract-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'core.autocrlf', 'false']);
  write(root, 'README.md', '# Fixture\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const baseline = git(root, ['rev-parse', 'HEAD']);
  git(root, ['switch', '-c', 'feat/delivery-contract']);
  const source = Buffer.from('REQ-001: 测试功能可以执行。\n', 'utf8');
  const sourceDigest = sha256Digest(source);
  const bundleDigest = calculateSourceBundleDigest([
    { path: SOURCE_PATH, digest: sourceDigest },
  ]);
  const data = contractData({ baseline, bundleDigest, sourceDigest });
  let parsed = parsedForDigest(data, {
    complete: false,
    definitionDigest: data.confirmation.definitionDigest,
  });
  const definitionDigest = calculateDefinitionDigest(parsed);
  data.confirmation.definitionDigest = definitionDigest;
  write(root, SOURCE_PATH, source);
  write(
    root,
    'docs/delivery/feature-registry.json',
    `${JSON.stringify(featureRegistry(), null, 2)}\n`,
  );
  writeContractBundle(root, data, { complete: false, definitionDigest });
  write(root, 'src/sample.js', 'export const sample = true;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'implementation']);
  const implementationCommit = git(root, ['rev-parse', 'HEAD']);
  return { baseline, data, definitionDigest, implementationCommit, root };
}

function commitCompletedEvidence({
  additionalEvidence = [],
  baseline,
  data,
  definitionDigest,
  executionLog = [],
  findingContent = '暂无正式交付发现。',
  implementationCommit,
  root,
}) {
  const subjectCommit = git(root, ['rev-parse', 'HEAD']);
  const taskCommit = implementationCommit ?? subjectCommit;
  const targetCommit = git(root, ['rev-parse', 'main']);
  const targetChangedPaths =
    targetCommit === baseline
      ? []
      : git(root, ['diff', '--name-only', baseline, targetCommit])
          .split(/\r?\n/)
          .filter(Boolean);
  const releaseTestResult = {
    gateId: 'quality.unit-test',
    status: 'passed',
    summary: '测试通过',
    findings: [],
    artifacts: [],
    metrics: {},
    error: null,
    diagnostics: [],
  };
  const gateResultDigest = calculateGateResultDigest(releaseTestResult);
  const evidenceRunData = {
    schemaVersion: 2,
    runId: 'RUN-20260906-001',
    generatedAt: '2026-09-06T15:50:00+08:00',
    contractId: CONTRACT_ID,
    contractRevision: data.contractRevision,
    definitionDigest,
    baselineCommit: baseline,
    requirementsRevision: data.requirements.revision,
    sourceBundleDigest: data.requirements.sourceBundleDigest,
    requirementFactsDigest: calculateRequirementFactsDigest(data.requirements),
    artifactPlanDigest: calculateArtifactPlanDigest(data.artifactPlan),
    targetBranch: 'main',
    targetCommit,
    integrationBaseCommit: targetCommit,
    subjectCommit,
    integrationAnalysis:
      targetCommit === baseline
        ? null
        : {
            fromCommit: baseline,
            toCommit: targetCommit,
            changedPaths: targetChangedPaths,
            impact: 'none',
            summary:
              '目标分支变化与当前合同定义无关，已在最新目标提交上重新验证。',
            confirmation: {
              status: 'confirmed',
              confirmedAt: '2026-09-06T15:45:00+08:00',
              confirmedBy: '产品负责人',
              targetCommit,
              contractRevision: data.contractRevision,
              definitionDigest,
            },
          },
    gateResults: [
      {
        gateId: 'quality.unit-test',
        resultDigest: gateResultDigest,
        result: releaseTestResult,
      },
    ],
    executionLog,
    evidence: [
      {
        id: 'EVD-COMMIT-001',
        type: 'commit',
        description: '功能代码提交。',
        commit: taskCommit,
        paths: ['src/sample.js'],
      },
      {
        id: 'EVD-GATE-001',
        type: 'gate-result',
        description: '本轮测试 GateResult。',
        gateId: 'quality.unit-test',
        resultDigest: gateResultDigest,
      },
      ...additionalEvidence,
    ],
  };
  const evidenceRunSource = markdown(evidenceRunData, '# 交付证据批次\n');
  const evidenceRunDigest = sha256Digest(
    Buffer.from(evidenceRunSource, 'utf8'),
  );
  data.deliveryEvidence = {
    integrationBaseCommit: targetCommit,
    subjectCommit,
    definitionDigest,
    sourceBundleDigest: data.requirements.sourceBundleDigest,
    evidenceRunPath: EVIDENCE_RUN_PATH,
    evidenceRunDigest,
    technicalEvidenceDigest: `sha256:${'0'.repeat(64)}`,
    executionDigest: `sha256:${'0'.repeat(64)}`,
  };
  let parsed = parsedForDigest(data, {
    complete: true,
    definitionDigest,
    findingContent,
    subjectCommit,
  });
  const technicalDigest = calculateTechnicalEvidenceDigest(
    parsed,
    data.deliveryEvidence,
    {
      data: evidenceRunData,
      digest: evidenceRunDigest,
    },
  );
  data.deliveryEvidence.technicalEvidenceDigest = technicalDigest;
  parsed = parsedForDigest(data, {
    complete: true,
    definitionDigest,
    findingContent,
    subjectCommit,
    technicalDigest,
  });
  data.deliveryEvidence.executionDigest = calculateExecutionDigest(
    parsed,
    data.deliveryEvidence,
  );
  writeContractBundle(root, data, {
    complete: true,
    definitionDigest,
    findingContent,
    subjectCommit,
    technicalDigest,
  });
  write(root, EVIDENCE_RUN_PATH, evidenceRunSource);
  git(root, ['add', CONTRACT_PATH, `docs/delivery/contracts/${CONTRACT_ID}`]);
  git(root, ['commit', '-m', 'evidence']);
  return { releaseTestResult, subjectCommit };
}

function inspect(root, changes = []) {
  return inspectDeliveryContract({
    root,
    config: projectConfig(),
    changes,
    environment: 'manual',
  });
}

test('功能登记表仅接受 schemaVersion 2，不转换旧格式或补齐缺失版本', () => {
  const registry = Object.freeze({ schemaVersion: 2, features: Object.freeze([]) });
  assert.deepEqual(inspectFeatureRegistry(registry, 'features.json').issues, []);
  for (const schemaVersion of [1, 3, undefined]) {
    const unsupported = Object.freeze({ ...registry, schemaVersion });
    const result = inspectFeatureRegistry(unsupported, 'features.json');
    assert.ok(result.issues.some(({ message }) => message.includes('schemaVersion 必须为 2')));
    assert.equal(unsupported.schemaVersion, schemaVersion);
  }
});

test('validates a confirmed contract while implementation and acceptance remain open', (context) => {
  const { root } = fixture(context);
  const result = inspect(root);
  assert.deepEqual(result.issues, []);
  assert.equal(result.selected.parsed.data.contractId, CONTRACT_ID);
  assert.equal(result.selected.parsed.data.schemaVersion, 2);
  assert.doesNotMatch(readContractSource(root), /^requirements:/m);
  assert.doesNotMatch(readContractSource(root), /^traceability:/m);
  assert.equal(
    result.selected.parsed.componentPaths.obligations,
    OBLIGATIONS_PATH,
  );
  assert.equal(
    result.selected.parsed.obligations.find(({ id }) => id === 'TASK-001')
      .checked,
    false,
  );
  const evidence = inspectDeliveryEvidence({ root, inspection: result });
  assert.equal(evidence.state, 'boundary-valid');
  assert.ok(
    evidence.issues.some(({ rule }) => rule === 'delivery-evidence/missing'),
  );
});

test('rejects legacy single-file contracts and invalid component bindings', (context) => {
  const { root } = fixture(context);
  write(
    root,
    CONTRACT_PATH,
    readContractSource(root).replace('schemaVersion: 2', 'schemaVersion: 1'),
  );
  let result = inspect(root);
  assert.ok(
    result.issues.some(({ message }) =>
      message.includes('schemaVersion 必须为 2'),
    ),
  );

  write(
    root,
    CONTRACT_PATH,
    readContractSource(root).replace('schemaVersion: 1', 'schemaVersion: 2'),
  );
  write(
    root,
    TRACEABILITY_PATH,
    readFileSync(
      path.join(root, ...TRACEABILITY_PATH.split('/')),
      'utf8',
    ).replace('documentType: traceability', 'documentType: requirements'),
  );
  result = inspect(root);
  assert.ok(
    result.issues.some(({ message }) =>
      message.includes('documentType 必须为 traceability'),
    ),
  );
});

test('loads a nested Markdown Spec as contract material instead of another contract', (context) => {
  const { data, root } = fixture(context);
  const specPath = `docs/delivery/contracts/${CONTRACT_ID}/spec.md`;
  const spec = Buffer.from('# Spec\n\nREQ-001 的文件型规格。\n', 'utf8');
  data.artifactPlan.items.spec = {
    mode: 'file',
    paths: ['spec.md'],
    reason: '规格内容独立保存并纳入合同定义指纹。',
  };
  data.contractRevision = 2;
  data.confirmation.confirmedAt = '2026-09-06T15:30:00+08:00';
  data.artifactPlan.confirmation.confirmedAt = '2026-09-06T15:30:00+08:00';
  const parsed = parsedForDigest(data, {
    complete: false,
    confirmedAt: data.confirmation.confirmedAt,
    definitionDigest: data.confirmation.definitionDigest,
  });
  const artifactDigests = [
    {
      digest: sha256Digest(spec),
      kind: 'spec',
      mode: 'file',
      path: specPath,
    },
  ];
  const definitionDigest = calculateDefinitionDigest(parsed, artifactDigests);
  data.confirmation.definitionDigest = definitionDigest;
  write(root, specPath, spec);
  writeContractBundle(root, data, {
    complete: false,
    confirmedAt: data.confirmation.confirmedAt,
    definitionDigest,
  });
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'add file spec']);

  const result = inspect(root);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.artifactDigests, artifactDigests);
});

test('checks both sides of a rename and gives forbidden paths priority', (context) => {
  const { root } = fixture(context);
  const result = inspect(root, [
    { status: 'R100', oldPath: 'secrets/old.js', path: 'src/new.js' },
  ]);
  assert.ok(
    result.issues.some(
      ({ rule, path: filePath }) =>
        rule === 'delivery-contract/path-forbidden' &&
        filePath === 'secrets/old.js',
    ),
  );
});

test('blocks release-ready when an actual cross-contract overlap has no coordination record', (context) => {
  const { root } = fixture(context);
  const otherId = 'DC-20260906-002';
  const otherPath = `docs/delivery/contracts/${otherId}.md`;
  const registry = featureRegistry();
  registry.features[0].deliveryContracts.push({ id: otherId, path: otherPath });
  write(
    root,
    'docs/delivery/feature-registry.json',
    `${JSON.stringify(registry, null, 2)}\n`,
  );
  writeAuxiliaryContractBundle(root, {
    allowedPaths: ['src/**'],
    contractId: otherId,
  });
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'add historical contract']);

  const result = inspectDeliveryContract({
    root,
    config: projectConfig(),
    changes: [],
    environment: 'release-ready',
  });
  assert.ok(
    result.issues.some(
      ({ rule }) => rule === 'delivery-contract/parallel-overlap-uncoordinated',
    ),
  );
});

test('recomputes local requirement file fingerprints from bytes', (context) => {
  const { root } = fixture(context);
  write(root, SOURCE_PATH, 'REQ-001: 被篡改。\n');
  const result = inspect(root, [
    { status: 'M', oldPath: null, path: SOURCE_PATH },
  ]);
  assert.ok(
    result.issues.some(
      ({ rule }) => rule === 'delivery-contract/source-digest-mismatch',
    ),
  );
  assert.ok(
    result.issues.some(
      ({ rule }) => rule === 'delivery-contract/source-bundle-digest-mismatch',
    ),
  );
});

test('pre-commit reads the staged contract instead of an unstaged working-tree edit', (context) => {
  const { root } = fixture(context);
  write(root, CONTRACT_PATH, '---\ninvalid: true\n---\n');
  const result = inspectDeliveryContract({
    root,
    config: projectConfig(),
    changes: [],
    environment: 'pre-commit',
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.selected.parsed.data.contractId, CONTRACT_ID);
});

test('derives release-ready only after evidence-only commit closes every obligation', (context) => {
  const { baseline, data, definitionDigest, root } = fixture(context);
  const { releaseTestResult } = commitCompletedEvidence({
    baseline,
    data,
    definitionDigest,
    root,
  });

  const inspection = inspect(root);
  assert.deepEqual(inspection.issues, []);
  const evidence = inspectDeliveryEvidence({ root, inspection });
  assert.deepEqual(evidence.issues, []);
  assert.equal(evidence.state, 'release-ready');
  const currentRunEvidence = inspectDeliveryEvidence({
    root,
    inspection,
    priorResults: [releaseTestResult],
    requireCurrentGateResults: true,
  });
  assert.deepEqual(currentRunEvidence.issues, []);
  const gateResult = deliveryEvidenceGate.run({
    root,
    plan: {
      changes: [],
      config: projectConfig(),
      enabled: true,
      environment: 'release-ready',
      priorResults: [releaseTestResult],
    },
  });
  assert.equal(gateResult.status, 'passed');
  assert.deepEqual(gateResult.artifacts, [
    {
      description: null,
      path: EVIDENCE_RUN_PATH,
      type: 'delivery-evidence',
    },
  ]);
});

test('rejects evidence when the subject commit contains an invalid contract definition', (context) => {
  const { baseline, data, definitionDigest, root } = fixture(context);
  write(
    root,
    CONTRACT_PATH,
    readContractSource(root).replace(
      'schemaVersion: 2',
      'schemaVersion: 2\nunexpected: true',
    ),
  );
  git(root, ['add', CONTRACT_PATH]);
  git(root, ['commit', '-m', 'invalid subject contract']);
  commitCompletedEvidence({ baseline, data, definitionDigest, root });

  const inspection = inspect(root);
  assert.deepEqual(inspection.issues, []);
  const evidence = inspectDeliveryEvidence({ root, inspection });
  assert.ok(
    evidence.issues.some(
      ({ rule }) => rule === 'delivery-evidence/subject-contract-invalid',
    ),
  );
});

test('allows a referenced execution report to be committed with evidence after subjectCommit', (context) => {
  const { baseline, data, definitionDigest, root } = fixture(context);
  const subjectCommit = git(root, ['rev-parse', 'HEAD']);
  const reportPath = `docs/delivery/contracts/${CONTRACT_ID}/evidence/files/EXEC-AFTER-SUBJECT.txt`;
  const report = Buffer.from('本轮测试执行通过。\n', 'utf8');
  write(root, reportPath, report);
  commitCompletedEvidence({
    additionalEvidence: [
      {
        id: 'EVD-EXECUTION-001',
        type: 'execution',
        description: '代码提交后的测试执行报告。',
        executionId: 'EXEC-AFTER-SUBJECT',
      },
    ],
    baseline,
    data,
    definitionDigest,
    executionLog: [
      {
        id: 'EXEC-AFTER-SUBJECT',
        occurredAt: '2026-09-06T15:40:00+08:00',
        commandId: 'test-after-subject',
        subjectCommit,
        exitCode: 0,
        reportPath,
        resultDigest: sha256Digest(report),
      },
    ],
    root,
  });

  const inspection = inspect(root);
  assert.deepEqual(inspection.issues, []);
  const evidence = inspectDeliveryEvidence({ root, inspection });
  assert.deepEqual(evidence.issues, []);
});

test('rejects arbitrary checklist text that does not resolve to a structured evidence record', (context) => {
  const { baseline, data, definitionDigest, root } = fixture(context);
  commitCompletedEvidence({ baseline, data, definitionDigest, root });
  const source = readObligationsSource(root);
  write(
    root,
    OBLIGATIONS_PATH,
    source.replace('EVD-COMMIT-001', '随便填写的完成说明'),
  );

  const inspection = inspect(root);
  const evidence = inspectDeliveryEvidence({ root, inspection });
  assert.ok(
    evidence.issues.some(
      ({ rule }) => rule === 'delivery-evidence/evidence-reference',
    ),
  );
});

test('compares the recorded GateResult content with the current release-ready result', (context) => {
  const { baseline, data, definitionDigest, root } = fixture(context);
  commitCompletedEvidence({ baseline, data, definitionDigest, root });
  const inspection = inspect(root);
  const evidence = inspectDeliveryEvidence({
    root,
    inspection,
    priorResults: [
      {
        gateId: 'quality.unit-test',
        status: 'passed',
        summary: '本轮输出已经变化',
        findings: [],
        artifacts: [],
        metrics: {},
        error: null,
        diagnostics: [],
      },
    ],
    requireCurrentGateResults: true,
  });
  assert.ok(
    evidence.issues.some(
      ({ rule }) => rule === 'delivery-evidence/gate-result-changed',
    ),
  );
});

test('invalidates evidence after the target branch advances beyond the recorded integration base', (context) => {
  const { baseline, data, definitionDigest, implementationCommit, root } =
    fixture(context);
  git(root, ['switch', 'main']);
  write(root, 'src/target.js', 'export const target = 1;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'target advance']);
  git(root, ['switch', 'feat/delivery-contract']);
  git(root, ['merge', '--no-edit', 'main']);
  commitCompletedEvidence({
    baseline,
    data,
    definitionDigest,
    implementationCommit,
    root,
  });

  git(root, ['switch', 'main']);
  write(root, 'src/target.js', 'export const target = 2;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'target advances again']);
  git(root, ['switch', 'feat/delivery-contract']);

  const inspection = inspect(root);
  assert.deepEqual(inspection.issues, []);
  const evidence = inspectDeliveryEvidence({ root, inspection });
  assert.ok(
    evidence.issues.some(
      ({ rule }) => rule === 'delivery-evidence/target-branch-drifted',
    ),
    JSON.stringify(evidence.issues),
  );
});

test('requires the declared target branch to resolve to a local or origin commit', (context) => {
  const { root } = fixture(context);
  const source = readContractSource(root).replace(
    'targetBranch: main',
    'targetBranch: missing-target',
  );
  write(root, CONTRACT_PATH, source);
  const inspection = inspect(root);
  assert.ok(
    inspection.issues.some(
      ({ rule }) => rule === 'delivery-contract/target-branch-missing',
    ),
  );
});

test('accepts a closed test-environment finding only with red-green runs and human retest', (context) => {
  const {
    baseline,
    data,
    definitionDigest,
    implementationCommit: problemCommit,
    root,
  } = fixture(context);
  const redPath = `docs/delivery/contracts/${CONTRACT_ID}/evidence/files/FND-001-red.txt`;
  const greenPath = `docs/delivery/contracts/${CONTRACT_ID}/evidence/files/FND-001-green.txt`;
  const redReport = Buffer.from(
    'TEST-001 failed on the problem commit\n',
    'utf8',
  );
  const greenReport = Buffer.from(
    'TEST-001 passed on the fixed commit\n',
    'utf8',
  );
  write(root, redPath, redReport);
  write(root, greenPath, greenReport);
  write(
    root,
    'src/sample.js',
    'export const sample = true;\nexport const isolated = true;\n',
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fix finding']);
  const fixedCommit = git(root, ['rev-parse', 'HEAD']);
  const findingContent = `### \`FND-20260906-001\` 自测后发现跨范围访问

- 发现者：\`human\`
- 发现阶段：\`test-environment\`
- 发现时间：2026-09-06T16:10:00+08:00
- 问题版本：\`${problemCommit}\`
- 测试环境部署提交：\`${problemCommit}\`
- 类型：\`implementation-gap\`
- 严重程度：\`high\`
- 重复特征：\`sample.cross-scope-access\`
- 关联任务：\`TASK-001\`
- 当前状态：\`closed\`

#### 处理清单

- [x] \`FND-REGISTER-001\` 已登记反馈和问题版本
  - 执行者：\`ai\`
  - 证据：\`EVD-RED-001\`
- [x] \`FND-REPRODUCE-001\` 已稳定复现
  - 执行者：\`ai\`
  - 证据：\`EVD-RED-001\`
- [x] \`FND-CLASSIFY-001\` 已完成原因分类
  - 执行者：\`ai\`
  - 结论：\`implementation-gap\`
- [x] \`FND-RED-TEST-001\` 同一测试在错误版本失败
  - 执行者：\`ai\`
  - 测试：\`TEST-001\`
  - 绑定提交：\`${problemCommit}\`
  - 证据：\`EVD-RED-001\`
- [x] \`FND-FIX-001\` 已完成修复
  - 执行者：\`ai\`
  - 证据：\`EVD-FIX-001\`
- [x] \`FND-GREEN-TEST-001\` 同一测试在修复版本通过
  - 执行者：\`ai\`
  - 测试：\`TEST-001\`
  - 绑定提交：\`${fixedCommit}\`
  - 证据：\`EVD-GREEN-001\`
- [x] \`FND-PROMOTION-001\` 已完成反向升级分析
  - 执行者：\`ai\`
  - 测试升级：\`required\`
  - 合同升级：\`unchanged\`
  - 设计升级：\`unchanged\`
  - 任务模板升级：\`unchanged\`
  - 门禁升级：\`not-needed\`
  - 结论：保留永久回归测试
  - 确认人：产品负责人
  - 确认时间：2026-09-06T16:40:00+08:00
- [x] \`FND-VERIFY-001\` 已完成组合验证
  - 执行者：\`ai\`
  - 证据：\`EVD-GREEN-001\`
- [x] \`FND-HUMAN-RETEST-001\` 人工已在测试环境复测
  - 执行者：\`human\`
  - 确认人：产品负责人
  - 确认时间：2026-09-06T17:00:00+08:00
  - 测试环境部署提交：\`${fixedCommit}\`
`;
  const executionLog = [
    {
      id: 'EXEC-FND-RED-001',
      occurredAt: '2026-09-06T16:20:00+08:00',
      commandId: 'test-regression',
      subjectCommit: problemCommit,
      exitCode: 1,
      reportPath: redPath,
      resultDigest: sha256Digest(redReport),
    },
    {
      id: 'EXEC-FND-GREEN-001',
      occurredAt: '2026-09-06T16:50:00+08:00',
      commandId: 'test-regression',
      subjectCommit: fixedCommit,
      exitCode: 0,
      reportPath: greenPath,
      resultDigest: sha256Digest(greenReport),
    },
  ];
  const additionalEvidence = [
    {
      id: 'EVD-RED-001',
      type: 'execution',
      description: '错误版本上的失败回归测试。',
      executionId: 'EXEC-FND-RED-001',
    },
    {
      id: 'EVD-GREEN-001',
      type: 'execution',
      description: '修复版本上的通过回归测试。',
      executionId: 'EXEC-FND-GREEN-001',
    },
    {
      id: 'EVD-FIX-001',
      type: 'commit',
      description: '问题修复提交。',
      commit: fixedCommit,
      paths: ['src/sample.js'],
    },
  ];
  commitCompletedEvidence({
    additionalEvidence,
    baseline,
    data,
    definitionDigest,
    executionLog,
    findingContent,
    root,
  });

  const inspection = inspect(root);
  assert.deepEqual(inspection.issues, []);
  const evidence = inspectDeliveryEvidence({ root, inspection });
  assert.deepEqual(evidence.issues, []);
});

test('preserves confirmed obligations instead of allowing them to disappear from history', (context) => {
  const { root } = fixture(context);
  const source = readObligationsSource(root);
  const withoutTask = source.replace(
    /- \[ \] `TASK-001`[\s\S]*?(?=- \[ \] `TEST-001`)/,
    '',
  );
  write(root, OBLIGATIONS_PATH, withoutTask);
  const inspection = inspect(root);
  assert.ok(
    inspection.issues.some(
      ({ rule }) => rule === 'delivery-contract/obligation-removed',
    ),
  );
});

test('preserves files from earlier requirement revisions instead of overwriting history', (context) => {
  const { data, root } = fixture(context);
  const nextSourcePath = `docs/delivery/contracts/${CONTRACT_ID}/requirements/rev-002/sources/SRC-001__20260906T160000+0800__需求.txt`;
  const nextSource = Buffer.from('REQ-001: 第二版需求事实。\n', 'utf8');
  const nextSourceDigest = sha256Digest(nextSource);
  const nextBundleDigest = calculateSourceBundleDigest([
    {
      path: nextSourcePath,
      digest: nextSourceDigest,
    },
  ]);
  data.contractRevision = 2;
  data.requirements.revision = 2;
  data.materials.requirements = 'requirements/rev-002/requirements.md';
  data.requirements.confirmation = {
    ...data.requirements.confirmation,
    revision: 2,
    confirmedAt: '2026-09-06T16:00:00+08:00',
    sourceBundleDigest: nextBundleDigest,
  };
  data.requirements.sources[0].files = [
    {
      ...data.requirements.sources[0].files[0],
      path: nextSourcePath,
      digest: nextSourceDigest,
    },
  ];
  data.requirements.sourceBundleDigest = nextBundleDigest;
  data.confirmation.confirmedAt = '2026-09-06T16:10:00+08:00';
  data.artifactPlan.confirmation.confirmedAt = '2026-09-06T16:10:00+08:00';
  const parsed = parsedForDigest(data, {
    complete: false,
    confirmedAt: data.confirmation.confirmedAt,
    definitionDigest: data.confirmation.definitionDigest,
  });
  const definitionDigest = calculateDefinitionDigest(parsed);
  data.confirmation.definitionDigest = definitionDigest;
  write(root, nextSourcePath, nextSource);
  writeContractBundle(root, data, {
    complete: false,
    confirmedAt: data.confirmation.confirmedAt,
    definitionDigest,
  });
  rmSync(path.join(root, ...SOURCE_PATH.split('/')));
  git(root, ['add', '--all']);

  const inspection = inspect(root);
  assert.ok(
    inspection.issues.some(
      ({ rule }) => rule === 'delivery-contract/historical-snapshot-removed',
    ),
  );
});

test('requires an AI self-test finding to reopen a task that had been marked complete', (context) => {
  const { implementationCommit, root } = fixture(context);
  const finding = `### \`FND-20260906-002\` AI 自测推翻任务完成状态

- 发现者：\`ai\`
- 发现阶段：\`self-test\`
- 发现时间：2026-09-06T16:10:00+08:00
- 问题版本：\`${implementationCommit}\`
- 类型：\`implementation-gap\`
- 严重程度：\`medium\`
- 重复特征：\`sample.self-test-gap\`
- 关联任务：\`TASK-001\`
- 当前状态：\`fixing\`

#### 处理清单

- [x] \`FND-REGISTER-002\` 已登记发现
  - 执行者：\`ai\`
  - 证据：\`EVD-REGISTER-002\`
- [x] \`FND-REPRODUCE-002\` 已复现
  - 执行者：\`ai\`
  - 证据：\`EVD-REPRODUCE-002\`
- [x] \`FND-CLASSIFY-002\` 已分类
  - 执行者：\`ai\`
  - 结论：\`implementation-gap\`
- [ ] \`FND-RED-TEST-002\` 补充失败测试
  - 执行者：\`ai\`
  - 测试：\`TEST-001\`
  - 绑定提交：\`${implementationCommit}\`
  - 证据：\`pending\`
- [ ] \`FND-FIX-002\` 修复问题
  - 执行者：\`ai\`
  - 证据：\`pending\`
- [ ] \`FND-GREEN-TEST-002\` 验证修复
  - 执行者：\`ai\`
  - 测试：\`TEST-001\`
  - 绑定提交：\`pending\`
  - 证据：\`pending\`
- [ ] \`FND-PROMOTION-002\` 完成升级分析
  - 执行者：\`ai\`
  - 测试升级：\`pending\`
  - 合同升级：\`pending\`
  - 设计升级：\`pending\`
  - 任务模板升级：\`pending\`
  - 门禁升级：\`pending\`
  - 结论：\`pending\`
  - 确认人：\`pending\`
  - 确认时间：\`pending\`
- [ ] \`FND-VERIFY-002\` 完成组合验证
  - 执行者：\`ai\`
  - 证据：\`pending\`
`;
  const source = readObligationsSource(root)
    .replace('- [ ] `TASK-001`', '- [x] `TASK-001`')
    .replace('- 证据：`pending`', '- 证据：`EVD-OLD-TASK`');
  write(root, OBLIGATIONS_PATH, source);
  const findingFile = findingDocument({ contractId: CONTRACT_ID }, finding);
  write(root, findingFile.path, findingFile.content);
  git(root, ['add', findingFile.path]);

  const inspection = inspect(root);
  assert.ok(
    inspection.issues.some(({ message }) =>
      message.includes('TASK-001 必须重新打开'),
    ),
  );

  write(
    root,
    findingFile.path,
    findingFile.content.replace('- 关联任务：`TASK-001`\n', ''),
  );
  const missingAssociation = inspect(root);
  assert.ok(
    missingAssociation.issues.some(({ message }) =>
      message.includes('缺少有效的“关联任务”'),
    ),
  );
});

test('requires rejected findings to record registration and a confirmed promotion decision', (context) => {
  const { implementationCommit, root } = fixture(context);
  const finding = `### \`FND-20260906-003\` 无法复现的人工反馈

- 发现者：\`human\`
- 发现阶段：\`human-acceptance\`
- 发现时间：2026-09-06T16:10:00+08:00
- 问题版本：\`${implementationCommit}\`
- 测试环境部署提交：\`${implementationCommit}\`
- 类型：\`invalid-expectation\`
- 严重程度：\`low\`
- 重复特征：\`sample.unreproduced-feedback\`
- 关联任务：\`TASK-001\`
- 当前状态：\`rejected\`
- 关闭原因：无法复现且预期不成立
- 确认人：产品负责人
- 确认时间：2026-09-06T17:00:00+08:00

#### 处理清单

- [x] \`FND-INVESTIGATE-003\` 已完成调查
  - 执行者：\`ai\`
  - 证据：\`EVD-INVESTIGATE-003\`
`;
  const findingFile = findingDocument({ contractId: CONTRACT_ID }, finding);
  write(root, findingFile.path, findingFile.content);
  git(root, ['add', findingFile.path]);

  const inspection = inspect(root);
  assert.ok(
    inspection.issues.some(({ message }) =>
      message.includes('缺少 REGISTER 处理事项'),
    ),
  );
  assert.ok(
    inspection.issues.some(({ message }) =>
      message.includes('缺少 PROMOTION 处理事项'),
    ),
  );
});

test('requires same-feature historical findings to be applied to the new contract', (context) => {
  const { root } = fixture(context);
  const historicalId = 'DC-20260801-001';
  const historicalPath = `docs/delivery/contracts/${historicalId}.md`;
  const registry = featureRegistry();
  registry.features[0].deliveryContracts.push({
    id: historicalId,
    path: historicalPath,
  });
  write(
    root,
    'docs/delivery/feature-registry.json',
    `${JSON.stringify(registry, null, 2)}\n`,
  );
  writeAuxiliaryContractBundle(root, {
    allowedPaths: ['historical/**'],
    contractId: historicalId,
    findingContent: `### \`FND-20260801-001\` 历史权限遗漏

- 重复特征：\`sample.permission-gap\`
`,
  });
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'historical finding']);

  const inspection = inspect(root);
  assert.ok(
    inspection.issues.some(
      ({ rule }) =>
        rule === 'delivery-contract/historical-feedback-not-applied',
    ),
  );
});

test('doctor setup checks the registry, contract schemas, bindings, and managed scripts', (context) => {
  const { root } = fixture(context);
  write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        scripts: {
          'guard:delivery-contract': 'repo-guard delivery-contract',
          'guard:delivery-evidence': 'repo-guard delivery-evidence',
        },
      },
      null,
      2,
    )}\n`,
  );
  git(root, ['add', 'package.json']);
  git(root, ['commit', '-m', 'managed scripts']);
  const config = validateConfig({
    version: 2,
    project: {
      id: 'web',
      role: 'frontend',
      stack: 'node',
      preset: 'vue-javascript',
    },
    repository: { deliveryContract: projectConfig() },
  });
  assert.equal(inspectDeliveryContractSetup({ root, config }).status, 'ready');

  write(root, 'package.json', '{"scripts":{}}\n');
  const invalid = inspectDeliveryContractSetup({ root, config });
  assert.equal(invalid.status, 'incomplete');
  assert.match(invalid.summary, /guard:delivery-contract/);
});

test('Java 与无工程身份的合同诊断不要求 npm 别名且继续检查真实合同', (context) => {
  const { root } = fixture(context);
  const javaConfig = validateConfig({
    version: 2,
    project: { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' },
    repository: { deliveryContract: projectConfig() },
  });
  const repositoryConfig = { ...javaConfig, project: undefined };
  for (const config of [javaConfig, repositoryConfig]) {
    assert.equal(inspectDeliveryContractSetup({ root, config }).status, 'ready');
  }
  write(root, 'package.json', '{"scripts":{}}\n');
  for (const config of [javaConfig, repositoryConfig]) {
    assert.equal(inspectDeliveryContractSetup({ root, config }).status, 'ready');
  }
  write(root, 'docs/delivery/feature-registry.json', '{}\n');
  const invalid = inspectDeliveryContractSetup({ root, config: javaConfig });
  assert.equal(invalid.status, 'incomplete');
  assert.doesNotMatch(invalid.summary, /guard:delivery-contract/);
});

test('requires a new revision and human confirmation when the contract definition changes', (context) => {
  const { baseline, data, definitionDigest, root } = fixture(context);
  data.summary = '在代码提交之后改写合同定义。';
  const changed = parsedForDigest(data, { complete: false, definitionDigest });
  const changedDefinitionDigest = calculateDefinitionDigest(changed);
  data.confirmation.definitionDigest = changedDefinitionDigest;
  commitCompletedEvidence({
    baseline,
    data,
    definitionDigest: changedDefinitionDigest,
    root,
  });

  const inspection = inspect(root);
  assert.ok(
    inspection.issues.some(
      ({ rule }) => rule === 'delivery-contract/revision-not-incremented',
    ),
  );
  assert.ok(
    inspection.issues.some(
      ({ rule }) => rule === 'delivery-contract/reconfirmation-missing',
    ),
  );
});

test('requires separate children and deliveryContracts arrays in the feature tree', () => {
  const invalid = featureRegistry();
  delete invalid.features[0].children;
  const result = inspectFeatureRegistry(
    invalid,
    'docs/delivery/feature-registry.json',
  );
  assert.ok(
    result.issues.some(({ message }) =>
      message.includes('.children 必须是数组'),
    ),
  );
});

test('rejects unsafe feature sources and contract references outside the configured directory', () => {
  const invalid = featureRegistry();
  invalid.features[0].requirementSource = '../requirements.md';
  invalid.features[0].deliveryContracts[0].path = '../contract.md';
  const result = inspectFeatureRegistry(
    invalid,
    'docs/delivery/feature-registry.json',
    { contractsDirectory: 'docs/delivery/contracts' },
  );
  assert.ok(
    result.issues.some(({ message }) =>
      message.includes('HTTPS 地址或仓库内相对路径'),
    ),
  );
  assert.ok(
    result.issues.some(({ message }) =>
      message.includes('安全的仓库内相对路径'),
    ),
  );
});

test('requires screenshot provenance and continuous explicit file sequence', () => {
  const digest = `sha256:${'0'.repeat(64)}`;
  const data = contractData({
    baseline: '0'.repeat(40),
    sourceDigest: digest,
    bundleDigest: digest,
  });
  const source = data.requirements.sources[0];
  source.acquisition = 'screenshot';
  source.files = [
    {
      ...source.files[0],
      path: source.files[0].path.replace('__需求.txt', '__页面__page-001.png'),
      sequence: 1,
    },
    {
      ...source.files[0],
      path: source.files[0].path.replace('__需求.txt', '__页面__page-003.png'),
      sequence: 3,
    },
  ];
  const result = inspectContractSchema(data, {
    contractsDirectory: 'docs/delivery/contracts',
  });
  assert.ok(
    result.issues.some(({ message }) => message.includes('.capturedBy')),
  );
  assert.ok(result.issues.some(({ message }) => message.includes('.coverage')));
  assert.ok(
    result.issues.some(({ message }) =>
      message.includes('sequence 必须从 1 开始'),
    ),
  );
});
