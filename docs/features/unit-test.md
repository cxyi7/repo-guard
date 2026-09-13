# 单元测试

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

前端新配置默认开启公共方法单元测试、覆盖率和变异测试，源码限于 src/utils/**/*.{js,ts}，测试放在 src/tests/utils，并保留嵌套目录。类型声明、专用类型文件、测试和生成代码排除；普通组件、页面、Store、Composable 和接口模块不再默认要求测试。已有显式配置保持不变。

公共方法按适用性覆盖正常值、零值、边界、精度、非法输入和缺陷回归，断言具体返回值、异常或副作用。不适用的场景说明原因；覆盖率和变异得分不能替代业务判断，也不会仅凭测试名称认定场景已覆盖。

## 接入单元测试

先在项目安装兼容的 Vitest（包声明支持 `>=1 <5`），保留已有测试配置：

```bash
npm install --save-dev --save-exact "vitest@>=1 <5"
```

在 `package.json` 的 `scripts` 中添加或确认真实测试入口：

```json
{
  "scripts": {
    "test:unit": "vitest run src/tests/utils"
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段属于 `package.json` 的 `scripts`）：

| 字段 | 用途 | 可填值 | 约束与要求 |
|---|---|---|---|
| `test:unit` | 项目真实的 测试 执行入口 | 字符串，示例为 `vitest run src/tests/utils` | 保留其他项目脚本；对应依赖与文件需存在，不能用空脚本或吞掉失败状态代替执行 |

<!-- config-fields:end -->

例如 `src/utils/add.js` 导出 `add`，对应的 `src/tests/utils/add.spec.js` 可以这样验证结果：

```js
import { expect, test } from 'vitest';
import { add } from '../../utils/add.js';

