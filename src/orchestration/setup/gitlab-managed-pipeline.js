import { repoGuardPackageVersion } from '../../core/project/repo-guard-package.js';

const NOTIFICATION_PACKAGE_DIRECTORY = '"$CI_BUILDS_DIR/.repo-guard-notify-$CI_PROJECT_ID-$CI_PIPELINE_ID-$CI_JOB_ID"';
const NOTIFICATION_PACKAGE_CLI = '"$CI_BUILDS_DIR/.repo-guard-notify-$CI_PROJECT_ID-$CI_PIPELINE_ID-$CI_JOB_ID/node_modules/@cxyi7/repo-guard/bin/repo-guard.js"';

export const MANAGED_PIPELINE_JOB_NAMES = Object.freeze([
  'repo_guard_verify',
  'repo_guard_deploy_test',
  'repo_guard_deploy_production',
  'repo_guard_deploy_quick',
  'repo_guard_notify_success',
  'repo_guard_notify_failure',
]);

function escapeRegex(value) {
  return value.replace(/[\\^$+.()|[\]{}]/g, '\\$&');
}

function branchCondition(pattern) {
  if (!pattern.includes('*')) return `$CI_COMMIT_BRANCH == "${pattern}"`;
  const regex = escapeRegex(pattern).replaceAll('*', '.*').replaceAll('/', '\\/');
  return `$CI_COMMIT_BRANCH =~ /^${regex}$/`;
}

function branchRules(branches, { when = null, allowFailure = null } = {}) {
  return branches.map((branch) => [
    `    - if: '${branchCondition(branch)}'`,
    ...(when ? [`      when: ${when}`] : []),
    ...(allowFailure != null ? [`      allow_failure: ${allowFailure}`] : []),
  ].join('\n')).join('\n');
}

function tagsBlock(tags) {
  return tags.length > 0
    ? `  tags:\n${tags.map((tag) => `    - ${tag}`).join('\n')}`
    : '';
}

function notificationInstallCommand(packageVersion) {
  const packageUrl = `https://registry.npmjs.org/@cxyi7/repo-guard/-/repo-guard-${packageVersion}.tgz`;
  return `npm install --ignore-scripts --no-save --package-lock=false --audit=false --fund=false --prefix ${NOTIFICATION_PACKAGE_DIRECTORY} ${packageUrl}`;
}

function notificationCommand(packageVersion, status) {
  return [
    notificationInstallCommand(packageVersion),
    `REPO_GUARD_PIPELINE_NOTIFICATION=true node ${NOTIFICATION_PACKAGE_CLI} ci-notify --status ${status}`,
  ];
}

function cancellationNotificationBlock(enabled, packageVersion) {
  if (!enabled) return '';
  const command = notificationCommand(packageVersion, 'canceled').join(' && ');
  return `\n  after_script:\n    - if [ "$CI_JOB_STATUS" = "canceled" ]; then ${command}; fi`;
}

function pipelineJobs(pipeline) {
  const packageVersion = repoGuardPackageVersion();
  const base = pipeline.legacyPeerDeps
    ? '.repo_guard_pipeline_legacy_peer_deps_base'
    : '.repo_guard_pipeline_base';
  const excludedBranches = [...new Set([
    ...pipeline.testBranches,
    ...pipeline.productionBranches,
  ])];
  const verifyExclusions = branchRules(excludedBranches, { when: 'never' });
  const verifyJob = `repo_guard_verify:
  extends: ${base}
  image: ${pipeline.verifyImage}
  stage: ${pipeline.verifyStage}
${tagsBlock(pipeline.runnerTags)}
  script:
    - npm run ci:verify${pipeline.notifications ? '\n  interruptible: true' : ''}${cancellationNotificationBlock(pipeline.notifications, packageVersion)}
  rules:
${verifyExclusions ? `${verifyExclusions}\n` : ''}    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH'`;

  const testDeploymentJob = `repo_guard_deploy_test:
  extends: ${base}
  image: ${pipeline.deployImage}
  stage: ${pipeline.deployStage}
${tagsBlock(pipeline.runnerTags)}
  script:
    - npm run ci:deploy:test${cancellationNotificationBlock(pipeline.notifications, packageVersion)}
  rules:
${branchRules(pipeline.testBranches)}`;

  const productionJobs = pipeline.productionBranches.length > 0
    ? [`repo_guard_deploy_production:
  extends: ${base}
  image: ${pipeline.deployImage}
  stage: ${pipeline.deployStage}
${tagsBlock(pipeline.runnerTags)}
  script:
    - npm run ci:deploy:production${cancellationNotificationBlock(pipeline.notifications, packageVersion)}
  rules:
${branchRules(pipeline.productionBranches, { when: 'manual' })}
  allow_failure: false`]
    : [];

  const quickDeploymentJobs = pipeline.quickDeploy
    ? [`repo_guard_deploy_quick:
  extends: ${base}
  image: ${pipeline.deployImage}
  stage: ${pipeline.deployStage}
${tagsBlock(pipeline.runnerTags)}
  script:
    - npm run ci:deploy:quick${cancellationNotificationBlock(pipeline.notifications, packageVersion)}
  rules:
    - if: '$CI_COMMIT_BRANCH'
      when: manual
      allow_failure: true`]
    : [];
  const notificationJobs = pipeline.notifications
    ? [
      `repo_guard_notify_success:
  image: ${pipeline.verifyImage}
  stage: .post
${tagsBlock(pipeline.runnerTags)}
  before_script: []
  script:
${notificationCommand(packageVersion, 'success').map((command) => `    - ${command}`).join('\n')}${cancellationNotificationBlock(true, packageVersion)}
  when: on_success
  allow_failure: true`,
      `repo_guard_notify_failure:
  image: ${pipeline.verifyImage}
  stage: .post
${tagsBlock(pipeline.runnerTags)}
  before_script: []
  script:
${notificationCommand(packageVersion, 'failed').map((command) => `    - ${command}`).join('\n')}${cancellationNotificationBlock(true, packageVersion)}
  when: on_failure
  allow_failure: true`,
    ]
    : [];
  return [
    verifyJob,
    testDeploymentJob,
    ...productionJobs,
    ...quickDeploymentJobs,
    ...notificationJobs,
  ];
}

export function renderManagedPipelineRoot(pipeline) {
  if (!pipeline.enabled) return Object.freeze({ gateOverrides: '', jobs: '' });
  const gateTags = pipeline.runnerTags.length > 0
    ? `\n${tagsBlock(pipeline.runnerTags)}`
    : '';
  const packageVersion = repoGuardPackageVersion();
  const cancellation = pipeline.notifications
    ? `\n  interruptible: true${cancellationNotificationBlock(true, packageVersion)}`
    : '';
  return Object.freeze({
    gateOverrides: `${gateTags}${cancellation}\n  rules:\n    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'\n    - if: '$CI_COMMIT_BRANCH'`,
    jobs: `\n\n${pipelineJobs(pipeline).join('\n\n')}`,
  });
}

export function requiredManagedPipelineScripts(pipeline) {
  if (!pipeline.enabled) return [];
  return [
    'ci:verify',
    'ci:deploy:test',
    ...(pipeline.productionBranches.length > 0 ? ['ci:deploy:production'] : []),
    ...(pipeline.quickDeploy ? ['ci:deploy:quick'] : []),
  ];
}
