# 前后端与多应用配置

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

用明确的配置告诉 repo-guard 检查哪个应用、使用哪套工程规则。应用角色不根据依赖、目录名或框架自动判断。

## 单个 Node 后端

安装 repo-guard 后，在 Git 根目录执行：

```bash
npx repo-guard init --project api --role backend --stack node --preset node-typescript
npx repo-guard doctor
```

基础配置包含 ESLint、Prettier、依赖策略、文件归位和行数要求；类型、测试、架构和构建按需启用。纯 JavaScript 服务选择 `node-javascript`，没有构建步骤时保持 build 关闭。

```json
{
  "version": 2,
  "project": {
    "id": "api",
    "role": "backend",
    "stack": "node",
    "preset": "node-typescript"
  },
  "checks": {
    "typeCheck": { "enabled": true, "script": "typecheck" },
    "unitTest": { "enabled": true, "script": "test:unit" },
    "build": { "enabled": true, "script": "build" }
  }
}
```

| 字段 | 说明与约束 |
|---|---|
| `version` | 必须为数字 `2`；其他版本直接拒绝，需按当前结构重新建立配置，不提供转换 |
| `project.id` | 应用唯一标识，小写字母开头，使用小写字母、数字和单个连字符，例如 `api`、`admin-web` |
| `project.role` | `frontend` 或 `backend`，必须与预设匹配 |
| `project.stack` | `node` 或 `java`，必须与明确的受支持预设匹配 |
| `project.preset` | 前端：`vue-javascript`、`vue-typescript`；后端：`node-javascript`、`node-typescript`、`java-maven`。`java-gradle` 尚未支持。四个身份字段都必须填写 |
| `checks` | 应用检查项；省略的字段使用预设和 Schema 默认值，不代表关闭全部检查 |
| `checks.*.enabled` | 布尔值，决定该能力是否自动执行；具体生命周期见各项文档 |
| `checks.*.script` | 项目 `package.json` 中已经存在的脚本名，不是任意 shell 命令。示例启用项必须先准备对应脚本与工具 |

TypeScript 预设配合 ESLint 预设时要求项目安装 `typescript-eslint`；Vue 预设要求 `eslint-plugin-vue`。后端不会因为同一仓库安装了 Vue 插件而被套用 Vue 规则。

Node 单元测试使用 Vitest，覆盖率和变异测试复用已有执行器。不验证接口输入输出、鉴权权限或业务语义，也不要求使用 Express、NestJS 或其他特定框架。

## 单个 Java Maven 后端

准备好宿主 Node.js 和可执行的 repo-guard 后，在 Java Git 仓库根目录运行：

```bash
repo-guard init --project api --role backend --stack java --preset java-maven
repo-guard doctor
```

纯 Java 仓库无需 `package.json`；初始化不会创建 npm 清单或改写 `pom.xml`。Hook 优先使用仓库根目录已安装的 repo-guard，缺少本地安装时使用宿主环境中已有的 `repo-guard` 命令。已有 npm 清单的宿主仓库仍可同步辅助脚本。

Java 的 18 项检查使用独立字段：`javaFormat`、`javaNaming`、`javaLayout`、`javaImports`、`javaSize`、`javaDocs`、`javaLint`、`javaDuplication`、`javaArchitecture`、`javaDependencies`、`javaFiles`、`javaCompile`、`javaBuild`、`javaTest`、`javaCoverage`、`javaPathNaming`、`javaSpotbugs`、`javaMutationTest`。它们默认关闭，需先准备对应工具及项目配置，再显式启用；路径命名与工程文件规则只需要 Git。检查、Hook 和 Doctor 都不安装或升级消费项目工具。具体配置见 [Java 接入说明](../java-quality-integration.md)，已验证范围和限制见 [Java 检查验收记录](../java-check-acceptance.md)。

Java 不继承 ESLint、Prettier、Vitest、TypeScript、npm 构建或 npm 依赖策略；显式启用不适用的检查会报配置错误。Java 依赖使用 `checks.javaDependencies`。语言无关的行数、文件归位、目录命名、图片文件和代码片段归位规则可单独配置，默认关闭；不要将 Java 源码交给 JavaScript 分析器。公共提交、合同、CI 与报告配置继续有效。启用发布 major 版本策略且范围内包含不兼容提交时，当前通用提交门禁仍要求 npm 版本证据；普通提交范围不读取 `package.json`。

