# 单元测试

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

用项目自己的 Vitest 执行测试，并检查源码与测试的对应关系。可以进一步要求 Vue 组件具有真实交互测试、全量覆盖率和变更行覆盖率达到阈值。

## 接入单元测试

先在项目安装兼容的 Vitest（包声明支持 `>=1 <5`），保留已有测试配置：

```bash
npm install --save-dev --save-exact "vitest@>=1 <5"
```

在 `package.json` 的 `scripts` 中添加或确认真实测试入口：

```json
{
  "scripts": {
    "test:unit": "vitest run"
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段属于 `package.json` 的 `scripts`）：

| 字段 | 用途 | 可填值 | 约束与要求 |
|---|---|---|---|
| `test:unit` | 项目真实的 测试 执行入口 | 字符串，示例为 `vitest run` | 保留其他项目脚本；对应依赖与文件需存在，不能用空脚本或吞掉失败状态代替执行 |

<!-- config-fields:end -->

例如 `src/utils/add.js` 导出 `add`，对应的 `src/utils/add.spec.js` 可以这样验证结果：

```js
import { expect, test } from 'vitest';
import { add } from './add.js';

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
      "requireTests": "newFiles",
      "sourcePatterns": [
        "src/utils/**/*.js",
        "src/components/**/*.vue"
      ],
      "testPatterns": [
        "**/*.{spec,test}.{js,ts}"
      ],
      "mappings": [
        {
          "sourcePattern": "**/*.js",
          "testTemplates": [
            "{path}.spec.js"
          ]
        },
        {
          "sourcePattern": "**/*.vue",
          "testTemplates": [
            "{path}.spec.ts"
          ]
        }
      ],
      "exclusions": [
        "src/generated/**"
      ]
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `checks.unitTest.enabled` | 是否启用单元测试与资料策略 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 初始化不自动探测启用；需显式开启并准备工具。 |
| `checks.unitTest.script` | 消费项目 package.json 中要执行的 npm 脚本名 | 字符串<br>默认：`"test:unit"` | 至少 1 个字符 |
| `checks.unitTest.timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>默认：`120000` | ≥ 1 |
| `checks.unitTest.requireTests` | newFiles 要求新增/复制源码有测试；changedFiles 要求变更源码有测试 | `"newFiles"` / `"changedFiles"`<br>默认：`"newFiles"` | 只接受列出的值 |
| `checks.unitTest.sourcePatterns` | 需要映射测试的 JS、TS、JSX、TSX 或 Vue 源码范围 | 字符串数组<br>默认：内置 5 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项；每项为非空字符串 |
| `checks.unitTest.testPatterns` | 扫描空测试以及 skip、todo、only 等绕过写法的测试路径 | 字符串数组<br>默认：`["**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"]` | 至少 1 项；每项为非空字符串 |
| `checks.unitTest.mappings` | 源码到测试文件的映射；按第一条匹配项确定候选测试路径 | 对象数组；对象字段见后续行<br>默认：内置 5 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项 |
| `checks.unitTest.mappings[].sourcePattern` | 该映射覆盖的仓库相对源码 glob | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `checks.unitTest.mappings[].testTemplates` | 测试路径模板，支持 {dir}、{name}、{path}、{ext}；每项须包含 {name} 或 {path} | 字符串数组<br>本对象内必填，无自动代填值 | 至少 1 项；每项为非空字符串 |
| `checks.unitTest.exclusions` | 不要求补齐对应测试的源码范围，例如入口或生成代码 | 字符串数组<br>默认：`["src/main.{js,ts}","src/**/index.{js,ts}","src/generated/**"]` | 允许空数组；每项为非空字符串 |

<!-- config-fields:end -->

`newFiles` 要求新增源码有测试；`changedFiles` 要求变更源码有测试。映射中的 `{path}` 是不含扩展名的相对路径，例如 `src/utils/add`。示例只覆盖 JS 与 Vue，实际项目需保留 TS 等相应映射。

## Node 后端范围

`node-javascript` 与 `node-typescript` 预设默认将 `checks.unitTest.sourcePatterns` 设为 `src/**/*.{js,mjs,cjs,ts,mts,cts}`，覆盖整个后端源码目录。默认排除类型声明、测试文件、`__tests__` 和生成代码；不会沿用前端的 `src/main`、`index` 入口豁免。上面的来源范围与排除项表展示前端基线值，后端以预设生成的配置为准。

测试运行器仍为消费项目已有的 Vitest。repo-guard 只校验测试资料与执行结果，不生成接口、身份权限或其他业务测试；业务用例由项目维护。后端不支持 `checks.componentInteraction`。

```bash
npx repo-guard enable unitTest
npx repo-guard doctor
npx repo-guard unit-test
```

## Vue 组件交互

可要求 Vue 组件测试直接挂载目标组件，在同一用例执行真实交互并断言可观察结果。启用 `componentInteraction` 会同步启用单元测试；源码范围与测试映射仍由 `unitTest` 维护。

项目依赖、配置、完整用例和失败处理见[Vue 组件交互测试](component-interaction.md)。

## 覆盖率

可进一步检查行、语句、函数、分支及本次变更行的覆盖率。启用 `coverage` 会同步启用单元测试；通过命令关闭 `unitTest` 时也会关闭覆盖率开关，并保留阈值和报告配置。

provider、阈值、报告与复核方式见[覆盖率与变更行覆盖率](coverage.md)。

## 执行范围与失败处理

pre-push、CI `full` / `release-ready` 和手动单元测试入口执行 `checks.unitTest.script` 指定的真实测试。CI `policy` 只运行测试资料策略；完整 CI 与发布就绪先检查资料策略，再执行完整 Vitest，并在启用 `checks.coverage` 时复核覆盖率。

单元测试不进入 pre-commit。缺少测试、空测试、`skip`/`todo`/`only`、交互证据不完整或阈值不达标时，修复后重新运行相同入口；检查报告是否来自当前代码。

源码：[测试策略](../../src/gates/testing/unit-test-policy.js)、[测试执行](../../src/gates/testing/unit-test-gate.js)。测试：[单元测试](../../test/gates/testing/unit-test.test.js)、[覆盖率](../../test/gates/testing/coverage.test.js)。
