import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  inspectDeliverySkills,
  managedDeliverySkillNames,
  syncDeliverySkills,
} from '../src/orchestration/setup/delivery-skills.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');

test('installs and removes the complete project-scoped delivery skill bundle', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'delivery-skills-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const installed = syncDeliverySkills(root, true);
  assert.equal(installed.changed, true);
  assert.deepEqual(installed.skills, managedDeliverySkillNames);
  assert.deepEqual(inspectDeliverySkills(root, true).issues, []);
  for (const skillName of managedDeliverySkillNames) {
    assert.match(
      readFileSync(path.join(root, '.agents', 'skills', skillName, 'SKILL.md'), 'utf8'),
      new RegExp(`name: ${skillName}`),
    );
    assert.match(
      readFileSync(
        path.join(root, '.agents', 'skills', skillName, 'agents', 'openai.yaml'),
        'utf8',
      ),
      /allow_implicit_invocation: true/,
    );
  }

  assert.equal(syncDeliverySkills(root, true).changed, false);
  const removed = syncDeliverySkills(root, false);
  assert.equal(removed.changed, true);
  assert.deepEqual(inspectDeliverySkills(root, false).issues, []);
});

test('refuses to overwrite or remove a manually modified managed skill', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'delivery-skills-modified-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  syncDeliverySkills(root, true);
  const skillPath = path.join(
    root,
    '.agents',
    'skills',
    'repo-guard-delivery-contract',
    'SKILL.md',
  );
  writeFileSync(skillPath, `${readFileSync(skillPath, 'utf8')}\n人工扩展。\n`, 'utf8');

  assert.throws(
    () => syncDeliverySkills(root, true),
    (error) => error.code === 'delivery-skills/non-managed-file',
  );
  assert.throws(
    () => syncDeliverySkills(root, false),
    (error) => error.code === 'delivery-skills/modified-file',
  );
  assert.ok(inspectDeliverySkills(root, true).issues.some((message) => (
    message.includes('已变化或过期')
  )));
});

test('leaves same-named user skills untouched when the feature has no managed manifest', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'delivery-skills-user-owned-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const skillPath = path.join(
    root,
    '.agents',
    'skills',
    'repo-guard-delivery-contract',
    'SKILL.md',
  );
  mkdirSync(path.dirname(skillPath), { recursive: true });
  writeFileSync(skillPath, '人工维护的同名 Skill。\n', 'utf8');

  assert.equal(syncDeliverySkills(root, false).changed, false);
  assert.equal(readFileSync(skillPath, 'utf8'), '人工维护的同名 Skill。\n');
});

test('reports and refuses an invalid managed skill manifest in either feature state', (context) => {
  const root = mkdtempSync(path.join(TEST_ROOT, 'delivery-skills-invalid-manifest-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, '.repo-guard', 'managed-skills.json');
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, '{invalid', 'utf8');

  assert.ok(inspectDeliverySkills(root, false).issues.some((message) => (
    message.includes('无法解析')
  )));
  assert.throws(
    () => syncDeliverySkills(root, false),
    (error) => error.code === 'delivery-skills/invalid-manifest',
  );
  assert.throws(
    () => syncDeliverySkills(root, true),
    (error) => error.code === 'delivery-skills/invalid-manifest',
  );

  writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    feature: 'deliveryContract',
    repoGuardVersion: '1.23.0',
    skills: managedDeliverySkillNames,
    files: [{
      path: '.agents/skills/repo-guard-delivery-contract/../../../AGENTS.md',
      digest: `sha256:${'0'.repeat(64)}`,
    }],
  }, null, 2)}\n`, 'utf8');
  assert.throws(
    () => syncDeliverySkills(root, false),
    (error) => error.code === 'delivery-skills/invalid-manifest',
  );
});
