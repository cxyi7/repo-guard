# 托管 Git Hook

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

让开发者和 AI 在每次提交、推送时执行同一套团队检查。一个 Git 仓库安装一组 Hook，各应用使用自己的工程配置与工具。

## 安装与重新接入

先按[前后端与多应用配置](project-workspace.md)声明项目，在仓库根安装 repo-guard 后执行：

```bash
npx repo-guard install-hooks
npx repo-guard doctor
```

首次接入的 `init` 也会安装 Hook；修改配置后可使用 `doctor --fix` 同步 Hook、规范与辅助脚本。多应用仍由仓库根的 npm 入口启动，不需要给每个前端或后端安装一组 Hook。

安装器将 `core.hooksPath` 设置为 `.githooks`，只接受并生成当前 `repo-guard-managed:v5` marker。旧版本、未知、重复、混合标记和非托管文件都会触发冲突；安装器先检查全部 Hook，任一冲突都会在写入前停止，不自动升级或覆盖。其他 Hook 路径也会触发冲突；团队应先保留原文件，人工确认职责与差异后按当前入口重新接入。

安装前也会只读校验已有 Skill 清单和相关 `AGENTS.md` 标记，旧格式不会导致 Hook 已更新而规范同步失败。`init` 在创建主配置前复用同一组检查；`doctor --fix` 在修复任何受管文件前检查，原文件均保留。

| Hook | 职责 |
|---|---|
| `pre-commit` | 暂存文件格式修复、只读复核、策略检查及末尾保护文件门禁 |
| `prepare-commit-msg` | 准备提交信息与变更摘要 |
| `commit-msg` | 校验已启用的提交信息规范 |
| `post-commit` | 清理提交信息临时状态，按配置播放[提交成功动画](commit-animation.md) |
| `pre-push` | 检查真实推送范围中的提交历史，并执行已启用的类型、测试、构建等重型检查 |

## 多应用保持同一个提交顺序

在 `web`、`api` 等多个应用中，按下面的全局阶段执行：

```text
各应用 Stylelint 修复
  → 各应用 ESLint 修复
  → 各应用 Prettier
  → 各应用 Stylelint 只读复核
  → 各应用 ESLint 只读复核
  → 其他已启用策略
  → 仓库受保护文件门禁
```

只读复核也适用于关闭 Prettier 的场景。某个应用的失败会使整体失败，另一个应用成功不会覆盖它。前端 Vue 专项只运行于匹配的预设，Node 后端使用通用工程检查。

修复范围只包含暂存文件；工具使用应用自己的安装和配置。一次提交由同一个 `lint-staged` 流程保护所有应用的部分暂存与未暂存修改。Hook 不执行项目全量修复，也不在提交阶段执行类型检查、测试、构建、Lighthouse 或依赖安装。

应用文件模式相对应用根目录，保护文件等仓库规则相对 Git 根目录。维护者可以开关规则，不能通过配置重新排列官方执行顺序。

## 配置快照与推送检查

提交检查读取同一份 Git 暂存快照中的根配置和子应用配置。尚未提交到索引的配置变更不会悄悄改变本次规则；删除已接入的根配置或应用配置会报错，不能通过删除配置跳过门禁。首次初始化时尚未被 Git 跟踪的配置有专门的接入路径。

真实 `git push` 通过 Git 提供的参数确定待推送提交。启用的重型检查执行前，需要工作树干净、HEAD 对应待验证提交，并且不能混用多个不同的待推送代码版本；不满足时会阻止并提示处理方式。仅删除远端引用不会运行源码检查。

手动执行 `repo-guard pre-push` 且没有 Git 推送参数时，检查当前工作树；这不能作为某个远端提交快照已经通过的证明。

## 安装时的文件维护

| 位置 | 维护内容 |
|---|---|
| 仓库根 `.githooks/` | 五个受管 Hook |
| 仓库根 `.gitattributes`、本地环境文件与忽略项 | Hook 换行要求及本地通知资料保护 |
| 仓库根 `package.json` | `init` 或 `doctor --fix` 同步辅助命令与 `prepare`；保留已有非托管脚本 |
| 应用忽略项 | 对应应用的检查报告目录 |
| 应用 `package.json` | 仅在配置受保护构建时同步包装命令，子应用携带 `--project <id>`；不添加子应用 `prepare` |

Hook 本身不会自动安装、升级工具或修改业务配置。当前 Java 执行器与自动接入流程仍属于后续扩展。

## 排查与复核

先用 Doctor 检查实际 `core.hooksPath`、受管文件和应用工具。提交失败时修复中文报告中的问题，重新暂存后重试；格式修复失败时检查原始未暂存修改仍被保留。重叠执行按[暂存隔离](staged-isolation-and-lifecycle-lock.md)处理，提交信息问题见[提交信息](commit-message.md)。

安装后应使用真实变更验证成功与失败路径，不能只根据 Hook 文件存在就认定检查已经运行。

## 维护依据

[安装器](../../src/orchestration/setup/hook-installer.js) · [工作区调度](../../src/orchestration/workspace/targets.js) · [基础测试](../../test/hooks/hook-installer.test.js) · [多应用与真实 Git 回归](../../test/hooks/workspace-hooks.test.js)
