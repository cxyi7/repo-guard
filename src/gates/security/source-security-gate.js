import { readFileSync } from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import { definePlatformGate } from '../platform-gate.js';
import { createGateResult } from '../../core/result/gate-result.js';
import {
  configurationError,
  errorStatus,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import { findStructuredException } from '../../policies/exception-registry.js';
import { inspectSecurityScript } from '../../policies/source-security-script.js';
import { inspectSecurityMarkup } from '../../policies/source-security-markup.js';
import { sourceLocation } from '../../integrations/vue/template-parser.js';

export const SOURCE_SECURITY_RULES = Object.freeze([
  'security/no-eval',
  'security/no-function-constructor',
  'vue/no-v-html',
  'vue/target-blank-security',
  'source-security/string-timer',
  'source-security/dom-html',
  'source-security/srcdoc',
  'source-security/inline-event',
  'source-security/url-scheme',
  'source-security/new-window',
  'source-security/message-origin',
  'source-security/unconfirmed',
]);

function remediationFor(item, options) {
  if (
    item.rule === 'vue/target-blank-security' ||
    item.rule === 'source-security/new-window'
  ) {
    const rel = [
      options.newWindow.requireNoopener && 'noopener',
      options.newWindow.requireNoreferrer && 'noreferrer',
    ]
      .filter(Boolean)
      .join(' ');
    return `按配置提供明确的 rel="${rel}"；window.open 使用对应字面量选项，禁止开启 opener 时应移除该选项。`;
  }
  if (item.rule === 'source-security/message-origin')
    return '显式提供预期接收页面的精确 targetOrigin，不使用 *。';
  if (
    [
      'security/no-eval',
      'security/no-function-constructor',
      'source-security/string-timer',
    ].includes(item.rule)
  )
    return '改用明确声明的函数和数据解析，不从字符串执行代码。';
  if (
    [
      'vue/no-v-html',
      'source-security/dom-html',
      'source-security/srcdoc',
    ].includes(item.rule)
  )
    return '使用模板插值、textContent 或明确的 DOM/组件结构替代 HTML 字符串写入。';
  if (item.rule === 'source-security/inline-event')
    return '使用函数处理器、addEventListener 或 Vue 的 @事件 语法替代字符串事件。';
  return '将该地址改为项目允许的导航地址或脚本来源，不使用禁止的字面量协议。';
}

export function inspectSourceSecurity(source, filename, options) {
  const findings = [];
  const seen = new Set();
  const add = (rule, offset, message, unconfirmed = false) => {
    const key = `${rule}:${offset}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      rule,
      offset,
      message,
      unconfirmed,
      path: filename,
      ...sourceLocation(source, offset),
    });
  };
  const script = (text, offset = 0, language = '') =>
    inspectSecurityScript(
      text,
      filename,
      options,
      (rule, position, message, unknown) =>
        add(rule, offset + position, message, unknown),
      language,
    );
  if (/\.(vue|html)$/i.test(filename))
    inspectSecurityMarkup(source, filename, options, add, script);
  else script(source);
  return findings.sort((a, b) => a.offset - b.offset);
}

export function runSourceSecurity({ root, config, files }) {
  const gateId = 'security.source-security';
  const options = config.checks.sourceSecurity;
  if (!options.enabled)
    return createGateResult({
      gateId,
      status: 'skipped',
      summary: '源码安全检查已关闭',
    });
  try {
    if (
      ![
        'dynamicCode',
        'htmlInjection',
        'inlineEventCode',
        'urlScheme',
        'newWindow',
        'crossWindowMessage',
      ].some((group) => options[group].enabled)
    )
      return createGateResult({
        gateId,
        status: 'skipped',
        summary: '当前命令对应的源码安全分类已关闭',
      });
    const selected = files
      .map((file) =>
        typeof file === 'string'
          ? { relative: file, absolute: path.resolve(root, file) }
          : file,
      )
      .filter(
        (file) =>
          /\.(vue|html|[cm]?[jt]sx?)$/i.test(file.relative) &&
          micromatch.isMatch(file.relative, options.include, { dot: true }) &&
          !micromatch.isMatch(file.relative, options.exclude, { dot: true }),
      );
    const observations = selected.flatMap((file) =>
      inspectSourceSecurity(
        readFileSync(file.absolute, 'utf8'),
        file.relative,
        options,
      ),
    );
    const unconfirmed = observations.filter((item) => item.unconfirmed);
    const approved = [];
    const violations = observations.filter((item) => {
      if (item.unconfirmed) return false;
      const exception = findStructuredException(
        config.repository.exceptions,
        item,
      );
      if (exception) {
        approved.push({ ...item, exception });
        return false;
      }
      return true;
    });
    const status = violations.length
      ? 'violation'
      : !selected.length || unconfirmed.length
        ? 'skipped'
        : 'passed';
    return createGateResult({
      gateId,
      status,
      summary: violations.length
        ? `源码安全检查发现 ${violations.length} 项明确违规`
        : status === 'skipped'
          ? '源码安全检查范围为空或存在无法确认项，不作为完整通过证据'
          : `${selected.length} 个文件在已支持的源码规则范围内通过`,
      findings: violations.map((item) => ({
        ruleId: item.rule,
        severity: 'error',
        message: item.message,
        location: { path: item.path, line: item.line, column: item.column },
        evidence: `在报告位置识别到明确源码语法，违反 ${item.rule}；此结论不包含运行时数据推导。`,
        remediation: remediationFor(item, options),
      })),
      diagnostics: [
        ...(approved.length
          ? [
              {
                level: 'log',
                message: `源码安全检查记录 ${approved.length} 条已批准例外。`,
              },
            ]
          : []),
        ...unconfirmed.map((item) => ({
          level: 'warn',
          message: `无法确认：${item.path}:${item.line}:${item.column} ${item.message}`,
        })),
        ...approved.map((item) => ({
          level: 'warn',
          message: `源码安全已批准例外：${item.path}:${item.line}:${item.column}（${item.exception.id}）`,
        })),
      ],
      metrics: {
        checkedFiles: selected.length,
        violations: violations.length,
        unconfirmed: unconfirmed.length,
        approvedExceptions: approved.length,
      },
    });
  } catch (cause) {
    const error = toRepoGuardError(cause, {
      kind: 'execution',
      code: 'source-security/analysis-failed',
    });
    return createGateResult({
      gateId,
      status: errorStatus(error),
      summary: '源码安全检查未能完成，请修复解析或读取错误后重试',
      error,
    });
  }
}

export const sourceSecurityGate = definePlatformGate({
  id: 'security.source-security',
  configKey: 'checks.sourceSecurity',
  featureName: 'sourceSecurity',
  featureOrder: 36,
  environments: [
    'manual',
    'pre-commit',
    'ci-policy',
    'ci-full',
    'release-ready',
  ],
  ciScopes: ['all-files', 'changed-files'],
  manualCommand: 'source-security',
  manualOrder: 76,
  doctorOrder: 76,
  packageScript: 'guard:source-security',
  rules: SOURCE_SECURITY_RULES,
  inspectSetup: ({ config }) => ({
    status: config.checks.sourceSecurity.enabled ? 'ready' : 'disabled',
    summary: '六组源码安全规则；只检查显式语法，不推导运行时结果',
  }),
  plan: ({ files }) => {
    if (!Array.isArray(files))
      throw configurationError(
        'source-security/scope-required',
        '源码安全检查要求明确的文件范围',
      );
    return Object.freeze({
      files: Object.freeze(
        files.map((file) =>
          typeof file === 'string' ? file : Object.freeze({ ...file }),
        ),
      ),
    });
  },
  run: ({ root, config, plan }) => {
    if (!plan || !Array.isArray(plan.files))
      throw configurationError(
        'source-security/plan-required',
        '源码安全检查要求执行计划',
      );
    return runSourceSecurity({ root, config, files: plan.files });
  },
});
