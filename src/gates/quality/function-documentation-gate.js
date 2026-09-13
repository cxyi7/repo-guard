import { readFileSync } from 'node:fs';
import path from 'node:path';
import { definePlatformGate } from '../platform-gate.js';
import { createGateResult } from '../../core/result/gate-result.js';
import { configurationError, executionError } from '../../core/error/repo-guard-error.js';
import { selectFunctionDocumentationFiles, synchronizeFunctionDocumentationContent } from '../../policies/function-documentation.js';

function sourceContent(file) {
  try { return readFileSync(file, 'utf8'); }
  catch (cause) { throw executionError('function-docs/read-failed', '无法读取函数文档检查范围内的源码。', { cause }); }
}

export const functionDocumentationGate = definePlatformGate({
  id: 'quality.function-documentation', configKey: 'checks.functionDocs', featureName: 'functionDocs',
  featureOrder: 34, doctorOrder: 74, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
  ciScopes: ['all-files', 'changed-files'], manualCommand: 'function-docs', manualOrder: 74,
  packageScript: 'guard:function-docs', rules: ['function-docs/missing-description', 'function-docs/destructured-parameter'],
  plan: ({ root, files, config }) => {
    if (!Array.isArray(files)) throw configurationError('function-docs/scope-required', '函数文档检查要求明确的文件范围。');
    return { enabled: config.checks.functionDocs.enabled,
    files: selectFunctionDocumentationFiles(files.map((file) => typeof file === 'string'
      ? { absolute: path.resolve(root, file), relative: path.relative(root, path.resolve(root, file)).replaceAll('\\', '/') } : file), config.checks.functionDocs) };
  },
  run({ root, config, plan }) {
    if (!plan.enabled || !plan.files.length) return createGateResult({ gateId: 'quality.function-documentation', status: 'skipped', summary: '函数文档检查未启用或没有适用文件' });
    const findings = plan.files.flatMap((file) => synchronizeFunctionDocumentationContent(sourceContent(file),
      path.relative(root, file).replaceAll('\\', '/'), config.checks.functionDocs).warnings
      .filter((warning) => warning.blocking).map((warning) => ({ ruleId: warning.code, severity: 'error',
        message: warning.message, location: warning.location, remediation: '补充真实的用途、参数、返回值、异常和副作用说明，不通过空标签或关闭检查放行。' })));
    return createGateResult({ gateId: 'quality.function-documentation', status: findings.length ? 'violation' : 'passed',
      summary: findings.length ? `函数文档发现 ${findings.length} 项缺失说明` : `${plan.files.length} 个文件通过函数文档检查`, findings });
  },
});
