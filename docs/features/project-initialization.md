# 项目初始化

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

把团队规则接入当前 Git 项目：创建配置、安装 Hook、同步 AI 规范，并登记项目维护脚本。

## 首次接入

先按[快速开始](../usage-guide.md#快速开始)安装当前版本，并准备项目自己的 ESLint、Prettier 等工具。在项目根目录执行：

```bash
npx repo-guard init --project web --role frontend --stack node --preset vue-javascript
npx repo-guard doctor
```

| 产物 | 用途与保留规则 |
|---|---|
| `repo-guard.config.json` | 不存在时生成；已有配置保留团队选择 |
| `.githooks/` 与 `core.hooksPath` | 安装五个受管 Hook；遇到非托管 Hook 或不同路径时报告冲突 |
| `package.json` 的 `guard:*` | 补充维护入口，已有自定义脚本需检查冲突 |
| `.gitattributes`、`.gitignore` | 维护 Hook 换行与本地产物忽略规则 |
| `.env.config` | 创建本地通知变量模板，纳入 Git 忽略 |
| `AGENTS.md` | 将实际配置同步为项目 AI 规范 |
| `.agents/skills/` | 启用合同后同步五个交付流程 Skill |

首次生成配置默认开启 ESLint、Prettier、依赖、文件归位、行数和通知。Stylelint、类型、单元测试、axe、架构及构建默认关闭，准备工具后由人或 AI 明确启用；详细状态见[能力开关表](../usage-guide.md#启用或关闭能力)。重复初始化保留已有选择，不根据依赖改变项目身份和功能开关。

上面的命令声明 Vue JavaScript 前端。Node 后端使用 `--role backend --stack node --preset node-javascript`，TypeScript 后端使用 `node-typescript`；`--project` 提供应用标识。四个字段必须明确填写且互相匹配。

项目配置只接受 `version: 2`。已有非 v2 配置会直接被拒绝并保留原文件，需按[配置管理与规则启停](configuration-management.md)重新建立 v2 配置；init 不转换或覆盖旧格式。多应用仓库先手动登记根清单和子应用配置，再运行 init，同步一份根 Hook 与各应用规范，示例见[前后端与多应用配置](project-workspace.md)。

初始化会先只读检查已有 Skill 清单、相关 `AGENTS.md` 标记和全部目标 Hook。旧清单、旧规范或 Hook 冲突会在创建配置、同步规范和安装 Hook 前拒绝；即使首次接入尚无主配置，也不会留下半套初始化文件。缺失的托管文件和当前格式的待同步内容可正常生成或更新。

初始化会先只读检查已有 Skill 清单、相关 `AGENTS.md` 标记和全部目标 Hook。旧清单、旧规范或 Hook 冲突会在创建配置、同步规范和安装 Hook 前拒绝；即使首次接入尚无主配置，也不会留下半套初始化文件。缺失的托管文件和当前格式的待同步内容可正常生成或更新。

## 完成接入的判断

检查 Git 差异，提交团队共享的配置、Hook、规范和脚本；本地通知凭据保留在忽略文件中。解决 Doctor 报告的缺失工具和托管冲突，然后使用一次真实提交验证 Hook。

初始化不会替项目安装全部工具或证明业务测试通过。团队成员安装依赖后也要确认各自工作区的 Hook 配置，不能仅凭远端存在 `.githooks` 判断本机已启用。

## 维护依据

[实现入口](../../src/orchestration/setup/project-initialization.js) · [对应测试](../../test/setup/config-management.test.js)
