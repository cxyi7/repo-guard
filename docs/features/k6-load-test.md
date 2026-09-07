# k6 接口压测

用本机 k6 在确认过的目标和负载范围内运行压测。

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

## 接入与配置

以下主配置片段应合并到 `repo-guard.config.json`；单独标注的文件按指定路径保存。直接编辑配置后运行 `npx repo-guard migrate` 和 `npx repo-guard doctor`。

使用消费项目本机 k6 二进制的并发压测 runner。它与 Axios 性能 runner 互补：Axios runner 验证业务客户端、拦截器和低并发真实调用链；k6 runner 验证服务在受控并发或恒定到达率下的延迟、错误率、检查成功率和丢弃迭代。k6 不是 Node.js 运行时，不能直接加载 Axios 客户端；本功能不修改业务 Axios 实例，也不进入提交、推送、CI、发布、受保护构建或打包流程。

先按 [k6 官方安装说明](https://grafana.com/docs/k6/latest/set-up/install-k6/) 安装本机 k6。当前支持 k6 `1.5.0` 至 `2.x`，不自动安装扩展、不使用 Docker、不调用 k6 cloud，也不上传结果。

消费项目声明 manual-only 外部门禁和两个显式 npm script：

```json
{
  "externalGates": [
    {
      "id": "project.k6-load",
      "enabled": true,
      "environments": ["manual"],
      "script": "test:k6:runner",
      "timeoutMs": 900000,
      "report": {
        "format": "repo-guard-json-v1",
        "path": "reports/k6/k6-gate.json"
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
    "test:k6:runner": "repo-guard k6-runner --gate-id project.k6-load --config test/performance/k6-load.config.json",
    "guard:k6": "repo-guard external project.k6-load"
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段属于 `package.json` 的 `scripts`）：

| 字段 | 用途 | 可填值 | 约束与要求 |
|---|---|---|---|
| `test:k6:runner` | 项目真实的 测试 执行入口 | 字符串，示例为 `repo-guard k6-runner --gate-id project.k6-load --config test/performance/k6-load.config.json` | 保留其他项目脚本；对应依赖与文件需存在，不能用空脚本或吞掉失败状态代替执行 |
| `guard:k6` | 项目真实的 repo-guard 执行入口 | 字符串，示例为 `repo-guard external project.k6-load` | 保留其他项目脚本；对应依赖与文件需存在，不能用空脚本或吞掉失败状态代替执行 |

<!-- config-fields:end -->

`test/performance/k6-load.config.json` 的负载、阈值和目标都由纯 JSON 配置控制。下面示例的确认值必须精确包含“主机、配置档、执行器、最大 VU、总阶段时长和只读模式”：

```json
{
  "$schema": "../../node_modules/@cxyi7/repo-guard/k6-load-config.schema.json",
  "target": {
    "baseUrlEnv": "REPO_GUARD_K6_BASE_URL",
    "allowedHosts": ["api-test.example.com"],
    "confirmationEnv": "REPO_GUARD_K6_CONFIRM",
    "requireHttps": true
  },
  "script": "test/performance/scenarios/read.k6.js",
  "profile": {
    "name": "smoke-read",
    "executor": "ramping-vus",
    "startVUs": 0,
    "stages": [
      {
        "duration": "30s",
        "target": 5
      },
      {
        "duration": "1m",
        "target": 20
      },
      {
        "duration": "30s",
        "target": 0
      }
    ],
    "gracefulRampDown": "30s",
    "gracefulStop": "30s"
  },
  "thresholds": {
    "p95Ms": 500,
    "p99Ms": 1000,
    "errorRate": 0.01,
    "checkRate": 0.99,
    "maxDroppedIterations": 0
  },
  "environment": {
    "pass": ["REPO_GUARD_K6_TEST_TOKEN"]
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
| `target.baseUrlEnv` | 保存测试目标基础 URL 的环境变量名称，不在配置中直接填写凭据 | 字符串<br>本对象内必填，无自动代填值 | 环境变量名使用大写字母、数字和下划线，不能以数字开头；目标必须使用 HTTPS，并在精确主机白名单内。变量名不能为 K6_* 或 REPO_GUARD_K6_RUN_ID。 |
| `target.allowedHosts` | 允许压测的精确主机白名单 | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；元素不可重复；每项为非空字符串；每项：精确主机名，不含通配符、协议、路径或端口；目标必须使用 HTTPS，并在精确主机白名单内。 |
| `target.confirmationEnv` | 保存本次人工确认目标主机的环境变量名称 | 字符串<br>本对象内必填，无自动代填值 | 环境变量名使用大写字母、数字和下划线，不能以数字开头；变量值必须精确绑定主机、配置档、executor、负载规模、时长与 writes/readonly；完整格式见本页执行示例。变量名不能为 K6_* 或 REPO_GUARD_K6_RUN_ID，且与 baseUrlEnv 不同。 |
| `target.requireHttps` | 要求使用 HTTPS 目标，不能关闭 | 只能为 `true`<br>默认：`true` | 目标必须使用 HTTPS，并在精确主机白名单内。 |
| `script` | 由项目维护的 k6 .js 或 .ts 测试入口 | 字符串<br>本对象内必填，无自动代填值 | 仓库相对路径；不能是绝对路径或含 .. 越界，使用 / 分隔；扩展名为 .js 或 .ts；路径相对仓库根目录，不能使用绝对路径、父目录越界或符号链接；模块由项目维护。 |
| `profile.name` | 该压测配置档的稳定小写名称 | 字符串<br>本对象内必填，无自动代填值 | 以小写字母开头，后续仅小写字母、数字、连字符 |
| `profile.executor` | 压力模型；本例为逐步调整虚拟用户数 | `"ramping-vus"` / `"constant-arrival-rate"`；必填，无默认值 | 本例的 startVUs、stages、gracefulRampDown 属于 ramping-vus；另一模型使用下表字段，不能只替换 executor 字符串。 |
| `profile.startVUs` | 逐步加压开始时的虚拟用户数 | 整数<br>默认：`0` | ≥ 0；≤ 1000 |
| `profile.stages` | 逐步加压阶段列表，顺序执行 | 对象数组；对象字段见后续行<br>本对象内必填，无自动代填值 | 至少 1 项；至多 20 项 |
| `profile.stages[].duration` | 当前阶段持续时间 | 字符串<br>本对象内必填，无自动代填值 | 正整数加单位 ms、s、m 或 h，例如 30s；不接受 0、组合时长或小数 |
| `profile.stages[].target` | 当前阶段结束时的目标虚拟用户数 | 整数<br>本对象内必填，无自动代填值 | ≥ 0；≤ 1000 |
| `profile.gracefulRampDown` | 降压时等待当前迭代完成的宽限时间 | 字符串<br>默认：`"30s"` | 正整数加单位 ms、s、m 或 h，例如 30s；不接受 0、组合时长或小数 |
| `profile.gracefulStop` | 整体停止时等待当前迭代完成的宽限时间 | 字符串<br>默认：`"30s"` | 正整数加单位 ms、s、m 或 h，例如 30s；不接受 0、组合时长或小数 |
| `thresholds.p95Ms` | 95 分位请求耗时允许的最大值，单位毫秒 | 数值<br>本对象内必填，无自动代填值 | ≥ 1；≤ 300000 |
| `thresholds.p99Ms` | 99 分位请求耗时允许的最大值，单位毫秒 | 数值<br>本对象内必填，无自动代填值 | ≥ 1；≤ 300000；必须大于或等于 p95Ms。 |
| `thresholds.errorRate` | 允许的最大请求错误比例，0 表示不允许错误，1 表示 100% | 数值<br>本对象内必填，无自动代填值 | ≥ 0；≤ 1 |
| `thresholds.checkRate` | k6 检查通过比例的最低值，0～1 表示 0%～100% | 数值<br>本对象内必填，无自动代填值 | ≥ 0；≤ 1 |
| `thresholds.maxDroppedIterations` | 允许丢弃的迭代数量上限 | 整数<br>默认：`0` | ≥ 0；≤ 1000000 |
| `environment.pass` | 允许传给 k6 子进程的项目环境变量名白名单 | 字符串数组<br>默认：`[]` | 允许空数组；至多 20 项；元素不可重复；每项：环境变量名使用大写字母、数字和下划线，不能以数字开头；不自动透传所有环境变量；禁止 K6_* 与 REPO_GUARD_K6_RUN_ID。 |
| `safety.allowWrites` | 是否允许写入型请求；默认只进行读取型测试 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"；写场景必须有可识别写请求与 teardown 清理，并按本页约束绑定 runId。 |
| `$schema` | 指向本配置的 JSON Schema，为编辑器提供字段校验 | 字符串；示例为包内 Schema 相对路径 | 相对路径按当前配置文件所在目录解析；这不是业务开关 |

<!-- config-fields:end -->

逐步加压的阶段总时长不得超过 1 小时，`startVUs` 与所有阶段目标不能全部为 0；`gracefulRampDown`、`gracefulStop` 分别最多 5 分钟。

选择 `constant-arrival-rate` 时，`profile` 保留 `name`、`executor`，使用以下字段替代逐步加压字段：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `rate` | 每个 timeUnit 启动的迭代数量 | 1～10000 的整数；必填 | 这是迭代启动速率，不是并发用户数 |
| `timeUnit` | 速率的时间单位 | 正整数加 ms/s/m/h；默认 `"1s"` | 最多 1 分钟；不接受 0、小数或组合时长 |
| `duration` | 持续发起迭代的时间 | 正整数加 ms/s/m/h；必填 | 最多 1 小时，需与外部门禁超时配合 |
| `preAllocatedVUs` | 预先分配的虚拟用户数 | 1～1000 的整数；必填 | 不得大于 maxVUs |
| `maxVUs` | 虚拟用户数量上限 | 1～1000 的整数；必填 | 须纳入人工确认字符串；资源不足会导致迭代丢弃 |
| `gracefulStop` | 停止后等待当前迭代完成的宽限时间 | 正整数加 ms/s/m/h；默认 `"30s"` | 最多 5 分钟；外部门禁超时需覆盖此时间 |

场景必须默认导出函数、直接从 `__ENV` 读取受控基础地址，并至少产生一次 HTTP 请求和一次 `check`：

```js
import http from 'k6/http';
import { check } from 'k6';

const baseURL = __ENV.REPO_GUARD_K6_BASE_URL;

export default function readScenario() {
  const response = http.get(`${baseURL}/health`, {
    headers: { Authorization: `Bearer ${__ENV.REPO_GUARD_K6_TEST_TOKEN}` },
  });
  check(response, { '状态码为 200': (value) => value.status === 200 });
}
```

```powershell
$env:REPO_GUARD_K6_BASE_URL = 'https://api-test.example.com/'
$env:REPO_GUARD_K6_CONFIRM = 'api-test.example.com:smoke-read:ramping-vus:20vus:120s:readonly'
$env:REPO_GUARD_K6_TEST_TOKEN = '<仅用于测试环境的临时凭据>'
npm run guard:k6
```

受控入口会覆盖消费者脚本的 `options` 和 `handleSummary`，所以场景不得导出这两个名称。所有阈值与报告指标都绑定当前 `scenario`，只统计正式压测迭代，不让 `setup`/`teardown` 的登录、造数和清理请求污染 p95、p99、错误率、检查率或请求量。为保留这些场景子指标，runner 不启用 k6 可选的新机器摘要格式，而是校验受控 `handleSummary` 写出的聚合指标对象。入口关闭 k6 使用情况上报和自动扩展解析，先运行 `k6 inspect`，再运行本地 `k6 run`；子进程只接收操作系统启动所需变量、`environment.pass` 白名单、基础地址和本次随机 `runId`。脚本只能导入仓库内相对模块和 k6 内置模块，不得使用远程模块、`k6/x/*`、硬编码 HTTP 地址、动态请求方法或转存 `k6/http` 绑定。

默认仅允许 `GET`、`HEAD` 和 `OPTIONS`。启用 `safety.allowWrites` 后，脚本必须包含可静态识别的写方法、导出 `teardown`，并在 teardown 中使用 `__ENV.REPO_GUARD_K6_RUN_ID` 发出可静态验证的直接清理请求；进程被强制终止时 teardown 仍无法保证执行，因此写压测还必须使用测试账号、幂等或可过期数据，并由服务端提供兜底清理。`externalGates.timeoutMs` 至少覆盖负载时长、`gracefulStop`、setup、teardown 和 30 秒进程余量。

通过时退出码为 `0`；k6 阈值失败的原始退出码必须为 `99`，runner 生成 `violation` 后对外返回 `2`；其他退出码、超时、报告缺失或判定不一致均返回 `1`，且不生成可误用的主报告。报告目录必须位于已忽略、未跟踪且不穿过符号链接的 `reports/`，成功执行会保留 k6 机器摘要 `k6-summary.json`、中文 `k6-report.html` 和外部门禁 JSON；报告不会保存配置中的凭据。

## 执行与复核

执行入口：只允许显式本地手动执行。功能开关、CI 模式与具体文件范围仍按上文配置生效。

检查失败时按报告中的规则、位置与证据修复；区分工具/配置错误和真实违规。修改源码后重新暂存，修改配置后同步托管文件，再使用相同入口复核。需要人工确认、基线维护或发布证据时，按本页对应流程完成。

[实现入口](../../src/gates/testing/k6-external-runner.js) · [对应测试](../../test/k6-load.test.js)
