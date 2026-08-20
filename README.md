# @cxyi7/repo-guard

`@cxyi7/repo-guard` 是面向 Vue/JavaScript/TypeScript 仓库的质量与安全门禁平台。它复用消费项目已有的 ESLint、Prettier、Stylelint、Vitest、dependency-cruiser、Lighthouse CI 等工具，将提交前检查、推送前检查、GitLab CI 和发布准备统一为可审计的固定流程。

- 当前版本：`1.10.0`
- Node.js：`>=22.23.2`
- 配置契约：`version: 1`
- 用户可见状态、警告、错误和修复说明：简体中文

详细结构和完整能力说明见 [项目结构与功能清单](docs/project-structure-and-feature-inventory.md)。

## 快速开始

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@1.10.0
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
- 可选的暂存文件头同步：按 Git 记录维护作者、创建时间、更新人和更新时间，并保留人工填写的 Description。
- 可选的暂存函数文档同步：根据 AST 签名维护 `@param` 和 `@returns`，并对缺失的 `@throws` 给出非阻断提示。
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
- 可选托管 GitLab 应用交付外壳，项目通过固定 `ci:*` scripts 保留自身构建与部署实现。
- 使用可信 base/head 计算精确变更范围；范围不可信时不会静默跳过。
- 受控 `project.*` 外部门禁，只允许精确 npm script 和版本化 JSON 报告。
- 报告、artifact、路径、符号链接、大小和敏感数据安全检查。
- 统一 `GateResult`、console renderer、JSON renderer 和退出码。
- 发布就绪检查覆盖项目 `check`、`test`、构建、可选 Lighthouse、`package.json`/lockfile/CHANGELOG/README 版本一致性、Schema、exports、bin 和 npm pack 文件。
- 发布准备只验证，不执行 `npm publish`、deploy 或生产写操作。

## 固定执行顺序

### pre-commit

顺序由锁定 Execution Plan 固定，消费项目不能重排：

启用 `preCommit.fileHeader` 或 `preCommit.functionDocs` 后，对应内容会先在 `lint-staged` 的暂存快照中完成同步，再进入下列受保护 Execution Plan；它们不新增、不删除也不重排计划步骤。

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
repo-guard enable fileHeader functionDocs filePlacement maxFileLines codePlacement
repo-guard enable notification ci

repo-guard disable lighthouse
repo-guard disable notification
```

支持的功能名：

```text
stylelint
eslint
prettier
fileHeader
functionDocs
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

### 配置暂存文件头

文件头默认关闭，可通过 `repo-guard enable fileHeader` 启用，再在 `repo-guard.config.json` 中调整作用范围：

```json
{
  "preCommit": {
    "fileHeader": {
      "enabled": true,
      "include": ["src/**", "scripts/**"],
      "exclude": ["src/generated/**", "src/vendor/**"],
      "extensions": [".vue", ".html", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".less", ".scss", ".sass"]
    }
  }
}
```

- `include` 和 `exclude` 都使用仓库相对 glob；`exclude` 优先，适合排除生成代码、第三方代码和无需托管的目录。
- `extensions` 是白名单，不能填写当前支持范围以外的扩展名。
- `.vue`、`.html` 使用 `<!-- ... -->`；脚本和样式文件使用 `/* ... */`。
- 脚本 shebang 和样式 `@charset` 等必须位于首行的声明会保留在文件头之前。
- `@Author`、`@Date` 取文件第一次新增到 Git 历史时的作者和提交时间；新文件在首次提交前使用当前 Git 提交身份和时间。
- `@LastEditor`、`@LastEditTime` 每次从当前 Git 提交身份和时间重建；手动修改这四个字段不会保留。
- `@Description` 由开发者维护。已有受管文件头会保留该字段；新文件先生成空值，不根据文件名主观猜测描述。
- 即使用户删除 `@Description` 或乱写 Git 字段，只要顶部注释仍包含 LastEditor/LastEditTime，或同时包含 Author/Date，也会识别为受管文件头并整体重建；普通许可证和只有单个 Author 的 JSDoc 不会被覆盖。
- 历史字段输出统一使用 `@LastEditor`，旧的 `@LastEditors` 会在下一次同步时归一化。
- 已跟踪文件若因浅克隆而无法追溯首次新增记录，会停止同步并提示先补全 Git 历史，避免写入错误作者和时间。
- 文件头同步只处理本次暂存文件，并继续由 `lint-staged` 隔离和恢复未暂存改动。

### 配置暂存函数文档

函数文档同步默认关闭，可通过 `repo-guard enable functionDocs` 启用：

```json
{
  "preCommit": {
    "functionDocs": {
      "enabled": true,
      "include": ["src/**"],
      "exclude": ["**/*.d.ts", "**/*.min.js", "**/generated/**", "**/*.spec.*", "**/*.test.*"],
      "extensions": [".vue", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]
    }
  }
}
```

