# repo-guard

**规则按需配置，提交统一检查，交付持续改进。**

repo-guard 是一个面向 Vue、JavaScript 和 TypeScript 项目的 npm 包。把团队规范写进配置，让开发者和 AI 遵守同一套约定，并将需求、开发、测试、发布、反馈与反向升级串成完整流程。

- **配置规则**：按项目需要启用或关闭可配置能力，调整检查范围与阈值。
- **统一规范**：提交代码前自动检查，给出具体问题、位置和中文修复指引。
- **贯通交付**：关联需求、任务、验证与反馈，让本轮问题推动下一轮改进。

[安装](#安装) · [配置规则](#配置规则) · [功能](#功能) · [提交检查示例](#提交检查示例) · [完整交付闭环](#完整交付闭环) · [使用说明](docs/usage-guide.md)

## 安装

在要接入的 Git 项目根目录执行。需要 Node.js `>=22.23.2`。

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@1.23.1
npx repo-guard init
npx repo-guard doctor
```

`init` 创建或补齐项目配置，安装托管 Git Hook，并同步项目脚本与 `AGENTS.md` 中的团队规范。`doctor` 检查配置、工具和托管文件是否就绪，并提示需要补齐的内容。

ESLint、Prettier、Stylelint 等工具使用项目已有的安装与配置；初始化根据项目准备状态启用部分检查，其余能力按需接入。已有非托管 Hook 会提示冲突，接入方式见[安装与初始化说明](docs/usage-guide.md#快速开始)。

- 当前版本：`1.23.1`
- npm 包：[`@cxyi7/repo-guard`](https://www.npmjs.com/package/@cxyi7/repo-guard)

## 配置规则

用 `repo-guard.config.json` 保存团队约定。可以通过命令切换能力，也可以编辑配置，细化规则的范围和要求。

### 启用或关闭

例如，让项目统一使用一种文件和目录命名风格：

```bash
# 启用路径命名检查
npx repo-guard enable pathNaming

# 需要关闭时
npx repo-guard disable pathNaming
```

也可以一次启用多个能力：

```bash
npx repo-guard enable eslint prettier
```

![路径命名规则：同一项配置，按需启用或关闭](docs/images/repo-guard-rule-config.svg)

### 调整检查范围

将下面的字段合并到已有配置中。例如，检查 `src/` 下的文件和目录，使用 `camelCase`，排除自动生成的内容：

```json
{
  "preCommit": {
    "pathNaming": {
      "enabled": true,
      "convention": "camelCase",
      "include": ["src/**"],
      "exclude": ["src/generated/**"]
    }
  }
}
```

直接编辑配置后，同步托管规范并检查就绪状态：

```bash
npx repo-guard migrate
npx repo-guard doctor
```

`enable` / `disable` 会同步托管规范。路径命名启用后检查范围内的全部 Git 已跟踪路径，包括新暂存的文件；存量命名也需要符合约定。

可配置能力的完整名单见[启用或关闭能力](docs/usage-guide.md#启用或关闭能力)。动态代码、Vue `v-html`、新窗口链接、表单标签和图片替代文本属于内置硬性检查，没有关闭开关。

## 功能

按团队需要选择能力，再通过对应文档配置。各能力在提交、推送、CI 或手动入口执行，具体范围以配置和执行计划为准。

### 代码与团队规范

| 能力 | 用来做什么 | 配置与说明 |
|---|---|---|
| 代码与样式 | 修复和复核 ESLint、Prettier、Stylelint 规则，控制样式复杂度 | [执行顺序](docs/usage-guide.md#固定执行顺序) |
| 文件与目录 | 统一命名、限制文件行数、约束文件和指定代码的位置 | [路径命名](docs/usage-guide.md#配置统一路径命名) · [代码位置](docs/usage-guide.md#配置指定代码允许位置) |
| Vue 与界面 | 检查异步资源清理、UI Token、安全写法和基础可访问性 | [异步资源](docs/usage-guide.md#配置-vue-异步资源清理) · [UI Token](docs/usage-guide.md#配置-ui-token-门禁) |
| 资源与仓库 | 治理图片命名、重复、压缩和无效引用，检查依赖与保护文件 | [图片治理](docs/usage-guide.md#配置图片资源治理与-webp-转换) · [保护文件](docs/usage-guide.md#配置不可变文件) |
| 协作约定 | 同步文件头、函数文档、AI 规范，检查提交信息 | [托管规范](docs/usage-guide.md#agentsmd-托管规范) · [提交信息](docs/usage-guide.md#配置-commit-提交信息门禁) |

### 测试与交付

| 能力 | 用来做什么 | 配置与说明 |
|---|---|---|
| 测试与构建 | 接入类型、单元与组件测试、覆盖率、架构、无效代码和构建检查 | [能力索引](docs/features/README.md#测试构建与性能) |
| 质量与性能 | 接入变异测试、axe、Lighthouse、构建产物预算和接口压测 | [变异测试](docs/usage-guide.md#配置变异测试与受保护构建) · [构建预算](docs/usage-guide.md#配置构建产物预算) |
| CI 与发布准备 | 复核检查结果、保存报告，接入 GitLab 流水线并检查发布条件 | [GitLab CI](docs/usage-guide.md#gitlab-ci) · [交付流水线](docs/usage-guide.md#托管应用交付流水线) |
| 需求与反馈 | 关联功能、需求、任务、验收、反馈与执行证据 | [交付合同手册](docs/features/delivery-contract.md) |

全部能力及单项文档维护状态见[功能说明索引](docs/features/README.md)。

## 提交检查示例

假设团队已经启用 `camelCase` 路径命名规则。新增 `src/user_info.js` 后提交，会收到不符合命名规范的提示；改为 `src/userInfo.js`、同步引用并重新暂存后，再次提交通过。

![真实提交检查：文件命名不符合规范时阻止提交，修正后通过](docs/images/repo-guard-commit-demo.svg)

*图中内容节选自独立演示仓库的真实 Git Hook 运行结果，经过排版；本例聚焦路径命名，ESLint、Prettier 和 Stylelint 未启用。*

日常使用仍然是熟悉的 Git 操作：

```bash
git add src/userInfo.js
git commit -m "feat: 添加用户信息"
```

启用格式与样式检查后，提交阶段按 **Stylelint 修复 → ESLint 修复 → Prettier → Stylelint / ESLint 只读复核 → 其余策略检查 → 保护文件检查** 执行。修复通过 `lint-staged` 处理暂存内容，保留部分暂存和未暂存改动。

类型检查、测试、架构、构建与 Lighthouse 放在推送、CI 或手动入口执行。具体安排见[固定执行顺序](docs/usage-guide.md#固定执行顺序)。

## 完整交付闭环

团队规范贯穿交付全程。需要进一步关联需求、任务、验收和反馈时，可以启用合同驱动交付：用一组随 Git 保存的资料，记录这次要做什么、如何验证，以及问题如何处理。

![repo-guard 完整交付闭环](docs/images/repo-guard-feature-map.svg)

| 阶段 | 团队做什么 | 留下什么依据 |
|---|---|---|
| 需求 | 确认目标、范围与验收条件 | 功能归属、需求快照与交付合同 |
| 开发 | 拆分任务，按团队规范实现并提交 | 任务记录、代码变更与检查结果 |
| 测试 | 运行验证，复核真实效果并处理发现 | 测试证据、问题记录与人工确认 |
| 发布 | 复核发布条件，由团队执行发布 | 发布前的检查与交付证据 |
| 反馈 | 收集测试或使用中的问题，关联修复与复测 | 正式发现、关联任务与回归证据 |
| 反向升级 | 评估并确认应完善的需求、设计、测试或规则 | 升级结论与下一轮改进任务 |

例如，用户反馈某个表单漏了校验：团队补充需求约定，修复实现并增加回归测试；如果这类问题能在其他功能中重复出现，再评估是否增加统一检查规则。反馈也可以直接来自测试阶段。

这套流程由人、AI 和工具共同完成：人确认需求、验收和升级决定，开发者与 AI 实现和修复，repo-guard 检查约定及证据。`release-ready` 复核发布条件，实际发布由团队执行。

合同能力默认关闭。接入、四方时序、真实反馈升级和证据格式统一见[交付合同手册](docs/features/delivery-contract.md)。准备好交付资料后启用：

```bash
npx repo-guard enable deliveryContract
```

## 文档

| 文档 | 内容 |
|---|---|
| [使用说明](docs/usage-guide.md) | 安装、配置、命令与操作要求 |
| [功能说明索引](docs/features/README.md) | 全部能力与单项文档维护状态 |
| [维护者架构说明](docs/project-structure-and-feature-inventory.md) | 代码结构、模块职责与依赖关系 |
| [交付合同手册](docs/features/delivery-contract.md) | 接入、四方时序、反馈升级、人工确认与字段格式 |
| [更新日志](CHANGELOG.md) | 各版本的变更记录 |

## 贡献与反馈

欢迎通过 [GitHub Issues](https://github.com/cxyi7/repo-guard/issues) 提交问题或建议。反馈问题时，请附上版本、触发命令、预期与实际结果，以及脱敏后的最小复现。

参与开发前请阅读 [AGENTS.md](AGENTS.md)。在本仓库执行以下检查；行为变化需同步测试与文档：

```bash
npm ci
npm run check
npm test
npm run pack:check
```

## 许可证

[MIT](LICENSE) © cxyi7
