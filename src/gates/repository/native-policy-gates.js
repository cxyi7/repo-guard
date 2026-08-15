import path from 'node:path';
import { defineGate } from '../../core/capability/gate-definition.js';
import { changeSetEntries } from '../../core/capability/gate-context.js';
import { inspectDependencyPolicy, inspectStagedDependencyPolicy } from './dependency-policy.js';
import { inspectExceptionRegistry } from '../../exception-registry.js';
import { inspectFilePlacement } from '../../policies/file-placement.js';
import {
  evaluateMaxFileLines,
  selectMaxFileLineFiles,
} from '../../policies/max-file-lines.js';
import { findingFromPolicy, passedResult, skippedResult, violationResult } from '../native-result.js';
import { inspectUnsafeVueHtml, VUE_NO_V_HTML_RULE } from '../../vue-unsafe-html.js';
import { inspectVueTargetBlank, VUE_TARGET_BLANK_RULE } from '../../vue-target-blank.js';
import { inspectVueFormLabels, VUE_FORM_CONTROL_LABEL_RULE } from '../../vue-form-label.js';
import { inspectVueImageAlts, VUE_IMAGE_ALT_RULE } from '../../vue-image-alt.js';
import { classifyChanges } from '../../git-changes.js';
import { createStagedFingerprint } from '../../integrations/git/staged-fingerprint.js';
import {
  assertLocalEnvironmentNotStaged,
  resolveNotificationEnvironment,
} from '../../policies/local-environment.js';
import { notificationWasSent, saveNotificationState } from '../../integrations/git/repository-state.js';
import { sendWecomNotification } from '../../integrations/wecom/notification.js';
import {
  buildNotificationText,
  loadNotificationConfig,
} from '../../policies/wecom-notification.js';

const CONFIG_VERSION = [1];

function ready(summary) { return { status: 'ready', summary }; }

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