Node 与 Java 应用可以列在同一个 `projects` 清单中，各自的检查、工具与 `AGENTS.md` 保持隔离。Java 应用目录无需 npm 清单；同时包含 Node 应用时，仓库 npm 宿主入口仍按现有安装要求准备。`java-gradle` 和 Java 运维部署适配不在当前支持范围。

## 同一仓库的前端与后端

```text
repo/
├─ package.json                     仓库根安装 repo-guard
├─ repo-guard.config.json            应用清单与团队公共规则
├─ repo-guard.ops.json               可选，独立的运维发布配置
├─ .githooks/                        仓库统一 Hook
├─ AGENTS.md                         仓库公共约束
└─ apps/
   ├─ web/
   │  ├─ repo-guard.project.json     前端身份与检查
   │  ├─ package.json               前端工具与脚本
   │  └─ src/
   └─ api/
      ├─ repo-guard.project.json     后端身份与检查
      ├─ package.json               后端工具与脚本
      └─ src/
```

根 `repo-guard.config.json` 示例：

```json
{
  "version": 2,
  "projects": [
    { "id": "web", "root": "apps/web", "config": "repo-guard.project.json" },
    { "id": "api", "root": "apps/api", "config": "repo-guard.project.json" }
  ],
  "repository": {
    "commitMessage": { "enabled": true },
    "rules": [
      { "pattern": "repo-guard.config.json", "category": "团队规则", "level": "notify" },
      { "pattern": ".githooks/**", "category": "公共提交检查", "level": "notify" }
    ]
  },
  "ci": { "enabled": true, "profile": "full" }
}
```

| 字段 | 说明与约束 |
|---|---|
| `projects` | 至少一个明确应用；与单应用的 `project`、`checks` 入口不能混用 |
| `projects[].id` | 必须唯一，且与对应文件内 `project.id` 相同 |
| `projects[].root` | 相对 Git 根目录，目录必须存在。使用 `/`；`./`、重复或尾部 `/` 等价写法会统一，根目录统一为 `.`。不得越出仓库，不支持自动扫描或 glob |
| `projects[].config` | 相对该应用的 root；省略时为 `repo-guard.config.json`。不是相对仓库根 |
| 应用目录 | 不得重叠，不得通过符号链接或目录联接越界；一个文件只归属一个应用 |
| 根 `repository` | 提交信息、仓库基础文件保护、仓库级文件归位，以及可选的仓库内合同包入口；不接受依赖策略、代码片段归位或应用豁免 |
| 根 `repository.filePlacement` | 可选的全仓目录约束，默认 `{ "enabled": false, "rules": [] }`；启用必须至少配置一条规则，没有 `mode`。路径相对 Git 根目录，子应用不能声明或覆盖，详见[仓库级文件归位](repository-file-placement.md) |
| `reporting` | 仓库通知和提交动画；子应用不能覆盖 |
| `ci` | 仓库质量策略，`profile` 为 `policy`、`full`、`release-ready`；部署放在独立 ops 文件 |
| `sharedPaths` | 可选数组，每项为 `{ "path": "shared", "projects": ["api"] }`；共享文件或目录变更时触发列出的应用。路径相对仓库，不使用 glob 或 `..`；应用标识必须已登记 |
| `repository.rules[].level` | `block`、`notify` 或 `audit`，完整含义与匹配顺序见[保护文件](protected-files.md) |

前端子配置：

```json
{
  "version": 2,
  "project": { "id": "web", "role": "frontend", "stack": "node", "preset": "vue-typescript" },
  "checks": { "stylelint": { "enabled": true } },
  "repository": {
    "rules": [{ "pattern": "repo-guard.project.json", "category": "本应用检查规则", "level": "notify" }]
  }
}
```

后端子配置使用本页首个 Node 示例。子应用的编辑器 Schema 使用 `project.schema.json`，允许 `$schema`、`version`、`project`、`checks`、应用 `repository` 和应用 `ci`。根配置使用 `config.schema.json`。手动创建好配置后，在仓库根执行 `repo-guard init` 同步 Hook 和规范。

