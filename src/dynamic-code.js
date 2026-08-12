import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findStructuredException } from './exception-registry.js';
import { collectProjectFiles } from './file-placement.js';
import { findDynamicCodeAstReferences } from './dynamic-code-ast.js';
import { sourceLocation } from './vue-template-parser.js';

export const NO_EVAL_RULE = 'security/no-eval';
export const NO_FUNCTION_CONSTRUCTOR_RULE = 'security/no-function-constructor';

const SCRIPT_EXTENSIONS = new Set([
  '.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx',
]);
function findingFor(source, token, relativePath, kind) {
  const rule = kind === 'eval' ? NO_EVAL_RULE : NO_FUNCTION_CONSTRUCTOR_RULE;
  return {
    ...sourceLocation(source, token.offset),
    kind,
    offset: token.offset,
    path: relativePath,
    rule,
  };
}

function vueScriptRanges(source) {
  const ranges = [];
  const opening = /<script\b([^>]*)>/gi;
  let match;
  while ((match = opening.exec(source))) {
    const start = match.index + match[0].length;
    const closing = /<\/script\s*>/gi;
    closing.lastIndex = start;
    const endMatch = closing.exec(source);
    const end = endMatch ? endMatch.index : source.length;
    const languageMatch = /\blang\s*=\s*(["'])([^"']+)\1/i.exec(match[1]);
    ranges.push({
      start,
      end,
      language: languageMatch?.[2].toLowerCase() ?? '',
    });
    opening.lastIndex = endMatch ? closing.lastIndex : source.length;
  }
  return ranges;
}

export function findDynamicCodeExecution(source, relativePath = 'source.js') {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.vue') {
    return vueScriptRanges(source).flatMap(({ start, end, language = '' }) => (
      findDynamicCodeAstReferences(
        source.slice(start, end),
        relativePath,
        language,
      ).map(({ kind, offset }) => findingFor(
        source,
        { offset: start + offset },
        relativePath,
        kind,
      ))
    ));
  }
  if (!SCRIPT_EXTENSIONS.has(extension)) return [];
  return findDynamicCodeAstReferences(source, relativePath)
    .map(({ kind, offset }) => findingFor(
      source,
      { offset },
      relativePath,
      kind,
    ));
}

function normalizeFiles(root, files) {
  return files.map((file) => {
    if (typeof file !== 'string') return file;
    const absolute = path.resolve(root, file);
    return {
      absolute,
      relative: path.relative(root, absolute).replace(/\\/g, '/'),
    };
  });
}

export function inspectDynamicCode({ root, files, exceptions }) {
  const approved = [];
  const violations = [];
  let checkedCount = 0;
  for (const file of normalizeFiles(root, files)) {
    const extension = path.extname(file.relative).toLowerCase();
    if (extension !== '.vue' && !SCRIPT_EXTENSIONS.has(extension)) continue;
    checkedCount += 1;
    const source = readFileSync(file.absolute, 'utf8');
    for (const finding of findDynamicCodeExecution(source, file.relative)) {
      const exception = findStructuredException(exceptions, finding);
      if (exception) approved.push({ ...finding, exception });
      else violations.push(finding);
    }
  }
  return { approved, checkedCount, violations };
}

export function buildDynamicCodeAiInstructions(violations) {
  const lines = ['动态代码执行安全门禁失败，可将以下指令按编号分别交给 AI 修复：'];
  violations.forEach((violation, index) => {
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

function reportApproved(approved) {
  for (const finding of approved) {
    console.warn(
      `Dynamic code approved exception: ${finding.path}:${finding.line}:${finding.column} `
      + `${finding.rule} (${finding.exception.id}, expires=${finding.exception.expiresOn}).`,
    );
  }
}

export function runDynamicCodeFiles({ root, files, exceptions }) {
  const result = inspectDynamicCode({ root, files, exceptions });
  reportApproved(result.approved);
  if (result.violations.length > 0) {
    console.error(buildDynamicCodeAiInstructions(result.violations));
    return 1;
  }
  console.log(
    `Dynamic code gate passed: ${result.checkedCount} file(s), `
    + `${result.approved.length} approved exception(s).`,
  );
  return 0;
}

export function runDynamicCodeProject({ root, exceptions }) {
  return runDynamicCodeFiles({ root, files: collectProjectFiles(root), exceptions });
}
