import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
  assert.match(featureIndex, /状态为“待编写”的路径是已规划的文档位置/);
  assert.match(featureIndex, /交付合同门禁[\s\S]*docs\/features\/delivery-contract\.md[\s\S]*待编写/);
  assert.match(featureIndex, /合同驱动交付格式[\s\S]*不替代上表中各能力自己的说明文档/);
  assert.match(workModel, /可信事实[\s\S]*统一判断[\s\S]*生命周期编排[\s\S]*可复核输出/);
});

test('uses one lifecycle capability map without a duplicate workflow', () => {
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const usageGuide = readFileSync(path.join(root, 'docs', 'usage-guide.md'), 'utf8');
  const featureMapPath = path.join(root, 'docs', 'images', 'repo-guard-feature-map.svg');
  const featureMap = readFileSync(featureMapPath, 'utf8');

  assert.match(readme, /^## 生命周期能力分层图$/m);
  assert.match(readme, /^## 三步接入$/m);
  assert.match(readme, /!\[repo-guard 生命周期能力分层图\]\(docs\/images\/repo-guard-feature-map\.svg\)/);
  assert.doesNotMatch(readme, /^## 所有功能流程图$/m);
  assert.doesNotMatch(readme, /repo-guard-workflow\.svg/);
  assert.match(featureMap, /项目接入[\s\S]*需求与开发[\s\S]*git commit[\s\S]*git push[\s\S]*GitLab CI[\s\S]*测试与发布/);
  assert.match(featureMap, /交付合同[\s\S]*保护文件[\s\S]*结构化例外/);
  assert.match(readme, /\[使用说明\]\(docs\/usage-guide\.md\)/);
  assert.doesNotMatch(readme, /^## 可选：合同驱动交付$/m);
  assert.doesNotMatch(readme, /^## 已完成功能$/m);
  assert.doesNotMatch(readme, /^## 文档结构$/m);
  assert.doesNotMatch(readme, /^## 项目链接$/m);
  assert.doesNotMatch(readme, /^## 快速开始$/m);
  assert.doesNotMatch(readme, /^## 常用使用方式$/m);
  assert.match(usageGuide, /^## 快速开始$/m);
  assert.match(usageGuide, /^## 常用使用方式$/m);
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
  assert.match(readme, /核心目标是为 AI 辅助开发提供强制、可审计的工程规范/);
});
