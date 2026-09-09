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
| `version` | 必须为数字 `2`；旧配置先显式迁移 |
| `project.id` | 应用唯一标识，小写字母开头，使用小写字母、数字和单个连字符，例如 `api`、`admin-web` |
| `project.role` | `frontend` 或 `backend`，必须与预设匹配 |
| `project.stack` | 当前可执行值为 `node`；`java` 已预留但会明确报告尚未支持 |
| `project.preset` | 前端：`vue-javascript`、`vue-typescript`；后端：`node-javascript`、`node-typescript`。四个身份字段都必须填写 |
| `checks` | 应用检查项；省略的字段使用预设和 Schema 默认值，不代表关闭全部检查 |
| `checks.*.enabled` | 布尔值，决定该能力是否自动执行；具体生命周期见各项文档 |
| `checks.*.script` | 项目 `package.json` 中已经存在的脚本名，不是任意 shell 命令。示例启用项必须先准备对应脚本与工具 |

TypeScript 预设配合 ESLint 预设时要求项目安装 `typescript-eslint`；Vue 预设要求 `eslint-plugin-vue`。后端不会因为同一仓库安装了 Vue 插件而被套用 Vue 规则。

单元测试当前使用 Vitest，覆盖率和变异测试复用已有执行器。不验证接口输入输出、鉴权权限或业务语义，也不要求使用 Express、NestJS 或其他特定框架。

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
      { "pattern": "apps/*/repo-guard.project.json", "category": "应用检查规则", "level": "notify" }
    ]
  },
  "ci": { "enabled": true, "profile": "full" }
}
```

| 字段 | 说明与约束 |
|---|---|
| `projects` | 至少一个明确应用；与单应用的 `project`、`checks` 入口不能混用 |
| `projects[].id` | 必须唯一，且与对应文件内 `project.id` 相同 |
| `projects[].root` | 相对 Git 根目录，目录必须存在。使用 `/`；不得越出仓库，不支持自动扫描或 glob |
| `projects[].config` | 相对该应用的 root；省略时为 `repo-guard.config.json`。不是相对仓库根 |
| 应用目录 | 不得重叠，不得通过符号链接或目录联接越界；一个文件只归属一个应用 |
| `repository` | 团队统一规则，包括保护文件、提交信息、依赖策略、代码归位、交付合同与例外；子应用不能覆盖 |
| `reporting` | 仓库通知和提交动画；子应用不能覆盖 |
| `ci` | 仓库质量策略，`profile` 为 `policy`、`full`、`release-ready`；部署放在独立 ops 文件 |
| `repository.rules[].level` | `block`、`notify` 或 `audit`，完整含义与匹配顺序见[保护文件](protected-files.md) |

前端子配置：

```json
{
  "version": 2,
  "project": { "id": "web", "role": "frontend", "stack": "node", "preset": "vue-typescript" },
  "checks": { "stylelint": { "enabled": true } }
}
```

后端子配置使用本页首个 Node 示例，但不添加 `repository`、`reporting` 和 `ci` 公共区块。手动创建好配置后，在仓库根执行 `repo-guard init` 同步 Hook 和规范。

```bash
# 应用检查与开关明确选择目标
npx repo-guard enable unitTest coverage --project api
npx repo-guard doctor --project api
npx repo-guard unit-test --project api
npx repo-guard ci --project api --profile full

# 不指定应用的 CI 检查整个配置清单
npx repo-guard ci --profile full
```

共享规则的开关写入根配置，应用开关只修改对应子配置。手动编辑配置后执行 `repo-guard doctor --fix` 同步 AGENTS，再运行检查。

## 文件范围与执行顺序

- Git Hook 安装在仓库根。一次提交只使用一次暂存隔离，各应用修复按固定阶段依次进行，最后执行仓库受保护文件门禁。
- 应用检查使用相对应用根的源码、模式、工具、脚本与报告路径；仓库规则使用相对 Git 根的路径。移动到另一应用的文件分别作为源应用删除和目标应用新增检查。
- `repository.exceptions.entries[].path` 始终填写相对 Git 根的完整文件路径。执行时只把属于该应用的批准记录映射为应用相对路径；例如 `apps/api/src/runtime.js` 不会放行另一应用的同名文件。仓库保留完整例外注册表，应用不会改写批准记录。
- 提交检查读取同一份 Git 暂存配置快照。真实 push 检查待推送提交中的根配置和应用配置，并校验 HEAD 与工作树一致；删除已接入的配置不能让检查被跳过。
- 手动 `repo-guard pre-push` 没有 Git 提供的推送参数时检查当前工作树，不能作为指定远端提交的证明。
- CI 分别记录各应用结果，任一阻断性失败都会让汇总失败。子应用成功不能覆盖另一应用失败。具体报告路径见[CI 报告](gate-result-and-reporting.md)。
- CI 同时检查仓库公共 `AGENTS.md` 和所选应用各自的 `AGENTS.md`；只选择 web 时不会检查 api 的规范。唯一应用使用 `root: "."` 时，共用根文件按该应用配置核验一次，避免重复要求不同内容。

## 后续扩展

`profiles` 提供明确的项目预设和工具需求描述，`integrations` 承担执行器，`operations/providers` 承担发布命令映射。未来 Java 执行器通过 Node CLI 调用 JDK 和 Maven/Gradle；目前选择 Java 会报尚未支持，不会产生通过结果。

自动安装与基础配置尚未执行。后续接入会在专门的准备阶段验证宿主 Node、项目运行环境、依赖 engines/peerDependencies 与现有配置，生成可审阅的变更计划；检查和提交 Hook 本身不会安装、升级依赖。

## 维护依据

[配置入口](../../src/config/workspace-configuration.js) · [应用预设](../../src/profiles/project-profiles.js) · [工作区调度](../../src/orchestration/workspace/targets.js) · [配置测试](../../test/config/project-configuration.test.js)
