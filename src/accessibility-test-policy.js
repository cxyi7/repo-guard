import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DEFAULT_ACCESSIBILITY_TEST_CONFIG } from './config.js';
import { buildManagedTextBlock } from './managed-text-block.js';

export const ACCESSIBILITY_TEST_POLICY_FILE = 'AGENTS.md';
const START_MARKER = '<!-- repo-guard:accessibility-test-policy:start -->';
const END_MARKER = '<!-- repo-guard:accessibility-test-policy:end -->';

function managedLines(config) {
  return [
    '## axe 可访问性测试硬性要求',
    '',
    `- 可访问性测试文件必须匹配：${config.testPatterns.map((item) => `\`${item}\``).join('、')}。`,
    '- 每个匹配文件必须直接使用受支持的 axe 集成，包含真实 test/it 用例、实际 DOM 扫描和零违规硬断言。',
    '- Vue 组件测试应扫描渲染后的组件，覆盖默认、关键交互，以及适用的加载、空数据和错误状态。',
    '- E2E 测试应等待页面稳定后扫描关键路由和核心业务流程，并包含弹窗、菜单、表单校验等交互状态。',
    '- axe 失败时优先修复语义结构、可访问名称、键盘焦点、颜色对比度和 ARIA 根因，并补充回归测试。',
    '- 禁止 disableRules、exclude、withRules、withTags、runOnly、includedImpacts、enabled:false、skip/only/todo、删除断言、缩小测试 glob 或把脚本改为空操作来绕过。',
    `- 完成修改后运行 \`npm run ${config.script}\`，并运行受影响功能的交互测试和生产构建。`,
  ];
}

export function ensureAccessibilityTestPolicy(
  root,
  config = DEFAULT_ACCESSIBILITY_TEST_CONFIG,
) {
  const target = path.join(root, ACCESSIBILITY_TEST_POLICY_FILE);
  const existed = existsSync(target);
  const current = existed ? readFileSync(target, 'utf8') : '';
  const next = buildManagedTextBlock({
    current,
    endMarker: END_MARKER,
    managedLines: managedLines(config),
    startMarker: START_MARKER,
    target: ACCESSIBILITY_TEST_POLICY_FILE,
  });
  if (next === current) return { changed: false, created: false, path: target };
  writeFileSync(target, next, 'utf8');
  return { changed: true, created: !existed, path: target };
}

export function isAccessibilityTestPolicyCurrent(
  content,
  config = DEFAULT_ACCESSIBILITY_TEST_CONFIG,
) {
  if (!content.includes(START_MARKER) || !content.includes(END_MARKER)) return false;
  return buildManagedTextBlock({
    current: content,
    endMarker: END_MARKER,
    managedLines: managedLines(config),
    startMarker: START_MARKER,
    target: ACCESSIBILITY_TEST_POLICY_FILE,
  }) === content;
}
