import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfig } from '../../src/config/configuration-validation.js';
import { createStarterConfig } from '../../src/orchestration/setup/config-management.js';

test('无效图片配置使用安全默认范围并允许项目别名和公开目录', () => {
  const config = createStarterConfig();
  config.checks.unusedImageAssets.aliases = [
    { prefix: '@/', directory: 'src' },
    { prefix: '~shared/', directory: 'packages/shared' },
  ];
  config.checks.unusedImageAssets.publicRoots = [
    { directory: 'public', urlPrefix: '/' },
    { directory: 'static', urlPrefix: '/static' },
  ];
  const validated = validateConfig(config);
  assert.equal(validated.checks.unusedImageAssets.enabled, false);
  assert.deepEqual(
    validated.checks.unusedImageAssets.aliases,
    config.checks.unusedImageAssets.aliases,
  );
  assert.deepEqual(
    validated.checks.unusedImageAssets.publicRoots,
    config.checks.unusedImageAssets.publicRoots,
  );
});

test('无效图片动态声明必须有原因、真实窄范围模式且路径位于仓库内', () => {
  const config = createStarterConfig();
  config.checks.unusedImageAssets.dynamicReferences = [
    {
      sourcePatterns: ['**/*'],
      assetPatterns: ['src/assets/runtime/*.png'],
      reason: '运行时拼接',
    },
  ];
  assert.throws(() => validateConfig(config), /不得使用覆盖整个仓库的通配模式/);

  config.checks.unusedImageAssets.dynamicReferences[0].sourcePatterns = [
    'src/pages/gallery.ts',
  ];
  config.checks.unusedImageAssets.dynamicReferences[0].reason = '';
  assert.throws(() => validateConfig(config), /必须说明动态引用原因/);

  config.checks.unusedImageAssets.dynamicReferences = [];
  config.checks.unusedImageAssets.aliases = [
    { prefix: '@/', directory: '../outside' },
  ];
  assert.throws(() => validateConfig(config), /必须位于仓库内部/);
});
