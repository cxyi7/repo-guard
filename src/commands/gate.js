import { loadConfig } from '../config.js';
import {
  classifyChanges,
  collectStagedChanges,
} from '../git-changes.js';
import { createStagedFingerprint } from '../fingerprint.js';
import { findRepositoryRoot } from '../git.js';
import {
  assertLocalEnvironmentNotStaged,
  resolveNotificationEnvironment,
} from '../local-env.js';
import { printProtectedChanges } from '../report.js';
import {
  notificationWasSent,
  saveNotificationState,
} from '../state.js';
import {
  buildNotificationText,
  loadNotificationConfig,
  sendWecomNotification,
} from '../wecom.js';

export async function runGate({
  cwd = process.cwd(),
  dryRun = false,
  forceNotify = false,
} = {}) {
  const root = findRepositoryRoot(cwd);
  const config = loadConfig(root);
  const stagedChanges = collectStagedChanges(root);
  assertLocalEnvironmentNotStaged(stagedChanges);
  const protectedChanges = classifyChanges(stagedChanges, config);

  if (protectedChanges.length === 0) {
    console.log('repo-guard gate passed: staged changes do not include protected files.');
    return 0;
  }

  console.log(`repo-guard detected ${protectedChanges.length} protected staged change(s):`);
  printProtectedChanges(protectedChanges);

  const notifyChanges = protectedChanges.filter(({ level }) => level === 'notify');
  if (notifyChanges.length === 0) {
    console.log('repo-guard gate passed: all protected changes are audit-only.');
    return 0;
  }

  const fingerprint = createStagedFingerprint(root, notifyChanges);
  const content = buildNotificationText(root, notifyChanges, fingerprint);
  console.log(`Fingerprint: ${fingerprint}`);

  if (dryRun) {
    console.log('WeCom notification preview:');
    console.log(content);
    return 0;
  }

  if (!forceNotify && notificationWasSent(root, fingerprint)) {
    console.log('The same staged tree has already been reported; duplicate notification skipped.');
    return 0;
  }

  const { webhook, mentionMobiles } = loadNotificationConfig(
    resolveNotificationEnvironment(root),
  );
  await sendWecomNotification(webhook, content, mentionMobiles);
  saveNotificationState(root, fingerprint);
  console.log('WeCom notification sent; commit may continue.');
  return 0;
}
