import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { optimize } from 'svgo';
import { validateConfig } from '../src/config/configuration-validation.js';
import { createChangeSet } from '../src/core/capability/gate-context.js';
import { imageAssetsGate } from '../src/gates/repository/image-assets-gate.js';
import { runGit } from '../src/git/execution.js';
import { runImageOptimize } from '../src/orchestration/cli/image-optimize.js';
import {
  createSvgCompressionCandidate,
  normalizedPixelHash,
} from '../src/integrations/images/optimization.js';
import { createStarterConfig } from '../src/orchestration/setup/config-management.js';
import {
  detectImageFormat,
  inspectDuplicateGroups,
  inspectImageAssetNames,
  selectImageAssetPaths,
} from '../src/policies/image-assets.js';
import { inspectPathNaming } from '../src/policies/path-naming.js';

const TEST_ROOT = path.join(process.cwd(), 'test', '.tmp');
mkdirSync(TEST_ROOT, { recursive: true });

function configFixture() {
  const config = createStarterConfig();
  config.imageAssets.enabled = true;
  config.imageAssets.include = ['src/assets/**/*.{png,jpg,jpeg,webp,svg}'];
  config.imageAssets.exclude = [];
  config.imageAssets.compression.enabled = false;
  config.imageAssets.duplicates.pixel = 'off';
  return validateConfig(config);
}

async function pngBuffer() {
  return await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 4,
      background: '#1478dc',
    },
  }).png({ compressionLevel: 0 }).toBuffer();
}

