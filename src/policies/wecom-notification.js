import path from 'node:path';
import { configurationError } from '../core/error/repo-guard-error.js';
import { displayPath } from './change-classification.js';
import { gitValue } from '../git/execution.js';

const WECOM_HOST = 'qyapi.weixin.qq.com';
const WECOM_PATH = '/cgi-bin/webhook/send';
const MAX_TEXT_BYTES = 2048;

export function loadNotificationConfig(environment = process.env, {
  requireMentionMobiles = true,
} = {}) {
  const rawWebhook = environment.REPO_GUARD_WECOM_WEBHOOK?.trim() || '';
  const rawMobiles = environment.REPO_GUARD_MENTION_MOBILES?.trim() || '';

  if (!rawWebhook) {
    throw configurationError('wecom/missing-webhook', '未配置 REPO_GUARD_WECOM_WEBHOOK');
  }

  let webhook;
  try {
    webhook = new URL(rawWebhook);
  } catch {
    throw configurationError('wecom/invalid-webhook-url', 'REPO_GUARD_WECOM_WEBHOOK 不是有效 URL');
  }

  if (
    webhook.protocol !== 'https:'
    || webhook.hostname !== WECOM_HOST
    || webhook.pathname !== WECOM_PATH
    || !webhook.searchParams.get('key')
  ) {
    throw configurationError('wecom/untrusted-webhook-endpoint', 'REPO_GUARD_WECOM_WEBHOOK 未指向可信的企业微信端点');
  }

  const mentionMobiles = [...new Set(
    rawMobiles
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )];

  if (requireMentionMobiles && mentionMobiles.length === 0) {
    throw configurationError('wecom/missing-mention-mobiles', '未配置 REPO_GUARD_MENTION_MOBILES');
  }
  if (mentionMobiles.some((mobile) => !/^1\d{10}$/.test(mobile))) {
    throw configurationError('wecom/invalid-mention-mobile', 'REPO_GUARD_MENTION_MOBILES 包含无效手机号');
  }

  return { webhook, mentionMobiles };
}

function sanitizeLine(value) {
  return String(value).replace(/[\r\n]/g, ' ');
}

function sanitizeRemoteUrl(root) {
  const remote = gitValue(['config', '--get', 'remote.origin.url'], '未配置', root);
  try {
    const parsed = new URL(remote);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    const scp = /^(?:[^@\s]+@)?([^:\s]+):([^?#]+)(?:[?#].*)?$/.exec(remote);
    if (scp) {
      return `${scp[1]}:${scp[2]}`;
    }
    return '无法识别的远程仓库（已脱敏）';
  }
}

function truncateUtf8(value, maxBytes) {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }

  const suffix = '\n受保护文件列表过长，消息已截断。';
  const limit = maxBytes - Buffer.byteLength(suffix, 'utf8');
  let output = '';

  for (const character of value) {
    if (Buffer.byteLength(output + character, 'utf8') > limit) {
      break;
    }
    output += character;
  }

  return output + suffix;
}

export function buildNotificationText(root, changes, fingerprint) {
  const branch = gitValue(['symbolic-ref', '--short', '-q', 'HEAD'], '游离状态', root);
  const head = gitValue(['rev-parse', '--short=12', 'HEAD'], '初始提交', root);
  const userName = gitValue(['config', '--get', 'user.name'], '未配置', root);
  const userEmail = gitValue(['config', '--get', 'user.email'], '', root);
  const actor = userEmail ? `${userName} <${userEmail}>` : userName;
  const shortstat = gitValue(['diff', '--cached', '--shortstat'], '无统计信息', root);

  const lines = [
    '【Protected repository files changed】',
    `Project: ${sanitizeLine(path.basename(root))}`,
    `Remote: ${sanitizeLine(sanitizeRemoteUrl(root))}`,
    `Branch: ${sanitizeLine(branch)}`,
    `Actor: ${sanitizeLine(actor)}`,
    `Base commit: ${sanitizeLine(head)}`,
    `Staged summary: ${sanitizeLine(shortstat)}`,
    `Detected at: ${new Date().toISOString()}`,
    `Fingerprint: ${sanitizeLine(fingerprint)}`,
    '',
    `Protected files (${changes.length}):`,
    ...changes.map(
      (change) => (
        `- [${sanitizeLine(change.category)}] ${change.status} `
        + sanitizeLine(displayPath(change))
      ),
    ),
    '',
    '此处仅包含元数据，请在 Git 中审查暂存差异。',
  ];

  return truncateUtf8(lines.join('\n'), MAX_TEXT_BYTES);
}
