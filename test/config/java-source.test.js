import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv from 'ajv';
import { JAVA_SOURCE_DEFAULTS, validateJavaSourceChecks } from '../../src/config/java-source.js';
import { JAVA_SOURCE_SCHEMA_PROPERTIES } from '../../src/config/java-source-schema.js';

test('Java 源码八项配置默认关闭且互不共享可变数组', () => {
  const checks = validateJavaSourceChecks();
  assert.equal(Object.keys(checks).length, 8);
  assert.ok(Object.values(checks).every((value) => value.enabled === false && value.command === null));
  checks.javaNaming.include.push('other/**/*.java');
  assert.deepEqual(checks.javaLayout.include, ['**/*.java']);
  assert.deepEqual(JAVA_SOURCE_DEFAULTS.javaNaming.include, ['**/*.java']);
});

test('Java 配置严格拒绝字段、类型、路径、超时和受控工具参数错误', () => {
  for (const value of [null, [], true, { enabled: 'true' }, { enabled: true }, { command: '' }, { command: 'java\n' },
    { timeoutMs: 0 }, { timeoutMs: 1.5 }, { timeoutMs: Number.MAX_SAFE_INTEGER },
    { include: [] }, { exclude: ['../outside'] }, { include: ['/outside'] }, { include: ['!**/*.java'] },
    { args: ['--no-fail-on-error'] }, { args: ['-c', 'different.xml'] }, { args: ['--rulesets=other.xml'] },
    { args: ['@arguments.txt'] }, { args: ['--replace'] }, { args: ['bad\nvalue'] }, { rule: 'other' },
  ]) assert.throws(() => validateJavaSourceChecks({ javaNaming: value }), { kind: 'configuration' });
  assert.throws(() => validateJavaSourceChecks({ javaFormat: { style: 'other' } }), { kind: 'configuration' });
  assert.throws(() => validateJavaSourceChecks({ javaDocs: { scope: 'other' } }), { kind: 'configuration' });
  assert.throws(() => validateJavaSourceChecks({ javaSize: { maxParameters: -1 } }), { kind: 'configuration' });
  assert.throws(() => validateJavaSourceChecks({ javaDuplication: { minimumTokens: '100' } }), { kind: 'configuration' });
});

test('Java 源码 Schema 片段接受独立设置并拒绝未知字段', () => {
  const validate = new Ajv({ strict: false }).compile({ type: 'object', additionalProperties: false, properties: JAVA_SOURCE_SCHEMA_PROPERTIES });
  const checks = validateJavaSourceChecks({
    javaNaming: { enabled: true, command: 'java', args: ['-jar', 'tools/checkstyle.jar'] },
    javaSize: { maxMethodLines: 30 }, javaDocs: { scope: 'protected' }, javaFormat: { style: 'aosp' },
  });
  assert.equal(validate(checks), true, JSON.stringify(validate.errors));
  assert.equal(validate({ javaNaming: { enabled: true } }), false);
  assert.equal(validate({ javaNaming: { preset: 'custom' } }), false);
});