function vueGate({ id, rule, inspect, remediation, summary, manualCommand, manualOrder, doctorOrder }) {
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
    inspectSetup: () => ready(`${summary} (hard requirement, rule=${rule})`),
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

export const unsafeHtmlGate = vueGate({
  id: 'security.vue-unsafe-html', rule: VUE_NO_V_HTML_RULE,
  inspect: inspectUnsafeVueHtml,
  remediation: 'Replace v-html with Vue templates, components, interpolation, or textContent; if trusted rich HTML is essential, establish a reviewed sanitization boundary.',
  summary: 'Vue v-html gate', manualCommand: 'unsafe-html', manualOrder: 80, doctorOrder: 80,
});
export const targetBlankGate = vueGate({
  id: 'security.vue-target-blank', rule: VUE_TARGET_BLANK_RULE,
  inspect: inspectVueTargetBlank,
  remediation: 'Use a statically verifiable rel="noopener noreferrer" on the same target="_blank" element.',
  summary: 'Vue target=_blank gate', manualCommand: 'target-blank', manualOrder: 90, doctorOrder: 90,
});
export const formLabelGate = vueGate({
  id: 'accessibility.vue-form-label', rule: VUE_FORM_CONTROL_LABEL_RULE,
  inspect: inspectVueFormLabels,
  summary: 'Vue form label gate', manualCommand: 'form-labels', manualOrder: 100, doctorOrder: 100,
});
export const imageAltGate = vueGate({
  id: 'accessibility.vue-image-alt', rule: VUE_IMAGE_ALT_RULE,
  inspect: inspectVueImageAlts,
  summary: 'Vue image alt gate', manualCommand: 'image-alt', manualOrder: 110, doctorOrder: 110,
});

export const exceptionRegistryGate = defineGate({
  id: 'repository.structured-exceptions', configKey: 'exceptions', configVersions: CONFIG_VERSION,
  environments: ['manual', 'ci-policy', 'ci-full', 'release-ready'], mutation: 'read-only', defaultTimeoutMs: 30000,
  manualCommand: 'exceptions', manualOrder: 10, packageScript: 'guard:exceptions',
  inspectSetup: () => ready('Structured exception registry'), plan: () => ({}),
  run({ config }) {
    const result = inspectExceptionRegistry(config.exceptions);
    const invalid = [...result.expired, ...result.future];
    if (invalid.length === 0) return passedResult('repository.structured-exceptions', `Structured exceptions are current (${result.active.length} active)`, { metrics: { entries: result.entries.length, active: result.active.length, expiring: result.expiring.length } });
    return violationResult('repository.structured-exceptions', 'Structured exceptions contain invalid dates', {
      findings: invalid.map((entry) => ({
        ruleId: 'exceptions/invalid-date',
        severity: 'error',
        message: `Exception ${entry.id} is ${result.expired.includes(entry) ? 'expired' : 'future-dated'}`,
        remediation: 'Remove the exception or replace its dates through human review.',
      })),
    });
  },
});

export const dependencyPolicyGate = defineGate({
  id: 'dependencies.policy', configKey: 'dependencyPolicy', featureName: 'dependencies', featureOrder: 80,
  configVersions: CONFIG_VERSION, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'], mutation: 'read-only', defaultTimeoutMs: 120000,
  manualCommand: 'dependencies', manualOrder: 20, doctorOrder: 120, packageScript: 'guard:dependencies',
  inspectSetup: ({ config }) => ready(config.dependencyPolicy.enabled ? 'Dependency policy enabled' : 'Dependency policy disabled'),
  plan: ({ config, changes, environment }) => ({
    enabled: environment === 'manual' || config.dependencyPolicy.enabled,
    applicable: environment !== 'pre-commit' || changeSetEntries(changes).some((change) => ['package.json', 'package-lock.json'].includes(change.path ?? change.relative)),
  }),
  run({ root, config, plan, environment }) {
    if (!plan.enabled) return skippedResult('dependencies.policy', 'Dependency policy is disabled');
    if (!plan.applicable) return skippedResult('dependencies.policy', 'Root package metadata is unchanged');
    const result = environment === 'pre-commit'
      ? inspectStagedDependencyPolicy({ root, config: config.dependencyPolicy, exceptions: config.exceptions })
      : inspectDependencyPolicy({ root, config: config.dependencyPolicy, exceptions: config.exceptions });
    if (result.violations.length === 0) return passedResult('dependencies.policy', 'Dependency policy passed', { metrics: { approvedExceptions: result.approved.length } });
    return violationResult('dependencies.policy', `Dependency policy found ${result.violations.length} violation(s)`, {
      findings: result.violations.map((item) => policyFinding(
        item,
        item.rule,
        'Update package.json, run npm install --package-lock-only, and commit the synchronized package-lock.json; preserve exact versions, approved sources, and lockfile integrity.',
      )),
      metrics: { violations: result.violations.length, approvedExceptions: result.approved.length },
    });
  },
});

export const filePlacementGate = defineGate({
  id: 'repository.file-placement', configKey: 'preCommit.filePlacement', featureName: 'filePlacement', featureOrder: 40,
  configVersions: CONFIG_VERSION, environments: ['manual', 'pre-commit', 'ci-policy', 'ci-full', 'release-ready'], mutation: 'read-only', defaultTimeoutMs: 120000,
  manualCommand: 'file-placement', manualOrder: 150, doctorOrder: 150, packageScript: 'guard:file-placement',
  inspectSetup: ({ config }) => ready(config.preCommit.filePlacement.enabled ? 'File placement enabled' : 'File placement disabled'),
  plan: ({ config, changes, files, environment }) => ({
    enabled: environment === 'manual' || config.preCommit.filePlacement.enabled,
    changes: environment === 'manual'
      ? files.map((file) => ({ status: 'A', oldPath: null, path: typeof file === 'string' ? file : file.relative }))
      : changeSetEntries(changes),
  }),
  run({ config, plan }) {
    if (!plan.enabled) return skippedResult('repository.file-placement', 'File placement is disabled');
    const result = inspectFilePlacement({ changes: plan.changes, config: config.preCommit.filePlacement });
    if (result.violations.length === 0) return passedResult('repository.file-placement', 'File placement passed', { diagnostics: [{ level: 'info', message: `File placement project check passed: ${result.checkedCount} file(s) matched rules.` }], metrics: { checkedFiles: result.checkedCount } });
    return violationResult('repository.file-placement', `File placement found ${result.violations.length} violation(s)`, {
      findings: result.violations.map((item) => ({ ruleId: 'repository/file-placement', severity: 'error', message: `${item.path} must be placed under an allowed directory`, location: { path: item.path }, remediation: `Move it to ${item.suggestedPath}` })),
      metrics: { checkedFiles: result.checkedCount, violations: result.violations.length },
    });
  },
});

export const maximumFileLinesGate = defineGate({
  id: 'repository.maximum-file-lines', configKey: 'preCommit.maxFileLines', featureName: 'maxFileLines', featureOrder: 50,
  configVersions: CONFIG_VERSION, environments: ['pre-commit', 'ci-policy', 'ci-full', 'release-ready'], mutation: 'read-only', defaultTimeoutMs: 120000, doctorOrder: 140,
  inspectSetup: ({ config }) => ready(config.preCommit.maxFileLines.enabled ? 'Maximum file lines enabled' : 'Maximum file lines disabled'),
  plan: ({ root, config, files, revision, changes }) => ({
    enabled: config.preCommit.maxFileLines.enabled,
    files: selectMaxFileLineFiles(projectFiles({ root, files }), config.preCommit.maxFileLines),
    baselineRef: revision?.base ?? null,
    changes: changeSetEntries(changes),
  }),
  run({ root, config, plan }) {
    if (!plan.enabled || plan.files.length === 0) return skippedResult('repository.maximum-file-lines', 'Maximum file lines has no applicable files');
    const result = evaluateMaxFileLines({ root, files: plan.files, config: config.preCommit.maxFileLines, baselineRef: plan.baselineRef, changes: plan.changes });
    const warningFindings = result.warnings.map((item) => ({
      ruleId: 'repository/maximum-file-lines',
      severity: 'warning',
      message: `${item.path} has ${item.lineCount} lines; maximum is ${item.maxLines}`,
      location: { path: item.path },
      remediation: 'Split the file before it grows beyond the configured limit.',
    }));
    if (result.violations.length === 0) return passedResult('repository.maximum-file-lines', 'Maximum file lines passed', { findings: warningFindings, metrics: { checkedFiles: plan.files.length, warnings: result.warnings.length } });
    return violationResult('repository.maximum-file-lines', `Maximum file lines found ${result.violations.length} violation(s)`, {
      findings: result.violations.map((item) => ({ ruleId: 'repository/maximum-file-lines', severity: 'error', message: `${item.path} has ${item.lineCount} lines; maximum is ${item.maxLines}`, location: { path: item.path }, remediation: `Refactor the file to ${item.passLineCount ?? item.maxLines} lines or fewer without weakening the configured rule.` })),
      metrics: { checkedFiles: plan.files.length, violations: result.violations.length },
    });
  },
});

export const protectedFilesGate = defineGate({
  id: 'repository.protected-files',
  configVersions: CONFIG_VERSION,
  environments: ['pre-commit', 'ci-policy', 'ci-full', 'release-ready'],
  mutation: 'external-write',
  allowedMutations: ['external-write', 'read-only'],
  defaultTimeoutMs: 120000,
  inspectSetup: () => ready('Protected file policy'),
  plan: ({ config, changes, step, dryRun = false, forceNotify = false }) => ({
    action: step?.mutation === 'read-only' ? config.ci.protectedFiles.action : 'notify',
    protectedChanges: classifyChanges(changeSetEntries(changes), config),
    stagedChanges: changeSetEntries(changes),
    dryRun,
    forceNotify,
  }),
  async run({ root, config, plan }) {
    assertLocalEnvironmentNotStaged(plan.stagedChanges);
    const findings = plan.protectedChanges.map((change) => ({
      ruleId: 'repository/protected-file',
      severity: plan.action === 'fail' ? 'error' : 'warning',
      message: `${change.path} is protected (${change.category})`,
      location: { path: change.path },
    }));
    if (findings.length === 0) {
      return passedResult('repository.protected-files', 'No protected files changed', {
        metrics: { protectedChanges: 0 },
      });
    }
    if (plan.action === 'fail') {
      return violationResult('repository.protected-files', `Protected file policy found ${findings.length} change(s)`, {
        findings,
        metrics: { protectedChanges: findings.length },
      });
    }
    const notifyChanges = plan.protectedChanges.filter(({ level }) => level === 'notify');
    const diagnostics = findings.map(({ message }) => ({ level: 'warn', message }));
    if (notifyChanges.length === 0 || !config.notification.enabled) {
      return passedResult('repository.protected-files', findings.length === 0
        ? 'No protected files changed'
        : `Recorded ${findings.length} protected file change(s)`, {
        diagnostics,
        metrics: { protectedChanges: findings.length },
      });
    }
    const fingerprint = createStagedFingerprint(root, notifyChanges);
    const content = buildNotificationText(root, notifyChanges, fingerprint);
    if (plan.dryRun) diagnostics.push({ level: 'info', message: content });
    else if (!plan.forceNotify && notificationWasSent(root, fingerprint)) {
      diagnostics.push({ level: 'info', message: 'Duplicate protected-file notification skipped' });
    } else {
      const { webhook, mentionMobiles } = loadNotificationConfig(resolveNotificationEnvironment(root));
      await sendWecomNotification(webhook, content, mentionMobiles);
      saveNotificationState(root, fingerprint);
      diagnostics.push({ level: 'info', message: 'WeCom protected-file notification sent' });
    }
    return passedResult('repository.protected-files', `Processed ${findings.length} protected file change(s)`, {
      diagnostics,
      metrics: { protectedChanges: findings.length, notifications: notifyChanges.length },
    });
  },
});

export const nativePolicyGates = Object.freeze([
  unsafeHtmlGate, targetBlankGate, formLabelGate, imageAltGate, exceptionRegistryGate,
  dependencyPolicyGate, filePlacementGate, maximumFileLinesGate, protectedFilesGate,
]);
