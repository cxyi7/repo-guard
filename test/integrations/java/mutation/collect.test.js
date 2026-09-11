import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectJavaMutationFacts } from '../../../../src/integrations/java/mutation/collect.js';
import { effectivePom, fakeMaven, junit, mutationConfig, mutationFixture, pitXml, writeOutput } from './fixture.js';
import { evaluateJavaMutation } from '../../../../src/policies/java/mutation.js';

test('PIT 先验证基线，再按模块运行固定插件并取得新报告', async (t) => {
  const root = mutationFixture(t);
  const calls = [];
  const facts = await collectJavaMutationFacts({ root, config: mutationConfig(), execute: fakeMaven(root, { onCall: (input) => calls.push(input) }) });
  assert.deepEqual(calls.map((input) => input.goals), [['clean', 'test'], ['help:effective-pom'], ['org.pitest:pitest-maven:1.17.3:mutationCoverage']]);
  assert.equal(facts.modules[0].executed, 1);
  assert.equal(facts.modules[0].mutations.length, 1);
  assert.ok(calls[2].additional.includes('-DskipPitest=false'));
  assert.ok(calls[2].additional.includes('-DwithHistory=false'));
  assert.ok(calls[2].additional.includes('--non-recursive'));
  assert.equal(calls[2].root, root);
});
test('基线失败、空测试和全部跳过时停止变异运行', async (t) => {
  for (const options of [{ failed: true }, { skipped: true }, { empty: true }]) {
    const root = mutationFixture(t);
    const calls = [];
    const facts = await collectJavaMutationFacts({ root, config: mutationConfig(), execute: fakeMaven(root, { baseline: junit(options), statuses: { test: options.failed ? 1 : 0 }, onCall: (input) => calls.push(input) }) });
    assert.equal(facts.baselineFailed, true);
    assert.equal(calls.length, 1);
  }
});
test('跳过 PIT 不得借用旧报告；变异产物和有效 POM 不得覆盖跟踪文件', async (t) => {
  const root = mutationFixture(t);
  const config = mutationConfig();
  writeOutput(root, 'target/pit-reports/mutations.xml', pitXml());
  const ordinary = fakeMaven(root);
  await assert.rejects(collectJavaMutationFacts({ root, config, execute: async (input) => input.goals.at(-1).includes(':mutationCoverage') ? { status: 0, stdout: '', stderr: '', goals: input.goals } : ordinary(input) }), /本次执行/);
  for (const file of ['target/pit-reports/mutations.xml', 'target/repo-guard-pit-effective-pom.xml']) {
    writeOutput(root, file, '<old/>');
    execFileSync('git', ['add', file], { cwd: root });
  }
  let calls = 0;
  await assert.rejects(collectJavaMutationFacts({ root, config, execute: async () => { calls++; return { status: 0 }; } }), /已跟踪/);
  assert.equal(calls, 0);
});
test('工具失败、丢失报告和输出符号链接不能通过', async (t) => {
  const root = mutationFixture(t);
  const config = mutationConfig();
  await assert.rejects(collectJavaMutationFacts({ root, config, execute: fakeMaven(root, { statuses: { 'org.pitest:pitest-maven:1.17.3:mutationCoverage': 9 } }) }), (error) => error.kind === 'execution' && error.javaExecutions.length === 3);
  const other = mutationFixture(t);
  fs.mkdirSync(path.join(other, 'elsewhere'));
  fs.symlinkSync(path.join(other, 'elsewhere'), path.join(other, 'target'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(collectJavaMutationFacts({ root: other, config, execute: fakeMaven(other) }), /符号链接/);
});
test('两个模块按各自 POM 和报告运行，同包同名类可独立计分且弱模块不能被平均掩盖', async (t) => {
  const root = mutationFixture(t);
  writeOutput(root, 'pom.xml', '<project><modules><module>one</module><module>two</module></modules></project>');
  const common = mutationConfig();
  const config = mutationConfig({ modules: ['one', 'two'].map((name) => ({ ...common.modules[0], name, directory: name, reports: [`${name}/target/TEST-example.AppTest.xml`], mutationReport: `${name}/target/pit-reports/mutations.xml` })) });
  for (const module of config.modules) writeOutput(root, `${module.directory}/pom.xml`, '<project/>');
  const calls = [];
  const facts = await collectJavaMutationFacts({ root, config, execute: async (input) => {
    calls.push(input);
    const goal = input.goals.at(-1);
    if (goal === 'test') for (const module of config.modules) writeOutput(root, module.reports[0], junit());
    else {
      const module = config.modules.find((entry) => input.config.pom === `${entry.directory}/pom.xml`);
      assert.ok(module);
      assert.ok(input.additional.includes('--non-recursive'));
      if (goal === 'help:effective-pom') writeOutput(root, `${module.directory}/target/repo-guard-pit-effective-pom.xml`, effectivePom());
      else writeOutput(root, module.mutationReport, pitXml(module.name === 'two' ? ['SURVIVED'] : ['KILLED']));
    }
    return { status: 0, stdout: '', stderr: '', goals: input.goals };
  } });
  assert.equal(calls.length, 5);
  assert.equal(facts.modules[0].mutations[0].identity, facts.modules[1].mutations[0].identity);
  const findings = evaluateJavaMutation(facts, config);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /two/);
  assert.equal(findings[0].location.path, 'two/target/pit-reports/mutations.xml');
});
test('PIT 中途取消在工具返回成功后仍为执行错误', async (t) => {
  const root = mutationFixture(t);
  const controller = new AbortController();
  const ordinary = fakeMaven(root);
  await assert.rejects(collectJavaMutationFacts({ root, config: mutationConfig(), signal: controller.signal, execute: async (input) => {
    const result = await ordinary(input);
    controller.abort();
    return result;
  } }), (error) => error.kind === 'execution' && error.javaExecutions.length === 1);
});
