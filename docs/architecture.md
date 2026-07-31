# 架构说明

## 职责边界

```text
业务项目
├─ repo-guard.config.json       项目级保护和 ESLint 门禁开关
├─ ESLint + 项目 ESLint 配置    语法及代码规则
└─ @cxyi7/repo-guard
   ├─ lint-staged              暂存内容隔离、写回和失败恢复
   ├─ eslint-runner            检查、修复、复检
   ├─ protected-file gate      规则、指纹和通知
   └─ hook installer           Hook 生命周期
```

repo-guard 负责流程编排，不拥有业务项目的 ESLint 规则。项目负责选择 ESLint
版本、插件、解析器和忽略范围。

## Pre-commit 状态流

```text
开始
  ↓
读取并校验项目配置
  ↓
ESLint 未启用 ───────────────┐
  ↓ 已启用                  │
lint-staged 备份 Git 状态    │
  ↓                         │
隐藏部分暂存文件的未暂存内容 │
  ↓                         │
检查 → 修复 → 复检          │
  ↓ 成功                    │
写回暂存区并恢复未暂存内容   │
  └─────────────────────────┘
  ↓
保护文件门禁
  ↓
提交继续
```

任一 ESLint 配置错误、运行错误或最终规则错误都会返回非零退出码。lint-staged
负责恢复备份，保护文件门禁不会在失败状态下运行。

## 兼容策略

- 配置格式继续使用 `version: 1`，新增字段均为可选。
- 缺少 `preCommit` 时按 ESLint 未启用处理，保持 0.2.0 行为。
- Hook 生成版本为 v2，安装器可识别并升级 v1。
- Node.js 最低版本为 18.12.0，与 `lint-staged@15.5.2` 一致。
- ESLint 是可选 peer dependency；启用门禁时必须由业务项目安装。
