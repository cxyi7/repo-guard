import {
  configValidationError,
  normalizeRelativePattern,
} from './validation-primitives.js';
import { toolOptionShapeValid } from './tool-options-schema.js';

const boolean = { type: 'boolean' };
const string = { type: 'string', minLength: 1 };
export const PAGE_IMAGES_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    enabled: boolean, action: { enum: ['report', 'error'] }, failedRequests: boolean,
    maxDimensionRatio: { type: 'integer', minimum: 1, maximum: 10 },
    components: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['selector', 'sourceAttribute'], properties: { selector: string, sourceAttribute: string, loadingAttribute: string } } },
    maxTransferBytes: { type: 'integer', minimum: 1 },
    auditIds: { type: 'array', items: string },
    routes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['url', 'maxTransferBytes'], properties: { url: { ...string, pattern: '^https?://' }, maxTransferBytes: { type: 'integer', minimum: 1 } } } },
  },
};
export const BUILD_OPTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    minify: { enum: [true, false, 'esbuild', 'terser'] },
    cssMinify: { enum: [true, false, 'esbuild', 'lightningcss'] },
    cssCodeSplit: boolean,
    sourcemap: { enum: [true, false, 'inline', 'hidden'] },
    assetsInlineLimit: { type: 'integer', minimum: 0 },
  },
};
export const BUNDLE_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: boolean,
    adapter: { enum: ['rollup-visualizer'] },
    reportsDirectory: string,
    formats: { type: 'array', minItems: 1, items: { enum: ['html', 'json'] } },
    template: { enum: ['treemap', 'network', 'sunburst'] },
    gzipSize: boolean,
    brotliSize: boolean,
    open: boolean,
  },
};
export const LIGHTHOUSE_OPTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ci'],
  properties: {
    ci: {
      type: 'object',
      additionalProperties: false,
      properties: {
        collect: { type: 'object' },
        assert: { type: 'object' },
      },
    },
  },
};
export const LIGHTHOUSE_PAGES_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'expectedUrl', 'selector'],
    properties: { url: string, expectedUrl: string, selector: string },
  },
};

function jsonValue(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value))
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return (
    value &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.entries(value).every(
      ([key, item]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        jsonValue(item),
    )
  );
}

function validate(value, schema, label) {
  if (!jsonValue(value) || !toolOptionShapeValid(value, schema))
    throw configValidationError(`${label} 包含无效字段或选项值`);
  return structuredClone(value);
}

export function validateBuildOptions(value, configPath) {
  return value === undefined
    ? {}
    : {
        options: validate(
          value,
          BUILD_OPTIONS_SCHEMA,
          `${configPath} checks.build.options`,
        ),
      };
}

export function validateBundleAnalysis(value, configPath) {
  if (value === undefined) return {};
  const options = validate(
    value,
    BUNDLE_ANALYSIS_SCHEMA,
    `${configPath} checks.build.bundleAnalysis`,
  );
  const reportsDirectory = normalizeRelativePattern(
    options.reportsDirectory ?? 'reports/bundle',
    '包体积报告目录',
  );
  if (
    !reportsDirectory.startsWith('reports/') ||
    /[*?{}[\]]/.test(reportsDirectory)
  )
    throw configValidationError('包体积报告必须使用 reports/ 下的明确目录');
  const formats = options.formats ?? ['html', 'json'];
  if (new Set(formats).size !== formats.length || !formats.includes('json'))
    throw configValidationError('包体积报告必须包含 JSON，格式不能重复');
  return {
    bundleAnalysis: {
      enabled: false,
      adapter: 'rollup-visualizer',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
      ...options,
      reportsDirectory,
      formats,
    },
  };
}

export function validateLighthouseOptions(value, configPath) {
  if (value.prePush !== undefined && typeof value.prePush !== 'boolean')
    throw configValidationError('Lighthouse prePush 必须是布尔值');
  const options =
    value.options === undefined
      ? {}
      : {
          options: validate(
            value.options,
            LIGHTHOUSE_OPTIONS_SCHEMA,
            `${configPath} checks.lighthouse.options`,
          ),
        };
  if (value.prePush !== undefined) options.prePush = value.prePush;
  if (value.imageUsage !== undefined) options.imageUsage = {
    enabled: true, action: 'report', failedRequests: true, maxTransferBytes: 1572864,
    components: [], maxDimensionRatio: 2,
    auditIds: ['unsized-images', 'offscreen-images', 'uses-responsive-images', 'modern-image-formats', 'uses-optimized-images', 'lcp-lazy-loaded'], routes: [],
    ...validate(value.imageUsage, PAGE_IMAGES_SCHEMA, `${configPath} checks.lighthouse.imageUsage`),
  };
  if (options.imageUsage) {
    const seen = new Set();
    for (const route of options.imageUsage.routes) {
      let url;
      try { url = new URL(route.url); } catch { throw configValidationError('Lighthouse 图片路由预算必须使用完整 HTTP URL'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) throw configValidationError('Lighthouse 图片路由 URL 不得重复或包含凭据');
      seen.add(url.href); route.url = url.href;
      if (value.pages?.length && !value.pages.some((page) => { try { return new URL(page.url).href === url.href; } catch { return false; } })) throw configValidationError('Lighthouse 图片路由预算必须对应已配置页面');
    }
  }
  if (value.pages === undefined) return options;
  const pages = validate(
    value.pages,
    LIGHTHOUSE_PAGES_SCHEMA,
    `${configPath} checks.lighthouse.pages`,
  );
  for (const page of pages)
    for (const field of ['url', 'expectedUrl']) {
      let url;
      try {
        url = new URL(page[field]);
      } catch {
        throw configValidationError(`Lighthouse ${field} 必须是完整 HTTP URL`);
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw configValidationError(
          `Lighthouse ${field} 不得包含凭据，且必须使用 HTTP`,
        );
    }
  if (new Set(pages.map(({ url }) => url)).size !== pages.length)
    throw configValidationError('Lighthouse 页面 URL 不得重复');
  return { ...options, pages };
}
