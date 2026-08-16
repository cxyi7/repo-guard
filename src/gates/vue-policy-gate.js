import path from 'node:path';
import { defineGate } from '../core/capability/gate-definition.js';
import { findingFromPolicy, passedResult, violationResult } from './native-result.js';

const CONFIG_VERSION = [1];

function projectFiles(context) {
  return context.files.map((file) => {
    if (typeof file !== 'string') return file;
    return { relative: file, absolute: path.join(context.root, file) };
  });
}

function policyFinding(item, fallbackRule, fallbackRemediation = null) {
  return findingFromPolicy({ ...item, rule: item.rule ?? fallbackRule }, {
    remediation: item.remediation ?? fallbackRemediation,
  });
}

export function defineVuePolicyGate({
  id,
  rule,
  inspect,
  remediation,
  summary,
  manualCommand,
  manualOrder,
  doctorOrder,
}) {
  return defineGate({
    id,
    configVersions: CONFIG_VERSION,
    environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
    mutation: 'read-only',
    defaultTimeoutMs: 120000,
    manualCommand,
    manualOrder,
    doctorOrder,
    packageScript: `guard:${manualCommand}`,
    rules: [rule],
    inspectSetup: () => ({ status: 'ready', summary: `${summary} (hard requirement, rule=${rule})` }),
    plan: (context) => ({ files: projectFiles(context) }),
    run({ root, config, plan }) {
      const result = inspect({ root, files: plan.files, exceptions: config.exceptions });
      const metrics = {
        checkedFiles: result.checkedCount,
        approvedExceptions: result.approved.length,
        violations: result.violations.length,
      };
      const approvedDiagnostics = result.approved.map((item) => ({
        level: 'warn',
        message: `${id} approved exception: ${item.path}:${item.line}:${item.column} (${item.exception.id}, expires=${item.exception.expiresOn})`,
      }));
      if (result.approved.length > 0) approvedDiagnostics.push({
        level: 'info',
        message: `${summary} passed: ${result.checkedCount} file(s), ${result.approved.length} approved exception(s).`,
      });
      if (result.violations.length === 0) {
        return passedResult(id, `${summary} passed`, { diagnostics: approvedDiagnostics, metrics });
      }
      return violationResult(id, `${summary} found ${result.violations.length} violation(s)`, {
        findings: result.violations.map((item) => policyFinding(item, rule, remediation)),
        metrics,
        diagnostics: approvedDiagnostics,
      });
    },
  });
}
