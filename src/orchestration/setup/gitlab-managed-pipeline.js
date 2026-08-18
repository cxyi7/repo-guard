export const MANAGED_PIPELINE_JOB_NAMES = Object.freeze([
  'repo_guard_verify',
  'repo_guard_deploy_test',
  'repo_guard_deploy_production',
  'repo_guard_deploy_quick',
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

function notificationBlock(enabled) {
  return enabled ? '\n  after_script:\n    - npm run ci:notify' : '';
}

function pipelineJobs(pipeline) {
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
    - npm run ci:verify
  rules:
${verifyExclusions ? `${verifyExclusions}\n` : ''}    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH'`;

  const testDeploymentJob = `repo_guard_deploy_test:
  extends: ${base}
  image: ${pipeline.deployImage}
  stage: ${pipeline.deployStage}
${tagsBlock(pipeline.runnerTags)}
  script:
    - npm run ci:deploy:test${notificationBlock(pipeline.notifications)}
  rules:
${branchRules(pipeline.testBranches)}`;

  const productionJobs = pipeline.productionBranches.length > 0
    ? [`repo_guard_deploy_production:
  extends: ${base}
  image: ${pipeline.deployImage}
  stage: ${pipeline.deployStage}
${tagsBlock(pipeline.runnerTags)}
  script:
    - npm run ci:deploy:production${notificationBlock(pipeline.notifications)}
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
    - npm run ci:deploy:quick${notificationBlock(pipeline.notifications)}
  rules:
    - if: '$CI_COMMIT_BRANCH'
      when: manual
      allow_failure: true`]
    : [];
  return [
    verifyJob,
    testDeploymentJob,
    ...productionJobs,
    ...quickDeploymentJobs,
  ];
}

export function renderManagedPipelineRoot(pipeline) {
  if (!pipeline.enabled) return Object.freeze({ gateOverrides: '', jobs: '' });
  const gateTags = pipeline.runnerTags.length > 0
    ? `\n${tagsBlock(pipeline.runnerTags)}`
    : '';
  return Object.freeze({
    gateOverrides: `${gateTags}\n  rules:\n    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'\n    - if: '$CI_COMMIT_BRANCH'`,
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
    ...(pipeline.notifications ? ['ci:notify'] : []),
  ];
}
