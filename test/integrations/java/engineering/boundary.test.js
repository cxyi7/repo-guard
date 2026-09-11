import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { inspectMavenBoundary } from '../../../../src/integrations/java/engineering/boundary.js';
import { collectJavaEngineeringFacts } from '../../../../src/integrations/java/engineering/collect.js';
import { validateJavaEngineeringChecks } from '../../../../src/config/java-engineering.js';

function fixture(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-maven-boundary-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const root = path.join(workspace, 'api');
  fs.mkdirSync(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(workspace, 'web'));
  fs.writeFileSync(path.join(workspace, 'web', 'pom.xml'), '<project/>');
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');
  const config = validateJavaEngineeringChecks({ javaBuild: {
    enabled: true, modules: [{ name: 'api', outputs: ['target/api.jar'] }],
  } }).javaBuild;
  return { root, workspace, config };
}

test('Maven 预检遍历本应用多模块与 profile，不读取无关应用', (t) => {
  const { root, workspace, config } = fixture(t);
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project><modules><module>service</module></modules><profiles><profile><modules><module>worker</module></modules></profile></profiles></project>');
  for (const module of ['service', 'worker']) {
    fs.mkdirSync(path.join(root, module));
    fs.writeFileSync(path.join(root, module, 'pom.xml'), '<project/>');
  }
  fs.writeFileSync(path.join(workspace, 'web', 'pom.xml'), '不应被当前应用读取');
  const result = inspectMavenBoundary(root, config);
  assert.deepEqual(result.poms.sort(), ['pom.xml', 'service/pom.xml', 'worker/pom.xml']);
  assert.deepEqual(result.outputDirectories.sort(), ['service/target', 'target', 'worker/target']);
});

test('模块越界或动态路径在启动 Maven 前阻断，原文件保留', async (t) => {
  const { root, workspace, config } = fixture(t);
  const outside = path.join(workspace, 'web', 'pom.xml');
  for (const content of [
    '<project><modules><module>../web</module></modules></project>',
    '<project><profiles><profile><modules><module>../web</module></modules></profile></profiles></project>',
    '<project><modules><module>${selected.module}</module></modules></project>',
  ]) {
    fs.writeFileSync(path.join(root, 'pom.xml'), content);
    let calls = 0;
    await assert.rejects(collectJavaEngineeringFacts({ root, config, key: 'javaBuild', execute: async () => { calls += 1; } }),
      (error) => error.kind === 'configuration');
    assert.equal(calls, 0);
    assert.equal(fs.readFileSync(outside, 'utf8'), '<project/>');
  }
});

test('Maven 模块符号链接不能跨越应用边界', (t) => {
  const { root, workspace, config } = fixture(t);
  fs.symlinkSync(path.join(workspace, 'web'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project><modules><module>linked</module></modules></project>');
  assert.throws(() => inspectMavenBoundary(root, config), /符号链接/);
});

test('Maven 声明式清理和输出目录不得逃逸或清理应用根目录', (t) => {
  const { root, config } = fixture(t);
  for (const build of [
    '<build><directory>../web/target</directory></build>',
    '<build><directory>.</directory></build>',
    '<build><directory>.git</directory></build>',
    '<build><outputDirectory>.git/objects</outputDirectory></build>',
    '<build><directory>.git.</directory></build>',
    '<build><outputDirectory>../web/classes</outputDirectory></build>',
    '<reporting><outputDirectory>../web/reports</outputDirectory></reporting>',
    '<profiles><profile><build><directory>${custom.output}</directory></build></profile></profiles>',
  ]) {
    fs.writeFileSync(path.join(root, 'pom.xml'), `<project>${build}</project>`);
    assert.throws(() => inspectMavenBoundary(root, config), (error) => error.kind === 'configuration');
  }
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project><build><directory>${project.basedir}/artifacts</directory><outputDirectory>${project.build.directory}/classes</outputDirectory></build></project>');
  assert.deepEqual(inspectMavenBoundary(root, config).outputDirectories.sort(), ['artifacts', 'artifacts/classes']);
  const metadataOutput = { ...config, modules: [{ name: 'api', directory: '.', reports: ['.git/report.xml'] }] };
  assert.throws(() => inspectMavenBoundary(root, metadataOutput), /Git 元数据/);
});

test('检查不会覆盖已跟踪报告或清理目录内的已跟踪内容', async (t) => {
  const { root, config } = fixture(t);
  fs.mkdirSync(path.join(root, 'reports'));
  const report = path.join(root, 'reports', 'team.xml');
  fs.writeFileSync(report, '团队保留的报告');
  execFileSync('git', ['add', 'reports/team.xml'], { cwd: root });
  const reportConfig = { ...config, modules: [{ name: 'api', directory: '.', reports: ['reports/team.xml'] }] };
  assert.throws(() => inspectMavenBoundary(root, reportConfig), /Git 已跟踪文件/);
  assert.equal(fs.readFileSync(report, 'utf8'), '团队保留的报告');
  fs.mkdirSync(path.join(root, 'target'));
  const tracked = path.join(root, 'target', 'notes.md');
  fs.writeFileSync(tracked, '团队保留的记录');
  execFileSync('git', ['add', 'target/notes.md'], { cwd: root });
  let calls = 0;
  await assert.rejects(collectJavaEngineeringFacts({ root, config, key: 'javaBuild', execute: async () => { calls += 1; } }), /Git 已跟踪文件/);
  assert.equal(calls, 0);
  assert.equal(fs.readFileSync(tracked, 'utf8'), '团队保留的记录');
});

test('本地父 POM 的输出目录在子模块重新解析，不能遗漏继承后的清理范围', (t) => {
  const { root, config } = fixture(t);
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project><groupId>example</groupId><artifactId>parent</artifactId><version>1</version><modules><module>child</module></modules><build><directory>out</directory></build><profiles><profile><build><directory>${project.basedir}/profile-out</directory></build></profile></profiles></project>');
  fs.mkdirSync(path.join(root, 'child'));
  fs.writeFileSync(path.join(root, 'child', 'pom.xml'), '<project><parent><groupId>example</groupId><artifactId>parent</artifactId><version>1</version></parent><artifactId>child</artifactId></project>');
  const result = inspectMavenBoundary(root, config);
  assert.deepEqual(result.outputDirectories.sort(), ['child/out', 'child/profile-out', 'out', 'profile-out']);
  fs.mkdirSync(path.join(root, 'child', 'out'));
  const retained = path.join(root, 'child', 'out', 'keep.txt');
  fs.writeFileSync(retained, '需要保留');
  execFileSync('git', ['add', 'child/out/keep.txt'], { cwd: root });
  assert.throws(() => inspectMavenBoundary(root, config), /Git 已跟踪文件/);
  assert.equal(fs.readFileSync(retained, 'utf8'), '需要保留');
});
