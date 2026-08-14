import https from 'node:https';
import path from 'node:path';
import {
  configurationError,
  executionError,
  toRepoGuardError,
} from './core/error/repo-guard-error.js';
import { displayPath } from './git-changes.js';
import { gitValue } from './git.js';

const WECOM_HOST = 'qyapi.weixin.qq.com';
const WECOM_PATH = '/cgi-bin/webhook/send';
const MAX_TEXT_BYTES = 2048;

export function loadNotificationConfig(environment = process.env) {
  const rawWebhook = environment.REPO_GUARD_WECOM_WEBHOOK?.trim() || '';
  const rawMobiles = environment.REPO_GUARD_MENTION_MOBILES?.trim() || '';

  if (!rawWebhook) {
    throw configurationError('wecom/missing-webhook', 'REPO_GUARD_WECOM_WEBHOOK is not configured');
  }

  let webhook;
  try {
    webhook = new URL(rawWebhook);
  } catch {
    throw configurationError('wecom/invalid-webhook-url', 'REPO_GUARD_WECOM_WEBHOOK is not a valid URL');
  }

  if (
    webhook.protocol !== 'https:'
    || webhook.hostname !== WECOM_HOST
    || webhook.pathname !== WECOM_PATH
    || !webhook.searchParams.get('key')
  ) {
    throw configurationError('wecom/untrusted-webhook-endpoint', 'REPO_GUARD_WECOM_WEBHOOK does not target the trusted WeCom endpoint');
  }

  const mentionMobiles = [...new Set(
    rawMobiles
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )];

  if (mentionMobiles.length === 0) {
    throw configurationError('wecom/missing-mention-mobiles', 'REPO_GUARD_MENTION_MOBILES is not configured');
  }
  if (mentionMobiles.some((mobile) => !/^1\d{10}$/.test(mobile))) {
    throw configurationError('wecom/invalid-mention-mobile', 'REPO_GUARD_MENTION_MOBILES contains an invalid mobile number');
  }

  return { webhook, mentionMobiles };
}

function sanitizeLine(value) {
  return String(value).replace(/[\r\n]/g, ' ');
}

function sanitizeRemoteUrl(root) {
  const remote = gitValue(['config', '--get', 'remote.origin.url'], 'not configured', root);
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
    return 'unrecognized remote (redacted)';
  }
}

function truncateUtf8(value, maxBytes) {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }

  const suffix = '\nMessage truncated because the protected file list is too long.';
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
  const branch = gitValue(['symbolic-ref', '--short', '-q', 'HEAD'], 'DETACHED', root);
  const head = gitValue(['rev-parse', '--short=12', 'HEAD'], 'INITIAL', root);
  const userName = gitValue(['config', '--get', 'user.name'], 'not configured', root);
  const userEmail = gitValue(['config', '--get', 'user.email'], '', root);
  const actor = userEmail ? `${userName} <${userEmail}>` : userName;
  const shortstat = gitValue(['diff', '--cached', '--shortstat'], 'no statistics', root);

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
    'Only metadata is included. Review the staged diff in Git.',
  ];

  return truncateUtf8(lines.join('\n'), MAX_TEXT_BYTES);
}

export function sendWecomNotification(webhook, content, mentionMobiles) {
  const payload = JSON.stringify({
    msgtype: 'text',
    text: {
      content,
      mentioned_mobile_list: mentionMobiles,
    },
  });

  return new Promise((resolve, reject) => {
    const request = https.request(
      webhook,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10_000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          let result;
          try {
            result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            reject(executionError('wecom/invalid-response', 'WeCom returned a non-JSON response'));
            return;
          }

          if (result.errcode !== 0) {
            reject(
              executionError(
                'wecom/api-rejected-notification',
                `WeCom notification failed: errcode=${result.errcode}, `
                + `errmsg=${result.errmsg || 'unknown error'}`,
              ),
            );
            return;
          }

          resolve();
        });
      },
    );

    request.on('timeout', () => request.destroy(executionError('wecom/timeout', 'WeCom request timed out')));
    request.on('error', (error) => reject(toRepoGuardError(error, {
      kind: 'execution',
      code: 'wecom/request-failed',
      message: `WeCom notification failed: ${error.message}`,
    })));
    request.end(payload);
  });
}
