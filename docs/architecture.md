# 架构说明

## 职责边界

```text
业务项目
├─ repo-guard.config.json       项目级保护和质量门禁开关
├─ Stylelint/ESLint/Prettier + 项目配置   样式、代码及格式规则
├─ @lhci/cli + lighthouserc.*             Vue 页面运行质量规则
└─ @cxyi7/repo-guard
   ├─ config management        配置迁移和功能开关
   ├─ lint-staged              暂存内容隔离、写回和失败恢复
   ├─ stylelint-runner         样式检查、修复、复检
   ├─ stylelint-diagnostics    编号化 AI 修复指令
   ├─ eslint-runner            检查、修复、复检
   ├─ eslint-diagnostics       编号化 AI 修复指令
   ├─ prettier-runner          检查、格式化
   ├─ lighthouse-runner       Vue 构建、LHCI 收集和断言
   ├─ protected-file gate      规则、指纹和通知
   └─ hook installer           Hook 生命周期
```

repo-guard 负责流程编排，不拥有业务项目的 Stylelint、ESLint、Prettier 或 Lighthouse
规则。项目负责选择版本、插件、解析器、页面、断言和忽略范围。Lighthouse 仅运行
`collect` 和 `assert`，不会隐式上传报告。

## Pre-commit 状态流

```text
开始
  ↓
读取并校验项目配置
  ↓
质量门禁均未启用 ───────────┐
  ↓ 任一启用                │
lint-staged 备份 Git 状态    │
  ↓                         │
隐藏部分暂存文件的未暂存内容 │
  ↓                         │
Stylelint 修复 → ESLint 修复 → Prettier → Stylelint 复检 → ESLint 复检
  ↓ 成功                    │
写回暂存区并恢复未暂存内容   │
  └─────────────────────────┘
  ↓
保护文件门禁
  ↓
通知关闭 ────────────────┐
  ↓ 通知开启             │
notify 规则发送企业微信  │
  └──────────────────────┘
  ↓
提交继续
```

任一 Stylelint/ESLint/Prettier 配置错误、运行错误或最终规则错误都会返回非零退出码。
lint-staged 负责恢复备份，保护文件门禁不会在失败状态下运行。

ESLint 无法自动修复时，`eslint-diagnostics` 从结构化结果中提取项目相对路径、
行列、规则和原始错误。每个问题生成一段带编号、可独立复制给 AI 的完整指令，
不输出源代码内容，也不建议关闭规则或扩大忽略范围。

## Pre-push Lighthouse 状态流

```text
git push → Lighthouse 未启用 → 推送继续
              ↓ 已启用
验证 Vue、@lhci/cli、lighthouserc 和 build 脚本
              ↓
npm run build → lhci collect → lhci assert
              ├─ 成功 → 推送继续
              └─ 失败 → 阻止推送
```

Vue Router 页面由业务项目在 `lighthouserc.*` 中显式配置。LHCI 的原始输出写入
`.lighthouseci/`，安装器将其加入受管理的 `.gitignore` 区块。

## 配置维护状态流

```text
旧项目配置 → migrate 补齐缺失默认值 → enable/disable 修改功能 → doctor 验证
                                                       ↑
doctor --fix → 配置迁移 + 托管安装状态修复 ──────────────┘
```

新建配置默认启用 ESLint、Prettier、企业微信通知和 9 条通知级保护规则；只有
本地 Stylelint 和项目配置均存在时才自动启用 Stylelint。通知关闭时
`notify` 规则仍参与保护文件识别和提交信息记录，但 gate 不读取凭据、不发送请求。
迁移只物化旧项目已有的默认行为，不主动开启质量门禁。`doctor --fix` 只修复
repo-guard 可安全拥有的内容；自定义 Hook、其他 hooksPath、已跟踪密钥和业务
依赖仍需人工处理。

## 兼容策略

- 配置格式继续使用 `version: 1`，新增字段均为可选。
- 新项目初始化默认启用 ESLint 和 Prettier，并按已有 Stylelint 安装与配置决定是否启用 Stylelint；已有配置升级时不改变显式或缺省开关行为。
- 缺少 `preCommit` 时按质量门禁未启用处理，保持旧版本行为。
- 缺少 `notification` 时按启用处理，保持旧版本的通知行为。
- Hook 生成版本为 v3，安装器可识别并升级 v1、v2。
- Node.js 最低版本为 18.12.0，与 `lint-staged@15.5.2` 一致。
- Stylelint、ESLint 和 Prettier 是可选 peer dependency；启用门禁时必须由业务项目安装。
- `@lhci/cli` 是可选 peer dependency；Vue Lighthouse 启用时必须由业务项目安装并提供 Chrome。
- Stylelint 不内置规则或语言探测；同一个 Vue 文件出现多种 `<style lang>` 时会在执行前失败。
