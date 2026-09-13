export const FRONTEND_TOOL_RANGES = {
  knip: '>=6.31.0 <7',
  vue: '>=3.5 <4',
  eslint: '>=9.19 <10',
  '@eslint/js': '>=9.19 <10',
  globals: '>=16 <17',
  'eslint-config-prettier': '>=10 <11',
  'eslint-plugin-vue': '>=10 <11',
  'typescript-eslint': '>=8 <9',
  typescript: '>=5.8 <6',
  'vue-tsc': '>=3 <4',
  prettier: '>=3 <4',
  stylelint: '>=16 <17',
  'stylelint-config-standard': '>=38 <39',
  'stylelint-order': '>=6 <7',
  'postcss-html': '>=2 <3',
  'stylelint-config-standard-scss': '>=14 <15',
  'dependency-cruiser': '>=16 <19',
  '@lhci/cli': '>=0.13 <0.16',
  'rollup-plugin-visualizer': '>=6 <8',
  puppeteer: '>=24 <25',
  vitest: '>=2 <5',
  '@vitest/coverage-v8': '>=2 <5',
  '@stryker-mutator/core': '>=10 <11',
  '@stryker-mutator/vitest-runner': '>=10 <11',
};

/** 能力要求供接入 Skill 读取；版本组合仍需按项目引擎和 peerDependencies 核对。 */
export function getFrontendToolRequirements(config) {
  const requirements = [];
  const add = (name, reason) =>
    requirements.push({
      name,
      reason,
      versionRange: FRONTEND_TOOL_RANGES[name] ?? null,
    });
  if (config.checks.deadCode.enabled) { add('knip', '执行全项目未使用代码检查'); add('typescript', '解析 Knip 类型项目'); add('@types/node', '满足 Knip 的 Node 类型对等依赖'); }
  if (config.checks.imageAssets.enabled) {
    add('sharp', '分析位图、动画与转换收益；须支持 keepIccProfile');
    add('svgo', '在保护 SVG 结构的前提下分析压缩收益');
  }
  if (config.checks.architecture.enabled)
    add('dependency-cruiser', '检查架构依赖与业务分层');
  if (config.checks.build.enabled && config.checks.build.bundleAnalysis?.enabled)
    add('rollup-plugin-visualizer', '使用同次生产构建生成包体积与模块依赖报告');
  if (config.checks.lighthouse.enabled) {
    add('@lhci/cli', '采集与验证页面性能');
    if (config.checks.lighthouse.pages)
      add('puppeteer', '验证目标业务页面并复用项目 Chrome 环境');
  }
  if (config.checks.unitTest.enabled) {
    add('vitest', '运行公共方法测试');
    if (config.checks.coverage.enabled)
      add('@vitest/coverage-v8', '采集覆盖率，版本必须与 Vitest 完全一致');
  }
  if (config.checks.mutationTest.enabled) {
    add('@stryker-mutator/core', '验证公共方法测试能否发现变异');
    add(
      '@stryker-mutator/vitest-runner',
      '连接 Vitest，版本必须与 Stryker core 一致并满足其 Vitest 对等依赖',
    );
  }
  if (config.checks.eslint.enabled) {
    add('eslint', '执行代码检查');
    if (config.checks.eslint.options || config.checks.eslint.preset) {
      add('@eslint/js', '解析 ESLint 推荐规则预设');
      if (config.checks.eslint.options) {
        for (const name of ['globals', 'eslint-config-prettier']) add(name, '解析内联 ESLint 预设');
      }
      if (config.project.preset.startsWith('vue-'))
        add('eslint-plugin-vue', '检查 Vue 组件');
      if (config.project.preset.endsWith('-typescript')) {
        add('typescript-eslint', '执行 TypeScript 和类型感知规则');
        add('typescript', '读取类型项目');
      }
    }
  }
  if (config.checks.prettier.enabled) add('prettier', '执行格式检查');
  if (config.checks.stylelint.enabled) {
    add('stylelint', '执行样式检查');
    if (
      config.checks.stylelint.governance?.enabled &&
      config.project.preset.startsWith('vue-')
    )
      add('vue', '使用消费项目 Vue 编译器解析样式块');
    const collect = (options) => {
      for (const name of [
        ...(options?.extends ?? []),
        ...(options?.plugins ?? []),
        ...(options?.customSyntax ? [options.customSyntax] : []),
      ])
        add(name, '解析样式预设与语言配置');
      for (const override of options?.overrides ?? []) collect(override);
    };
    collect(config.checks.stylelint.options);
  }
  if (config.checks.typeCheck.enabled && config.checks.typeCheck.options) {
    add('typescript', '执行类型检查');
    if (config.checks.typeCheck.options.tool === 'vue-tsc')
      add('vue-tsc', '检查 Vue 模板和脚本类型');
  }
  return [
    ...new Map(
      requirements.map((requirement) => [requirement.name, requirement]),
    ).values(),
  ];
}
