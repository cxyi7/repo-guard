# 发布就绪检查

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

在发布决策前复核项目质量、构建和包一致性，并在启用合同时确认本轮交付证据。

## 准备与运行

先完成[CI 接入](gitlab-ci.md)，准备真实 `check`、`test` 脚本和可验证的 Git 范围。包检查脚本必须为下列精确内容：

```json
{
  "scripts": {
    "pack:check": "npm pack --dry-run --json --ignore-scripts"
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段属于 `package.json` 的 `scripts`）：

| 字段 | 用途 | 可填值 | 约束与要求 |
|---|---|---|---|
| `pack:check` | 发布前预览 npm 打包内容 | 字符串，示例为 `npm pack --dry-run --json --ignore-scripts` | 必须使用示例中的精确脚本，禁止额外生命周期执行 |

<!-- config-fields:end -->

保留项目原有 scripts，并确保 `check`、`test` 执行真实校验。运行：

```bash
npx repo-guard ci --profile release-ready
```

## 检查顺序

仓库策略 → 无效图片（启用时）→ 项目 `check` → 项目 `test` → 构建（启用时）→ Lighthouse（启用时）→ npm 包准备检查 → 适用的项目外部门禁 → 交付证据（启用时）。

`release-ready` 不是 `full` 的超集：它不单独重跑 TypeScript、Knip、完整单元测试/覆盖率、axe 和架构步骤；所需验证应由项目 `check` / `test` 明确包含。项目脚本、包版本与锁文件、打包清单等必须满足就绪规则，受跟踪工作区需保持干净。

## 证据与结果

关闭交付合同仍可执行常规发布准备。开启后按[统一交付手册](delivery-contract.md#交付证据与两轮复核)完成首次技术结果采集、人工验收、证据元数据提交与最终复核。首次运行末尾证据检查尚未完成时，不能把前序通过报告成整体通过。

失败后根据具体步骤修复并重新运行。验收后的代码、定义、目标基线或 GateResult 变化会使旧证据失效，需要重建并重新确认。

通过输出就绪结论，实际发布由团队决定和执行；此命令不上传 npm 包，也不部署应用。应用部署另见[托管交付流水线](managed-delivery-pipeline.md)。

## 维护依据

[实现入口](../../src/gates/release/package-readiness.js) · [对应测试](../../test/release-ready.test.js)
