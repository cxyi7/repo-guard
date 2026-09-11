import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runJavaSourceGate } from '../../../../src/gates/java/source-runner.js';
import { runRegisteredManualGate } from '../../../../src/orchestration/cli/manual-gates.js';
import { createGitProjectFixture, fixtureGit, writeProjectFile } from '../../../helpers/git-project.js';

// 工具只由开发者预先准备；测试和消费项目检查均不会自动下载安装。
const toolsRoot = path.resolve(process.env.REPO_GUARD_JAVA_SOURCE_TOOLS ?? 'test/.tmp/java-source-tools');
const available = existsSync(path.join(toolsRoot, 'classpath.txt')) && existsSync(path.join(toolsRoot, 'google-java-format.jar'));
const toolConfig = (feature, extra = {}) => ({
  enabled: true, command: 'java',
  args: feature === 'javaFormat'
    ? ['-jar', path.join(toolsRoot, 'google-java-format.jar')]
    : ['-cp', readFileSync(path.join(toolsRoot, 'classpath.txt'), 'utf8').trim(),
        ['javaLint', 'javaDuplication'].includes(feature) ? 'net.sourceforge.pmd.cli.PmdCli' : 'com.puppycrawl.tools.checkstyle.Main'],
  ...extra,
});
const good = 'package sample;\n\n/** 示例类型。 */\npublic class Good {\n  /**\n   * 返回输入。\n   *\n   * @param value 输入\n   * @return 输入\n   */\n  public int value(int value) {\n    return value;\n  }\n}\n';
const source = 'src/main/java/sample/Good.java';

test('真实 JDK 工具执行八项 Java 源码检查并识别各组违规', { skip: !available, timeout: 120000 }, async (t) => {
  const root = createGitProjectFixture(t, { [source]: good });
  const run = (feature, extra = {}) => runJavaSourceGate({ root, feature, files: [source], config: toolConfig(feature, extra) });
  for (const feature of ['javaFormat', 'javaNaming', 'javaLayout', 'javaImports', 'javaSize', 'javaDocs', 'javaLint', 'javaDuplication']) {
    const result = await run(feature);
    assert.equal(result.status, 'passed', JSON.stringify({ feature, result }));
  }
  const cases = [
    ['javaFormat', good.replace('public class Good {', 'public class Good{')],
    ['javaNaming', good.replace('int value(int', 'int Bad_Name(int')],
    ['javaLayout', good.replace('package sample;', 'package wrong;')],
    ['javaImports', good.replace('package sample;', 'package sample;\nimport java.util.*;')],
    ['javaSize', good, { maxMethodLines: 1 }],
    ['javaDocs', 'package sample;\npublic class Good { public int value(int value) { return value; } }\n'],
    ['javaLint', good.replace('return value;', 'System.out.println(value); return value;')],
  ];
  for (const [feature, content, extra = {}] of cases) {
    writeProjectFile(root, source, content);
    const result = await run(feature, extra);
    assert.equal(result.status, 'violation', JSON.stringify({ feature, result }));
    assert.ok(result.findings.length > 0);
  }
  writeProjectFile(root, source, good);
  const other = 'src/main/java/sample/Other.java';
  writeProjectFile(root, other, good.replace('class Good', 'class Other'));
  const duplicated = await runJavaSourceGate({ root, feature: 'javaDuplication', files: [source, other], config: toolConfig('javaDuplication', { minimumTokens: 10 }) });
  assert.equal(duplicated.status, 'violation', JSON.stringify(duplicated));
  writeProjectFile(root, source, `// CPD-OFF\n${good}// CPD-ON\n`);
  const suppressed = await runJavaSourceGate({ root, feature: 'javaDuplication', files: [source, other], config: toolConfig('javaDuplication', { minimumTokens: 10 }) });
  assert.equal(suppressed.status, 'configuration-error', JSON.stringify(suppressed));
});

test('真实格式化处理 BOM、行尾空白及末尾换行且只修改选中文件', { skip: !available, timeout: 30000 }, async (t) => {
  const malformed = `\uFEFF${good.replaceAll('\n', '  \r\n').trimEnd()}`;
  const other = 'src/main/java/sample/Other.java';
  const root = createGitProjectFixture(t, { [source]: malformed, [other]: 'package sample;\nclass Other{}' });
  const beforeOther = readFileSync(path.join(root, other));
  const config = toolConfig('javaFormat');
  const before = await runJavaSourceGate({ root, feature: 'javaFormat', files: [source], config });
  assert.equal(before.status, 'violation', JSON.stringify(before));
  const fixed = await runJavaSourceGate({ root, feature: 'javaFormat', files: [source], config, fix: true, environment: 'pre-commit' });
  assert.equal(fixed.status, 'passed', JSON.stringify(fixed));
  assert.equal(readFileSync(path.join(root, source), 'utf8'), good);
  assert.deepEqual(readFileSync(path.join(root, other)), beforeOther);
  assert.equal((await runJavaSourceGate({ root, feature: 'javaFormat', files: [source], config })).status, 'passed');
});

