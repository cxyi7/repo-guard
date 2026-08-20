import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  runDoctor,
} from '../src/orchestration/doctor/runner.js';
import {
  nodeVersionIsSupported,
  REQUIRED_NODE_RANGE,
} from '../src/core/project/node-version.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function createRepository() {
  const root = mkdtempSync(path.join(TEST_ROOT, 'doctor-'));
  git(root, ['init']);
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify({
      version: 1,
      notification: { enabled: false },
      dependencyPolicy: { enabled: false },
      preCommit: {
        eslint: { enabled: false },
        prettier: { enabled: false },
        maxFileLines: { enabled: false },
      },
      rules: [{ pattern: 'src/**', category: 'Source', level: 'notify' }],
    }, null, 2)}\n`,
  );
  return root;
}

test('uses the package Node.js 22.23.2 runtime floor', () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  );
  assert.equal(REQUIRED_NODE_RANGE, packageJson.engines.node);
  assert.equal(REQUIRED_NODE_RANGE, '>=22.23.2');
  assert.equal(nodeVersionIsSupported('22.23.1'), false);
  assert.equal(nodeVersionIsSupported('22.23.2'), true);
  assert.equal(nodeVersionIsSupported('22.24.0'), true);
  assert.equal(nodeVersionIsSupported('23.0.0'), true);
  assert.equal(nodeVersionIsSupported('21.99.99'), false);
  assert.equal(nodeVersionIsSupported('invalid'), false);
});

test('doctor --fix reconciles safe managed repository state', async (context) => {
  const root = createRepository();
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const exitCode = await runDoctor(root, { fix: true });
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const config = JSON.parse(
    readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'),
  );

  assert.equal(exitCode, 0);
  assert.equal(packageJson.scripts['guard:migrate'], 'repo-guard migrate');
  assert.equal(packageJson.scripts['guard:exceptions'], 'repo-guard exceptions');
  assert.equal(packageJson.scripts['guard:dependencies'], 'repo-guard dependencies');
  assert.equal(
    packageJson.scripts['guard:enable-dependencies'],
    'repo-guard enable dependencies',
  );
  assert.equal(packageJson.scripts['guard:unsafe-html'], 'repo-guard unsafe-html');
  assert.equal(packageJson.scripts['guard:dynamic-code'], 'repo-guard dynamic-code');
  assert.equal(
    packageJson.scripts['guard:async-resource-cleanup'],
    'repo-guard async-resource-cleanup',
  );
  assert.equal(packageJson.scripts['guard:target-blank'], 'repo-guard target-blank');
  assert.equal(packageJson.scripts['guard:form-labels'], 'repo-guard form-labels');
  assert.equal(packageJson.scripts['guard:image-alt'], 'repo-guard image-alt');
  assert.equal(
    packageJson.scripts['guard:accessibility-test'],
    'repo-guard accessibility-test',
  );
  assert.equal(
    packageJson.scripts['guard:enable-accessibility-test'],
    'repo-guard enable accessibilityTest',
  );
  assert.equal(
    packageJson.scripts['guard:style-complexity'],
    'repo-guard style-complexity',
  );
  assert.equal(
    packageJson.scripts['guard:enable-style-complexity'],
    'repo-guard enable styleComplexity',
  );
  assert.equal(
    packageJson.scripts['guard:style-governance'],
    'repo-guard style-governance',
  );
  assert.equal(
    packageJson.scripts['guard:enable-style-governance'],
    'repo-guard enable styleGovernance',
  );
  assert.equal(
    packageJson.scripts['guard:enable-quality'],
    'repo-guard enable eslint prettier',
  );
  assert.equal(packageJson.scripts.prepare, 'repo-guard install-hooks');
  assert.equal(packageJson.scripts['guard:lighthouse'], 'repo-guard lighthouse');
  assert.equal(packageJson.scripts['guard:architecture'], 'repo-guard architecture');
  assert.equal(
    packageJson.scripts['guard:enable-architecture'],
    'repo-guard enable architecture',
  );
  assert.equal(packageJson.scripts['guard:build'], 'repo-guard build');
  assert.equal(
    packageJson.scripts['guard:enable-build'],
    'repo-guard enable build',
  );
  assert.equal(packageJson.scripts['guard:typecheck'], 'repo-guard typecheck');
  assert.equal(
    packageJson.scripts['guard:enable-typecheck'],
    'repo-guard enable typeCheck',
  );
  assert.equal(packageJson.scripts['guard:unit-test'], 'repo-guard unit-test');
  assert.equal(
    packageJson.scripts['guard:file-placement'],
    'repo-guard file-placement',
  );
  assert.equal(
    packageJson.scripts['guard:code-placement'],
    'repo-guard code-placement',
  );
  assert.equal(
    packageJson.scripts['guard:enable-unit-test'],
    'repo-guard enable unitTest',
  );
  assert.equal(
    packageJson.scripts['guard:disable-notification'],
    'repo-guard disable notification',
  );
  assert.equal(config.notification.enabled, false);
  assert.deepEqual(config.exceptions.entries, []);
  assert.equal(config.dependencyPolicy.enabled, false);
  assert.equal(config.preCommit.eslint.enabled, false);
  assert.equal(config.preCommit.eslint.preset, true);
  assert.equal(config.preCommit.prettier.enabled, false);
  assert.equal(config.preCommit.stylelint.complexity.enabled, false);
  assert.equal(config.preCommit.stylelint.governance.enabled, false);
  assert.equal(config.preCommit.filePlacement.enabled, true);
  assert.equal(config.lighthouse.enabled, false);
  assert.equal(config.architecture.enabled, false);
  assert.equal(config.build.enabled, false);
  assert.equal(config.typeCheck.enabled, false);
  assert.equal(config.unitTest.enabled, false);
  assert.equal(config.unitTest.componentInteraction.enabled, false);
  assert.equal(config.accessibilityTest.enabled, false);
  assert.match(
    readFileSync(path.join(root, 'AGENTS.md'), 'utf8'),
    /repo-guard:exception-policy:start/,
  );
  assert.match(readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.lighthouseci\//);
  assert.match(
    readFileSync(path.join(root, '.githooks', 'pre-commit'), 'utf8'),
    /repo-guard-managed:v4/,
  );
  assert.match(
    readFileSync(path.join(root, '.githooks', 'pre-push'), 'utf8'),
    /repo_guard_cli" pre-push/,
  );

  const agentsPath = path.join(root, 'AGENTS.md');
  const windowsAgents = readFileSync(agentsPath, 'utf8').replaceAll('\n', '\r\n');
  writeFileSync(agentsPath, windowsAgents);
  rmSync(path.join(root, '.env.config'));
  assert.equal(await runDoctor(root), 0);
  assert.equal(readFileSync(agentsPath, 'utf8'), windowsAgents);
});
