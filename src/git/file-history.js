import { executionError } from '../core/error/repo-guard-error.js';
import { runGit } from './execution.js';

function formatTimestamp(timestamp, offset) {
  const sign = offset.startsWith('-') ? -1 : 1;
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(3, 5));
  const offsetSeconds = sign * ((hours * 60) + minutes) * 60;
  return new Date((Number(timestamp) + offsetSeconds) * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export function parseGitAuthorIdent(value) {
  const match = String(value).trim().match(/^(.*) <[^<>]*> (\d+) ([+-]\d{4})$/);
  if (!match) {
    throw executionError(
      'git/invalid-author-ident',
      'Git 返回的当前提交身份格式无效，无法生成文件头',
      { expected: 'git var GIT_AUTHOR_IDENT 必须返回姓名、邮箱、时间戳和时区。' },
    );
  }
  return Object.freeze({
    name: match[1],
    date: formatTimestamp(match[2], match[3]),
  });
}

export function readCurrentGitAuthor(root) {
  const result = runGit(['var', 'GIT_AUTHOR_IDENT'], { allowFailure: true, cwd: root });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw executionError(
      'git/author-ident-missing',
      '无法读取当前 Git 提交身份，文件头同步已停止',
      {
        expected: '当前仓库必须配置可用的 Git user.name 和 user.email。',
        remediation: {
          goal: '配置当前仓库的 Git 提交身份',
          steps: [
            '运行 git config user.name "你的姓名"',
            '运行 git config user.email "你的邮箱"',
            '重新暂存文件并再次提交',
          ],
        },
      },
    );
  }
  return parseGitAuthorIdent(result.stdout);
}

function parseCreationRecord(value) {
  const separator = value.indexOf('\0');
  if (separator <= 0) return null;
  const name = value.slice(0, separator);
  const isoDate = value.slice(separator + 1);
  const date = isoDate.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)?.[0];
  if (!date) return null;
  return Object.freeze({ name, date: date.replace('T', ' ') });
}

export function readFileCreationGitAuthor(root, filePath) {
  const result = runGit([
    'log',
    '--follow',
    '--diff-filter=A',
    '--format=%an%x00%aI',
    '--',
    filePath,
  ], { allowFailure: true, cwd: root });
  if (result.status !== 0) return null;
  const records = result.stdout
    .split(/\r?\n/)
    .map(parseCreationRecord)
    .filter(Boolean);
  return records.at(-1) ?? null;
}
