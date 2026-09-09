# @cxyi7/repo-guard 使用说明

本手册帮助团队完成接入、配置规则、处理检查结果，并将需求到反馈的交付流程落到项目中。详细规则按功能独立维护，使用时从本页进入对应说明。

- 当前源码版本：`2.0.0`
- Node.js：`>=22.23.2`
- 配置契约：`version: 2`，项目身份由人或 AI 明确配置

[开始接入](#快速开始) · [配置规则](#配置团队规则) · [日常提交](#固定执行顺序) · [功能用法](#常用使用方式) · [测试与构建](#接入测试与构建) · [交付流程](#完整交付流程) · [CI](#gitlab-ci) · [排查问题](#诊断与修复)

## 快速开始

### 准备项目工具

在需要接入的 Git 项目根目录操作。repo-guard 调用项目自己的工具和脚本；安装 npm 包不会自动替你准备全部 lint、测试、构建或浏览器环境。

| 要接入的能力 | 项目需要准备 |
|---|---|
| ESLint | ESLint 与项目配置；默认预设要求 ESLint `>=9.19` 和 `@eslint/js`，Vue/TS 按项目配置准备插件与解析器 |
| Prettier | Prettier 3.x 与格式配置，例如 `.prettierrc.json` |
| Stylelint | Stylelint `>=16 <18`、规则配置及所用样式语言的解析器 |
| 单元测试 / 组件交互 | Vitest `>=1 <5` 与 `test:unit`；组件交互还需 `@vue/test-utils` 2.x 和 Vue/DOM 测试环境 |
| 类型 / 构建 | 实际可执行的 `typecheck` / `build` 项目脚本 |
| 架构 | dependency-cruiser `>=16 <19` 与待检查的源码目录 |
| axe / Lighthouse | 项目自己的测试集成、浏览器或 DOM 环境；Lighthouse 还需 Vue、`@lhci/cli` 和页面配置 |

这些是当前包声明和运行校验对应的要求。可选能力的准备方式见各功能说明；安装依赖时使用 `--save-exact`，并提交同步的锁文件。

### 安装与初始化

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@2.0.0
npx repo-guard init --project web --role frontend --stack node --preset vue-javascript
npx repo-guard doctor
```

本文在普通终端中使用 `npx repo-guard`。`package.json` 的 npm scripts 内可直接写 `repo-guard`；先确认本项目已经安装该包，再执行命令。

`init` 创建或补齐 `repo-guard.config.json`，安装五个托管 Hook，将 `core.hooksPath` 设为 `.githooks`，维护 `.gitattributes`、`.gitignore`、本地 `.env.config`，并补充 `guard:*` 脚本与 AGENTS 托管规范。启用交付合同后还会同步交付流程 Skills。已有非托管 Hook 或不同的 `core.hooksPath` 会提示冲突，不直接覆盖。

**新建配置时的启用状态：**

- 默认启用 ESLint（含预设）、Prettier、依赖策略、文件归位、单文件行数和通知开关。
- Stylelint、样式增强、类型、单元测试、axe、架构和构建默认关闭；通过显式配置或 enable 命令启用，不根据安装的依赖自动改变开关。
- Lighthouse、覆盖率、组件交互、图片治理、交付合同、变异测试、CI 等能力默认关闭。
- 通知开关启用不等于通知凭据已经可用；按 Doctor 提示配置本地环境。

已有配置会保留，不会因再次执行 `init` 就重置团队选择。`doctor` 通过表示配置、依赖和托管内容就绪，不等于全部业务测试与性能检查已经通过。

### 完成第一次检查

先按 Doctor 提示修正缺失工具、配置或通知环境，再暂存一次真实变更并提交：

```bash
git add src/utils/userInfo.js
git commit -m "feat: 添加用户信息"
```

将示例路径换成当前变更。检查失败时根据中文提示修复、重新暂存并提交；通过后才能说明本次实际执行的规则已满足。随后推送时，已启用的重型检查由 pre-push 执行。

## 配置团队规则

单应用配置保存在项目根目录 `repo-guard.config.json`。多应用仓库在根配置登记应用清单及公共规范，各应用保存自己的检查配置。本手册的 JSON 标为“配置片段”时，应合并到对应配置，保留 `version`、项目身份、其他规则与团队已有选择；不要用片段覆盖整个文件。

### Node 后端与前后端协作

Node 后端使用显式身份初始化。JavaScript 选择 `node-javascript`，TypeScript 选择 `node-typescript`：

```bash
npx repo-guard init --project api --role backend --stack node --preset node-typescript
npx repo-guard doctor
```

Node 后端复用 ESLint、Prettier、命名、目录、依赖、类型、架构、测试、覆盖率、变异测试及构建等通用工程检查。团队准备自己的工具和脚本，再开启所需能力；Vue、组件交互和页面检查不适用于后端。当前不会新增接口输入输出、身份权限或业务规则校验。

前后端分仓时，各仓库独立初始化；同仓时用 `projects` 明确应用目录，提交 Hook 按文件归属调用各应用的工具，公共仓库规则统一执行。专项命令和 CI 可通过 `--project api` 选择应用，省略选择的仓库级 CI 检查全部应用。完整目录、字段约束及示例见[项目身份与多应用工作区](features/project-workspace.md)。Java 校验和自动安装工具将在后续适配，本版尚未提供。

### 启用或关闭能力

```bash
npx repo-guard enable pathNaming
npx repo-guard disable pathNaming
npx repo-guard enable eslint prettier
```

启停命令会保存配置并同步 AGENTS 托管规范。直接编辑配置后执行：

```bash
npx repo-guard doctor --fix
npx repo-guard doctor
```

下表列出全部 31 个可配置功能名。默认状态指首次按显式预设生成配置。Vue 专用功能不能用于后端；启用检查后必须准备项目工具与配置。CI 还有独立策略，自动执行范围见后文。

| 功能名 | 配置位置 | 功能说明（点击查看用法） | 初始状态 | 自动入口 / 触发方式 |
|---|---|---|---|---|
| `eslint` | `checks.eslint` | [检查 JS、TS、Vue 代码问题，并按项目规则修复可修复项](features/eslint.md) | 开 | 提交、CI full/release-ready |
| `prettier` | `checks.prettier` | [统一缩进、换行、引号等代码与文档格式](features/prettier.md) | 开 | 提交、CI full/release-ready |
| `stylelint` | `checks.stylelint` | [检查 CSS、预处理样式与 Vue 样式规范](features/stylelint.md) | 关 | 提交、CI full/release-ready |
| `styleComplexity` | `checks.styleComplexity` | [限制选择器组合数量和样式嵌套深度](features/style-complexity.md) | 关 | 随 Stylelint |
| `styleGovernance` | `checks.styleGovernance` | [约束样式优先级、ID、!important 和全局样式位置](features/style-governance.md) | 关 | 随 Stylelint |
| `fileHeader` | `checks.fileHeader` | [按 Git 事实同步文件头信息，保留人工描述](features/file-header.md) | 关 | 提交 |
| `functionDocs` | `checks.functionDocs` | [随函数签名同步文档标签，保留业务说明](features/function-documentation.md) | 关 | 提交 |
| `asyncResourceCleanup` | `checks.asyncResourceCleanup` | [检查 Vue 组件与组合函数的定时器、监听等资源清理](features/async-resource-cleanup.md) | 关 | 提交、CI 三档 |
| `pathNaming` | `checks.pathNaming` | [统一文件与目录的 camelCase 或 kebab-case 命名](features/path-naming.md) | 关 | 提交、CI 三档 |
| `uiTokens` | `checks.uiTokens` | [要求受控颜色、间距、字号等使用项目声明的设计 Token](features/ui-tokens.md) | 关 | 提交、CI 三档 |
| `filePlacement` | `checks.filePlacement` | [按文件类型限制存放目录，避免资源和文档散落](features/file-placement.md) | 开 | 提交、CI 三档 |
| `maxFileLines` | `checks.maxFileLines` | [限制单文件规模，提示接近上限或阻断继续膨胀](features/maximum-file-lines.md) | 开 | 提交、CI 三档 |
| `codePlacement` | `repository.codePlacement` | [限制指定代码文本只在允许的文件中出现](features/code-placement.md) | 关 | 提交、CI 三档 |
| `dependencies` | `repository.dependencyPolicy` | [检查依赖版本、来源、重复声明和锁文件一致性](features/dependency-policy.md) | 开 | 提交、CI 三档 |
| `commitMessage` | `repository.commitMessage` | [统一提交信息格式，并在推送和 CI 复核提交历史](features/commit-message.md) | 关 | 提交信息、推送、CI 三档 |
| `imageAssets` | `checks.imageAssets` | [检查图片命名、真实格式、重复内容及优化收益](features/image-assets.md) | 关 | 提交、CI 三档 |
| `unusedImageAssets` | `checks.unusedImageAssets` | [查找没有有效引用的图片，支持限制新增历史债务](features/unused-image-assets.md) | 关 | 推送、CI full/release-ready |
| `deliveryContract` | `repository.deliveryContract` | [把需求、任务、测试、人工验收与反馈绑定为可复核交付](features/delivery-contract.md) | 关 | 提交、CI 三档 |
| `typeCheck` | `checks.typeCheck` | [调用项目类型脚本，检查 TypeScript 或 Vue 类型错误](features/typecheck.md) | 关 | 推送、CI full/release-ready |
| `architecture` | `checks.architecture` | [检查循环依赖、导入解析与团队模块分层边界](features/architecture.md) | 关 | 推送、CI full/release-ready |
| `deadCode` | `checks.deadCode` | [使用 Knip 检查无效文件、导出和依赖，支持历史基线](features/dead-code.md) | 关 | 推送、CI full/release-ready |
| `build` | `checks.build` | [执行项目构建，并检查已配置的产物预算](features/build.md) | 关 | 推送、CI full/release-ready |
| `lighthouse` | `checks.lighthouse` | [检查 Vue 页面的性能等 Lighthouse 指标和项目断言](features/lighthouse.md) | 关 | 推送、release-ready |
| `unitTest` | `checks.unitTest` | [执行项目 Vitest，并检查源码与测试的对应关系](features/unit-test.md) | 关 | 推送、CI full/release-ready；policy 检查资料 |
| `componentInteraction` | `checks.componentInteraction` | [要求 Vue 组件测试包含真实操作及可观察结果断言](features/component-interaction.md) | 关 | 随单元测试及资料策略 |
| `coverage` | `checks.coverage` | [检查测试覆盖率与本次变更行覆盖率是否达标](features/coverage.md) | 关 | 随完整单元测试执行 |
| `accessibilityTest` | `checks.accessibilityTest` | [执行项目 axe 测试，检查实际界面的可访问性问题](features/accessibility-test.md) | 关 | 推送、CI full/release-ready |
| `mutationTest` | `checks.mutationTest` | [用 Stryker 改动代码验证测试能否发现错误](features/mutation-test.md) | 关 | 显式手动或受保护构建 |
| `notification` | `reporting.notification` | [在适用的本地保护文件和构建失败流程发送企业微信通知](features/wecom-notification.md) | 开 | 适用的本地通知流程 |
| `commitAnimation` | `reporting.commitAnimation` | [用小猫或小狗展示提交检查状态，真实提交成功后播放类型道具和彩蛋](features/commit-animation.md) | 关 | 本地 `pre-commit` / `post-commit` |
| `ci` | `ci` | [在 CI 按固定配置档复核规则并输出统一报告](features/gitlab-ci.md) | 关 | 显式 CI / 托管 Job |

**开关之间的联动：** `coverage`、`componentInteraction` 会启用 `unitTest`；关闭 `unitTest` 会关闭组件交互与覆盖率检查。`styleComplexity`、`styleGovernance` 会启用 Stylelint，关闭 Stylelint 会关闭两项增强。`unusedImageAssets` 会启用图片治理，关闭图片治理会关闭无效图片检查。

**区分三个入口：** 自动 Hook 按功能配置执行；CI 可按 Gate 设置 `inherit/off/report/enforce`；手动专项入口按自身契约运行。例如 `path-naming`、`dead-code`、`lighthouse` 的显式手动命令即使自动开关关闭也会检查，而 `unit-test`、`typecheck`、`build` 仍读取功能开关。

动态代码、Vue `v-html`、新窗口链接、表单标签和图片替代文本没有 `enable/disable` 功能开关；它们在适用的提交检查中固定执行，Vue 专用检查只面向前端。CI 对这些 Gate 的处理仍受独立 CI 策略控制。保护文件使用 `repository.rules` 与 `repository.exclusions` 配置，结构化例外使用 `repository.exceptions`，都不在 31 项功能开关中。

### 初始化、迁移和诊断

| 命令 | 用途 |
|---|---|
| `npx repo-guard init --project api --role backend --stack node --preset node-typescript` | 按明确身份首次接入并同步托管文件 |
| `npx repo-guard install-hooks` | 安装或更新托管 Hook |
| `npx repo-guard migrate --project api --role backend --stack node --preset node-typescript` | 备份并迁移单项目 v1 配置为 v2；前端须使用对应身份与预设 |
| `npx repo-guard doctor` | 检查配置、项目工具及托管文件的就绪状态 |
| `npx repo-guard doctor --fix` | 修复受管配置、Hook、CI、忽略项、项目脚本、AGENTS 和交付 Skills 等受管内容 |
| `npx repo-guard doctor --ci` | 检查 CI 接入状态 |

`doctor --fix` 不安装项目工具、不填写密钥、不修复业务代码。托管文本检查会统一 LF、CRLF 和 CR；换行差异本身不会造成“托管内容过期”。

### AGENTS.md 托管规范

repo-guard 将项目配置和固定硬门禁投影为 7 个职责区块：仓库与变更治理、暂存代码质量、源码安全与资源生命周期、目录与文件结构、依赖与仓库健康度、测试质量、构建/交付与外部门禁。每个可配置功能至少对应一条规范；同一主题的能力会合并到同一区块，避免按功能生成大量零散章节。

- `init`、`enable`、`disable`、`migrate`、`doctor --fix` 和非预览的 `install-ci` 会同步托管区块。
- 同步前会先校验全部当前 marker 和已知旧 marker，全部有效后才一次写入；marker 缺失、重复、倒置或嵌套时拒绝修改文件。
- marker 外的人工内容和先后顺序保持不变；已禁用功能的陈旧说明会被删除，旧的四类策略 marker 会迁移为当前分组。
- webhook、通知凭据和 `repository.codePlacement.content` 等敏感值不会写入托管规范。
- Git Hook 不写 `AGENTS.md`。直接编辑配置后应运行 `npx repo-guard doctor --fix`；CI 的 `repository.agent-policy` 只读门禁会阻断未同步内容。`migrate` 专用于旧配置升级。
- 托管规范没有独立的 `enabled` 开关，不能在保留功能门禁的同时关闭对应 AI 约束。

## 固定执行顺序

| Hook | 职责 |
|---|---|
| `pre-commit` | 修复和复核暂存代码，再检查仓库策略 |
| `prepare-commit-msg` | 准备提交信息与变更文件摘要 |
| `commit-msg` | 按已启用规则校验提交信息并完成摘要 |
| `post-commit` | 清理提交信息相关临时状态 |
| `pre-push` | 检查提交范围，并运行已启用的测试、类型、架构、构建等能力 |

### pre-commit

顺序由锁定 Execution Plan 固定，消费项目不能重排：

启用 `checks.fileHeader` 或 `checks.functionDocs` 后，对应内容会先在 `lint-staged` 的暂存快照中完成同步，再进入下列受保护 Execution Plan；它们不新增、不删除也不重排计划步骤。

整个 pre-commit 生命周期由仓库级互斥锁保护。同一仓库已有提交或 Hook 正在运行时，重叠实例会在操作 Git 索引、工作区或 `lint-staged` 备份前以 `pre-commit/already-running` 停止；应等待当前实例结束后重试。每个实例使用包含 PID 和随机所有权令牌的唯一锁文件，进程异常退出留下的文件只按自身唯一路径清理，不需要手工删除活动锁。

```text
Stylelint fix
  → ESLint fix
  → Prettier
  → Stylelint read-only verify
  → ESLint read-only verify
  → UI Token（启用时按项目声明的 Sass/UnoCSS 适配器检查）
  → Vue async-resource-cleanup（启用时阻断）
  → path-naming（启用时检查全部已跟踪路径）
  → dynamic-code
  → Vue v-html
  → Vue target=_blank
  → Vue form label
  → Vue image alt
  → maximum-file-lines
  → file-placement
  → dependency-policy（最终 Git 索引）
  → image-assets（启用时读取最终 Git 索引二进制内容）
  → code-placement（最终 Git 索引）
  → delivery-contract（最终 Git 索引与完整合同比较范围）
  → protected-files（最后执行）
```

TypeScript、Knip 全项目无效代码、单元测试、axe、项目架构、构建和 Lighthouse 不进入 pre-commit。

### pre-push

```text
commit-message
  → typecheck
  → dead-code
  → unused-image-assets
  → unit-test
  → accessibility-test
  → architecture
  → build
  → lighthouse
```

各步骤根据配置启用或跳过。提交历史、增量策略与变更行使用可信推送范围；Knip、类型、项目测试和构建等仍按自身契约检查整个项目，不等于只运行变更文件。

`pre-push` 会在重型门禁开始时立即输出中文阶段提示，并实时转发 TypeScript、单元测试、axe 和构建脚本的输出；Knip 与架构检查会显示即时进度，同时保留结构化 JSON 供机器解析。实时输出经过路径与敏感信息脱敏，失败后仍返回结构化问题和退出码，不会让 `git push` 在长时间任务中无提示等待。

这些顺序由固定执行计划维护，项目不能重排。需要全项目修复时由开发者显式运行项目自己的维护命令，不放入 Hook。

## 常用使用方式

### 代码格式与样式

准备好工具和配置后启用，并使用真实提交验证：

```bash
npx repo-guard enable eslint prettier
npx repo-guard enable stylelint styleComplexity styleGovernance
npx repo-guard doctor
```

各功能的最小配置、预设、阈值和失败处理见 [ESLint](features/eslint.md)、[Prettier](features/prettier.md)、[Stylelint 与样式规范](features/stylelint.md)。

### 文件归位与单文件行数

详见[文件归位](features/file-placement.md)和[单文件行数](features/maximum-file-lines.md)。

初始化默认启用。文件归位默认约束新增资源与 Markdown 的目录；单文件行数按文件类型检查。以下是按团队约定调整的配置片段：

```json
{
  "checks": {
    "filePlacement": {
      "enabled": true,
      "mode": "newFiles",
      "rules": [
        {
          "name": "图片资源",
          "patterns": [
            "**/*.{png,jpg,svg}"
          ],
          "allowedPatterns": [
            "src/assets/**",
            "docs/assets/**"
          ],
          "exceptions": [
            "public/favicon.svg"
          ],
          "suggestedDirectory": "src/assets"
        }
      ]
    },
    "maxFileLines": {
      "enabled": true,
      "mode": "strict",
      "warnAt": 0.85,
      "rules": [
        {
          "pattern": "**/*.vue",
          "maxLines": 700
        }
      ],
      "exclusions": []
    }
  }
}
```

数组代表这一项的完整规则集合，实际配置应保留其他需要的文件类型。归位失败时移动文件并同步引用，行数超限时拆分职责，重新暂存后复核；`npx repo-guard file-placement` 可显式审计工作区。没有单独的单文件行数手动命令，通过提交或 CI 复核。

### 依赖声明与锁文件

详见[依赖声明与锁文件](features/dependency-policy.md)。

依赖策略默认启用，要求精确版本与同步锁文件。项目可配置允许的协议和禁用依赖：

```json
{
  "repository": {
    "dependencyPolicy": {
      "enabled": true,
      "requireExactVersions": true,
      "requireLockfile": true,
      "allowedProtocols": [
        "npm",
        "workspace"
      ],
      "bannedPackages": []
    }
  }
}
```

```bash
npx repo-guard dependencies
```

提交阶段读取最终 Git 索引中的依赖声明和锁文件。按报告修复版本、依赖分组、来源或锁文件一致性，再同时暂存相关文件。

### 原生安全与基础可访问性

| 检查 | 典型修复方向 | 手动命令 |
|---|---|---|
| 动态代码 | 移除不安全的动态求值，改为明确的数据与控制流程 | `npx repo-guard dynamic-code` |
| Vue 不安全 HTML | 避免未经规则允许的 `v-html` 写法 | `npx repo-guard unsafe-html` |
| 新窗口链接 | 为 `target="_blank"` 配置安全的 `rel` | `npx repo-guard target-blank` |
| 表单标签 | 为控件提供可识别的标签或可访问名称 | `npx repo-guard form-labels` |
| 图片替代文本 | 根据图片用途提供适当的替代文本 | `npx repo-guard image-alt` |

详细用法：[动态代码](features/dynamic-code.md)、[Vue 不安全 HTML](features/vue-unsafe-html.md)、[新窗口链接](features/vue-target-blank.md)、[表单标签](features/vue-form-label.md)、[图片替代文本](features/vue-image-alt.md)。

这些静态规则覆盖各自能识别的源码写法，实际界面还需测试与人工验收。具体违规以报告中的规则、位置、证据和修复要求为准。

### 结构化例外

有些规则允许经审核的精确、限时例外。需记录规则 ID、文件位置、原因、责任人、批准人、关联问题和有效期。完整字段及复核流程见[结构化例外](features/structured-exceptions.md)。

### 配置不可变文件

详见[保护文件](features/protected-files.md)。

使用精确仓库相对路径和 `level: "block"`：

```json
{
  "repository": {
    "exclusions": [],
    "rules": [
      {
        "pattern": "src/security/permission-map.ts",
        "category": "不可变安全文件",
        "level": "block"
      }
    ]
  }
}
```

修改、删除、重命名或移动该文件都会阻断提交和 CI。规则按数组顺序采用第一条匹配，精确 `block` 规则应放在可能覆盖它的宽泛规则之前；`exclusions` 优先于规则。

`audit`、`notify`、`block` 分别用于审计、通知和阻断级别；CI 的保护文件动作另受 `ci.protectedFiles.action` 约束，但 `block` 仍必须阻断。下列命令只针对保护文件及其相关检查，不代表运行全部测试：

```bash
npx repo-guard check
npx repo-guard gate
npx repo-guard dry-run
npx repo-guard gate --force-notify
```

`check` 查看工作区受保护变更，发现此类变更就会返回非零；`gate` 执行提交侧保护流程；`dry-run` 预览保护文件判断，不发送通知。

### 企业微信通知

详见[企业微信通知](features/wecom-notification.md)。

`init` 会创建被 Git 忽略的 `.env.config`：

```dotenv
REPO_GUARD_WECOM_WEBHOOK=
REPO_GUARD_MENTION_MOBILES=
```

系统环境变量优先于文件值。CI 不读取本地通知凭据，也不发送保护文件通知。

可用 `npx repo-guard enable notification` 或 `disable notification` 切换本地通知开关。凭据填写在本地 `.env.config` 或系统环境中，不能提交到 Git；缺失配置时按 Doctor 提示处理。GitLab 流水线通知有独立设置，见[托管应用交付流水线](features/managed-delivery-pipeline.md)。

### 配置 Commit 提交信息门禁

校验团队提交格式，并在推送、CI 和发布准备中复核真实提交对象。 接入配置、执行范围与修复说明见[提交信息](features/commit-message.md)。

### 配置项目级无效代码门禁

使用项目自己的 Knip 检查全项目依赖图，并支持逐步清理历史债务。 接入配置、执行范围与修复说明见[无效代码与基线](features/dead-code.md)。

### 配置暂存文件头

根据 Git 事实同步暂存文件头，保留人工维护的描述。 接入配置、执行范围与修复说明见[文件头同步](features/file-header.md)。

### 配置暂存函数文档

随函数参数和返回结构更新文档标签，保留业务说明。 接入配置、执行范围与修复说明见[函数文档同步](features/function-documentation.md)。

### 配置 Vue 异步资源清理

检查组件与组合函数创建的异步资源是否有可靠的生命周期清理。 接入配置、执行范围与修复说明见[Vue 异步资源清理](features/async-resource-cleanup.md)。

### 配置统一路径命名

统一范围内的文件和目录命名，支持 camelCase 或 kebab-case。 接入配置、执行范围与修复说明见[路径命名](features/path-naming.md)。

### 配置 UI Token 门禁

按项目 Manifest 检查 Sass 与 UnoCSS 的设计 Token 使用。 接入配置、执行范围与修复说明见[UI Token 契约](features/ui-tokens.md)。

### 配置图片资源治理与 WebP 转换

检查图片命名、格式、重复与优化收益，显式选择是否写入优化结果。 接入配置、执行范围与修复说明见[图片资源治理与安全优化](features/image-assets.md)。

### 配置无效图片资源门禁

通过源码引用与动态声明识别未使用图片，并检查新增债务。 接入配置、执行范围与修复说明见[无效图片资源](features/unused-image-assets.md)。

### 配置变异测试与受保护构建

运行 Stryker 并按变异得分决定是否执行受保护构建别名。 接入配置、执行范围与修复说明见[变异测试与受保护构建](features/mutation-test.md)。

### 配置指定代码允许位置

限制指定精确代码文本出现的位置，避免实现散落到未允许的文件。 接入配置、执行范围与修复说明见[代码位置](features/code-placement.md)。

### 配置合同驱动交付

关联需求、功能、任务、真实反馈、人工确认和技术证据。 接入配置、执行范围与修复说明见[合同驱动交付](features/delivery-contract.md)。

### 配置构建产物预算

在实际构建后复核 PC 或小程序产物体积，并控制历史超限债务。 接入配置、执行范围与修复说明见[构建产物预算](features/build-artifact-budget.md)。

## 接入测试与构建

### 单元测试、组件交互与覆盖率

先准备 Vitest、真实 `test:unit` 脚本与源码对应测试，再启用：

```bash
npx repo-guard enable unitTest
npx repo-guard unit-test
```

组件交互要求 Vue Test Utils、Vue 编译与 DOM 环境；覆盖率要求与 Vitest 匹配的 provider。准备后可分别启用 `componentInteraction` 和 `coverage`。可复制配置、真实交互断言及覆盖率阈值见[单元测试接入](features/unit-test.md)。

### 类型、架构与项目构建

类型与构建调用项目脚本，架构检查使用项目自己的 dependency-cruiser。项目需先具备真实 `typecheck`、`build` 脚本和源码目录；例如 Vue 的类型脚本通常调用项目自己的 `vue-tsc`，普通 TS 项目使用适合自身配置的 `tsc`。

```json
{
  "checks": {
    "architecture": {
      "enabled": true,
      "sourcePaths": [
        "src"
      ],
      "timeoutMs": 120000
    },
    "typeCheck": {
      "enabled": true,
      "script": "typecheck",
      "timeoutMs": 180000
    },
    "build": {
      "enabled": true,
      "script": "build",
      "timeoutMs": 300000
    }
  }
}
```

```bash
npx repo-guard enable typeCheck architecture build
npx repo-guard doctor
npx repo-guard typecheck
npx repo-guard architecture
npx repo-guard build
```

架构默认检查循环依赖、无法解析的导入，以及生产代码导入测试代码。配置 `checks.architecture.rules` 时是替换规则数组，应显式保留仍需执行的基础规则；通过 `sourcePaths`、`tsConfig`、`exclude` 对齐项目结构。

这三项不进入 pre-commit；pre-push、CI `full` 与 `release-ready` 按配置执行类型、架构与构建检查。失败时先修正对应类型错误、依赖方向或构建原因，再复跑。

### axe 可访问性测试

准备独立 `test:a11y` 脚本、axe 集成、真实测试文件和零违规断言，再运行：

```bash
npx repo-guard enable accessibilityTest
npx repo-guard doctor
npx repo-guard accessibility-test
```

支持的集成、配置示例和执行范围见 [axe 可访问性测试](features/accessibility-test.md)。

### Lighthouse 页面检查

项目需声明 Vue，准备 `@lhci/cli`、Chrome、预览页面与 Lighthouse 配置：

```bash
npx repo-guard enable lighthouse
npx repo-guard doctor
npx repo-guard lighthouse
```

默认关闭，可显式执行或接入 pre-push、发布就绪检查；不进入 pre-commit 和 CI `full`。配置与报告位置见 [Lighthouse](features/lighthouse.md)。

## 完整交付流程

需要将需求、实现、测试与反馈统一记录时，按[合同驱动交付配置](features/delivery-contract.md)准备功能登记、合同和资料，再启用 `deliveryContract`。初始化不会替团队决定需求或生成已经验收的证据。

| 阶段 | 实际操作 | 完成依据 |
|---|---|---|
| 需求 | 人工确认功能归属、目标、范围与验收条件，登记需求快照和合同 | 可追溯的需求事实与已确认约定 |
| 开发 | 拆分任务，开发者或 AI 实现，提交时执行已启用规则 | 代码变更、任务记录与检查结果 |
| 测试 | 执行项目测试，验证真实效果；登记失败和正式发现 | 测试结果、回归记录与人工确认 |
| 发布 | 按合同流程准备技术证据，人工验收后完成最终复核 | 本轮有效证据与发布就绪结果 |
| 反馈 | 将测试或使用中的问题关联任务，修复并复测 | 正式发现及其闭环记录 |
| 反向升级 | 人工确认是否完善需求、设计、测试、任务模板或规则 | 升级决定及下一轮改进任务 |

启用后同步的五个 Skills 分别支持功能登记、合同规划、合同执行、反馈闭环和交付证据。技术结果变化会使旧证据与验收失效；已关闭交付出现新问题时使用新的修复合同，保留原历史。

证据复核需要先形成技术结果，再人工验收、更新证据元数据，最后重新检查。接入、四方时序、两轮复核、反馈升级与字段格式统一见[交付合同手册](features/delivery-contract.md)。`release-ready` 提供检查结论，npm 发布或应用部署由团队另行执行。

## 接入 CI 与交付流水线

### GitLab CI

```bash
npx repo-guard install-ci --provider gitlab --profile policy --dry-run
npx repo-guard install-ci --provider gitlab --profile policy
npx repo-guard doctor --ci
```

| 配置档 | 当前固定计划 |
|---|---|
| `policy` | 例外、AGENTS、提交信息、异步资源、路径命名、UI Token、安全与基础可访问性、依赖、文件归位、图片、代码位置、行数、交付合同、单元测试资料策略、保护文件 |
| `full` | `policy` 的步骤，加只读 Stylelint/ESLint/Prettier、类型、Knip、无效图片、完整单元测试及已启用覆盖率、axe、架构、构建 |
| `release-ready` | `full` 的通用工程检查，加适用于前端且已启用的 Lighthouse，以及最后执行的交付证据复核 |

v2 的 `release-ready` 按各应用已启用能力执行，不要求消费项目具备 npm 包发布专用的 `check`、`test` 或打包脚本。单元测试“资料策略”只检查测试对应关系和绕过等，不运行完整测试脚本。三种配置档均按项目身份筛选适用检查，发布就绪结论不会自动部署应用。

CI 配置、可信 Git 范围、报告路径和逐 Gate 策略见 [GitLab CI](features/gitlab-ci.md)。源码修复步骤不在 CI 执行；测试、构建和报告仍会生成各自的产物。

### 托管应用交付流水线

在独立的 `repo-guard.ops.json` 中明确声明各应用的构建脚本、产物和环境。先执行 `repo-guard ops plan` 预览，再用 `repo-guard ops install` 生成流水线；生产部署默认人工触发，每个应用绑定自己的质量结果和构建产物。完整配置见[运维发布](features/operations.md)。

### 外部门禁

通过 `ci.externalGates` 声明项目 npm script、允许的执行环境和 `repo-guard-json-v1` 报告。可本地手动执行；自动加入 CI `full` / `release-ready` 时要求可信的 GitLab 受保护分支。不同入口的条件和报告示例见[外部门禁](features/external-gates.md)。

### Axios 手动接口性能外部门禁

复用业务 Axios 客户端，验证真实调用链、延迟与错误率。仅通过显式手动入口执行，需要精确目标确认。配置、场景和报告见 [Axios 接口性能](features/api-performance.md)。

### k6 手动接口压测外部门禁

使用消费项目的本机 k6，在受控负载下检查延迟、错误率与吞吐相关指标。只支持显式手动执行，不进入 Hook、CI 或发布流程。配置、确认值与场景边界见 [k6 接口压测](features/k6-load-test.md)。

## 诊断与修复

| 现象 | 先检查什么 | 修复后如何复核 |
|---|---|---|
| 提示找不到命令 | 本项目是否安装包，是否在项目根目录使用 `npx` | `npx repo-guard --help` |
| Doctor 报依赖或脚本缺失 | 工具是否属于当前项目，脚本与配置文件是否存在 | 补齐后重新运行 Doctor |
| 修改配置后 CI 提示 AGENTS 不一致 | 是否同步托管规范并将改动提交 | `doctor --fix` 后检查差异，再暂存配置与受管文件 |
| 启用后仍显示跳过 | 功能开关、父级开关、入口、文件范围及 CI 模式 | 确认跳过原因，再运行适用入口 |
| 提交自动修复后仍失败 | 最终规则是否仍违规，修复内容是否已重新暂存 | 修复指定位置并重新提交 |
| 推送检查与预期范围不同 | Git 比较范围与单项全项目检查的区别 | 确认推送目标、配置和检查报告 |
| CI 返回范围不可信 | 基准/目标提交是否存在、可信且有正确关系，历史是否完整 | 补全历史或修正基准后重跑 |
| 测试通过但交付证据不通过 | 报告、提交、合同版本和人工确认是否属于同一轮 | 按证据流程更新并重新验收、复核 |
| Hook 重复运行被阻止 | 同仓库是否已有提交或 Hook 在执行 | 等当前实例结束后重试，不删除活动锁 |

### 如何理解退出码

| 入口 | 含义 |
|---|---|
| 普通结构化 Gate / CI | `0` 通过或明确跳过；`1` 配置或执行错误；`2` 策略违规；`3` 不可信的 Git/CI 范围 |
| `pre-commit` | 正常通过为 `0`；规则失败会归为 `1`，不能只凭退出码区分违规和配置错误 |
| `check` | `0` 表示没有受保护工作区变更；`2` 表示发现此类变更，并不代表全部规则已检查 |
| 第三方工具 | 原始退出码可能不同，先看 repo-guard 的中文结论与结构化状态 |

repo-guard 自有诊断提供问题、位置、证据、预期和修复指引；第三方原始输出会经过脱敏处理，并与主结论区分。pre-push 会实时显示运行进度。

## 配置与结果

### 手动运行专项门禁

```bash
npx repo-guard exceptions
npx repo-guard dependencies
npx repo-guard dynamic-code
npx repo-guard async-resource-cleanup
npx repo-guard path-naming
npx repo-guard ui-tokens
npx repo-guard unsafe-html
npx repo-guard target-blank
npx repo-guard form-labels
npx repo-guard image-alt
npx repo-guard image-assets
npx repo-guard unused-image-assets
npx repo-guard file-placement
npx repo-guard code-placement
npx repo-guard delivery-contract
npx repo-guard delivery-evidence
npx repo-guard style-complexity
npx repo-guard style-governance
npx repo-guard typecheck
npx repo-guard unit-test
npx repo-guard mutation-test
npx repo-guard accessibility-test
npx repo-guard architecture
npx repo-guard dead-code
npx repo-guard build
npx repo-guard lighthouse
npx repo-guard lighthouse --skip-build
```

命令存在不代表会忽略开关。执行前查看对应功能的手动语义；没有专用命令的检查通过提交或 CI 复核。`npx repo-guard --help` 可查看全部当前命令与参数。

### Schema 与报告

完整主配置以 [config.schema.json](../config.schema.json) 为准。单应用包含 `version`、`project`、`checks`、`repository`、`reporting`、`ci`；多应用根用 `projects` 清单替代 `project` 和 `checks`，子应用只定义自己的身份与检查。外部门禁位于 `ci.externalGates`；部署策略使用独立的 [operations.schema.json](../operations.schema.json)。

| Schema | 对应用途 |
|---|---|
| [GateResult](../gate-result.schema.json) | 单项检查的结构化状态、问题与产物 |
| [外部门禁报告](../external-report.schema.json) | `repo-guard-json-v1` 协议 |
| [UI Token Manifest](../ui-token-manifest.schema.json) | Token 来源、类别与适配器别名 |
| [Axios 性能配置](../api-performance-config.schema.json) | 目标、客户端、场景与阈值 |
| [k6 压测配置](../k6-load-config.schema.json) | 目标、负载、场景与阈值 |

CI 默认将整体报告写到 `reports/repo-guard.json`，可通过 `ci.reportPath` 或 `--report-json` 指定合规路径。整体 CI 报告包含步骤与单项结果，不能把它直接当成一个 GateResult。截图、HTML 或单次“通过”提示不能代替当前交付合同要求的完整证据。

## 相关文档

- [项目介绍](../README.md)
- [项目结构与能力总览](project-structure-and-feature-inventory.md)
- [功能说明索引](features/README.md)
- [交付合同手册](features/delivery-contract.md)
- [版本记录](../CHANGELOG.md)
