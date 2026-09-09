# 提交信息

校验团队提交格式，并在推送、CI 和发布准备中复核真实提交对象。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑 v2 配置后运行 `npx repo-guard doctor --fix` 同步规范，再运行 `npx repo-guard doctor`。

提交信息门禁默认关闭。启用后，本地 `commit-msg` 会在自动变更文件摘要定稿前校验人工提交内容；pre-push、CI policy/full 和 release-ready 会重新读取实际提交对象，校验本次 Git revision 范围，不能只靠跳过本地 Hook 绕过。

提交摘要在 Git 元数据目录保存当前 `version: 2` 临时状态。状态缺失时，当前 Hook 会按本次索引重新生成；已有旧版、未知版本、缺少版本或无法解析的状态会以 `commit-message/unsupported-state-version` 拒绝读取、覆盖和清理，原状态、提交消息和索引保持不变。先确认相关提交进程已经退出，再人工核对遗留文件并重新提交；不能改写版本号绕过检查。当前 v2 状态会在索引变化时重新计算，并保留本次提交来源。

如果提交已经创建，`post-commit` 清理时才发现不受支持的状态，会保留文件并输出中文警告，但仍返回成功，不把真实提交误报为失败。

```bash
npx repo-guard enable commitMessage
```

```json
{
  "repository": {
    "commitMessage": {
      "enabled": true,
      "types": [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore"
      ],
      "requireScope": false,
      "allowedScopes": [],
      "headerMaxLength": 100,
      "breakingChange": {
        "allowed": true,
        "requireMarker": true,
        "requireFooter": true,
        "requireMajorVersionOnRelease": true
      },
      "merge": {
        "allowed": true
      },
      "revert": {
        "allowed": true
      },
      "fixup": {
        "allowLocal": true,
        "allowPush": false,
        "allowCi": false
      }
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `repository.commitMessage.enabled` | 是否启用提交信息强制门禁 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.commitMessage.types` | 普通提交允许使用的 type 白名单 | 字符串数组<br>默认：`["feat","fix","docs","style","refactor","perf","test","build","ci","chore"]` | 至少 1 项；元素不可重复；每项：以小写字母开头，后续仅小写字母、数字、连字符 |
| `repository.commitMessage.requireScope` | 普通提交是否必须提供 scope | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.commitMessage.allowedScopes` | scope 白名单；空数组表示允许任意合法 scope | 字符串数组<br>默认：`[]` | 允许空数组；元素不可重复；每项：匹配格式 `"^[a-z0-9][a-z0-9._/@-]*$"` |
| `repository.commitMessage.headerMaxLength` | 提交标题允许的最大 Unicode 字符数 | 整数<br>默认：`100` | ≥ 10 |
| `repository.commitMessage.breakingChange.allowed` | 是否允许不兼容变更提交 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.commitMessage.breakingChange.requireMarker` | 不兼容变更标题是否必须在冒号前包含 ! | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.commitMessage.breakingChange.requireFooter` | 不兼容变更是否必须包含 BREAKING CHANGE: 迁移说明 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.commitMessage.breakingChange.requireMajorVersionOnRelease` | release-ready 是否要求包含不兼容变更的发布提升 major 版本 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.commitMessage.merge.allowed` | 是否允许合并提交格式 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.commitMessage.revert.allowed` | 是否允许回退提交格式 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.commitMessage.fixup.allowLocal` | 是否允许本地创建 fixup!/squash! 临时整理提交 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.commitMessage.fixup.allowPush` | pre-push 是否允许临时整理提交 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.commitMessage.fixup.allowCi` | CI 是否允许临时整理提交 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |

<!-- config-fields:end -->

普通提交使用 `type(scope)!: 简要说明`；`scope` 和 `!` 是否必需由配置决定。`allowedScopes` 为空表示不限制 scope，非空时只接受列出的值。标题长度按 Unicode 字符计数，不按 UTF-16 字节或代码单元计数。

不兼容变更默认必须同时使用标题 `!` 和正文 `BREAKING CHANGE: 迁移说明`。release-ready 发现提交范围包含不兼容变更时，会比较 Git 基准提交与目标提交中的 `package.json`，并要求 major 提升；未提交的工作区版本修改不能绕过校验。普通提交、pre-push 和日常 CI 不根据提交类型自动改版本。

Git 自动生成的 merge commit 在本地通过 `MERGE_HEAD` 还原待提交父节点、在已提交历史中通过父节点数量识别，普通标题以及 revert/cherry-pick 使用的 `MERGE_MSG` 不能伪装成 merge；revert 必须保留 Git 生成的 `Revert "..."` 标题和 `This reverts commit <sha>.` 正文。默认策略允许开发者在本地创建 `fixup!`/`squash!`，但 pre-push 和 CI 会阻断，要求先执行交互式 rebase/autosquash。只有业务仓库确认由 GitLab 在进入受保护分支前可靠 squash 时，才应评审后将 `allowPush` 调整为 `true`；最终 CI 仍建议保持 `allowCi: false`。

## 执行与复核

执行入口：commit-msg、pre-push、CI policy/full 和 release-ready。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/policies/commit-message.js) · [对应测试](../../test/gates/repository/commit-message.test.js)
