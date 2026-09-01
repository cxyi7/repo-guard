import assert from 'node:assert/strict';
import test from 'node:test';
import { validateUiTokenConfiguration } from '../src/config/ui-token-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('按项目配置启用 Sass 与 UnoCSS 适配器', () => {
  const config = validateUiTokenConfiguration({
    uiTokens: {
      enabled: true,
      manifestFile: 'design/ui-tokens.manifest.json',
      include: ['src/**/*.{vue,scss}'],
      exclude: ['src/generated/**'],
      adapters: {
        sass: { enabled: true },
        unocss: {
          enabled: true,
          configFiles: ['uno.config.ts', 'config/uno.shared.ts'],
          attributify: false,
          variantGroups: true,
        },
      },
      icon: {
        components: ['AppIcon'],
        nativeSvg: false,
        sassSelectors: ['.app-icon'],
      },
    },
  }, CONFIG_PATH);

  assert.equal(config.enabled, true);
  assert.equal(config.adapters.sass.enabled, true);
  assert.deepEqual(config.adapters.unocss.configFiles, [
    'uno.config.ts',
    'config/uno.shared.ts',
  ]);
  assert.deepEqual(config.icon, {
    components: ['AppIcon'],
    nativeSvg: false,
    sassSelectors: ['.app-icon'],
  });
});

test('拒绝没有语言适配器的空门禁和不确定的契约路径', () => {
  assert.throws(
    () => validateUiTokenConfiguration({ uiTokens: { enabled: true } }, CONFIG_PATH),
    /至少要启用 sass 或 unocss 适配器/,
  );
  assert.throws(
    () => validateUiTokenConfiguration({
      uiTokens: { manifestFile: 'design/*.json' },
    }, CONFIG_PATH),
    /不得包含 glob/,
  );
  assert.throws(
    () => validateUiTokenConfiguration({
      uiTokens: { adapters: { less: { enabled: true } } },
    }, CONFIG_PATH),
    /包含不支持的属性： less/,
  );
  assert.throws(
    () => validateUiTokenConfiguration({
      uiTokens: { icon: { components: ['AppIcon', ' AppIcon '] } },
    }, CONFIG_PATH),
    /不得包含重复值/,
  );
});
