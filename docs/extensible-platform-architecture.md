# 可扩展单包平台架构

## 1. 文档目的

本文定义 `@cxyi7/repo-guard` 从 Git 提交门禁演进为前端研发质量平台时的长期结构。目标是在继续只发布一个 npm 包的前提下，同时承载以下能力：

- 浏览器请求运行时和可复用业务 API；
- 单元、接口、页面、可访问性和性能测试；
- 静态代码、依赖、架构和请求边界治理；
- Git Hook、GitLab CI、报告和外部工具编排；
- 后续新增的视觉回归、OpenAPI、包体积、SSE、WebSocket 等能力。

“单包”只代表统一安装、版本和发布，不代表所有代码可以互相依赖。浏览器运行时、测试工具、静态门禁和交付编排必须保持明确边界，避免 Node.js、Git、Playwright 或 Lighthouse 代码进入前端生产产物。

本文是目标架构，不表示列出的新增模块已经实现。当前实现细节仍以 [architecture.md](./architecture.md) 为准。

## 2. 当前能力基线

截至 `0.15.0`，项目已经具备四类基础能力。

### 2.1 安装、配置与交付编排

- `init`、`migrate`、`enable`、`disable` 和 `doctor`；
- 配置校验、迁移、JSON Schema 和项目脚本维护；
- 五个受管理 Git Hook、pre-commit 和 pre-push；
- GitLab CI `policy`、`full` profile、托管模板和 JSON 报告；
- 结构化例外、保护文件、企业微信备案和 AI 修复指令。

### 2.2 静态质量与安全门禁

- 暂存文件 Stylelint、ESLint 和 Prettier；
- 样式复杂度、样式治理、文件归位和最大文件行数；
- 依赖声明治理和 dependency-cruiser 架构检查；
- 动态代码执行、Vue `v-html`、`target="_blank"`；
- Vue 原生表单 label 和图片 alt。

### 2.3 动态验证能力

- 业务项目 TypeScript 脚本；
- Vitest 单元测试、测试映射和 Vue 交互语义；
- 全局覆盖率和 Git 变更行覆盖率；
- axe 组件或 E2E 可访问性测试；
- 项目生产构建；
- Vue Lighthouse 的 Chrome、路由和 assertions。

### 2.4 当前尚未形成的能力

- 统一浏览器请求客户端；
- 可复用业务 API SDK；
- 接口响应 Schema 和业务协议契约测试；
- 真实接口响应速度采样与预算门禁；
- 页面业务流程 E2E 测试；
- 页面操作、接口调用和性能结果的关联报告；
- 可注册的新能力模块协议。

接口测试和页面测试应扩展现有动态验证能力，而不是建立一套与 Vitest、axe、Lighthouse、doctor 和 CI 无关的旁路系统。

## 3. 总体结构

项目采用“一个发布单元、四个能力平面、多个受控入口”的模块化单体结构。

四个能力平面分别是运行时、动态测试、质量门禁和流程编排；`platform` 是它们共享的基础层，`integrations` 是对外适配层，不作为独立业务能力平面。

```text
@cxyi7/repo-guard
│
├─ platform/                  跨领域公共基础设施
│  ├─ config/                 配置加载、迁移、Schema 和归一化
│  ├─ execution/              进程、超时、取消和并发控制
│  ├─ report/                 统一 finding、结果和报告模型
│  ├─ project/                项目发现、路径和依赖解析
│  └─ errors/                 标准错误与退出码
│
├─ runtime/                   可进入浏览器生产构建
│  ├─ request/                通用请求客户端
│  ├─ contracts/              接口契约定义
│  └─ sdk/                    可复用业务 API
│
├─ testing/                   动态测试能力
│  ├─ unit/                   Vitest 和测试策略
│  ├─ coverage/               全局与变更行覆盖率
│  ├─ accessibility/          axe
│  ├─ lighthouse/             Lighthouse CI
│  ├─ api/                    真实接口契约测试
│  ├─ page/                   页面业务流程测试
│  ├─ performance/            采样、统计和性能预算
│  └─ fixtures/               Fake Adapter、fixture 和测试环境
│
├─ gates/                     静态门禁
│  ├─ protected-files/
│  ├─ quality/
│  ├─ security/
│  ├─ vue/
│  ├─ dependencies/
│  ├─ architecture/
│  └─ request-boundary/
│
├─ orchestration/             生命周期编排
│  ├─ cli/
│  ├─ hooks/
│  ├─ pre-commit/
│  ├─ pre-push/
│  └─ ci/
│
└─ integrations/              消费项目工具适配器
   ├─ gitlab/
   ├─ axios/
   ├─ vitest/
   ├─ playwright/
   ├─ axe/
   └─ lighthouse/
```

