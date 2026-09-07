# Axios 接口性能

复用业务 Axios 客户端验证真实调用链与性能阈值。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑配置后运行 `npx repo-guard migrate` 和 `npx repo-guard doctor`。

提供外部门禁专用的 Axios 性能 runner。它不是官方 Gate，不进入 Registry 固定计划；只有消费项目显式执行 `npx repo-guard external project.api-performance` 时，现有外部门禁才会调用项目精确 npm script。runner 同时要求 `environments` 只能是 `["manual"]`，并拒绝在带有常见 CI、GitLab CI、GitHub Actions、Azure Pipelines 或 Jenkins 环境标记的进程中运行。

消费项目配置：

```json
{
  "externalGates": [
    {
      "id": "project.api-performance",
      "enabled": true,
      "environments": ["manual"],
      "script": "test:api-performance:runner",
      "timeoutMs": 300000,
      "report": {
        "format": "repo-guard-json-v1",
        "path": "reports/api-performance/axios-gate.json"
      }
    }
  ]
}
```

<!-- config-fields:start -->
**字段说明**：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `externalGates` | 项目自有检查的注册列表；每项声明一个门禁 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `externalGates[].id` | 项目门禁唯一 ID，使用 project. 加小写连字符名称 | 字符串<br>本对象内必填，无自动代填值 | 必须使用 project. 前缀，后接小写字母开头的小写字母/数字/连字符名称 |
| `externalGates[].enabled` | 是否启用该项目门禁 | `true` / `false`<br>本对象内必填，无自动代填值 | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `externalGates[].environments` | 允许执行的入口；manual 为手动，ci-full 为完整 CI，release-ready 为发布准备 | 数组；每项可选 `"manual"`、`"ci-full"`、`"release-ready"`<br>本对象内必填，无自动代填值 | 至少 1 项；元素不可重复；CI 仅在受信任 GitLab 受保护分支调度；Axios/k6 runner 进一步只允许 manual。 |
| `externalGates[].script` | 项目 package.json 中的精确脚本名，不是 shell 命令 | 字符串<br>本对象内必填，无自动代填值 | 仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `externalGates[].timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>本对象内必填，无自动代填值 | ≥ 1000；≤ 1800000 |
| `externalGates[].report.format` | 项目脚本输出的报告协议 | 只能为 `"repo-guard-json-v1"`<br>本对象内必填，无自动代填值 | 只接受列出的值 |
| `externalGates[].report.path` | 本轮新生成的外部门禁 JSON 报告路径 | 字符串<br>本对象内必填，无自动代填值 | 仓库内 reports/ 路径；使用 / 分隔，禁止父目录越界、反斜线和平台保留名，以 .json 结尾；必须在 reports/ 内、未跟踪、无符号链接、每轮新生成；命名不能使用平台保留名。 |

<!-- config-fields:end -->

```json
{
  "scripts": {
    "test:api-performance:runner": "repo-guard api-performance-runner --gate-id project.api-performance --config test/performance/api-performance.config.json",
    "guard:api-performance": "repo-guard external project.api-performance"
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段属于 `package.json` 的 `scripts`）：

| 字段 | 用途 | 可填值 | 约束与要求 |
|---|---|---|---|
| `test:api-performance:runner` | 项目真实的 测试 执行入口 | 字符串，示例为 `repo-guard api-performance-runner --gate-id project.api-performance --config test/performance/api-performance.config.json` | 保留其他项目脚本；对应依赖与文件需存在，不能用空脚本或吞掉失败状态代替执行 |
| `guard:api-performance` | 项目真实的 repo-guard 执行入口 | 字符串，示例为 `repo-guard external project.api-performance` | 保留其他项目脚本；对应依赖与文件需存在，不能用空脚本或吞掉失败状态代替执行 |

<!-- config-fields:end -->

`test/performance/api-performance.config.json`：

```json
{
  "$schema": "../../node_modules/@cxyi7/repo-guard/api-performance-config.schema.json",
  "target": {
    "baseUrlEnv": "REPO_GUARD_PERF_BASE_URL",
    "allowedHosts": ["api-test.example.com"],
    "confirmationEnv": "REPO_GUARD_PERF_CONFIRM_HOST"
  },
  "client": {
    "module": "test/performance/axios-client.mjs"
  },
  "scenarios": ["test/performance/scenarios/current-user.perf.mjs"],
  "execution": {
    "warmupIterations": 2,
    "iterations": 20,
    "concurrency": 1
  },
  "thresholds": {
    "p95Ms": 500,
    "p99Ms": 1000,
    "errorRate": 0
  },
  "safety": {
    "allowWrites": false
  }
}
```

<!-- config-fields:start -->
**字段说明**：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `target.baseUrlEnv` | 保存测试目标基础 URL 的环境变量名称，不在配置中直接填写凭据 | 字符串<br>本对象内必填，无自动代填值 | 环境变量名使用大写字母、数字和下划线，不能以数字开头；目标必须是已确认的测试环境；基础 URL 必须为 HTTPS，确认变量的值须与当前目标主机精确一致。 |
| `target.allowedHosts` | 允许压测的精确主机白名单 | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；元素不可重复；每项为非空字符串；每项：精确主机名，不含通配符、协议、路径或端口；目标必须是已确认的测试环境；基础 URL 必须为 HTTPS，确认变量的值须与当前目标主机精确一致。 |
| `target.confirmationEnv` | 保存本次人工确认目标主机的环境变量名称 | 字符串<br>本对象内必填，无自动代填值 | 环境变量名使用大写字母、数字和下划线，不能以数字开头；目标必须是已确认的测试环境；基础 URL 必须为 HTTPS，确认变量的值须与当前目标主机精确一致。 |
| `client.module` | 导出 createPerformanceClient 的项目 .mjs 工厂模块 | 字符串<br>本对象内必填，无自动代填值 | 仓库相对路径；不能是绝对路径或含 .. 越界，使用 / 分隔；扩展名为 .mjs；路径相对仓库根目录，不能使用绝对路径、父目录越界或符号链接；模块由项目维护。 |
| `scenarios` | 实际执行的性能场景模块路径列表 | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；至多 100 项；元素不可重复；每项：仓库相对路径；不能是绝对路径或含 .. 越界，使用 / 分隔；扩展名为 .mjs；路径相对仓库根目录，不能使用绝对路径、父目录越界或符号链接；模块由项目维护。 |
| `execution.warmupIterations` | 正式计时前每个场景的预热次数 | 整数<br>默认：`2` | ≥ 1；≤ 20 |
| `execution.iterations` | 每个场景的正式执行次数 | 整数<br>默认：`10` | ≥ 10；≤ 10000 |
| `execution.concurrency` | 并行执行数量的上限 | 整数<br>默认：`1` | ≥ 1；≤ 5 |
| `thresholds.p95Ms` | 95 分位请求耗时允许的最大值，单位毫秒 | 数值<br>本对象内必填，无自动代填值 | ≥ 1；≤ 300000 |
| `thresholds.p99Ms` | 99 分位请求耗时允许的最大值，单位毫秒 | 数值<br>本对象内必填，无自动代填值 | ≥ 1；≤ 300000；必须大于或等于 p95Ms。 |
| `thresholds.errorRate` | 允许的最大请求错误比例，0 表示不允许错误，1 表示 100% | 数值<br>本对象内必填，无自动代填值 | ≥ 0；≤ 1 |
| `safety.allowWrites` | 是否允许写入型请求；默认只进行读取型测试 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"；Axios 写场景还需场景 allowWrites=true 和 cleanup；只读场景不得填写场景 allowWrites。 |
| `$schema` | 指向本配置的 JSON Schema，为编辑器提供字段校验 | 字符串；示例为包内 Schema 相对路径 | 相对路径按当前配置文件所在目录解析；这不是业务开关 |

<!-- config-fields:end -->

项目提供 Node.js 可加载的客户端工厂，以复用业务 Axios 工厂、拦截器、Token 注入和错误处理；repo-guard 不安装第二份 Axios，也不修改生产实例：

```js
import { createRequestClient } from '../../src/api/request-factory.js';

export function createPerformanceClient({ baseURL }) {
  return createRequestClient({
    baseURL, // runner 校验后的 HTTPS 基础地址；不要改成生产地址
    getToken: () => process.env.REPO_GUARD_PERF_TOKEN, // 示例项目工厂的取 Token 函数，从测试环境变量读取
  });
}
```

场景模块只提供稳定标签和真实调用，标签不得包含查询参数或凭据：

```js
export default {
  name: '查询当前用户', // 必填、非空的场景名称，最多 100 个字符
  method: 'GET', // 必填；GET / HEAD / OPTIONS；写请求的额外条件见下文
  pathLabel: '/user/current', // 必填，以 / 开头、最多 200 字符；不得含查询、片段、空白或凭据
  async run({ client }) { // 必填函数，使用工厂返回的客户端执行真实请求；失败应抛出错误
    await client.get('/user/current');
  },
};
```

执行前必须显式确认目标：

```powershell
$env:REPO_GUARD_PERF_BASE_URL = 'https://api-test.example.com/'
$env:REPO_GUARD_PERF_CONFIRM_HOST = 'api-test.example.com'
$env:REPO_GUARD_PERF_TOKEN = '<仅用于测试环境的临时凭据>'
npm run guard:api-performance
```

runner 只接受 HTTPS、精确主机白名单和本次确认值。默认只允许 `GET`、`HEAD`、`OPTIONS`；`POST`、`PUT`、`PATCH`、`DELETE` 必须同时启用全局 `safety.allowWrites`、场景 `allowWrites: true` 并提供 `cleanup`。清理失败、预热失败、配置错误或报告错误使用退出码 `1` 且不生成主报告；阈值不满足生成 `violation` 报告并使用退出码 `2`；通过使用退出码 `0`。报告目录必须被 `.gitignore` 忽略，最终生成协议 JSON 和 `axios-report.html` 中文报告，二者仍由通用外部门禁执行新鲜度、路径、Git 跟踪状态和敏感信息复检。

## 执行与复核

执行入口：只允许显式本地手动执行。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/testing/api-performance-external-runner.js)
