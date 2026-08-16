import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('keeps package version synchronized across maintained documentation', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
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
    readme.includes(`npm install --save-dev --save-exact ${manifest.name}@${manifest.version}`),
    true,
    'README 安装命令必须使用 package.json 的精确版本',
  );
  assert.equal(
    inventory.includes(`适用于版本 \`${manifest.version}\``),
    true,
    '长期功能清单适用版本必须与 package.json 一致',
  );
});