function gitFixture(context) {
  const root = mkdtempSync(path.join(TEST_ROOT, 'image-assets-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(['init'], { cwd: root });
  runGit(['config', 'user.email', 'repo-guard@example.com'], { cwd: root });
  runGit(['config', 'user.name', 'repo-guard'], { cwd: root });
  mkdirSync(path.join(root, 'src', 'assets'), { recursive: true });
  return root;
}

test('识别图片真实格式并接受统一命名和倍率后缀', async () => {
  const config = configFixture().imageAssets;
  config.naming.convention = 'kebab-case';
  const valid = ['src/assets/user-avatar.png', 'src/assets/user-avatar@2x.png'];
  assert.deepEqual(inspectImageAssetNames(valid, config), []);
  assert.equal(detectImageFormat(await pngBuffer()), 'png');
  assert.equal(inspectImageAssetNames(['src/assets/userAvatar.png'], config).length, 1);
  assert.equal(
    inspectImageAssetNames(['src/assets/user-avatar.PNG'], config)[0].issue,
    'image-assets/uppercase-extension',
  );
  assert.deepEqual(
    selectImageAssetPaths(['src/assets/user-avatar.PNG'], config),
    ['src/assets/user-avatar.PNG'],
  );
  const compatibleBrandAvif = Buffer.alloc(24);
  compatibleBrandAvif.writeUInt32BE(24, 0);
  compatibleBrandAvif.write('ftyp', 4, 'ascii');
  compatibleBrandAvif.write('mif1', 8, 'ascii');
  compatibleBrandAvif.write('avif', 16, 'ascii');
  assert.equal(detectImageFormat(compatibleBrandAvif), 'avif');
});

test('多帧图片的元数据与像素读取都启用 animated 模式', async () => {
  const calls = [];
  const fakeSharp = (_buffer, options) => {
    calls.push(options);
    if (calls.length === 1) {
      return {
        metadata: async () => ({
          pages: 2,
          pageHeight: 1,
          delay: [80, 120],
          loop: 3,
        }),
      };
    }
    const pipeline = {
      rotate: () => pipeline,
      toColourspace: () => pipeline,
      ensureAlpha: () => pipeline,
      raw: () => pipeline,
      toBuffer: async () => ({
        data: Buffer.from([0, 0, 0, 255, 255, 255, 255, 255]),
        info: { width: 1, height: 2 },
      }),
    };
    return pipeline;
  };

  const result = await normalizedPixelHash(fakeSharp, Buffer.from('fixture'), {
    maxPixels: 100,
    maxFrames: 3,
  });

  assert.equal(result.width, 1);
  assert.equal(result.height, 2);
  assert.equal(
    result.animationKey,
    JSON.stringify({ pages: 2, pageHeight: 1, delay: [80, 120], loop: 3 }),
  );
  assert.deepEqual(calls, [
    { animated: true, limitInputPixels: 100 },
    { animated: true, limitInputPixels: 100 },
  ]);
});

test('增量重复资源优先保留存量文件，并且同批变更只保留一个建议路径', () => {
  const existingFirst = inspectDuplicateGroups([
    { path: 'src/assets/zLogo.png', hash: 'same' },
    { path: 'src/assets/aLogo.png', hash: 'same' },
  ], {
    changedPaths: new Set(['src/assets/aLogo.png']),
    enforcement: 'changedFiles',
    canonicalRoots: ['src/assets'],
  });
  assert.deepEqual(existingFirst, [{
    path: 'src/assets/aLogo.png',
    canonical: 'src/assets/zLogo.png',
    duplicates: ['src/assets/zLogo.png'],
  }]);

  const changedGroup = inspectDuplicateGroups([
    { path: 'src/assets/zLogo.png', hash: 'same' },
    { path: 'src/assets/aLogo.png', hash: 'same' },
  ], {
    changedPaths: new Set(['src/assets/aLogo.png', 'src/assets/zLogo.png']),
    enforcement: 'changedFiles',
    canonicalRoots: ['src/assets'],
  });
  assert.deepEqual(changedGroup, [{
    path: 'src/assets/zLogo.png',
    canonical: 'src/assets/aLogo.png',
    duplicates: ['src/assets/aLogo.png'],
  }]);
});

test('新增图片会与存量路径比较大小写碰撞，且通用规则仍检查图片父目录', () => {
  const imageConfig = configFixture().imageAssets;
  const collisions = inspectImageAssetNames(
    ['src/assets/logo.png', 'src/assets/Logo.png'],
    imageConfig,
    { governedPaths: ['src/assets/Logo.png'] },
  );
  assert.equal(
    collisions.filter(({ rule }) => rule === 'assets/case-collision').length,
    1,
  );

  const pathConfig = createStarterConfig().preCommit.pathNaming;
  pathConfig.enabled = true;
  pathConfig.include = ['src/**'];
  pathConfig.exclude = [];
  const pathResult = inspectPathNaming({
    files: ['src/bad-folder/logo.png'],
    config: pathConfig,
    skipFiles: ['src/bad-folder/logo.png'],
  });
  assert.equal(pathResult.violations.length, 1);
  assert.equal(pathResult.violations[0].kind, 'directory');
});

test('拒绝图片命名与全项目路径命名混用两套规范', () => {
  const config = createStarterConfig();
  config.imageAssets.enabled = true;
  config.imageAssets.naming.convention = 'kebab-case';
  config.preCommit.pathNaming.enabled = true;
  config.preCommit.pathNaming.convention = 'camelCase';
  assert.throws(
    () => validateConfig(config),
    /imageAssets\.naming\.convention 必须与 preCommit\.pathNaming\.convention 保持一致/,
  );
});

test('重复资源保留路径支持仓库内目录和 glob 优先级', () => {
  const findings = inspectDuplicateGroups([
    { path: 'src/legacy/logo.png', hash: 'same' },
    { path: 'public/shared/logo.png', hash: 'same' },
  ], {
    changedPaths: new Set(),
    enforcement: 'allFiles',
    canonicalRoots: ['public/**'],
  });
  assert.equal(findings[0].canonical, 'public/shared/logo.png');
  assert.equal(findings[0].path, 'src/legacy/logo.png');
});

test('SVGO 候选保留 viewBox、ID、类名、无障碍属性和标题', () => {
  const source = Buffer.from(`
    <svg viewBox="0 0 10 10" role="img" aria-label="状态图标" xmlns="http://www.w3.org/2000/svg">
      <title>状态</title>
      <defs><linearGradient id="statusGradient"><stop offset="0" /></linearGradient></defs>
      <rect class="statusIcon" width="10" height="10" fill="url(#statusGradient)" />
    </svg>
  `, 'utf8');
  const candidate = createSvgCompressionCandidate(optimize, source).toString('utf8');
  assert.ok(candidate.length < source.length);
  assert.match(candidate, /viewBox="0 0 10 10"/);
  assert.match(candidate, /id="statusGradient"/);
  assert.match(candidate, /class="statusIcon"/);
  assert.match(candidate, /aria-label="状态图标"/);
  assert.match(candidate, /<title>状态<\/title>/);
});

test('pre-commit 使用暂存区二进制内容而不是未暂存工作区', async (context) => {
  const root = gitFixture(context);
  const imagePath = path.join(root, 'src', 'assets', 'logo.png');
  writeFileSync(imagePath, await pngBuffer());
  runGit(['add', '.'], { cwd: root });
  writeFileSync(imagePath, '这不是图片', 'utf8');
  const config = configFixture();
  const changes = createChangeSet({
    source: 'pre-commit',
    changes: [{ status: 'A', oldPath: null, path: 'src/assets/logo.png' }],
  });
  const plan = imageAssetsGate.plan({
    root,
    config,
    environment: 'pre-commit',
    revision: null,
    changes,
    files: [],
  });
  const result = await imageAssetsGate.run({ root, config, plan });
  assert.equal(result.status, 'passed');
  assert.equal(readFileSync(imagePath, 'utf8'), '这不是图片');
});

test('压缩父开关关闭时不执行 WebP 转换分析', async (context) => {
  const root = gitFixture(context);
  writeFileSync(path.join(root, 'src', 'assets', 'logo.png'), await pngBuffer());
  runGit(['add', '.'], { cwd: root });
  const config = configFixture();
  config.imageAssets.compression.enabled = false;
  config.imageAssets.compression.conversion.enabled = true;
  const changes = createChangeSet({
    source: 'pre-commit',
    changes: [{ status: 'A', oldPath: null, path: 'src/assets/logo.png' }],
  });
  const plan = imageAssetsGate.plan({
    root,
    config,
    environment: 'pre-commit',
    revision: null,
    changes,
    files: [],
  });

  const result = await imageAssetsGate.run({ root, config, plan });

  assert.equal(result.status, 'passed');
  assert.doesNotMatch(
    JSON.stringify(result.findings),
    /assets\/webp-conversion-opportunity/,
  );
});

test('精确重复资源阻断新增副本但不删除文件', async (context) => {
  const root = gitFixture(context);
  const buffer = await pngBuffer();
  writeFileSync(path.join(root, 'src', 'assets', 'logo.png'), buffer);
  writeFileSync(path.join(root, 'src', 'assets', 'logo-copy.png'), buffer);
  runGit(['add', '.'], { cwd: root });
  const config = configFixture();
  const changes = createChangeSet({
    source: 'pre-commit',
    changes: [
      { status: 'A', oldPath: null, path: 'src/assets/logo.png' },
      { status: 'A', oldPath: null, path: 'src/assets/logo-copy.png' },
    ],
  });
  const plan = imageAssetsGate.plan({
    root,
    config,
    environment: 'pre-commit',
    revision: null,
    changes,
    files: [],
  });
  const result = await imageAssetsGate.run({ root, config, plan });
  assert.equal(result.status, 'violation');
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'assets/exact-duplicate'));
  assert.equal(existsSync(path.join(root, 'src', 'assets', 'logo-copy.png')), true);
});

