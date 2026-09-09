import assert from 'node:assert/strict';
import test from 'node:test';
import { runGitLabCiNotification } from '../../src/operations/notifications/gitlab-ci-notification.js';
import { sendMutationTestFailureNotification } from '../../src/gates/release/mutation-test-notification.js';
import { executionError } from '../../src/core/error/repo-guard-error.js';

const environment = {
  GITLAB_CI: 'true',
  REPO_GUARD_OPERATIONS_NOTIFICATION: 'true',
  REPO_GUARD_WECOM_WEBHOOK: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key',
};

test('独立运维通知明确发送最终状态，只接受新托管标记和 GitLab 环境', async () => {
  for (const status of ['success', 'failed', 'canceled']) {
    const deliveries = [];
    assert.equal(await runGitLabCiNotification({ environment, status, send: async (...args) => deliveries.push(args) }), 0);
    assert.equal(deliveries.length, 1);
    assert.ok(deliveries[0][1].includes(`（${status}）`));
  }
  await assert.rejects(() => runGitLabCiNotification({
    environment: { ...environment, REPO_GUARD_OPERATIONS_NOTIFICATION: undefined, REPO_GUARD_PIPELINE_NOTIFICATION: 'true' },
  }), /旧发布模板不再支持，请按当前独立运维重新接入/);
  await assert.rejects(() => runGitLabCiNotification({
    environment: { ...environment, GITLAB_CI: 'false' },
  }), /GITLAB_CI=true/);
});

test('通知凭据缺失或发送失败返回失败，不把通知失败误报为成功', async () => {
  await assert.rejects(() => runGitLabCiNotification({
    environment: { ...environment, REPO_GUARD_WECOM_WEBHOOK: undefined }, status: 'failed',
  }), /未配置 REPO_GUARD_WECOM_WEBHOOK/);
  await assert.rejects(() => runGitLabCiNotification({
    environment, status: 'failed', send: async () => { throw executionError('notification/send-failed', '模拟发送失败'); },
  }), /模拟发送失败/);
});

test('变异测试通知仅在新运维明确托管通知时去重，不读取旧发布配置', async () => {
  const args = {
    root: process.cwd(),
    config: { version: 2, reporting: { notification: { enabled: true } } },
    build: { notifyOnFailure: true },
    result: {},
    environment: { GITLAB_CI: 'true', REPO_GUARD_OPERATIONS_NOTIFICATIONS: 'true' },
    send: async () => assert.fail('已由运维托管时不应单独发送'),
  };
  assert.equal(await sendMutationTestFailureNotification(args), 'managed-operations');
  await assert.rejects(() => sendMutationTestFailureNotification({
    ...args, environment: { GITLAB_CI: 'true', REPO_GUARD_PIPELINE_NOTIFICATION: 'true' },
  }), /未配置 REPO_GUARD_WECOM_WEBHOOK/);
  assert.equal(await sendMutationTestFailureNotification({
    ...args, config: { version: 2, reporting: { notification: { enabled: false } } },
  }), 'disabled');
});
