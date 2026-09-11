import test from 'node:test';
import assert from 'node:assert/strict';
import { runJavaSpotbugsGate, javaSpotbugsGate } from '../../../src/gates/java/spotbugs-gate.js';
import { executionError } from '../../../src/core/error/repo-guard-error.js';
import { gateResultToExitCode, EXIT_CODES } from '../../../src/core/result/exit-code.js';

const config = { enabled: true, pluginVersion: '4.10.3.0', modules: [{ name: 'api', reports: ['target/spotbugsXml.xml'] }] };
function facts() {
  return { executions: [], modules: [{ name: 'api', sourceDirectory: 'src/main/java', reports: ['target/spotbugsXml.xml'], effectivePom: 'target/effective.xml', report: {
    classes: ['example.App'], bugs: [{ type: 'NP_ALWAYS_NULL', priority: 1, rawMessage: 'Null pointer', location: { path: 'example/App.java', line: 3 } }, { type: 'DM_DEFAULT_ENCODING', priority: 3 }],
  } }] };
}
test('SpotBugs 门禁根据置信优先级和显式规则豁免判定，原始说明独立呈现', async () => {
  const result = await runJavaSpotbugsGate({ root: '.', config, collect: async () => facts() });
  assert.equal(result.status, 'violation');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].location.path, 'src/main/java/example/App.java');
  assert.ok(result.diagnostics.some((item) => item.source === '第三方 SpotBugs 原生缺陷说明'));
  const allowed = await runJavaSpotbugsGate({ root: '.', config: { ...config, excludeBugPatterns: ['NP_ALWAYS_NULL'] }, collect: async () => facts() });
  assert.equal(allowed.status, 'passed');
  const low = await runJavaSpotbugsGate({ root: '.', config: { ...config, priority: 'low' }, collect: async () => facts() });
  assert.equal(low.findings.length, 2);
  assert.ok(!javaSpotbugsGate.environments.includes('pre-commit'));
});
test('SpotBugs 配置、启动错误和关闭状态复用统一结果语义', async () => {
  const invalid = await runJavaSpotbugsGate({ root: '.', config: { enabled: true } });
  assert.equal(invalid.status, 'configuration-error');
  const failed = await runJavaSpotbugsGate({ root: '.', config, collect: async () => { throw executionError('java/process-unavailable', '工具无法运行'); } });
  assert.equal(failed.status, 'execution-error');
  assert.equal(gateResultToExitCode(failed), EXIT_CODES.error);
  const disabled = await runJavaSpotbugsGate({ root: '.', config: { enabled: false } });
  assert.equal(disabled.status, 'skipped');
});
