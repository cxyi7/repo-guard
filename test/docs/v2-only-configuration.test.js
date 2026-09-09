import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('维护文档不再推荐已删除的配置转换入口', () => {
  const documents = [
    'README.md',
    'docs/usage-guide.md',
    'docs/project-structure-and-feature-inventory.md',
    'docs/refactor-2.0-remaining-work.md',
    ...readdirSync(path.join(root, 'docs/features'))
      .filter((file) => file.endsWith('.md'))
      .map((file) => `docs/features/${file}`),
  ];
  for (const file of documents) {
    assert.doesNotMatch(
      read(file),
      /repo-guard migrate|guard:migrate|configuration-migration\.md|config\/migration\/|v2-runtime-migration\.test\.js/,
      file,
    );
  }
  assert.equal(existsSync(path.join(root, 'docs/features/configuration-migration.md')), false);
  assert.match(read('docs/features/configuration-management.md'), /config\/unsupported-version/);
  assert.match(read('docs/features/README.md'), /configuration-management\.md/);
});

test('项目 Schema 与架构图只说明原生 v2，不保留转换边界', () => {
  const schema = JSON.parse(read('config.schema.json'));
  for (const name of ['singleProjectDocument', 'workspaceDocument']) {
    const version = schema.$defs[name].properties.version;
    assert.equal(version.const, 2);
    assert.match(version.description, /旧版本直接拒绝/);
    assert.doesNotMatch(version.description, /需要显式迁移/);
  }
  for (const extension of ['svg', 'html']) {
    const diagram = read(`docs/images/repo-guard-v2-architecture.${extension}`);
    assert.match(diagram, /旧配置直接拒绝，不再转换/);
    assert.match(diagram, /仅更新当前托管内容；冲突拒绝覆盖/);
    assert.doesNotMatch(diagram, /migrate|识别旧托管版本/);
  }
});
