import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { repoGuardPackageVersion } from '../src/core/project/repo-guard-package.js';
import { runGitLabCiNotification } from '../src/gates/release/gitlab-ci-notification.js';
import {
  buildGitLabCiNotificationText,
  gitLabNotificationStatus,
  shouldNotifyGitLabPipeline,
} from '../src/policies/gitlab-ci-notification.js';
import { loadNotificationConfig } from '../src/policies/wecom-notification.js';

const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key';

function gitLabEnvironment(overrides = {}) {
  return {
    GITLAB_CI: 'true',
    REPO_GUARD_PIPELINE_NOTIFICATION: 'true',
    REPO_GUARD_WECOM_WEBHOOK: WEBHOOK,
    CI_JOB_STATUS: 'success',
    CI_PROJECT_PATH: 'group/project',
    CI_PIPELINE_IID: '42',
    CI_COMMIT_REF_NAME: 'main',
    CI_COMMIT_SHORT_SHA: 'abc12345',
    CI_COMMIT_TITLE: '发布通知',
    CI_COMMIT_AUTHOR: '研发同学',
    CI_PIPELINE_URL: 'https://gitlab.example.com/group/project/-/pipelines/42',
    ...overrides,
  };
}

test('reads the restored repo-guard package version used by managed notification jobs', () => {
  assert.equal(repoGuardPackageVersion(), '1.18.0');
});

test('recognizes final GitLab success, failure, and cancellation statuses', () => {
  assert.equal(gitLabNotificationStatus({ CI_JOB_STATUS: ' success ' }), 'success');
  assert.equal(gitLabNotificationStatus({}), 'unknown');
  assert.equal(shouldNotifyGitLabPipeline({ CI_JOB_STATUS: 'success' }), true);
  assert.equal(shouldNotifyGitLabPipeline({ CI_JOB_STATUS: 'failed' }), true);
  assert.equal(shouldNotifyGitLabPipeline({ CI_JOB_STATUS: 'canceled' }), true);
});

test('builds a single-line-safe Chinese GitLab notification', () => {
  const content = buildGitLabCiNotificationText(gitLabEnvironment({
    CI_COMMIT_TITLE: '修复发布\n流程',
  }), {
    now: new Date('2026-08-18T15:19:03.000Z'),
  });

  assert.match(content, /^✅【GitLab 流水线成功】/);
  assert.match(content, /项目：group\/project/);
  assert.match(content, /流水线编号：42/);
  assert.match(content, /分支：main/);
  assert.match(content, /提交：abc12345 修复发布 流程/);
  assert.match(content, /提交人：研发同学/);
  assert.match(content, /状态：成功（success）/);
  assert.match(content, /通知时间：2026-08-18 23:19:03/);
  assert.doesNotMatch(content, /\r/);
});

test('keeps only the first ten commit-title characters and appends an ellipsis', () => {
  const content = buildGitLabCiNotificationText(gitLabEnvironment({
    CI_COMMIT_TITLE: '一二三四五六七八九十十一十二',
  }));

  assert.match(content, /提交：abc12345 一二三四五六七八九十…/);
  assert.doesNotMatch(content, /十一十二/);
});

test('truncates oversized GitLab notification text on a UTF-8 boundary', () => {
  const content = buildGitLabCiNotificationText(gitLabEnvironment({
    CI_PROJECT_PATH: '长'.repeat(2000),
  }));

  assert.match(content, /消息过长，已截断。$/);
  assert.ok(Buffer.byteLength(content, 'utf8') <= 1900);
});

test('keeps mention mobiles mandatory locally but optional for built-in CI notifications', () => {
  assert.throws(
    () => loadNotificationConfig({ REPO_GUARD_WECOM_WEBHOOK: WEBHOOK }),
    /REPO_GUARD_MENTION_MOBILES/,
  );
  assert.deepEqual(
    loadNotificationConfig(
      { REPO_GUARD_WECOM_WEBHOOK: WEBHOOK },
      { requireMentionMobiles: false },
    ).mentionMobiles,
    [],
  );
});

test('rejects direct, non-GitLab, and forged notification execution', async () => {
  await assert.rejects(
    () => runGitLabCiNotification({ environment: gitLabEnvironment({
      REPO_GUARD_PIPELINE_NOTIFICATION: 'false',
    }) }),
    /只能由 repo-guard 生成的托管 Job 调用/,
  );
  await assert.rejects(
    () => runGitLabCiNotification({ environment: gitLabEnvironment({ GITLAB_CI: 'false' }) }),
    /只能在 GITLAB_CI=true 的受信环境中发送/,
  );
  await assert.rejects(
    () => runGitLabCiNotification({
      environment: gitLabEnvironment(),
      status: 'skipped',
    }),
    /只支持 success、failed 或 canceled/,
  );
});

test('exposes the guarded GitLab notification command through the package CLI', () => {
  const cli = path.join(process.cwd(), 'bin', 'repo-guard.js');
  const execution = spawnSync(process.execPath, [cli, 'ci-notify', '--status', 'success'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITLAB_CI: 'true',
      REPO_GUARD_PIPELINE_NOTIFICATION: 'false',
    },
  });

  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /只能由 repo-guard 生成的托管 Job 调用/);
});

test('sends an explicit notification when a managed GitLab job is canceled', async () => {
  const deliveries = [];
  const messages = [];
  const exitCode = await runGitLabCiNotification({
    environment: gitLabEnvironment(),
    status: 'canceled',
    send: async (...argumentsList) => deliveries.push(argumentsList),
    write: (message) => messages.push(message),
  });

  assert.equal(exitCode, 0);
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0][1], /^⏹️【GitLab 流水线已取消】/);
  assert.match(deliveries[0][1], /状态：已取消（canceled）/);
  assert.deepEqual(messages, ['GitLab 流水线已取消通知已发送。']);
});

test('sends one final notification without requiring mention mobiles', async () => {
  const deliveries = [];
  const messages = [];
  const exitCode = await runGitLabCiNotification({
    environment: gitLabEnvironment({ REPO_GUARD_MENTION_MOBILES: undefined }),
    status: 'failed',
    now: new Date('2026-08-18T15:19:03.000Z'),
    send: async (...argumentsList) => deliveries.push(argumentsList),
    write: (message) => messages.push(message),
  });

  assert.equal(exitCode, 0);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0][0].toString(), WEBHOOK);
  assert.match(deliveries[0][1], /^❌【GitLab 流水线失败】/);
  assert.deepEqual(deliveries[0][2], []);
  assert.deepEqual(messages, ['GitLab 流水线失败通知已发送。']);
});

test('skips non-final statuses without reading credentials or sending', async () => {
  let sent = false;
  const messages = [];
  const exitCode = await runGitLabCiNotification({
    environment: {
      GITLAB_CI: 'true',
      REPO_GUARD_PIPELINE_NOTIFICATION: 'true',
      CI_JOB_STATUS: 'running',
    },
    send: async () => { sent = true; },
    write: (message) => messages.push(message),
  });

  assert.equal(exitCode, 0);
  assert.equal(sent, false);
  assert.deepEqual(messages, ['当前 GitLab 流水线通知状态为 running，无需发送通知。']);
});
