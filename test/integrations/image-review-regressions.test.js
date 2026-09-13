import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { inspectPageImages } from '../../src/integrations/lighthouse/image-audits.js';
import { observePageImages, observationFindings } from '../../src/integrations/lighthouse/image-observations.js';
import { validateLighthousePages } from '../../src/integrations/lighthouse/page-guard.js';
import { createProjectDocument, normalizeProjectDocument } from '../../src/config/project-configuration.js';
import { analyzeUnusedImageAssets } from '../../src/policies/unused-image-assets.js';
import { imageAssetsGate } from '../../src/gates/repository/image-assets-gate.js';
import { inspectImageGovernance } from '../../src/policies/image-governance.js';

const create = () => createProjectDocument({ id: 'web', role: 'frontend', stack: 'node', preset: 'vue-typescript' });
const options = () => ({ ...create().checks.lighthouse.imageUsage, action: 'error', auditIds: ['unsized-images'] });
const report = (audit, items = []) => ({ requestedUrl: 'http://localhost/', audits: { 'unsized-images': audit, 'network-requests': { details: { items } } } });

test('审计执行错误必须返回执行错误，不能被 null 分数掩盖', () => {
  assert.throws(() => inspectPageImages(report({ score: null, scoreDisplayMode: 'error', errorMessage: 'failed' }), options()), (error) => error.kind === 'execution');
});
test('严格模式缺失审计不得产生通过证据', () => {
  assert.throws(() => inspectPageImages(report(undefined), options()), (error) => error.kind === 'configuration');
});
test('图片传输量缺失或非法不得按零字节放行', () => {
  for (const transferSize of [undefined, -1, '12']) assert.throws(() => inspectPageImages(report({ score: 1 }, [{ resourceType: 'Image', transferSize }]), options()), (error) => error.kind === 'execution');
});
test('路由预算拒绝无效、重复和未配置页面的地址', () => {
  for (const routes of [[{ url: 'not-a-url', maxTransferBytes: 10 }], [{ url: 'http://localhost', maxTransferBytes: 10 }, { url: 'http://localhost/', maxTransferBytes: 20 }]]) {
    const config = create(); config.checks.lighthouse.imageUsage.routes = routes;
    assert.throws(() => normalizeProjectDocument(config), (error) => error.kind === 'configuration' && /imageUsage|路由|URL/.test(error.message));
  }
});

function imageElement(attributes, overrides = {}) {
  return { currentSrc: '', tagName: 'IMG', complete: true, naturalWidth: 0,
    getBoundingClientRect: () => ({ width: 80, height: 80, top: 10, bottom: 90 }),
    getAttribute: (name) => attributes[name] ?? null, hasAttribute: (name) => Object.hasOwn(attributes, name), ...overrides };
}
async function observe(element, config) {
  const page = { evaluate: (fn, settings) => runInNewContext(`(${fn.toString()})(settings)`, { settings,
    document: { querySelectorAll: () => [element] }, getComputedStyle: () => ({ aspectRatio: 'auto' }), innerHeight: 600, devicePixelRatio: 1 }) };
  return observePageImages(page, config);
}
test('自定义 img[data-src] 映射优先于默认 img 并识别未加载状态', async () => {
  const result = await observe(imageElement({ 'data-src': '/assets/banner.png', loading: 'lazy' }), { ...options(), components: [{ selector: 'img[data-src]', sourceAttribute: 'data-src' }] });
  assert.equal(result.length, 1);
  assert.equal(result[0].selector, 'img[data-src]');
  assert.equal(result[0].issues.includes('broken-image'), false);
});
test('关闭图片加载失败检查后 DOM 不再报告失败，开启时遵循阻断配置', async () => {
  const off = await observe(imageElement({ src: '/broken.png' }), { ...options(), failedRequests: false });
  assert.equal(off[0].issues.includes('broken-image'), false);
  const on = await observe(imageElement({ src: '/broken.png' }, { currentSrc: 'http://localhost/broken.png' }), options());
  assert.ok(observationFindings(on, options()).some((finding) => finding.issue === 'lighthouse/broken-image' && finding.severity === 'error'));
});
test('页面守卫同步显式视口且只访问本次 LHCI URL', async () => {
  const visited = []; let viewport;
  const page = { setViewport: async (value) => { viewport = value; }, setUserAgent: async () => {}, goto: async (url) => { visited.push(url); return { status: () => 200 }; }, url: () => visited.at(-1), waitForSelector: async () => {}, close: async () => {} };
  const pages = ['http://localhost/a', 'http://localhost/b'].map((url) => ({ url, expectedUrl: url, selector: 'main' }));
  await validateLighthousePages({ newPage: async () => page }, { url: pages[1].url }, { pages,
    settings: { screenEmulation: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, emulatedUserAgent: false } });
  assert.deepEqual(visited, [pages[1].url]);
  assert.equal(viewport.width, 390); assert.equal(viewport.deviceScaleFactor, 3);
});

