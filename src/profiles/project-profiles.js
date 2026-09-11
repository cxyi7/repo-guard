import { configurationError } from '../core/error/repo-guard-error.js';

export const PROJECT_PROFILES = Object.freeze({
  'vue-typescript': Object.freeze({ role: 'frontend', stack: 'node', language: 'typescript', supported: true }),
  'vue-javascript': Object.freeze({ role: 'frontend', stack: 'node', language: 'javascript', supported: true }),
  'node-typescript': Object.freeze({ role: 'backend', stack: 'node', language: 'typescript', supported: true }),
  'node-javascript': Object.freeze({ role: 'backend', stack: 'node', language: 'javascript', supported: true }),
  'java-maven': Object.freeze({ role: 'backend', stack: 'java', language: 'java', supported: true }),
  'java-gradle': Object.freeze({ role: 'backend', stack: 'java', language: 'java', supported: false }),
});

/** 显式校验项目身份，不通过文件或依赖猜测前后端。 */
export function validateProjectDescriptor(value, { allowUnsupported = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw configurationError('project/descriptor-required', '必须显式提供 project.id、role、stack 和 preset。');
  }
  const unknown = Object.keys(value).filter((key) => !['id', 'role', 'stack', 'preset'].includes(key));
  if (unknown.length > 0) {
    throw configurationError('project/unknown-field', `project 包含不支持的属性：${unknown.join(', ')}。`);
  }
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.id)) {
    throw configurationError('project/invalid-id', 'project.id 必须以小写字母开头，仅使用小写字母、数字和单个连接符。');
  }
  const profile = Object.hasOwn(PROJECT_PROFILES, value.preset) ? PROJECT_PROFILES[value.preset] : null;
  if (!profile || value.role !== profile.role || value.stack !== profile.stack) {
    throw configurationError('project/profile-mismatch', 'project.role、stack 和 preset 必须是同一个受支持方案的明确组合。');
  }
  if (!profile.supported && !allowUnsupported) {
    throw configurationError('project/stack-not-supported', '当前版本尚未支持此项目预设；Java 工程检查仅支持显式声明的 java-maven 项目。');
  }
  return { id: value.id, role: value.role, stack: value.stack, preset: value.preset };
}

/** 依赖需求仅用于准备计划；检查过程不会安装或升级工具。 */
export function getProjectToolRequirements(project) {
  const descriptor = validateProjectDescriptor(project, { allowUnsupported: true });
  return {
    host: { runtime: 'node', purpose: '运行 repo-guard' },
    project: descriptor.stack === 'java'
      ? { runtime: 'jdk', buildTool: descriptor.preset === 'java-maven' ? 'maven' : 'gradle' }
      : { runtime: 'node', language: PROJECT_PROFILES[descriptor.preset].language },
    installation: 'explicit-setup',
    supported: PROJECT_PROFILES[descriptor.preset].supported,
  };
}
