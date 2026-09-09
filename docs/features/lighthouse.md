# Lighthouse

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

对 Vue 项目的页面进行 Lighthouse CI 采集和断言。使用项目自己的 `@lhci/cli`、Chrome、页面路由与配置，只在本地保存报告。

## 接入与配置

项目必须在 `package.json` 中声明 `vue`，安装兼容的 `@lhci/cli`（包声明范围为 `>=0.13 <0.16`），准备 Chrome、实际构建脚本和可访问的页面。初始化默认关闭此能力。

```bash
npm install --save-dev --save-exact "@lhci/cli@>=0.13 <0.16"
```

以下 `lighthouserc.json` 假定项目已经提供 `preview` 脚本，并在指定端口启动生产预览；URL 和阈值需换成团队实际要求：

```json
{
  "ci": {
    "collect": {
      "startServerCommand": "npm run preview -- --host 127.0.0.1 --port 4173",
      "url": ["http://127.0.0.1:4173/"],
      "numberOfRuns": 3
    },
    "assert": {
      "assertions": {
        "categories:performance": [
          "error",
          {
            "minScore": 0.9
          }
        ]
      }
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（属于 `lighthouserc.json`，由项目 Lighthouse CI 读取）：

| 字段 | 用途 | 可填值 | 约束与要求 |
|---|---|---|---|
| `ci.collect.startServerCommand` | 启动待测应用预览服务 | 项目可执行的服务启动命令 | 与下面 URL 的主机和端口一致；这是 Lighthouse CI 的命令字段，不是 repo-guard 的 script 名称字段 |
| `ci.collect.url` | 要采集的真实页面 | 完整 URL 的字符串数组 | 每项需能由当前 Chrome 环境访问；填业务路由，不用不存在的示例页面 |
| `ci.collect.numberOfRuns` | 每个 URL 的采集次数 | 正整数；示例为 3 | 多次采集增加时间，需与服务和超时设置配合 |
| `ci.assert.assertions.categories:performance` | 对 Lighthouse 性能分类设置断言 | `[级别, 断言对象]` | 级别为 `off`、`warn` 或 `error`；本例 error 表示不达标即失败 |
| `ci.assert.assertions.categories:performance[1].minScore` | 性能最低分 | 0～1 的数值；本例 0.9 表示 90 分 | 示例阈值是团队选择，不是 repo-guard 默认值；其他审计项按项目 LHCI 配置维护 |

<!-- config-fields:end -->

`repo-guard.config.json` 配置片段：

```json
{
  "checks": {
    "lighthouse": {
      "enabled": true,
      "configFile": "lighthouserc.json",
      "buildScript": "build",
      "timeoutMs": 300000
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.lighthouse.enabled` | 是否启用自动 Lighthouse 检查 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"；手动 lighthouse 可在该值为 false 时显式检查。 |
| `checks.lighthouse.configFile` | 项目 Lighthouse CI 配置位置；null 使用标准文件名探测 | 字符串 / null<br>默认：`null` | 非 null 时：至少 1 个字符 |
| `checks.lighthouse.buildScript` | 采集前的项目 npm 构建脚本；null 表示跳过该构建步骤 | 字符串 / null<br>默认：`"build"` | 非 null 时：至少 1 个字符；与已启用 build.script 同名时跳过内部构建；手动执行前确认产物来自本轮。 |
| `checks.lighthouse.timeoutMs` | 分别应用到构建、collect、assert 进程的超时，单位毫秒 | 整数<br>默认：`300000` | ≥ 1 |

<!-- config-fields:end -->

```bash
npx repo-guard enable lighthouse
npx repo-guard doctor
npx repo-guard lighthouse
```

已有本轮有效构建产物时，可显式执行 `npx repo-guard lighthouse --skip-build`。命令只跳过构建，不跳过页面采集和断言；构建脚本等项目设置仍需符合配置要求。

## 执行与修复

手动、可选 pre-push 和 `release-ready` 可执行，不进入 pre-commit 或 CI `full`。手动 `lighthouse` 会显式运行检查，即使自动检查开关关闭。

当前实现只要发现 `checks.build.enabled: true` 且 `checks.lighthouse.buildScript` 与 `checks.build.script` 相同，就会跳过 Lighthouse 内部的构建阶段，这也适用于手动命令。因此手动复测时应先执行 `npx repo-guard build` 生成本轮产物，再运行 Lighthouse；不能仅凭自动跳过构建就认为现有产物已经最新。

报告保存到 `.lighthouseci/`。repo-guard 调用 `collect` 和 `assert`，不隐式执行上传。采集失败时检查 Chrome、预览服务和 URL；断言失败时查看实际页面报告，修复性能或其他未达标项后复测。

源码：[Lighthouse 门禁](../../src/gates/quality/lighthouse-gate.js)。测试：[Lighthouse](../../test/gates/quality/lighthouse.test.js)。
