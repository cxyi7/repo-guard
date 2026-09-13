import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { executeKnipAnalysis } from '../../src/integrations/knip/execution.js';
import { DEFAULT_DEAD_CODE_CONFIG } from '../../src/config/defaults.js';
import { createProjectDocument } from '../../src/config/project-configuration.js';
import { validateDeadCodeConfiguration } from '../../src/config/dead-code-validation.js';
import { mergeKnipOptions } from '../../src/integrations/knip/configuration.js';
import { filterSpecialDependencyIssues } from '../../src/integrations/knip/special-references.js';

function fixture(t) {
  const root = mkdtempSync(path.resolve('test/.tmp/knip-inline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init'], { cwd: root }).status, 0);
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(
      path.join(root, file),
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  };
  write('package.json', {
    name: 'knip-consumer',
    version: '1.0.0',
    type: 'module',
  });
  symlinkSync(
    path.resolve('node_modules'),
    path.join(root, 'node_modules'),
    'junction',
  );
  write(
    'client/start.js',
    'import { value } from "./values.js"; console.log(value);',
  );
  write('client/values.js', 'export const value = 1; export const unused = 2;');
  const config = {
    ...DEFAULT_DEAD_CODE_CONFIG,
    enabled: true,
    issueTypes: ['files', 'exports', 'types'],
    options: {
      entry: ['client/start.js'],
      project: ['client/**/*.js'],
      includeEntryExports: false,
    },
  };
  return {
    root,
    write,
    config,
    run: () => executeKnipAnalysis({ root, config }),
  };
}

test('前后端新预设开启无效代码检查，前端核心规则保持独立', () => {
  for (const preset of ['vue-javascript', 'vue-typescript']) {
    const document = createProjectDocument({
      id: 'web',
      role: 'frontend',
      stack: 'node',
      preset,
    });
    assert.equal(document.checks.deadCode.enabled, true);
    assert.equal(
      document.checks.deadCode.issueTypes.includes('types'),
      preset.endsWith('-typescript'),
    );
    assert.equal(
      document.checks.deadCode.issueTypes.includes('unresolved'),
      false,
    );
    assert.equal(document.checks.deadCode.options.includeEntryExports, false);
  }
  assert.equal(
    createProjectDocument({
      id: 'api',
      role: 'backend',
      stack: 'node',
      preset: 'node-javascript',
    }).checks.deadCode.enabled,
    true,
  );
});

test('内联配置拒绝非 JSON 及污染属性；原生显式数组与布尔值优先', () => {
  for (const options of [
    null,
    [],
    { entry: undefined },
    JSON.parse('{"__proto__":{}}'),
  ])
    assert.throws(
      () => validateDeadCodeConfiguration({ deadCode: { options } }, '配置'),
      (error) => error.kind === 'configuration',
    );
  const merged = mergeKnipOptions(
    {
      entry: ['a'],
      paths: { '@a/*': ['a/*'], '@b/*': ['b/*'] },
      includeEntryExports: true,
    },
    { entry: ['b'], paths: { '@a/*': ['new/*'] }, includeEntryExports: false },
  );
  assert.deepEqual(merged, {
    entry: ['b'],
    paths: { '@a/*': ['new/*'], '@b/*': ['b/*'] },
    includeEntryExports: false,
  });
});

test('真实 Knip 检出任意目录中的未使用文件和导出，修复后通过', async (t) => {
  const f = fixture(t);
  f.write('client/orphan.js', 'export const orphan = 1;');
  const result = await f.run();
  assert.ok(
    result.issues.some(
      (issue) => issue.type === 'files' && issue.file === 'client/orphan.js',
    ),
    JSON.stringify(result),
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.type === 'exports' && issue.name === 'unused',
    ),
    JSON.stringify(result),
  );
  f.write(
    'client/start.js',
    'import { value, unused } from "./values.js"; import { orphan } from "./orphan.js"; console.log(value, unused, orphan);',
  );
  assert.deepEqual((await f.run()).issues, []);
});

