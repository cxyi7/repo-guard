/** repo-guard 的退出码与结果优先级只在这里定义；外部工具的原始退出码另作诊断。 */
export const EXIT_CODES = Object.freeze({ success: 0, error: 1, violation: 2, range: 3 });

const STATUS_EXIT_CODES = Object.freeze({
  passed: EXIT_CODES.success,
  skipped: EXIT_CODES.success,
  violation: EXIT_CODES.violation,
  'configuration-error': EXIT_CODES.error,
  'execution-error': EXIT_CODES.error,
  'range-error': EXIT_CODES.range,
});

export const GATE_STATUSES = Object.freeze(Object.keys(STATUS_EXIT_CODES));
const STATUS_PRIORITY = Object.freeze([
  'execution-error', 'configuration-error', 'range-error', 'violation', 'passed', 'skipped',
]);
const EXIT_CODE_PRIORITY = Object.freeze([EXIT_CODES.error, EXIT_CODES.range, EXIT_CODES.violation, EXIT_CODES.success]);

export function gateStatusToExitCode(status) {
  if (typeof status !== 'string' || !Object.hasOwn(STATUS_EXIT_CODES, status)) {
    throw new TypeError(`未知的 GateStatus： ${String(status)}`);
  }
  return STATUS_EXIT_CODES[status];
}

export function gateResultToExitCode(result) {
  return gateStatusToExitCode(result.status);
}

/** 已知本工具结果必须使用合法码，防止命令忘记返回或泄漏第三方退出码。 */
export function validateExitCode(exitCode) {
  if (!EXIT_CODE_PRIORITY.includes(exitCode)) throw new TypeError(`未知的 repo-guard 退出码：${String(exitCode)}`);
  return exitCode;
}

export function aggregateExitCodes(exitCodes) {
  if (!Array.isArray(exitCodes)) throw new TypeError('退出码集合必须是数组');
  exitCodes.forEach(validateExitCode);
  return EXIT_CODE_PRIORITY.find((code) => exitCodes.includes(code)) ?? EXIT_CODES.success;
}

/** 先由调用方选择需要阻断的结果，再按相同优先级汇总；不改变原始检查记录。 */
export function aggregateGateResults(results) {
  if (!Array.isArray(results)) throw new TypeError('待汇总的检查结果必须是数组');
  for (const result of results) gateResultToExitCode(result);
  const decisiveResult = STATUS_PRIORITY
    .map((status) => results.find((result) => result.status === status))
    .find(Boolean) ?? null;
  return Object.freeze({
    status: decisiveResult?.status ?? 'passed',
    decisiveResult,
    exitCode: decisiveResult === null ? EXIT_CODES.success : gateResultToExitCode(decisiveResult),
  });
}

/** 领域适配器声明正常非零退出代表违规还是执行错误；无法正常执行始终是执行错误。 */
export function processExecutionToStatus(execution, { failureStatus = 'execution-error' } = {}) {
  if (!['violation', 'execution-error'].includes(failureStatus)) {
    throw new TypeError('外部进程的失败分类只能是 violation 或 execution-error');
  }
  if (!execution || execution.error || execution.timedOut || execution.signal
    || !Number.isInteger(execution.status) || execution.status < 0) return 'execution-error';
  return execution.status === EXIT_CODES.success ? 'passed' : failureStatus;
}

/** 仅用于本工具自己的子进程；未知码、超时和信号终止不能当作规则违规或成功。 */
export function repoGuardProcessToExitCode(execution) {
  if (processExecutionToStatus(execution) === 'passed') return EXIT_CODES.success;
  if (execution?.error || execution?.timedOut || execution?.signal) return EXIT_CODES.error;
  return EXIT_CODE_PRIORITY.includes(execution?.status) ? execution.status : EXIT_CODES.error;
}
