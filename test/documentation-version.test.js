import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('keeps package version synchronized across maintained documentation', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const usageGuide = readFileSync(path.join(root, 'docs', 'usage-guide.md'), 'utf8');
  const inventory = readFileSync(
    path.join(root, 'docs', 'project-structure-and-feature-inventory.md'),
    'utf8',
  );

  assert.equal(
    readme.includes(`- 当前版本：\`${manifest.version}\``),
    true,
    'README 当前版本必须与 package.json 一致',
  );
  assert.equal(
    usageGuide.includes(`npm install --save-dev --save-exact ${manifest.name}@${manifest.version}`),
    true,
    '使用说明中的安装命令必须使用 package.json 的精确版本',
  );
  assert.equal(
    inventory.includes(`适用于版本 \`${manifest.version}\``),
    true,
    '长期功能清单适用版本必须与 package.json 一致',
  );
});

test('keeps README focused and moves operational guidance to the usage guide', () => {
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const usageGuide = readFileSync(path.join(root, 'docs', 'usage-guide.md'), 'utf8');

  assert.match(readme, /^## 已完成功能$/m);
  assert.match(readme, /^## 文档结构$/m);
  assert.match(readme, /\[使用说明\]\(docs\/usage-guide\.md\)/);
  assert.doesNotMatch(readme, /^## 快速开始$/m);
  assert.doesNotMatch(readme, /^## 常用使用方式$/m);
  assert.match(usageGuide, /^## 快速开始$/m);
  assert.match(usageGuide, /^## 常用使用方式$/m);
});

test('publishes the MIT license and documents the AI development purpose', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const license = readFileSync(path.join(root, 'LICENSE'), 'utf8');
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');

  assert.equal(manifest.license, 'MIT', 'package.json 必须声明 MIT 许可证');
  assert.equal(manifest.files.includes('LICENSE'), true, 'npm 发布文件清单必须包含 LICENSE');
  assert.match(license, /^MIT License\r?\n/);
  assert.match(license, /Copyright \(c\) 2026 cxyi7/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(readme, /核心目标是为 AI 辅助开发提供强制、可审计的工程规范/);
});
