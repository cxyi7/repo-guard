import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { frontendToolOptions } from '../../src/profiles/frontend-tool-presets.js';
import { runEslintFiles } from '../../src/gates/quality/eslint-gate.js';
import { runPrettierFiles } from '../../src/gates/quality/prettier-gate.js';
import { runStylelintFiles } from '../../src/gates/quality/stylelint-gate.js';
import { runTypeCheckGate } from '../../src/gates/quality/typecheck-gate.js';
import { createProjectDocument } from '../../src/config/project-configuration.js';

const project = { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' };
const temporary = path.join(process.cwd(), 'test/.tmp');
mkdirSync(temporary, { recursive: true });
function fixture(t) {
  const root = mkdtempSync(path.join(temporary, 'frontend-options-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  git(root, 'init');
  return root;
}
function write(root, file, value) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
}
function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('前端格式预设可直接运行，原生逐文件覆盖保留未覆盖值', async (t) => {
  const root = fixture(t);
  write(root, 'src/a.js', 'const value = "hello"\n');
  const options = frontendToolOptions('prettier', project);
  await runPrettierFiles({ root, files: ['src/a.js'], fix: true, requireConfig: true, options });
  assert.equal(readFileSync(path.join(root, 'src/a.js'), 'utf8'), "const value = 'hello';\n");
  write(root, '.prettierrc.json', { overrides: [{ files: '**/*.js', options: { semi: false } }] });
  const before = readFileSync(path.join(root, '.prettierrc.json'), 'utf8');
  await runPrettierFiles({ root, files: ['src/a.js'], fix: true, requireConfig: true, options });
  assert.equal(readFileSync(path.join(root, 'src/a.js'), 'utf8'), "const value = 'hello'\n");
  assert.equal(readFileSync(path.join(root, '.prettierrc.json'), 'utf8'), before);
});

test('ESLint 无原生配置也执行预设，用户规则关闭优先', async (t) => {
  const root = fixture(t);
  const descriptor = { ...project, preset: 'vue-javascript' };
  const options = frontendToolOptions('eslint', descriptor);
  write(root, 'src/a.js', 'export const value = console.log("hello");\n');
  const run = () => runEslintFiles({ root, files: ['src/a.js'], fix: false, maxWarnings: 0, descriptor, options });
  assert.equal((await run()).status, 'violation');
  write(root, 'eslint.config.mjs', 'export default [{files:["src/**/*.js"],rules:{"no-console":"off"}}];');
  assert.equal((await run()).status, 'passed');
});

test('类型感知 ESLint 检查 Promise 并保留 Vue script setup 规则', async (t) => {
  const root = fixture(t);
  write(root, 'tsconfig.json', { compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: [] }, include: ['src/**/*'] });
  write(root, 'src/a.ts', 'Promise.resolve(1);\n');
  const result = await runEslintFiles({ root, files: ['src/a.ts'], fix: false, maxWarnings: 0, descriptor: project, options: frontendToolOptions('eslint', project) });
  assert.equal(result.status, 'violation');
  assert.ok(result.findings.some(({ ruleId }) => ruleId.includes('no-floating-promises')));
  write(root, 'src/App.vue', '<script setup lang="ts">\nconst value = 1;\n</script>\n<template><div>{{ value }}</div></template>');
  const vue = await runEslintFiles({ root, files: ['src/App.vue'], fix: false, maxWarnings: 0, descriptor: project, options: frontendToolOptions('eslint', project) });
  assert.equal(vue.status, 'passed', JSON.stringify(vue));
});

test('Stylelint 预设检查类名与属性排序，用户配置覆盖规则', async (t) => {
  const root = fixture(t);
  write(root, 'src/a.css', '.badName {\n  display: block;\n  color: red;\n}\n');
  const options = frontendToolOptions('stylelint', project);
  const run = () => runStylelintFiles({ root, files: ['src/a.css'], fix: false, requireConfig: true, maxWarnings: 0, options });
  const before = await run();
  assert.equal(before.status, 'violation');
  assert.ok(before.findings.some(({ ruleId }) => ruleId.includes('selector-class-pattern')));
  assert.ok(before.findings.some(({ ruleId }) => ruleId.includes('properties-alphabetical-order')));
  write(root, 'stylelint.config.mjs', 'export default {rules:{"selector-class-pattern":null,"order/properties-alphabetical-order":null}};');
  const after = await run();
  assert.equal(after.status, 'passed', JSON.stringify(after));
});

test('类型检查预设合并继承配置并执行所有引用，用户显式类型选项优先', async (t) => {
  const root = fixture(t);
  write(root, 'tsconfig.json', { files: [], references: [{ path: './tsconfig.app.json' }] });
  write(root, 'tsconfig.base.json', { compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: [] } });
  write(root, 'tsconfig.app.json', { extends: './tsconfig.base.json', include: ['src/**/*.ts'] });
  write(root, 'src/a.ts', 'export const number: number = [1][3];\n');
  const options = { ...frontendToolOptions('typeCheck', project), tool: 'tsc' };
  const config = { options, script: 'typecheck', timeoutMs: 30000 };
  assert.equal((await runTypeCheckGate({ root, config })).status, 'violation');
  write(root, 'tsconfig.base.json', { compilerOptions: { strict: true, noUncheckedIndexedAccess: false, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: [] } });
  const original = readFileSync(path.join(root, 'tsconfig.app.json'), 'utf8');
  const result = await runTypeCheckGate({ root, config });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(readFileSync(path.join(root, 'tsconfig.app.json'), 'utf8'), original);
});

