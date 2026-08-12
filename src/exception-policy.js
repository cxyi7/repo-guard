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
    '- Vue 原生表单控件必须具有可静态验证的关联 label 或无障碍名称；例外规则为 `vue/form-control-label`。',
    '- Vue 原生图片必须具有可静态验证且符合用途的 alt；纯装饰图片必须同时使用空 alt 和静态 none/presentation 角色；例外规则为 `vue/img-alt`。',
    '- 启用 axe 可访问性测试门禁时，每个匹配测试必须直接扫描真实 DOM 并断言零违规；不允许用结构化例外绕过测试规则或违规节点。',
    '- 启用依赖治理时，依赖必须遵守精确版本、批准来源、分组唯一、锁文件同步和禁用包规则；AI 不得手工伪造 lockfile。',
    '- 启用样式复杂度门禁时，选择器复合段和嵌套深度不得超过配置阈值；AI 不得用 disable 注释或项目规则覆盖绕过。',
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
