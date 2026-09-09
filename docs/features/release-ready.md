# 发布就绪检查

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

在交付决策前执行项目已配置的工程检查、测试和构建；启用交付合同时，再复核本轮证据。前端与 Node 后端使用同一套质量流程，具体工具和文件范围由各自预设及 `checks` 指定。

## 准备与运行

先完成 [CI 接入](gitlab-ci.md)，准备可信 Git 变更范围，并明确启用要验证的能力。下面是合并到现有 v2 单应用配置的片段：

```json
{
  "checks": {
    "unitTest": {
      "enabled": true,
      "script": "test:unit"
    },
    "typeCheck": {
      "enabled": true,
      "script": "typecheck"
    },
    "build": {
      "enabled": true,
      "script": "build"
    }
  },
  "ci": {
    "enabled": true,
    "profile": "release-ready"
  }
}
```

<!-- config-fields:start -->
**字段说明**：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.unitTest.enabled` | 执行真实单元测试 | 布尔值，默认 `false` | 必须准备受支持的测试运行器；当前为 Vitest，不会自动安装 |
| `checks.unitTest.script` | 项目测试入口 | npm 脚本名，默认 `test:unit` | 脚本必须存在并执行真实测试，不能用成功占位命令代替 |
| `checks.typeCheck.enabled` | 执行类型检查 | 布尔值，默认 `false` | 依赖项目已有类型工具与配置，不进入 pre-commit |
| `checks.typeCheck.script` | 类型检查入口 | npm 脚本名，默认 `typecheck` | 必须指向应用自身脚本 |
| `checks.build.enabled` | 执行构建验证 | 布尔值，默认 `false` | 使用项目真实构建脚本；构建失败阻断 |
| `checks.build.script` | 应用构建入口 | npm 脚本名，默认 `build` | 保留项目自己的构建工具与产物配置 |
| `ci.enabled` | 允许执行 CI 质量门禁 | 布尔值，默认 `false` | 多应用时只在仓库根配置 |
| `ci.profile` | 选择执行档 | `policy` / `full` / `release-ready`，默认 `policy` | 本例选择交付前完整复核，不开启发布或部署 |

<!-- config-fields:end -->

多应用仓库的 `checks` 分别写入子应用配置，`ci` 写入仓库根配置。执行：

```bash
npx repo-guard ci --profile release-ready --base <sha> --head <sha>
npx repo-guard ci --profile release-ready --project api --base <sha> --head <sha>
```

## 检查顺序

仓库公共规则 → 各应用的完整工程检查、测试和构建 → 适用且启用的 Lighthouse 与外部门禁 → 最终交付证据复核。

配置 v2 的发布就绪包含 `full` 的检查步骤。代码格式检查只读，真实测试和构建可以生成报告与产物。未开启的功能按配置跳过，后端项目不执行 Vue 专用规则；`skipped` 不能当作已经测试通过。

应用无需成为可发布的 npm 包，也不必提供固定的 `check`、`test`、`pack:check` 脚本。检查使用 `checks` 中声明的入口。npm 包自身的发布验证应在独立运维流程配置；维护者内部旧门禁契约仍保留旧包检查实现，但磁盘配置版本 1 必须显式迁移后使用。

## 多应用证据与结果

多应用的公共仓库规则只执行一次，各应用独立执行并保存报告。最后的交付证据步骤使用本轮全部目标的结果，不会让后执行应用的成功覆盖先前应用的失败。

聚合报告位于根目录 `ci.reportPath`；应用报告位于各自目录的 `reports/repo-guard-workspace/projects/<项目 id>.json`，交付证据报告位于根目录 `reports/repo-guard-workspace/evidence.json`。每个目标包含 `projectId`、`projectRoot`、检查范围和退出码。

同名门禁在多个目标执行时，聚合结果保留最严重状态及每个目标的结果指纹。交付合同的证据应绑定聚合报告中的 `gateResults`；原始应用报告仍保留，便于定位与复测。`--project` 只证明被选择应用及公共仓库的结果，不表示整个仓库的全部应用通过。

关闭交付合同仍可执行工程质量验证。开启后按[统一交付手册](delivery-contract.md#交付证据与两轮复核)完成技术结果采集、人工验收、证据元数据提交与最终复核。首次运行末尾证据检查尚未完成时，不能把前序通过报告成整体通过。

代码、定义、目标基线或 GateResult 变化会使旧证据失效。失败后修复并重新运行，不通过删除用例、降低阈值或手工改报告获得通过。

此命令只输出质量与证据结论，不上传 npm 包或部署应用。发布权限、环境与应用产物由[独立运维模块](managed-delivery-pipeline.md)管理。

## 维护依据

[执行计划](../../src/orchestration/execution-plans.js) · [工作区 CI 调度](../../src/orchestration/ci/workspace-runner.js) · [对应测试](../../test/ci/workspace-ci.test.js)
