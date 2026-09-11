import test from 'node:test';
import assert from 'node:assert/strict';
import { runJavaEngineeringGate } from '../../../src/gates/java/engineering-gates.js';
import { evaluateJavaEngineering } from '../../../src/policies/java/engineering/evaluate.js';
import { createGateResult } from '../../../src/core/result/gate-result.js';

test('多个失败模块的最终问题有独立稳定标识、报告和用例证据及修复步骤', async () => {
  const modules = ['api', 'worker'].map((name) => ({
    name, directory: name, reports: [`${name}/target/TEST-App.xml`],
  }));
  const config = { enabled: true, modules };
  const observed = modules.map((module) => ({ ...module, executed: 1, failed: 1,
    reports: [{ path: module.reports[0], cases: [{ classname: 'example.AppTest', name: 'checksValue', failed: true }] }],
  }));
  const run = (values) => runJavaEngineeringGate({ root: '.', key: 'javaTest', config,
    collect: async () => ({ modules: values, executions: [], startedAt: Date.now() }),
  });
  const result = await run(observed);
  assert.equal(result.status, 'violation');
  assert.equal(result.findings.length, 2);
  assert.equal(new Set(result.findings.map(({ fingerprint }) => fingerprint)).size, 2);
  for (const [index, issue] of result.findings.entries()) {
    assert.equal(issue.ruleId, 'java/test-failed');
    assert.equal(issue.location.path, modules[index].reports[0]);
    assert.ok(issue.evidence.some(({ message }) => message.includes('example.AppTest') && message.includes('checksValue')));
    assert.ok(issue.remediation.steps.length > 0);
    assert.match(issue.expected, /必需测试全部通过/);
  }
  const reversed = await run([...observed].reverse());
  assert.deepEqual(reversed.findings.map(({ id }) => id).reverse(), result.findings.map(({ id }) => id));
});

test('文件归位问题给出命中模式、允许目录和具体修复方式', async () => {
  const result = await runJavaEngineeringGate({ root: '.', key: 'javaFiles',
    config: { enabled: true, forbidden: ['**/*.class'], allowedJavaRoots: ['src/main/java/**'] },
    files: ['target/App.class', 'wrong/App.java'],
  });
  assert.equal(result.status, 'violation');
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings[0].evidence.some(({ message }) => message.includes('**/*.class')));
  assert.match(result.findings[0].remediation.steps.join(' '), /保留需要的本地文件/);
  assert.match(result.findings[1].expected, /src\/main\/java/);
  assert.match(result.findings[1].remediation.steps.join(' '), /移动.*package/);
});

test('同一模块的多个覆盖率维度和缺席架构类不会共用问题标识', () => {
  const check = (key, module, config) => createGateResult({ gateId: key === 'javaCoverage' ? 'java.coverage' : 'java.architecture',
    status: 'violation', summary: '验收问题报告',
    findings: evaluateJavaEngineering(key, { modules: [module], executions: [], startedAt: 1 }, config),
  });
  const base = { name: 'api', directory: '.', reports: ['target/TEST-App.xml'], executed: 1, failed: 0, cases: [] };
  const coverage = check('javaCoverage', { ...base, coverageReport: 'target/jacoco.xml',
    coverage: { sessions: [{ start: 1, dump: 2 }], counters: { line: { covered: 1, missed: 9 }, instruction: { covered: 1, missed: 9 } } },
  }, { thresholds: { line: 80, instruction: 80 } });
  assert.equal(new Set(coverage.findings.map(({ id }) => id)).size, 2);
  const architecture = check('javaArchitecture', { ...base, requiredTestClasses: ['example.A', 'example.B'] }, {});
  assert.equal(new Set(architecture.findings.map(({ id }) => id)).size, 2);
  assert.ok(architecture.findings.every(({ expected }) => expected.includes('至少实际执行')));
});