| 子应用区块 | 可配置内容 | 范围 |
|---|---|---|
| `checks` | 代码规范、文件规则、测试、覆盖率、变异测试、构建等 | 当前应用 |
| `repository` | `rules`、`exclusions`、`exceptions`、`dependencyPolicy`、`codePlacement` | 所有路径相对应用目录，不继承根配置 |
| `ci` | `protectedFiles`、`gatePolicy`、`externalGates` | 本应用检查的模式、保护行为和自定义门禁 |
| 根 `reporting` | `notification`、`commitAnimation` | 同一次提交统一展示，应用不能覆盖 |

根 `ci.enabled/profile` 管理公共执行流程，根 `gatePolicy.defaultMode` 提供共同执行模式；具体 Gate 覆盖与外部门禁在应用中配置。应用不得覆盖根 CI 开关、档案或汇总报告路径。同名外部门禁可分别存在于不同应用，命令和报告在各自目录运行。

子应用只填写 `gatePolicy.gates` 或空的 `gatePolicy` 时，仍继承根 `defaultMode`；只有显式填写子应用 `defaultMode` 才覆盖。比如根设置 `enforce`，api 只将 `quality.build` 设为 `off`，其他适用 Gate 仍按 `enforce` 执行；根设置 `report` 时，其他 Gate 仍只报告。根的具体 `gates` 覆盖不会继承到应用，非法的 `gatePolicy` 对象也不会被默认值掩盖。

```bash
# 应用检查与开关明确选择目标
npx repo-guard enable unitTest coverage --project api
npx repo-guard doctor --project api
npx repo-guard unit-test --project api
npx repo-guard ci --project api --profile full

# 不指定应用的普通 CI 按 Git 变更选择应用
npx repo-guard ci --profile full

# 最终交付复核覆盖完整清单
npx repo-guard ci --profile release-ready
```

共享规则的开关写入根配置，应用开关只修改对应子配置。手动编辑配置后执行 `repo-guard doctor --fix` 同步 AGENTS，再运行检查。

### 仓库归位与应用归位怎样配合

`repository.filePlacement` 适合全团队统一要求，例如文档进入规定目录、脚本进入工具目录。它的功能名是 `repositoryFilePlacement`，Gate ID 是 `repository.global-file-placement`，由根配置维护并在公共仓库上下文执行一次，覆盖应用目录内外的文件。单应用也在 Git 根配置同一字段。

应用的 `checks.filePlacement` 继续约束自己的文件位置，路径相对应用目录。两层规则同时开启时，文件必须同时满足各自适用的要求；根规则不会复制到子配置。关闭应用归位、选择 `--project api`、配置应用例外或 CI Gate 模式，都不能放行根规则的违规。根规则的例外只在它自身的 `rules[].exceptions` 中声明，不复用保护文件的 `repository.exclusions`。

先在根配置准备规则，再使用 `repo-guard enable repositoryFilePlacement` 启用；规则为空时拒绝启用并保留原配置。手动运行 `repo-guard repository-file-placement` 可以检查工作区，字段限制与完整示例见[仓库级文件归位](repository-file-placement.md)。

## 文件范围与执行顺序

