import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { syncDeliverySkills } from '../../src/orchestration/setup/delivery-skills.js';

const TEST_ROOT = path.join(process.cwd(), 'test/.tmp');
const CLI_PATH = path.join(process.cwd(), 'bin/repo-guard.js');
const INIT = ['init', '--project', 'web', '--role', 'frontend', '--stack', 'node', '--preset', 'vue-javascript'];
const OLD_AGENT_POLICY = '<!-- repo-guard:eslint-preset:start -->\n历史规范\n<!-- repo-guard:eslint-preset:end -->\n';

function fixture(context, kind, { configured = true } = {}) {
  mkdirSync(TEST_ROOT, { recursive: true });
  const root = mkdtempSync(path.join(TEST_ROOT, 'managed-preflight-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const initialized = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","version":"1.0.0","scripts":{"custom":"node custom.js"}}\n');
  writeFileSync(path.join(root, 'AGENTS.md'), kind === 'agent' ? OLD_AGENT_POLICY : '# 人工规范\n');
  mkdirSync(path.join(root, '.githooks'));
  writeFileSync(path.join(root, '.githooks/pre-commit'), `#!/bin/sh\n# repo-guard-managed:${kind === 'hook' ? 'v4' : 'v5'}\n# 原始 Hook 内容\n`);
  if (configured) writeFileSync(path.join(root, 'repo-guard.config.json'), JSON.stringify({
    version: 2,
    project: { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-javascript' },
    checks: { eslint: { enabled: false } },
    repository: { deliveryContract: { enabled: true } },
  }));
  if (kind === 'skill') {
    syncDeliverySkills(root, true);
    const file = path.join(root, '.repo-guard/managed-skills.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, `${JSON.stringify({ ...manifest, schemaVersion: 1 })}\r\n`);
  }
  return root;
}

function snapshot(root, relative = '') {
  const entries = readdirSync(path.join(root, relative), { withFileTypes: true });
  const fileDigest = (file) => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
  return entries.filter((entry) => entry.name !== '.git').flatMap((entry) => {
    const file = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? snapshot(root, file) : [[file, fileDigest(file)]];
  }).concat(relative === '' ? [['.git/config', fileDigest('.git/config')]] : []);
}

for (const kind of ['skill', 'agent']) {
  test(`旧 ${kind} 格式在全部公共写入口拒绝，配置、规范和 Hook 均保持原样`, (context) => {
    for (const args of [
      ['enable', 'eslint'], ['disable', 'deliveryContract'], INIT,
      ['doctor', '--fix'], ['install-ci', '--provider', 'gitlab'], ['install-hooks'],
    ]) {
      const root = fixture(context, kind);
      const original = snapshot(root);
      const result = spawnSync(process.execPath, [CLI_PATH, ...args], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 1, `${args.join(' ')}\n${result.stdout}${result.stderr}`);
      assert.deepEqual(snapshot(root), original, `${kind}: ${args.join(' ')}`);
    }
  });
}

test('首次初始化先拒绝旧 Skill、AGENTS 或 Hook，不创建主配置', (context) => {
  for (const kind of ['skill', 'agent', 'hook']) {
    const root = fixture(context, kind, { configured: false });
    const original = snapshot(root);
    const result = spawnSync(process.execPath, [CLI_PATH, ...INIT], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.deepEqual(snapshot(root), original, kind);
  }
});
