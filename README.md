# @cxyi7/repo-guard

`@cxyi7/repo-guard` 是面向 Vue/JavaScript/TypeScript 仓库的质量与安全门禁平台。它复用消费项目已有的 ESLint、Prettier、Stylelint、Vitest、dependency-cruiser、Lighthouse CI 等工具，将提交前检查、推送前检查、GitLab CI 和发布准备统一为可审计的固定流程。

- 当前版本：`1.6.3`
- Node.js：`>=22.23.2`
- 配置契约：`version: 1`
- 用户可见状态、警告、错误和修复说明：简体中文

详细结构和完整能力说明见 [项目结构与功能清单](docs/project-structure-and-feature-inventory.md)。

## 快速开始

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@1.6.3
npx repo-guard init
npx repo-guard doctor
```

`init` 会：

- 创建或补齐 `repo-guard.config.json`；
- 安装五个托管 Git Hook；
- 设置当前仓库的 `core.hooksPath=.githooks`；
- 维护 `.gitattributes`、`.gitignore` 和本地 `.env.config`；
- 根据消费项目已安装的工具和脚本决定重型门禁是否启用；
- 增量补充 `guard:*` npm scripts 和受管理的 `AGENTS.md` 策略块。

已有非托管 Hook 或其他 `core.hooksPath` 不会被覆盖。

## 已完成功能

### 提交前质量

- Stylelint 暂存文件检查、自动修复和最终只读复检。
- ESLint 暂存文件检查、自动修复和最终只读复检。
- Prettier 暂存文件格式化或只读检查。
- Stylelint 选择器复杂度、嵌套深度、specificity、ID、`!important` 和样式作用域治理。
- 同一 Vue 文件的 style 块语言一致性检查。
- `lint-staged` 隔离部分暂存内容，失败时恢复执行前状态。
- Hook 中不会运行项目级 fix。

### 安全与 Vue 静态规则

- AST 检查 `eval` 和 `Function` 构造器。
- Vue `v-html` 安全门禁。
- `target="_blank"` 的 `noopener` 和 `noreferrer` 门禁。
- Vue 原生表单控件可访问名称门禁。
- Vue 原生图片 alt 门禁。
- 精确、限时、可审计的结构化例外。

### 仓库治理

- 文件归位规则：按文件类型限制允许目录，并提供建议目标目录。
- 单文件行数规则：支持严格模式、存量不恶化和接近上限警告。
- 依赖治理：精确版本、允许协议、禁用包、依赖分组和 lockfile 同步。
- 代码位置门禁：指定代码只能出现在一个或多个允许文件。
- 保护文件三级策略：
  - `audit`：记录，不通知、不阻断；
  - `notify`：记录并按配置发送企业微信通知；
  - `block`：修改、删除、重命名或移动匹配文件都会硬阻断。
- `.env.config` 暂存泄漏防护。
- 提交信息文件清单和通知去重指纹。

### 测试、架构与构建

- TypeScript 项目脚本门禁。
- Vitest 单元测试映射和执行。
- 空测试、`.skip`、`.skipIf`、`.todo`、`.only` 绕过检查。
- Vue 组件 mount、真实交互和交互后断言检查。
- 全局行、语句、函数、分支覆盖率和 Git 变更行覆盖率。
- axe 组件与 E2E 可访问性测试门禁。
- dependency-cruiser 依赖架构门禁。
- 独立项目构建门禁。
- Lighthouse CI collect/assert 门禁，不隐式上传报告。

### CI、外部门禁与发布准备

- GitLab CI `policy`、`full`、`release-ready` 三种固定配置档。
- 使用可信 base/head 计算精确变更范围；范围不可信时不会静默跳过。
- 受控 `project.*` 外部门禁，只允许精确 npm script 和版本化 JSON 报告。
- 报告、artifact、路径、符号链接、大小和敏感数据安全检查。
- 统一 `GateResult`、console renderer、JSON renderer 和退出码。
- 发布就绪检查覆盖项目 `check`、`test`、构建、可选 Lighthouse、`package.json`/lockfile/CHANGELOG/README 版本一致性、Schema、exports、bin 和 npm pack 文件。
- 发布准备只验证，不执行 `npm publish`、deploy 或生产写操作。

## 固定执行顺序

### pre-commit

顺序由锁定 Execution Plan 固定，消费项目不能重排：

```text
Stylelint fix
  → ESLint fix
  → Prettier
  → Stylelint read-only verify
  → ESLint read-only verify
  → dynamic-code
  → Vue v-html
  → Vue target=_blank
  → Vue form label
  → Vue image alt
  → maximum-file-lines
  → file-placement
  → dependency-policy（最终 Git 索引）
  → code-placement（最终 Git 索引）
  → protected-files（最后执行）
```

TypeScript、单元测试、axe、项目架构、构建和 Lighthouse 不进入 pre-commit。

### pre-push

```text
typecheck
  → unit-test
  → accessibility-test
  → architecture
  → build
  → lighthouse
