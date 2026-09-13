export const IMAGE_GOVERNANCE_DEFAULTS = {
  budgets: { enabled: true, action: 'report', maxBytes: 1048576, maxWidth: 4096, maxHeight: 4096, rules: [] },
  formats: { enabled: true, action: 'report', discouraged: ['bmp', 'tif', 'tiff'] },
  metadata: { enabled: true, action: 'report' },
  animation: { enabled: true, action: 'report', maxBytes: 1048576, maxFrames: 200, maxDurationMs: 30000 },
  avif: { enabled: false, action: 'report', quality: 60, effort: 4, minSavingsBytes: 4096, minSavingsPercent: 20 },
};
