import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runJavaMutationGate } from '../../../../src/gates/java/mutation-gate.js';
import { mutationConfig, mutationFixture } from './fixture.js';
import { writeNativeMutationFixture } from './native-fixture.js';
import { nativeMutationPom } from './native-fixture.js';

test('真实离线 PIT 验证成功、变异阈值失败和基线失败或全部跳过', { skip: process.env.REPO_GUARD_JAVA_NATIVE_PIT !== '1', timeout: 360000 }, async (t) => {
  const root = mutationFixture(t);
  writeNativeMutationFixture(root);
  execFileSync('git', ['add', 'pom.xml', 'src'], { cwd: root });
  const config = mutationConfig({ timeoutMs: 120000, threshold: 0, arguments: [`-Dmaven.repo.local=${process.env.REPO_GUARD_JAVA_MAVEN_REPOSITORY.replaceAll('\\', '/')}`] });
  const passed = await runJavaMutationGate({ root, config });
  assert.equal(passed.status, 'passed', JSON.stringify(passed));
  assert.ok(passed.metrics.mutations > 0);
  assert.ok(passed.metrics.survived > 0);
  const weak = await runJavaMutationGate({ root, config: { ...config, threshold: 100 } });
  assert.equal(weak.status, 'violation', JSON.stringify(weak));
  assert.ok(weak.findings.some((finding) => finding.ruleId === 'java/mutation-threshold'));
  for (const options of [{ broken: true }, { skipped: true }]) {
    writeNativeMutationFixture(root, options);
    const result = await runJavaMutationGate({ root, config });
    assert.equal(result.status, 'violation', JSON.stringify(result));
    assert.ok(result.findings.some((finding) => finding.ruleId.startsWith('java/mutation-baseline-')));
    assert.equal(result.metrics.mutations, 0);
  }
});

test('真实离线 PIT 对两个含同名 Java 类的 Maven 模块分别运行与计分', { skip: process.env.REPO_GUARD_JAVA_NATIVE_PIT !== '1', timeout: 180000 }, async (t) => {
  const root = mutationFixture(t);
  fs.writeFileSync(path.join(root, 'pom.xml'), nativeMutationPom().replace('<artifactId>pit-fixture</artifactId><version>1.0.0</version>', '<artifactId>pit-fixture-parent</artifactId><version>1.0.0</version><packaging>pom</packaging><modules><module>one</module><module>two</module></modules>'));
  for (const name of ['one', 'two']) {
    const directory = path.join(root, name);
    writeNativeMutationFixture(directory);
    fs.writeFileSync(path.join(directory, 'pom.xml'), nativeMutationPom().replace('<artifactId>pit-fixture</artifactId>', `<artifactId>pit-fixture-${name}</artifactId>`));
  }
  execFileSync('git', ['add', 'pom.xml', 'one', 'two'], { cwd: root });
  const common = mutationConfig();
  const config = mutationConfig({ timeoutMs: 150000, threshold: 0, arguments: [`-Dmaven.repo.local=${process.env.REPO_GUARD_JAVA_MAVEN_REPOSITORY.replaceAll('\\', '/')}`], modules: ['one', 'two'].map((name) => ({ ...common.modules[0], name, directory: name, reports: [`${name}/target/surefire-reports/TEST-example.AppTest.xml`], mutationReport: `${name}/target/pit-reports/mutations.xml` })) });
  const result = await runJavaMutationGate({ root, config });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.metrics.modules, 2);
  assert.equal(result.metrics.mutations, 12);
  assert.equal(result.metrics.executedTests, 2);
  assert.equal(result.artifacts.filter((artifact) => artifact.path.endsWith('/mutations.xml')).length, 2);
});

test('真实 Maven profile 中的 PIT 工具属性不能绕过检查范围', { skip: process.env.REPO_GUARD_JAVA_NATIVE_PIT !== '1', timeout: 120000 }, async (t) => {
  const root = mutationFixture(t);
  writeNativeMutationFixture(root);
  fs.writeFileSync(path.join(root, 'pom.xml'), nativeMutationPom().replace('</project>', '<profiles><profile><id>hidden-filter</id><properties><avoidCallsTo>example.App</avoidCallsTo></properties></profile></profiles></project>'));
  execFileSync('git', ['add', 'pom.xml', 'src'], { cwd: root });
  const config = mutationConfig({ timeoutMs: 90000, threshold: 0, arguments: ['-Phidden-filter', `-Dmaven.repo.local=${process.env.REPO_GUARD_JAVA_MAVEN_REPOSITORY.replaceAll('\\', '/')}`] });
  const result = await runJavaMutationGate({ root, config });
  assert.equal(result.status, 'configuration-error', JSON.stringify(result));
  assert.match(result.summary, /properties 包含工具属性 avoidCallsTo/);
  assert.equal(fs.existsSync(path.join(root, 'target/pit-reports/mutations.xml')), false);
});
