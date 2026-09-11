import { CONFIG_FILE } from './validation-primitives.js';
import { NODE_ONLY_PROJECT_CHECKS } from './project-feature-paths.js';
import { JAVA_SOURCE_DEFAULTS } from './java-source.js';
import { JAVA_ENGINEERING_DEFAULTS } from './java-engineering.js';
import { JAVA_PATH_NAMING_DEFAULTS } from './java-path-naming.js';
import { JAVA_SPOTBUGS_DEFAULTS } from './java-spotbugs.js';
import { JAVA_MUTATION_DEFAULTS } from './java-mutation.js';

export const DEFAULT_REPOSITORY_RULES = Object.freeze([
  Object.freeze({
    pattern: CONFIG_FILE,
    category: '团队工程规范',
    level: 'notify',
  }),
]);

/** 预设只设置各检查的默认选项，不再生成另一份运行配置。 */
export function projectCheckDefaults(project) {
  const javaChecks = {
    ...JAVA_SOURCE_DEFAULTS, ...JAVA_ENGINEERING_DEFAULTS,
    ...JAVA_PATH_NAMING_DEFAULTS, ...JAVA_SPOTBUGS_DEFAULTS, ...JAVA_MUTATION_DEFAULTS,
  };
  if (project?.stack === 'java') return {
    ...javaChecks,
    ...Object.fromEntries(NODE_ONLY_PROJECT_CHECKS.map((feature) => [feature, { enabled: false }])),
    maxFileLines: { enabled: false, rules: [{ pattern: '**/*.java', maxLines: 1000 }] },
    filePlacement: {
      enabled: false,
      rules: [{
        name: 'Java 源文件', patterns: ['**/*.java'],
        allowedPatterns: ['src/main/java/**', 'src/test/java/**', '**/src/main/java/**', '**/src/test/java/**'],
        exceptions: [], suggestedDirectory: 'src/main/java',
      }],
    },
    pathNaming: { enabled: false },
    imageAssets: { enabled: false },
  };
  if (project?.role !== 'backend') return javaChecks;
  return {
    ...javaChecks,
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