- 仅处理本次暂存且同时命中 `include`、未命中 `exclude`、扩展名已启用的文件；默认排除声明文件、压缩产物、生成目录和测试文件。
- 使用 Babel AST 识别具名函数、类/对象方法、单变量绑定的箭头或函数实现，以及默认导出实现；匿名回调不会被自动补文档。
- 参数新增、删除或调序时同步 `@param`；有返回值时补齐 `@returns`，无返回值时删除陈旧返回标签。新标签只写参数名或标签名，不猜测“用户 ID”等业务说明。
- 保留人工维护的 `@Description`、标签说明和未托管标签；兼容 `@arg`/`@argument`、`@return` 和 `@exception` 别名。TypeScript 函数会移除 `@param`/`@returns` 中与签名重复的类型，但不改写说明。
- 函数存在直接逃逸的 `throw` 或返回的 `Promise.reject` 且缺少 `@throws`/`@exception` 时，只输出可定位的中文警告，不自动猜测异常说明，不阻断提交。
- 匿名解构参数不自动改写整个函数文档，而是给出提示；Generator 只同步参数，保留已有返回标签并提示人工维护 `@yields`。
- Vue 文件只解析顶层内联 `<script>` 和 `<script setup>`，跳过注释、template、style 和带 `src` 的外部 script。同步结果幂等，并继续由 `lint-staged` 保护部分暂存内容。

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

CI 门禁始终只读，不执行 fix、不安装 Hook、不读取本地企业微信凭据。只有显式启用的托管流水线通知会读取 GitLab CI 受保护变量并发送结果。

#### CI 门禁策略

`ci.gatePolicy` 只控制 `repo-guard ci` 使用的 `ci-policy`、`ci-full` 和 `release-ready` 环境，不会被 pre-commit 或 pre-push 读取。同一个 Gate 可以在提交时强制执行、在 CI 中关闭，也可以在提交时关闭、仅在 CI 中报告或强制执行。

```json
{
  "ci": {
    "enabled": true,
    "profile": "policy",
    "reportPath": "reports/repo-guard.json",
    "protectedFiles": { "action": "report" },
    "gatePolicy": {
      "defaultMode": "inherit",
      "gates": {
        "security.dynamic-code": {
          "mode": "enforce",
          "scope": "changed-files"
        },
        "accessibility.vue-image-alt": {
          "mode": "report"
        },
        "repository.maximum-file-lines": {
          "mode": "off"
        }
      }
    }
  }
}
```

| 模式 | CI 行为 |
|---|---|
| `inherit` | 保持 1.7.0 之前的兼容行为：沿用 Gate 原有 `enabled` 配置，失败会阻断 CI |
| `off` | 在 setup 和执行之前跳过该 CI Gate，不阻断 CI |
| `report` | 仅在隔离的 CI 上下文中启用并执行，失败写入步骤报告但不阻断 CI |
| `enforce` | 仅在隔离的 CI 上下文中启用并执行，失败阻断 CI |

`scope` 默认为 `all-files`。只有 Registry 明确声明支持文件范围的 Gate 才能使用 `changed-files`；不支持的组合会作为配置错误失败，而不是静默缩小检查范围。

CI Gate 由 Registry 的 CI environment 元数据自动发现，配置 Schema 使用稳定 Gate id 的通用键约束，不维护容易遗漏的手写 Gate 枚举。仓库测试还要求每个官方 CI Gate 至少属于一个受审固定执行计划；因此未来新增 CI Gate 时，如果忘记进入执行计划，发布检查会直接失败，而进入计划后会自动获得 `inherit/off/report/enforce` 策略能力。

### 托管应用交付流水线

`1.8.0` 在原有 `install-ci` 受管 include 上增加可选的应用交付标准，不引入另一套 CI 安装方式。npm 包负责生成和校验 GitLab Job、分支规则、阶段、Node 环境、npm 缓存、依赖安装、门禁先行以及手动发布语义；消费项目继续拥有实际构建、上传和部署实现。

消费项目只需实现固定的 npm scripts：

| script | 何时需要 | 项目职责 |
|---|---|---|
| `ci:verify` | 始终 | 对非交付分支执行项目自己的构建或验证 |
| `ci:deploy:test` | 始终 | 发布测试环境；可读取 `CI_COMMIT_BRANCH` 区分 `dev`、`test` 或 `future/*` |
| `ci:deploy:production` | 配置了生产分支时 | 执行人工确认后的生产发布 |
| `ci:deploy:quick` | `quickDeploy: true` | 执行任意分支的人工快速发布 |

示例配置：

