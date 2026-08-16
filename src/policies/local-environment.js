import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError, securityError } from '../core/error/repo-guard-error.js';
import { runGit } from '../git/execution.js';
import {
  buildManagedTextBlock,
  managedTextIsCurrent,
} from '../core/policy/managed-text-block.js';

export const LOCAL_ENV_FILE = '.env.config';
export const GIT_IGNORE_FILE = '.gitignore';
export const IGNORE_START_MARKER = '# repo-guard-managed:secrets:start';
export const IGNORE_END_MARKER = '# repo-guard-managed:secrets:end';
export const NOTIFICATION_ENV_KEYS = Object.freeze([
  'REPO_GUARD_WECOM_WEBHOOK',
  'REPO_GUARD_MENTION_MOBILES',
]);

const LOCAL_ENV_TEMPLATE = `# repo-guard 本地通知配置
# 此文件包含敏感信息，由 .gitignore 和提交门禁保护，禁止提交。

# 企业微信群机器人 Webhook
REPO_GUARD_WECOM_WEBHOOK=

# 需要提醒的手机号，多个号码使用英文逗号分隔
REPO_GUARD_MENTION_MOBILES=
`;

function localEnvironmentError(code, message, line = null) {
  return configurationError(code, message, {
    details: {
      location: { path: LOCAL_ENV_FILE, ...(line == null ? {} : { line }) },
      evidence: [{
        type: 'local-environment-configuration',
        message,
        location: { path: LOCAL_ENV_FILE, ...(line == null ? {} : { line }) },
      }],
    },
    expected: `${LOCAL_ENV_FILE} 只包含受支持且唯一的 KEY=VALUE 通知配置。`,
    remediation: {
      goal: `修正本地 ${LOCAL_ENV_FILE}，且不暴露其中的凭据`,
      steps: ['根据报告行号修正语法、变量名或重复定义'],
      constraints: ['不得把该文件或其中的值提交到版本库'],
      verification: ['运行 repo-guard doctor 并确认本地通知配置通过'],
    },
  });
}

function ensureLocalEnvTemplate(root) {
  const target = path.join(root, LOCAL_ENV_FILE);
  if (existsSync(target)) {
    return {
      created: false,
      path: target,
    };
  }

  writeFileSync(target, LOCAL_ENV_TEMPLATE, 'utf8');
  return {
    created: true,
    path: target,
  };
}

function ensureGitIgnore(root) {
  const target = path.join(root, GIT_IGNORE_FILE);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const next = buildManagedTextBlock({
    current,
    endMarker: IGNORE_END_MARKER,
    managedLines: [LOCAL_ENV_FILE],
    startMarker: IGNORE_START_MARKER,
    target: GIT_IGNORE_FILE,
  });

  if (managedTextIsCurrent(current, next)) {
    return {
      changed: false,
      path: target,
    };
  }

  writeFileSync(target, next, 'utf8');
  return {
    changed: true,
    path: target,
  };
}

function parseValue(rawValue, lineNumber) {
  const value = rawValue.trim();
  if (!value) {
    return '';
  }

  const quote = value[0];
  if (quote !== '"' && quote !== "'") {
    return value;
  }
  if (value.at(-1) !== quote) {
    throw localEnvironmentError(
      'local-env/unterminated-quoted-value',
      `${LOCAL_ENV_FILE} line ${lineNumber} 有 an unterminated quoted value`,
      lineNumber,
    );
  }
  return value.slice(1, -1);
}

export function loadLocalEnvironment(root) {
  const target = path.join(root, LOCAL_ENV_FILE);
  if (!existsSync(target)) {
    return {};
  }

  const output = {};
  const allowed = new Set(NOTIFICATION_ENV_KEYS);
  const lines = readFileSync(target, 'utf8').replace(/\r\n/g, '\n').split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(trimmed);
    if (!match) {
      throw localEnvironmentError(
        'local-env/invalid-entry',
        `${LOCAL_ENV_FILE} 第 ${index + 1} 行不是有效的 KEY=VALUE 条目`,
        index + 1,
      );
    }

    const [, key, rawValue] = match;
    if (!allowed.has(key)) {
      throw localEnvironmentError(
        'local-env/unsupported-variable',
        `${LOCAL_ENV_FILE} 第 ${index + 1} 行使用了不支持的变量：${key}`,
        index + 1,
      );
    }
    if (Object.hasOwn(output, key)) {
      throw localEnvironmentError(
        'local-env/duplicate-variable',
        `${LOCAL_ENV_FILE} 多次定义了 ${key}`,
        index + 1,
      );
    }
    output[key] = parseValue(rawValue, index + 1);
  });

  return output;
}

export function resolveNotificationEnvironment(root, environment = process.env) {
  const resolved = loadLocalEnvironment(root);
  for (const key of NOTIFICATION_ENV_KEYS) {
    if (Object.hasOwn(environment, key)) {
      resolved[key] = String(environment[key] ?? '');
    }
  }
  return resolved;
}

export function ensureLocalEnvironment(root) {
  const gitIgnore = ensureGitIgnore(root);
  const envFile = ensureLocalEnvTemplate(root);
  return {
    envFile,
    gitIgnore,
  };
}

export function getLocalEnvironmentGitStatus(root) {
  const tracked = runGit(
    ['ls-files', '--error-unmatch', '--', LOCAL_ENV_FILE],
    { allowFailure: true, cwd: root },
  ).status === 0;
  const ignored = runGit(
    ['check-ignore', '-q', '--', LOCAL_ENV_FILE],
    { allowFailure: true, cwd: root },
  ).status === 0;

  return {
    ignored,
    tracked,
  };
}

export function assertLocalEnvironmentNotStaged(changes) {
  const leaked = changes.find((change) => {
    const touchesSecret = change.path === LOCAL_ENV_FILE
      || change.oldPath === LOCAL_ENV_FILE;
    const removesTrackedSecret = change.status === 'D'
      && change.path === LOCAL_ENV_FILE
      && !change.oldPath;
    return touchesSecret && !removesTrackedSecret;
  });

  if (!leaked) {
    return;
  }

  throw securityError(
    'local-env/staged-secret-file',
    `${LOCAL_ENV_FILE} 包含本地密钥，不得提交。\n`
    + `请运行 "git restore --staged -- ${LOCAL_ENV_FILE}"。如果该文件已被跟踪，`
    + `请运行 "git rm --cached -- ${LOCAL_ENV_FILE}"。`,
    {
      details: {
        location: { path: LOCAL_ENV_FILE },
        evidence: [{
          type: 'staged-secret-file',
          message: `${LOCAL_ENV_FILE} 出现在暂存变更集中`,
          location: { path: LOCAL_ENV_FILE },
        }],
      },
      expected: `${LOCAL_ENV_FILE} 必须保持为本地忽略文件，且不得出现在任何提交中。`,
      remediation: {
        goal: '从暂存区移除本地凭据文件，但保留需要的本地副本',
        steps: [`运行 git restore --staged -- ${LOCAL_ENV_FILE}`],
        constraints: ['不得读取、打印或提交文件中的凭据'],
        verification: [`运行 git status --short -- ${LOCAL_ENV_FILE} 并确认它未被暂存`],
      },
    },
  );
}
