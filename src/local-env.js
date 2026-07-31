import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { runGit } from './git.js';
import { buildManagedTextBlock } from './managed-text-block.js';

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

  if (next === current) {
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
    throw new Error(`${LOCAL_ENV_FILE} line ${lineNumber} has an unterminated quoted value`);
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
      throw new Error(`${LOCAL_ENV_FILE} line ${index + 1} is not a valid KEY=VALUE entry`);
    }

    const [, key, rawValue] = match;
    if (!allowed.has(key)) {
      throw new Error(`${LOCAL_ENV_FILE} line ${index + 1} uses unsupported variable: ${key}`);
    }
    if (Object.hasOwn(output, key)) {
      throw new Error(`${LOCAL_ENV_FILE} defines ${key} more than once`);
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

  throw new Error(
    `${LOCAL_ENV_FILE} contains local secrets and must not be committed.\n`
    + `Run "git restore --staged -- ${LOCAL_ENV_FILE}". If it was already tracked, `
    + `run "git rm --cached -- ${LOCAL_ENV_FILE}".`,
  );
}
