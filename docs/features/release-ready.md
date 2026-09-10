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

多应用仓库的 `checks` 分别写入子应用配置；`ci.enabled / profile / reportPath` 写入仓库根配置，本方 `ci.protectedFiles / gatePolicy / externalGates` 写入应用配置。执行：

```bash
npx repo-guard ci --profile release-ready --base <sha> --head <sha>
npx repo-guard ci --profile release-ready --project api --base <sha> --head <sha>
```

## 检查顺序

不传 `--project` 时，`release-ready` 复核清单中全部应用；这与普通 `policy / full` 按变更选择受影响应用不同。指定应用时只加载本方工程配置并复核公共规则，未选择应用不会显示为通过。

仓库公共规则 → 各应用的完整工程检查、测试和构建 → 适用且启用的 Lighthouse 与外部门禁 → 最终交付证据复核。

发布就绪只有一套执行计划，包含 `full` 的检查步骤，再加入 Lighthouse、适用外部门禁和最终证据复核；不再按配置历史选择另一套计划。代码格式检查只读，真实测试和构建可以生成报告与产物。未开启的功能按配置跳过，后端项目不执行 Vue 专用规则；`skipped` 不能当作已经测试通过。

应用无需成为可发布的 npm 包，也不必提供固定的 `check`、`test`、`pack:check` 脚本。检查使用 `checks` 中声明的入口。旧 `release.check / release.test / release.package` 已移除；团队如需额外检查，可注册 `project.*` 外部门禁。repo-guard 本仓库的 npm 发布验证由维护者发布 Skill 管理，不属于消费项目的默认检查。

## 多应用证据与结果

多应用的公共仓库规则只执行一次，各应用独立执行并保存报告。最后的交付证据步骤使用本轮全部目标的结果，不会让后执行应用的成功覆盖先前应用的失败。

聚合报告位于根目录 `ci.reportPath`；应用报告位于各自目录的 `reports/repo-guard-workspace/projects/<项目 id>.json`，交付证据报告位于根目录 `reports/repo-guard-workspace/evidence.json`。每个目标包含 `projectId`、`projectRoot`、检查范围和退出码。以上报告及错误报告统一使用 `version: 2`，内部 `GateResult` 使用 `schemaVersion: 2`；写入和汇总拒绝旧报告，需重新运行生成当前结果。

同名门禁在多个目标执行时，`gateResults` 保留最严重状态及各目标的结果指纹，`scopedGateResults` 另外保留具体应用来源。仓库内合同包的 Evidence Run 使用聚合结果；独立合同为对应参与方记录签名证据，不能把前端同名 Gate 的通过当作后端通过。原始应用报告继续保留，便于定位与复测。

关闭交付合同仍可执行工程质量验证。仓库内合同包按[两轮复核](delivery-contract.md#交付证据与两轮复核)完成技术结果采集、人工验收、证据元数据提交与最终复核。独立合同按[跨仓交付流程](delivery-contract.md#执行联调与验收)收集各方签名证据、针对明确版本组合执行联合检查，再由人签署验收。两个入口不能在同一仓库同时启用。

独立合同的检查必须实际通过，`skipped` 或禁用不能满足必需项；所有参与方及联合验证、人工验收未齐全时，前端自己的工程检查通过也不表示整体交付完成。验收绑定本轮收集的合同与代码版本组合；本机复核不自动获知未同步的远端提交。

代码、合同定义或目标基线变化会使旧证据失效。独立合同在普通 `ci full` 中收集新证据，人工验收后使用 `release-ready` 复核；已有通过证据不因复核耗时变化被覆盖，本轮详细结果另存 CI 报告。失败、关闭或跳过必需检查会在最终证据检查前更新失败状态，观察模式不能使交付通过。仓库内合同包继续按其技术与执行指纹规则复核。失败后修复并重新运行，不通过删除用例、降低阈值或手工改报告获得通过。

此命令只输出质量与证据结论，不上传 npm 包或部署应用。发布权限、环境与应用产物由[独立运维模块](managed-delivery-pipeline.md)管理。

## 维护依据

[执行计划](../../src/orchestration/execution-plans.js) · [工作区 CI 调度](../../src/orchestration/ci/workspace-runner.js) · [对应测试](../../test/ci/workspace-ci.test.js)