for (const extension of ['json', 'jsonc', 'ts', 'js']) {
  test(`真实 Knip ${extension} 原生配置覆盖内联选项且不改写用户文件`, async (t) => {
    const f = fixture(t);
    f.config.options.entry = ['nonexistent.js'];
    f.config.options.project = ['wrong/**/*.js'];
    const value = {
      entry: ['client/start.js'],
      project: ['client/**/*.js'],
      ignoreExportsUsedInFile: false,
    };
    const name = `knip.${extension}`;
    const text =
      extension === 'json'
        ? JSON.stringify(value)
        : extension === 'jsonc'
          ? '// 用户配置\n' + JSON.stringify(value)
          : 'export default async () => (' + JSON.stringify(value) + ');';
    f.write(name, text);
    assert.ok((await f.run()).issues.some((issue) => issue.name === 'unused'));
    assert.equal(readFileSync(path.join(f.root, name), 'utf8'), text);
  });
}

test('真实 Knip 使用 package.json 配置并拒绝无效原生选项', async (t) => {
  const f = fixture(t);
  f.write('package.json', {
    name: 'knip-consumer',
    type: 'module',
    knip: { entry: ['client/start.js'], project: ['client/**/*.js'] },
  });
  f.config.options.entry = ['wrong.js'];
  assert.ok((await f.run()).issues.some((issue) => issue.name === 'unused'));
  f.write('knip.json', { entry: 42 });
  await assert.rejects(f.run(), /Knip/);
});

test('特殊引用按所属应用跳过，不覆盖同名普通依赖问题', (t) => {
  const f = fixture(t);
  f.write('package.json', {
    dependencies: { local: 'workspace:*', ordinary: '1.0.0' },
  });
  f.write('apps/other/package.json', { dependencies: { local: '2.0.0' } });
  const issues = [
    { type: 'dependencies', name: 'local', file: 'package.json' },
    { type: 'dependencies', name: 'ordinary', file: 'package.json' },
    { type: 'dependencies', name: 'local', file: 'apps/other/package.json' },
  ];
  assert.deepEqual(filterSpecialDependencyIssues(f.root, issues), {
    issues: issues.slice(1),
    skippedSpecialReferences: 1,
  });
});

test('真实 Knip 空入口分析明确阻断，不能把零扫描当成通过', async (t) => {
  const f = fixture(t);
  f.config.options.entry = ['missing/start.js'];
  await assert.rejects(f.run(), /Knip/);
});

test('真实 Knip 忽略特殊依赖结果，同时报告普通未使用依赖', async (t) => {
  const f = fixture(t);
  f.config.issueTypes = ['dependencies'];
  f.write('package.json', {
    name: 'knip-consumer',
    type: 'module',
    dependencies: {
      local: 'file:../external',
      alias: 'npm:is-number@7.0.0',
      workspace: 'workspace:*',
      ordinary: '1.0.0',
    },
  });
  const result = await f.run();
  assert.ok(
    result.issues.some(
      (item) => item.type === 'dependencies' && item.name === 'ordinary',
    ),
    JSON.stringify(result),
  );
  assert.ok(
    result.issues.every(
      (item) => !['local', 'alias', 'workspace'].includes(item.name),
    ),
    JSON.stringify(result),
  );
  assert.ok(result.skippedSpecialReferences > 0);
});

test('真实 Knip 类型导出在非 types 目录检出，引用后消除', async (t) => {
  const f = fixture(t);
  f.config.options = { entry: ['other/boot.ts'], project: ['other/**/*.ts'] };
  f.write(
    'other/types-and-values.ts',
    'export type Used = string; export type Spare = number;',
  );
  f.write(
    'other/boot.ts',
    'import type { Used } from "./types-and-values.js"; const a: Used = "value"; console.log(a);',
  );
  assert.ok(
    (await f.run()).issues.some(
      (item) => item.type === 'types' && item.name === 'Spare',
    ),
  );
  f.write(
    'other/boot.ts',
    'import type { Used, Spare } from "./types-and-values.js"; const a: Used = "value"; const b: Spare = 1; console.log(a,b);',
  );
  assert.deepEqual((await f.run()).issues, []);
});

