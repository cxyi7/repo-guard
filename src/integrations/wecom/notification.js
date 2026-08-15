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