test('精确重复规则接受同一路径和位置的限时结构化例外', async (context) => {
  const root = gitFixture(context);
  const buffer = await pngBuffer();
  writeFileSync(path.join(root, 'src', 'assets', 'logo.png'), buffer);
  runGit(['add', '.'], { cwd: root });
  runGit(['commit', '-m', 'test: 添加既有图片'], { cwd: root });
  writeFileSync(path.join(root, 'src', 'assets', 'logoCopy.png'), buffer);
  runGit(['add', '.'], { cwd: root });
  const rawConfig = createStarterConfig();
  rawConfig.imageAssets.enabled = true;
  rawConfig.imageAssets.include = ['src/assets/**/*.png'];
  rawConfig.imageAssets.exclude = [];
  rawConfig.imageAssets.compression.enabled = false;
  rawConfig.exceptions.entries = [{
    id: 'legacy-image-copy',
    rule: 'assets/exact-duplicate',
    path: 'src/assets/logoCopy.png',
    line: 1,
    column: 1,
    reason: '旧版客户端仍需保留独立资源路径',
    owner: 'frontend-team',
    approvedBy: 'architecture-team',
    ticket: 'ASSET-1001',
    createdOn: '2026-08-20',
    expiresOn: '2026-09-01',
  }];
  const config = validateConfig(rawConfig);
  const changes = createChangeSet({
    source: 'pre-commit',
    changes: [{ status: 'A', oldPath: null, path: 'src/assets/logoCopy.png' }],
  });
  const plan = imageAssetsGate.plan({
    root,
    config,
    environment: 'pre-commit',
    revision: null,
    changes,
    files: [],
  });
  const result = await imageAssetsGate.run({ root, config, plan });
  assert.equal(result.status, 'passed');
  assert.equal(result.metrics.approvedExceptions, 1);
});

test('扩展名与暂存图片真实格式不一致时阻断提交', async (context) => {
  const root = gitFixture(context);
  writeFileSync(
    path.join(root, 'src', 'assets', 'wrong.jpg'),
    await pngBuffer(),
  );
  runGit(['add', '.'], { cwd: root });
  const config = configFixture();
  const changes = createChangeSet({
    source: 'pre-commit',
    changes: [{ status: 'A', oldPath: null, path: 'src/assets/wrong.jpg' }],
  });
  const plan = imageAssetsGate.plan({
    root,
    config,
    environment: 'pre-commit',
    revision: null,
    changes,
    files: [],
  });
  const result = await imageAssetsGate.run({ root, config, plan });
  assert.equal(result.status, 'violation');
  assert.ok(result.findings.some(({ ruleId }) => ruleId === 'assets/extension-content-mismatch'));
});

