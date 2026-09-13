import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import {
  configurationError,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import { resolveBuildArtifactOutput } from '../build-artifacts/project.js';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertJsonOptions(value) {
  if (
    value === null ||
    ['string', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return;
  if (Array.isArray(value)) {
    value.forEach(assertJsonOptions);
    return;
  }
  if (object(value) && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw configurationError(
          'lighthouse/unsafe-config-key',
          'Lighthouse 配置包含不允许的属性。',
        );
      assertJsonOptions(item);
    }
    return;
  }
  throw configurationError(
    'lighthouse/non-json-options',
    'Lighthouse collect/assert 配置必须可序列化为 JSON；函数请放入 puppeteerScript 文件。',
  );
}

/** 数组整项替换，项目原生值优先；不修改用户的原生文件。 */
export function mergeLighthouseConfiguration(defaults, native) {
  if (!object(defaults) || !object(native)) return native;
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(native)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw configurationError(
        'lighthouse/unsafe-config-key',
        'Lighthouse 配置包含不允许的属性。',
      );
    merged[key] =
      object(value) && object(defaults[key])
        ? mergeLighthouseConfiguration(defaults[key], value)
        : value;
  }
  return merged;
}

export async function readLighthouseConfiguration(root, file) {
  if (!file) return {};
  const absolute = path.resolve(root, file);
  const extension = path.extname(file).toLowerCase();
  const value =
    extension === '.json'
      ? JSON.parse(readFileSync(absolute, 'utf8'))
      : ['.yml', '.yaml'].includes(extension)
        ? YAML.parse(readFileSync(absolute, 'utf8'))
        : (await import(pathToFileURL(absolute).href)).default;
  if (!object(value))
    throw configurationError(
      'lighthouse/invalid-native-config',
      'Lighthouse 原生配置必须导出对象。',
    );
  return value;
}

export async function prepareLighthouseConfiguration(root, config, nativeFile) {
  const native = await readLighthouseConfiguration(root, nativeFile);
  const merged = mergeLighthouseConfiguration(config.options ?? {}, native);
  const collect = merged.ci?.collect;
  if (
    !object(collect) ||
    !Array.isArray(collect.url) ||
    collect.url.length === 0
  )
    throw configurationError(
      'lighthouse/missing-pages',
      'Lighthouse 接入未完成：请配置真实业务页面 URL。',
    );
  assertJsonOptions({ collect, assert: merged.ci?.assert ?? {} });
  if (
    collect.numberOfRuns !== undefined &&
    (!Number.isInteger(collect.numberOfRuns) || collect.numberOfRuns < 1)
  )
    throw configurationError(
      'lighthouse/invalid-runs',
      'Lighthouse numberOfRuns 必须为正整数。',
    );
  for (const value of collect.url) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw configurationError(
        'lighthouse/invalid-url',
        'Lighthouse URL 必须是完整 HTTP 地址。',
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw configurationError(
        'lighthouse/invalid-url',
        'Lighthouse URL 必须使用 HTTP 且不得包含凭据。',
      );
  }
  if (config.pages && collect.staticDistDir)
    throw configurationError(
      'lighthouse/dynamic-preview-port',
      '业务页面精确验证不支持 staticDistDir 动态端口，请配置服务本轮产物的 startServerCommand。',
    );
  const pages = config.pages;
  if (config.imageUsage?.enabled && !pages?.length) throw configurationError('lighthouse/image-pages-required', '图片观察开启时必须配置 Lighthouse pages，不能跳过页面观察。');
  if (
    pages !== undefined &&
    (pages.length === 0 ||
      collect.url.some((url) => !pages.some((page) => page.url === url)) ||
      pages.some((page) => !collect.url.includes(page.url)))
  ) {
    throw configurationError(
      'lighthouse/page-contract-mismatch',
      'Lighthouse pages 必须逐项对应最终采集 URL，并配置预期 URL 与业务页面标识。',
    );
  }
  const temporaryRoot = resolveBuildArtifactOutput(root, {
    outputDirectory: 'reports/.lighthouse-config',
  }).outputDirectory;
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(path.join(temporaryRoot, 'run-'));
  const configPath = path.join(directory, 'lighthouserc.cjs');
  const observationsFile = path.join(directory, 'image-observations.json');
  const dispose = () => {
    for (const name of ['lighthouserc.cjs', 'page-guard.cjs', 'image-observations.json']) {
      const file = path.join(directory, name);
      if (existsSync(file)) unlinkSync(file);
    }
    rmdirSync(directory);
  };
  try {
    let guardedCollect = { ...collect, additive: false };
    if (pages) {
      const hook = collect.puppeteerScript
        ? path.resolve(root, collect.puppeteerScript)
        : null;
      if (hook && !existsSync(hook))
        throw configurationError(
          'lighthouse/missing-auth-script',
          'Lighthouse 登录初始化脚本不存在。',
        );
      const guard = path.join(directory, 'page-guard.cjs');
      // 由 LHCI 管理同一个 Chrome 生命周期；先运行用户初始化，再验证真实业务页面。
      const moduleUrl = new URL('./page-guard.js', import.meta.url).href;
      const argumentsJson = JSON.stringify({
        pages,
        hook,
        headers: collect.settings?.extraHeaders ?? null,
        imageUsage: config.imageUsage,
        observationsFile,
        settings: collect.settings ?? {},
        root,
      });
      writeFileSync(
        guard,
        `module.exports = async (browser, context) => (await import(${JSON.stringify(moduleUrl)})).validateLighthousePages(browser, context, ${argumentsJson});\n`,
      );
      guardedCollect = {
        ...guardedCollect,
        puppeteerScript: path.relative(root, guard).replaceAll('\\', '/'),
      };
    }
    const effective = {
      ci: { collect: guardedCollect, assert: merged.ci?.assert ?? {} },
    };
    writeFileSync(
      configPath,
      `module.exports = ${JSON.stringify(effective)};\n`,
    );
    return { configFile: configPath, effective, dispose, observationsFile };
  } catch (error) {
    dispose();
    throw toRepoGuardError(error, {
      code: 'lighthouse/prepare-config-failed',
      message: '无法准备 Lighthouse 执行配置。',
    });
  }
}
