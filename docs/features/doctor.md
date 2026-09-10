# Doctor 诊断与受管修复

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

Doctor 检查 repo-guard 是否已经正确接入：项目身份、工具、脚本、Git Hook 和团队规范是否准备好。它按配置检查前端或 Node 后端，不猜测框架，也不代替测试与构建的实际执行。

## 入口与范围

在仓库根目录执行：

```bash
npx repo-guard doctor
npx repo-guard doctor --project api
npx repo-guard doctor --ci
npx repo-guard doctor --fix
npx repo-guard doctor --fix --project api
```

| 选项 | 含义与约束 |
|---|---|
| 不带选项 | 检查仓库公共设置及全部已声明应用 |
| `--project <id>` | 检查指定应用的工具与受保护构建脚本；`id` 必须已经在配置中声明。仓库公共规则与 Hook 仍会检查 |
| `--ci` | 检查 CI 所需工具和流水线集成，不要求本地 Hook 或企业微信凭据。独立 ops 已启用时检查其生成文件及引用；否则检查质量 CI 模板 |
| `--fix` | 同步可识别的受管内容，然后再次诊断；可与 `--project` 同用，不能与 `--ci` 同用 |

## 多应用如何检查

Doctor 先验证根清单、应用路径和公共规则，再加载本轮所选应用。`--project api` 不读取无关前端的工程配置，也不要求安装前端工具；不指定应用时检查全部应用。路径越界、目录重叠和无效应用标识仍属于公共清单错误。

应用例外按本方有效期检查，已过期或尚未生效会报错，即将到期会预警。通知是否需要凭据，合并考虑公共规则、所选应用的通知型保护规则和变异测试通知。独立运维启用时，`--ci` 另有仓库整体流水线检查，可能读取全部应用身份；本次应用工程隔离不改变运维范围。

| 检查对象 | 使用的目录与配置 |
|---|---|
| 公共清单、基础文件保护、交付资料 | Git 根目录，检查一次 |
| 应用保护规则、结构化例外、依赖与文件归位策略 | 所选应用自己的配置和目录，不继承其他应用规则 |
| 仓库 `AGENTS.md` | 仓库公共规则；单应用根项目同时包含该应用规范 |
| 子应用 `AGENTS.md` | 对应应用的角色、检查开关与工程要求 |
| ESLint、Prettier、Stylelint、类型、测试、构建等工具 | 对应应用目录和已启用配置，检查项目已安装的工具与已有脚本 |
| Vue 专项检查 | 只适用于前端 Vue 预设；Node 后端不执行 Vue 专项 |
| 受保护构建 | 对应应用的 `package.json`；子应用包装脚本必须包含正确的 `--project <id>` |
| 通知 | 仓库级配置；实际启用通知规则或变异测试失败通知时才要求对应环境 |

配置在[前后端与多应用配置](project-workspace.md)中明确声明。启用工具不会自动安装依赖；缺少工具、插件、配置或脚本时，Doctor 会报告需要补齐的项目。

独立交付使用 `repo-guard.delivery.json`，可与工程检查同时启用。交付状态和证据完整性使用 `repo-guard delivery check / status / verify` 复核；Doctor 的接入结果不能代替合同确认、联合验证或人工验收。单独使用交付时，按[独立交付接入](delivery-contract.md#独立交付与跨仓库协作)操作，无需为了诊断而添加虚构工程身份。

## `--fix` 会修改什么

`--fix` 同步仓库和所选应用的受管 `AGENTS.md`、交付流程 Skills、仓库根 Hook、换行属性、本地通知文件与忽略项，以及辅助 npm 脚本。受保护构建包装脚本写入对应应用；已有其他用途的脚本或 Hook 会提示冲突，不直接替换。

修复先只读检查已有 Skill 清单、相关 `AGENTS.md` 标记和全部目标 Hook；旧格式或 Hook 冲突会在任何修复写入前停止，保留配置、规范、Hook 及原资料。缺失的文件和当前格式但内容过期的规范仍可正常同步，不要求人工提前生成最新内容。

以下操作需要使用各自的入口，不由 Doctor 自动完成：

| 情况 | 处理方式 |
|---|---|
| 首次接入，没有配置 | 使用带有身份参数的 `init`，例如 `npx repo-guard init --project api --role backend --stack node --preset node-typescript` |
| 非 v2 配置 | 直接拒绝并保留原文件；按[配置管理与规则启停](configuration-management.md)重新建立 v2 配置，`--fix` 不转换旧结构或推断身份 |
| 工具、插件或项目配置缺失 | 在应用中准备兼容的依赖、配置和 npm 脚本，再次运行 Doctor |
| CI 或发布流水线缺失 | 质量 CI 使用 `install-ci`；独立运维使用 `ops plan`、`ops install` |
| 密钥或业务代码需要修复 | 在本机配置真实凭据，或修改项目代码后执行对应检查 |
| 受管 marker 损坏、已有第三方 Hook | 比较现有内容，先明确文件归属，再处理冲突 |

直接修改 v2 检查开关后，可用 `doctor --fix` 同步规范。单纯 LF、CRLF、CR 换行差异不会被当作受管正文过期。

Doctor 返回成功表示接入准备满足当前检查要求。代码是否符合规范、测试是否通过、构建是否成功，仍需执行相应命令；业务正确性由项目自己的测试与验收确认。

## 维护依据

[诊断入口](../../src/orchestration/doctor/runner.js) · [修复入口](../../src/orchestration/setup/repository-repair.js) · [基础测试](../../test/setup/doctor.test.js) · [多应用回归](../../test/setup/workspace-doctor.test.js)
