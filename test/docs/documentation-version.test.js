import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONFIGURABLE_FEATURES } from '../../src/orchestration/setup/config-management.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { normalizeRepositoryDocument } from '../../src/config/project-configuration.js';
import { validateConfig as validatePublicConfig } from '../../src/index.js';
import { validateOperationsConfig } from '../../src/operations/config/validation.js';
import { configurationSchemaField, jsonExamples } from '../helpers/documentation-examples.js';
import { PROJECT_CHECK_PATHS } from '../../src/config/project-feature-paths.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function isProjectExample(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.$schema && !value.$schema.endsWith('/config.schema.json') && !value.$schema.endsWith('/project.schema.json')) return false;
  if (value.ci?.collect || value.ci?.assert) return false;
  return ['project', 'checks', 'repository', 'reporting', 'preCommit', 'commitAnimation', 'notification']
    .some((key) => Object.hasOwn(value, key))
    || Array.isArray(value.projects) || Object.hasOwn(value, 'ci');
}

test('维护文档中的工程和运维示例通过各自真实 Schema 与运行时校验', () => {
  const schema = JSON.parse(readFileSync(path.join(root, 'config.schema.json'), 'utf8'));
  const operationsSchema = JSON.parse(readFileSync(path.join(root, 'operations.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addFormat('date', (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  const validateSchema = ajv.compile(schema);
  const validateOpsSchema = ajv.compile(operationsSchema);
  let projectExamples = 0;
  let operationExamples = 0;
  for (const filename of readdirSync(path.join(root, 'docs/features')).filter((file) => file.endsWith('.md'))) {
    const body = readFileSync(path.join(root, 'docs/features', filename), 'utf8');
    for (const { index, value } of jsonExamples(body)) {
      const label = `${filename} 的第 ${index} 个 JSON 示例`;
      if (value.provider || value.$schema?.endsWith('/operations.schema.json')) {
        operationExamples += 1;
        assert.equal(validateOpsSchema(value), true, `${label}：${JSON.stringify(validateOpsSchema.errors)}`);
        assert.doesNotThrow(() => validateOperationsConfig(value), label);
      } else if (isProjectExample(value)) {
        projectExamples += 1;
        const document = Array.isArray(value.projects) ? value : {
          version: 2,
          project: { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' },
          ...value,
        };
        assert.equal(validateSchema(document), true, `${label}：${JSON.stringify(validateSchema.errors)}`);
        assert.doesNotThrow(() => Array.isArray(document.projects)
          ? normalizeRepositoryDocument(document)
          : validatePublicConfig(document), label);
      }
    }
  }
  assert.ok(projectExamples >= 40, '必须实际覆盖各项工程能力的维护示例');
  assert.ok(operationExamples >= 1, '必须校验独立运维示例，不能误套工程配置');
});

test('维护文档字段说明引用实际 v2 字段，不能保留旧嵌套路径', () => {
  const schema = JSON.parse(readFileSync(path.join(root, 'config.schema.json'), 'utf8'));
  let checked = 0;
  for (const filename of readdirSync(path.join(root, 'docs/features')).filter((file) => file.endsWith('.md'))) {
    const body = readFileSync(path.join(root, 'docs/features', filename), 'utf8');
    for (const [block] of body.matchAll(/<!-- config-fields:start -->[\s\S]*?<!-- config-fields:end -->/g)) {
      if (block.includes('lighthouserc.json')) continue;
      for (const [, field] of block.matchAll(/^\| `((?:checks|repository|reporting|ci)\.[^`]+)` \|/gm)) {
        assert.ok(configurationSchemaField(schema, schema.$defs.singleProjectDocument, field), `${filename} 的字段说明不存在：${field}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 200, '必须验证实际的维护字段说明，不只检查少量示例');
});

test('keeps package version synchronized across maintained documentation', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const usageGuide = readFileSync(path.join(root, 'docs', 'usage-guide.md'), 'utf8');
  const inventory = readFileSync(
    path.join(root, 'docs', 'project-structure-and-feature-inventory.md'),
    'utf8',
  );

  assert.equal(
    readme.includes(`- 当前源码版本：\`${manifest.version}\``),
    true,
    'README 当前源码版本必须与 package.json 一致，不能声称尚未发布的源码已在 npm 发布',
  );
  assert.equal(
    usageGuide.includes(`npm install --save-dev --save-exact ${manifest.name}@${manifest.version}`),
    true,
    '使用说明中的安装命令必须使用 package.json 的精确版本',
  );
  assert.equal(
    inventory.includes(`适用于版本 \`${manifest.version}\``),
    true,
    '项目结构与能力总览适用版本必须与 package.json 一致',
  );
});

test('keeps the project overview concise and routes feature details to their own index', () => {
  const overview = readFileSync(
    path.join(root, 'docs', 'project-structure-and-feature-inventory.md'),
    'utf8',
  );
  const featureIndex = readFileSync(path.join(root, 'docs', 'features', 'README.md'), 'utf8');
  const workModelPath = path.join(root, 'docs', 'images', 'repo-guard-v2-architecture.svg');
  const workModel = readFileSync(workModelPath, 'utf8');
  const architectureSource = readFileSync(path.join(root, 'docs', 'images', 'repo-guard-v2-architecture.html'), 'utf8');

  assert.match(overview, /^# repo-guard 项目结构与能力总览$/m);
  assert.match(overview, /!\[repo-guard v2 工程检查与独立运维架构\]\(images\/repo-guard-v2-architecture\.svg\)/);
  assert.match(overview, /\[[^\]]*功能[^\]]*索引\]\(features\/README\.md\)/);
  assert.match(overview, /\[[^\]]+\]\(images\/repo-guard-v2-architecture\.html\)/);
  assert.doesNotMatch(overview, /当前最新功能分支具有递进关系/);
  assert.doesNotMatch(overview, /1\.20\.0 无效图片资源静态引用/);
  assert.match(featureIndex, /^# 功能说明文档索引$/m);
  assert.doesNotMatch(featureIndex, /待编写/);
  assert.match(featureIndex, /交付合同门禁[^\n]*\[docs\/features\/delivery-contract\.md\]\(delivery-contract\.md\)[^\n]*已维护/);
  assert.equal(existsSync(path.join(root, 'docs', 'features', 'delivery-contract.md')), true);
  const links = [...featureIndex.matchAll(/^\| [^|]+ \| \[[^\]]+\]\(([^)]+)\) \| 已维护 \|$/gm)];
  assert.ok(links.length > 0, '功能索引必须提供可用的维护入口');
  for (const [, target] of links) {
    const [file, anchor] = target.split('#');
    const documentPath = path.join(root, 'docs', 'features', file);
    assert.ok(existsSync(documentPath), `功能文档必须存在：${file}`);
    if (anchor) {
      const body = readFileSync(documentPath, 'utf8');
      assert.ok(body.includes(`## ${anchor}`), `功能锚点必须存在：${target}`);
    }
  }
  for (const topic of ['功能登记与合同规划', '交付证据与两轮复核', '真实测试反馈与反向升级']) {
    assert.ok(featureIndex.includes(`delivery-contract.md#${topic}`), '交付环节必须链接到同一份手册');
  }
  assert.match(workModel, /<title[^>]*>.+<\/title>/);
  assert.match(workModel, /<desc[^>]*>.+<\/desc>/);
  for (const topic of ['显式', 'Node 后端', '固定执行计划', 'GateResult', 'operations', '后续扩展', 'Java', 'provisioning']) {
    assert.ok(workModel.includes(topic), `结构图必须说明当前职责和扩展边界：${topic}`);
    assert.ok(architectureSource.includes(topic), `可导出结构图必须与 SVG 同步：${topic}`);
  }
});

test('uses one delivery loop diagram and preserves usage documentation links', () => {
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const usageGuide = readFileSync(path.join(root, 'docs', 'usage-guide.md'), 'utf8');
  const featureMapPath = path.join(root, 'docs', 'images', 'repo-guard-feature-map.svg');
  const featureMap = readFileSync(featureMapPath, 'utf8');

  assert.match(readme, /^## 完整交付闭环$/m);
  assert.match(readme, /^## 安装$/m);
  assert.match(readme, /!\[repo-guard 完整交付闭环\]\(docs\/images\/repo-guard-feature-map\.svg\)/);
  assert.doesNotMatch(readme, /^## 所有功能流程图$/m);
  assert.doesNotMatch(readme, /repo-guard-workflow\.svg/);
  assert.match(featureMap, /需求[\s\S]*开发[\s\S]*测试[\s\S]*发布[\s\S]*反馈[\s\S]*反向升级/);
  assert.match(readme, /\[使用说明\]\(docs\/usage-guide\.md\)/);
  assert.doesNotMatch(readme, /^## 可选：合同驱动交付$/m);
  assert.doesNotMatch(readme, /^## 已完成功能$/m);
  assert.doesNotMatch(readme, /^## 文档结构$/m);
  assert.doesNotMatch(readme, /^## 项目链接$/m);
  assert.doesNotMatch(readme, /^## 快速开始$/m);
  assert.doesNotMatch(readme, /^## 常用使用方式$/m);
  assert.match(usageGuide, /^## 快速开始$/m);
  assert.match(usageGuide, /^## 常用使用方式$/m);
  const documentedFeatures = [...usageGuide.matchAll(/^\| `([a-zA-Z]+)` \| `[^`]+` \|/gm)]
    .map((match) => match[1]);
  assert.deepEqual(
    [...documentedFeatures].sort(),
    [...CONFIGURABLE_FEATURES].sort(),
    '使用说明必须完整列出当前支持的能力开关，不得遗漏或登记未知名称',
  );
  for (const [, feature, documentedPath] of usageGuide.matchAll(/^\| `([a-zA-Z]+)` \| `([^`]+)` \|/gm)) {
    const expectedPath = Object.hasOwn(PROJECT_CHECK_PATHS, feature) ? `checks.${feature}`
      : feature === 'dependencies' ? 'repository.dependencyPolicy'
        : ['commitMessage', 'codePlacement', 'deliveryContract'].includes(feature) ? `repository.${feature}`
          : feature === 'ci' ? 'ci' : `reporting.${feature}`;
    assert.equal(documentedPath, expectedPath, `${feature} 的文档路径必须指向新配置位置`);
  }
  const explainedFeatures = [...usageGuide.matchAll(/^\| `([a-zA-Z]+)` \| `[^`]+` \| \[([^\]]+)\]\((features\/[^)]+)\) \|/gm)];
  assert.equal(explainedFeatures.length, CONFIGURABLE_FEATURES.length, '每个开关都必须有用途说明与详情入口');
  for (const [, feature, description, target] of explainedFeatures) {
    assert.ok(description.length >= 10, `${feature} 必须解释实际用途`);
    assert.ok(existsSync(path.join(root, 'docs', target)), `${feature} 的详情入口必须可用`);
  }
});

test('keeps delivery workflows and formats in one maintained handbook', () => {
  const handbook = readFileSync(path.join(root, 'docs/features/delivery-contract.md'), 'utf8');
  assert.equal(existsSync(path.join(root, 'docs/contract-driven-delivery.md')), false);
  const skill = readFileSync(path.join(root, 'skills/repo-guard-delivery-contract/SKILL.md'), 'utf8');
  assert.ok(skill.includes('node_modules/@cxyi7/repo-guard/docs/features/delivery-contract.md'));
  for (const name of ['delivery-sequence', 'feedback-loop']) {
    assert.ok(handbook.includes(`../images/repo-guard-${name}.svg`));
    const diagram = readFileSync(path.join(root, `docs/images/repo-guard-${name}.svg`), 'utf8');
    const source = readFileSync(path.join(root, `docs/images/repo-guard-${name}.mmd`), 'utf8');
    assert.match(diagram, /<title[^>]*>.+<\/title>/);
    assert.match(diagram, /<desc[^>]*>.+<\/desc>/);
    assert.ok(source.includes(name === 'delivery-sequence' ? 'sequenceDiagram' : 'flowchart TD'));
  }
  assert.match(handbook, /首轮[\s\S]*人工验收[\s\S]*最终复核/);
  for (const dimension of ['测试', '合同', '设计', '任务模板', 'Gate']) {
    assert.ok(handbook.includes(`| ${dimension} |`), `反向升级必须说明${dimension}维度`);
  }
  assert.match(handbook, /^## 字段与文件参考$/m);
});

test('publishes standard npm project links', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(manifest.homepage, 'https://github.com/cxyi7/repo-guard#readme');
  assert.deepEqual(manifest.repository, {
    type: 'git',
    url: 'git+https://github.com/cxyi7/repo-guard.git',
  });
  assert.deepEqual(manifest.bugs, {
    url: 'https://github.com/cxyi7/repo-guard/issues',
  });
});

test('keeps publishing guidance in one repository-local skill', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const usageGuide = readFileSync(path.join(root, 'docs', 'usage-guide.md'), 'utf8');
  const publishingSkill = readFileSync(
    path.join(root, '.agents', 'skills', 'repo-guard-publishing', 'SKILL.md'),
    'utf8',
  );

  assert.equal(existsSync(path.join(root, 'PUBLISHING.md')), false);
  assert.match(agents, /\.agents\/skills\/repo-guard-publishing\/SKILL\.md/);
  assert.doesNotMatch(usageGuide, /PUBLISHING\.md/);
  assert.match(publishingSkill, /^name: repo-guard-publishing$/m);
  assert.match(publishingSkill, /npm run check[\s\S]*npm test[\s\S]*npm run pack:check/);
  assert.match(publishingSkill, /npm login[\s\S]*npm whoami[\s\S]*npm publish/);
  assert.match(publishingSkill, /dist\.integrity/);
  assert.equal(manifest.files.includes('.agents'), false);
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
  assert.match(readme, /开发者[\s\S]*AI[\s\S]*同一套约定/);
});
