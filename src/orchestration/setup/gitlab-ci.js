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
import { managedTextIsCurrent } from '../../core/policy/managed-text-block.js';
import {
  MANAGED_PIPELINE_JOB_NAMES,
  renderManagedPipelineRoot,
  requiredManagedPipelineScripts,
} from './gitlab-managed-pipeline.js';

export const GITLAB_CI_FILE = '.gitlab-ci.yml';
export const GITLAB_TEMPLATE_FILE = '.gitlab/ci/repo-guard.yml';
const TEMPLATE_MARKER = '# repo-guard-gitlab-template:v2';
const ROOT_BEGIN = '# repo-guard-gitlab:start';
const ROOT_END = '# repo-guard-gitlab:end';
const DEFAULT_GITLAB_STAGES = Object.freeze(['.pre', 'build', 'test', 'deploy', '.post']);

function normalizeNewlines(content) {
  return content.replace(/\r\n?/g, '\n');
}

function isManagedTemplate(content) {
  return normalizeNewlines(content).startsWith(`${TEMPLATE_MARKER}\n`);
}

function projectManifest(root) {
  const packagePath = path.join(root, 'package.json');
  if (!existsSync(packagePath)) return null;
  try {
    return JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch {
    return null;
  }
}

function directDependencyVersion(root) {
  const manifest = projectManifest(root);
  return manifest?.devDependencies?.['@cxyi7/repo-guard']
    ?? manifest?.dependencies?.['@cxyi7/repo-guard']
    ?? manifest?.optionalDependencies?.['@cxyi7/repo-guard']
    ?? null;
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

.repo_guard_pipeline_base:
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

.repo_guard_pipeline_legacy_peer_deps_base:
  extends: .repo_guard_pipeline_base
  before_script:
    - node --version
    - npm ci --legacy-peer-deps
`;
}

function rootBlock(profile, stage, pipeline = { enabled: false }) {
  const templateProfile = profile.replaceAll('-', '_');
  const managedPipeline = renderManagedPipelineRoot(pipeline);
  return `${ROOT_BEGIN}
include:
  - local: /${GITLAB_TEMPLATE_FILE}

repo_guard:
  extends: .repo_guard_${templateProfile}
  stage: ${stage}${managedPipeline.gateOverrides}${managedPipeline.jobs}
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

function availableStages(declaration) {
  return declaration.present
    ? [...new Set(['.pre', ...declaration.stages, '.post'])]
    : DEFAULT_GITLAB_STAGES;
}

function selectStage(content, requestedStage) {
  const declaration = declaredStages(content);
  if (!declaration.supported) {
    return { conflict: 'stages 声明使用了不支持的 YAML 语法', stage: null };
  }
  const { stages } = declaration;
  if (requestedStage) {
    if (parseStageScalar(requestedStage) !== requestedStage) {
      throw configurationError('gitlab-ci/invalid-stage', `GitLab CI stage 无效： ${requestedStage}`);
    }
    if (!availableStages(declaration).includes(requestedStage)) {
      throw configurationError('gitlab-ci/undeclared-stage', `GitLab CI stage 未声明： ${requestedStage}`);
    }
    return { conflict: null, stage: requestedStage };
  }
  if (!declaration.present) return { conflict: null, stage: 'test' };
  const stage = ['verify', 'test', 'quality'].find((name) => stages.includes(name)) ?? null;
  return {
    conflict: stage ? null : '无法选择 verify、test 或 quality stage',
    stage,
  };
}

function validatePipelineStages(content, pipeline) {
  if (!pipeline.enabled) return null;
  const declaration = declaredStages(content);
  if (!declaration.supported) return 'stages 声明使用了不支持的 YAML 语法';
  const missing = [pipeline.verifyStage, pipeline.deployStage]
    .filter((stage) => !availableStages(declaration).includes(stage));
  return missing.length > 0
    ? `托管交付阶段未声明：${[...new Set(missing)].join(', ')}`
    : null;
}

function missingPipelineScripts(root, pipeline) {
  const scripts = projectManifest(root)?.scripts ?? {};
  return requiredManagedPipelineScripts(pipeline).filter(
    (script) => typeof scripts[script] !== 'string' || !scripts[script].trim(),
  );
}

function canIntegrateRoot(content, pipeline = { enabled: false }) {
  const withoutManaged = content.replace(
    new RegExp(`${ROOT_BEGIN}[\\s\\S]*?${ROOT_END}`),
    '',
  );
  if (/^(?:include|["']include["'])\s*:/m.test(withoutManaged)) {
    return '根 GitLab CI 已定义 include';
  }
  if (/^(?:repo_guard|["']repo_guard["'])\s*:/m.test(withoutManaged)) {
    return '根 GitLab CI 已定义 repo_guard';
  }
  const conflictingJob = pipeline.enabled
    ? MANAGED_PIPELINE_JOB_NAMES.find(
      (job) => new RegExp(`^(?:${job}|["']${job}["'])\\s*:`, 'm').test(withoutManaged),
    )
    : null;
  if (conflictingJob) return `根 GitLab CI 已定义保留作业 ${conflictingJob}`;
  const hasBegin = content.includes(ROOT_BEGIN);
  const hasEnd = content.includes(ROOT_END);
  if (hasBegin !== hasEnd) return '托管根标记不完整';
  if (hasBegin && !new RegExp(`${ROOT_BEGIN}[\\s\\S]*?${ROOT_END}`).test(content)) {
    return '托管根标记格式错误';
  }
  if (/^\s*[{[]/.test(withoutManaged)) {
    return '根 GitLab CI 使用了流式 YAML 文档';
  }
  return null;
}

export function inspectGitLabCi(root, config) {
  const problems = [];
  const rootPath = path.join(root, GITLAB_CI_FILE);
  const templatePath = path.join(root, GITLAB_TEMPLATE_FILE);
  if (!config.ci.enabled) problems.push('项目配置中已禁用 repo-guard CI');
  if (!existsSync(rootPath)) problems.push(`${GITLAB_CI_FILE} 缺失`);
  if (!existsSync(templatePath)) problems.push(`${GITLAB_TEMPLATE_FILE} 缺失`);
  if (!existsSync(path.join(root, 'package-lock.json'))) {
    problems.push('托管 GitLab 作业会运行 npm ci，因此必须提供 package-lock.json');
  }
  if (!directDependencyVersion(root)) {
    problems.push('使用 npx --no-install 时，@cxyi7/repo-guard 必须是项目的直接依赖');
  }

  const pipeline = config.ci.pipeline;
  const missingScripts = missingPipelineScripts(root, pipeline);
  if (missingScripts.length > 0) {
    problems.push(`托管交付缺少 package.json scripts：${missingScripts.join(', ')}`);
  }

  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';
  if (template && !isManagedTemplate(template)) {
    problems.push(`${GITLAB_TEMPLATE_FILE} 未由 repo-guard 托管`);
  } else if (template && normalizeNewlines(template) !== templateContent()) {
    problems.push(`${GITLAB_TEMPLATE_FILE} 已被修改或过期；请运行 repo-guard install-ci`);
  }

  const rootContent = existsSync(rootPath) ? readFileSync(rootPath, 'utf8') : '';
  const jobContent = rootJobContent(rootContent);
  const managedBlock = new RegExp(`${ROOT_BEGIN}\\n[\\s\\S]*?\\n${ROOT_END}`)
    .exec(normalizeNewlines(rootContent))?.[0] ?? '';
  const rootConflict = rootContent ? canIntegrateRoot(rootContent, pipeline) : null;
  if (rootConflict) problems.push(`GitLab CI 根集成存在歧义： ${rootConflict}`);
  if (rootContent && !managedBlock.includes(`local: /${GITLAB_TEMPLATE_FILE}`)) {
    problems.push(`${GITLAB_CI_FILE} 未包含 ${GITLAB_TEMPLATE_FILE}`);
  }
  if (rootContent && !/extends:\s*\.repo_guard_(?:policy|full|release_ready)/.test(managedBlock)) {
    problems.push(`${GITLAB_CI_FILE} 没有继承托管模板的 repo_guard 作业`);
  }
  if (rootContent && !managedBlock.includes(`extends: .repo_guard_${config.ci.profile.replaceAll('-', '_')}`)) {
    problems.push(
      `${GITLAB_CI_FILE} 的 repo_guard profile 与 ci.profile= 不匹配：${config.ci.profile}`,
    );
  }
  const stage = /^\s+stage:\s*([^\s#]+)/m.exec(jobContent)?.[1] ?? null;
  if (stage && managedBlock !== rootBlock(config.ci.profile, stage, pipeline)) {
    problems.push('repo_guard 托管根区块已被修改；请运行 repo-guard install-ci');
  }
  if (stage) {
    const declaration = declaredStages(rootContent);
    if (!declaration.supported) {
      problems.push('GitLab CI 的 stages 声明使用了不支持的 YAML 语法');
    } else {
      if (!availableStages(declaration).includes(stage)) {
        problems.push(`repo_guard stage 未声明： ${stage}`);
      }
    }
  }
  const pipelineStageConflict = validatePipelineStages(rootContent, pipeline);
  if (pipelineStageConflict) problems.push(pipelineStageConflict);
  if (/allow_failure:\s*true/.test(jobContent)) {
    problems.push('repo_guard 不得使用 allow_failure: true');
  }
  if (/when:\s*manual/.test(jobContent)) {
    problems.push('repo_guard 不得是手动作业');
  }
  if (/^\s+script\s*:/m.test(jobContent) || /\|\|\s*true/.test(jobContent)) {
    problems.push('repo_guard 不得覆盖或屏蔽托管 CI 脚本');
  }
  if (rootContent && !/^\s+stage:\s*[^\s#]+/m.test(jobContent)) {
    problems.push('repo_guard 必须选择一个明确存在的 stage');
  }
  return { problems };
}

export function installGitLabCi(root, {
  profile = 'policy',
  stage = null,
  dryRun = false,
} = {}) {
  if (!['policy', 'full', 'release-ready'].includes(profile)) {
    throw configurationError('gitlab-ci/invalid-profile', 'CI 配置档必须为 policy、full 或 release-ready');
  }
  const config = loadConfig(root);
  const pipeline = config.ci.pipeline;
  if (pipeline.enabled && stage && stage !== '.pre') {
    throw configurationError(
      'gitlab-ci/managed-pipeline-gate-stage',
      '启用托管应用交付后，repo_guard 门禁固定使用 .pre 阶段',
    );
  }
  const missingScripts = missingPipelineScripts(root, pipeline);
  if (missingScripts.length > 0) {
    throw configurationError(
      'gitlab-ci/missing-pipeline-scripts',
      `托管交付缺少 package.json scripts：${missingScripts.join(', ')}`,
    );
  }
  const rootPath = path.join(root, GITLAB_CI_FILE);
  const templatePath = path.join(root, GITLAB_TEMPLATE_FILE);
  const currentRoot = existsSync(rootPath) ? readFileSync(rootPath, 'utf8') : '';
  const currentTemplate = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';
  if (currentTemplate && !isManagedTemplate(currentTemplate)) {
    throw securityError(
      'gitlab-ci/non-managed-template',
      `拒绝覆盖非托管 GitLab 模板： ${GITLAB_TEMPLATE_FILE}`,
      {
        details: { location: { path: GITLAB_TEMPLATE_FILE } },
        expected: 'repo-guard 只更新带当前版本受管标记的 GitLab 模板。',
        decision: { aiAction: 'request-human-review', humanApprovalRequired: true },
      },
    );
  }

  const selection = selectStage(
    currentRoot,
    pipeline.enabled ? '.pre' : stage,
  );
  const selectedStage = selection.stage;
  const conflict = canIntegrateRoot(currentRoot, pipeline)
    || selection.conflict
    || validatePipelineStages(currentRoot, pipeline);
  const block = rootBlock(
    profile,
    selectedStage || stage || '<existing-stage>',
    pipeline,
  );
  const nextRoot = conflict ? currentRoot : replaceManagedRootBlock(currentRoot, block);
  const nextTemplate = templateContent();
  const preview = {
    profile,
    stage: selectedStage,
    pipelineEnabled: pipeline.enabled,
    templateChanged: !managedTextIsCurrent(currentTemplate, nextTemplate),
    rootChanged: !conflict
      && !managedTextIsCurrent(currentRoot, nextRoot),
    integrated: !conflict,
    conflict,
    manualSnippet: conflict ? block : null,
  };
  if (dryRun) return preview;

  mkdirSync(path.dirname(templatePath), { recursive: true });
  if (preview.templateChanged) writeFileSync(templatePath, nextTemplate, 'utf8');
  if (!conflict && preview.rootChanged) writeFileSync(rootPath, nextRoot, 'utf8');
  configureCi(root, { profile });
  return preview;
}
