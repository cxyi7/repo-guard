import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BUILD_CONFIG,
  DEFAULT_LIGHTHOUSE_CONFIG,
  DEFAULT_TYPE_CHECK_CONFIG,
} from '../src/config/defaults.js';
import { validateExecutionGateConfiguration } from '../src/config/execution-gate-validation.js';

const CONFIG_PATH = 'repo-guard.config.json';

test('applies external execution gate defaults when configuration is omitted', () => {
  assert.deepEqual(validateExecutionGateConfiguration({}, CONFIG_PATH), {
    build: DEFAULT_BUILD_CONFIG,
    lighthouse: DEFAULT_LIGHTHOUSE_CONFIG,
    typeCheck: DEFAULT_TYPE_CHECK_CONFIG,
  });
});

test('normalizes build, Lighthouse, and TypeScript execution settings', () => {
  const result = validateExecutionGateConfiguration({
    build: {
      enabled: true,
      script: ' build:prod ',
      timeoutMs: 240000,
      artifactBudget: {
        enabled: true,
        platform: 'pc',
        outputDirectory: 'dist-web',
        action: 'report',
        pc: {
          analyzer: 'viteManifest',
          limits: { totalRawBytes: 1000000 },
        },
      },
    },
    lighthouse: {
      enabled: true,
      configFile: ' config/lighthouserc.cjs ',
      buildScript: null,
      timeoutMs: 180000,
    },
    typeCheck: {
      enabled: true,
      script: ' typecheck:vue ',
      timeoutMs: 90000,
    },
  }, CONFIG_PATH);

  assert.deepEqual(result, {
    build: {
      enabled: true,
      script: 'build:prod',
      timeoutMs: 240000,
      artifactBudget: {
        enabled: true,
        platform: 'pc',
        outputDirectory: 'dist-web',
        cleanScript: null,
        action: 'report',
        mode: 'strict',
        baselineFile: '.repo-guard/build-artifact-baseline.json',
        scanLimits: {
          maxFiles: 20000,
          maxTotalBytes: 1073741824,
          maxCompressionInputBytes: 104857600,
        },
        pc: {
          analyzer: 'viteManifest',
          manifest: '.vite/manifest.json',
          sourceMaps: 'forbid',
          compression: ['raw', 'gzip', 'brotli'],
          limits: {
            totalRawBytes: 1000000,
            initialJsRawBytes: null,
            initialJsGzipBytes: null,
            initialJsBrotliBytes: null,
            initialCssRawBytes: null,
            initialCssGzipBytes: null,
            initialCssBrotliBytes: null,
            maxChunkRawBytes: null,
            maxChunkCount: null,
            maxAssetRawBytes: null,
          },
        },
        miniProgram: null,
      },
    },
    lighthouse: {
      enabled: true,
      configFile: 'config/lighthouserc.cjs',
      buildScript: null,
      timeoutMs: 180000,
    },
    typeCheck: {
      enabled: true,
      script: 'typecheck:vue',
      timeoutMs: 90000,
    },
  });
});

test('requires execution gate objects and boolean switches', () => {
  assert.throws(
    () => validateExecutionGateConfiguration({ build: [] }, CONFIG_PATH),
    /build 必须是对象/,
  );
  assert.throws(
    () => validateExecutionGateConfiguration({
      lighthouse: { enabled: 'yes' },
    }, CONFIG_PATH),
    /lighthouse\.enabled 必须是布尔值/,
  );
  assert.throws(
    () => validateExecutionGateConfiguration({ typeCheck: 'invalid' }, CONFIG_PATH),
    /typeCheck 必须是对象/,
  );
});

test('rejects invalid scripts, paths, and timeouts', () => {
  assert.throws(
    () => validateExecutionGateConfiguration({
      build: { script: 'npm run build' },
    }, CONFIG_PATH),
    /build\.script 必须是 npm 脚本名称/,
  );
  assert.throws(
    () => validateExecutionGateConfiguration({
      lighthouse: { configFile: '  ' },
    }, CONFIG_PATH),
    /lighthouse\.configFile 必须为 null 或非空字符串/,
  );
  assert.throws(
    () => validateExecutionGateConfiguration({
      typeCheck: { timeoutMs: 0 },
    }, CONFIG_PATH),
    /typeCheck\.timeoutMs 必须是正整数/,
  );
});

