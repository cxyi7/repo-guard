import { dependencyInstallation } from './dependency-installation.js';
import { DEFAULT_CI_CONFIG } from '../../config/defaults.js';
import { markManagedContent, managedContentIsUnmodified } from './managed-content.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { configurationError, securityError } from '../../core/error/repo-guard-error.js';
import { managedTextIsCurrent } from '../../core/policy/managed-text-block.js';
import { assertOperationsFileLocation } from '../config/file-location.js';

export const GITLAB_CI_FILE = '.gitlab-ci.yml';
export const GITLAB_TEMPLATE_FILE = '.gitlab/ci/repo-guard.yml';
const TEMPLATE_MARKER = '# repo-guard-gitlab-template:v4';
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

function templateContent(root, config) {
  const installation = dependencyInstallation(root, config);
  return markManagedContent(`${TEMPLATE_MARKER}
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
        - ${JSON.stringify(installation.lockfile)}
    paths:
      - .npm/
  before_script:
    - node --version
${installation.commands.map((command) => `    - ${JSON.stringify(command)}`).join("\n")}
  artifacts:
    when: always
    paths:
      - reports/
    expire_in: 7 days
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_PIPELINE_SOURCE == "push" && $CI_OPEN_MERGE_REQUESTS'
      when: never
${(config.ci.branches ?? DEFAULT_CI_CONFIG.branches).map((branch) => `    - if: ${JSON.stringify(`$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "${branch}"`)}`).join("\n")}

.repo_guard_ci:
  extends: .repo_guard_base
  script:
    - ${installation.runner} repo-guard ci


`);
}

