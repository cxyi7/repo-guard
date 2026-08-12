import path from 'node:path';

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/') || path.basename(filePath);
}

function repairAdvice(rule) {
  const normalizedRule = rule.replace(/^style\//, '');
  if (normalizedRule === 'property-no-unknown') {
    return '请检查属性拼写，并确认它是标准属性或项目允许的自定义属性。';
  }
  if (normalizedRule === 'declaration-block-no-duplicate-properties') {
    return '请删除无效的重复属性，或确认级联覆盖是否应改为更明确的写法。';
  }
  if (normalizedRule === 'selector-pseudo-class-no-unknown') {
    return '请检查伪类名称和当前样式语法是否正确。';
  }
  if (normalizedRule === 'selector-max-compound-selectors') {
    return '请拆分过长选择器，优先给目标元素增加语义化 class，并减少对 DOM 层级的耦合。';
  }
  if (normalizedRule === 'max-nesting-depth') {
    return '请降低样式嵌套深度，提取同级规则或语义化 class，保持选择器作用域清晰。';
  }
  if (normalizedRule === 'selector-max-specificity') {
    return '请降低选择器权重：减少层级与状态叠加，优先使用扁平、语义明确的 class；不要通过增加更高权重选择器覆盖。';
  }
  if (normalizedRule === 'selector-max-id') {
    return '请把 ID 选择器替换为语义化 class、组件状态 class 或 data 属性，并同步必要的模板与测试定位。';
  }
  if (normalizedRule === 'declaration-no-important') {
    return '请移除 !important，并通过正确的组件作用域、样式顺序或更清晰的 class 解决级联关系。';
  }
  if (normalizedRule === 'no-unexpected-global-style') {
    return 'Vue 组件样式请使用 scoped 或 module；共享全局样式请移入 allowedGlobalStylePatterns 明确允许的目录，局部样式不要使用 :global() 逃逸作用域。';
  }
  if (normalizedRule === 'invalid-option') {
    return '请修复项目 Stylelint 配置中的无效规则选项，并保留原有规则意图。';
  }
  if (!normalizedRule || normalizedRule === 'CssSyntaxError') {
    return '请判断是样式语法错误还是项目 Stylelint 解析配置不匹配，并修复根因。';
  }
  return '请结合该规则、样式语言和项目上下文修复根因。';
}

function verificationAdvice(rule) {
  const normalizedRule = rule.replace(/^style\//, '');
  if (new Set([
    'selector-max-specificity',
    'selector-max-id',
    'declaration-no-important',
    'no-unexpected-global-style',
  ]).has(normalizedRule)) {
    return '修复后重新暂存文件，运行 repo-guard style-governance，并执行受影响组件的测试和生产构建。';
  }
  if (new Set([
    'selector-max-compound-selectors',
    'max-nesting-depth',
  ]).has(normalizedRule)) {
    return '修复后重新暂存文件，运行 repo-guard style-complexity，并执行受影响组件的测试和生产构建。';
  }
  return '修复后运行项目 Stylelint 命令，重新暂存文件并提交；同时执行受影响组件的测试和生产构建。';
}

function collectBlockingWarnings(results, maxWarnings) {
  const warningCount = results.reduce(
    (total, result) => total + (result.warnings || [])
      .filter(({ severity }) => severity === 'warning').length,
    0,
  );
  const warningsAreBlocking = warningCount > maxWarnings;

  return results.flatMap((result) => [
    ...(result.warnings || [])
      .filter((warning) => warning.severity === 'error' || (
        warningsAreBlocking && warning.severity === 'warning'
      ))
      .map((warning) => ({
        filePath: result.source,
        warning,
      })),
    ...(result.invalidOptionWarnings || []).map((warning) => ({
      filePath: result.source,
      warning: {
        ...warning,
        rule: 'invalid-option',
        severity: 'error',
        text: warning.text || warning.message || 'Invalid Stylelint rule option',
      },
    })),
  ]);
}

export function buildStylelintAiRepairInstructions({
  root,
  results,
  maxWarnings,
}) {
  const problems = collectBlockingWarnings(results, maxWarnings);
  const sections = problems.map(({ filePath, warning }, index) => {
    const rule = warning.rule || 'CssSyntaxError';
    const message = normalizeText(warning.text);
    const file = relativePath(root, filePath);
    const line = warning.line ?? '?';
    const column = warning.column ?? '?';

    return [
      `${index + 1}. 请修复 ${file} 第 ${line} 行第 ${column} 列的 Stylelint 问题。`,
      `   规则：${rule}`,
      `   错误：${message}`,
      `   ${repairAdvice(rule)}`,
      '   修改范围：只修改解决该样式问题所需的组件模板、样式和相关测试，不处理无关文件。',
      '   禁止绕过：不得关闭或降级规则，不得新增 stylelint-disable、扩大 ignore/全局样式白名单，AI 也不得新增、延期或修改结构化例外。',
      `   验证要求：${verificationAdvice(rule)}`,
    ].join('\n');
  });

  return [
    '以下 Stylelint 问题可按编号分别复制给 AI 进行修复：',
    '',
    ...sections.flatMap((section, index) => (
      index === sections.length - 1 ? [section] : [section, '']
    )),
  ].join('\n');
}
