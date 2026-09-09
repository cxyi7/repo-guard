export const OPERATIONS_PIPELINE_FILE = '.gitlab/ci/repo-guard-operations.yml';
export const OPERATIONS_PIPELINE_MARKER = '# repo-guard-operations:v2';

function yaml(value) {
  return JSON.stringify(value);
}

function jobHeader(name, stage) {
  return [
    `${yaml(name)}:`,
    `  stage: ${stage}`,
    '  allow_failure: false',
    '  variables:',
    '    GIT_DEPTH: "0"',
    '    REPO_GUARD_SKIP_HOOKS: "1"',
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

function qualityJob(project) {
  return [
    ...jobHeader(project.quality.job, '.pre'),
    ...scriptLines(project, project.quality.command, { quality: true }),
    ...verificationRules(),
  ].join('\n');
}

function buildJob(project) {
  return [
    ...jobHeader(project.build.job, 'build'),
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
  ].join('\n');
}

function deploymentJob(project, deployment) {
  return [
    ...jobHeader(deployment.job, 'deploy'),
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
  ].join('\n');
}

export function renderOperationsGitLabPipeline(plan) {
  if (!plan.enabled || plan.projects.length === 0) return '';
  const jobs = plan.projects.flatMap((project) => [
    qualityJob(project),
    buildJob(project),
    ...project.deployments.map((deployment) => deploymentJob(project, deployment)),
  ]);
  return `${OPERATIONS_PIPELINE_MARKER}\n# 工具和依赖须由 Runner 环境或上游准备流程提供。\n# 每个应用独立验证、构建和部署；部署使用本次构建的产物。\n${jobs.join('\n\n')}\n`;
}
