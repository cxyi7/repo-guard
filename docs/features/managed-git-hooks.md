# 托管 Git Hook

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

让每位开发者和 AI 在提交、推送时执行同一套团队检查。

## 安装与升级

```bash
npx repo-guard install-hooks
npx repo-guard doctor
```

首次接入也可直接使用 `init`。安装器将 `core.hooksPath` 设置为 `.githooks`，识别当前及已知历史托管 marker，升级时只生成当前格式。非托管文件和其他 Hook 路径会触发冲突，不应直接覆盖团队自己的 Hook。

| Hook | 职责 |
|---|---|
| `pre-commit` | 暂存格式修复、只读复核、策略检查和末尾保护文件门禁 |
| `prepare-commit-msg` | 准备提交信息与变更摘要 |
| `commit-msg` | 校验已启用的提交信息规范 |
| `post-commit` | 清理提交信息临时状态 |
| `pre-push` | 按真实推送范围执行提交历史检查及已启用重型能力 |

## 固定顺序与范围

pre-commit 骨干顺序为 Stylelint 修复 → ESLint 修复 → Prettier → Stylelint/ESLint 只读复核 → 其余策略 → 保护文件门禁。完整顺序见[使用说明](../usage-guide.md#固定执行顺序)。类型、测试、构建和 Lighthouse 放在推送或显式检查阶段。

格式工具只修复暂存文件，由 `lint-staged` 保护部分暂存与未暂存内容。Hook 不运行项目全量修复；维护者也不能通过配置重排官方计划。

## 排查与复核

确认本机 `core.hooksPath` 和受管文件实际存在。提交失败先修复报告中的问题，再暂存并重试。重叠运行时按[暂存隔离](staged-isolation-and-lifecycle-lock.md)处理；提交信息问题按[提交信息](commit-message.md)处理。安装完成后应使用真实变更验证，不能仅检查文件是否存在。

## 维护依据

[实现入口](../../src/orchestration/setup/hook-installer.js) · [对应测试](../../test/hook-installer.test.js)
