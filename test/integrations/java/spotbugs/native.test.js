import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runJavaSpotbugsGate } from '../../../../src/gates/java/spotbugs-gate.js';

const enabled = process.env.REPO_GUARD_JAVA_SPOTBUGS_NATIVE_TESTS === '1';
const plugin = '<plugin><groupId>com.github.spotbugs</groupId><artifactId>spotbugs-maven-plugin</artifactId><version>4.10.3.0</version></plugin>';
const pom = `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>spotbugs-native</artifactId><version>1.0.0</version><properties><maven.compiler.release>17</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><build><plugins><plugin><artifactId>maven-clean-plugin</artifactId><version>3.2.0</version></plugin><plugin><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin><plugin><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin><plugin><artifactId>maven-help-plugin</artifactId><version>3.5.2</version></plugin>${plugin}</plugins></build><repositories><repository><id>mirror</id><url>https://repo.maven.apache.org/maven2</url></repository></repositories><pluginRepositories><pluginRepository><id>mirror</id><url>https://repo.maven.apache.org/maven2</url></pluginRepository></pluginRepositories></project>`;

test('真实 SpotBugs Maven 4.10.3.0 检测空指针，修复后通过，POM 跳过不能提供通过证据', { skip: !enabled, timeout: 240000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo guard spotbugs native '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, 'src/main/java/example'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pom.xml'), pom);
  const source = path.join(root, 'src/main/java/example/App.java');
  fs.writeFileSync(source, 'package example; public class App { public int value() { Object value = null; return value.hashCode(); } }');
  const config = {
    enabled: true, timeoutMs: 90000, pluginVersion: '4.10.3.0',
    ...(process.env.REPO_GUARD_JAVA_SPOTBUGS_REPOSITORY ? { arguments: [`-Dmaven.repo.local=${process.env.REPO_GUARD_JAVA_SPOTBUGS_REPOSITORY}`] } : {}),
    modules: [{ name: 'app', reports: ['target/spotbugsXml.xml'] }],
  };
  fs.mkdirSync(path.join(root, '.mvn'));
  for (const name of ['maven.config', 'jvm.config']) {
    fs.writeFileSync(path.join(root, '.mvn', name), '-Dspotbugs.omitVisitors=FindNullDeref');
    const hidden = await runJavaSpotbugsGate({ root, config });
    assert.equal(hidden.status, 'configuration-error', JSON.stringify(hidden));
    assert.equal(hidden.error.code, 'java/maven-implicit-options');
    fs.writeFileSync(path.join(root, '.mvn', name), '');
  }
  const failed = await runJavaSpotbugsGate({ root, config });
  assert.equal(failed.status, 'violation', JSON.stringify(failed));
  assert.ok(failed.findings.some((finding) => finding.ruleId === 'java/spotbugs/NP_ALWAYS_NULL'));
  fs.writeFileSync(source, 'package example; public class App { public int value() { return 7; } }');
  const passed = await runJavaSpotbugsGate({ root, config });
  assert.equal(passed.status, 'passed', JSON.stringify(passed));
  assert.equal(passed.metrics.analyzedClasses, 1);
  fs.writeFileSync(path.join(root, 'pom.xml'), pom.replace(plugin, plugin.replace('</plugin>', '<configuration><skip>true</skip></configuration></plugin>')));
  const skipped = await runJavaSpotbugsGate({ root, config });
  assert.equal(skipped.status, 'configuration-error', JSON.stringify(skipped));
});

test('真实 Maven reactor 中两个相互依赖模块分别提供 SpotBugs 证据', { skip: !enabled, timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo guard spotbugs reactor '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, 'pom.xml'), pom.replace('<properties>', '<packaging>pom</packaging><modules><module>api</module><module>worker</module></modules><properties>'));
  for (const name of ['api', 'worker']) {
    fs.mkdirSync(path.join(root, name, 'src/main/java/example'), { recursive: true });
    const dependency = name === 'worker' ? '<dependencies><dependency><groupId>example</groupId><artifactId>api</artifactId><version>1.0.0</version></dependency></dependencies>' : '';
    fs.writeFileSync(path.join(root, name, 'pom.xml'), `<project><modelVersion>4.0.0</modelVersion><parent><groupId>example</groupId><artifactId>spotbugs-native</artifactId><version>1.0.0</version></parent><artifactId>${name}</artifactId>${dependency}</project>`);
  }
  fs.writeFileSync(path.join(root, 'api/src/main/java/example/App.java'), 'package example; public class App { public int value() { return 7; } }');
  fs.writeFileSync(path.join(root, 'worker/src/main/java/example/Worker.java'), 'package example; public class Worker { public int value() { return new App().value(); } }');
  const config = {
    enabled: true, timeoutMs: 150000, pluginVersion: '4.10.3.0',
    ...(process.env.REPO_GUARD_JAVA_SPOTBUGS_REPOSITORY ? { arguments: [`-Dmaven.repo.local=${process.env.REPO_GUARD_JAVA_SPOTBUGS_REPOSITORY}`] } : {}),
    modules: ['api', 'worker'].map((name) => ({ name, directory: name, reports: [`${name}/target/spotbugsXml.xml`] })),
  };
  const result = await runJavaSpotbugsGate({ root, config });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.metrics.modules, 2);
  assert.equal(result.metrics.analyzedClasses, 2);
});
