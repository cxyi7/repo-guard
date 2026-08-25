const GROUP_DEFINITIONS = [
  ['repository-governance-policy', '仓库与变更治理'],
  ['staged-quality-policy', '暂存代码质量'],
  ['source-safety-policy', '源码安全与资源生命周期'],
  ['repository-structure-policy', '目录与文件结构'],
  ['dependency-health-policy', '依赖与仓库健康度'],
  ['testing-policy', '测试质量'],
  ['delivery-policy', '构建、交付与外部门禁'],
];

export const agentPolicyGroups = Object.freeze(GROUP_DEFINITIONS.map(([id, title]) => (
  Object.freeze({ id, title })
)));

function safeInline(value) {
  return String(value)
    .replace(/\r?\n/g, ' ')
    .replaceAll('`', '\\`')
    .replaceAll('<!--', '&lt;!--')
    .replaceAll('-->', '--&gt;');
}

function code(value) {
  return `\`${safeInline(value)}\``;
}

function list(values, empty = '无') {
  return values.length > 0 ? values.map(code).join('、') : empty;
}

function enabled(path) {
  return ({ config }) => path
    .split('.')
    .reduce((value, key) => value?.[key], config)?.enabled === true;
}

function entry({ id, groupId, gates = [], features = [], capabilities = [], when, lines }) {
  return Object.freeze({
    id,
    groupId,
    gates: Object.freeze([...gates]),
    features: Object.freeze([...features]),
    capabilities: Object.freeze([...capabilities]),
    when,
    lines,
  });
}

