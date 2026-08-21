import { sendWecomNotification } from '../../integrations/wecom/notification.js';
import { buildMutationTestNotification } from '../../policies/mutation-test-notification.js';
import { resolveNotificationEnvironment } from '../../policies/local-environment.js';
import { loadNotificationConfig } from '../../policies/wecom-notification.js';

export async function sendMutationTestFailureNotification({
  root,
  config,
  build,
  result,
  environment,
  send = sendWecomNotification,
}) {
  if (!build.notifyOnFailure || !config.notification.enabled) return 'disabled';
  if (environment.GITLAB_CI === 'true' && config.ci.pipeline.notifications) {
    return 'managed-pipeline';
  }
  const { webhook, mentionMobiles } = loadNotificationConfig(
    resolveNotificationEnvironment(root, environment),
  );
  await send(webhook, buildMutationTestNotification(root, build, result), mentionMobiles);
  return 'sent';
}