test('类型感知暂存检查不读取未暂存的依赖源码，修复只写回选中文件', async (t) => {
  const root = fixture(t);
  git(root, 'init');
  write(root, 'tsconfig.json', { compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: [] }, include: ['src/**/*'] });
  write(root, 'src/dependency.ts', 'export function load(): number { return 1; }\n');
  write(root, 'src/a.ts', 'import {load} from "./dependency";\nload();\n');
  git(root, 'add', '.');
  write(root, 'src/dependency.ts', 'export async function load(): Promise<number> { return 1; }\n');
  const original = readFileSync(path.join(root, 'src/dependency.ts'), 'utf8');
  const result = await runEslintFiles({ root, files: ['src/a.ts'], fix: true, maxWarnings: 0, descriptor: project,
    options: frontendToolOptions('eslint', project), indexSnapshot: true });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(readFileSync(path.join(root, 'src/dependency.ts'), 'utf8'), original);
});

test('Vue 类型检查覆盖只有组件的项目，空项目不能通过', async (t) => {
  const root = fixture(t);
  write(root, 'tsconfig.json', { compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: [] }, include: ['src/**/*.vue'] });
  write(root, 'src/App.vue', '<script setup lang="ts">const value: number = "wrong";</script><template>{{value}}</template>');
  const config = { script: 'typecheck', timeoutMs: 30000, options: frontendToolOptions('typeCheck', project) };
  const failed = await runTypeCheckGate({ root, config });
  assert.equal(failed.status, 'violation', JSON.stringify(failed));
  write(root, 'src/App.vue', '<script setup lang="ts">const value: number = 1;</script><template>{{value}}</template>');
  const passed = await runTypeCheckGate({ root, config });
  assert.equal(passed.status, 'passed', JSON.stringify(passed));
  write(root, 'tsconfig.json', { files: [] });
  await assert.rejects(() => runTypeCheckGate({ root, config }), /源码/);
});

test('Stylelint 用户逐文件覆盖和 SCSS 扩展保留语言语义，修复失败恢复源码', async (t) => {
  const root = fixture(t);
  write(root, 'src/a.scss', '$color: red;\n\n.badName {\n  color: $color;\n  display: block;\n}\n');
  const options = frontendToolOptions('stylelint', project);
  write(root, 'stylelint.config.mjs', 'export default {overrides:[{files:["**/*.scss"],extends:["stylelint-config-standard-scss"],rules:{"selector-class-pattern":null,"declaration-property-value-no-unknown":null}}]};');
  const args = { root, files: ['src/a.scss'], fix: false, maxWarnings: 0, requireConfig: true, options };
  const result = await runStylelintFiles(args);
  assert.equal(result.status, 'passed', JSON.stringify(result));
  write(root, 'src/b.css', '.badName {\n  display: block;\n  color: red;\n}\n');
  const original = readFileSync(path.join(root, 'src/b.css'), 'utf8');
  const failed = await runStylelintFiles({ ...args, files: ['src/b.css'], fix: true });
  assert.equal(failed.status, 'violation');
  assert.equal(readFileSync(path.join(root, 'src/b.css'), 'utf8'), original);
});

test('最终配置 CLI 使用公共退出码，原生覆盖可见且查询不写配置', (t) => {
  const root = fixture(t);
  write(root, 'repo-guard.config.json', createProjectDocument(project));
  write(root, 'src/a.js', 'const a=1;');
  write(root, '.prettierrc.json', { printWidth: 130, semi: false });
  const cli = path.join(process.cwd(), 'bin/repo-guard.js');
  const original = readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8');
  const result = spawnSync(process.execPath, [cli, 'tool-config', '--tool', 'prettier', '--file', 'src/a.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, 2);
  assert.equal(report.configured.printWidth, 100);
  assert.equal(report.effective.printWidth, 130);
  assert.equal(report.effective.semi, false);
  assert.equal(report.effective.singleQuote, true);
  assert.equal(readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'), original);
  const invalid = spawnSync(process.execPath, [cli, 'tool-config', '--tool', 'unknown'], { cwd: root, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
});

test('新建 TypeScript 预设直接执行 vue-tsc，真实类型错误修复后通过', async (t) => {
  const root = fixture(t);
  write(root, 'tsconfig.json', { compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: [] }, include: ['src/**/*.ts'] });
  write(root, 'src/value.ts', 'export const value: number = "错误类型";\n');
  const config = createProjectDocument(project).checks.typeCheck;
  assert.equal(config.enabled, true);
  assert.equal(config.options.tool, 'vue-tsc');
  assert.equal((await runTypeCheckGate({ root, config })).status, 'violation');
  write(root, 'src/value.ts', 'export const value: number = 1;\n');
  const result = await runTypeCheckGate({ root, config });
  assert.equal(result.status, 'passed', JSON.stringify(result));
});
