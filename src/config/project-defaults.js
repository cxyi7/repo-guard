import { CONFIG_FILE } from './validation-primitives.js';

export const DEFAULT_REPOSITORY_RULES = Object.freeze([
  Object.freeze({
    pattern: CONFIG_FILE,
    category: '团队工程规范',
    level: 'notify',
  }),
]);

/** 预设只设置各检查的默认选项，不再生成另一份运行配置。 */
export function projectCheckDefaults(project) {
  if (project?.role !== 'backend') return {};
  return {
    eslint: { pattern: '*.{js,mjs,cjs,ts,mts,cts}' },
    prettier: {
      pattern: '*.{js,mjs,cjs,ts,mts,cts,json,json5,jsonc,md,yml,yaml}',
    },
    maxFileLines: {
      rules: [{ pattern: '**/*.{js,mjs,cjs,ts,mts,cts}', maxLines: 1000 }],
    },
    filePlacement: {
      rules: [
        {
          name: '测试文件',
          patterns: ['**/*.{spec,test}.{js,mjs,cjs,ts,mts,cts}'],
          allowedPatterns: [
            'test/**',
            'tests/**',
            '**/__tests__/**',
            'src/**/*.{spec,test}.{js,mjs,cjs,ts,mts,cts}',
          ],
          exceptions: [],
          suggestedDirectory: 'test',
        },
      ],
    },
    unitTest: {
      sourcePatterns: ['src/**/*.{js,mjs,cjs,ts,mts,cts}'],
      exclusions: [
        '**/*.d.ts',
        '**/*.d.mts',
        '**/*.d.cts',
        '**/*.{spec,test}.*',
        '**/__tests__/**',
        'src/generated/**',
      ],
    },
  };
}
