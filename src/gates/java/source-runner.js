import { configurationError, errorStatus, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { JAVA_SOURCE_DEFAULTS, validateJavaSourceChecks } from '../../config/java-source.js';
import { prepareJavaSourceInputs } from '../../integrations/java/source/files.js';
import { createJavaTool } from '../../integrations/java/source/tool.js';
import { executeJavaCheckstyle, executeJavaFormat, executeJavaPmd } from '../../integrations/java/source/execution.js';
import {
  JAVA_SOURCE_FEATURES, JAVA_LINT_RULES, javaCheckstyleRules,
  javaCheckstyleConfiguration, javaPmdConfiguration, javaSourceRuleMessage,
} from '../../policies/java/source-rules.js';
import { passedResult, skippedResult, violationResult } from '../native-result.js';

function sourceFinding(feature, item) {
  const message = feature === 'javaFormat' ? 'Java 源码尚未满足选定的格式风格'
    : feature === 'javaDuplication' ? `Java 代码存在至少 ${item.tokens} 个词法标记的重复片段`
      : javaSourceRuleMessage(feature, item.rule);
  return {
    ruleId: `${feature === 'javaDuplication' ? 'java.duplication' : JAVA_SOURCE_FEATURES.find((entry) => entry.feature === feature).id}/${item.rule}`,
    code: item.rule,
    severity: 'error', message,
    location: { path: item.relative, line: item.line, ...(item.column ? { column: item.column } : {}) },
    evidence: item.rawMessage ? [{ type: 'java-source-rule', message: `该位置违反 ${item.rule} 规则` }]
      : item.locations?.map(({ relative, line }) => ({ type: 'duplicate-location', message: '重复片段位置', location: { path: relative, line } })) ?? [],
    expected: '满足当前启用的 Java 源码规则，并保留检查范围和规则强度',
    remediation: feature === 'javaFormat' ? '运行 repo-guard java-format --fix，然后重新执行只读检查' : '根据规则和位置修改源码，再重新运行同一检查',
  };
}

async function executeSourceFeature({ feature, config, prepared, tool, root, fix, version }) {
  const options = { root, config, ...prepared, tool, version };
  if (feature === 'javaFormat') return executeJavaFormat({ ...options, fix });
  if (['javaLint', 'javaDuplication'].includes(feature)) {
    return executeJavaPmd({
      ...options, duplication: feature === 'javaDuplication',
      configuration: javaPmdConfiguration(), ruleNames: JAVA_LINT_RULES.map(({ name }) => name),
    });
  }
  return executeJavaCheckstyle({
    ...options, rules: javaCheckstyleRules(feature, config),
    configuration: javaCheckstyleConfiguration(feature, config),
  });
}

/** 外部工具只产生事实；门禁统一转换为中文结果，不透传其退出码。 */
export async function runJavaSourceGate({
  root, feature, config, files = [], fix = false, signal = null,
  environment = 'manual', configurationChanged = false,
}, dependencies = {}) {
  const descriptor = JAVA_SOURCE_FEATURES.find((entry) => entry.feature === feature);
  if (!descriptor) throw configurationError('java/source-feature', `不存在 Java 源码检查：${feature}`);
  const startedAt = Date.now();
  let prepared;
  let tool;
  try {
    const normalized = validateJavaSourceChecks({ [feature]: { ...JAVA_SOURCE_DEFAULTS[feature], ...config } })[feature];
    if (!normalized.enabled) return skippedResult(descriptor.id, `${descriptor.label}检查已禁用`);
    prepared = prepareJavaSourceInputs({
      root, files, config: normalized,
      indexSnapshot: environment === 'pre-commit' && configurationChanged && !fix,
      fallbackTracked: environment !== 'pre-commit',
    });
    if (prepared.inputs.length === 0) return skippedResult(descriptor.id, '当前范围没有受控 Java 源码文件');
    tool = createJavaTool({ root, feature, config: normalized, signal, ...dependencies });
    const version = await tool.inspectVersion();
    const result = await executeSourceFeature({ feature, config: normalized, prepared, tool, root, fix, version });
    const findings = result.findings.map((item) => sourceFinding(feature, item));
    const metrics = {
      checkedFiles: prepared.inputs.length, violations: findings.length,
      ...(result.fixedFiles === undefined ? {} : { fixedFiles: result.fixedFiles }),
      ...(result.batches === undefined ? {} : { batches: result.batches }),
    };
    const diagnostics = [
      ...tool.diagnostics,
      ...result.findings.filter((item) => item.rawMessage).map((item) => ({
        source: feature === 'javaLint' ? 'pmd' : 'checkstyle', stream: 'stderr', level: 'error',
        message: `第三方原始诊断（${item.relative}:${item.line}）：${item.rawMessage}`,
      })),
    ];
    const details = { findings, metrics, diagnostics, durationMs: Date.now() - startedAt };
    return findings.length
      ? violationResult(descriptor.id, `${descriptor.label}检查发现 ${findings.length} 项违规`, details)
      : passedResult(descriptor.id, `${prepared.inputs.length} 个文件通过${descriptor.label}检查`, details);
  } catch (cause) {
    const error = toRepoGuardError(cause, { code: 'java/source-execution', message: 'Java 源码检查未完整执行，请查看诊断并修复工具或输入文件' });
    return createGateResult({
      gateId: descriptor.id, status: errorStatus(error), summary: error.message, error,
      diagnostics: tool?.diagnostics ?? [], durationMs: Date.now() - startedAt,
    });
  } finally {
    prepared?.cleanup();
  }
}
