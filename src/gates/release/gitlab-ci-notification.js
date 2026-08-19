import { configurationError } from '../../core/error/repo-guard-error.js';
import { sendWecomNotification } from '../../integrations/wecom/notification.js';
import {
  buildGitLabCiNotificationText,
  gitLabNotificationStatus,
  shouldNotifyGitLabPipeline,
} from '../../policies/gitlab-ci-notification.js';
import { loadNotificationConfig } from '../../policies/wecom-notification.js';

const NOTIFICATION_STATUS_TEXT = Object.freeze({
  success: '成功',
  failed: '失败',
  canceled: '已取消',
});

export async function runGitLabCiNotification({
  environment = process.env,
  send = sendWecomNotification,
  status = null,
  write = () => {},
  now = new Date(),
} = {}) {
  if (environment.REPO_GUARD_PIPELINE_NOTIFICATION !== 'true') {
    throw configurationError(
      'gitlab-ci/unmanaged-notification-job',
      'GitLab CI 内置通知只能由 repo-guard 生成的托管 Job 调用',
    );
  }
  if (environment.GITLAB_CI !== 'true') {
    throw configurationError(
      'gitlab-ci/notification-untrusted-environment',
      'GitLab CI 内置通知只能在 GITLAB_CI=true 的受信环境中发送',
    );
  }
  if (status != null && !Object.hasOwn(NOTIFICATION_STATUS_TEXT, status)) {
    throw configurationError(
      'gitlab-ci/invalid-notification-status',
      'GitLab CI 流水线通知状态只支持 success、failed 或 canceled',
    );
  }

  const notificationEnvironment = status == null
    ? environment
    : { ...environment, CI_JOB_STATUS: status };
  const resolvedStatus = gitLabNotificationStatus(notificationEnvironment);
  if (!shouldNotifyGitLabPipeline(notificationEnvironment)) {
    write(`当前 GitLab 流水线通知状态为 ${resolvedStatus}，无需发送通知。`);
    return 0;
  }

  const { webhook, mentionMobiles } = loadNotificationConfig(environment, {
    requireMentionMobiles: false,
  });
  const content = buildGitLabCiNotificationText(notificationEnvironment, { now });
  await send(webhook, content, mentionMobiles);
  const statusText = NOTIFICATION_STATUS_TEXT[resolvedStatus];
  write(`GitLab 流水线${statusText}通知已发送。`);
  return 0;
}
