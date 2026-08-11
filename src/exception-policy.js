import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DEFAULT_EXCEPTIONS_CONFIG } from './config.js';
import { buildManagedTextBlock } from './managed-text-block.js';

export const EXCEPTION_POLICY_FILE = 'AGENTS.md';
const START_MARKER = '<!-- repo-guard:exception-policy:start -->';
const END_MARKER = '<!-- repo-guard:exception-policy:end -->';

function managedLines(config) {
  return [
    '## 结构化例外硬性要求',
    '',
    '- 代码规则例外只能登记在 `repo-guard.config.json#exceptions.entries`，禁止使用散落注释、普通 ignore 或关闭规则代替。',
    '- 每条例外必须精确匹配规则、文件、行和列，并包含原因、责任人、独立审批人、工单及创建/到期日期。',
    '- Vue 模板禁止使用 `v-html`；只有精确命中当前有效 `vue/no-v-html` 结构化例外的位置才能放行。',
    '- Vue 模板的 `target="_blank"` 必须同时包含 `rel="noopener noreferrer"`；例外规则为 `vue/target-blank-security`。',
    `- 例外最长有效 ${config.maxDays} 天；到期立即失效，提前 ${config.warningDays} 天进入预警。`,
    '- AI 不得自行新增例外，不得延期、改位置、改审批人或修改例外策略来绕过门禁。',
    '- 发现违规时应优先修复代码；确需例外时停止工作并请求有权人员完成审查和登记。',
  ];
}

export function ensureExceptionPolicy(root, config = DEFAULT_EXCEPTIONS_CONFIG) {
  const target = path.join(root, EXCEPTION_POLICY_FILE);
  const existed = existsSync(target);
  const current = existed ? readFileSync(target, 'utf8') : '';
  const next = buildManagedTextBlock({
    current,
    endMarker: END_MARKER,
    managedLines: managedLines(config),
    startMarker: START_MARKER,
    target: EXCEPTION_POLICY_FILE,
  });
  if (next === current) {
    return { changed: false, created: false, path: target };
  }
  writeFileSync(target, next, 'utf8');
  return { changed: true, created: !existed, path: target };
}

export function isExceptionPolicyCurrent(content, config = DEFAULT_EXCEPTIONS_CONFIG) {
  if (!content.includes(START_MARKER) || !content.includes(END_MARKER)) {
    return false;
  }
  return buildManagedTextBlock({
    current: content,
    endMarker: END_MARKER,
    managedLines: managedLines(config),
    startMarker: START_MARKER,
    target: EXCEPTION_POLICY_FILE,
  }) === content;
}