目录迁移应按功能开发逐步完成，不为追求目录形式一次性移动全部现有文件。

## 4. 硬性依赖边界

```text
业务生产代码 ─────▶ runtime/request ─────▶ integrations/axios
       │                    │
       └────────────▶ runtime/sdk ───────▶ runtime/contracts

测试文件 ─────────▶ testing ─────────────▶ runtime/contracts
                         │
                         └───────────────▶ runtime/request

gates ──────────────────────────────────▶ platform
testing ─────────────────────────────────▶ platform
orchestration ─────▶ gates + testing ───▶ platform
```

必须遵守以下约束：

1. `runtime/**` 不能导入 `node:fs`、`node:child_process`、Git、CLI、Hook 或 CI 模块。
2. `runtime/**` 不能导入 Playwright、Lighthouse、Vitest、axe、ESLint 或 Stylelint。
3. `runtime/request` 不能依赖 Vue、Pinia、Ant Design Vue、localStorage 或特定环境变量。
4. Token、租户、社区、退出登录、UI 提示和监控通过消费项目注入。
5. `testing/**` 可以使用 runtime 公共入口，但不能深层导入其内部实现。
6. `orchestration/**` 只负责发现、调度、退出码和报告，不重复实现各能力规则。
7. 每个外部工具适配器使用消费项目已安装的工具、配置和运行环境。

## 5. 请求、契约与业务 API

### 5.1 Request Engine

`runtime/request` 提供框架无关的请求机制：

- `createRequestClient` 和多服务 Client；
- Axios Adapter；
- Token 注入、超时、AbortSignal、取消和查询去重；
- 受约束的幂等重试；
- 响应协议解析和标准错误；
- FormData 上传、Blob 下载和文件名解析；
- 加密、请求 ID、监控和脱敏插件；
- 域名与敏感 Header 策略。

它不应该知道员工、停车或物业接口，也不能把 Ant Design Vue 的 `message`、Pinia Store 或业务路由写死在包内。

### 5.2 Interface Contract

接口契约是请求、SDK、接口测试、页面网络监听和性能门禁之间的共享事实来源。

```js
defineEndpoint({
  id: 'system.employee.queryPage',
  method: 'POST',
  path: '/employee/queryPage',
  auth: true,
  response: {
    protocol: 'smart-admin',
    schema: employeePageSchema,
  },
  performance: {
    p95Ms: 800,
    maxMs: 1500,
  },
});
```

每份契约可以同时驱动：

- SDK 请求构造；
- HTTP 和业务响应断言；
- Fake Adapter 与 Mock 数据；
- 页面请求识别；
- P50、P95、P99 和最大耗时预算；
- 测试报告和未来的接口文档生成。

### 5.3 Business SDK

可复用业务接口位于 `runtime/sdk`，按稳定业务域划分子路径，而不是把全部 API 放进单个文件。

```text
runtime/sdk/
├─ system/
├─ parking/
├─ property/
├─ finance/
└─ support/
```

项目特有、变化频繁或包含内部凭据的接口不能直接进入公共 SDK。业务上下文通过初始化依赖注入：

```js
configureRepoGuardRuntime({
  baseURL: import.meta.env.VITE_APP_API_URL,
  getToken,
  getCommunityId,
  onAuthExpired,
  onBusinessError,
  telemetry,
});
```

## 6. 与 front 项目的兼容边界

`front` 当前有 179 个 `src/api` 模块，其中 177 个从 `src/lib/axios.js` 导入请求方法。首期不批量改写这些模块，而是把 `src/lib/axios.js` 变成薄兼容层。

必须保持的函数签名包括：

- `getRequest(url, params, options)`；
- `postRequest(url, data, options)`；
- `postJsonRequest(url, data, options)`；
- `postRequestWithFormData({ url, data, options })`；
- `postEncryptRequest(url, data, options)`；
- `request(config)`；
- 现有下载和取消入口。

必须保持的响应契约是完整的 `{ code, ok, data, msg }` 对象，成功条件兼容 `code === 1` 或 `code === 0 && ok === true`。首期不能默认只返回 `data`。

兼容不等于复制旧缺陷。迁移时必须修复：

- 引用不存在内部函数的取消入口；
- 不返回 Promise 的下载入口；
- 下载分支中的未定义变量；
- 未脱敏上报请求头和请求体；
- 与 UI、Pinia、Vite 和 localStorage 的硬耦合；
- 独立服务模块中的硬编码凭据。

