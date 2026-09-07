# axe 可访问性测试

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

通过项目自己的测试脚本对真实组件或页面运行 axe 扫描，并要求零违规断言。它与提交阶段的表单标签、图片替代文本静态检查分别执行。

## 接入与配置

项目需有独立 `test:a11y` 脚本、匹配的测试文件，以及受支持的集成：`axe-core`、`vitest-axe`、`jest-axe`、`@axe-core/playwright` 或 `cypress-axe`。浏览器或 DOM 环境由项目提供。

例如已有 Vitest 与 DOM 环境的项目可使用 `axe-core` 4.x，并配置以下 `package.json` 片段：

```json
{
  "scripts": {
    "test:a11y": "vitest run test/accessibility"
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段属于 `package.json` 的 `scripts`）：

| 字段 | 用途 | 可填值 | 约束与要求 |
|---|---|---|---|
| `test:a11y` | 项目真实的 测试 执行入口 | 字符串，示例为 `vitest run test/accessibility` | 保留其他项目脚本；对应依赖与文件需存在，不能用空脚本或吞掉失败状态代替执行 |

<!-- config-fields:end -->

在 `test/accessibility/form.a11y.spec.js` 中，先渲染真实页面或组件，再扫描和断言：

```js
import axe from 'axe-core';
import { expect, test } from 'vitest';

test('表单不存在 axe 违规', async () => {
  document.body.innerHTML = '<main><label for="name">姓名</label><input id="name"></main>';
  const results = await axe.run(document);
  expect(results.violations).toHaveLength(0);
  document.body.innerHTML = '';
});
```

上例演示扫描结构；实际项目应替换成真实界面，配置适合 axe 的浏览器或 DOM 环境。

```json
{
  "accessibilityTest": {
    "enabled": true,
    "script": "test:a11y",
    "timeoutMs": 180000,
    "testPatterns": ["test/accessibility/**/*.a11y.spec.js"]
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `accessibilityTest` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否启用axe 测试与资料策略 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 首次 init 会按项目就绪探测启用；表中是补缺默认值。 |
| `script` | 消费项目 package.json 中要执行的 npm 脚本名 | 字符串<br>默认：`"test:a11y"` | 至少 1 个字符；仅字母、数字、冒号、下划线、连字符；必须对应真实 npm 脚本，不带参数或 shell 片段 |
| `timeoutMs` | 本项检查或脚本允许的最大运行时间，单位毫秒 | 整数<br>默认：`180000` | ≥ 1 |
| `testPatterns` | 应直接执行 axe 并断言无违规的测试文件范围 | 字符串数组<br>默认：内置 2 项，见[默认配置](../../src/config/defaults.js) | 至少 1 项；每项为非空字符串 |

<!-- config-fields:end -->

```bash
npx repo-guard enable accessibilityTest
npx repo-guard doctor
npx repo-guard accessibility-test
```

## 执行与修复

手动、pre-push 和 CI `full` 可执行；不进入 pre-commit，当前固定 `release-ready` 计划也不单独调度此 Gate。发布前是否重跑 axe，应明确放入项目 `test` 脚本或此前约定的验证流程。

缺少集成、扫描或零违规断言时先修正测试；扫描失败则修复界面并重新验证。`skip`、`only`、关闭 axe 规则、过滤影响级别或排除 DOM 的绕过写法会被检查。

源码：[就绪检查](../../src/gates/testing/accessibility-test-setup.js)。测试：[可访问性测试](../../test/accessibility-test.test.js)。
