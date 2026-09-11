import { sanitizeProcessOutput } from './output-safety.js';
import { processExecutionToStatus } from '../result/exit-code.js';

export function processOutputDiagnostics(execution, {
  source = 'project-process',
  root = null,
  stdoutLevel = 'info',
  stderrLevel = processExecutionToStatus(execution) === 'passed' ? 'warn' : 'error',
} = {}) {
  const diagnostics = [];
  const stdout = sanitizeProcessOutput(execution.stdout, { root });
  const stderr = sanitizeProcessOutput(execution.stderr, { root });
  if (stdout.text.trim()) diagnostics.push({
    source,
    stream: 'stdout',
    level: stdoutLevel,
    message: stdout.text.trim(),
    redacted: stdout.redacted,
    truncated: stdout.truncated,
  });
  if (stderr.text.trim()) diagnostics.push({
    source,
    stream: 'stderr',
    level: stderrLevel,
    message: stderr.text.trim(),
    redacted: stderr.redacted,
    truncated: stderr.truncated,
  });
  const observations = [];
  if (Number.isInteger(execution.status)) observations.push(`原始退出码 ${execution.status}`);
  if (execution.timedOut) observations.push('执行超时');
  if (execution.signal) observations.push(`终止信号 ${execution.signal}`);
  if (execution.error) observations.push(`进程错误：${execution.error.code ?? execution.error.message ?? '未提供错误详情'}`);
  if (observations.length) {
    const state = sanitizeProcessOutput(`第三方进程状态：${observations.join('；')}。原始状态仅用于诊断，门禁结果仍按统一规则判定。`, { root });
    const passed = processExecutionToStatus(execution) === 'passed';
    diagnostics.push({
      source, stream: passed ? 'stdout' : 'stderr', level: passed ? 'info' : 'error',
      message: state.text, redacted: state.redacted, truncated: state.truncated,
    });
  }
  return diagnostics;
}
