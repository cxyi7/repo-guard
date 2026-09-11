import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectSpotbugsFacts } from '../../../../src/integrations/java/spotbugs/collect.js';
import { spotbugsFixture, spotbugsXml } from './fixture.js';

test('SpotBugs 采集在同一 reactor 编译后分析，并独立核验两个模块证据', async (t) => {
  const fixture = spotbugsFixture(t, ['api', 'worker']);
  const facts = await collectSpotbugsFacts(fixture);
  assert.equal(facts.modules.length, 2);
  assert.deepEqual(fixture.calls[0].goals, ['clean']);
  assert.deepEqual(fixture.calls.at(-1).goals, ['compile', 'com.github.spotbugs:spotbugs-maven-plugin:4.10.3.0:spotbugs']);
  assert.equal(fixture.calls.at(-1).config.pom, 'pom.xml');
  assert.ok(fixture.calls.at(-1).additional.includes('-Dspotbugs.threshold=Low'));
  assert.deepEqual(facts.modules.map((item) => item.report.classes), [['example.App'], ['example.App']]);
});
test('缺少、陈旧、空类、漏类和工具失败均不能伪装 SpotBugs 通过', async (t) => {
  for (const mode of ['missing', 'stale', 'classes', 'zero', 'process', 'timestamp']) {
    const fixture = spotbugsFixture(t);
    await assert.rejects(collectSpotbugsFacts({ ...fixture, execute: async (input) => {
      const result = await fixture.execute(input);
      if (input.goals.includes('compile')) {
        const report = path.join(fixture.root, 'target/spotbugsXml.xml');
        if (mode === 'missing') fs.unlinkSync(report);
        if (mode === 'stale') fs.utimesSync(report, new Date(0), new Date(0));
        if (mode === 'classes') fs.writeFileSync(report, spotbugsXml({ classes: ['example.Other'] }));
        if (mode === 'zero') fs.unlinkSync(path.join(fixture.root, 'target/classes/example/App.class'));
        if (mode === 'timestamp') fs.writeFileSync(report, spotbugsXml({ timestamp: 1 }));
        if (mode === 'process') return { ...result, status: 7 };
      }
      return result;
    } }), (error) => error.kind === 'execution', mode);
  }
});
test('已跟踪报告与有效 POM 文件不允许被清理或覆盖', async (t) => {
  const fixture = spotbugsFixture(t);
  fs.mkdirSync(path.join(fixture.root, 'target'));
  fs.writeFileSync(path.join(fixture.root, 'target/repo-guard-spotbugs-effective-pom.xml'), '原有规则');
  execFileSync('git', ['add', 'target'], { cwd: fixture.root });
  await assert.rejects(collectSpotbugsFacts(fixture), (error) => error.kind === 'configuration');
  assert.equal(fixture.calls.length, 0);
});
test('SpotBugs 多步骤共享总超时，并在取消后停止调度后续进程', async (t) => {
  const fixture = spotbugsFixture(t);
  const controller = new AbortController();
  await assert.rejects(collectSpotbugsFacts({ ...fixture, signal: controller.signal, execute: async (input) => {
    const result = await fixture.execute(input);
    controller.abort();
    return result;
  } }), /取消/);
  assert.equal(fixture.calls.length, 1);
  const timed = spotbugsFixture(t);
  t.mock.method(Date, 'now', (() => { let tick = 0; return () => ++tick * 1000; })());
  await assert.rejects(collectSpotbugsFacts({ ...timed, config: { ...timed.config, timeoutMs: 1 } }), /总超时/);
  assert.equal(timed.calls.length, 0);
});
test('SpotBugs 最后一个原生进程返回成功仍不能掩盖同时发生的取消', async (t) => {
  const fixture = spotbugsFixture(t);
  const controller = new AbortController();
  await assert.rejects(collectSpotbugsFacts({ ...fixture, signal: controller.signal, execute: async (input) => {
    const result = await fixture.execute(input);
    if (input.goals.includes('compile')) controller.abort();
    return result;
  } }), /不能接受执行结果/);
});
