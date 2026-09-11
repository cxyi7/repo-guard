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

仅启用独立交付合同时，仓库可只有 `repo-guard.delivery.json`，无需创建工程配置或 `package.json`。Hook 优先使用仓库本地安装的 CLI；不存在时使用 `PATH` 中全局安装的 `repo-guard`，两者都缺少时阻断并提示安装。独立交付在提交与推送时检查合同确认、固定版本和任务边界，最终验收使用 `delivery verify` 或发布就绪检查。

安装器将 `core.hooksPath` 设置为 `.githooks`，只接受并生成当前 `repo-guard-managed:v5` marker。旧版本、未知、重复、混合标记和非托管文件都会触发冲突；安装器先检查全部 Hook，任一冲突都会在写入前停止，不自动升级或覆盖。其他 Hook 路径也会触发冲突；团队应先保留原文件，人工确认职责与差异后按当前入口重新接入。

安装前也会只读校验已有 Skill 清单和相关 `AGENTS.md` 标记，旧格式不会导致 Hook 已更新而规范同步失败。`init` 在创建主配置前复用同一组检查；`doctor --fix` 在修复任何受管文件前检查，原文件均保留。

| Hook | 职责 |
|---|---|
| `pre-commit` | 暂存文件格式修复、只读复核、应用策略、完整索引的仓库归位及末尾保护文件门禁 |
| `prepare-commit-msg` | 准备提交信息与变更摘要 |
| `commit-msg` | 校验已启用的提交信息规范 |
| `post-commit` | 清理提交信息临时状态，按配置播放[提交成功动画](commit-animation.md) |
| `pre-push` | 检查真实推送范围中的提交历史、完整可信 head 文件树的仓库归位、独立合同约束，以及受影响应用已启用的类型、测试、构建等检查 |

## 多应用保持同一个提交顺序

在本次变更涉及的 `web`、`api` 等应用中，按下面的全局阶段执行；未涉及的应用不读取工具或工程规则，公共路径通过 `sharedPaths` 声明关联：

```text
各应用 Stylelint 修复
  → 各应用 ESLint 修复
  → 各应用 Prettier
  → 各应用 Stylelint 只读复核
  → 各应用 ESLint 只读复核
  → Java 应用暂存格式修复与只读复核
  → Java 应用源码规范、工程文件与文件/目录命名检查
  → 其他已启用应用规范与文件归位
  → 应用依赖策略
  → 仓库级文件归位（完整 Git 索引，仅执行一次）
  → 图片、代码片段归位与交付等后续策略
  → 仓库受保护文件门禁
```

只读复核也适用于关闭 Prettier 的场景。某个应用的失败会使整体失败，另一个应用成功不会覆盖它。前端 Vue 专项只运行于匹配的预设，Node 后端使用 Node 工具，Java Maven 使用独立 Java 检查器。

Hook 保留 repo-guard 的[统一退出码](gate-result-and-reporting.md)：规则违规返回 `2`，配置或执行异常返回 `1`，Git 范围不可信返回 `3`，不再把所有阻断压成 `1`。Git 自身及 npm 等外层命令可能另行返回自己的进程状态；自动化若需要区分失败类型，应读取 repo-guard 命令结果和结构化报告，不能把 Git 的返回码当作门禁分类。

修复范围只包含暂存文件；工具使用应用自己的安装和配置。一次提交由同一个 `lint-staged` 流程保护所有应用的部分暂存与未暂存修改。Hook 不执行项目全量修复，也不在提交阶段执行类型检查、测试、构建、Lighthouse 或依赖安装。

应用文件模式相对应用根目录，仓库级文件归位等公共规则相对 Git 根目录；保护文件的根与应用范围按各自配置执行。维护者可以开关规则，不能通过配置重新排列官方执行顺序。

仓库级文件归位配置为根 `repository.filePlacement`，开关名 `repositoryFilePlacement`，Gate ID 为 `repository.global-file-placement`。它默认关闭，启用前须配置至少一条规则；只读检查全部索引路径，包括本次未改动的文件，不扩大格式修复范围。子应用不能声明或继承该配置，应用筛选、应用归位开关和应用例外都不能放行根规则。规则字段和建议接入方式见[仓库级文件归位](repository-file-placement.md)。

## 配置快照与推送检查

提交检查读取同一份 Git 暂存快照中的根配置和受影响应用配置，推送检查读取待推送提交中的配置。读取时先通过索引或提交树确认目标存在且是可读取的文件，再按固定的 blob 对象读取内容；尚未提交到索引的配置变更不会悄悄改变本次规则。

