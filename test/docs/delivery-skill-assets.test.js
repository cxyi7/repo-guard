import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { inspectFeatureRegistry } from '../../src/policies/delivery-contract/feature-registry.js';
import {
  parseDeliveryContractMarkdown,
  parseMarkdownFrontmatter,
} from '../../src/policies/delivery-contract/markdown.js';

const SKILLS_ROOT = path.join(process.cwd(), 'skills');

function asset(...segments) {
  return readFileSync(path.join(SKILLS_ROOT, ...segments), 'utf8');
}

function frontmatter(...segments) {
  const parsed = parseMarkdownFrontmatter(asset(...segments));
  assert.deepEqual(parsed.errors, []);
  return parsed.data;
}

test('交付 Skill 资产不包含可能被误当成真实值的零哈希或虚构日期', () => {
  const assets = [
    asset('repo-guard-feature-registry', 'assets', 'feature-registry.json'),
    asset('repo-guard-feature-registry', 'assets', 'feature-node.json'),
    asset('repo-guard-delivery-contract', 'assets', 'contract-bundle', 'contract.md'),
    asset('repo-guard-delivery-contract', 'assets', 'contract-bundle', 'requirements.md'),
    asset('repo-guard-delivery-contract', 'assets', 'contract-bundle', 'traceability.md'),
    asset('repo-guard-delivery-contract', 'assets', 'contract-bundle', 'obligations.md'),
    asset('repo-guard-delivery-feedback', 'assets', 'finding.md'),
    asset('repo-guard-delivery-evidence', 'assets', 'evidence-run.md'),
    asset('repo-guard-delivery-evidence', 'assets', 'delivery-evidence.yaml'),
  ];
  const combined = assets.join('\n');

  assert.doesNotMatch(combined, /\b0{40}\b/);
  assert.doesNotMatch(combined, /sha256:0{64}/);
  assert.doesNotMatch(combined, /2000-01-01/);
  assert.doesNotMatch(combined, /YYYYMMDD/);
  assert.doesNotMatch(combined, /需要人工确认具体理由/);
});

test('功能登记资产提供空根结构和默认不可冒充确认的节点', () => {
  const registry = JSON.parse(asset(
    'repo-guard-feature-registry',
    'assets',
    'feature-registry.json',
  ));
  const node = JSON.parse(asset(
    'repo-guard-feature-registry',
    'assets',
    'feature-node.json',
  ));

  assert.deepEqual(registry, { schemaVersion: 2, features: [] });
  assert.deepEqual(inspectFeatureRegistry(registry, 'features.json').issues, []);
  assert.equal(node.status, 'proposed');
  assert.equal(node.confirmedAt, null);
  assert.equal(node.confirmedBy, null);
  assert.equal(node.requirementSource, null);
  assert.equal(node.uiSource, null);
  assert.deepEqual(node.children, []);
  assert.deepEqual(node.deliveryContracts, []);
  assert.match(node.id, /^<REQUIRED_/);
});

test('合同包资产把需求事实追踪到真实任务和验证事项', () => {
  const contractId = 'DC-20260906-001';
  const replaceContractId = (source) => source.replaceAll('<REQUIRED_CONTRACT_ID>', contractId);
  const contract = parseDeliveryContractMarkdown(replaceContractId(asset(
    'repo-guard-delivery-contract',
    'assets',
    'contract-bundle',
    'contract.md',
  )));
  const requirements = parseMarkdownFrontmatter(replaceContractId(asset(
    'repo-guard-delivery-contract',
    'assets',
    'contract-bundle',
    'requirements.md',
  )));
  const traceability = parseMarkdownFrontmatter(replaceContractId(asset(
    'repo-guard-delivery-contract',
    'assets',
    'contract-bundle',
    'traceability.md',
  )));
  const obligations = parseDeliveryContractMarkdown(replaceContractId(asset(
    'repo-guard-delivery-contract',
    'assets',
    'contract-bundle',
    'obligations.md',
  )));

  assert.deepEqual(contract.errors, []);
  assert.deepEqual(requirements.errors, []);
  assert.deepEqual(traceability.errors, []);
  assert.deepEqual(obligations.errors, []);
  assert.equal(requirements.data.facts[0].id, 'REQ-001');
  assert.ok(requirements.data.blockingQuestions.length > 0);
  assert.ok(Object.values(contract.data.artifactPlan.items).every(({ mode }) => mode === 'pending'));

  const obligationIds = new Set(obligations.obligations.map(({ id }) => id));
  const entry = traceability.data.entries.find(({ factId }) => factId === 'REQ-001');
  assert.ok(entry);
  assert.ok(entry.tasks.every((id) => obligationIds.has(id)));
  assert.ok(entry.verification.every((id) => obligationIds.has(id)));
});

test('发现资产替换 findingId 后生成合同内全局唯一的处理清单 id', () => {
  const source = asset('repo-guard-delivery-feedback', 'assets', 'finding.md');
  const parseFinding = (findingId) => parseDeliveryContractMarkdown(
    source
      .replaceAll('<REQUIRED_CONTRACT_ID>', 'DC-20260906-001')
      .replaceAll('<REQUIRED_FINDING_ID>', findingId),
  );
  const first = parseFinding('FND-20260906-001');
  const second = parseFinding('FND-20260906-002');

  assert.deepEqual(first.errors, []);
  assert.deepEqual(second.errors, []);
  assert.equal(first.findings.length, 1);
  assert.equal(second.findings.length, 1);
  const allIds = [first, second].flatMap(({ findings }) => [
    findings[0].id,
    ...findings[0].checklist.map(({ id }) => id),
  ]);
  assert.equal(new Set(allIds).size, allIds.length);
});

test('反馈参考覆盖测试环境复测和拒绝延期闭环的专用字段', () => {
  const workflow = asset(
    'repo-guard-delivery-feedback',
    'references',
    'feedback-workflow.md',
  );

  assert.match(workflow, /测试环境部署提交/);
  assert.match(workflow, /HUMAN-RETEST/);
  assert.match(workflow, /INVESTIGATE/);
  assert.match(workflow, /关闭原因/);
  assert.match(workflow, /重新评估条件/);
});

test('证据资产提供完整 GateResult、执行日志和三类关联证据', () => {
  const evidenceRun = frontmatter(
    'repo-guard-delivery-evidence',
    'assets',
    'evidence-run.md',
  );
  const deliveryEvidence = parse(asset(
    'repo-guard-delivery-evidence',
    'assets',
    'delivery-evidence.yaml',
  )).deliveryEvidence;

  assert.ok(evidenceRun.gateResults.length > 0);
  assert.ok(evidenceRun.executionLog.length > 0);
  assert.ok(evidenceRun.evidence.length > 0);
  assert.deepEqual(
    Object.keys(evidenceRun.gateResults[0].result).sort(),
    ['artifacts', 'diagnostics', 'error', 'findings', 'gateId', 'metrics', 'status', 'summary'],
  );
  assert.deepEqual(
    new Set(evidenceRun.evidence.map(({ type }) => type)),
    new Set(['commit', 'execution', 'gate-result']),
  );
  assert.deepEqual(
    Object.keys(deliveryEvidence).sort(),
    [
      'definitionDigest',
      'evidenceRunDigest',
      'evidenceRunPath',
      'executionDigest',
      'integrationBaseCommit',
      'sourceBundleDigest',
      'subjectCommit',
      'technicalEvidenceDigest',
    ],
  );
  assert.ok(Object.values(deliveryEvidence).some((value) => value === 'pending'));
});