SSE、WebSocket、静态资源和浏览器原生资源加载不属于首期 Request Engine；后续以独立 Adapter 或 Capability 扩展。

## 7. 统一测试架构

### 7.1 已有能力复用

接口和页面测试复用现有基础设施：

- 配置加载、迁移和 `doctor`；
- 消费项目工具发现；
- 超时、进程执行和退出码；
- Chrome 与 Lighthouse 环境；
- axe 测试；
- JSON 报告和 GitLab artifacts；
- CI profile 和受管理模板。

不能另建不经过配置校验、doctor 或 CI 编排的测试旁路。

### 7.2 API Test

`testing/api` 负责：

- 真实测试环境调用和认证会话；
- HTTP 状态与业务协议校验；
- 响应 Schema、必填字段和字段类型；
- 成功、未认证、业务失败、网络失败和超时场景；
- 加密响应、上传和下载契约；
- JSON 和 JUnit 报告。

接口性能不能以单次请求作为门禁依据。标准流程是预热、正式采样、统计分位值，再与契约预算比较。

```text
预热请求
   ↓
正式采样 N 次
   ↓
计算 P50 / P95 / P99 / Max
   ↓
应用接口或套件预算
   ↓
生成结果和门禁退出码
```

### 7.3 Page Test

`testing/page` 使用消费项目自己的 Playwright 和 Chrome，负责：

- 登录、权限跳转和关键路由；
- 查询、表单、上传、下载等业务流程；
- 控制台错误和未处理 Promise；
- 请求失败、慢接口和重复请求；
- 页面加载、Web Vitals 和资源预算；
- 按配置组合 axe 与 Lighthouse。

页面测试不替代 Lighthouse。页面测试验证业务流程，Lighthouse 验证页面质量指标，两者共享浏览器环境和报告模型。

### 7.4 页面和接口联合报告

页面网络观察器使用接口契约识别请求，把页面步骤、接口正确性和性能结果关联起来。

```text
页面：员工管理
└─ 步骤：点击查询
   ├─ POST /employee/queryPage
   │  ├─ HTTP 200
   │  ├─ 业务码 0
   │  ├─ Schema 通过
   │  ├─ 耗时 1120ms
   │  └─ P95 预算 800ms：失败
   └─ GET /department/tree
      ├─ HTTP 200
      └─ 耗时 210ms：通过
```

## 8. 扩展机制

浏览器运行时和 CI 治理具有不同信任边界，不能共用一个万能插件接口。

### 8.1 Runtime Plugin

运行时插件只处理请求生命周期，例如认证、签名、加密、租户上下文、请求 ID 和遥测。

```js
createRequestPlugin({
  name,
  beforeRequest,
  afterResponse,
  onError,
});
```

插件不能获得底层 Client 私有状态，不能删除锁定安全策略，首次请求后不能动态改变插件顺序。

### 8.2 Capability Module

测试和门禁通过受控能力模块加入编排器。

```js
defineCapability({
  id: 'api-test',
  configKey: 'testing.api',
  environments: ['manual', 'ci'],
  validateConfig,
  validateSetup,
  doctor,
  run,
  report,
});
```

能力模块需要声明：

- 唯一 ID 和配置位置；
- 支持的执行环境；
- 消费项目依赖和环境验证；
- 是否只读、是否允许 Hook 执行；
- 超时、退出码和报告类型；
- 与其他能力的前置或互斥关系。

未来可增加 OpenAPI、视觉回归、截图差异、Bundle 体积、内存泄漏、安全响应头、API 可用率、Mock Server、SSE 和 WebSocket 测试，而不继续扩大单个 `ci-runner`。

## 9. npm 公共入口与依赖隔离

一个 npm 包通过子路径提供不同用途的公共 API：

```json
{
  "exports": {
    ".": "./src/index.js",
    "./request": "./src/runtime/request/index.js",
    "./api": "./src/runtime/sdk/index.js",
    "./api/system": "./src/runtime/sdk/system/index.js",
    "./testing": "./src/testing/index.js",
    "./testing/api": "./src/testing/api/index.js",
    "./testing/page": "./src/testing/page/index.js",
    "./testing/fake": "./src/testing/fixtures/index.js",
    "./config.schema.json": "./config.schema.json"
  }
}
```

约束如下：