```json
{
  "ci": {
    "enabled": true,
    "profile": "policy",
    "pipeline": {
      "enabled": true,
      "verifyStage": "build",
      "deployStage": "deploy",
      "verifyImage": "node:22.23.2",
      "deployImage": "node:22.23.2",
      "testBranches": ["dev", "future/*"],
      "productionBranches": ["publish"],
      "runnerTags": ["docker"],
      "legacyPeerDeps": true,
      "quickDeploy": true,
      "notifications": true
    }
  }
}
```

配置并补齐 scripts 后运行：

```bash
repo-guard install-ci --provider gitlab --profile policy --dry-run
repo-guard install-ci --provider gitlab --profile policy
repo-guard doctor --ci
```

当 `notifications: true` 时，生成器会在 GitLab 保留的 `.post` 末尾阶段增加两个互斥的通知 Job：`repo_guard_notify_success` 使用 `when: on_success`，`repo_guard_notify_failure` 使用 `when: on_failure`。GitLab 根据此前所有阶段的最终结果只执行其中一个，因此整条流水线只发送一条成功或失败通知；任何会阻断流水线的 Job 失败都会进入失败通知。受管 Job 在运行中被手动取消，或前置门禁/验证 Job 被 GitLab 自动取消时，`after_script` 会发送“已取消（canceled）”通知。业务项目不再需要提供 `ci:notify` script。

通知内容包含项目、流水线编号、分支、提交、提交人和流水线链接。提交标题最多显示前 10 个字符，更长时追加省略号。两个末尾通知 Job 都设置 `allow_failure: true`，因此企业微信暂时不可用不会篡改原流水线结果；GitLab 原本标记为 `allow_failure: true` 的非阻断 Job 也继续按成功处理。

在 GitLab 的 CI/CD Variables 中配置：

| 变量 | 要求 | 用途 |
|---|---|---|
| `REPO_GUARD_WECOM_WEBHOOK` | 必需，建议设为 Masked 与 Protected | 企业微信群机器人 Webhook；只接受官方 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...` 地址 |
| `REPO_GUARD_MENTION_MOBILES` | 可选，建议设为 Masked 与 Protected | 逗号分隔的 11 位手机号；未配置时只发消息、不 @ 成员 |

通知命令只允许在 `GITLAB_CI=true` 且带有受管通知标记的生成 Job 中执行。成功、失败和取消入口分别向包内命令传入受控的 `success`、`failed` 或 `canceled` 状态，不会重新加载可能已经导致流水线失败的项目配置。通知包会在 `$CI_BUILDS_DIR` 下按项目、流水线和 Job 组成的唯一目录中，从 npm 官方 tarball URL 精确安装生成流水线时对应版本的 `@cxyi7/repo-guard`；安装时禁用 lifecycle scripts，执行时使用隔离目录中的绝对 CLI 路径，不会解析消费项目的本地可执行文件。因此配置错误或前序 Job 的项目 `npm ci` 失败不会连带阻止末尾通知。

GitLab 只会在运行中的 Job 被取消时执行 `after_script`。因此，取消通知覆盖手动或自动取消时正在运行的 repo-guard 受管 Job；如果 Job 尚未开始就在 pending 状态被取消，或使用 GitLab 强制取消跳过 `after_script`，则 Runner 没有可执行的通知入口。

启用后，`repo_guard` 固定在 GitLab 的 `.pre` stage 覆盖分支和合并请求流水线，确保受管验证与发布 Job 在门禁通过后才执行；测试发布自动执行，生产与快速发布保持手动，其中快速发布允许失败。验证作业会跳过已由测试或生产发布脚本负责构建的分支，避免重复构建。`verifyImage` 和 `deployImage` 分别控制验证与发布容器，二者都必须包含 Node.js 与 npm；Web 容器发布可以把 `deployImage` 指向项目内部维护的 Node.js + Docker CLI 镜像。`install-ci` 与 `doctor --ci` 会拒绝缺少固定 scripts、阶段未声明、保留 Job 名冲突、模板被改写或模板版本不匹配等状态。

三个现有项目建议采用同一个外壳：`owner` 与 `employee` 的 `ci:deploy:*` 继续调用各自的 `mp-ci-deploy.js`；`front` 的 `ci:deploy:test` 根据分支调用其 Web 构建、镜像和蓝绿部署脚本。镜像仓库、端口、微信小程序机器人和密钥仍由项目脚本持有；通知 Webhook 只放在 GitLab 受保护变量中，不进入 repo-guard 配置。

逐项目配置与迁移顺序见 [三个现有项目的 GitLab CI 接入映射](docs/managed-gitlab-ci-adoption.md)。

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

外部门禁不进入 pre-commit、pre-push 或 CI policy，也不能插入或重排官方计划。它们仍然只在可信的 GitLab 受保护分支环境中运行；`ci.gatePolicy` 不会绕过该安全限制。

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
