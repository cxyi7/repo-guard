import { IMAGE_GOVERNANCE_DEFAULTS } from './frontend-image-defaults.js';

/** 图片用途由明确路径规则配置，接入时可按项目目录整体替换。 */
export function frontendImagePresets(project) {
  if (project?.role !== 'frontend' || project.stack !== 'node') return {};
  const governance = structuredClone(IMAGE_GOVERNANCE_DEFAULTS);
  governance.budgets.rules = [
    { name: '图标', patterns: ['**/icons/**'], maxBytes: 20480 },
    { name: '头像', patterns: ['**/avatars/**'], maxBytes: 51200 },
    { name: '缩略图', patterns: ['**/thumbnails/**'], maxBytes: 102400 },
    { name: '内容图片', patterns: ['**/content/**'], maxBytes: 307200 },
    { name: '横幅', patterns: ['**/banners/**'], maxBytes: 512000 },
  ];
  return {
    imageAssets: {
      enabled: true, enforcement: 'allFiles', naming: { convention: 'kebab-case' },
      duplicates: { pixel: 'report' }, compression: { conversion: { enabled: true } },
      limits: { maxFrames: 1000 },
      governance,
    },
    unusedImageAssets: { enabled: true, action: 'report', referenceIntegrity: true },
  };
}
