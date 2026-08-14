import {
  createGateResult,
  gateResultToExitCode,
} from '../core/result/gate-result.js';
import {
  cancellationError,
  configurationError,
  errorStatus,
  executionError,
  internalError,
  toRepoGuardError,
} from '../core/error/repo-guard-error.js';

function resultFromFailure(gateId, error, {
  fallbackKind = 'execution',
  code = `gate/${gateId}/execution-failed`,
} = {}) {
  const typedError = toRepoGuardError(error, { kind: fallbackKind, code });
  return createGateResult({
    gateId,
    status: errorStatus(typedError),
    summary: typedError.message,
    error: typedError,
  });
}

function resultFromConfigurationFailure(gateId, error) {
  return resultFromFailure(gateId, error, {
    fallbackKind: 'configuration',
    code: `gate/${gateId}/invalid-setup`,
  });
}

function resultFromOutcome(outcome) {
  return outcome?.result ?? outcome;
}

function validateResult(gate, result) {
  if (!result || typeof result !== 'object') {
    throw internalError('orchestration/invalid-gate-result', `Gate ${gate.id} must return a GateResult`);
  }
  if (result.gateId !== gate.id) {
    throw internalError(
      'orchestration/mismatched-gate-result',
      `Gate ${gate.id} returned a result for ${String(result.gateId)}`,
    );
  }
  return createGateResult(result);
}

function withValidatedResult(outcome, result) {
  if (outcome?.result) return Object.freeze({ ...outcome, result });
  return result;
}

function aggregateStatus(results) {
  for (const status of ['execution-error', 'configuration-error', 'range-error']) {
    if (results.some((result) => result.status === status)) return status;
  }
  if (results.some(({ status }) => status === 'violation')) return 'violation';
  if (results.length > 0 && results.every(({ status }) => status === 'skipped')) return 'skipped';
  return 'passed';
}

function shouldStop(result, stopOnFailure) {
  return stopOnFailure && result.status !== 'passed' && result.status !== 'skipped';
}

function abortError(reason, fallback) {
  if (reason instanceof Error) {
    return toRepoGuardError(reason, {
      kind: 'cancellation',
      code: 'orchestration/cancelled',
    });
  }
  return cancellationError('orchestration/cancelled', fallback);
}

async function executeWithTimeout({ context, gate, step, executeStep }) {
  const controller = new AbortController();
  const upstream = context.signal;
  const onUpstreamAbort = () => controller.abort(
    abortError(upstream.reason, `Execution plan was cancelled before ${step.id} completed`),
  );
  if (upstream?.aborted) onUpstreamAbort();
  else upstream?.addEventListener('abort', onUpstreamAbort, { once: true });

  if (controller.signal.aborted) {
    upstream?.removeEventListener('abort', onUpstreamAbort);
    throw abortError(controller.signal.reason, `Gate ${gate.id} was cancelled`);
  }

  const timeoutError = executionError(
    'orchestration/gate-timeout',
    `Gate ${gate.id} exceeded its ${gate.defaultTimeoutMs}ms timeout`,
    {
      details: { timeoutMs: gate.defaultTimeoutMs },
      remediation: {
        goal: '让门禁在配置的时限内完成，或基于可复现的执行数据调整超时配置。',
        steps: ['检查诊断输出定位阻塞步骤。', '修复阻塞或性能问题后重新运行同一门禁。'],
        constraints: ['不要通过吞掉失败或跳过门禁规避超时。'],
        verification: [`重新运行 ${gate.id} 并确认在 ${gate.defaultTimeoutMs}ms 内完成。`],
      },
    },
  );
  const timeout = setTimeout(() => controller.abort(timeoutError), gate.defaultTimeoutMs);
  const stepContext = Object.freeze({ ...context, signal: controller.signal });
  let cancellationCleanupTimeout = null;
  const aborted = new Promise((resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        if (!gate.supportsCancellation) {
          reject(abortError(controller.signal.reason, `Gate ${gate.id} was cancelled`));
          return;
        }
        cancellationCleanupTimeout = setTimeout(
          () => reject(executionError(
            'orchestration/cancellation-timeout',
            `Gate ${gate.id} did not stop within 5000ms after cancellation`,
          )),
          5000,
        );
      },
      { once: true },
    );
  });
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        let setup;
        try {
          setup = await gate.inspectSetup(stepContext);
        } catch (error) {
          return resultFromConfigurationFailure(gate.id, error);
        }
        if (setup && setup.status !== 'ready') {
          return resultFromConfigurationFailure(
            gate.id,
            configurationError(
              `gate/${gate.id}/setup-${setup.status}`,
              `${gate.id} setup is ${setup.status}: ${setup.summary}`,
            ),
          );
        }
        const outcome = await executeStep({
          context: Object.freeze({ ...stepContext, step }),
          gate,
          step,
        });
        if (controller.signal.aborted) {
          throw abortError(controller.signal.reason, `Gate ${gate.id} was cancelled`);
        }
        return outcome;
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    if (cancellationCleanupTimeout) clearTimeout(cancellationCleanupTimeout);
    upstream?.removeEventListener('abort', onUpstreamAbort);
  }
}

function finish(plan, outcomes) {
  const results = Object.freeze(outcomes.map(resultFromOutcome));
  const status = aggregateStatus(results);
  const decisiveResult = results.find(({ status: value }) => value === 'execution-error')
    ?? results.find(({ status: value }) => value === 'configuration-error')
    ?? results.find(({ status: value }) => value === 'range-error')
    ?? results.find(({ status: value }) => value === 'violation')
    ?? results.at(-1)
    ?? null;
  return Object.freeze({
    planId: plan.id,
    status,
    outcomes: Object.freeze([...outcomes]),
    results,
    decisiveResult,
    exitCode: decisiveResult == null
      ? 0
      : gateResultToExitCode(decisiveResult),
  });
}

export async function orchestratePlan({
  plan,
  registry,
  context,
  executeStep = async ({ context: stepContext, gate }) => {
    const gatePlan = await gate.plan(stepContext);
    return await gate.run({ ...stepContext, plan: gatePlan });
  },
  onResult = null,
  stopOnFailure = false,
}) {
  const outcomes = [];
  for (const step of plan.steps) {
    const gate = registry.get(step.gateId);
    let outcome;
    let result;
    try {
      outcome = await executeWithTimeout({ context, gate, step, executeStep });
      result = validateResult(gate, resultFromOutcome(outcome));
      outcome = withValidatedResult(outcome, result);
    } catch (error) {
      outcome = resultFromFailure(gate.id, error);
      result = outcome;
    }
    outcomes.push(outcome);
    if (onResult) await onResult({ context, gate, outcome, result, step });
    if (shouldStop(result, stopOnFailure)) break;
  }
  return finish(plan, outcomes);
}
