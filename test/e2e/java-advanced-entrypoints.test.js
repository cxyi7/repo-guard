import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '../../src/core/result/exit-code.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../helpers/git-project.js';

const cli = fileURLToPath(new URL('../../bin/repo-guard.js', import.meta.url));
const features = [
  { key: 'javaSpotbugs', id: 'java.spotbugs', command: 'java-spotbugs', config: {
    pluginVersion: '4.9.3.0', modules: [{ name: 'api', reports: ['target/spotbugsXml.xml'] }],
  } },
  { key: 'javaMutationTest', id: 'java.mutation-test', command: 'java-mutation-test', config: {
    pluginVersion: '1.17.3', modules: [{ name: 'api', reports: ['target/surefire-reports/TEST-example.SampleTest.xml'],
      mutationReport: 'target/pit-reports/mutations.xml', targetClasses: ['example.*'], targetTests: ['example.*Test'] }],
  } },
];

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
}

function configuration(feature, { enabled, mode = 'inherit' }) {
  return {
    version: 2,
    project: { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' },
    checks: { [feature.key]: { ...feature.config, enabled, executable: 'repo-guard-unavailable-maven-test' } },
    ci: { enabled: true, gatePolicy: { defaultMode: 'off', gates: { [feature.id]: { mode } } } },
    reporting: { notification: { enabled: false } },
  };
}

for (const feature of features) {
  test(`${feature.command} 真实入口区分关闭、缺工具与 CI 只报告，保持统一退出码`, (t) => {
    const root = createGitProjectFixture(t, {
      'repo-guard.config.json': JSON.stringify(configuration(feature, { enabled: false })),
      'pom.xml': '<project/>\n',
      'src/main/java/example/Sample.java': 'package example;\nclass Sample {}\n',
    });
    const disabled = run(root, [feature.command]);
    assert.equal(disabled.status, EXIT_CODES.success, disabled.stderr);
    assert.match(disabled.stdout + disabled.stderr, /关闭|跳过/);
    writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(configuration(feature, { enabled: true })));
    const unavailable = run(root, [feature.command]);
    assert.equal(unavailable.status, EXIT_CODES.error, unavailable.stdout + unavailable.stderr);
    assert.match(unavailable.stdout + unavailable.stderr, /找不到|工具/);

    const base = fixtureGit(root, ['rev-parse', 'HEAD']);
    writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(configuration(feature, { enabled: false, mode: 'report' })));
    fixtureGit(root, ['add', 'repo-guard.config.json']);
    fixtureGit(root, ['commit', '-m', 'test: 验证报告模式']);
    const args = ['ci', '--profile', 'full', '--base', base, '--head', fixtureGit(root, ['rev-parse', 'HEAD'])];
    const reportOnly = run(root, args);
    assert.equal(reportOnly.status, EXIT_CODES.success, reportOnly.stdout + reportOnly.stderr);
    const report = JSON.parse(readFileSync(path.join(root, 'reports/repo-guard.json'), 'utf8'));
    assert.ok(JSON.stringify(report).includes(feature.id));
    assert.ok(JSON.stringify(report).includes('execution-error'));

    writeProjectFile(root, 'repo-guard.config.json', JSON.stringify(configuration(feature, { enabled: false, mode: 'enforce' })));
    const enforced = run(root, args);
    assert.equal(enforced.status, EXIT_CODES.error, enforced.stdout + enforced.stderr);
  });
}
