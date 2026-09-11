import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { EXIT_CODES } from '../../src/core/result/exit-code.js';
import { runQualityGate } from '../../src/orchestration/pre-commit/lint-staged-gate.js';
import { createGitProjectFixture, fixtureGit } from '../helpers/git-project.js';
import { stringifyProjectFixture } from '../helpers/project-config.js';

// 仅使用开发者预先准备的真实工具，不在测试或消费项目中自动安装。
const toolsRoot = path.resolve(process.env.REPO_GUARD_JAVA_SOURCE_TOOLS ?? 'test/.tmp/java-source-tools');
const available = existsSync(path.join(toolsRoot, 'classpath.txt')) && existsSync(path.join(toolsRoot, 'google-java-format.jar'));
const source = 'src/main/java/sample/Good.java';
const original = 'package sample;\n\npublic class Good {\n  public int value(int value) {\n    return value;\n  }\n\n  public int second(int value) {\n    return value;\n  }\n\n  public int last(int value) {\n    return value;\n  }\n}\n';

function fixture(t, naming) {
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, () => {});
  const root = createGitProjectFixture(t, {
    'repo-guard.config.json': stringifyProjectFixture({
      version: 2, project: { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' },
      checks: {
        javaFormat: { enabled: true, command: 'java', args: ['-jar', path.join(toolsRoot, 'google-java-format.jar')] },
        javaNaming: { enabled: naming, command: 'java', args: ['-cp', readFileSync(path.join(toolsRoot, 'classpath.txt'), 'utf8').trim(), 'com.puppycrawl.tools.checkstyle.Main'] },
      },
      reporting: { notification: { enabled: false }, commitAnimation: { enabled: false } },
    }),
    [source]: original,
    'src/main/java/sample/Other.java': 'package sample;\nclass Other{}',
  });
  fixtureGit(root, ['config', 'core.autocrlf', 'false']);
  return root;
}

test('真实 Java 格式化经 lint-staged 只写回暂存内容并恢复未暂存修改', { skip: !available, timeout: 60000 }, async (t) => {
  const root = fixture(t, true);
  const file = path.join(root, source);
  const selected = original.replace('return value;', 'return value+1;');
  writeFileSync(file, selected);
  fixtureGit(root, ['add', source]);
  const local = selected.replace('public int last', '// 未暂存的工作\n  public int last');
  writeFileSync(file, local);
  const beforeOther = readFileSync(path.join(root, 'src/main/java/sample/Other.java'));
  assert.equal(await runQualityGate({ cwd: root }), EXIT_CODES.success);
  assert.equal(fixtureGit(root, ['show', `:${source}`]), selected.replace('value+1', 'value + 1').trim());
  assert.equal(readFileSync(file, 'utf8'), local.replace('value+1', 'value + 1'));
  assert.deepEqual(readFileSync(path.join(root, 'src/main/java/sample/Other.java')), beforeOther);
  assert.equal(fixtureGit(root, ['stash', 'list']), '');
});

test('真实 Java 检查失败后 lint-staged 恢复格式修复前的索引和未暂存修改', { skip: !available, timeout: 60000 }, async (t) => {
  const root = fixture(t, true);
  const file = path.join(root, source);
  const selected = original.replace('int value(int', 'int Bad_Name(int').replace('return value;', 'return value+1;');
  writeFileSync(file, selected);
  fixtureGit(root, ['add', source]);
  const local = selected.replace('public int last', '// 失败后也须保留的工作\n  public int last');
  writeFileSync(file, local);
  const beforeStatus = fixtureGit(root, ['status', '--porcelain']);
  assert.equal(await runQualityGate({ cwd: root }), EXIT_CODES.violation);
  assert.equal(fixtureGit(root, ['show', `:${source}`]), selected.trim());
  assert.equal(readFileSync(file, 'utf8'), local);
  assert.equal(fixtureGit(root, ['status', '--porcelain']), beforeStatus);
  assert.equal(fixtureGit(root, ['stash', 'list']), '');
});
