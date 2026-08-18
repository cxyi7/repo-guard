import { readFileSync } from 'node:fs';
import path from 'node:path';
import { toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { defineGate } from '../../core/capability/gate-definition.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { findStructuredException } from '../../policies/exception-registry.js';
import { sourceLocation } from '../../integrations/vue/template-parser.js';
import { findDynamicCodeAstReferences } from './dynamic-code-ast.js';
import {
  NO_EVAL_RULE,
  NO_FUNCTION_CONSTRUCTOR_RULE,
} from './dynamic-code-rules.js';

export const DYNAMIC_CODE_GATE_ID = 'security.dynamic-code';
export { NO_EVAL_RULE, NO_FUNCTION_CONSTRUCTOR_RULE };

const SCRIPT_EXTENSIONS = new Set([
  '.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx',
]);

function legacyFindingFor(source, token, relativePath, kind) {
  return {
    ...sourceLocation(source, token.offset),
    kind,
    offset: token.offset,
    path: relativePath,
    rule: kind === 'eval' ? NO_EVAL_RULE : NO_FUNCTION_CONSTRUCTOR_RULE,
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
      findDynamicCodeAstReferences(source.slice(start, end), relativePath, language)
        .map(({ kind, offset }) => legacyFindingFor(
          source,
          { offset: start + offset },
          relativePath,
          kind,
        ))
    ));
  }
  if (!SCRIPT_EXTENSIONS.has(extension)) return [];
  return findDynamicCodeAstReferences(source, relativePath)
    .map(({ kind, offset }) => legacyFindingFor(source, { offset }, relativePath, kind));
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

function immutableFileScope(files) {
  return Object.freeze(files.map((file) => (
    typeof file === 'string' ? file : Object.freeze({ ...file })
  )));
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

function remediationFor(finding) {
  return finding.kind === 'eval'
    ? '将输入解析为明确的数据格式（优先 JSON.parse），再通过白名单分支、映射表或普通函数处理；如果是在访问对象属性，请使用经过校验的键。'
    : '改用预先声明并显式导入的普通函数；需要按名称选择行为时使用白名单函数映射，不要从字符串生成函数体。';
}

function normalizedFinding(finding) {
  const name = finding.kind === 'eval' ? 'eval' : 'Function 构造器';
  return {
    ruleId: finding.rule,
    severity: 'error',
    message: `${name} 会动态执行运行时文本`,
    location: {
      path: finding.path,
      line: finding.line,
      column: finding.column,
    },
    evidence: '运行时解释字符串会绕过静态分析和模块边界，使注入数据能够执行任意脚本，并破坏 CSP、类型检查、压缩优化和审计可追踪性。',
    remediation: remediationFor(finding),
  };
}

export function inspectDynamicCodeSetup({ config }) {
  if (!config || !Number.isInteger(config.version)) {
    return { status: 'invalid', summary: '配置不可用' };
  }
  if (!dynamicCodeGate.configVersions.includes(config.version)) {
    return { status: 'unsupported', summary: `不支持配置版本 ${config.version}` };
  }
  return {
    status: 'ready',
    summary: '动态代码暂存门禁'
      + `（硬性要求，规则=${dynamicCodeGate.rules.join('+')}）`,
    rules: dynamicCodeGate.rules,
  };
}

export function buildDynamicCodeGateResult({ root, files, exceptions }) {
  const startedAt = Date.now();
  try {
    const inspection = inspectDynamicCode({ root, files, exceptions });
    const findings = inspection.violations.map(normalizedFinding);
    const diagnostics = inspection.approved.map((finding) => ({
      level: 'warn',
      message: `动态代码已批准例外：${finding.path}:${finding.line}:`
        + `${finding.column} ${finding.rule} (${finding.exception.id}, `
        + `到期日期=${finding.exception.expiresOn}）。`,
    }));
    if (findings.length === 0) {
      diagnostics.push({
        level: 'log',
        message: `动态代码门禁已通过：检查 ${inspection.checkedCount} 个文件，`
          + `${inspection.approved.length} 条已批准例外。`,
      });
    }
    return createGateResult({
      gateId: DYNAMIC_CODE_GATE_ID,
      status: findings.length > 0 ? 'violation' : 'passed',
      summary: findings.length > 0
        ? `${findings.length} 项未批准的动态代码执行`
        : `${inspection.checkedCount} 个文件通过动态代码检查`,
      findings,
      metrics: {
        checkedFiles: inspection.checkedCount,
        approvedExceptions: inspection.approved.length,
        violations: findings.length,
      },
      durationMs: Date.now() - startedAt,
      diagnostics,
    });
  } catch (error) {
    const typedError = toRepoGuardError(error, {
      kind: 'execution',
      code: 'dynamic-code/analysis-failed',
    });
    return createGateResult({
      gateId: DYNAMIC_CODE_GATE_ID,
      status: 'execution-error',
      summary: typedError.message,
      durationMs: Date.now() - startedAt,
      error: typedError,
    });
  }
}

export const dynamicCodeGate = defineGate({
  id: DYNAMIC_CODE_GATE_ID,
  configVersions: [1],
  environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
  ciScopes: ['all-files', 'changed-files'],
  mutation: 'read-only',
  defaultTimeoutMs: 120000,
  manualCommand: 'dynamic-code',
  manualOrder: 70,
  doctorOrder: 70,
  packageScript: 'guard:dynamic-code',
  rules: [NO_EVAL_RULE, NO_FUNCTION_CONSTRUCTOR_RULE],
  requiredTools: [],
  requiredScripts: [],
  requiredEnvironment: [],
  requiredSecrets: [],
  artifactTypes: [],
  supportsFix: false,
  supportsCancellation: false,
  inspectSetup: inspectDynamicCodeSetup,
  plan({ root, files }) {
    if (!Array.isArray(files)) {
      throw new TypeError('动态代码门禁要求明确的文件范围');
    }
    return Object.freeze({
      root,
      files: immutableFileScope(files),
    });
  },
  run({ root, config, plan }) {
    if (!plan || !Array.isArray(plan.files)) {
      throw new TypeError('动态代码门禁要求执行计划');
    }
    return buildDynamicCodeGateResult({
      root,
      files: plan.files,
      exceptions: config.exceptions,
    });
  },
});
