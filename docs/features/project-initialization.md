# 项目初始化

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

把团队规则接入当前 Git 项目：创建配置、安装 Hook、同步 AI 规范，并登记项目维护脚本。

## 首次接入

先按[快速开始](../usage-guide.md#快速开始)安装当前版本，并准备项目自己的 ESLint、Prettier 等工具。在项目根目录执行：

```bash
npx repo-guard init
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

首次生成配置默认开启 ESLint、Prettier、依赖、文件归位、行数和通知。Stylelint、类型、单元测试、axe、架构及构建根据项目准备情况启用；详细状态见[30 项开关](../usage-guide.md#启用或关闭能力)。重复初始化不会重新探测并重置已有选择。

## 完成接入的判断

检查 Git 差异，提交团队共享的配置、Hook、规范和脚本；本地通知凭据保留在忽略文件中。解决 Doctor 报告的缺失工具和托管冲突，然后使用一次真实提交验证 Hook。

初始化不会替项目安装全部工具或证明业务测试通过。团队成员安装依赖后也要确认各自工作区的 Hook 配置，不能仅凭远端存在 `.githooks` 判断本机已启用。

## 维护依据

[实现入口](../../src/orchestration/setup/project-initialization.js) · [对应测试](../../test/config-management.test.js)
