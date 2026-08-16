import https from 'node:https';
import {
  executionError,
  toRepoGuardError,
} from '../../core/error/repo-guard-error.js';

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
            reject(executionError('wecom/invalid-response', '企业微信返回了非 JSON 响应'));
            return;
          }

          if (result.errcode !== 0) {
            reject(
              executionError(
                'wecom/api-rejected-notification',
                `企业微信通知失败：errcode=${result.errcode}，`
                + `错误信息（errmsg）=${result.errmsg || '未知错误'}`,
              ),
            );
            return;
          }

          resolve();
        });
      },
    );

    request.on('timeout', () => request.destroy(executionError('wecom/timeout', '企业微信请求超时')));
    request.on('error', (error) => reject(toRepoGuardError(error, {
      kind: 'execution',
      code: 'wecom/request-failed',
      message: `企业微信通知失败：${error.message}`,
    })));
    request.end(payload);
  });
}
