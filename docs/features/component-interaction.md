# Vue 组件交互测试

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；首次初始化可能按工具就绪情况启用。主配置片段需合并到原文件，数组整项替换。

要求组件测试包含真实操作和可观察结果，避免只有“组件能挂载”的形式化测试。

## 接入与示例

项目还需 `@vue/test-utils` 2.x、能编译 `.vue` 的 Vitest/Vite 配置，以及可用的 DOM 测试环境。启用组件交互会同步启用单元测试。

```json
{
  "unitTest": {
    "enabled": true,
    "componentInteraction": {
      "enabled": true,
      "componentPatterns": ["src/components/**/*.vue"]
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下字段位于 `unitTest` 内）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `enabled` | 是否启用单元测试与资料策略 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"； 首次 init 会按项目就绪探测启用；表中是补缺默认值。 |
| `componentInteraction.enabled` | 是否启用Vue 组件交互测试要求 | `true` / `false`<br>默认：`false` | 使用 JSON 布尔值，不能写成字符串 "true" / "false"；启用命令同时启用 unitTest；组件还需进入源码范围并找到映射测试。 |
| `componentInteraction.componentPatterns` | 需要交互测试的 Vue 组件路径；组件仍须进入 sourcePatterns 并匹配测试 | 字符串数组<br>默认：`["src/components/**/*.vue"]` | 至少 1 项；每项为非空字符串 |

<!-- config-fields:end -->

组件必须同时落在 `unitTest.sourcePatterns` 内，并有可找到的测试。以 `saveButton.vue` 点击按钮后发出 `save` 事件为例，按上述 Vue 映射保存为同目录的 `saveButton.spec.ts`：

```js
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import SaveButton from './saveButton.vue';

test('点击保存后发出事件', async () => {
  const wrapper = mount(SaveButton);
  await wrapper.get('button').trigger('click');
  expect(wrapper.emitted('save')).toHaveLength(1);
  wrapper.unmount();
});
```

测试需直接导入并挂载组件，在同一用例执行用户交互并断言可观察结果。只断言组件存在不足以通过交互要求。

```bash
npx repo-guard enable componentInteraction
npx repo-guard unit-test
```

## 范围、结果与修复

测试映射、`requireTests` 和排除项由 `unitTest` 统一维护，完整设置见[单元测试](unit-test.md)。静态策略检查交互证据，完整测试入口再执行项目 Vitest，两者缺一不可。

pre-push、CI `full` 和手动 `unit-test` 执行测试；CI `policy` 与 `release-ready` 的资料策略只检查对应测试约束。组件源码未进入 sourcePatterns、找不到映射测试或只做存在性断言时，应修正范围、映射或测试用例。

按用户动作补齐点击、输入等操作和结果断言，再复核项目测试。静态检查通过不能代替视觉与真实浏览器验收。

## 维护依据

[实现入口](../../src/integrations/vue/component-interaction.js) · [对应测试](../../test/unit-test.test.js)