test('原生动态配置的相对导入与自定义 cjs 路径保持可用', async (t) => {
  const f = fixture(t);
  f.write(
    'settings/paths.cjs',
    'module.exports = { entry: ["client/start.js"], project: ["client/**/*.js"] };',
  );
  f.write(
    'settings/knip.cjs',
    'module.exports = async () => require("./paths.cjs");',
  );
  f.config.configFile = 'settings/knip.cjs';
  f.config.options.entry = ['wrong.js'];
  assert.ok((await f.run()).issues.some((item) => item.name === 'unused'));
});

test('无法解析的普通源码引用不能因看起来像路径而被跳过', (t) => {
  const f = fixture(t);
  const issues = [
    { type: 'unresolved', name: 'client/missing', file: 'client/start.js' },
    { type: 'unresolved', name: './missing', file: 'client/start.js' },
  ];
  assert.deepEqual(
    filterSpecialDependencyIssues(f.root, issues).issues,
    issues,
  );
});

test('真实 Knip 工作区配置与同名依赖按应用隔离', async (t) => {
  const f = fixture(t);
  f.config.issueTypes = ['dependencies'];
  f.config.options = {
    workspaces: {
      '.': { entry: ['client/start.js'], project: ['client/**/*.js'] },
      'modules/*': { entry: ['launch.js'], project: ['*.js'] },
    },
  };
  f.write('package.json', {
    name: 'root-app',
    type: 'module',
    workspaces: ['modules/*'],
    dependencies: { duplicate: 'file:../external' },
  });
  f.write('modules/child/package.json', {
    name: 'child-app',
    type: 'module',
    dependencies: { duplicate: '1.0.0' },
  });
  f.write('modules/child/launch.js', 'console.log("child");');
  const result = await f.run();
  assert.ok(
    result.issues.some(
      (item) =>
        item.name === 'duplicate' && item.file === 'modules/child/package.json',
    ),
    JSON.stringify(result),
  );
  assert.ok(
    !result.issues.some(
      (item) => item.name === 'duplicate' && item.file === 'package.json',
    ),
  );
});

test('原生自定义编译器在内联合并后仍实际执行', async (t) => {
  const f = fixture(t);
  f.write(
    'client/start.js',
    'import { value } from "./custom.extra"; console.log(value);',
  );
  f.write('client/custom.extra', 'CUSTOM_SOURCE');
  f.write(
    'knip.js',
    'export default { entry: ["client/start.js"], project: ["client/**/*.extra", "client/start.js"], compilers: { ".extra": () => "export const value = 1; export const spare = 2;" } };',
  );
  assert.ok((await f.run()).issues.some((item) => item.name === 'spare'));
});

test('显式空数组与损坏内联选项不能产生通过结果', async (t) => {
  const f = fixture(t);
  f.config.options.project = [];
  await assert.rejects(f.run(), /Knip/);
  f.config.options = { entry: 42 };
  await assert.rejects(f.run(), /Knip/);
});

test('原生配置无法结束时按超时终止，不改写用户配置', async (t) => {
  const f = fixture(t);
  const text =
    'export default async () => { await new Promise(() => { setInterval(() => {}, 100); }); return {}; };';
  f.write('knip.js', text);
  f.config.timeoutMs = 1000;
  await assert.rejects(f.run(), (error) => error.code === 'dead-code/timeout');
  assert.equal(readFileSync(path.join(f.root, 'knip.js'), 'utf8'), text);
});

test('入口公开导出是否检查服从用户显式选项', async (t) => {
  const f = fixture(t);
  f.write('client/values.js', 'export const value = 1;');
  f.write(
    'client/start.js',
    'import { value } from "./values.js"; console.log(value); export const publicApi = 1;',
  );
  assert.deepEqual((await f.run()).issues, []);
  f.config.options.includeEntryExports = true;
  assert.ok((await f.run()).issues.some((item) => item.name === 'publicApi'));
});