只有成功检查快照后才能认定配置缺失。索引损坏、对象丢失或 Git 读取失败保留为 `execution-error`，中文主说明与独立的第三方原始诊断分别呈现，不会误报配置已删除或跳过检查。真正删除已接入的根配置或所需应用配置仍会被阻断。首次初始化时尚未被 Git 跟踪的配置保留专门的接入路径，包括尚无 HEAD 提交的初始分支。读取失败会停止本次检查，不会自动重试或重置工作区。

真实 `git push` 通过 Git 提供的参数确定待推送提交。启用的重型检查执行前，需要工作树干净、HEAD 对应待验证提交，并且不能混用多个不同的待推送代码版本；不满足时会阻止并提示处理方式。仅删除远端引用不会运行源码检查。

启用的仓库级文件归位读取可信 `revision.head` 的完整提交树，CI policy/full/release-ready 使用相同范围；它不只检查本轮变更，也不按受影响应用裁剪。缺少可信提交、索引冲突或读取错误都会保留相应的范围/执行错误，按公共退出码返回，不能用空清单当作通过。Git 子模块（gitlink）入口及内部文件不参与本仓归位。

手动执行 `repo-guard pre-push` 且没有 Git 推送参数时，读取工作区配置，工程命令使用当前工作区，仓库级文件归位仍检查已解析的当前 HEAD 完整提交树；这不能作为某个指定远端推送范围已经通过的证明。

单独预览当前文件位置可运行 `repo-guard repository-file-placement`：读取工作区中实际存在的受控文件及未被 Git 忽略的新文件，不移动文件。它的通过结果不能代替提交 Hook 的完整索引检查或推送的提交树检查。

## 安装时的文件维护

| 位置 | 维护内容 |
|---|---|
| 仓库根 `.githooks/` | 五个受管 Hook |
| 仓库根 `.gitattributes`、本地环境文件与忽略项 | Hook 换行要求及本地通知资料保护 |
| 仓库根 `package.json` | `init` 或 `doctor --fix` 同步辅助命令与 `prepare`；保留已有非托管脚本 |
| 应用忽略项 | 对应应用的检查报告目录 |
| 应用 `package.json` | 仅在配置受保护构建时同步包装命令，子应用携带 `--project <id>`；不添加子应用 `prepare` |

Hook 本身不会自动安装、升级工具或修改业务配置。Java Maven 已接入源码和路径检查，编译、构建、测试、覆盖率、SpotBugs 与 PIT 留在推送或 CI。Java 路径命名复核完整 Git 索引，配置变更和删除路径也参与调度；不自动重命名文件。纯 Java 仓库没有 `package.json` 时不会创建 npm 脚本，Hook 使用环境中已准备的 repo-guard CLI。自动接入流程仍属于后续 Skill。

Java 实际工具检查的版本和验证边界见 [Java 检查验收记录](../java-check-acceptance.md)。仓库级文件归位不要求 Java 或前端工具，纯 Java 仓库同样可以配置使用。

## 排查与复核

先用 Doctor 检查实际 `core.hooksPath`、受管文件和应用工具。提交失败时修复中文报告中的问题，重新暂存后重试；格式修复失败时检查原始未暂存修改仍被保留。重叠执行按[暂存隔离](staged-isolation-and-lifecycle-lock.md)处理，提交信息问题见[提交信息](commit-message.md)。

安装后应使用真实变更验证成功与失败路径，不能只根据 Hook 文件存在就认定检查已经运行。

## 维护依据

[安装器](../../src/orchestration/setup/hook-installer.js) · [工作区调度](../../src/orchestration/workspace/targets.js) · [配置快照读取](../../src/git/snapshot-content.js) · [暂存配置入口](../../src/orchestration/workspace/configuration-snapshot.js) · [推送配置入口](../../src/orchestration/pre-push/push-configuration.js) · [基础测试](../../test/hooks/hook-installer.test.js) · [多应用与真实 Git 回归](../../test/hooks/workspace-hooks.test.js) · [快照错误分类回归](../../test/config/snapshot-errors.test.js) · [索引与提交树读取回归](../../test/core/snapshot-content.test.js)

[全仓路径事实](../../src/git/repository-file-paths.js) · [仓库归位跨入口回归](../../test/hooks/repository-file-placement.test.js)
