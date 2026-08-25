import { createHash } from 'node:crypto';
import { executionError } from '../../core/error/repo-guard-error.js';

function contentHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function preserveMetadata(pipeline, metadataPolicy) {
  return metadataPolicy === 'preserve' && typeof pipeline.keepMetadata === 'function'
    ? pipeline.keepMetadata()
    : pipeline;
}

function animationKey(metadata) {
  return JSON.stringify({
    pages: metadata.pages ?? 1,
    pageHeight: metadata.pageHeight ?? metadata.height ?? null,
    delay: metadata.delay ?? [],
    loop: metadata.loop ?? null,
  });
}

export async function rasterMetadata(sharp, buffer, limits) {
  return await sharp(buffer, {
    animated: true,
    limitInputPixels: limits.maxPixels,
  }).metadata();
}

export async function normalizedPixelHash(sharp, buffer, limits) {
  const metadata = await rasterMetadata(sharp, buffer, limits);
  const frames = metadata.pages ?? 1;
  if (frames > limits.maxFrames) return { skipped: 'frames', metadata };
  const { data, info } = await sharp(buffer, {
    animated: true,
    limitInputPixels: limits.maxPixels,
  })
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    hash: contentHash(data),
    animationKey: animationKey(metadata),
    metadata,
    width: info.width,
    height: info.height,
  };
}

export async function createRasterCompressionCandidate({
  sharp,
  buffer,
  format,
  config,
  limits,
}) {
  const metadata = await rasterMetadata(sharp, buffer, limits);
  const frames = metadata.pages ?? 1;
  if (frames > limits.maxFrames) return { skipped: 'frames', metadata };
  let pipeline = sharp(buffer, {
    animated: true,
    limitInputPixels: limits.maxPixels,
  }).rotate();
  pipeline = preserveMetadata(pipeline, config.raster.metadata);
  if (format === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 });
  } else if (['jpeg', 'webp'].includes(format) && config.raster.allowLossy) {
    pipeline = format === 'jpeg'
      ? pipeline.jpeg({ quality: config.conversion.jpegQuality, mozjpeg: true })
      : pipeline.webp({ quality: config.conversion.jpegQuality, effort: config.conversion.effort });
  } else {
    return { skipped: 'unsupported-or-lossy', metadata };
  }
  const candidate = await pipeline.toBuffer();
  if (format === 'png') {
    const [before, after] = await Promise.all([
      normalizedPixelHash(sharp, buffer, limits),
      normalizedPixelHash(sharp, candidate, limits),
    ]);
    if (before.hash !== after.hash
      || before.width !== after.width
      || before.height !== after.height
      || before.animationKey !== after.animationKey) {
      throw executionError(
        'image-assets/png-pixel-verification-failed',
        'PNG 优化候选没有通过像素一致性校验',
      );
    }
  }
  return { candidate, metadata };
}

export async function createWebpCandidate({
  sharp,
  buffer,
  format,
  config,
  limits,
  metadataPolicy = 'preserve',
}) {
  const metadata = await rasterMetadata(sharp, buffer, limits);
  const frames = metadata.pages ?? 1;
  if (frames > limits.maxFrames) return { skipped: 'frames', metadata };
  const lossless = format === 'png' && config.pngMode === 'lossless';
  let pipeline = sharp(buffer, {
    animated: true,
    limitInputPixels: limits.maxPixels,
  }).rotate();
  pipeline = preserveMetadata(pipeline, metadataPolicy);
  const candidate = await pipeline.webp({
      lossless,
      quality: config.jpegQuality,
      alphaQuality: 100,
      effort: config.effort,
      exact: config.exactAlpha,
      smartSubsample: !lossless,
    })
    .toBuffer();
  if (lossless) {
    const [before, after] = await Promise.all([
      normalizedPixelHash(sharp, buffer, limits),
      normalizedPixelHash(sharp, candidate, limits),
    ]);
    if (before.hash !== after.hash
      || before.width !== after.width
      || before.height !== after.height
      || before.animationKey !== after.animationKey) {
      throw executionError(
        'image-assets/webp-pixel-verification-failed',
        '无损 WebP 候选没有通过像素一致性校验',
      );
    }
  }
  return { candidate, lossless, metadata };
}

function svgSafetyFacts(source) {
  const values = (pattern) => [...source.matchAll(pattern)].map((match) => match[1]).sort();
  return {
    viewBox: values(/\bviewBox\s*=\s*["']([^"']+)["']/gi),
    ids: values(/\bid\s*=\s*["']([^"']+)["']/gi),
    classes: values(/\bclass\s*=\s*["']([^"']+)["']/gi),
    aria: values(/\b((?:aria-[\w-]+|role)\s*=\s*["'][^"']*["'])/gi),
    references: values(/\b((?:href|xlink:href)\s*=\s*["'][^"']*["'])/gi),
    urlReferences: values(/url\(\s*#([^)\s]+)\s*\)/gi),
    titleCount: (source.match(/<title(?:\s|>)/gi) ?? []).length,
    descCount: (source.match(/<desc(?:\s|>)/gi) ?? []).length,
  };
}

export function createSvgCompressionCandidate(optimize, buffer) {
  const source = buffer.toString('utf8');
  const result = optimize(source, {
    multipass: true,
    plugins: [
      'removeDoctype',
      'removeXMLProcInst',
      'removeComments',
      'cleanupAttrs',
      'removeEmptyAttrs',
      'sortAttrs',
      'sortDefsChildren',
    ],
  });
  const before = svgSafetyFacts(source);
  const after = svgSafetyFacts(result.data);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw executionError(
      'image-assets/svg-safety-verification-failed',
      'SVGO 候选改变了受保护的 SVG 结构信息',
    );
  }
  return Buffer.from(result.data, 'utf8');
}
