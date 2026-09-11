import test from 'node:test';
import assert from 'node:assert/strict';
import { executionError } from '../../../src/core/error/repo-guard-error.js';
import { javaMutationGate, runJavaMutationGate } from '../../../src/gates/java/mutation-gate.js';
import { collectJavaMutationFacts } from '../../../src/integrations/java/mutation/collect.js';
import { fakeMaven, junit, mutationConfig, mutationFixture, pitXml } from '../../integrations/java/mutation/fixture.js';

test('Java 变异门禁区分成功、测试质量违规和执行故障', async (t) => {
  const root = mutationFixture(t);
  const run = (options, config = mutationConfig()) => runJavaMutationGate({ root, config, collect: (input) => collectJavaMutationFacts({ ...input, execute: fakeMaven(root, options) }) });
  assert.equal((await run({})).status, 'passed');
  const survived = await run({ pit: pitXml(['KILLED', 'SURVIVED']) });
  assert.equal(survived.status, 'violation');
  assert.equal(survived.metrics.survived, 1);
  assert.ok(survived.findings.some((item) => item.ruleId === 'java/mutation-threshold'));
  assert.equal((await run({ pit: pitXml(['NO_COVERAGE']) }, mutationConfig({ threshold: 0 }))).status, 'violation');
  assert.equal((await run({ pit: '<mutations/>' }, mutationConfig({ threshold: 0 }))).status, 'violation');
  assert.equal((await run({ baseline: junit({ failed: true }), statuses: { test: 1 } })).status, 'violation');
  for (const status of ['TIMED_OUT', 'MEMORY_ERROR', 'RUN_ERROR', 'NON_VIABLE', 'NOT_STARTED', 'STARTED', 'EQUIVALENT']) assert.equal((await run({ pit: pitXml([status]) })).status, 'execution-error');
  assert.equal((await run({ statuses: { 'org.pitest:pitest-maven:1.17.3:mutationCoverage': 1 } })).status, 'execution-error');
  assert.equal((await run({ pit: pitXml().replace('<mutatedClass>example.App</mutatedClass>', '<mutatedClass>outside.App</mutatedClass>') })).status, 'execution-error');
});
test('PIT 关闭时不启动工具；取消失败通过公共状态处理；不进入提交前检查', async () => {
  const skipped = await runJavaMutationGate({ root: '.', config: { enabled: false }, collect: async () => { assert.fail('不应执行'); } });
  assert.equal(skipped.status, 'skipped');
  const failed = await runJavaMutationGate({ root: '.', config: mutationConfig(), collect: async () => { throw executionError('java/process-unavailable', 'Java 工具执行超时'); } });
  assert.equal(failed.status, 'execution-error');
  assert.equal(javaMutationGate.environments.includes('pre-commit'), false);
  assert.ok(javaMutationGate.environments.includes('ci-full'));
});