```

各步骤根据配置启用或跳过，并使用本次推送的精确变更范围。

`pre-push` 会在重型门禁开始时立即输出中文阶段提示，并实时转发 TypeScript、单元测试、axe 和构建脚本的输出；架构检查会显示即时进度但保留 dependency-cruiser JSON 供机器解析。实时输出经过路径与敏感信息脱敏，失败后仍返回结构化问题和退出码，不会让 `git push` 在长时间任务中无提示等待。

## 常用使用方式

### 初始化、迁移和诊断

```bash
repo-guard init
repo-guard install-hooks
repo-guard migrate
repo-guard doctor
repo-guard doctor --fix
repo-guard doctor --ci
```

`doctor --fix` 只修复 repo-guard 管理的配置、Hook、CI、忽略项、项目脚本和 AGENTS 策略块，不安装项目工具、不填写密钥、不修改业务代码。

托管文本的最新状态比较会统一 LF、CRLF 和 CR 后再判断，因此 Windows 的 `core.autocrlf` 不会让内容正确的 `AGENTS.md`、`.gitignore`、`.gitattributes` 或 GitLab CI 被误报为缺失或过期；除换行符外，其他空白和正文仍严格匹配。

### 启用或关闭能力

```bash
repo-guard enable eslint prettier
repo-guard enable stylelint styleComplexity styleGovernance
repo-guard enable dependencies architecture
repo-guard enable typeCheck unitTest coverage
repo-guard enable componentInteraction accessibilityTest
repo-guard enable build lighthouse
repo-guard enable filePlacement maxFileLines codePlacement
repo-guard enable notification ci

repo-guard disable lighthouse
repo-guard disable notification
```

支持的功能名：

```text
stylelint
eslint
prettier
styleComplexity
styleGovernance
maxFileLines
filePlacement
codePlacement
dependencies
architecture
build
lighthouse
typeCheck
unitTest
accessibilityTest
componentInteraction
coverage
notification
ci
```

动态代码、Vue `v-html`、新窗口链接、表单 label 和图片 alt 是原生硬门禁，没有关闭开关。

### 手动运行专项门禁

```bash
repo-guard exceptions
repo-guard dependencies
repo-guard dynamic-code
repo-guard unsafe-html
repo-guard target-blank
repo-guard form-labels
repo-guard image-alt
repo-guard file-placement
repo-guard code-placement
repo-guard style-complexity
repo-guard style-governance
repo-guard typecheck
repo-guard unit-test
repo-guard accessibility-test
repo-guard architecture
repo-guard build
repo-guard lighthouse
repo-guard lighthouse --skip-build
```

保护文件检查：

```bash
repo-guard check
repo-guard gate
repo-guard dry-run
repo-guard gate --force-notify
```

### 配置指定代码允许位置

`codePlacement` 使用精确文本匹配。pre-commit 检查格式化完成后的最终 Git 索引，未暂存内容不会误阻断本次提交。

```json
{
  "codePlacement": {
    "enabled": true,
    "rules": [
      {
        "name": "支付签名实现",
        "content": "const signature = createPaymentSignature(payload);",
        "allowedFiles": [
          "src/payment/signature.ts",
          "src/admin/payment-signature.ts"
        ],
        "scanPatterns": ["src/**/*.{js,jsx,ts,tsx,vue}"]
      }
    ]
  }
}
```

匹配时只统一 CRLF/CR 为 LF，不忽略其他空白，也不把语义相近但文本不同的代码视为相同。

### 配置不可变文件

使用精确仓库相对路径和 `level: "block"`：

```json
{
  "rules": [
    {
      "pattern": "src/security/permission-map.ts",
      "category": "不可变安全文件",
      "level": "block"
    }
  ],
  "exclusions": []
}
```

修改、删除、重命名或移动该文件都会阻断提交和 CI。规则按数组顺序采用第一条匹配，精确 `block` 规则应放在可能覆盖它的宽泛规则之前；`exclusions` 优先于规则。

### 企业微信通知

`init` 会创建被 Git 忽略的 `.env.config`：

```dotenv
REPO_GUARD_WECOM_WEBHOOK=
REPO_GUARD_MENTION_MOBILES=
```

系统环境变量优先于文件值。CI 不读取本地通知凭据，也不发送保护文件通知。

### GitLab CI

安装或检查 CI：

```bash
repo-guard install-ci --provider gitlab --profile policy --dry-run
repo-guard install-ci --provider gitlab --profile policy
repo-guard doctor --ci
```

显式执行：

```bash
repo-guard ci --profile policy --base <sha> --head <sha>
repo-guard ci --profile full --base <sha> --head <sha>
repo-guard ci --profile release-ready --base <sha> --head <sha>
```

| 配置档 | 内容 |
|---|---|
| `policy` | 原生安全、Vue 可访问性、结构化例外、依赖、文件/代码位置、行数、测试策略和保护文件 |
| `full` | `policy` 加只读 Stylelint、ESLint、Prettier、类型检查、完整单元测试/覆盖率、axe、架构和构建 |
| `release-ready` | `policy` 加项目 `check`、项目 `test`、构建、可选 Lighthouse 和发布包一致性检查 |

CI 始终只读，不执行 fix、不安装 Hook、不读取本地企业微信凭据。

### 外部门禁

消费项目可以通过严格的 npm script 和 `repo-guard-json-v1` 报告接入项目自有检查：

```json
{
  "externalGates": [
    {
      "id": "project.api-contract",
      "enabled": true,
      "environments": ["manual", "ci-full", "release-ready"],
      "script": "test:api-contract",
      "timeoutMs": 120000,
      "report": {
        "format": "repo-guard-json-v1",
        "path": "reports/api-contract.json"
      }
    }
  ]
}
```

```bash
repo-guard external project.api-contract
```

外部门禁不进入 pre-commit、pre-push 或 CI policy，也不能插入或重排官方计划。

## 仓库目录

```text
repo/
├─ bin/                              CLI 启动器
├─ docs/                             长期维护的项目结构与功能清单
├─ scripts/                          仓库自身维护检查
├─ src/
│  ├─ config/                        配置默认值、加载和验证
│  ├─ core/
│  │  ├─ capability/                 Gate、Registry、Execution Plan、GateContext
│  │  ├─ error/                      领域错误
│  │  ├─ execution/                  快照、暂存文件和输出安全
│  │  ├─ policy/                     受管理策略基础能力
│  │  ├─ project/                    项目事实
│  │  ├─ report/                     console/JSON renderer
│  │  └─ result/                     GateResult、finding 和退出码
│  ├─ gates/
│  │  ├─ accessibility/              Vue 可访问性
│  │  ├─ quality/                    lint、类型、架构、构建和 Lighthouse
│  │  ├─ release/                    发布就绪
│  │  ├─ repository/                 依赖、文件、代码位置和保护文件
│  │  ├─ security/                   动态代码和 Vue 安全
│  │  └─ testing/                    单测、覆盖率、axe 和外部门禁
│  ├─ git/                           Git 变更、索引和仓库状态
│  ├─ integrations/                  第三方工具事实与执行适配
│  ├─ orchestration/                 CLI、Hook、CI、doctor 和 setup
│  └─ policies/                      纯策略判定
├─ test/                             单元、端到端和架构边界测试
├─ config.schema.json                项目配置 Schema
├─ external-report.schema.json       外部门禁报告 Schema
├─ gate-result.schema.json           GateResult Schema
├─ CHANGELOG.md                      版本变化
└─ package.json                      npm 包入口和维护脚本
```

完整目录职责见 [项目结构与功能清单](docs/project-structure-and-feature-inventory.md)。

## 依赖方向

项目通过 dependency-cruiser 以错误级规则强制以下边界：

- `core` 不依赖 `gates`、`orchestration` 或 `integrations`。
- `config` 不依赖 Git、policy、gate、integration 或 orchestration。
- `git` 只提供仓库事实，不依赖策略和运行编排。
- `policies` 可以消费稳定事实，但不能调用 gate 或 orchestration。
- `integrations` 只提供外部工具事实，不能拥有策略、Gate 或编排。
- `gates` 负责决策和结构化结果，不能依赖 orchestration 或 renderer。
- `orchestration` 通过 Gate Registry 和 Execution Plan 调度能力，不直接调用 integration。
- 不同 gate 领域不能互相深层导入。
- 循环依赖和无法解析的本地导入直接失败。

对应关系：

```text
config/core/git ──提供稳定契约与事实──┐
policies ────────执行纯策略判定──────┤
integrations ────提供第三方工具事实──┤
                                      ▼
                                    gates
                                      ▼
                               orchestration
                                      ▼
                           CLI / Hook / CI / doctor
