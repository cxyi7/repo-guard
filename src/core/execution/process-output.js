import { sanitizeProcessOutput } from './output-safety.js';

export function processOutputDiagnostics(execution, {
  source = 'project-process',
  root = null,
  stdoutLevel = 'info',
  stderrLevel = execution.status === 0 ? 'warn' : 'error',
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
  return diagnostics;
}
