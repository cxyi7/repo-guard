import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONFIGURABLE_FEATURES } from '../src/orchestration/setup/config-management.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('keeps package version synchronized across maintained documentation', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const usageGuide = readFileSync(path.join(root, 'docs', 'usage-guide.md'), 'utf8');
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
  const workModelPath = path.join(root, 'docs', 'images', 'repo-guard-work-model.svg');
  const workModel = readFileSync(workModelPath, 'utf8');

  assert.match(overview, /^# repo-guard 项目结构与能力总览$/m);
  assert.match(overview, /!\[repo-guard 工作模型\]\(images\/repo-guard-work-model\.svg\)/);
  assert.match(overview, /\[功能说明文档索引\]\(features\/README\.md\)/);
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
  assert.match(workModel, /可信事实[\s\S]*统一判断[\s\S]*生命周期编排[\s\S]*可复核输出/);
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