```

Registry 是能力目录的单一事实来源，Execution Plan 是生命周期顺序的单一事实来源。

## 配置与结果

完整配置字段以 [config.schema.json](config.schema.json) 为准。主要顶层配置包括：

```text
notification
ci
externalGates
codePlacement
exceptions
dependencyPolicy
architecture
build
lighthouse
typeCheck
accessibilityTest
unitTest
preCommit
rules
exclusions
```

统一结果 Schema：

- [gate-result.schema.json](gate-result.schema.json)
- [external-report.schema.json](external-report.schema.json)

退出码：

| 退出码 | 含义 |
|---:|---|
| `0` | 通过或明确跳过 |
| `1` | 配置错误或执行错误 |
| `2` | 策略违规 |
| `3` | Git/CI 变更范围不可信 |

所有 repo-guard 自有错误都应说明问题位置、原因、预期状态和解决方式。第三方原始输出只进入经过脱敏和长度限制的 diagnostics，或作为经过脱敏的 `pre-push` 实时进度输出。

## 项目维护

```bash
npm run check
npm test
npm run pack:check
```

发布前必须全部通过。行为变化还必须同步测试、README、配置 Schema 和 `CHANGELOG.md`。

[项目结构与功能清单](docs/project-structure-and-feature-inventory.md) 是长期维护文档。新增、修改或删除功能，以及调整仓库目录、模块职责或依赖方向时，必须在同一变更中同步更新该文档。

更多信息：

- [项目结构与功能清单](docs/project-structure-and-feature-inventory.md)
- [版本记录](CHANGELOG.md)
- [发布流程](PUBLISHING.md)
