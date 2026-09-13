import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { createProjectDocument, normalizeProjectDocument } from '../../src/config/project-configuration.js';
import { analyzeUnusedImageAssets } from '../../src/policies/unused-image-assets.js';
import { inspectImageGovernance } from '../../src/policies/image-governance.js';
import { inspectPageImages } from '../../src/integrations/lighthouse/image-audits.js';
import { createWebpCandidate } from '../../src/integrations/images/optimization.js';

const descriptor = { id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' };
const create = () => createProjectDocument(descriptor);
const declaration = () => ({ sourcePatterns: ['src/pages/orders.vue'], assetPatterns: ['public/assets/status/*.png'],
  reason: '订单接口返回状态图片名', api: { method: 'GET', endpoint: '/api/orders', responseField: 'data.items[].statusImage' } });

test('前端图片全量预设写入且用户配置优先，公开 Schema 接受新配置', () => {
  const config = create();
  assert.equal(config.checks.imageAssets.enabled, true);
  assert.equal(config.checks.imageAssets.enforcement, 'allFiles');
  assert.equal(config.checks.imageAssets.naming.convention, 'kebab-case');
  assert.equal(config.checks.unusedImageAssets.action, 'report');
  config.checks.imageAssets.governance.budgets.maxBytes = 12345;
  config.checks.unusedImageAssets.dynamicReferences = [declaration()];
  const normalized = normalizeProjectDocument(config);
  assert.equal(normalized.checks.imageAssets.governance.budgets.maxBytes, 12345);
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync('config.schema.json', 'utf8')));
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
});

test('动态接口与字段信息随资源保留，不能冒充实际响应证据', () => {
  const config = create();
  config.checks.unusedImageAssets.dynamicReferences = [declaration()];
  const contents = new Map([['src/pages/orders.vue', '<template><img :src="imageUrl" /></template>']]);
  const result = analyzeUnusedImageAssets({ entries: [...contents.keys(), 'public/assets/status/paid.png'], readSource: (file) => contents.get(file),
    imageConfig: { ...config.checks.imageAssets, unused: config.checks.unusedImageAssets } });
  assert.deepEqual(result.unusedPaths, []);
  assert.equal(result.retained[0].api.responseField, 'data.items[].statusImage');
  assert.equal(result.retained[0].status, 'declared');
  assert.throws(() => analyzeUnusedImageAssets({ entries: ['public/assets/status/paid.png'], readSource: () => '', imageConfig: { ...config.checks.imageAssets, unused: config.checks.unusedImageAssets } }), /已经失效/);
});

test('接口声明拒绝缺失字段与带查询参数的地址', () => {
  for (const api of [{ method: 'GET', endpoint: '/api/orders' }, { method: 'GET', endpoint: '/api/orders?token=secret', responseField: 'data.image' }]) {
    const config = create();
    config.checks.unusedImageAssets.dynamicReferences = [{ ...declaration(), api }];
    assert.throws(() => normalizeProjectDocument(config), /api\./);
  }
});

test('图片引用区分缺失、大小写错误与普通数据字符串，并覆盖根样式目录', () => {
  const config = create();
  const contents = new Map([
    ['styles/main.scss', '.icon { background: url("../src/assets/Logo.png") }'],
    ['src/index.ts', 'import logo from "./assets/missing.png"; console.log("./assets/not-a-reference.png");'],
  ]);
  const result = analyzeUnusedImageAssets({ entries: [...contents.keys(), 'src/assets/logo.png'], readSource: (file) => contents.get(file), imageConfig: { ...config.checks.imageAssets, unused: config.checks.unusedImageAssets } });
  assert.equal(result.referenceFindings.length, 2);
  assert.deepEqual(new Set(result.referenceFindings.map((f) => f.issue)), new Set(['image-assets/reference-case', 'image-assets/reference-missing']));
  assert.deepEqual(result.unusedPaths, []);
});

test('用途预算按配置匹配，精确阈值通过，超限与动画时长独立报告', () => {
  const options = create().checks.imageAssets.governance;
  assert.equal(inspectImageGovernance('src/assets/icons/check.png', 20480, 'png', { width: 32, height: 32 }, options).length, 0);
  assert.equal(inspectImageGovernance('src/assets/icons/check.png', 20481, 'png', { width: 32, height: 32 }, options)[0].rule, 'assets/image-budget');
  options.budgets.rules = [{ name: '自定义', patterns: ['media/**'], maxBytes: 5 }];
  assert.equal(inspectImageGovernance('media/a.png', 6, 'png', {}, options)[0].rule, 'assets/image-budget');
  const findings = inspectImageGovernance('src/assets/movie.gif', 100, 'gif', { width: 8, pageHeight: 8, pages: 2, delay: [20000, 20000] }, options);
  assert.equal(findings[0].rule, 'assets/image-animation');
});

test('元数据与不推荐格式报告不泄露元数据内容', () => {
  const findings = inspectImageGovernance('src/assets/photo.tiff', 200, 'tiff', { exif: Buffer.from('private-coordinate') }, create().checks.imageAssets.governance);
  assert.deepEqual(findings.map((f) => f.rule), ['assets/image-format', 'assets/image-metadata']);
  assert.equal(JSON.stringify(findings).includes('private-coordinate'), false);
});

test('页面图片按路由预算检查，缺失审计报告未验证', () => {
  const options = create().checks.lighthouse.imageUsage;
  options.routes = [{ url: 'http://localhost/orders', maxTransferBytes: 10 }];
  const findings = inspectPageImages({ requestedUrl: 'http://localhost/orders', audits: {
    'network-requests': { details: { items: [{ resourceType: 'Image', transferSize: 11, statusCode: 404 }] } },
  } }, options);
  assert.ok(findings.some((f) => f.issue === 'lighthouse/image-transfer-budget'));
  assert.ok(findings.some((f) => f.issue === 'lighthouse/image-load-failed'));
  assert.ok(findings.some((f) => f.issue === 'lighthouse/image-audit-unavailable'));
});

test('保留显示信息的转换删除 EXIF 并保持方向与像素', async () => {
  const buffer = await sharp({ create: { width: 9, height: 5, channels: 3, background: '#ff0000' } }).png().withExif({ IFD0: { Artist: 'Private' } }).toBuffer();
  const config = create().checks.imageAssets;
  const result = await createWebpCandidate({ sharp, buffer, format: 'png', config: config.compression.conversion, limits: config.limits, metadataPolicy: 'display' });
  const metadata = await sharp(result.candidate).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 9);
  assert.equal(metadata.height, 5);
});
