import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DEFAULT_UNIT_TEST_CONFIG } from './config.js';
import { buildManagedTextBlock } from './managed-text-block.js';

export const UNIT_TEST_POLICY_FILE = 'AGENTS.md';
const START_MARKER = '<!-- repo-guard:unit-test-policy:start -->';
const END_MARKER = '<!-- repo-guard:unit-test-policy:end -->';

function quotedPatterns(patterns) {
  return patterns.length > 0
    ? patterns.map((pattern) => `\`${pattern}\``).join('、')
    : '无';
}

function mappingLines(mappings) {
  return mappings.map(({ sourcePattern, testTemplates }) => (
    `- 测试映射：\`${sourcePattern}\` → ${quotedPatterns(testTemplates)}。`
  ));
}

function managedLines(config) {
  const scopeRule = config.requireTests === 'changedFiles'
    ? '新增或修改下列源码时，都必须存在并同步更新测试。'
    : '新增或复制下列源码时必须新增测试；修改已有源码时也应同步更新已有测试。';
  return [
    '## 前端单元测试要求',
    '',
    scopeRule,
    '',
    `- 需要测试的源码：${quotedPatterns(config.sourcePatterns)}。`,
    `- 不强制生成测试的路径：${quotedPatterns(config.exclusions)}。`,
    '- 测试映射按配置顺序匹配源码；候选路径中存在任一有效测试即可。',
    ...mappingLines(config.mappings),
    '- 工具函数覆盖正常值、边界值和非法值。',
    '- Composable 覆盖状态变化、加载、失败、缓存和并发。',
    '- Store 覆盖 action、state 变化以及成功和失败路径。',
    '- API 必须 Mock 网络，并验证参数、响应转换和错误处理。',
    '- Vue 组件验证 Props、用户交互、渲染结果、emit、加载、空数据和错误状态。',
    '- Bug 修复必须增加能够复现原问题的回归测试。',
    '- 禁止空测试，禁止删除已有测试或断言，禁止使用 `.skip`、`.skipIf`、`.todo`、`.only` 或无理由更新快照绕过。',
    `- 完成修改后运行 \`npm run ${config.script}\`。`,
  ];
}

export function ensureUnitTestPolicy(root, config = DEFAULT_UNIT_TEST_CONFIG) {
  const target = path.join(root, UNIT_TEST_POLICY_FILE);
  const existed = existsSync(target);
  const current = existed ? readFileSync(target, 'utf8') : '';
  const next = buildManagedTextBlock({
    current,
    endMarker: END_MARKER,
    managedLines: managedLines(config),
    startMarker: START_MARKER,
    target: UNIT_TEST_POLICY_FILE,
  });

  if (next === current) {
    return { changed: false, created: false, path: target };
  }
  writeFileSync(target, next, 'utf8');
  return { changed: true, created: !existed, path: target };
}

export function isUnitTestPolicyManaged(content) {
  return content.includes(START_MARKER) && content.includes(END_MARKER);
}

export function isUnitTestPolicyCurrent(content, config = DEFAULT_UNIT_TEST_CONFIG) {
  if (!isUnitTestPolicyManaged(content)) {
    return false;
  }
  return buildManagedTextBlock({
    current: content,
    endMarker: END_MARKER,
    managedLines: managedLines(config),
    startMarker: START_MARKER,
    target: UNIT_TEST_POLICY_FILE,
  }) === content;
}
