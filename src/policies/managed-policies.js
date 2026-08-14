import {
  DEFAULT_ACCESSIBILITY_TEST_CONFIG,
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_EXCEPTIONS_CONFIG,
  DEFAULT_UNIT_TEST_CONFIG,
} from '../config.js';
import {
  defineManagedPolicy,
  ensureManagedPolicy,
  isManagedPolicyCurrent,
  isManagedPolicyPresent,
} from '../core/policy/managed-policy.js';

const POLICY_FILE = 'AGENTS.md';

function quotedPatterns(patterns) {
  return patterns.length > 0
    ? patterns.map((pattern) => `\`${pattern}\``).join('、')
    : '无';
}

const exceptionPolicy = defineManagedPolicy({
  id: 'exception-policy',
  file: POLICY_FILE,
  buildLines: (config) => [
    '## 结构化例外硬性要求',
    '',
    '- 代码规则例外只能登记在 `repo-guard.config.json#exceptions.entries`，禁止使用散落注释、普通 ignore 或关闭规则代替。',
    '- 每条例外必须精确匹配规则、文件、行和列，并包含原因、责任人、独立审批人、工单及创建/到期日期。',
    '- JavaScript、TypeScript 和 Vue 脚本禁止使用 `eval` 或 `Function` 构造器动态执行字符串；例外规则为 `security/no-eval` 和 `security/no-function-constructor`。',
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
  ],
});

const architecturePolicy = defineManagedPolicy({
  id: 'architecture-policy',
  file: POLICY_FILE,
  buildLines: (config) => [
    '## 前端依赖架构硬性要求',
    '',
    '- 修改模块依赖后必须运行 `repo-guard architecture`，并修复全部 error 级违规。',
    `- 扫描范围：${config.sourcePaths.map((item) => `\`${item}\``).join('、')}。`,
    ...config.rules.filter(({ severity }) => severity !== 'ignore').map((rule) => (
      `- \`${rule.name}\`（${rule.severity}）：${rule.comment || '必须遵守该依赖边界。'}`
    )),
    '- 修复循环依赖时应调整依赖方向或提取更低层的公共模块；修复无法解析的导入时应更正路径或依赖配置。',
    '- 禁止通过关闭门禁、降低 severity、加入 ignore、缩小 sourcePaths、扩大 exclude 或放宽规则来绕过。',
  ],
});

const unitTestPolicy = defineManagedPolicy({
  id: 'unit-test-policy',
  file: POLICY_FILE,
  buildLines: (config) => {
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
      ...config.mappings.map(({ sourcePattern, testTemplates }) => (
        `- 测试映射：\`${sourcePattern}\` → ${quotedPatterns(testTemplates)}。`
      )),
      ...(config.coverage && typeof config.coverage === 'object' && config.coverage.enabled ? [
        `- 覆盖率硬门禁：行/语句/函数/分支不得低于 ${config.coverage.thresholds.lines}%/`
        + `${config.coverage.thresholds.statements}%/${config.coverage.thresholds.functions}%/`
        + `${config.coverage.thresholds.branches}%，变更行覆盖率不得低于 `
        + `${config.coverage.thresholds.changedLines}%。`,
        '- 覆盖率不足时必须补充有效测试；禁止降低阈值、排除生产源码或复用旧报告绕过。',
      ] : []),
      '- 工具函数覆盖正常值、边界值和非法值。',
      '- Composable 覆盖状态变化、加载、失败、缓存和并发。',
      '- Store 覆盖 action、state 变化以及成功和失败路径。',
      '- API 必须 Mock 网络，并验证参数、响应转换和错误处理。',
      '- Vue 组件验证 Props、用户交互、渲染结果、emit、加载、空数据和错误状态。',
      ...(config.componentInteraction.enabled ? [
        `- Vue 组件交互硬门禁范围：${quotedPatterns(config.componentInteraction.componentPatterns)}。`,
        '- 范围内包含 v-on/@事件或 v-model 的组件，必须在同一正常执行用例中直接导入组件、使用 @vue/test-utils mount、触发真实交互，并在交互后断言 DOM、状态、emit、路由、Store 或 Mock 调用结果。',
        '- 仅断言组件已定义、wrapper.exists()、mount 不抛错、快照或交互前状态不算交互测试；禁止关闭规则或扩大排除绕过。',
      ] : []),
      '- Bug 修复必须增加能够复现原问题的回归测试。',
      '- 禁止空测试，禁止删除已有测试或断言，禁止使用 `.skip`、`.skipIf`、`.todo`、`.only` 或无理由更新快照绕过。',
      `- 完成修改后运行 \`npm run ${config.script}\`。`,
    ];
  },
});