test('显式命令生成 WebP 且保留原图和引用', async (context) => {
  const root = gitFixture(context);
  const imagePath = path.join(root, 'src', 'assets', 'banner.png');
  writeFileSync(imagePath, await pngBuffer());
  const config = createStarterConfig();
  config.imageAssets.enabled = true;
  config.imageAssets.include = ['src/assets/**/*.png'];
  config.imageAssets.exclude = [];
  config.imageAssets.compression.conversion.enabled = true;
  config.imageAssets.compression.conversion.minInputBytes = 0;
  config.imageAssets.compression.conversion.minSavingsBytes = 1;
  config.imageAssets.compression.conversion.minSavingsPercent = 1;
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'image-assets-fixture',
    version: '1.0.0',
    devDependencies: { sharp: '0.35.3' },
  }, null, 2)}\n`, 'utf8');
  runGit(['add', '.'], { cwd: root });
  runGit(['commit', '-m', 'test: 添加原始图片'], { cwd: root });
  symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), 'junction');

  const exitCode = await runImageOptimize({
    cwd: root,
    paths: ['src/assets/banner.png'],
    to: 'webp',
    write: true,
  });
  assert.equal(exitCode, 0);
  assert.equal(existsSync(imagePath), true);
  const outputPath = path.join(root, 'src', 'assets', 'banner.webp');
  assert.equal(existsSync(outputPath), true);
  assert.equal(detectImageFormat(readFileSync(outputPath)), 'webp');
  await assert.rejects(
    runImageOptimize({
      cwd: root,
      paths: ['src/assets/banner.png'],
      to: 'webp',
      write: true,
    }),
    /拒绝覆盖已经存在的目标图片/,
  );
});

test('原格式安全替换压缩图片并保留文件权限', async (context) => {
  const root = gitFixture(context);
  const imagePath = path.join(root, 'src', 'assets', 'logo.png');
  writeFileSync(imagePath, await pngBuffer());
  const config = createStarterConfig();
  config.imageAssets.enabled = true;
  config.imageAssets.include = ['src/assets/**/*.png'];
  config.imageAssets.exclude = [];
  config.imageAssets.compression.minInputBytes = 0;
  config.imageAssets.compression.minSavingsBytes = 1;
  config.imageAssets.compression.minSavingsPercent = 1;
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'image-assets-fixture',
    version: '1.0.0',
    devDependencies: { sharp: '0.35.3' },
  }, null, 2)}\n`, 'utf8');
  runGit(['add', '.'], { cwd: root });
  runGit(['commit', '-m', 'test: 添加待压缩图片'], { cwd: root });
  symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), 'junction');
  const before = statSync(imagePath);

  const exitCode = await runImageOptimize({
    cwd: root,
    paths: ['src/assets/logo.png'],
    write: true,
  });

  const after = statSync(imagePath);
  assert.equal(exitCode, 0);
  assert.ok(after.size < before.size);
  assert.equal(after.mode, before.mode);
});

test('显式优化拒绝经过任意父级符号链接的图片路径', async (context) => {
  const root = gitFixture(context);
  const realDirectory = path.join(root, 'src', 'real-assets');
  mkdirSync(realDirectory, { recursive: true });
  writeFileSync(path.join(realDirectory, 'banner.png'), await pngBuffer());
  symlinkSync(realDirectory, path.join(root, 'src', 'assets', 'linked'), 'junction');
  const config = createStarterConfig();
  config.imageAssets.enabled = true;
  config.imageAssets.include = ['src/assets/**/*.png'];
  config.imageAssets.exclude = [];
  writeFileSync(
    path.join(root, 'repo-guard.config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );

  await assert.rejects(
    runImageOptimize({
      cwd: root,
      paths: ['src/assets/linked/banner.png'],
    }),
    (error) => error.code === 'image-assets/symlink-rejected',
  );
});

test('有损 WebP 写入要求配置与命令行双重授权', async (context) => {
  const root = gitFixture(context);
  const imagePath = path.join(root, 'src', 'assets', 'photo.jpg');
  writeFileSync(imagePath, await sharp(await pngBuffer()).jpeg().toBuffer());
  const config = createStarterConfig();
  config.imageAssets.enabled = true;
  config.imageAssets.include = ['src/assets/**/*.jpg'];
  config.imageAssets.exclude = [];
  config.imageAssets.compression.conversion.enabled = true;
  const configPath = path.join(root, 'repo-guard.config.json');
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  await assert.rejects(
    runImageOptimize({
      cwd: root,
      paths: ['src/assets/photo.jpg'],
      to: 'webp',
      write: true,
      allowLossy: true,
    }),
    (error) => error.code === 'image-optimize/lossy-not-confirmed',
  );

  config.imageAssets.compression.raster.allowLossy = true;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await assert.rejects(
    runImageOptimize({
      cwd: root,
      paths: ['src/assets/photo.jpg'],
      to: 'webp',
      write: true,
      allowLossy: false,
    }),
    (error) => error.code === 'image-optimize/lossy-not-confirmed',
  );
});