test('真实 Checkstyle 验证包描述符和包路径，不把不支持的模块语法判为通过', { skip: !available, timeout: 30000 }, async (t) => {
  const files = {
    'src/main/java/module-info.java': 'module example {}\n',
    'src/main/java/sample/package-info.java': '/** 示例包。 */\npackage sample;\n',
    [source]: good,
  };
  const root = createGitProjectFixture(t, files);
  const result = await runJavaSourceGate({ root, feature: 'javaLayout', config: toolConfig('javaLayout'), files: Object.keys(files).filter((file) => !file.endsWith('module-info.java')) });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  const moduleResult = await runJavaSourceGate({ root, feature: 'javaLayout', config: toolConfig('javaLayout'), files: ['src/main/java/module-info.java'] });
  assert.equal(moduleResult.status, 'execution-error', JSON.stringify(moduleResult));
  assert.ok(moduleResult.diagnostics.some(({ message }) => message.includes('module-info.java')));
  writeProjectFile(root, source, good.replace('package sample;', 'package incorrect;'));
  const failed = await runJavaSourceGate({ root, feature: 'javaLayout', config: toolConfig('javaLayout'), files: [source] });
  assert.equal(failed.status, 'violation', JSON.stringify(failed));
  assert.ok(failed.findings.some(({ code }) => code === 'PackageDeclaration'));
  writeProjectFile(root, source, `${good}\nclass Other {}\n`);
  const topLevel = await runJavaSourceGate({ root, feature: 'javaLayout', config: toolConfig('javaLayout'), files: [source] });
  assert.equal(topLevel.status, 'violation', JSON.stringify(topLevel));
  assert.ok(topLevel.findings.some(({ code }) => code === 'OneTopLevelClass'));
  writeProjectFile(root, source, 'package sample;\nimport com.sun.net.httpserver.HttpServer;\npublic class Good { HttpServer server; }\n');
  const publicApi = await runJavaSourceGate({ root, feature: 'javaImports', config: toolConfig('javaImports'), files: [source] });
  assert.equal(publicApi.status, 'passed', JSON.stringify(publicApi));
});

test('真实 PMD 拒绝语法错误、源码抑制并识别四项固定规则', { skip: !available, timeout: 60000 }, async (t) => {
  const root = createGitProjectFixture(t, { [source]: good });
  const run = () => runJavaSourceGate({ root, feature: 'javaLint', config: toolConfig('javaLint'), files: [source] });
  const violations = 'package sample;\npublic class Good {\n void value(String s) {\n  if (s != null || s.length() > 0) { System.out.println(s); }\n  try { throw new IllegalArgumentException(); } catch (IllegalArgumentException ignored) {}\n  new Exception().printStackTrace();\n }\n}\n';
  writeProjectFile(root, source, violations);
  const result = await run();
  assert.equal(result.status, 'violation', JSON.stringify(result));
  for (const name of ['BrokenNullCheck', 'SystemPrintln', 'EmptyCatchBlock', 'AvoidPrintStackTrace']) assert.ok(result.findings.some(({ code }) => code === name), name);
  writeProjectFile(root, source, 'package sample; public class Good { invalid !!! }');
  assert.equal((await run()).status, 'execution-error');
  writeProjectFile(root, source, 'package sample; public class Good { void value() { System.out.println(1); } } // NOPMD\n');
  assert.equal((await run()).status, 'execution-error');
});

test('Java 注册的手动命令使用应用文件对象并保留原生结果', { skip: !available, timeout: 30000 }, async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const root = createGitProjectFixture(t, {
    'repo-guard.config.json': JSON.stringify({ version: 2, projects: [{ id: 'api', root: 'apps/api' }], reporting: { notification: { enabled: false } } }),
    'apps/api/repo-guard.config.json': JSON.stringify({ version: 2, project: { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' }, checks: { javaNaming: toolConfig('javaNaming') } }),
    [`apps/api/${source}`]: good.replace('int value(int', 'int Bad_Name(int'),
  });
  const result = await runRegisteredManualGate('java-naming', [], root, { projectId: 'api' });
  assert.equal(result.status, 'violation', JSON.stringify(result));
  assert.equal(result.findings[0].location.path, source);
  assert.equal(fixtureGit(root, ['status', '--porcelain']), '');
});