- 生产代码从 `/request` 或 `/api/*` 导入，不能从包含 Node 治理 API 的包根入口导入；
- 测试代码从 `/testing/*` 导入；
- package exports 禁止未承诺的深层导入；
- Playwright、Lighthouse、Vitest、axe、ESLint 和 Stylelint 继续使用消费项目安装与配置；
- 构建产物必须能证明 `/request` 和 `/api/*` 不含 Node.js 内置模块及测试工具依赖。

当业务项目把 runtime 入口用于生产代码时，`@cxyi7/repo-guard` 必须是生产依赖，不能只放在 `devDependencies`。这是单包方案相对纯开发工具包的发布和依赖语义变化。

## 10. 配置演进

长期配置按领域组织：

```json
{
  "runtime": {
    "request": {
      "enabled": true,
      "protocol": "smart-admin"
    }
  },
  "testing": {
    "api": {
      "enabled": true,
      "environment": "test",
      "samples": 5
    },
    "page": {
      "enabled": true,
      "provider": "playwright"
    },
    "performance": {
      "enabled": true,
      "statistic": "p95"
    }
  },
  "governance": {},
  "delivery": {
    "ci": {}
  }
}
```

现有 `unitTest`、`accessibilityTest`、`lighthouse`、`preCommit` 和 `ci` 配置不能在次版本中直接删除或改名。演进顺序是：

1. 内部模块按领域分层；
2. 新能力使用目标领域配置；
3. 配置迁移器把旧字段归一化为内部模型；
4. README、Schema 和迁移测试保持同步；
5. 只有在明确的主版本中移除旧配置入口。

## 11. CI 编排模型

接口、页面和性能测试加入现有 CI，但应保持独立 Job，便于并行、重试和归因。

```text
repo_guard_policy
repo_guard_unit
repo_guard_api
repo_guard_page
repo_guard_performance
repo_guard_build
```

建议关系：

```text
policy ───────┐
unit ─────────┼──▶ page ───────▶ performance summary
api ──────────┘
build ────────────▶ page
```

接口测试需要明确的测试环境和凭据来源；页面测试使用业务项目启动命令、Playwright、Chrome、路由和账号 fixture。凭据只能通过 CI Secret 注入，禁止写入配置、测试文件、报告或 npm 包。

## 12. 分阶段实施顺序

### 阶段 A：平台骨架

- 建立 `platform/report` 的统一结果模型；
- 建立 Capability 注册、setup validation 和编排协议；
- 保持全部现有命令和配置兼容；
- 让现有单元测试、axe 和 Lighthouse 逐步接入统一协议。

### 阶段 B：请求运行时

- 实现框架无关 Request Engine 和 Axios Adapter；
- 实现 Smart Admin 响应协议兼容层；
- 实现 Token、加密、脱敏遥测、上传和下载；
- 使用 Fake Adapter 建立契约测试；
- 将 `front/src/lib/axios.js` 改为薄兼容层，暂不批量修改 177 个调用模块。

### 阶段 C：接口与性能测试

- 建立接口契约注册表；
- 增加 API Suite、认证 fixture、Schema 断言；
- 增加预热、采样、P50/P95/P99/Max 和性能预算；
- 输出 JSON/JUnit 报告并接入独立 GitLab Job。

### 阶段 D：页面业务测试

- 使用消费项目 Playwright 和 Chrome；
- 建立 Page Suite、登录状态和业务 Flow；
- 关联页面步骤、接口契约、网络错误和慢接口；
- 复用 axe 与 Lighthouse，生成联合报告。

### 阶段 E：业务 SDK 与边界治理

- 选择稳定业务域逐步进入 `/api/*`；
- 迁移直接 Axios 和普通 JSON fetch；
- SSE、WebSocket 保持明确边界，等待专用 Adapter；
- 增加 repo-guard request-boundary 门禁；
- 清理被替代的项目旧实现，禁止新旧请求管线并存。

## 13. 架构验收标准

- 仍然只需安装和升级一个 npm 包；
- 浏览器 runtime 构建不包含 Git、Node 文件系统或测试工具；
- 接口契约可被 SDK、API 测试、页面观察器和性能门禁共同复用；
- 现有 `front` API 模块可通过兼容层逐步迁移；
- 接口性能使用多次采样和分位值，不以单次请求误判；
- 页面报告能定位页面、步骤、接口、协议、Schema 和耗时；
- 新能力通过 Capability 接入 doctor、CLI、CI 和报告，不复制编排逻辑；
- 外部工具继续使用消费项目的安装、配置、Chrome、路由和断言；
- 凭据和 Token 不进入源码、npm 包、日志或测试报告；
- 所有行为变更同步测试、README 和配置 Schema。
