import { NO_EVAL_RULE } from './dynamic-code-rules.js';

function findingDetails(finding) {
  if (finding.rule) {
    return {
      kind: finding.kind,
      rule: finding.rule,
      path: finding.path,
      line: finding.line,
      column: finding.column,
    };
  }
  return {
    kind: finding.ruleId === NO_EVAL_RULE ? 'eval' : 'function-constructor',
    rule: finding.ruleId,
    path: finding.location.path,
    line: finding.location.line,
    column: finding.location.column,
  };
}

export function buildDynamicCodeAiInstructions(violations) {
  const lines = ['动态代码执行安全门禁失败，可将以下指令按编号分别交给 AI 修复：'];
  violations.forEach((finding, index) => {
    const violation = findingDetails(finding);
    const name = violation.kind === 'eval' ? 'eval' : 'Function 构造器';
    const replacement = violation.kind === 'eval'
      ? '将输入解析为明确的数据格式（优先 JSON.parse），再通过白名单分支、映射表或普通函数处理；如果是在访问对象属性，请使用经过校验的键。'
      : '改用预先声明并显式导入的普通函数；需要按名称选择行为时使用白名单函数映射，不要从字符串生成函数体。';
    lines.push(
      '',
      `${index + 1}. 请移除 ${violation.path} 第 ${violation.line} 行第 ${violation.column} 列的 ${name} 动态执行。`,
      `   规则：${violation.rule}`,
      '   风险原因：运行时解释字符串会绕过静态分析和模块边界，使注入数据能够执行任意脚本，并破坏 CSP、类型检查、压缩优化和审计可追踪性。',
      `   修复要求：${replacement}`,
      '   行为要求：保持现有合法输入、错误处理和调用方接口；对外部输入增加明确的格式校验与允许值边界，并补充成功、拒绝和异常路径测试。',
      '   禁止绕过：不得改用别名、间接调用、window/globalThis、可选链、方括号属性或其他等价动态执行方式；不得关闭门禁、改扩展名，AI 也不得新增、延期或修改结构化例外。',
      '   验证要求：运行 repo-guard dynamic-code，并运行受影响代码已有的 lint、类型检查、测试和生产构建。',
    );
  });
  lines.push('', `共 ${violations.length} 处未经批准的动态代码执行，提交已停止。`);
  return lines.join('\n');
}

export function renderDynamicCodeResult(result) {
  const lines = result.diagnostics.map((diagnostic) => ({
    stream: diagnostic.level === 'warn' || diagnostic.level === 'error'
      ? 'stderr'
      : 'stdout',
    message: diagnostic.message,
  }));
  if (result.status === 'violation') {
    lines.push({
      stream: 'stderr',
      message: buildDynamicCodeAiInstructions(result.findings),
    });
  }
  return lines;
}
