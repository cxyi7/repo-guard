import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { configureCi } from './config-management.js';
import { loadConfig } from '../../config/configuration-loader.js';
import { configurationError, securityError } from '../../core/error/repo-guard-error.js';

export const GITLAB_CI_FILE = '.gitlab-ci.yml';
export const GITLAB_TEMPLATE_FILE = '.gitlab/ci/repo-guard.yml';
const TEMPLATE_MARKER = '# repo-guard-gitlab-template:v1';
const ROOT_BEGIN = '# repo-guard-gitlab:start';
const ROOT_END = '# repo-guard-gitlab:end';
const DEFAULT_GITLAB_STAGES = Object.freeze(['.pre', 'build', 'test', 'deploy', '.post']);

function normalizeNewlines(content) {
  return content.replace(/\r\n/g, '\n');
}

function isManagedTemplate(content) {
  return normalizeNewlines(content).startsWith(`${TEMPLATE_MARKER}\n`);
}

function directDependencyVersion(root) {
  const packagePath = path.join(root, 'package.json');
  if (!existsSync(packagePath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
    return manifest.devDependencies?.['@cxyi7/repo-guard']
      ?? manifest.dependencies?.['@cxyi7/repo-guard']
      ?? manifest.optionalDependencies?.['@cxyi7/repo-guard']
      ?? null;
  } catch {
    return null;
  }
}

function rootJobContent(content) {
  return /^repo_guard:\s*\r?\n((?:^[ \t]+.*(?:\r?\n|$))*)/m.exec(content)?.[1] ?? '';
}

function templateContent() {
  return `${TEMPLATE_MARKER}
.repo_guard_base:
  image: node:22.23.2
  variables:
    GIT_DEPTH: "0"
    REPO_GUARD_SKIP_HOOKS: "1"
    npm_config_cache: "$CI_PROJECT_DIR/.npm"
    NPM_CONFIG_AUDIT: "false"
    NPM_CONFIG_FUND: "false"
  cache:
    key:
      files:
        - package-lock.json
    paths:
      - .npm/
  before_script:
    - node --version
    - npm ci
  artifacts:
    when: always
    paths:
      - reports/
    expire_in: 7 days
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

.repo_guard_policy:
  extends: .repo_guard_base
  script:
    - npx --no-install repo-guard ci --profile policy

.repo_guard_full:
  extends: .repo_guard_base
  script:
    - npx --no-install repo-guard ci --profile full

.repo_guard_release_ready:
  extends: .repo_guard_base
  script:
    - npx --no-install repo-guard ci --profile release-ready
`;
}

function rootBlock(profile, stage) {
  const templateProfile = profile.replaceAll('-', '_');
  return `${ROOT_BEGIN}
include:
  - local: /${GITLAB_TEMPLATE_FILE}

repo_guard:
  extends: .repo_guard_${templateProfile}
  stage: ${stage}
${ROOT_END}`;
}

function replaceManagedRootBlock(content, block) {
  const pattern = new RegExp(`${ROOT_BEGIN}[\\s\\S]*?${ROOT_END}`);
  return pattern.test(content)
    ? content.replace(pattern, block)
    : `${content.trimEnd()}${content.trim() ? '\n\n' : ''}${block}\n`;
}

function parseStageScalar(value) {
  const scalar = value.trim();
  const quoted = /^(?:"([^"\\]*)"|'([^']*)')$/.exec(scalar);
  if (quoted) return quoted[1] ?? quoted[2];
  return /^[A-Za-z0-9_.:-]+$/.test(scalar) ? scalar : null;
}

