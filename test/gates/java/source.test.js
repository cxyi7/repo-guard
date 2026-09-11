import assert from 'node:assert/strict';
import { readFileSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runJavaSourceGate } from '../../../src/gates/java/source-runner.js';
import { javaSourceGates } from '../../../src/gates/java/source-gates.js';
import { EXIT_CODES, gateResultToExitCode } from '../../../src/core/result/exit-code.js';
import { createGitProjectFixture, writeProjectFile } from '../../helpers/git-project.js';

const config = { enabled: true, command: 'java', args: ['-jar', 'checkstyle.jar'] };
const version = { status: 0, stdout: 'Checkstyle version: 10.21.4', stderr: '' };
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function fakeCheckstyle({ missingReport = false, malformed = false, status = null, seen = [], batches = [] } = {}) {
  return async ({ argumentsList }) => {
    if (argumentsList.at(-1) === '-V') return version;
    const report = argumentsList[argumentsList.indexOf('-o') + 1];
    const files = argumentsList.slice(argumentsList.indexOf('-o') + 2);
    batches.push(files);
    seen.push(...files.map((file) => readFileSync(file, 'utf8')));
    const violations = files.filter((file) => readFileSync(file, 'utf8').includes('class bad'));
    if (!missingReport) writeFileSync(report, malformed ? '<checkstyle>' : `<checkstyle version="10.21.4">${files.map((file) => `<file name="${escape(file)}">${violations.includes(file) ? '<error line="1" severity="error" message="Type name wrong" source="com.puppycrawl.tools.checkstyle.checks.naming.TypeNameCheck"/>' : ''}</file>`).join('')}</checkstyle>`);
    return { status: status ?? violations.length, stdout: '', stderr: '' };
  };
}

test('八项 Java 门禁独立开关、命令、阶段与格式修复模式', () => {
  assert.equal(new Set(javaSourceGates.map(({ id }) => id)).size, 8);
  assert.equal(javaSourceGates.at(-1).environments.includes('pre-commit'), false);
  const gate = javaSourceGates[0];
  const base = { config: { checks: { javaFormat: config } }, files: [{ relative: 'A.java', absolute: path.resolve('A.java') }] };
  assert.equal(gate.plan({ ...base, environment: 'ci-full', javaFix: true }).fix, false);
  assert.equal(gate.plan({ ...base, environment: 'pre-commit', javaFix: true }).fix, true);
  assert.equal(gate.plan({ ...base, environment: 'manual', argumentsList: ['--fix'] }).fix, true);
  assert.equal(typeof gate.plan(base).files[0], 'string');
});

test('源码工具空输出失败复用公共原始状态诊断且不重复记录', async (t) => {
  const root = createGitProjectFixture(t, { 'A.java': 'class A {}\n' });
  const result = await runJavaSourceGate({ root, feature: 'javaNaming', config }, {
    runProcess: fakeCheckstyle({ status: 9 }),
  });
  assert.equal(result.status, 'execution-error');
  assert.equal(gateResultToExitCode(result), EXIT_CODES.error);
  assert.equal(result.diagnostics.filter(({ message }) => message.includes('原始退出码 9')).length, 1);
});

test('Checkstyle 将大量源码分批检查并验证每批完整报告', async (t) => {
  const files = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`File${index}.java`, `class ${index === 69 ? 'bad' : `File${index}`} {}\n`]));
  const root = createGitProjectFixture(t, files);
  const batches = [];
  const result = await runJavaSourceGate({ root, feature: 'javaNaming', config }, { runProcess: fakeCheckstyle({ batches }) });
  assert.equal(result.status, 'violation', JSON.stringify(result));
  assert.equal(result.metrics.batches, 3);
  assert.ok(batches.every((batch) => batch.length <= 32));
  assert.equal(new Set(batches.flat()).size, 70);
  assert.equal(result.findings[0].location.path, 'File69.java');
  assert.equal(result.metrics.processExitCode, undefined);
  let calls = 0;
  const normal = fakeCheckstyle();
  const incomplete = await runJavaSourceGate({ root, feature: 'javaNaming', config }, { runProcess: async (options) => {
    if (options.argumentsList.at(-1) !== '-V' && ++calls === 2) return { status: 0, stdout: '', stderr: '' };
    return normal(options);
  } });
  assert.equal(incomplete.status, 'execution-error');
  const tooLong = await runJavaSourceGate({ root, feature: 'javaNaming', config: { ...config, args: ['x'.repeat(13000)] } }, { runProcess: fakeCheckstyle() });
  assert.equal(tooLong.status, 'configuration-error');
});

