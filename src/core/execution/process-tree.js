import { spawn } from 'node:child_process';
import { executionError, isRepoGuardError } from '../error/repo-guard-error.js';
import { sanitizeProcessOutput } from './output-safety.js';

const TERMINATION_TIMEOUT_MS = 2000;

function rawFailureDiagnostics(error, source) {
  if (error == null) return [];
  if (isRepoGuardError(error)) {
    return error.details?.diagnostics ?? rawFailureDiagnostics(error.cause, source);
  }
  const output = sanitizeProcessOutput(error.message ?? String(error));
  return [{
    source, stream: 'stderr', level: 'error', message: output.text,
    redacted: output.redacted, truncated: output.truncated,
  }];
}

/** 清理失败也断开本进程的管道和引用，不能让后代持有的句柄无限阻塞调用方。 */
export function releaseProcessHandles(child) {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

function killDirectly(child) {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return;
  try {
    child.kill('SIGKILL');
  } catch {
    // 原始进程树清理错误会交给调用方；直杀只是尽力回收，不能据此宣称整棵树已退出。
  }
}

/** 所有调用方使用同一清理时限；taskkill 成功还必须观察到父进程退出。 */
export async function terminateProcessTree(child, {
  platform = process.platform,
  spawnProcess = spawn,
  killProcess = process.kill.bind(process),
  timeoutMs = TERMINATION_TIMEOUT_MS,
} = {}) {
  if (!child.pid) {
    releaseProcessHandles(child);
    return;
  }
  let killer = null;
  let onExit;
  let timer;
  const exited = new Promise((resolve) => {
    onExit = resolve;
    child.once('exit', onExit);
    if (child.exitCode != null || child.signalCode != null) resolve();
  });
  try {
    await Promise.race([
      (async () => {
        if (platform === 'win32') {
          await new Promise((resolve, reject) => {
            killer = spawnProcess('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
              shell: false, stdio: 'ignore', windowsHide: true,
            });
            killer.once('error', reject);
            killer.once('close', (status) => {
              if (status === 0) resolve();
              else reject(executionError(
                'process-tree/taskkill-failed',
                `taskkill 未能完成进程树清理，退出码为 ${status}。`,
                { details: { status } },
              ));
            });
          });
        } else {
          try {
            killProcess(-child.pid, 'SIGKILL');
          } catch (error) {
            // 父进程已退出且进程组不存在，说明没有需要清理的组成员。
            if (error.code !== 'ESRCH' || (child.exitCode == null && child.signalCode == null)) {
              throw executionError('process-tree/group-kill-failed', '无法终止子进程组。', { cause: error });
            }
          }
        }
        await exited;
      })(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(executionError(
          'process-tree/termination-timeout',
          `进程树未在 ${timeoutMs}ms 清理时限内确认退出。`,
        )), timeoutMs);
      }),
    ]);
  } catch (error) {
    killDirectly(child);
    const causeCode = error.code ?? error.cause?.code ?? null;
    throw executionError('process-tree/termination-failed', '无法确认子进程树已完整终止；已尝试直接终止父进程。', {
      cause: error,
      details: {
        pid: child.pid, platform, timeoutMs, causeCode,
        evidence: [{
          type: 'termination-failure', source: 'process-tree',
          message: `进程树清理失败，平台 ${platform}，进程 ${child.pid}，原因代码 ${causeCode ?? '未知'}。`
            + (isRepoGuardError(error) ? ` ${sanitizeProcessOutput(error.message).text}` : ''),
        }],
        diagnostics: rawFailureDiagnostics(error, 'process-tree'),
      },
    });
  } finally {
    clearTimeout(timer);
    child.removeListener('exit', onExit);
    releaseProcessHandles(child);
    if (killer) {
      killDirectly(killer);
      releaseProcessHandles(killer);
    }
  }
}

export function processTerminationFailure(reason, cause, code) {
  return executionError(code, '执行被中止，但未能确认子进程树已完整终止。', {
    cause,
    details: {
      ...cause.details,
      reasonCode: reason.code ?? null,
      evidence: [
        {
          type: 'termination-reason',
          message: `触发中止的原因代码：${reason.code ?? '未知'}。`
            + (isRepoGuardError(reason)
              ? ` ${sanitizeProcessOutput(reason.message).text}`
              : ' 已收到调用方的取消或中止请求，原始说明见第三方诊断。'),
        },
        ...(cause.details?.evidence ?? []),
      ],
      diagnostics: [
        ...(cause.details?.diagnostics ?? rawFailureDiagnostics(cause, 'process-tree')),
        ...rawFailureDiagnostics(reason, 'process-cancellation'),
      ],
    },
    remediation: {
      goal: '恢复进程树清理能力并确认遗留进程已停止。',
      steps: ['检查 taskkill 或进程组终止权限，确认相关父进程和后代进程均已退出。', '修复原始超时、取消或输出超限原因后重试。'],
      constraints: ['不得将无法确认完整终止的执行视为成功。'],
      verification: ['重新执行同一门禁，确认进程可以在时限内退出。'],
    },
  });
}
