import {
  createGateResult,
  gateResultToExitCode,
  normalizeError,
} from '../core/result/gate-result.js';

function resultFromFailure(gateId, error) {
  const normalized = normalizeError(error);
  return createGateResult({
    gateId,
    status: 'execution-error',
    summary: normalized.message,
    error: normalized,
  });
}

function resultFromConfigurationFailure(gateId, error) {
  const normalized = normalizeError(error);
  return createGateResult({
    gateId,
    status: 'configuration-error',
    summary: normalized.message,
    error: normalized,
  });
}

function resultFromOutcome(outcome) {
  return outcome?.result ?? outcome;
}

function validateResult(gate, result) {
  if (!result || typeof result !== 'object') {
    throw new TypeError(`Gate ${gate.id} must return a GateResult`);
  }
  if (result.gateId !== gate.id) {
    throw new TypeError(`Gate ${gate.id} returned a result for ${String(result.gateId)}`);
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
  if (reason instanceof Error) return reason;
  const error = new Error(fallback);
  error.name = 'AbortError';
  return error;
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

  const timeoutError = new Error(
    `Gate ${gate.id} exceeded its ${gate.defaultTimeoutMs}ms timeout`,
  );
  timeoutError.name = 'TimeoutError';
  const timeout = setTimeout(() => controller.abort(timeoutError), gate.defaultTimeoutMs);
  const stepContext = Object.freeze({ ...context, signal: controller.signal });
  const aborted = new Promise((resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(abortError(controller.signal.reason, `Gate ${gate.id} was cancelled`)),
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
            new Error(`${gate.id} setup is ${setup.status}: ${setup.summary}`),
          );
        }
        return await executeStep({
          context: Object.freeze({ ...stepContext, step }),
          gate,
          step,
        });
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
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