test('CPD 拒绝显式和 Unicode 转义的源码抑制标记', async (t) => {
  const root = createGitProjectFixture(t, { 'A.java': 'class A {}\n' });
  for (const content of ['// CPD-OFF\nclass A {}\n', '@SuppressWarnings("CPD-START") class A {}\n', '// \\u0043PD-OFF\nclass A {}\n']) {
    writeProjectFile(root, 'A.java', content);
    const result = await runJavaSourceGate({ root, feature: 'javaDuplication', config, files: ['A.java'] }, {
      runProcess: async () => ({ status: 0, stdout: 'PMD 7.10.0\n', stderr: '' }),
    });
    assert.equal(result.status, 'configuration-error', JSON.stringify(result));
    assert.equal(result.error.code, 'java/cpd-suppression');
  }
});

test('Java 原生违规与不完整执行映射为不同公共退出码', async (t) => {
  const root = createGitProjectFixture(t, { 'A.java': 'class bad {}\n' });
  const options = { root, feature: 'javaNaming', config, files: ['A.java'] };
  const violation = await runJavaSourceGate(options, { runProcess: fakeCheckstyle() });
  assert.equal(violation.status, 'violation', JSON.stringify(violation));
  assert.equal(gateResultToExitCode(violation), EXIT_CODES.violation);
  assert.equal(violation.findings[0].ruleId, 'java.naming/TypeName');
  assert.ok(violation.diagnostics.some(({ message }) => message.includes('第三方原始诊断')));
  assert.ok(!JSON.stringify(violation.findings[0].evidence).includes('Type name wrong'));
  for (const behavior of [{ missingReport: true }, { malformed: true }, { status: 0 }]) {
    const result = await runJavaSourceGate(options, { runProcess: fakeCheckstyle(behavior) });
    assert.equal(result.status, 'execution-error');
    assert.equal(gateResultToExitCode(result), EXIT_CODES.error);
  }
});

test('Java 无文件与禁用返回跳过，路径和工具错误不可成为通过', async (t) => {
  const root = createGitProjectFixture(t, { 'README.md': '示例\n' });
  const base = { root, feature: 'javaNaming', config };
  assert.equal((await runJavaSourceGate(base)).status, 'skipped');
  assert.equal((await runJavaSourceGate({ ...base, files: ['../Outside.java'] })).status, 'configuration-error');
  writeProjectFile(root, 'A.java', 'class A {}\n');
  assert.equal((await runJavaSourceGate({ ...base, files: ['A.java'], config: { enabled: false } })).status, 'skipped');
  assert.equal((await runJavaSourceGate({ ...base, files: ['A.java'], config: { ...config, command: 'nonexistent-java-source-tool' } })).status, 'execution-error');
  assert.equal((await runJavaSourceGate({ ...base, files: ['A.java'] }, { runProcess: async () => ({ status: 0, stdout: 'done', stderr: '' }) })).status, 'configuration-error');
  writeProjectFile(root, 'Bad.java', Buffer.from([0xff]));
  assert.equal((await runJavaSourceGate({ ...base, files: ['Bad.java'] })).status, 'configuration-error');
  truncateSync(path.join(root, 'Bad.java'), 16 * 1024 * 1024 + 1);
  const oversized = await runJavaSourceGate({ ...base, files: ['Bad.java'] });
  assert.equal(oversized.status, 'execution-error');
  assert.equal(oversized.error.code, 'java/source-too-large');
});

test('Java 超时、信号终止与取消始终是执行错误', async (t) => {
  const root = createGitProjectFixture(t, { 'A.java': 'class A {}\n', 'wait.mjs': 'setInterval(() => {}, 1000);' });
  const options = { root, feature: 'javaNaming', files: ['A.java'], config: { enabled: true, command: process.execPath, args: [path.join(root, 'wait.mjs')], timeoutMs: 80 } };
  assert.equal((await runJavaSourceGate(options)).status, 'execution-error');
  const cancelled = new AbortController();
  cancelled.abort();
  assert.equal((await runJavaSourceGate({ ...options, signal: cancelled.signal })).status, 'execution-error');
  assert.equal((await runJavaSourceGate({ ...options, config }, { runProcess: async () => ({ status: 0, signal: 'SIGTERM', stdout: '', stderr: '' }) })).status, 'execution-error');
});

test('Java 配置变更全量复核读取索引，同时覆盖选中文件修复后的内容', async (t) => {
  const root = createGitProjectFixture(t, { 'A.java': 'class A {}\n', 'B.java': 'class bad {}\n' });
  writeProjectFile(root, 'A.java', 'class badUnstaged {}\n');
  writeProjectFile(root, 'B.java', 'class B {}\n');
  const seen = [];
  const result = await runJavaSourceGate({ root, feature: 'javaNaming', config, files: [path.join(root, 'B.java')], environment: 'pre-commit', configurationChanged: true }, { runProcess: fakeCheckstyle({ seen }) });
  assert.equal(result.status, 'passed');
  assert.deepEqual(seen.sort(), ['class A {}\n', 'class B {}\n']);
  assert.equal(readFileSync(path.join(root, 'A.java'), 'utf8'), 'class badUnstaged {}\n');
  assert.equal((await runJavaSourceGate({ root, feature: 'javaNaming', config, files: [], environment: 'pre-commit' })).status, 'skipped');
});
