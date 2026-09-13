import { createGateResult } from '../../core/result/gate-result.js';
import { aggregateGateResults } from '../../core/result/exit-code.js';
import {
  errorStatus,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';
import { runStylelintFiles } from './stylelint-gate.js';
import { uiTokenGate } from './ui-token-gate.js';

/** 统一手动入口按公共优先级汇总普通规则与 Token 子能力。 */
export async function runUnifiedStylelintManual(context) {
  const { root, config, plan } = context;
  if (!config.checks.stylelint.enabled)
    return createGateResult({
      gateId: 'quality.stylelint',
      status: 'skipped',
      summary: 'Stylelint 已禁用',
    });
  const results = [];
  for (const execute of [
    () =>
      runStylelintFiles({
        ...config.checks.stylelint,
        root,
        files: plan.files,
        fix: false,
        exceptions: config.repository.exceptions,
      }),
    async () =>
      uiTokenGate.run({ ...context, plan: await uiTokenGate.plan(context) }),
  ]) {
    try {
      results.push(await execute());
    } catch (cause) {
      const error = toRepoGuardError(cause, {
        code: 'stylelint/subcheck-failed',
        message: 'Stylelint 子检查执行失败，请查看独立诊断。',
      });
      results.push(
        createGateResult({
          gateId: 'quality.stylelint',
          status: errorStatus(error),
          summary: error.message,
          error,
        }),
      );
    }
  }
  const { status, decisiveResult } = aggregateGateResults(results);
  return createGateResult({
    gateId: 'quality.stylelint',
    status,
    summary: decisiveResult.summary,
    ...(decisiveResult.error
      ? {
          error: toRepoGuardError(decisiveResult.error, {
            kind: decisiveResult.error.kind,
            code: decisiveResult.error.code,
            message: decisiveResult.error.message,
          }),
        }
      : {}),
    findings: results.flatMap((r) => r.findings),
    diagnostics: results.flatMap((r) => r.diagnostics),
    artifacts: results.flatMap((r) => r.artifacts),
  });
}
