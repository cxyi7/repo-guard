import test from 'node:test';
import assert from 'node:assert/strict';
import { runJavaMutationGate } from '../../../src/gates/java/mutation-gate.js';
import { runJavaSpotbugsGate } from '../../../src/gates/java/spotbugs-gate.js';
import { collectJavaMutationFacts } from '../../../src/integrations/java/mutation/collect.js';
import { collectSpotbugsFacts } from '../../../src/integrations/java/spotbugs/collect.js';
import { gateResultToExitCode, EXIT_CODES } from '../../../src/core/result/exit-code.js';
import { fakeMaven, mutationConfig, mutationFixture } from '../../integrations/java/mutation/fixture.js';

test('PIT 与 SpotBugs 的最终结果保留空输出失败原始码，对外仍使用公共错误码', async (t) => {
  const root = mutationFixture(t);
  const pit = await runJavaMutationGate({ root, config: mutationConfig(), collect: (input) => collectJavaMutationFacts({
    ...input, execute: fakeMaven(root, { statuses: { 'org.pitest:pitest-maven:1.17.3:mutationCoverage': 9 } }),
  }) });
  const spotbugs = await runJavaSpotbugsGate({
    root, config: { enabled: true, pluginVersion: '4.10.3.0', modules: [{ name: 'api', reports: ['target/spotbugsXml.xml'] }] },
    collect: (input) => collectSpotbugsFacts({ ...input,
      execute: async ({ goals }) => ({ status: 7, stdout: '', stderr: '', goals }),
    }),
  });
  for (const [result, rawCode] of [[pit, 9], [spotbugs, 7]]) {
    assert.equal(result.status, 'execution-error');
    assert.equal(gateResultToExitCode(result), EXIT_CODES.error);
    assert.ok(result.diagnostics.some(({ message }) => message.includes(`原始退出码 ${rawCode}`)));
  }
});