function declaredStages(content) {
  const declaration = /^stages[ \t]*:[ \t]*([^\r\n]*)$/m.exec(content);
  if (!declaration) return { present: false, supported: true, stages: [] };
  const inline = declaration[1].trim();
  if (inline) {
    const match = /^\[([A-Za-z0-9_.:'", -]*)](?:\s+#.*)?$/.exec(inline);
    if (!match) return { present: true, supported: false, stages: [] };
    const stages = match[1].trim()
      ? match[1].split(',').map(parseStageScalar)
      : [];
    return {
      present: true,
      supported: stages.every(Boolean),
      stages: stages.filter(Boolean),
    };
  }

  const rest = content.slice(declaration.index + declaration[0].length);
  const lines = rest.replace(/^\r?\n/, '').split(/\r?\n/);
  const stages = [];
  for (const line of lines) {
    if (!line.trim() || /^\s+#/.test(line)) continue;
    const item = /^\s+-\s*([^#]+?)(?:\s+#.*)?$/.exec(line);
    if (!item) break;
    const stage = parseStageScalar(item[1]);
    if (!stage) return { present: true, supported: false, stages: [] };
    stages.push(stage);
  }
  return { present: true, supported: stages.length > 0, stages };
}

function selectStage(content, requestedStage) {
  const declaration = declaredStages(content);
  if (!declaration.supported) {
    return { conflict: 'the stages declaration uses unsupported YAML syntax', stage: null };
  }
  const { stages } = declaration;
  if (requestedStage) {
    if (parseStageScalar(requestedStage) !== requestedStage) {
      throw configurationError('gitlab-ci/invalid-stage', `GitLab CI stage is invalid: ${requestedStage}`);
    }
    const availableStages = declaration.present ? stages : DEFAULT_GITLAB_STAGES;
    if (!availableStages.includes(requestedStage)) {
      throw configurationError('gitlab-ci/undeclared-stage', `GitLab CI stage is not declared: ${requestedStage}`);
    }
    return { conflict: null, stage: requestedStage };
  }
  if (!declaration.present) return { conflict: null, stage: 'test' };
  const stage = ['verify', 'test', 'quality'].find((name) => stages.includes(name)) ?? null;
  return {
    conflict: stage ? null : 'no verify, test, or quality stage could be selected',
    stage,
  };
}

function canIntegrateRoot(content) {
  const withoutManaged = content.replace(
    new RegExp(`${ROOT_BEGIN}[\\s\\S]*?${ROOT_END}`),
    '',
  );
  if (/^(?:include|["']include["'])\s*:/m.test(withoutManaged)) {
    return 'the root GitLab CI already defines include';
  }
  if (/^(?:repo_guard|["']repo_guard["'])\s*:/m.test(withoutManaged)) {
    return 'the root GitLab CI already defines repo_guard';
  }
  const hasBegin = content.includes(ROOT_BEGIN);
  const hasEnd = content.includes(ROOT_END);
  if (hasBegin !== hasEnd) return 'the managed root markers are incomplete';
  if (hasBegin && !new RegExp(`${ROOT_BEGIN}[\\s\\S]*?${ROOT_END}`).test(content)) {
    return 'the managed root markers are malformed';
  }
  if (/^\s*[{[]/.test(withoutManaged)) {
    return 'the root GitLab CI uses a flow-style YAML document';
  }
  return null;
}

export function inspectGitLabCi(root, config) {
  const problems = [];
  const rootPath = path.join(root, GITLAB_CI_FILE);
  const templatePath = path.join(root, GITLAB_TEMPLATE_FILE);
  if (!config.ci.enabled) problems.push('repo-guard CI is disabled in project configuration');
  if (!existsSync(rootPath)) problems.push(`${GITLAB_CI_FILE} is missing`);
  if (!existsSync(templatePath)) problems.push(`${GITLAB_TEMPLATE_FILE} is missing`);
  if (!existsSync(path.join(root, 'package-lock.json'))) {
    problems.push('package-lock.json is required because the managed GitLab job runs npm ci');
  }
  if (!directDependencyVersion(root)) {
    problems.push('@cxyi7/repo-guard must be a direct project dependency for npx --no-install');
  }

  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';
  if (template && !isManagedTemplate(template)) {
    problems.push(`${GITLAB_TEMPLATE_FILE} is not managed by repo-guard`);
  } else if (template && normalizeNewlines(template) !== templateContent()) {
    problems.push(`${GITLAB_TEMPLATE_FILE} was modified or is outdated; run repo-guard install-ci`);
  }

  const rootContent = existsSync(rootPath) ? readFileSync(rootPath, 'utf8') : '';
  const jobContent = rootJobContent(rootContent);
  const managedBlock = new RegExp(`${ROOT_BEGIN}\\n[\\s\\S]*?\\n${ROOT_END}`)
    .exec(normalizeNewlines(rootContent))?.[0] ?? '';
  const rootConflict = rootContent ? canIntegrateRoot(rootContent) : null;
  if (rootConflict) problems.push(`GitLab CI root integration is ambiguous: ${rootConflict}`);
  if (rootContent && !managedBlock.includes(`local: /${GITLAB_TEMPLATE_FILE}`)) {
    problems.push(`${GITLAB_CI_FILE} does not include ${GITLAB_TEMPLATE_FILE}`);
  }
  if (rootContent && !/extends:\s*\.repo_guard_(?:policy|full|release_ready)/.test(managedBlock)) {
    problems.push(`${GITLAB_CI_FILE} has no repo_guard job extending the managed template`);
  }
  if (rootContent && !managedBlock.includes(`extends: .repo_guard_${config.ci.profile.replaceAll('-', '_')}`)) {
    problems.push(
      `${GITLAB_CI_FILE} repo_guard profile does not match ci.profile=${config.ci.profile}`,
    );
  }
  const stage = /^\s+stage:\s*([^\s#]+)/m.exec(jobContent)?.[1] ?? null;
  if (stage && managedBlock !== rootBlock(config.ci.profile, stage)) {
    problems.push('repo_guard managed root block was modified; run repo-guard install-ci');
  }
  if (stage) {
    const declaration = declaredStages(rootContent);
    if (!declaration.supported) {
      problems.push('GitLab CI stages declaration uses unsupported YAML syntax');
    } else {
      const availableStages = declaration.present ? declaration.stages : DEFAULT_GITLAB_STAGES;
      if (!availableStages.includes(stage)) {
        problems.push(`repo_guard stage is not declared: ${stage}`);
      }
    }
  }
  if (/allow_failure:\s*true/.test(jobContent)) {
    problems.push('repo_guard must not use allow_failure: true');
  }
  if (/when:\s*manual/.test(jobContent)) {
    problems.push('repo_guard must not be a manual job');
  }
  if (/^\s+script\s*:/m.test(jobContent) || /\|\|\s*true/.test(jobContent)) {
    problems.push('repo_guard must not override or suppress the managed CI script');
  }
  if (rootContent && !/^\s+stage:\s*[^\s#]+/m.test(jobContent)) {
    problems.push('repo_guard must select an explicit existing stage');
  }
  return { problems };
}

export function installGitLabCi(root, {
  profile = 'policy',
  stage = null,
  dryRun = false,
} = {}) {
  if (!['policy', 'full', 'release-ready'].includes(profile)) {
    throw configurationError('gitlab-ci/invalid-profile', 'CI profile must be policy, full, or release-ready');
  }
  loadConfig(root);
  const rootPath = path.join(root, GITLAB_CI_FILE);
  const templatePath = path.join(root, GITLAB_TEMPLATE_FILE);
  const currentRoot = existsSync(rootPath) ? readFileSync(rootPath, 'utf8') : '';
  const currentTemplate = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';
  if (currentTemplate && !isManagedTemplate(currentTemplate)) {
    throw securityError(
      'gitlab-ci/non-managed-template',
      `Refusing to overwrite non-managed GitLab template: ${GITLAB_TEMPLATE_FILE}`,
      {
        details: { location: { path: GITLAB_TEMPLATE_FILE } },
        expected: 'repo-guard 只更新带当前或已知旧版受管标记的 GitLab 模板。',
        decision: { aiAction: 'request-human-review', humanApprovalRequired: true },
      },
    );
  }

  const selection = selectStage(currentRoot, stage);
  const selectedStage = selection.stage;
  const conflict = canIntegrateRoot(currentRoot) || selection.conflict;
  const block = rootBlock(profile, selectedStage || stage || '<existing-stage>');
  const nextRoot = conflict ? currentRoot : replaceManagedRootBlock(currentRoot, block);
  const nextTemplate = templateContent();
  const preview = {
    profile,
    stage: selectedStage,
    templateChanged: currentTemplate !== nextTemplate,
    rootChanged: !conflict && currentRoot !== nextRoot,
    integrated: !conflict,
    conflict,
    manualSnippet: conflict ? block : null,
  };
  if (dryRun) return preview;

  mkdirSync(path.dirname(templatePath), { recursive: true });
  writeFileSync(templatePath, nextTemplate, 'utf8');
  if (!conflict) writeFileSync(rootPath, nextRoot, 'utf8');
  configureCi(root, { profile });
  return preview;
}
