import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderFileHeader,
  selectFileHeaderFiles,
  synchronizeFileHeaderContent,
} from '../src/policies/file-header.js';

const METADATA = Object.freeze({
  author: 'lxz',
  date: '2023-05-30 19:12:21',
  lastEditor: 'new editor',
  lastEditTime: '2026-08-20 10:20:30',
});

test('只选择 include 内、未被 exclude 排除且扩展名已启用的文件', () => {
  const files = [
    { relative: 'src/app.vue', absolute: 'C:/repo/src/app.vue' },
    { relative: 'src/generated/model.ts', absolute: 'C:/repo/src/generated/model.ts' },
    { relative: 'src/main.ts', absolute: 'C:/repo/src/main.ts' },
    { relative: 'src/readme.md', absolute: 'C:/repo/src/readme.md' },
    { relative: 'test/main.ts', absolute: 'C:/repo/test/main.ts' },
  ];

  assert.deepEqual(selectFileHeaderFiles(files, {
    enabled: true,
    include: ['src/**'],
    exclude: ['src/generated/**'],
    extensions: ['.vue', '.ts'],
  }), ['C:/repo/src/app.vue', 'C:/repo/src/main.ts']);
  assert.deepEqual(selectFileHeaderFiles(files, {
    enabled: false,
    include: ['**/*'],
    exclude: [],
    extensions: ['.ts'],
  }), []);
});

test('为 Vue 和 HTML 渲染 HTML 注释文件头', () => {
  const expected = [
    '<!--',
    ' * @Description: 登录',
    ' * @Author: lxz',
    ' * @Date: 2023-05-30 19:12:21',
    ' * @LastEditor: new editor',
    ' * @LastEditTime: 2026-08-20 10:20:30',
    '-->',
  ].join('\n');

  assert.equal(renderFileHeader('html', METADATA, '登录'), expected);
  assert.equal(
    synchronizeFileHeaderContent('<template />\n', 'src/login.vue', METADATA),
    `${renderFileHeader('html', METADATA)}\n<template />\n`,
  );
});

test('为脚本和样式渲染块注释文件头', () => {
  const expected = [
    '/*',
    ' * @Description: 数组工具类',
    ' * @Author: lxz',
    ' * @Date: 2023-05-30 19:12:21',
    ' * @LastEditor: new editor',
    ' * @LastEditTime: 2026-08-20 10:20:30',
    ' */',
  ].join('\n');

  assert.equal(renderFileHeader('block', METADATA, '数组工具类'), expected);
  for (const filePath of ['src/a.js', 'src/a.tsx', 'src/a.scss']) {
    assert.equal(
      synchronizeFileHeaderContent('export {};\n', filePath, METADATA),
      `${renderFileHeader('block', METADATA)}\nexport {};\n`,
    );
  }
});

test('保留人工 Description 并用 Git 元数据覆盖其余字段', () => {
  const original = [
    '/*',
    ' * @Description: 数组工具类',
    ' * @Author: manual author',
    ' * @Date: 2000-01-01 00:00:00',
    ' * @LastEditors: legacy editor',
    ' * @LastEditTime: 2000-01-02 00:00:00',
    ' */',
    'export const value = [];',
    '',
  ].join('\n');
  const updated = synchronizeFileHeaderContent(original, 'src/array.ts', METADATA);

  assert.equal(updated, `${renderFileHeader('block', METADATA, '数组工具类')}\nexport const value = [];\n`);
  assert.doesNotMatch(updated, /LastEditors/);
  assert.equal(synchronizeFileHeaderContent(updated, 'src/array.ts', METADATA), updated);
});

test('Description 被删除或 Git 字段被乱写后仍整体重建顶部文件头', () => {
  const withoutDescription = [
    '/*',
    ' * @Author: arbitrary author',
    ' * @Date: not a date',
    ' * @LastEditors: arbitrary editor',
    ' * @LastEditTime: tomorrow',
    ' */',
    'export const value = [];',
    '',
  ].join('\n');
  const authorAndDateOnly = [
    '<!--',
    ' * @Author: arbitrary author',
    ' * @Date: arbitrary date',
    '-->',
    '<main />',
    '',
  ].join('\n');

  assert.equal(
    synchronizeFileHeaderContent(withoutDescription, 'src/array.ts', METADATA),
    `${renderFileHeader('block', METADATA)}\nexport const value = [];\n`,
  );
  assert.equal(
    synchronizeFileHeaderContent(authorAndDateOnly, 'src/page.html', METADATA),
    `${renderFileHeader('html', METADATA)}\n<main />\n`,
  );
});

test('不把普通许可证或单个 JSDoc 作者字段误判为受管文件头', () => {
  const license = '/* Copyright 2026 Example */\nexport {};\n';
  const jsdoc = '/**\n * @Author: API owner\n */\nexport {};\n';

  assert.equal(
    synchronizeFileHeaderContent(license, 'src/license.js', METADATA),
    `${renderFileHeader('block', METADATA)}\n${license}`,
  );
  assert.equal(
    synchronizeFileHeaderContent(jsdoc, 'src/api.js', METADATA),
    `${renderFileHeader('block', METADATA)}\n${jsdoc}`,
  );
});

test('保留 BOM、脚本 shebang 和原有换行符', () => {
  const original = '\uFEFF#!/usr/bin/env node\r\nconsole.log("ok");\r\n';
  const updated = synchronizeFileHeaderContent(original, 'bin/cli.js', METADATA);

  assert.equal(
    updated,
    `\uFEFF#!/usr/bin/env node\r\n${renderFileHeader('block', METADATA).replace(/\n/g, '\r\n')}\r\nconsole.log("ok");\r\n`,
  );
});

test('保留样式文件必须位于首行的 charset 声明', () => {
  const original = '@charset "UTF-8";\nbody {}\n';
  assert.equal(
    synchronizeFileHeaderContent(original, 'src/base.css', METADATA),
    `@charset "UTF-8";\n${renderFileHeader('block', METADATA)}\nbody {}\n`,
  );
});

test('拒绝把不安全的 Git 姓名写入注释', () => {
  assert.throws(
    () => renderFileHeader('block', { ...METADATA, author: 'name */ injected' }),
    /包含无法安全写入注释的字符/,
  );
  assert.throws(
    () => renderFileHeader('html', METADATA, 'login --> injected'),
    /Description 包含无法安全写入注释的字符/,
  );
});