const accessibilityTestPolicy = defineManagedPolicy({
  id: 'accessibility-test-policy',
  file: POLICY_FILE,
  buildLines: (config) => [
    '## axe 可访问性测试硬性要求',
    '',
    `- 可访问性测试文件必须匹配：${quotedPatterns(config.testPatterns)}。`,
    '- 每个匹配文件必须直接使用受支持的 axe 集成，包含真实 test/it 用例、实际 DOM 扫描和零违规硬断言。',
    '- Vue 组件测试应扫描渲染后的组件，覆盖默认、关键交互，以及适用的加载、空数据和错误状态。',
    '- E2E 测试应等待页面稳定后扫描关键路由和核心业务流程，并包含弹窗、菜单、表单校验等交互状态。',
    '- axe 失败时优先修复语义结构、可访问名称、键盘焦点、颜色对比度和 ARIA 根因，并补充回归测试。',
    '- 禁止 disableRules、exclude、withRules、withTags、runOnly、includedImpacts、enabled:false、skip/only/todo、删除断言、缩小测试 glob 或把脚本改为空操作来绕过。',
    `- 完成修改后运行 \`npm run ${config.script}\`，并运行受影响功能的交互测试和生产构建。`,
  ],
});

export const managedPolicies = Object.freeze([
  exceptionPolicy,
  architecturePolicy,
  unitTestPolicy,
  accessibilityTestPolicy,
]);

export const EXCEPTION_POLICY_FILE = exceptionPolicy.file;
export const ARCHITECTURE_POLICY_FILE = architecturePolicy.file;
export const UNIT_TEST_POLICY_FILE = unitTestPolicy.file;
export const ACCESSIBILITY_TEST_POLICY_FILE = accessibilityTestPolicy.file;

export function ensureExceptionPolicy(root, config = DEFAULT_EXCEPTIONS_CONFIG) {
  return ensureManagedPolicy(root, exceptionPolicy, config);
}

export function isExceptionPolicyCurrent(content, config = DEFAULT_EXCEPTIONS_CONFIG) {
  return isManagedPolicyCurrent(content, exceptionPolicy, config);
}

export function ensureArchitecturePolicy(root, config = DEFAULT_ARCHITECTURE_CONFIG) {
  return ensureManagedPolicy(root, architecturePolicy, config);
}

export function isArchitecturePolicyCurrent(content, config = DEFAULT_ARCHITECTURE_CONFIG) {
  return isManagedPolicyCurrent(content, architecturePolicy, config);
}

export function ensureUnitTestPolicy(root, config = DEFAULT_UNIT_TEST_CONFIG) {
  return ensureManagedPolicy(root, unitTestPolicy, config);
}

export function isUnitTestPolicyManaged(content) {
  return isManagedPolicyPresent(content, unitTestPolicy);
}

export function isUnitTestPolicyCurrent(content, config = DEFAULT_UNIT_TEST_CONFIG) {
  return isManagedPolicyCurrent(content, unitTestPolicy, config);
}

export function ensureAccessibilityTestPolicy(
  root,
  config = DEFAULT_ACCESSIBILITY_TEST_CONFIG,
) {
  return ensureManagedPolicy(root, accessibilityTestPolicy, config);
}

export function isAccessibilityTestPolicyCurrent(
  content,
  config = DEFAULT_ACCESSIBILITY_TEST_CONFIG,
) {
  return isManagedPolicyCurrent(content, accessibilityTestPolicy, config);
}
