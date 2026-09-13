import micromatch from 'micromatch';

export const IMAGE_GOVERNANCE_RULES = ['assets/image-budget', 'assets/image-format', 'assets/image-metadata', 'assets/image-animation', 'assets/avif-opportunity'];
export function imageGovernanceNeedsMetadata(config) {
  return Boolean(config && ['budgets', 'metadata', 'animation', 'avif'].some((key) => config[key]?.enabled));
}

/** 根据明确配置评估资源，不根据文件名称推断用途。 */
export function inspectImageGovernance(filePath, bytes, format, metadata, config) {
  if (!config) return [];
  const findings = [];
  const add = (rule, action, message) => findings.push({ rule, issue: rule.replace('assets/', 'image-assets/'), path: filePath,
    line: 1, column: 1, severity: action === 'error' ? 'error' : 'warning', message,
    remediation: '按图片用途优化资源；如业务确有需要，在项目配置中调整对应范围的预算并保留评审依据。' });
  const budget = config.budgets;
  if (budget.enabled) {
    const selected = budget.rules.find((rule) => micromatch.isMatch(filePath, rule.patterns, { dot: true }));
    const limits = { ...budget, ...selected };
    const width = metadata?.width;
    const height = metadata?.pageHeight ?? metadata?.height;
    if (bytes > limits.maxBytes || width > limits.maxWidth || height > limits.maxHeight) {
      add('assets/image-budget', budget.action, `${filePath} 超过${selected?.name ?? '未分类图片'}预算：${bytes} 字节，${width ?? '未知'} × ${height ?? '未知'} 像素；上限 ${limits.maxBytes} 字节、${limits.maxWidth} × ${limits.maxHeight} 像素`);
    }
  }
  const normalizedFormat = (value) => ({ jpg: 'jpeg', tif: 'tiff' })[value] ?? value;
  if (config.formats.enabled && config.formats.discouraged.some((value) => normalizedFormat(value) === normalizedFormat(format))) add('assets/image-format', config.formats.action, `${filePath} 使用不推荐的网页图片格式 ${format}`);
  if (config.metadata.enabled && (metadata?.exif || metadata?.iptc || metadata?.xmp)) add('assets/image-metadata', config.metadata.action, `${filePath} 含有 EXIF/IPTC/XMP 元数据，请评估移除拍摄信息；保留颜色配置并正确处理方向`);
  const frames = metadata?.pages ?? 1;
  const duration = (metadata?.delay ?? []).reduce((total, delay) => total + delay, 0);
  if (config.animation.enabled && frames > 1 && (bytes > config.animation.maxBytes || frames > config.animation.maxFrames || duration > config.animation.maxDurationMs)) {
    add('assets/image-animation', config.animation.action, `${filePath} 动画超过预算：${bytes} 字节、${frames} 帧、单轮 ${duration} 毫秒`);
  }
  return findings;
}
