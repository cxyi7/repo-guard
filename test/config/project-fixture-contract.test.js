import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProjectDocument } from '../../src/config/project-configuration.js';
import {
  parseProjectFixture,
  projectFixtureDocument,
  stringifyProjectFixture,
} from '../helpers/project-config.js';

const PROJECT = {
  id: 'api',
  role: 'backend',
  stack: 'node',
  preset: 'node-typescript',
};

test('常规夹具直接接受 v2，拒绝把旧配置藏在测试序列化适配中', () => {
  assert.throws(
    () => projectFixtureDocument({ version: 1, rules: [] }),
    /必须直接提供 version: 2/,
  );
  const document = {
    version: 2,
    project: PROJECT,
    checks: { coverage: { enabled: true }, unitTest: { enabled: true } },
  };
  const before = structuredClone(document);
  const parsed = parseProjectFixture(stringifyProjectFixture(document));
  assert.deepEqual(document, before);
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.project, PROJECT);
  assert.equal(parsed.checks.coverage.enabled, true);
  assert.equal(parsed.checks.unitTest.enabled, true);
  assert.equal(Object.hasOwn(parsed.checks.unitTest, 'coverage'), false);
  assert.equal(Object.hasOwn(parsed, 'preCommit'), false);
  assert.equal(Object.hasOwn(parsed, 'configVersion'), false);
});

test('运行时匹配器只在写入时剥离，读回保持实际磁盘字段', () => {
  const normalized = normalizeProjectDocument({
    version: 2,
    project: PROJECT,
    repository: {
      rules: [{ pattern: 'src/**', category: '源码', level: 'audit' }],
      exclusions: ['src/generated/**'],
    },
  });
  assert.equal(normalized.repository.rules[0].matcher instanceof RegExp, true);
  const parsed = parseProjectFixture(stringifyProjectFixture(normalized));
  assert.deepEqual(parsed.repository.rules, [
    { pattern: 'src/**', category: '源码', level: 'audit' },
  ]);
  assert.deepEqual(parsed.repository.exclusions, ['src/generated/**']);
  assert.equal(normalized.repository.rules[0].matcher instanceof RegExp, true);
  assert.deepEqual(
    parseProjectFixture('{"version":2,"project":{"id":"raw"}}'),
    { version: 2, project: { id: 'raw' } },
  );
});