test('动态表达式中的字符串片段与远程 URL 基址不能当本地静态图片', () => {
  const config = create();
  const contents = new Map([
    ['src/pages/order.vue', `<template><img :src="'../assets/fallback.png' + suffix" /></template>`],
    ['src/pages/images.ts', `const remote = new URL('../assets/remote.png', 'https://cdn.example/');`],
  ]);
  const result = analyzeUnusedImageAssets({ entries: [...contents.keys()], readSource: (file) => contents.get(file), imageConfig: { ...config.checks.imageAssets, unused: config.checks.unusedImageAssets } });
  assert.deepEqual(result.referenceFindings, []);
});
test('全部图片治理扩展关闭后不得隐式加载 Sharp', async (t) => {
  const parent = path.resolve('test/.tmp'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'image-disabled-review-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src/assets'), { recursive: true });
  writeFileSync(path.join(root, 'src/assets/a.png'), await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toBuffer());
  const config = create(); config.checks.imageAssets.compression.enabled = false; config.checks.imageAssets.duplicates.pixel = 'off';
  for (const item of Object.values(config.checks.imageAssets.governance)) item.enabled = false;
  const plan = imageAssetsGate.plan({ root, config, environment: 'manual', files: ['src/assets/a.png'] });
  const result = await imageAssetsGate.run({ root, config, plan });
  assert.equal(result.status, 'passed', result.summary);
});
test('格式规则的 jpg 与 tif 扩展名配置按真实编码族生效', () => {
  const c = create().checks.imageAssets.governance; c.formats.discouraged = ['jpg', 'tif'];
  assert.ok(inspectImageGovernance('a.jpg', 1, 'jpeg', {}, c).some((f) => f.rule === 'assets/image-format'));
  assert.ok(inspectImageGovernance('a.tif', 1, 'tiff', {}, c).some((f) => f.rule === 'assets/image-format'));
});

test('安全大小上限应在读取图片内容之前生效', async (t) => {
  const root = mkdtempSync(path.resolve('test/.tmp/image-size-review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src/assets'), { recursive: true });
  const file = path.join(root, 'src/assets/large.png');
  writeFileSync(file, Buffer.alloc(100));
  const config = create(); config.checks.imageAssets.limits.maxInputBytes = 10;
  config.checks.imageAssets.duplicates.pixel = 'off';
  const plan = imageAssetsGate.plan({ root, config, environment: 'manual', files: ['src/assets/large.png'] });
  const original = fs.readFileSync;
  let read = false;
  t.mock.method(fs, 'readFileSync', (...args) => { if (args[0] === file) read = true; return original(...args); });
  syncBuiltinESMExports();
  try {
    const result = await imageAssetsGate.run({ root, config, plan });
    assert.equal(result.status, 'violation', result.summary);
    assert.equal(read, false);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('仅 GIF 元数据治理也必须检查消费项目 Sharp 安装', async (t) => {
  const root = mkdtempSync(path.resolve('test/.tmp/image-doctor-review-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = create(); config.checks.imageAssets.extensions = ['gif'];
  config.checks.imageAssets.compression.enabled = false;
  config.checks.imageAssets.duplicates.pixel = 'off';
  await assert.rejects(() => imageAssetsGate.inspectSetup({ root, config }), /Sharp|sharp|package.json/);
});
