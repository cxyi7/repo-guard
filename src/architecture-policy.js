import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DEFAULT_ARCHITECTURE_CONFIG } from './config.js';
import { buildManagedTextBlock } from './managed-text-block.js';

export const ARCHITECTURE_POLICY_FILE = 'AGENTS.md';
const START_MARKER = '<!-- repo-guard:architecture-policy:start -->';
const END_MARKER = '<!-- repo-guard:architecture-policy:end -->';

function managedLines(config) {
  return [
    '## 前端依赖架构硬性要求',
    '',
    '- 修改模块依赖后必须运行 `repo-guard architecture`，并修复全部 error 级违规。',
    `- 扫描范围：${config.sourcePaths.map((item) => `\`${item}\``).join('、')}。`,
    ...config.rules.filter(({ severity }) => severity !== 'ignore').map((rule) => (
      `- \`${rule.name}\`（${rule.severity}）：${rule.comment || '必须遵守该依赖边界。'}`
    )),
    '- 修复循环依赖时应调整依赖方向或提取更低层的公共模块；修复无法解析的导入时应更正路径或依赖配置。',
    '- 禁止通过关闭门禁、降低 severity、加入 ignore、缩小 sourcePaths、扩大 exclude 或放宽规则来绕过。',
  ];
}

export function ensureArchitecturePolicy(root, config = DEFAULT_ARCHITECTURE_CONFIG) {
  const target = path.join(root, ARCHITECTURE_POLICY_FILE);
  const existed = existsSync(target);
  const current = existed ? readFileSync(target, 'utf8') : '';
  const next = buildManagedTextBlock({
    current,
    endMarker: END_MARKER,
    managedLines: managedLines(config),
    startMarker: START_MARKER,
    target: ARCHITECTURE_POLICY_FILE,
  });
  if (next === current) {
    return { changed: false, created: false, path: target };
  }
  writeFileSync(target, next, 'utf8');
  return { changed: true, created: !existed, path: target };
}

export function isArchitecturePolicyCurrent(
  content,
  config = DEFAULT_ARCHITECTURE_CONFIG,
) {
  if (!content.includes(START_MARKER) || !content.includes(END_MARKER)) {
    return false;
  }
  return buildManagedTextBlock({
    current: content,
    endMarker: END_MARKER,
    managedLines: managedLines(config),
    startMarker: START_MARKER,
    target: ARCHITECTURE_POLICY_FILE,
  }) === content;
}
