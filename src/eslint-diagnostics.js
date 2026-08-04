import path from 'node:path';

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/') || path.basename(filePath);
}

function repairAdvice(ruleId, message) {
  if (ruleId === 'no-undef') {
    return '请判断变量应该被声明、导入还是名称写错。';
  }
  if (ruleId === 'no-unused-vars') {
    return '请判断变量应该被实际使用、删除，还是名称写错。';
  }
  if (!ruleId || /^Parsing error:/i.test(message)) {
    return '请判断是代码语法错误还是 ESLint 解析配置不匹配，并修复根因。';
  }
  if (ruleId.startsWith('import/')) {
    return '请检查导入路径、目标文件以及相关依赖，并修复根因。';
  }
  return '请结合该规则和项目上下文修复根因。';
}

function collectBlockingMessages(results, maxWarnings) {
  const warningCount = results.reduce(
    (total, result) => total + result.warningCount,
    0,
  );
  const warningsAreBlocking = warningCount > maxWarnings;

  return results.flatMap((result) => result.messages
    .filter((message) => message.severity === 2 || (
      warningsAreBlocking && message.severity === 1
    ))
    .map((message) => ({
      filePath: result.filePath,
      message,
    })));
}

export function buildEslintAiRepairInstructions({
  root,
  results,
  maxWarnings,
}) {
  const problems = collectBlockingMessages(results, maxWarnings);
  const sections = problems.map(({ filePath, message }, index) => {
    const ruleId = message.ruleId || 'parsing-error';
    const errorMessage = normalizeText(message.message);
    const file = relativePath(root, filePath);
    const line = message.line ?? '?';
    const column = message.column ?? '?';

    return [
      `${index + 1}. 请修复 ${file} 第 ${line} 行第 ${column} 列的 ESLint 问题。`,
      `   规则：${ruleId}`,
      `   错误：${errorMessage}`,
      `   ${repairAdvice(message.ruleId, errorMessage)}`,
      '   不要关闭 ESLint 规则，不要修改无关文件。',
      '   修复后重新执行暂存和提交。',
    ].join('\n');
  });

  return [
    '以下 ESLint 问题可按编号分别复制给 AI 进行修复：',
    '',
    ...sections.flatMap((section, index) => (
      index === sections.length - 1 ? [section] : [section, '']
    )),
  ].join('\n');
}
