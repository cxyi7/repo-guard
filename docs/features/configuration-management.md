# 配置管理与规则启停

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

项目与工作区只支持 `version: 2`，文件与执行共用一套原生模型。不再提供旧配置解析、字段转换、迁移命令或迁移 API。

## 首次接入

在尚未建立配置的项目中，明确身份后初始化：

```bash
npx repo-guard init --project web --role frontend --stack node --preset vue-javascript
npx repo-guard doctor
```

Node 后端使用 `--role backend --stack node --preset node-javascript` 或 `node-typescript`。初始化不会猜测身份、自动安装项目工具或覆盖人工工具配置。已有配置会先按 v2 校验，不会因为运行初始化而转换为新格式。

| 分区 | 归属 |
|---|---|
| `project` | 应用标识、前后端角色、技术栈与预设 |
| `checks` | 当前应用的代码、测试与构建检查 |
| `repository` | 团队规则、受保护文件、例外与交付合同 |
| `reporting` | 通知和提交动画 |
| `ci` | 质量检查策略与外部门禁，不含部署设置 |

单应用配置由 [config.schema.json](../../config.schema.json) 校验。多应用根配置登记应用并维护公共分区，子应用仅声明身份与检查，使用 [project.schema.json](../../project.schema.json)。部署使用独立的 `repo-guard.ops.json`，见[独立运维](operations.md)。

## 日常修改与启停

```bash
npx repo-guard enable pathNaming
npx repo-guard disable pathNaming
# 直接编辑 v2 配置后同步托管规范，并复核差异
npx repo-guard doctor --fix
npx repo-guard doctor
```

`enable` / `disable` 接受[完整开关表](../usage-guide.md#启用或关闭能力)中的名字。开关名、配置路径与 Gate ID 是不同概念。多应用可使用 `repo-guard enable unitTest --project api`；应用检查只修改所选应用，公共规则写入仓库根配置，修改前验证所有应用仍然有效。

| 操作 | 联动结果 |
|---|---|
| 启用 `coverage` 或 `componentInteraction` | 同时启用 `unitTest` |
| 关闭 `unitTest` | 同时关闭组件交互和覆盖率检查 |
| 启用 `styleComplexity` 或 `styleGovernance` | 同时启用 Stylelint |
| 关闭 Stylelint | 同时关闭两项样式增强 |
| 启用 `unusedImageAssets` | 同时启用图片治理 |
| 关闭图片治理 | 同时关闭无效图片检查 |
| 启停 `deliveryContract` | 按托管指纹同步或移除对应 Skill；人工修改导致冲突时拒绝覆盖 |

启用检查仍需准备对应项目工具。启停命令和 Doctor 不代表完整质量测试已通过；应使用实际提交、专项命令或对应 CI 配置档验证。

## 旧配置与失败处理

- 非 `version: 2` 项目配置统一报 `config/unsupported-version`，原文件保持不变，不创建转换结果、迁移报告或自动备份。
- 不能只把旧文件版本号改成 `2`：旧字段仍会被拒绝。由人工保存原配置及流水线，按新分区、显式身份和现有团队要求重新建立配置，再复核差异与检查结果。
- 旧 CI 模板和无摘要运维片段不再自动升级；安装器拒绝覆盖。人工确认并保存旧文件、重新接入当前流水线后再安装，不能为消除报错而擅自停用仍在使用的部署流程。
- 未知字段、无效枚举、非法空值和跨字段冲突按 Schema 修正，不会静默转换成默认策略。覆盖率配置使用 `checks.coverage` 对象，不接受布尔简写。
- Git 增量检查读取到含旧配置的基线也会拒绝。按 v2 建立经团队确认的可信基线后再启用增量检查，不得静默使用当前规则替换历史规则。

## 当前格式清单

本版不保留旧格式读取或升级路径。生成端、校验端、Schema 和 Skill 资产使用下列同一约定：

| 数据或文件 | 只接受的格式 |
|---|---|
| 项目、工作区和独立运维配置 | `version: 2` |
| 功能登记表、合同包及 Evidence Run | `schemaVersion: 2` |
| 托管 Skill 清单 | `schemaVersion: 2` |
| UI Token 清单、构建产物基线 | `version: 2` |
| 无效代码基线 | `schemaVersion: 2` |
| CI 报告 | `version: 2` |
| GateResult、外部门禁报告 | `schemaVersion: 2`；外部格式标识为 `repo-guard-json-v2` |
| 提交生命周期锁、提交信息临时状态 | `version: 2` |
| Git Hook | 当前 `repo-guard-managed:v5` 标记，不接受 v1～v4 |
| AGENTS 托管规范 | 当前职责区块，旧区块或未知标记直接拒绝 |
| GitLab 质量模板 | 当前 `repo-guard-gitlab-template:v3` 标记及可验证内容 |
| GitLab 运维模板 | 当前 `repo-guard-operations:v2` / `repo-guard-operations-root:v2` 标记及有效摘要 |
| 本仓库中文文案基线 | `schemaVersion: 2`；历史豁免数量仍只允许减少 |

旧 Hook、旧 AGENTS 区块及旧清单均保留原文件，不会自动转换、追加新旧并存内容或覆盖人工资料。配置启停、初始化、修复及 CI 安装在写入前先检查相关托管格式，防止遇到旧输入后留下部分修改；当前格式的内容尚未同步仍可正常更新。人工确认并保存原资料后，再按当前格式重新接入；不要仅改版本号掩盖结构差异。旧版或损坏的执行锁也会阻断，不能仅凭文件时间将其当成可自动清理的失效锁。

第三方工具的原生报告版本、Git 输出格式和摘要算法标识仍遵循各自规范，不能通过修改名称伪造新格式；这不代表保留 repo-guard 旧配置兼容。

## 维护依据

[配置校验](../../src/config/root-configuration-validation.js) · [管理入口](../../src/orchestration/setup/config-management.js) · [原生模型与拒绝边界测试](../../test/config/v2-runtime-contract.test.js) · [配置管理测试](../../test/setup/config-management.test.js)
