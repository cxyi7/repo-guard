import { format } from 'node:util';
import { createGateResult, normalizeError } from './gate-result.js';

const CAPTURED_CONSOLE_LEVELS = ['log', 'info', 'warn', 'error'];

function statusForExitCode(exitCode, violationExitCodes) {
  if (exitCode === 0) return 'passed';
  if (violationExitCodes == null || violationExitCodes.includes(exitCode)) return 'violation';
  return 'execution-error';
}

function defaultSummary(gateId, status) {
  if (status === 'passed') return `${gateId} passed`;
  if (status === 'violation') return `${gateId} found policy violations`;
  return `${gateId} could not complete`;
}

async function captureConsole(task) {
  const diagnostics = [];
  const originals = Object.fromEntries(
    CAPTURED_CONSOLE_LEVELS.map((level) => [level, console[level]]),
  );
  for (const level of CAPTURED_CONSOLE_LEVELS) {
    console[level] = (...values) => {
      diagnostics.push({ level, message: format(...values) });
    };
  }
  try {
    return { value: await task(), diagnostics, error: null };
  } catch (error) {
    return { value: null, diagnostics, error };
  } finally {
    for (const level of CAPTURED_CONSOLE_LEVELS) console[level] = originals[level];
  }
}

export async function adaptLegacyRunner({
  gateId,
  task,
  violationExitCodes = null,
  summary = defaultSummary,
  captureDiagnostics = true,
}) {
  const startedAt = Date.now();
  try {
    const captured = captureDiagnostics
      ? await captureConsole(task)
      : { value: await task(), diagnostics: [], error: null };
    if (captured.error != null) {
      const normalizedError = normalizeError(captured.error);
      return createGateResult({
        gateId,
        status: 'execution-error',
        summary: normalizedError.message,
        durationMs: Date.now() - startedAt,
        error: normalizedError,
        diagnostics: captured.diagnostics,
      });
    }
    const { value, diagnostics } = captured;
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`Legacy gate ${gateId} must return a non-negative integer exit code`);
    }
    const status = statusForExitCode(value, violationExitCodes);
    const error = status === 'execution-error'
      ? new Error(`Legacy gate ${gateId} returned unexpected exit code ${value}`)
      : null;
    return createGateResult({
      gateId,
      status,
      summary: summary(gateId, status, value),
      durationMs: Date.now() - startedAt,
      error,
      diagnostics,
      legacyExitCode: value,
    });
  } catch (error) {
    const normalizedError = normalizeError(error);
    return createGateResult({
      gateId,
      status: 'execution-error',
      summary: normalizedError.message,
      durationMs: Date.now() - startedAt,
      error: normalizedError,
    });
  }
}
