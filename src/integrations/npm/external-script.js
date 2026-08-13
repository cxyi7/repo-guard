import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUTPUT_LIMIT = 1024 * 1024;

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function redactExternalOutput(value) {
  return String(value)
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]*?-----END [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/gi, '[REDACTED PRIVATE KEY]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [REDACTED]')
    .replace(/\b(token|password|passwd|secret|cookie|authorization)\b\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
}

export function containsSensitiveExternalData(value) {
  const text = String(value);
  return /-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/i.test(text)
    || /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i.test(text)
    || /["']?(?:token|password|passwd|secret|cookie|authorization)["']?\s*[:=]\s*["']?[^\s"',;}]+/i.test(text);
}

export async function runExactNpmScript({ root, script, signal }) {
  const npmCli = npmCliPath();
  if (!npmCli) throw new Error('Unable to locate the npm CLI used by this Node.js installation');
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };
    const child = spawn(process.execPath, [npmCli, 'run', script], {
      cwd: root,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let size = 0;
    const collect = (stream) => (chunk) => {
      size += chunk.length;
      if (size > OUTPUT_LIMIT) {
        child.kill();
        finish(reject, new Error(`External gate output exceeded ${OUTPUT_LIMIT} bytes`));
        return;
      }
      if (stream === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', (error) => finish(reject, error));
    child.on('close', (status, closeSignal) => finish(resolve, {
      status: status ?? 1,
      signal: closeSignal,
      stdout: redactExternalOutput(stdout),
      stderr: redactExternalOutput(stderr),
    }));
    const abort = () => {
      child.kill();
      const error = signal.reason instanceof Error
        ? signal.reason
        : new Error('External gate execution was cancelled');
      finish(reject, error);
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    child.on('close', () => signal.removeEventListener('abort', abort));
  });
}