test('两数相加', () => {
  expect(add(2, 3)).toBe(5);
});
```

`repo-guard.config.json` 配置片段：

```json
{
  "checks": {
    "unitTest": {
      "enabled": true,
      "script": "test:unit",
      "timeoutMs": 120000,
      "requireTests": "changedFiles",
      "sourcePatterns": [
        "src/utils/**/*.{js,ts}"
      ],
      "testPatterns": [
        "src/tests/utils/**/*.{test,spec}.{js,ts}"
      ],
      "mappings": [
        {
          "sourcePattern": "src/utils/**/*.{js,ts}",
          "sourceRoot": "src/utils",
          "testTemplates": [
            "src/tests/utils/{relativePath}.test.{ext}",
            "src/tests/utils/{relativePath}.spec.{ext}"
          ]
        }
      ],
      "exclusions": [
        "**/*.d.ts",
        "**/*.types.ts",
        "**/*.{test,spec}.*",
        "**/generated/**"
      ]
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.unitTest.enabled` | 是否启用单元测试与资料策略 | `true` / `false`<br>省略补缺：`false`；前端初始化写入 `true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 按明确前端预设开启；需准备项目工具。 |
| `checks.unitTest.script` | 消费项目 package.json 中要执行的 npm 脚本名 | 字符串<br>默认：`"test:unit"` | 至少 1 个字符 |
| `checks.unitTest.timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>默认：`120000` | ≥ 1 |
| `checks.unitTest.requireTests` | newFiles 要求新增/复制源码有测试；changedFiles 要求变更源码有测试 | `"newFiles"` / `"changedFiles"`<br>默认：`"newFiles"` | 只接受列出的值 |
| `checks.unitTest.sourcePatterns` | 需要映射测试的 JS、TS、JSX、TSX 或 Vue 源码范围 | 字符串数组<br>默认：内置 5 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项；每项为非空字符串 |
| `checks.unitTest.testPatterns` | 扫描空测试以及 skip、todo、only 等绕过写法的测试路径 | 字符串数组<br>默认：`["**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"]` | 至少 1 项；每项为非空字符串 |
| `checks.unitTest.mappings` | 源码到测试文件的映射；按第一条匹配项确定候选测试路径 | 对象数组；对象字段见后续行<br>默认：内置 5 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项 |
| `checks.unitTest.mappings[].sourcePattern` | 该映射覆盖的仓库相对源码 glob | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `checks.unitTest.mappings[].sourceRoot` | {relativePath} 的明确源码根目录 | 可选字符串；使用 {relativePath} 时必填 | 必须是项目内明确目录，禁止 glob 和越界 |
| `checks.unitTest.mappings[].testTemplates` | 测试路径模板，支持 {dir}、{name}、{path}、{ext}、{relativePath}；每项须包含 {name}、{path} 或 {relativePath} | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；每项为非空字符串 |
| `checks.unitTest.exclusions` | 不要求补齐对应测试的源码范围，例如入口或生成代码 | 字符串数组<br>默认：`["src/main.{js,ts}","src/**/index.{js,ts}","src/generated/**"]` | 允许空数组；每项为非空字符串 |

<!-- config-fields:end -->

`newFiles` 要求新增源码有测试；`changedFiles` 要求变更源码有测试。映射中的 `{path}` 是不含扩展名的相对路径，例如 `src/utils/add`。{relativePath} 是相对于 sourceRoot、不含扩展名的路径，例如 money/round；不得超出该目录。

## Node 后端范围

`node-javascript` 与 `node-typescript` 预设默认将 `checks.unitTest.sourcePatterns` 设为 `src/**/*.{js,mjs,cjs,ts,mts,cts}`，覆盖整个后端源码目录。默认排除类型声明、测试文件、`__tests__` 和生成代码；不会沿用前端的 `src/main`、`index` 入口豁免。上面的来源范围与排除项表展示前端基线值，后端以预设生成的配置为准。

测试运行器仍为消费项目已有的 Vitest。repo-guard 只校验测试资料与执行结果，不生成接口、身份权限或其他业务测试；业务用例由项目维护。

```bash
npx repo-guard enable unitTest
npx repo-guard doctor
npx repo-guard unit-test
```

## 覆盖率

可进一步检查行、语句、函数、分支及本次变更行的覆盖率。启用 `coverage` 会同步启用单元测试；通过命令关闭 `unitTest` 时也会关闭覆盖率开关，并保留阈值和报告配置。

provider、阈值、报告与复核方式见[覆盖率与变更行覆盖率](coverage.md)。

## 执行范围与失败处理

pre-push、CI `full` / `release-ready` 和手动单元测试入口执行 `checks.unitTest.script` 指定的真实测试。CI `policy` 只运行测试资料策略；完整 CI 与发布就绪先检查资料策略，再执行完整 Vitest，并在启用 `checks.coverage` 时复核覆盖率。

单元测试不进入 pre-commit。缺少测试、空测试、`skip`/`todo`/`only`、阈值不达标时，修复后重新运行相同入口；检查报告是否来自当前代码。

源码：[测试策略](../../src/gates/testing/unit-test-policy.js)、[测试执行](../../src/gates/testing/unit-test-gate.js)。测试：[单元测试](../../test/gates/testing/unit-test.test.js)、[覆盖率](../../test/gates/testing/coverage.test.js)。

公共方法目录和文件名以用户配置为准，`src/utils` 仅是初始化示例。改名后按需更新 `checks.unitTest.sourcePatterns`、`testPatterns`、`mappings`（含 `sourceRoot` 与 `testTemplates`），覆盖率直接复用单元测试范围；变异范围由 `checks.mutationTest.options.mutate` 或优先级更高的原生 Stryker 配置决定。项目测试脚本与 Vitest 原生配置也应使用实际测试目录。运行时不猜测目录，不回退到 utils，重复启用不覆盖用户保存的路径。

## Node 新建预设

7.1.4 起本项在新建 Node 后端配置中默认开启（类型检查仅限 node-typescript）。原有规则、阈值与配置字段不变；已有项目不因读取或升级而开启。实际工具、脚本和检查范围仍需接入准备，见 [Node 后端规范](node-backend.md)。

本项可关联应用的[目录职责与路径绑定](directory-roles.md)。新建预设的已绑定范围随目录引用解析，用户显式路径优先；原生工具配置须按接入规则单独核对。职责说明不代表业务语义已验证。