- Git Hook 安装在仓库根。一次提交只使用一次暂存隔离，各应用修复按固定阶段依次进行，最后执行仓库受保护文件门禁。
- 磁盘配置和 Git 配置快照都会统一应用目录的等价写法，例如 `./apps/web`、`apps//web` 与 `apps/web` 使用相同的变更归属。只规范运行路径，不改写配置文件；新增图片检查和跨应用重命名不会因目录写法变化而遗漏。上级目录、越界链接及重叠目录仍然拒绝。
- 应用检查使用相对应用根的源码、模式、工具、脚本与报告路径；仓库规则使用相对 Git 根的路径。移动到另一应用的文件分别作为源应用删除和目标应用新增检查。
- 根保护规则只处理应用目录外的公共文件，应用代码和应用配置由自己的保护规则管理。唯一应用占据根目录时，根公共保护仅处理明确的仓库基础文件与托管规范；宽泛根规则不会扩散到应用源码。
- 仓库级文件归位覆盖全仓一次，不使用根保护规则的公共文件筛选或应用变更筛选。提交时读取完整 Git 索引，包括未改动的已跟踪文件；真实推送和 CI 读取可信 `revision.head` 的完整提交树；手动 `repository-file-placement` 读取当前工作区中实际存在的受控文件及未被忽略的新文件。Git 子模块入口（gitlink）及其内部文件不参与本仓规则。
- 应用 `repository.exceptions.entries[].path` 填写相对应用目录的文件路径，例如 `src/runtime.js`。只作用于当前应用，不会放行另一应用的同名文件。
- 提交、推送及普通 CI 先选择受影响应用，再加载它们的工程配置。只改 web 时，未选中的 api 配置与工具不会参与检查。修改仓库入口会重新校验全部应用；共享目录通过 `sharedPaths` 显式声明影响关系。
- 提交检查读取同一份 Git 暂存配置快照。真实 push 检查待推送提交中的根配置和应用配置，并校验 HEAD 与工作树一致；删除已接入的配置不能让检查被跳过。
- 手动 `repo-guard pre-push` 没有 Git 提供的推送参数时读取工作区配置，工程命令使用当前工作区；仓库级文件归位仍检查已解析的当前 HEAD 完整提交树。该调用不能作为指定远端推送范围的证明；检查尚未提交的文件位置请用 `repo-guard repository-file-placement`。
- CI 分别记录各应用结果，任一阻断性失败都会让汇总失败。子应用成功不能覆盖另一应用失败。具体报告路径见[CI 报告](gate-result-and-reporting.md)。
- CI 同时检查仓库公共 `AGENTS.md` 和所选应用各自的 `AGENTS.md`；只选择 web 时不会检查 api 的规范。唯一应用使用 `root: "."` 时，共用根文件按该应用配置核验一次，避免重复要求不同内容。

## 应用工具如何定位

ESLint、Prettier、Stylelint、dependency-cruiser 等工具从所选应用开始，按 Node 的就近顺序查找本目录及祖先目录的 `node_modules`，支持工作区提升安装、作用域包、符号链接和 Windows 目录联接。不会退回全局 `NODE_PATH` 或 repo-guard 自身的工具安装。包未公开导出 `package.json` 时仍可读取已定位安装的清单。

最近的安装存在但清单损坏或不可读时，会报告对应配置错误；不会继续使用更远的另一份安装掩盖问题。清单与入口必须属于同一安装；保留符号链接的 Node 运行方式也按真实文件归属校验。修复依赖安装后，重新运行 Doctor 和实际门禁。

CLI 适配器可以只读取清单中的命令入口；以库方式加载工具时仍需该适配器支持的 Node 可解析入口。仅提供 `import` 条件、没有可解析库入口的包会明确报错，不代表所有 ESM 导出形式都已支持。Hook 和检查入口不会自动安装或升级依赖。

## 后续扩展

前后端也可放在两个独立 Git 仓库、不同磁盘或不同电脑上。每个仓库运行自己的检查，不把 `../另一个仓库` 填入应用清单。跨仓库协作使用[独立交付合同](delivery-contract.md#独立交付与跨仓库协作)，通过稳定的仓库、参与方标识及签名证据关联。同仓不同目录可绑定同一合同中的多个参与方；前后端文件混在同一目录不支持。

`profiles` 提供明确的项目预设和工具需求描述，`integrations` 承担执行器，`operations/providers` 承担发布命令映射。Java Maven 执行器通过 Node CLI 调用已准备的工具；Gradle 检查和 Java 运维适配仍未支持。

Java 项目也可通过独立交付合同运行自己的 Maven / Gradle 检查命令；接入步骤和质量基线见[Java 检查接入说明](../java-quality-integration.md)。

自动安装与基础配置尚未执行。后续接入会在专门的准备阶段验证宿主 Node、项目运行环境、依赖 engines/peerDependencies 与现有配置，生成可审阅的变更计划；检查和提交 Hook 本身不会安装、升级依赖。

## 维护依据

[配置入口](../../src/config/workspace-configuration.js) · [应用预设](../../src/profiles/project-profiles.js) · [工作区调度](../../src/orchestration/workspace/targets.js) · [配置测试](../../test/config/project-configuration.test.js)

[工具定位](../../src/core/project/package.js) · [依赖提升与目录链接回归](../../test/core/project-package.test.js)

[应用策略组合](../../src/config/workspace-scopes.js) · [CI 默认模式继承回归](../../test/ci/workspace-gate-policy.test.js)

[仓库归位配置](../../src/config/repository-file-placement.js) · [根与应用配置隔离回归](../../test/config/repository-file-placement.test.js) · [跨入口全仓检查回归](../../test/hooks/repository-file-placement.test.js)
