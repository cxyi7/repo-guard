import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configurationError } from '../../core/error/repo-guard-error.js';
import { planOperationsPipeline } from '../pipeline/plan.js';
import { assertOperationsFileLocation } from '../config/file-location.js';
import {
  OPERATIONS_PIPELINE_FILE,
  OPERATIONS_PIPELINE_MARKER,
  renderOperationsGitLabPipeline,
} from './renderer.js';

const ROOT_MARKER = '# repo-guard-operations-root:v2';

function readExisting(root, file) {
  assertOperationsFileLocation(root, file);
  return existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : null;
}

export function inspectOperationsGitLabPipeline(root, operations, projects) {
  const plan = planOperationsPipeline(root, operations, projects);
  const expected = renderOperationsGitLabPipeline(plan);
  const current = readExisting(root, OPERATIONS_PIPELINE_FILE);
  const problems = [];
  if (!expected) {
    if (current) problems.push('运维已关闭，但生成的流水线片段仍存在；请移除根引用后删除片段');
    return { enabled: false, problems };
  }
  if (current?.replaceAll('\r\n', '\n') !== expected) {
    problems.push(`${OPERATIONS_PIPELINE_FILE} 缺失、已修改或已过期；请运行 repo-guard ops install`);
  }
  const rootContent = readExisting(root, '.gitlab-ci.yml') ?? '';
  const escaped = OPERATIONS_PIPELINE_FILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^\\s*-?\\s*local:\\s*["']?/?${escaped}["']?\\s*$`, 'm').test(rootContent)) {
    problems.push(`根 GitLab 流水线必须引用 ${OPERATIONS_PIPELINE_FILE}`);
  }
  return { enabled: true, problems };
}

export function installOperationsGitLabPipeline(root, operations, projects, { dryRun = false } = {}) {
  const plan = planOperationsPipeline(root, operations, projects);
  const pipeline = renderOperationsGitLabPipeline(plan);
  const currentPipeline = readExisting(root, OPERATIONS_PIPELINE_FILE);
  if (!pipeline) {
    if (currentPipeline) {
      throw configurationError(
        'operations/disabled-installed-pipeline',
        `当前未启用运维发布，但 ${OPERATIONS_PIPELINE_FILE} 仍存在；请先从流水线移除该 include，再删除文件`,
      );
    }
    return { enabled: false, integrated: false, pipelineChanged: false, rootChanged: false, plan };
  }
  if (currentPipeline && !currentPipeline.startsWith(`${OPERATIONS_PIPELINE_MARKER}\n`)
      && !currentPipeline.startsWith(`${OPERATIONS_PIPELINE_MARKER}\r\n`)) {
    throw configurationError('operations/unmanaged-pipeline', `拒绝覆盖非托管流水线：${OPERATIONS_PIPELINE_FILE}`);
  }
  const rootFile = '.gitlab-ci.yml';
  const currentRoot = readExisting(root, rootFile);
  const rootContent = `${ROOT_MARKER}\ninclude:\n  - local: /${OPERATIONS_PIPELINE_FILE}\n`;
  const integrated = currentRoot === null || currentRoot.replaceAll('\r\n', '\n') === rootContent;
  const preview = {
    enabled: true,
    integrated,
    pipelineChanged: currentPipeline?.replaceAll('\r\n', '\n') !== pipeline,
    rootChanged: currentRoot === null,
    manualSnippet: integrated ? null : `include:\n  - local: /${OPERATIONS_PIPELINE_FILE}\n`,
    guidance: integrated ? null : '根流水线保持不变，请合并 include，并确认 .pre、build、deploy 阶段可用；Runner 必须预先准备项目工具和依赖',
    plan,
  };
  if (dryRun) return preview;
  if (preview.pipelineChanged) {
    mkdirSync(path.dirname(path.join(root, OPERATIONS_PIPELINE_FILE)), { recursive: true });
    writeFileSync(path.join(root, OPERATIONS_PIPELINE_FILE), pipeline, 'utf8');
  }
  if (preview.rootChanged) writeFileSync(path.join(root, rootFile), rootContent, { encoding: 'utf8', flag: 'wx' });
  return preview;
}
