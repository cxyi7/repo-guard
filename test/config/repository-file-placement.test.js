import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { DEFAULT_REPOSITORY_FILE_PLACEMENT_CONFIG, REPOSITORY_FILE_PLACEMENT_SCHEMA, validateRepositoryFilePlacementConfiguration } from '../../src/config/repository-file-placement.js';
import { normalizeProjectDocument } from '../../src/config/project-configuration.js';
import { loadWorkspace } from '../../src/config/workspace-configuration.js';
import { applicationDocument } from '../../src/config/workspace-scopes.js';
import { validateFilePlacementConfiguration } from '../../src/config/file-placement-validation.js';
import { CONFIGURABLE_FEATURES, setFeaturesEnabled } from '../../src/orchestration/setup/config-management.js';

const frontend = { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' };
const backend = { id: 'api', role: 'backend', stack: 'java', preset: 'java-maven' };
const rule = { name: '说明文档', patterns: ['**/*.md'], allowedPatterns: ['docs/**'], exceptions: ['README.md'], suggestedDirectory: 'docs' };
const filePlacement = { enabled: true, rules: [rule] };
const configSchema = JSON.parse(fs.readFileSync('config.schema.json', 'utf8'));
const projectSchema = JSON.parse(fs.readFileSync('project.schema.json', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat('date', { type: 'string', validate: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) });
ajv.addSchema(configSchema, 'config.schema.json');
const validateRootSchema = ajv.getSchema('config.schema.json');
const validateApplicationSchema = ajv.compile(projectSchema);
const validateFragment = ajv.compile(REPOSITORY_FILE_PLACEMENT_SCHEMA);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-repository-placement-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(root, document, file = 'repo-guard.config.json') {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(document, null, 2)}\n`);
}
function writeWorkspace(root, placement = filePlacement) {
  for (const project of [frontend, backend]) write(root, { version: 2, project, checks: { filePlacement: { enabled: false } } }, `${project.id}/repo-guard.config.json`);
  write(root, { version: 2, projects: [{ id: 'web', root: 'web' }, { id: 'api', root: 'api' }], repository: { filePlacement: placement } });
}

test('仓库文件归位默认关闭，规则复用归一化且保持声明顺序', () => {
  assert.deepEqual(validateRepositoryFilePlacementConfiguration({}), DEFAULT_REPOSITORY_FILE_PLACEMENT_CONFIG);
  const rules = [{ ...rule, name: '  说明文档  ', patterns: [' **/*.md '], allowedPatterns: [' docs/** '], suggestedDirectory: ' docs/ ' }, { ...rule, name: '其他文档', patterns: ['**/*.txt'] }];
  const normalized = validateRepositoryFilePlacementConfiguration({ filePlacement: { enabled: true, rules } });
  assert.deepEqual(normalized.rules.map((entry) => entry.name), ['说明文档', '其他文档']);
  assert.equal(normalized.rules[0].suggestedDirectory, 'docs');
  assert.deepEqual(normalized.rules[0].patterns, ['**/*.md']);
  assert.equal(rules[0].name, '  说明文档  ');
  assert.deepEqual(normalized.rules[0], validateFilePlacementConfiguration({ filePlacement: { rules: [rules[0]] } }, 'app.json').rules[0]);
  assert.deepEqual(configSchema.$defs.singleProjectDocument.properties.repository.properties.filePlacement, REPOSITORY_FILE_PLACEMENT_SCHEMA);
  assert.deepEqual(configSchema.$defs.workspaceDocument.properties.repository.properties.filePlacement, REPOSITORY_FILE_PLACEMENT_SCHEMA);
});

test('仓库文件归位拒绝 null、未知字段、mode 和启用时空规则，关闭不放松结构校验', () => {
  const invalid = [null, [], { enabled: null }, { enabled: 1 }, { rules: null }, { mode: 'newFiles' }, { unknown: true }, { enabled: true }, { enabled: true, rules: [] }, { rules: [null] }, { rules: [{ ...rule, exceptions: null }] }, { rules: [{ ...rule, unknown: true }] }, { rules: [{ ...rule, patterns: null }] }, { rules: [{ ...rule, allowedPatterns: [] }] }, { rules: [{ ...rule, suggestedDirectory: null }] }];
  for (const value of invalid) {
    assert.equal(validateFragment(value), false, JSON.stringify(value));
    assert.throws(() => validateRepositoryFilePlacementConfiguration({ filePlacement: value }), (error) => error.kind === 'configuration' && /repository\.filePlacement/.test(error.message));
  }
  assert.throws(() => validateRepositoryFilePlacementConfiguration(null), (error) => error.kind === 'configuration');
  for (const ruleChange of [{ suggestedDirectory: '../outside' }, { suggestedDirectory: 'docs/*' }, { allowedPatterns: ['../outside/**'] }]) assert.throws(() => validateRepositoryFilePlacementConfiguration({ filePlacement: { rules: [{ ...rule, ...ruleChange }] } }), /repository\.filePlacement/);
  assert.deepEqual(validateRepositoryFilePlacementConfiguration({ filePlacement: { enabled: false, rules: [] } }), DEFAULT_REPOSITORY_FILE_PLACEMENT_CONFIG);
});

test('单应用前端和 Java 后端均可维护根级归位，与应用规则独立', () => {
  for (const project of [frontend, backend]) {
    const document = { version: 2, project, repository: { filePlacement }, checks: { filePlacement: { enabled: false } } };
    assert.equal(validateRootSchema(document), true, JSON.stringify(validateRootSchema.errors));
    const normalized = normalizeProjectDocument(document);
    assert.deepEqual(normalized.repository.filePlacement, filePlacement);
    assert.equal(normalized.checks.filePlacement.enabled, false);
  }
});

test('多应用仅根配置可声明仓库归位，应用文档不继承或覆盖', (t) => {
  const root = fixture(t);
  writeWorkspace(root);
  const workspace = loadWorkspace(root);
  assert.equal(validateRootSchema(workspace.document), true, JSON.stringify(validateRootSchema.errors));
  assert.deepEqual(workspace.repositoryConfig.repository.filePlacement, filePlacement);
  for (const project of workspace.projects) {
    assert.deepEqual(project.config.repository.filePlacement, DEFAULT_REPOSITORY_FILE_PLACEMENT_CONFIG);
    const document = { version: 2, project: project.project };
    assert.equal(applicationDocument(document, workspace.document).repository, undefined);
    assert.equal(validateApplicationSchema(document), true, JSON.stringify(validateApplicationSchema.errors));
    for (const value of [filePlacement, { enabled: false }, null]) {
      const invalid = { ...document, repository: { filePlacement: value } };
      assert.equal(validateApplicationSchema(invalid), false);
      assert.throws(() => applicationDocument(invalid, workspace.document), /子应用 repository.*filePlacement/);
    }
  }
  write(root, { version: 2, project: frontend, repository: { filePlacement: { enabled: false } } }, 'web/repo-guard.config.json');
  assert.throws(() => loadWorkspace(root), /子应用 repository.*filePlacement/);
});

test('仓库归位启停只修改根配置并保留规则和所有子应用原字节', (t) => {
  const root = fixture(t);
  writeWorkspace(root, { ...filePlacement, enabled: false });
  assert.ok(CONFIGURABLE_FEATURES.includes('repositoryFilePlacement'));
  const original = new Map(['web', 'api'].map((id) => [id, fs.readFileSync(path.join(root, id, 'repo-guard.config.json'), 'utf8')]));
  assert.deepEqual(setFeaturesEnabled(root, ['repositoryFilePlacement'], true).changed, ['repositoryFilePlacement']);
  assert.equal(loadWorkspace(root).repositoryConfig.repository.filePlacement.enabled, true);
  assert.deepEqual(setFeaturesEnabled(root, ['repositoryFilePlacement'], true).unchanged, ['repositoryFilePlacement']);
  assert.deepEqual(setFeaturesEnabled(root, ['repositoryFilePlacement'], false, { projectId: 'api' }).changed, ['repositoryFilePlacement']);
  const workspace = loadWorkspace(root);
  assert.deepEqual(workspace.repositoryConfig.repository.filePlacement, { ...filePlacement, enabled: false });
  for (const [id, body] of original) assert.equal(fs.readFileSync(path.join(root, id, 'repo-guard.config.json'), 'utf8'), body);
});

test('未准备规则不能直接启用，失败不会改写原始配置；单应用可以正常启停', (t) => {
  const root = fixture(t);
  write(root, { version: 2, project: frontend });
  const before = fs.readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8');
  assert.throws(() => setFeaturesEnabled(root, ['repositoryFilePlacement'], true), /至少配置一条规则/);
  assert.equal(fs.readFileSync(path.join(root, 'repo-guard.config.json'), 'utf8'), before);
  write(root, { version: 2, project: frontend, repository: { filePlacement: { enabled: false, rules: [rule] } } });
  assert.deepEqual(setFeaturesEnabled(root, ['repositoryFilePlacement'], true).changed, ['repositoryFilePlacement']);
  assert.deepEqual(setFeaturesEnabled(root, ['repositoryFilePlacement'], false).changed, ['repositoryFilePlacement']);
});