function rootBlock(stage) {
  return `${ROOT_BEGIN}
include:
  - local: /${GITLAB_TEMPLATE_FILE}

repo_guard:
  extends: .repo_guard_ci
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

function canIntegrateRoot(content) {
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
  const hasBegin = content.includes(ROOT_BEGIN);
  const hasEnd = content.includes(ROOT_END);
  if (hasBegin !== hasEnd) return '托管根标记不完整';
  if (hasBegin && !new RegExp(`${ROOT_BEGIN}[\\s\\S]*?${ROOT_END}`).test(content)) {
    return '托管根标记格式错误';
  }
  if (hasBegin) {
    const block = new RegExp(`${ROOT_BEGIN}[\\s\\S]*?${ROOT_END}`).exec(content)[0];
    const stage = /^\s+stage:\s*([^\s#]+)/m.exec(block)?.[1];
    if (!stage || normalizeNewlines(block) !== rootBlock(stage)) {
      return '托管根区块存在人工修改；请人工合并预览片段，拒绝覆盖';
    }
  }
  if (/^\s*[{[]/.test(withoutManaged)) {
    return '根 GitLab CI 使用了流式 YAML 文档';
  }
  return null;
}

export function inspectGitLabCi(root, config) {
  assertOperationsFileLocation(root, GITLAB_CI_FILE);
  assertOperationsFileLocation(root, GITLAB_TEMPLATE_FILE);
  const problems = [];
  const rootPath = path.join(root, GITLAB_CI_FILE);
  const templatePath = path.join(root, GITLAB_TEMPLATE_FILE);
  if (!config.ci.enabled) problems.push('项目配置中已禁用 repo-guard CI');
  if (!existsSync(rootPath)) problems.push(`${GITLAB_CI_FILE} 缺失`);
  if (!existsSync(templatePath)) problems.push(`${GITLAB_TEMPLATE_FILE} 缺失`);
  const installation = dependencyInstallation(root, config);
  if (!existsSync(path.join(root, installation.lockfile))) {
    problems.push(`托管 GitLab 作业要求锁文件 ${installation.lockfile}`);
  }
  if (!directDependencyVersion(root)) {
    problems.push('使用 npx --no-install 时，@cxyi7/repo-guard 必须是项目的直接依赖');
  }

  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';
  if (template && !isManagedTemplate(template)) {
    problems.push(`${GITLAB_TEMPLATE_FILE} 未由 repo-guard 托管`);
  } else if (template && normalizeNewlines(template) !== templateContent(root, config)) {
    problems.push(`${GITLAB_TEMPLATE_FILE} 已被修改或过期；请运行 repo-guard install-ci`);
  }

  const rootContent = existsSync(rootPath) ? readFileSync(rootPath, 'utf8') : '';
  const jobContent = rootJobContent(rootContent);
  const managedBlock = new RegExp(`${ROOT_BEGIN}\\n[\\s\\S]*?\\n${ROOT_END}`)
    .exec(normalizeNewlines(rootContent))?.[0] ?? '';
  const rootConflict = rootContent ? canIntegrateRoot(rootContent) : null;
  if (rootConflict) problems.push(`GitLab CI 根集成存在歧义： ${rootConflict}`);
  if (rootContent && !managedBlock.includes(`local: /${GITLAB_TEMPLATE_FILE}`)) {
    problems.push(`${GITLAB_CI_FILE} 未包含 ${GITLAB_TEMPLATE_FILE}`);
  }
  if (rootContent && !/extends:\s*\.repo_guard_ci/.test(managedBlock)) {
    problems.push(`${GITLAB_CI_FILE} 没有继承托管模板的 repo_guard 作业`);
  }
  const stage = /^\s+stage:\s*([^\s#]+)/m.exec(jobContent)?.[1] ?? null;
  if (stage && managedBlock !== rootBlock(stage)) {
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

export function installGitLabCiFiles(root, config, {
  stage = null,
  dryRun = false,
} = {}) {
  assertOperationsFileLocation(root, GITLAB_CI_FILE);
  assertOperationsFileLocation(root, GITLAB_TEMPLATE_FILE);
  const rootPath = path.join(root, GITLAB_CI_FILE);
  const templatePath = path.join(root, GITLAB_TEMPLATE_FILE);
  const currentRoot = existsSync(rootPath) ? readFileSync(rootPath, 'utf8') : '';
  const currentTemplate = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';
  if (currentTemplate && (!isManagedTemplate(currentTemplate) || !managedContentIsUnmodified(currentTemplate))) {
    throw securityError(
      'gitlab-ci/non-managed-template',
      `拒绝覆盖非托管或人工修改的 GitLab 模板： ${GITLAB_TEMPLATE_FILE}`,
      {
        details: { location: { path: GITLAB_TEMPLATE_FILE } },
        expected: 'repo-guard 只接受内容未被修改的当前模板；其他版本和自定义模板需保留原文件并人工接入，不自动转换。',
        decision: { aiAction: 'request-human-review', humanApprovalRequired: true },
      },
    );
  }

  const selection = selectStage(
    currentRoot,
    stage,
  );
  const selectedStage = selection.stage;
  const conflict = canIntegrateRoot(currentRoot) || selection.conflict;
  const block = rootBlock(
    selectedStage || stage || '<existing-stage>',
  );
  const nextRoot = conflict ? currentRoot : replaceManagedRootBlock(currentRoot, block);
  const nextTemplate = templateContent(root, config);
  const preview = {
    stage: selectedStage,
    templateChanged: !managedTextIsCurrent(currentTemplate, nextTemplate),
    rootChanged: !conflict
      && !managedTextIsCurrent(currentRoot, nextRoot),
    integrated: !conflict,
    conflict,
    manualSnippet: conflict ? block : null,
  };
  if (dryRun) return preview;
  if (conflict && currentRoot.includes(ROOT_BEGIN)) {
    return preview;
  }

  mkdirSync(path.dirname(templatePath), { recursive: true });
  if (preview.templateChanged) writeFileSync(templatePath, nextTemplate, 'utf8');
  if (!conflict && preview.rootChanged) writeFileSync(rootPath, nextRoot, 'utf8');
  return preview;
}
