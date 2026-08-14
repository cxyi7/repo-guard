import { internalError } from '../error/repo-guard-error.js';

const PROCESS_FAILURES = Object.freeze({
  'quality.typecheck': Object.freeze({
    ruleId: 'typescript/typecheck-process',
    message: 'The project TypeScript check reported errors',
    evidence: 'The consuming project tsc/vue-tsc process exited unsuccessfully.',
    remediation: ({ script }) => (
      `Fix the reported type errors and affected callers, then run npm run ${script}. `
      + 'Do not bypass the gate with any, @ts-ignore, @ts-nocheck, disabled strictness, or rule changes.'
    ),
  }),
  'quality.build': Object.freeze({
    ruleId: 'build/project-process',
    message: 'The consuming project build reported errors',
    evidence: 'The project-owned build script exited unsuccessfully.',
    remediation: ({ script }) => (
      `Fix the reported source, configuration, dependency, or asset error, then run npm run ${script}. `
      + 'Do not replace the build with a no-op, ignore failures, disable production checks, or weaken the gate.'
    ),
  }),
  'quality.unit-test': Object.freeze({
    ruleId: 'testing/unit-test-process',
    message: 'The consuming project unit tests reported failures',
    evidence: 'The project-owned Vitest process exited unsuccessfully.',
    remediation: ({ script }) => (
      `Fix the failing behavior or test and run npm run ${script}. `
      + 'Do not delete tests or assertions, use skip/todo/only, or weaken the gate.'
    ),
  }),
  'quality.accessibility-test': Object.freeze({
    ruleId: 'accessibility/axe-test-process',
    message: 'The consuming project accessibility tests reported violations',
    evidence: 'The project-owned axe test process exited unsuccessfully.',
    remediation: ({ script }) => (
      `Fix the reported accessibility root causes and regression tests, then run npm run ${script}. `
      + 'Do not disable rules, exclude nodes, narrow scanning, delete assertions, or weaken the gate.'
    ),
  }),
  'quality.lighthouse:build': Object.freeze({
    ruleId: 'lighthouse/build-process',
    message: 'The Lighthouse project build reported errors',
    evidence: 'The consuming project build used by Lighthouse exited unsuccessfully.',
    remediation: ({ script }) => `Fix the project build and run npm run ${script} before Lighthouse.`,
  }),
  'quality.lighthouse:collect': Object.freeze({
    ruleId: 'lighthouse/collect-process',
    message: 'Lighthouse could not collect the configured routes',
    evidence: 'The consuming project LHCI collect process exited unsuccessfully.',
    remediation: () => (
      'Fix the consuming project Chrome, server, route, or LHCI configuration and rerun the Lighthouse gate. '
      + 'Do not remove required routes or weaken the configured assertions.'
    ),
  }),
  'quality.lighthouse:assert': Object.freeze({
    ruleId: 'lighthouse/assert-process',
    message: 'Lighthouse assertions did not meet the project policy',
    evidence: 'The consuming project LHCI assert process exited unsuccessfully.',
    remediation: () => (
      'Fix the measured accessibility, performance, best-practice, or SEO regression and rerun the Lighthouse gate. '
      + 'Do not lower assertions or remove routes to bypass the gate.'
    ),
  }),
  'quality.unit-test:coverage-report': Object.freeze({
    ruleId: 'coverage/report-generation',
    message: 'Coverage reports could not be inspected',
    evidence: 'The configured json-summary or LCOV output is missing or invalid.',
    remediation: ({ script }) => (
      `Configure Vitest to generate current json-summary and LCOV reports, then run npm run ${script}. `
      + 'Do not reuse stale reports, disable coverage, or reduce thresholds.'
    ),
  }),
});

export function processFailureFinding(gateId, {
  exitCode,
  phase = null,
  script = null,
} = {}) {
  const key = phase ? `${gateId}:${phase}` : gateId;
  const guidance = PROCESS_FAILURES[key];
  if (!guidance) {
    throw internalError(
      'reporting/missing-process-guidance',
      `No process failure guidance is registered for ${key}`,
    );
  }
  const repairText = guidance.remediation({ script });
  const [stepText, constraintText] = repairText.split(/\s+Do not\s+/u, 2);
  return {
    ruleId: guidance.ruleId,
    code: `${guidance.ruleId}/process-failed`,
    severity: 'error',
    message: guidance.message,
    evidence: [{
      type: 'process-exit',
      source: key,
      message: `${guidance.evidence}${exitCode == null ? '' : ` Exit code: ${exitCode}.`}`,
    }],
    expected: `The ${key} process must finish successfully with exit code 0.`,
    remediation: {
      goal: `Restore ${key} to a passing state without weakening its policy.`,
      steps: [stepText.trim()],
      constraints: constraintText ? [`Do not ${constraintText.trim()}`] : [],
      verification: [script ? `Run npm run ${script}.` : `Rerun the ${key} gate.`],
    },
    decision: {
      aiAction: 'inspect-diagnostics-and-modify-code',
      humanApprovalRequired: false,
    },
  };
}

export const processFailureGuidanceIds = Object.freeze(Object.keys(PROCESS_FAILURES));