test('requires exactly one enabled artifact budget platform', () => {
  assert.throws(
    () => validateExecutionGateConfiguration({
      build: { artifactBudget: { enabled: true } },
    }, CONFIG_PATH),
    /必须选择 platform/,
  );
  assert.throws(
    () => validateExecutionGateConfiguration({
      build: {
        artifactBudget: {
          enabled: true,
          platform: 'pc',
          pc: { analyzer: 'directory', limits: { totalRawBytes: 1 } },
          miniProgram: {
            limits: {
              mainPackageBytes: 1,
              defaultSubPackageBytes: 1,
              totalPackageBytes: 1,
            },
          },
        },
      },
    }, CONFIG_PATH),
    /必须且只能配置 pc/,
  );
});

test('normalizes a strict WeChat mini program artifact budget', () => {
  const result = validateExecutionGateConfiguration({
    build: {
      artifactBudget: {
        enabled: true,
        platform: 'miniProgram',
        outputDirectory: 'unpackage/dist/build/mp-weixin',
        miniProgram: {
          provider: 'weixin',
          limits: {
            mainPackageBytes: 2097152,
            defaultSubPackageBytes: 2097152,
            totalPackageBytes: 20971520,
          },
          expectedSubPackages: ['pagesA'],
          subPackages: [{ root: 'pagesA', maxBytes: 1572864 }],
          exclusions: [{ patterns: ['project.private.config.json'], reason: '本机配置' }],
        },
      },
    },
  }, CONFIG_PATH);

  assert.equal(result.build.artifactBudget.platform, 'miniProgram');
  assert.equal(result.build.artifactBudget.action, 'error');
  assert.equal(result.build.artifactBudget.mode, 'strict');
  assert.deepEqual(result.build.artifactBudget.miniProgram.expectedSubPackages, ['pagesA']);
});

test('rejects report or baseline bypasses for mini program hard limits', () => {
  for (const override of [{ action: 'report' }, { mode: 'baseline' }]) {
    assert.throws(
      () => validateExecutionGateConfiguration({
        build: {
          artifactBudget: {
            enabled: true,
            platform: 'miniProgram',
            ...override,
            miniProgram: {
              limits: {
                mainPackageBytes: 1,
                defaultSubPackageBytes: 1,
                totalPackageBytes: 1,
              },
            },
          },
        },
      }, CONFIG_PATH),
      /小程序平台限制必须使用 action=error 和 mode=strict/,
    );
  }
});

test('rejects mini program exclusions that could hide uploaded business files', () => {
  assert.throws(
    () => validateExecutionGateConfiguration({
      build: {
        artifactBudget: {
          enabled: true,
          platform: 'miniProgram',
          miniProgram: {
            limits: {
              mainPackageBytes: 1,
              defaultSubPackageBytes: 1,
              totalPackageBytes: 1,
            },
            exclusions: [{ patterns: ['pages/**'], reason: '跳过业务页面' }],
          },
        },
      },
    }, CONFIG_PATH),
    /只能排除微信开发者工具非上传文件/,
  );
});

test('rejects unsafe artifact output and baseline paths', () => {
  for (const outputDirectory of ['src/dist', 'node_modules/output', 'dist/**']) {
    assert.throws(
      () => validateExecutionGateConfiguration({
        build: {
          artifactBudget: {
            enabled: true,
            platform: 'pc',
            outputDirectory,
            pc: { analyzer: 'directory', limits: { totalRawBytes: 1 } },
          },
        },
      }, CONFIG_PATH),
      /outputDirectory/,
    );
  }
  assert.throws(
    () => validateExecutionGateConfiguration({
      build: {
        artifactBudget: {
          enabled: true,
          platform: 'pc',
          baselineFile: 'dist/baseline.json',
          pc: { analyzer: 'directory', limits: { totalRawBytes: 1 } },
        },
      },
    }, CONFIG_PATH),
    /baselineFile 必须是 \.repo-guard\/ 内的 JSON 文件/,
  );
});
