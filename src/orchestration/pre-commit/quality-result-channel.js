import { randomUUID } from 'node:crypto';
import {
  lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { executionError, toRepoGuardError } from '../../core/error/repo-guard-error.js';
import { validateExitCode } from '../../core/result/exit-code.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const RUN_ID = new RegExp(`^${UUID}$`);
const RECORD_NAME = new RegExp(`^(${UUID})\\.(started|result)\\.json$`);
const VERSION = 2;

function channelFailure(message) {
  return executionError('pre-commit/result-channel-invalid', `质量检查内部结果通道无效：${message}`);
}

function channelDirectory(id) {
  if (typeof id !== 'string' || !RUN_ID.test(id)) throw channelFailure('运行标识格式不正确。');
  return path.join(realpathSync(tmpdir()), `repo-guard-quality-${id}`);
}

function requireDirectory(directory) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory) {
    throw channelFailure('临时目录不是本次运行的独立真实目录。');
  }
}

function readRecord(directory, name) {
  const file = path.join(directory, name);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096) {
    throw channelFailure('记录必须是独立的小型普通文件。');
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

function exactKeys(record, keys) {
  return record !== null && typeof record === 'object' && !Array.isArray(record)
    && Object.keys(record).length === keys.length
    && keys.every((key) => Object.hasOwn(record, key));
}

function openChannel(id, root) {
  const directory = channelDirectory(id);
  requireDirectory(directory);
  const request = readRecord(directory, 'request.json');
  if (!exactKeys(request, ['version', 'runId', 'root'])
    || request.version !== VERSION || request.runId !== id || request.root !== root) {
    throw channelFailure('记录不属于当前仓库和本次运行。');
  }
  return directory;
}

function channelOperation(action) {
  try {
    return action();
  } catch (error) {
    throw toRepoGuardError(error, {
      code: 'pre-commit/result-channel-unavailable',
      message: '无法读写质量检查内部结果通道，请检查临时目录权限后重试。',
    });
  }
}

/** 仅传递随机运行标识，不接受用户指定的输出路径。 */
export function createQualityResultChannel(root) {
  return channelOperation(() => {
    const id = randomUUID();
    const directory = channelDirectory(id);
    mkdirSync(directory, { mode: 0o700 });
    const request = { version: VERSION, runId: id, root: realpathSync(root) };
    try {
      writeFileSync(path.join(directory, 'request.json'), JSON.stringify(request), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      requireDirectory(directory);
      rmSync(directory, { recursive: true });
      throw toRepoGuardError(error, { code: 'pre-commit/result-channel-create-failed' });
    }
    return Object.freeze({
      id,
      readExitCodes: () => channelOperation(() => {
        openChannel(id, request.root);
        const records = new Map();
        for (const name of readdirSync(directory)) {
          if (name === 'request.json') continue;
          const match = RECORD_NAME.exec(name);
          if (!match) throw channelFailure('出现未知的运行记录。');
          const [, taskId, phase] = match;
          const record = readRecord(directory, name);
          const keys = ['version', 'runId', 'taskId', ...(phase === 'result' ? ['exitCode'] : [])];
          if (!exactKeys(record, keys) || record.version !== VERSION || record.runId !== id || record.taskId !== taskId) {
            throw channelFailure('子任务记录格式或所属运行不匹配。');
          }
          if (phase === 'result') validateExitCode(record.exitCode);
          records.set(taskId, { ...records.get(taskId), [phase]: record });
        }
        return [...records.values()].map(({ started, result }) => {
          if (!started || !result) throw channelFailure('子任务未完整返回结果，可能已被中断。');
          return result.exitCode;
        });
      }),
      close: () => channelOperation(() => {
        openChannel(id, request.root);
        // 只清理本次独占创建且重新验证过的目录，不能接收任意路径。
        rmSync(directory, { recursive: true });
      }),
    });
  });
}

/** 开始标记用于区分被终止的子进程与尚未执行的后续任务。 */
export function beginQualityResult(channelId, root) {
  return channelOperation(() => {
    const expectedRoot = realpathSync(root);
    const directory = openChannel(channelId, expectedRoot);
    const taskId = randomUUID();
    const record = { version: VERSION, runId: channelId, taskId };
    writeFileSync(path.join(directory, `${taskId}.started.json`), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    return (exitCode) => channelOperation(() => {
      validateExitCode(exitCode);
      openChannel(channelId, expectedRoot);
      writeFileSync(path.join(directory, `${taskId}.result.json`), JSON.stringify({ ...record, exitCode }), {
        flag: 'wx', mode: 0o600,
      });
    });
  });
}
