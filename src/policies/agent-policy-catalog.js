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
    id: 'workspace-isolation',
    groupId: 'repository-governance-policy',
    when: ({ config }) => !config.project,
    lines: () => [
      '- 仓库公共配置只管理提交信息、交付流程、CI 公共流程、通知、动画和仓库基础文件保护；应用工程规则、依赖、例外与外部门禁必须配置在所属应用中。',
      '- 前后端位于不同且不重叠的目录，各应用只遵循自己的工程配置；不得把前端规则复制为后端的强制要求。公共文件触发哪些应用，由 sharedPaths 显式声明。',
    ],
  }),
  entry({
    id: 'independent-delivery',
    groupId: 'repository-governance-policy',
    when: () => true,
    lines: () => [
      '- 如果仓库启用了 `repo-guard.delivery.json`，使用独立交付流程及 `.agents/skills/` 下五个交付 Skill；每个参与方绑定同一权威合同的明确修订和指纹，工程配置可以同时启用，语言与目录不决定交付义务。',
      '- 独立交付先运行 `repo-guard delivery check`，按本方任务边界开发，再通过 `delivery run` 取得真实执行证据；关闭、跳过或手填成功状态不能代替必需检查。',
      '- 各仓库使用自己的基线、分支和提交号；联合验证必须核对实际验证的完整代码版本组合。代码、合同或反馈修订后必须重新复测，不能沿用旧验收。',
      '- AI 可以规划任务、执行检查并登记真实失败反馈；合同确认与最终验收由人工执行 `delivery approve` 和 `delivery accept`，AI 不得读取、保管或使用验收人的签名私钥。',
    ],
  }),
  entry({
    id: 'project-identity',
    groupId: 'repository-governance-policy',
    when: ({ config }) => config.project != null,
    lines: ({ config }) => [
      `- 本应用标识为 ${code(config.project.id)}，角色为${config.project.role === 'backend' ? '后端' : '前端'}，技术栈为 ${code(config.project.stack)}，预设为 ${code(config.project.preset)}；必须遵循显式配置，不得根据依赖自动改变身份。`,
      '- 检查范围为通用工程质量与团队规则；repo-guard 不判断具体业务正确性、接口输入输出或身份权限。',
    ],
  }),
  entry({
    id: 'commit-animation',
    groupId: 'repository-governance-policy',
    features: ['commitAnimation'],
    when: enabled('reporting.commitAnimation'),
    lines: () => [
      '- 提交动画仅显示检查状态，不能替代门禁；完整失败诊断必须保留，成功庆祝只能发生在 Git 创建提交后。',
    ],
  }),
  entry({
    id: 'structured-exceptions',
    groupId: 'repository-governance-policy',
    gates: ['repository.structured-exceptions'],
    when: () => true,
    lines: ({ config }) => [
      '- 规则例外只能登记在 `repo-guard.config.json#repository.exceptions.entries`；禁止用散落注释、普通 ignore 或关闭规则替代。',
      `- 例外最长有效 ${config.repository.exceptions.maxDays} 天，并在到期前 ${config.repository.exceptions.warningDays} 天预警；AI 不得自行新增、延期或改写审批信息。`,
    ],
  }),
  entry({
    id: 'protected-files',
    groupId: 'repository-governance-policy',
    gates: ['repository.protected-files'],
    when: () => true,
    lines: () => [
      '- 修改受保护文件前必须核对 `repository.rules` 与 `repository.exclusions`；不得绕过阻断，通知型变更必须保留门禁证据。',
    ],
  }),
  entry({
    id: 'delivery-contract',
    groupId: 'repository-governance-policy',
    gates: ['repository.delivery-contract', 'release.delivery-evidence'],
    features: ['deliveryContract'],
    when: enabled('repository.deliveryContract'),
    lines: ({ config }) => [
      `- 开发前必须在 ${code(config.repository.deliveryContract.registryPath)} 由人工确认功能归属，并在 ${code(config.repository.deliveryContract.contractsDirectory)} 保存当前分支唯一的活动 Markdown 交付合同；合同类型不得根据 Git commit type 自动推断。`,
      '- 启用交付合同时使用 `.agents/skills/` 下由 repo-guard 托管的五个流程 Skill：功能登记、合同规划、合同执行、反馈闭环和交付证据；Skill 指导 AI，repo-guard Gate 仍是确定性校验来源。',
      '- 交付合同使用 `schemaVersion: 2` 多文件合同包；主合同只保存控制信息，requirements、traceability、obligations 和每个 `FND-*` 分别保存在合同子目录的组成文件中。',
      '- AI 负责提出 Spec、Design、Tasks、Examples、Visuals、变更边界和证据计划；人工负责确认功能归属、合同定义、资料省略理由与最终验收，AI 不得代填或勾选 HUMAN-* 事项。',
      `- 需求事实只接受受 Git 跟踪的本地下载文件或截图；合同变更范围默认拒绝，forbiddenPaths 优先于 allowedPaths。受合同约束的业务范围为 ${list(config.repository.deliveryContract.requiredFor)}，排除 ${list(config.repository.deliveryContract.exclude)}。合同定义变化必须连续提升修订并重新人工确认，不得删除历史义务、正式发现或需求修订快照。`,
      '- 已宣称完成后发现的问题必须登记为 FND-*，重新打开关联任务，保留部署提交、执行日志和人工复测，并完成测试、合同、设计、任务模板与 Gate 的反向升级决定；实现缺陷必须用同一回归测试形成红—绿证明。清单证据必须解析到受 Git 跟踪的 Evidence Run，发布前由 release.delivery-evidence 复核完整的本轮 GateResult、最新目标分支、集成影响分析和人工验收。',
    ],
  }),
  entry({
    id: 'commit-message',
    groupId: 'repository-governance-policy',
    gates: ['repository.commit-message'],
    features: ['commitMessage'],
    when: enabled('repository.commitMessage'),
    lines: ({ config }) => [
      `- 提交信息必须符合 Conventional Commit；允许类型为 ${list(config.repository.commitMessage.types)}，标题最长 ${config.repository.commitMessage.headerMaxLength} 个字符。`,
      `- scope ${config.repository.commitMessage.requireScope ? '为必填项' : '可选'}；允许值为 ${list(config.repository.commitMessage.allowedScopes)}。fixup!/squash! 在本地${config.repository.commitMessage.fixup.allowLocal ? '允许' : '禁止'}、pre-push 阶段${config.repository.commitMessage.fixup.allowPush ? '允许' : '禁止'}、CI 阶段${config.repository.commitMessage.fixup.allowCi ? '允许' : '禁止'}；最终合并历史必须按项目流程完成整理。`,
    ],
  }),
  entry({
    id: 'file-header',
    groupId: 'repository-governance-policy',
    features: ['fileHeader'],
    when: enabled('checks.fileHeader'),
    lines: ({ config }) => [
      `- 文件头由 repo-guard 依据 Git 记录维护；适用扩展名为 ${list(config.checks.fileHeader.extensions)}，不得手工伪造作者或时间。`,
      `- 文件头包含范围为 ${list(config.checks.fileHeader.include)}，排除范围为 ${list(config.checks.fileHeader.exclude)}。`,
    ],
  }),
  entry({
    id: 'function-docs',
    groupId: 'repository-governance-policy',
    features: ['functionDocs'],
    when: enabled('checks.functionDocs'),
    lines: ({ config }) => [
      `- 函数文档适用于 ${list(config.checks.functionDocs.extensions)}；新增或删除参数、返回值及异常路径时同步 @param、@returns、@throws，保留人工 @Description。`,
      `- 函数文档包含范围为 ${list(config.checks.functionDocs.include)}，排除范围为 ${list(config.checks.functionDocs.exclude)}；TypeScript JSDoc 不重复声明类型。`,
    ],
  }),
  entry({
    id: 'eslint',
    groupId: 'staged-quality-policy',
    gates: ['quality.eslint'],
    features: ['eslint'],
    when: enabled('checks.eslint'),
    lines: ({ config }) => [
      `- ESLint 使用消费项目自身的安装和配置，仅处理暂存范围 ${code(config.checks.eslint.pattern)}，并以最多 ${config.checks.eslint.maxWarnings} 条 warning 为通过条件。`,
    ],
  }),
  entry({
    id: 'prettier',
    groupId: 'staged-quality-policy',
    gates: ['quality.prettier'],
    features: ['prettier'],
    when: enabled('checks.prettier'),
    lines: ({ config }) => [
      `- Prettier 使用消费项目自身的安装和配置，仅格式化暂存范围 ${code(config.checks.prettier.pattern)}。`,
    ],
  }),
  entry({
    id: 'stylelint',
    groupId: 'staged-quality-policy',
    gates: ['quality.stylelint'],
    features: ['stylelint'],
    when: enabled('checks.stylelint'),
    lines: ({ config }) => [
      `- Stylelint 使用消费项目自身的安装和配置，仅处理暂存范围 ${code(config.checks.stylelint.pattern)}，并以最多 ${config.checks.stylelint.maxWarnings} 条 warning 为通过条件。`,
      '- Vue 样式语言必须与 `<style lang>` 一致，不得把预处理器语法按普通 CSS 校验。',
    ],
  }),
  entry({
    id: 'style-complexity',
    groupId: 'staged-quality-policy',
    gates: ['quality.style-complexity'],
    features: ['styleComplexity'],
    when: enabled('checks.styleComplexity'),
    lines: ({ config }) => [
      `- 样式选择器最多包含 ${config.checks.styleComplexity.maxCompoundSelectors} 个复合段，嵌套深度最多为 ${config.checks.styleComplexity.maxNestingDepth}；不得用 disable 注释绕过。`,
    ],
  }),
  entry({
    id: 'style-governance',
    groupId: 'staged-quality-policy',
    gates: ['quality.style-governance'],
    features: ['styleGovernance'],
    when: enabled('checks.styleGovernance'),
    lines: ({ config }) => [
      `- 样式优先级不得高于 ${code(config.checks.styleGovernance.maxSpecificity)}，ID 选择器最多 ${config.checks.styleGovernance.maxIdSelectors} 个，${config.checks.styleGovernance.disallowImportant ? '禁止' : '按项目配置控制'} !important。`,
    ],
  }),
  entry({
    id: 'ui-tokens',
    groupId: 'staged-quality-policy',
    gates: ['quality.ui-tokens'],
    features: ['uiTokens'],
    when: enabled('checks.uiTokens'),
    lines: ({ config }) => [
      `- UI Token 门禁检查 ${list(config.checks.uiTokens.languages)} 样式；sass 包含 .scss 与 .sass；检查范围为 ${list(config.checks.uiTokens.include)}，排除 ${list(config.checks.uiTokens.exclude)}。`,
      `- 颜色、间距、字体、字号、行高、字重、圆角、阴影、z-index、响应式断点、动画时长和图标尺寸必须精确映射到 ${code(config.checks.uiTokens.manifestFile)}；其他样式属性不受该门禁管理。`,
      `- CSS、Sass、Less 文件及 Vue 中对应语言的 style 块必须使用完整且类别匹配的别名，图标尺寸只在 ${list(config.checks.uiTokens.iconSelectors)} 选择器中检查；普通 CSS var(--name) 别名也可用于 Sass 与 Less，CSS 断点长度别名只用于 CSS，且必须是大于零的 px、em 或 rem。`,
      `- ${code(config.checks.uiTokens.manifestFile)} 不得自引用；清单声明的 CSS、Sass、Less 变量只能在来源文件定义；Manifest、来源文件或已启用配置不得从提交快照中被直接删除，来源文件变更后必须重新生成清单指纹。`,
    ],
  }),
  entry({
    id: 'pre-commit-order',
    groupId: 'staged-quality-policy',
    when: () => true,
    lines: () => [
      '- pre-commit 顺序固定为 Stylelint fix、ESLint fix、Prettier、只读 Stylelint/ESLint 校验、只读策略门禁，最后运行受保护文件门禁；不得运行项目级 fix，不得加入 TypeScript 类型检查。',
      '- 所有暂存修复必须通过 lint-staged 保留部分暂存与未暂存内容。',
    ],
  }),
  entry({
    id: 'async-resource-cleanup',
    groupId: 'source-safety-policy',
    gates: ['quality.vue-async-resource-cleanup'],
    features: ['asyncResourceCleanup'],
    when: enabled('checks.asyncResourceCleanup'),
    lines: ({ config }) => [
      `- Vue 与 composable 中创建的定时器、事件监听、WebSocket、Observer、订阅和请求必须在同一作用域形成可验证的释放闭环；长任务阈值为 ${config.checks.asyncResourceCleanup.timeoutThresholdMs}ms。`,
      `- 异步资源检查包含 ${list(config.checks.asyncResourceCleanup.include)}，排除 ${list(config.checks.asyncResourceCleanup.exclude)}；请求函数为 ${list(config.checks.asyncResourceCleanup.requestFunctions)}。`,
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
    when: enabled('checks.pathNaming'),
    lines: ({ config }) => [
      `- 目录和文件名统一使用 ${code(config.checks.pathNaming.convention)}；包含 ${list(config.checks.pathNaming.include)}，排除 ${list(config.checks.pathNaming.exclude)}，同一项目不得混用命名风格。`,
    ],
  }),
  entry({
    id: 'image-assets', groupId: 'repository-structure-policy',
    gates: ['repository.image-assets', 'repository.unused-image-assets'],
    features: ['imageAssets', 'unusedImageAssets'],
    when: ({ config }) => config.checks.imageAssets.enabled || config.checks.unusedImageAssets.enabled,
    lines: ({ config }) => {
      const requirements = [
        config.checks.imageAssets.naming.enabled
          ? `${code(config.checks.imageAssets.naming.convention)} 命名`
          : null,
        '扩展名与真实格式一致',
        config.checks.imageAssets.duplicates.exact !== 'off' ? '精确重复内容' : null,
        config.checks.imageAssets.duplicates.pixel !== 'off' ? '像素重复内容' : null,
        config.checks.imageAssets.compression.enabled ? '压缩收益阈值' : null,
        config.checks.imageAssets.compression.enabled
          && config.checks.imageAssets.compression.conversion.enabled
          ? 'WebP 转换策略'
          : null,
      ].filter(Boolean).join('、');
      return [
        ...(config.checks.imageAssets.enabled ? [
          `- 图片资源必须遵守${requirements}；包含 ${list(config.checks.imageAssets.include)}，排除 ${list(config.checks.imageAssets.exclude)}。Hook 与 CI 只能检查，不得自动删除资源、改写引用或执行有损转换。`,
        ] : []),
        ...(config.checks.unusedImageAssets.enabled ? [
          `- 无效图片资源按 ${code(config.checks.imageAssets.enforcement)} 模式治理；静态引用源码包含 ${list(config.checks.unusedImageAssets.sourceInclude)}，排除 ${list(config.checks.unusedImageAssets.sourceExclude)}。动态路径必须使用带原因且同时匹配真实源码和图片的 ${code('checks.unusedImageAssets.dynamicReferences')} 声明；不得使用整个仓库通配或未经确认自动删除图片。`,
        ] : []),
      ];
    },
  }),
  entry({
    id: 'file-placement', groupId: 'repository-structure-policy',
    gates: ['repository.file-placement'], features: ['filePlacement'],
    when: enabled('checks.filePlacement'),
    lines: ({ config }) => [
      `- 新增或变更文件必须符合 ${config.checks.filePlacement.rules.length} 条文件归类规则（模式 ${code(config.checks.filePlacement.mode)}）；不得通过扩大例外绕过目标目录。`,
    ],
  }),
  entry({
    id: 'code-placement', groupId: 'repository-structure-policy',
    gates: ['repository.code-placement'], features: ['codePlacement'],
    when: enabled('repository.codePlacement'),
    lines: ({ config }) => [
      `- 代码片段必须符合 ${config.repository.codePlacement.rules.length} 条代码归位规则；托管说明只公开规则边界，不复制受保护的匹配内容。`,
    ],
  }),
  entry({
    id: 'maximum-file-lines', groupId: 'repository-structure-policy',
    gates: ['repository.maximum-file-lines'], features: ['maxFileLines'],
    when: enabled('checks.maxFileLines'),
    lines: ({ config }) => [
      `- 文件行数按 ${code(config.checks.maxFileLines.mode)} 模式执行，达到上限 ${Math.round(config.checks.maxFileLines.warnAt * 100)}% 时预警；规则为 ${config.checks.maxFileLines.rules.map(({ pattern, maxLines }) => `${code(pattern)}≤${maxLines}`).join('、')}。`,
    ],
  }),
  entry({
    id: 'dependency-policy', groupId: 'dependency-health-policy',
    gates: ['dependencies.policy'], features: ['dependencies'],
    when: enabled('repository.dependencyPolicy'),
    lines: ({ config }) => [
      `- 依赖必须遵守精确版本、批准协议和锁文件同步策略；允许协议为 ${list(config.repository.dependencyPolicy.allowedProtocols)}，${config.repository.dependencyPolicy.requireLockfile ? '必须提交同步锁文件' : '按项目配置维护锁文件'}。`,
    ],
  }),
  entry({
    id: 'architecture', groupId: 'dependency-health-policy',
    gates: ['quality.architecture'], features: ['architecture'],
    when: enabled('checks.architecture'),
    lines: ({ config }) => [
      `- 修改模块依赖后必须运行 ${code('repo-guard architecture')}；扫描路径为 ${list(config.checks.architecture.sourcePaths)}，不得降低 severity、扩大 exclude 或缩小扫描范围绕过。`,
      `- 生效的架构规则为 ${list(config.checks.architecture.rules.filter(({ severity }) => severity !== 'ignore').map(({ name }) => name))}。`,
    ],
  }),
  entry({
    id: 'dead-code', groupId: 'dependency-health-policy',
    gates: ['quality.dead-code'], features: ['deadCode'], capabilities: ['dead-code-baseline'],
    when: enabled('checks.deadCode'),
    lines: ({ config }) => [
      `- Knip 无效代码检查使用 ${code(config.checks.deadCode.mode)} 模式，问题类型为 ${list(config.checks.deadCode.issueTypes)}；基线文件为 ${code(config.checks.deadCode.baselineFile)}。`,
      '- baseline 模式只允许阻止新增债务；基线只能通过确认后的专用命令收缩或更新，不得手工删除问题掩盖结果。',
    ],
  }),
  entry({
    id: 'typecheck', groupId: 'testing-policy',
    gates: ['quality.typecheck'], features: ['typeCheck'],
    when: enabled('checks.typeCheck'),
    lines: ({ config }) => [`- TypeScript 类型检查使用 npm 脚本 ${code(config.checks.typeCheck.script)}，只在显式、pre-push 或 CI full 阶段运行，不进入 pre-commit。`],
  }),
  entry({
    id: 'unit-test', groupId: 'testing-policy',
    gates: ['quality.unit-test'], features: ['unitTest'],
    when: enabled('checks.unitTest'),
    lines: ({ config }) => [
      `- 单元测试使用 npm 脚本 ${code(config.checks.unitTest.script)}；源码范围为 ${list(config.checks.unitTest.sourcePatterns)}，测试变更要求为 ${code(config.checks.unitTest.requireTests)}。`,
      '- 工具函数覆盖正常值、边界值和非法值；Composable、Store、API、Vue 组件及 Bug 修复必须覆盖相应状态和回归路径，禁止空测试及 skip/only/todo 绕过。',
    ],
  }),
  entry({
    id: 'coverage', groupId: 'testing-policy', features: ['coverage'],
    when: enabled('checks.coverage'),
    lines: ({ config }) => {
      const thresholds = config.checks.coverage.thresholds;
      return [`- 覆盖率阈值（行/语句/函数/分支/变更行）为 ${thresholds.lines}%/${thresholds.statements}%/${thresholds.functions}%/${thresholds.branches}%/${thresholds.changedLines}%；不得降低阈值或扩大生产源码排除项绕过。`];
    },
  }),
  entry({
    id: 'component-interaction', groupId: 'testing-policy', features: ['componentInteraction'],
    when: enabled('checks.componentInteraction'),
    lines: ({ config }) => [`- Vue 组件交互测试范围为 ${list(config.checks.componentInteraction.componentPatterns)}；必须触发真实交互并断言交互后的 DOM、状态、emit 或依赖调用结果。`],
  }),
  entry({
    id: 'accessibility-test', groupId: 'testing-policy',
    gates: ['quality.accessibility-test'], features: ['accessibilityTest'],
    when: enabled('checks.accessibilityTest'),
    lines: ({ config }) => [
      `- axe 可访问性测试使用 npm 脚本 ${code(config.checks.accessibilityTest.script)}，文件范围为 ${list(config.checks.accessibilityTest.testPatterns)}；每个测试必须扫描真实 DOM 并断言零违规。`,
    ],
  }),
  entry({
    id: 'mutation-test', groupId: 'testing-policy',
    gates: ['quality.mutation-test'], features: ['mutationTest'], capabilities: ['guarded-build'],
    when: enabled('checks.mutationTest'),
    lines: ({ config }) => [
      `- 变异测试使用 ${code(config.checks.mutationTest.configFile)}，报告目录为 ${code(config.checks.mutationTest.reportsDirectory)}；低于阈值时不得继续受保护构建。`,
      `- 受保护构建映射为 ${config.checks.mutationTest.guardedBuilds.length > 0 ? config.checks.mutationTest.guardedBuilds.map(({ packageScript, script }) => `${code(packageScript)}→${code(script)}`).join('、') : '无'}。`,
    ],
  }),
  entry({
    id: 'build', groupId: 'delivery-policy', gates: ['quality.build'], features: ['build'], capabilities: ['build-artifact-baseline'],
    when: enabled('checks.build'),
    lines: ({ config }) => [
      `- 构建门禁使用 npm 脚本 ${code(config.checks.build.script)}，失败或超时必须阻断当前交付流程。`,
      ...(config.checks.build.artifactBudget.enabled ? [
        `- 当前项目构建平台固定为 ${code(config.checks.build.artifactBudget.platform)}，产物目录为 ${code(config.checks.build.artifactBudget.outputDirectory)}；不得同时引入另一平台配置，不得保留旧产物或通过符号链接、跟踪产物、扩大预算绕过检查。`,
        ...(config.checks.build.artifactBudget.platform === 'pc' ? [
          `- PC 产物按 ${code(config.checks.build.artifactBudget.pc.analyzer)} 分析入口链、分块、压缩体积、source map 和异常文件；${config.checks.build.artifactBudget.mode === 'baseline' ? '历史基线只允许通过专用 prune 命令收缩。' : '所有已配置工程预算按当前模式执行。'}`,
        ] : [
          '- 微信小程序产物必须按 app.json 计算主包、每个分包、总包、单文件和 preloadRule；平台硬限制始终 error，禁止使用 report 或基线模式降级。',
        ]),
      ] : []),
    ],
  }),
  entry({
    id: 'lighthouse', groupId: 'delivery-policy', gates: ['quality.lighthouse'], features: ['lighthouse'],
    when: enabled('checks.lighthouse'),
    lines: ({ config }) => [`- Lighthouse 使用消费项目的 Chrome、路由、断言及 ${code(config.checks.lighthouse.configFile ?? '自动发现的配置文件')}；不得进入 pre-commit，也不得隐式上传报告。`],
  }),
  entry({
    id: 'ci', groupId: 'delivery-policy', features: ['ci'],
    when: enabled('ci'),
    lines: ({ config }) => [`- CI 使用 ${code(config.ci.profile)} 配置档并输出本地报告 ${code(config.ci.reportPath)}；所有托管策略必须在 CI 执行前保持同步。`],
  }),
  entry({
    id: 'notification', groupId: 'delivery-policy', features: ['notification'],
    when: enabled('reporting.notification'),
    lines: () => ['- 企业微信通知只从本地或 CI 环境读取凭据；成功、失败、取消和自动取消必须按相应工作流发送中文状态，不得把 webhook 写入仓库或 AGENTS.md。'],
  }),
  entry({
    id: 'external-gates', groupId: 'delivery-policy', capabilities: ['external-gates', 'api-performance', 'k6'],
    when: ({ config }) => config.ci.externalGates.some(({ enabled: gateEnabled }) => gateEnabled),
    lines: ({ config, packageJson }) => config.ci.externalGates
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
    when: () => true,
    lines: () => [
      '- 交付前必须通过已配置的工程质量、测试与构建检查；缺少工具、脚本或配置必须修复，不得将执行失败改为通过。',
      '- 构建与部署计划由独立的 repo-guard.ops.json 维护；前后端可独立发布，工程质量检查不会自动执行部署。',
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
      item.groupId === group.id && item.when(context) && entryAppliesToProject(item, context.config)
    ));
    const lines = [
      `## ${group.title}`,
      '',
      ...activeEntries.flatMap((item) => renderProjectEntry(item, context)),
    ];
    return Object.freeze({ ...group, lines: Object.freeze(lines) });
  }));
}

function entryAppliesToProject(item, config) {
  if (!config.project) {
    return ['workspace-isolation', 'independent-delivery', 'commit-animation', 'protected-files', 'delivery-contract',
      'commit-message', 'pre-commit-order', 'ci',
      'notification', 'release-readiness'].includes(item.id);
  }
  return config.project.role !== 'backend'
    || !['vue-security', 'vue-accessibility', 'async-resource-cleanup', 'component-interaction',
      'accessibility-test', 'lighthouse', 'ui-tokens'].includes(item.id);
}

function renderProjectEntry(item, context) {
  let lines = item.lines(context);
  const { config } = context;
  if (config.project?.role === 'backend') {
    lines = lines.filter((line) => !line.includes('Vue 样式语言必须'));
    if (item.id === 'unit-test') {
      lines = [lines[0], '- 测试必须覆盖团队要求的正常、边界、异常和回归路径；禁止空测试及 skip/only/todo 绕过。'];
    }
  }
  return lines;
}
