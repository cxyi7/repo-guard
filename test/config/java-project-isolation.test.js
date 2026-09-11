import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectDocument, normalizeProjectDocument } from '../../src/config/project-configuration.js';
import { JAVA_PROJECT_CHECKS, NODE_ONLY_PROJECT_CHECKS } from '../../src/config/project-feature-paths.js';
import { gateAppliesToProject, JAVA_GATE_IDS } from '../../src/gates/project-applicability.js';
import { getProjectToolRequirements } from '../../src/profiles/project-profiles.js';

const javaProject = { id: 'java-api', role: 'backend', stack: 'java', preset: 'java-maven' };
const nodeProject = { id: 'node-api', role: 'backend', stack: 'node', preset: 'node-typescript' };
const vueProject = { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' };

test('Java Maven 配置默认关闭所有工程检查，不继承 npm 依赖策略', () => {
  const config = createProjectDocument(javaProject);
  assert.deepEqual(Object.entries(config.checks).filter(([, check]) => check.enabled), []);
  assert.equal(JAVA_PROJECT_CHECKS.length, 18);
  for (const feature of JAVA_PROJECT_CHECKS) assert.equal(config.checks[feature].enabled, false, feature);
  assert.equal(config.repository.dependencyPolicy.enabled, false);
  assert.deepEqual(normalizeProjectDocument(config).checks, config.checks);
  assert.deepEqual(getProjectToolRequirements(javaProject), {
    host: { runtime: 'node', purpose: '运行 repo-guard' },
    project: { runtime: 'jdk', buildTool: 'maven' },
    installation: 'explicit-setup', supported: true,
  });
});

test('Java 与 Node 不可启用另一技术栈检查，关闭项仍接受严格字段校验', () => {
  for (const feature of NODE_ONLY_PROJECT_CHECKS) {
    assert.throws(() => normalizeProjectDocument({
      version: 2, project: javaProject, checks: { [feature]: { enabled: true } },
    }), /不适用于当前项目技术栈/, feature);
  }
  for (const feature of JAVA_PROJECT_CHECKS) {
    for (const project of [nodeProject, vueProject]) assert.throws(() => normalizeProjectDocument({
      version: 2, project, checks: { [feature]: { enabled: true } },
    }), /不适用于当前项目技术栈/, feature);
  }
  assert.throws(() => normalizeProjectDocument({
    version: 2, project: javaProject,
    repository: { dependencyPolicy: { enabled: true } },
  }), /Java 项目请配置 checks.javaDependencies/);
  assert.throws(() => normalizeProjectDocument({
    version: 2, project: javaProject,
    checks: { mutationTest: { enabled: false, guardedBuilds: [{ script: 'build', packageScript: 'guard:build' }] } },
  }), /仅适用于 Node 项目/);
  assert.throws(() => normalizeProjectDocument({
    version: 2, project: javaProject,
    checks: { javaFormat: { enabled: false, unknownOption: true } },
  }));
});

test('Java 保留语言无关的应用规则、公共流程和报告配置', () => {
  const config = normalizeProjectDocument({
    version: 2, project: javaProject,
    checks: {
      maxFileLines: { enabled: true }, filePlacement: { enabled: true },
      pathNaming: { enabled: true, include: ['docs/**'] },
      imageAssets: { enabled: true }, javaFiles: { enabled: true },
    },
    repository: {
      commitMessage: { enabled: true },
      codePlacement: { enabled: true, rules: [{
        name: '固定入口', content: 'class Application',
        scanPatterns: ['**/*.java'], allowedFiles: ['src/main/java/Application.java'],
      }] },
    },
    ci: { enabled: true, profile: 'full' }, reporting: { notification: { enabled: false } },
  });
  assert.equal(config.checks.javaFiles.enabled, true);
  assert.equal(config.repository.commitMessage.enabled, true);
  assert.equal(config.repository.codePlacement.enabled, true);
  assert.deepEqual(config.checks.maxFileLines.rules, [{ pattern: '**/*.java', maxLines: 1000 }]);
  assert.equal(config.ci.profile, 'full');
  assert.equal(config.reporting.notification.enabled, false);
});

test('应用门禁适用性显式隔离 Java、Node、Vue 和公共规则', () => {
  for (const gate of JAVA_GATE_IDS) {
    assert.equal(gateAppliesToProject(gate, javaProject), true, gate);
    assert.equal(gateAppliesToProject(gate, nodeProject), false, gate);
    assert.equal(gateAppliesToProject(gate, vueProject), false, gate);
    assert.equal(gateAppliesToProject(gate, undefined), false, gate);
  }
  for (const gate of ['quality.eslint', 'quality.prettier', 'quality.unit-test', 'quality.build',
    'quality.architecture', 'quality.typecheck', 'dependencies.policy', 'security.dynamic-code']) {
    assert.equal(gateAppliesToProject(gate, javaProject), false, gate);
    assert.equal(gateAppliesToProject(gate, nodeProject), true, gate);
  }
  for (const gate of ['repository.agent-policy', 'repository.protected-files', 'repository.path-naming',
    'repository.maximum-file-lines', 'repository.file-placement', 'repository.image-assets',
    'repository.code-placement', 'repository.commit-message', 'repository.delivery-contract']) {
    assert.equal(gateAppliesToProject(gate, javaProject), true, gate);
  }
  assert.equal(gateAppliesToProject('security.vue-unsafe-html', nodeProject), false);
  assert.equal(gateAppliesToProject('security.vue-unsafe-html', vueProject), true);
});
