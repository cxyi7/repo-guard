import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { runGit } from '../../git/execution.js';
import { resolveImageReference, selectImageReferenceSourcePaths } from '../../policies/unused-image-assets.js';
import { extractImageReferenceFacts } from '../../integrations/images/references.js';
import { assertImagePathHasNoSymbolicLink } from '../../integrations/images/project.js';

/** 只替换可精确定位的静态引用；动态声明、JSON 和 Markdown 留给人工核对。 */
export function planImageReferenceUpdates(root, conversions, config) {
  const paths = runGit(['ls-files', '-z'], { cwd: root }).stdout.split('\0').filter(Boolean);
  const sources = selectImageReferenceSourcePaths(paths, config);
  if (sources.length > config.limits.maxSourceFiles) throw configurationError('image-optimize/source-limit', '图片引用更新超过源码数量上限');
  const updates = [];
  let totalBytes = 0;
  for (const relative of sources) {
    const absolute = path.resolve(root, relative);
    assertImagePathHasNoSymbolicLink(root, absolute, relative);
    const size = lstatSync(absolute).size;
    if (size > config.limits.maxSourceBytes || totalBytes + size > config.limits.maxTotalSourceBytes) throw configurationError('image-optimize/source-limit', '图片引用更新超过源码读取上限');
    const before = readFileSync(absolute);
    totalBytes += before.length;
    if (before.length > config.limits.maxSourceBytes || totalBytes > config.limits.maxTotalSourceBytes) throw configurationError('image-optimize/source-limit', '图片引用更新超过源码读取上限');
    const source = before.toString('utf8');
    const facts = extractImageReferenceFacts(source, relative);
    const replacements = new Map();
    for (const ref of facts.references) {
      const resolved = resolveImageReference(ref.value, relative, config);
      const conversion = conversions.find((entry) => entry.inputRelative === resolved);
      if (!conversion || ['json-string', 'markdown-image', 'script-string', 'script-template'].includes(ref.kind)) continue;
      const start = source.indexOf(ref.value, ref.offset);
      if (start < ref.offset || start - ref.offset > 12) continue;
      const prefix = source.slice(ref.offset, start);
      if (ref.kind === 'script-resource' && !/^["'`]$/.test(prefix)) continue;
      if (ref.kind === 'markup-attribute' && !/^["'`]?\s*$/.test(prefix)) continue;
      if (ref.kind === 'style-url' && !/^url\(\s*["']?$/i.test(prefix)) continue;
      const next = ref.value.replace(/\.(?:png|jpe?g)(?=[?#]|$)/i, '.webp');
      if (next === ref.value) continue;
      replacements.set(start, { start, end: start + ref.value.length, value: next });
    }
    let after = source;
    for (const replacement of [...replacements.values()].sort((a, b) => b.start - a.start)) after = after.slice(0, replacement.start) + replacement.value + after.slice(replacement.end);
    if (after !== source) {
      extractImageReferenceFacts(after, relative);
      updates.push({ inputRelative: relative, outputRelative: relative, absolute, outputAbsolute: absolute, buffer: before, candidate: Buffer.from(after) });
    }
  }
  return updates;
}