const entries = [
  entry({
    id: 'structured-exceptions',
    groupId: 'repository-governance-policy',
    gates: ['repository.structured-exceptions'],
    when: () => true,
    lines: ({ config }) => [
      '- 规则例外只能登记在 `repo-guard.config.json#exceptions.entries`；禁止用散落注释、普通 ignore 或关闭规则替代。',
      `- 例外最长有效 ${config.exceptions.maxDays} 天，并在到期前 ${config.exceptions.warningDays} 天预警；AI 不得自行新增、延期或改写审批信息。`,
    ],
  }),
  entry({
    id: 'protected-files',
    groupId: 'repository-governance-policy',
    gates: ['repository.protected-files'],
    when: () => true,
    lines: () => [
      '- 修改受保护文件前必须核对 `rules` 与 `exclusions`；不得绕过阻断，通知型变更必须保留门禁证据。',
    ],
  }),
  entry({
    id: 'commit-message',
    groupId: 'repository-governance-policy',
    gates: ['repository.commit-message'],
    features: ['commitMessage'],
    when: enabled('commitMessage'),
    lines: ({ config }) => [
      `- 提交信息必须符合 Conventional Commit；允许类型为 ${list(config.commitMessage.types)}，标题最长 ${config.commitMessage.headerMaxLength} 个字符。`,
      `- scope ${config.commitMessage.requireScope ? '为必填项' : '可选'}；允许值为 ${list(config.commitMessage.allowedScopes)}。fixup!/squash! 在本地${config.commitMessage.fixup.allowLocal ? '允许' : '禁止'}、pre-push 阶段${config.commitMessage.fixup.allowPush ? '允许' : '禁止'}、CI 阶段${config.commitMessage.fixup.allowCi ? '允许' : '禁止'}；最终合并历史必须按项目流程完成整理。`,
    ],
  }),
  entry({
    id: 'file-header',
    groupId: 'repository-governance-policy',
    features: ['fileHeader'],
    when: enabled('preCommit.fileHeader'),
    lines: ({ config }) => [
      `- 文件头由 repo-guard 依据 Git 记录维护；适用扩展名为 ${list(config.preCommit.fileHeader.extensions)}，不得手工伪造作者或时间。`,
      `- 文件头包含范围为 ${list(config.preCommit.fileHeader.include)}，排除范围为 ${list(config.preCommit.fileHeader.exclude)}。`,
    ],
  }),
  entry({
    id: 'function-docs',
    groupId: 'repository-governance-policy',
    features: ['functionDocs'],
    when: enabled('preCommit.functionDocs'),
    lines: ({ config }) => [
      `- 函数文档适用于 ${list(config.preCommit.functionDocs.extensions)}；新增或删除参数、返回值及异常路径时同步 @param、@returns、@throws，保留人工 @Description。`,
      `- 函数文档包含范围为 ${list(config.preCommit.functionDocs.include)}，排除范围为 ${list(config.preCommit.functionDocs.exclude)}；TypeScript JSDoc 不重复声明类型。`,
    ],
  }),
  entry({
    id: 'eslint',
    groupId: 'staged-quality-policy',
    gates: ['quality.eslint'],
    features: ['eslint'],
    when: enabled('preCommit.eslint'),
    lines: ({ config }) => [
      `- ESLint 使用消费项目自身的安装和配置，仅处理暂存范围 ${code(config.preCommit.eslint.pattern)}，并以最多 ${config.preCommit.eslint.maxWarnings} 条 warning 为通过条件。`,
    ],
  }),
  entry({
    id: 'prettier',
    groupId: 'staged-quality-policy',
    gates: ['quality.prettier'],
    features: ['prettier'],
    when: enabled('preCommit.prettier'),
    lines: ({ config }) => [
      `- Prettier 使用消费项目自身的安装和配置，仅格式化暂存范围 ${code(config.preCommit.prettier.pattern)}。`,
    ],
  }),
  entry({
    id: 'stylelint',
    groupId: 'staged-quality-policy',
    gates: ['quality.stylelint'],
    features: ['stylelint'],
    when: enabled('preCommit.stylelint'),
    lines: ({ config }) => [
      `- Stylelint 使用消费项目自身的安装和配置，仅处理暂存范围 ${code(config.preCommit.stylelint.pattern)}，并以最多 ${config.preCommit.stylelint.maxWarnings} 条 warning 为通过条件。`,
      '- Vue 样式语言必须与 `<style lang>` 一致，不得把预处理器语法按普通 CSS 校验。',
    ],
  }),
  entry({
    id: 'style-complexity',
    groupId: 'staged-quality-policy',
    gates: ['quality.style-complexity'],
    features: ['styleComplexity'],
    when: enabled('preCommit.stylelint.complexity'),
    lines: ({ config }) => [
      `- 样式选择器最多包含 ${config.preCommit.stylelint.complexity.maxCompoundSelectors} 个复合段，嵌套深度最多为 ${config.preCommit.stylelint.complexity.maxNestingDepth}；不得用 disable 注释绕过。`,
    ],
  }),
  entry({
    id: 'style-governance',
    groupId: 'staged-quality-policy',
    gates: ['quality.style-governance'],
    features: ['styleGovernance'],
    when: enabled('preCommit.stylelint.governance'),
    lines: ({ config }) => [
      `- 样式优先级不得高于 ${code(config.preCommit.stylelint.governance.maxSpecificity)}，ID 选择器最多 ${config.preCommit.stylelint.governance.maxIdSelectors} 个，${config.preCommit.stylelint.governance.disallowImportant ? '禁止' : '按项目配置控制'} !important。`,
    ],
  }),
  entry({
    id: 'pre-commit-order',
    groupId: 'staged-quality-policy',
    when: () => true,
    lines: () => [
      '- pre-commit 顺序固定为 Stylelint fix、ESLint fix、Prettier、只读 Stylelint/ESLint 校验、受保护文件门禁；不得运行项目级 fix，不得加入 TypeScript 类型检查。',
      '- 所有暂存修复必须通过 lint-staged 保留部分暂存与未暂存内容。',
    ],
  }),
  entry({
    id: 'async-resource-cleanup',
    groupId: 'source-safety-policy',
    gates: ['quality.vue-async-resource-cleanup'],
    features: ['asyncResourceCleanup'],
    when: enabled('preCommit.asyncResourceCleanup'),
    lines: ({ config }) => [
      `- Vue 与 composable 中创建的定时器、事件监听、WebSocket、Observer、订阅和请求必须在同一作用域形成可验证的释放闭环；长任务阈值为 ${config.preCommit.asyncResourceCleanup.timeoutThresholdMs}ms。`,
      `- 异步资源检查包含 ${list(config.preCommit.asyncResourceCleanup.include)}，排除 ${list(config.preCommit.asyncResourceCleanup.exclude)}；请求函数为 ${list(config.preCommit.asyncResourceCleanup.requestFunctions)}。`,
    ],
  }),
  entry({
    id: 'dynamic-code', groupId: 'source-safety-policy', gates: ['security.dynamic-code'],
    when: () => true,
    lines: () => ['- 禁止使用 eval 或 Function 构造器动态执行字符串；确需例外时必须登记精确的结构化例外。'],
  }),
  entry({
    id: 'vue-security', groupId: 'source-safety-policy',
    gates: ['security.vue-unsafe-html', 'security.vue-target-blank'],
    when: () => true,
    lines: () => [
      '- Vue 模板禁止未经精确结构化例外批准的 v-html。',
      '- target="_blank" 必须同时包含 rel="noopener noreferrer"。',
    ],
  }),
  entry({
    id: 'vue-accessibility', groupId: 'source-safety-policy',
    gates: ['accessibility.vue-form-label', 'accessibility.vue-image-alt'],
    when: () => true,
    lines: () => [
      '- Vue 原生表单控件必须具有可静态验证的关联 label 或无障碍名称。',
      '- Vue 原生图片必须具有符合用途的 alt；装饰图片必须使用空 alt 和静态 none/presentation 角色。',
    ],
  }),
  entry({
    id: 'path-naming', groupId: 'repository-structure-policy',
    gates: ['repository.path-naming'], features: ['pathNaming'],
    when: enabled('preCommit.pathNaming'),
    lines: ({ config }) => [
      `- 目录和文件名统一使用 ${code(config.preCommit.pathNaming.convention)}；包含 ${list(config.preCommit.pathNaming.include)}，排除 ${list(config.preCommit.pathNaming.exclude)}，同一项目不得混用命名风格。`,
    ],
  }),
  entry({
    id: 'image-assets', groupId: 'repository-structure-policy',
    gates: ['repository.image-assets', 'repository.unused-image-assets'],
    features: ['imageAssets', 'unusedImageAssets'],
    when: ({ config }) => config.imageAssets.enabled || config.imageAssets.unused.enabled,
    lines: ({ config }) => {
      const requirements = [
        config.imageAssets.naming.enabled
          ? `${code(config.imageAssets.naming.convention)} 命名`
          : null,
        '扩展名与真实格式一致',
        config.imageAssets.duplicates.exact !== 'off' ? '精确重复内容' : null,
        config.imageAssets.duplicates.pixel !== 'off' ? '像素重复内容' : null,
        config.imageAssets.compression.enabled ? '压缩收益阈值' : null,
        config.imageAssets.compression.enabled
          && config.imageAssets.compression.conversion.enabled
          ? 'WebP 转换策略'
          : null,
      ].filter(Boolean).join('、');
      return [
        ...(config.imageAssets.enabled ? [
          `- 图片资源必须遵守${requirements}；包含 ${list(config.imageAssets.include)}，排除 ${list(config.imageAssets.exclude)}。Hook 与 CI 只能检查，不得自动删除资源、改写引用或执行有损转换。`,
        ] : []),
        ...(config.imageAssets.unused.enabled ? [
          `- 无效图片资源按 ${code(config.imageAssets.enforcement)} 模式治理；静态引用源码包含 ${list(config.imageAssets.unused.sourceInclude)}，排除 ${list(config.imageAssets.unused.sourceExclude)}。动态路径必须使用带原因且同时匹配真实源码和图片的 ${code('imageAssets.unused.dynamicReferences')} 声明；不得使用整个仓库通配或未经确认自动删除图片。`,
        ] : []),
      ];
    },
  }),
  entry({
    id: 'file-placement', groupId: 'repository-structure-policy',
    gates: ['repository.file-placement'], features: ['filePlacement'],
    when: enabled('preCommit.filePlacement'),
    lines: ({ config }) => [
      `- 新增或变更文件必须符合 ${config.preCommit.filePlacement.rules.length} 条文件归类规则（模式 ${code(config.preCommit.filePlacement.mode)}）；不得通过扩大例外绕过目标目录。`,
    ],
  }),
  entry({
    id: 'code-placement', groupId: 'repository-structure-policy',
    gates: ['repository.code-placement'], features: ['codePlacement'],
    when: enabled('codePlacement'),
    lines: ({ config }) => [
      `- 代码片段必须符合 ${config.codePlacement.rules.length} 条代码归位规则；托管说明只公开规则边界，不复制受保护的匹配内容。`,
    ],
  }),
  entry({
    id: 'maximum-file-lines', groupId: 'repository-structure-policy',
    gates: ['repository.maximum-file-lines'], features: ['maxFileLines'],
    when: enabled('preCommit.maxFileLines'),
    lines: ({ config }) => [
      `- 文件行数按 ${code(config.preCommit.maxFileLines.mode)} 模式执行，达到上限 ${Math.round(config.preCommit.maxFileLines.warnAt * 100)}% 时预警；规则为 ${config.preCommit.maxFileLines.rules.map(({ pattern, maxLines }) => `${code(pattern)}≤${maxLines}`).join('、')}。`,
    ],
  }),
  entry({
    id: 'dependency-policy', groupId: 'dependency-health-policy',
    gates: ['dependencies.policy'], features: ['dependencies'],
    when: enabled('dependencyPolicy'),
    lines: ({ config }) => [
      `- 依赖必须遵守精确版本、批准协议和锁文件同步策略；允许协议为 ${list(config.dependencyPolicy.allowedProtocols)}，${config.dependencyPolicy.requireLockfile ? '必须提交同步锁文件' : '按项目配置维护锁文件'}。`,
    ],
  }),
  entry({
    id: 'architecture', groupId: 'dependency-health-policy',
    gates: ['quality.architecture'], features: ['architecture'],
    when: enabled('architecture'),
    lines: ({ config }) => [
      `- 修改模块依赖后必须运行 ${code('repo-guard architecture')}；扫描路径为 ${list(config.architecture.sourcePaths)}，不得降低 severity、扩大 exclude 或缩小扫描范围绕过。`,
      `- 生效的架构规则为 ${list(config.architecture.rules.filter(({ severity }) => severity !== 'ignore').map(({ name }) => name))}。`,
    ],
  }),
  entry({
    id: 'dead-code', groupId: 'dependency-health-policy',
    gates: ['quality.dead-code'], features: ['deadCode'], capabilities: ['dead-code-baseline'],
    when: enabled('deadCode'),
    lines: ({ config }) => [
      `- Knip 无效代码检查使用 ${code(config.deadCode.mode)} 模式，问题类型为 ${list(config.deadCode.issueTypes)}；基线文件为 ${code(config.deadCode.baselineFile)}。`,
      '- baseline 模式只允许阻止新增债务；基线只能通过确认后的专用命令收缩或更新，不得手工删除问题掩盖结果。',
    ],
  }),
  entry({
    id: 'typecheck', groupId: 'testing-policy',
    gates: ['quality.typecheck'], features: ['typeCheck'],
    when: enabled('typeCheck'),
    lines: ({ config }) => [`- TypeScript 类型检查使用 npm 脚本 ${code(config.typeCheck.script)}，只在显式、pre-push 或 CI full 阶段运行，不进入 pre-commit。`],
  }),
  entry({
    id: 'unit-test', groupId: 'testing-policy',
    gates: ['quality.unit-test'], features: ['unitTest'],
    when: enabled('unitTest'),
    lines: ({ config }) => [
      `- 单元测试使用 npm 脚本 ${code(config.unitTest.script)}；源码范围为 ${list(config.unitTest.sourcePatterns)}，测试变更要求为 ${code(config.unitTest.requireTests)}。`,
      '- 工具函数覆盖正常值、边界值和非法值；Composable、Store、API、Vue 组件及 Bug 修复必须覆盖相应状态和回归路径，禁止空测试及 skip/only/todo 绕过。',
    ],
  }),
  entry({
    id: 'coverage', groupId: 'testing-policy', features: ['coverage'],
    when: enabled('unitTest.coverage'),
    lines: ({ config }) => {
      const thresholds = config.unitTest.coverage.thresholds;
      return [`- 覆盖率阈值（行/语句/函数/分支/变更行）为 ${thresholds.lines}%/${thresholds.statements}%/${thresholds.functions}%/${thresholds.branches}%/${thresholds.changedLines}%；不得降低阈值或扩大生产源码排除项绕过。`];
    },
  }),
  entry({
    id: 'component-interaction', groupId: 'testing-policy', features: ['componentInteraction'],
    when: enabled('unitTest.componentInteraction'),
    lines: ({ config }) => [`- Vue 组件交互测试范围为 ${list(config.unitTest.componentInteraction.componentPatterns)}；必须触发真实交互并断言交互后的 DOM、状态、emit 或依赖调用结果。`],
  }),
  entry({
    id: 'accessibility-test', groupId: 'testing-policy',
    gates: ['quality.accessibility-test'], features: ['accessibilityTest'],
    when: enabled('accessibilityTest'),
    lines: ({ config }) => [
      `- axe 可访问性测试使用 npm 脚本 ${code(config.accessibilityTest.script)}，文件范围为 ${list(config.accessibilityTest.testPatterns)}；每个测试必须扫描真实 DOM 并断言零违规。`,
    ],
  }),
  entry({
    id: 'mutation-test', groupId: 'testing-policy',
    gates: ['quality.mutation-test'], features: ['mutationTest'], capabilities: ['guarded-build'],
    when: enabled('mutationTest'),
    lines: ({ config }) => [
      `- 变异测试使用 ${code(config.mutationTest.configFile)}，报告目录为 ${code(config.mutationTest.reportsDirectory)}；低于阈值时不得继续受保护构建。`,
      `- 受保护构建映射为 ${config.mutationTest.guardedBuilds.length > 0 ? config.mutationTest.guardedBuilds.map(({ packageScript, script }) => `${code(packageScript)}→${code(script)}`).join('、') : '无'}。`,
    ],
  }),
  entry({
    id: 'build', groupId: 'delivery-policy', gates: ['quality.build'], features: ['build'],
    when: enabled('build'),
    lines: ({ config }) => [`- 构建门禁使用 npm 脚本 ${code(config.build.script)}，失败或超时必须阻断当前交付流程。`],
  }),
  entry({
    id: 'lighthouse', groupId: 'delivery-policy', gates: ['quality.lighthouse'], features: ['lighthouse'],
    when: enabled('lighthouse'),
    lines: ({ config }) => [`- Lighthouse 使用消费项目的 Chrome、路由、断言及 ${code(config.lighthouse.configFile ?? '自动发现的配置文件')}；不得进入 pre-commit，也不得隐式上传报告。`],
  }),
  entry({
    id: 'ci', groupId: 'delivery-policy', features: ['ci'],
    when: enabled('ci'),
    lines: ({ config }) => [`- CI 使用 ${code(config.ci.profile)} 配置档并输出本地报告 ${code(config.ci.reportPath)}；所有托管策略必须在 CI 执行前保持同步。`],
  }),
  entry({
    id: 'notification', groupId: 'delivery-policy', features: ['notification'],
    when: enabled('notification'),
    lines: () => ['- 企业微信通知只从本地或 CI 环境读取凭据；成功、失败、取消和自动取消必须按相应工作流发送中文状态，不得把 webhook 写入仓库或 AGENTS.md。'],
  }),
  entry({
    id: 'external-gates', groupId: 'delivery-policy', capabilities: ['external-gates', 'api-performance', 'k6'],
    when: ({ config }) => config.externalGates.some(({ enabled: gateEnabled }) => gateEnabled),
    lines: ({ config, packageJson }) => config.externalGates
      .filter(({ enabled: gateEnabled }) => gateEnabled)
      .map((gate) => {
        const command = packageJson.scripts?.[gate.script] ?? '';
        const kind = command.includes('api-performance-runner')
          ? 'Axios 接口性能测试'
          : command.includes('k6-runner') ? 'k6 并发压测' : '外部门禁';
        return `- ${kind} ${code(gate.id)} 仅按配置在 ${list(gate.environments)} 环境执行 npm 脚本 ${code(gate.script)}；报告缺失、超时或退出失败必须阻断。`;
      }),
  }),
  entry({
    id: 'release-readiness', groupId: 'delivery-policy',
    gates: ['release.check', 'release.test', 'release.package'],
    when: () => true,
    lines: () => [
      '- 发布前必须依次通过 `npm run check`、`npm test` 和 `npm run pack:check`；一个独立审查功能对应一个版本，不得把下一功能混入已完成审查的版本。',
      '- 版本号按影响选择 patch、minor 或 major；npm 发布必须使用官方 Web 登录与 2FA，且不得保存任何凭据。',
    ],
  }),
];

export const agentPolicyCatalog = Object.freeze(entries);

export const managedAgentPolicyFeatures = Object.freeze(
  [...new Set(entries.flatMap(({ features }) => features))],
);

export const managedAgentPolicyGateIds = Object.freeze(
  [...new Set(entries.flatMap(({ gates }) => gates))],
);

export const managedAgentPolicyCapabilities = Object.freeze(
  [...new Set(entries.flatMap(({ capabilities }) => capabilities))],
);

export function renderAgentPolicyGroups(context) {
  return Object.freeze(agentPolicyGroups.map((group) => {
    const activeEntries = entries.filter((item) => (
      item.groupId === group.id && item.when(context)
    ));
    const lines = [
      `## ${group.title}`,
      '',
      ...activeEntries.flatMap((item) => item.lines(context)),
    ];
    return Object.freeze({ ...group, lines: Object.freeze(lines) });
  }));
}
