import { executionError } from '../core/error/repo-guard-error.js';
import { sanitizeProcessOutput } from '../core/execution/output-safety.js';

function thirdPartyDiagnostic(value, source, stream, cwd) {
  const safe = sanitizeProcessOutput(value, { root: cwd ?? process.cwd() });
  return safe.text.trim() ? [{
    source,
    stream,
    level: stream === 'stderr' ? 'error' : 'info',
    message: safe.text,
    redacted: safe.redacted,
    truncated: safe.truncated,
  }] : [];
}

/** 仅在错误展示边界脱敏；allowFailure 调用者仍使用原始 Git 输出。 */
export function createGitCommandError(result, { cwd, binary = false } = {}) {
  const failedToStart = Boolean(result.error);
  const prefix = binary ? 'git/binary-' : 'git/';
  const status = result.status ?? null;
  const signal = result.signal ?? null;
  const processCode = result.error?.code ?? null;
  return executionError(
    `${prefix}${failedToStart ? 'process-start-failed' : 'command-failed'}`,
    failedToStart
      ? 'Git 命令进程未能正常执行，请检查 Git 环境和执行限制。'
      : 'Git 命令未能成功完成，请查看执行状态和第三方原始诊断。',
    {
      ...(failedToStart ? { cause: result.error } : {}),
      details: {
        status,
        signal,
        processCode,
        diagnostics: [
          ...thirdPartyDiagnostic(result.error?.message, 'git:process', 'stderr', cwd),
          ...thirdPartyDiagnostic(result.stdout, 'git', 'stdout', cwd),
          ...thirdPartyDiagnostic(result.stderr, 'git', 'stderr', cwd),
        ],
        evidence: [
          {
            type: 'git-exit-status',
            source: 'git',
            message: `Git 退出状态：${status === null ? '未返回' : status}；终止信号：${signal ?? '无'}；进程错误代码：${processCode ?? '无'}。`,
          },
        ],
      },
      expected: 'Git 命令应在指定目录中成功完成，并返回完整且可验证的执行结果。',
      remediation: {
        goal: '恢复 Git 命令执行，并保留原有检查范围。',
        steps: [
          '根据独立列出的退出状态、终止信号和第三方原始诊断定位失败原因。',
          '检查 Git 安装、执行目录、所需提交或对象及文件访问权限，修复后重试。',
        ],
        constraints: ['不要忽略 Git 失败或用空结果替代无法读取的内容。'],
        verification: ['在同一目录使用相同参数重新执行 Git 命令，确认退出状态为 0。'],
      },
    },
  );
}
