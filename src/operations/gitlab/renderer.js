export const OPERATIONS_PIPELINE_FILE = '.gitlab/ci/repo-guard-operations.yml';
export const OPERATIONS_PIPELINE_MARKER = '# repo-guard-operations:v2';

function yaml(value) {
  return JSON.stringify(value);
}

function jobHeader(name, stage, notifications = false) {
  return [
    `${yaml(name)}:`,
    `  stage: ${stage}`,
    '  allow_failure: false',
    '  variables:',
    '    GIT_DEPTH: "0"',
    '    REPO_GUARD_SKIP_HOOKS: "1"',
    ...(notifications ? ['    REPO_GUARD_OPERATIONS_NOTIFICATIONS: "true"'] : []),
  ];
}

function verificationRules() {
  return [
    '  rules:',
    `    - if: ${yaml('$CI_PIPELINE_SOURCE == "merge_request_event"')}`,
    `    - if: ${yaml('$CI_COMMIT_BRANCH')}`,
  ];
}

function scriptLines(project, command, { quality = false } = {}) {
  return [
    '  script:',
    `    - ${yaml('cd "$CI_PROJECT_DIR"')}`,
    ...(quality || project.root === '.' ? [] : [`    - ${yaml(`cd ${project.root}`)}`]),
    `    - ${yaml(command)}`,
  ];
}

function cancellationNotification(enabled) {
  if (!enabled) return [];
  return [
    '  after_script:',
    `    - ${yaml('if [ "$CI_JOB_STATUS" = "canceled" ]; then cd "$CI_PROJECT_DIR" && REPO_GUARD_OPERATIONS_NOTIFICATION=true npx --no-install repo-guard ci-notify --status canceled; fi')}`,
  ];
}

function qualityJob(project, notifications) {
  return [
    ...jobHeader(project.quality.job, '.pre', notifications),
    ...scriptLines(project, project.quality.command, { quality: true }),
    ...verificationRules(),
    ...cancellationNotification(notifications),
  ].join('\n');
}

function buildJob(project, notifications) {
  return [
    ...jobHeader(project.build.job, 'build', notifications),
    '  needs:',
    `    - job: ${yaml(project.quality.job)}`,
    '      artifacts: false',
    ...scriptLines(project, project.build.command),
    `    - ${yaml(project.build.verifyArtifactsCommand)}`,
    '  artifacts:',
    `    name: ${yaml(project.build.artifactName)}`,
    '    when: on_success',
    '    expire_in: 7 days',
    '    paths:',
    ...project.build.artifactPaths.map((artifact) => `      - ${yaml(artifact)}`),
    ...verificationRules(),
    ...cancellationNotification(notifications),
  ].join('\n');
}

function deploymentJob(project, deployment, notifications) {
  return [
    ...jobHeader(deployment.job, 'deploy', notifications),
    '  needs:',
    `    - job: ${yaml(project.quality.job)}`,
    '      artifacts: false',
    `    - job: ${yaml(project.build.job)}`,
    '      artifacts: true',
    '  environment:',
    `    name: ${yaml(deployment.environment)}`,
    `    deployment_tier: ${deployment.production ? 'production' : 'testing'}`,
    `  resource_group: ${yaml(deployment.resourceGroup)}`,
    ...scriptLines(project, deployment.command),
    '  rules:',
    ...deployment.branches.flatMap((branch) => [
      `    - if: ${yaml(`$CI_COMMIT_BRANCH == "${branch}"`)}`,
      `      when: ${deployment.production ? 'manual' : 'on_success'}`,
      '      allow_failure: false',
    ]),
    ...cancellationNotification(notifications),
  ].join('\n');
}

function notificationJob(status) {
  return [
    `${yaml(`repo_guard_operations_notify_${status}`)}:`,
    '  stage: .post',
    '  allow_failure: true',
    '  variables:',
    '    REPO_GUARD_SKIP_HOOKS: "1"',
    '    REPO_GUARD_OPERATIONS_NOTIFICATION: "true"',
    ...scriptLines({ root: '.' }, `npx --no-install repo-guard ci-notify --status ${status}`),
    `  when: ${status === 'success' ? 'on_success' : 'on_failure'}`,
    ...verificationRules(),
    ...cancellationNotification(true),
  ].join('\n');
}

export function renderOperationsGitLabPipeline(plan) {
  if (!plan.enabled || plan.projects.length === 0) return '';
  const notifications = plan.notifications?.enabled === true;
  const jobs = plan.projects.flatMap((project) => [
    qualityJob(project, notifications),
    buildJob(project, notifications),
    ...project.deployments.map((deployment) => deploymentJob(project, deployment, notifications)),
  ]);
  const allJobs = notifications ? [...jobs, notificationJob('success'), notificationJob('failed')] : jobs;
  return markManagedContent(`${OPERATIONS_PIPELINE_MARKER}\n# 工具和依赖须由 Runner 环境或上游准备流程提供。\n# 每个应用独立验证、构建和部署；部署使用本次构建的产物。\n${allJobs.join('\n\n')}\n`);
}
import { markManagedContent } from './managed-content.js';
