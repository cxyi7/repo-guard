# 依赖声明与锁文件

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

> 阅读约定：示例保持标准 JSON，字段说明紧随其后。默认值指省略字段时的补缺值，不等于示例值；默认值还会受显式项目预设影响；初始化不探测并自动开启能力。主配置片段需合并到原文件，数组整项替换。

依赖策略默认启用，要求精确版本与同步锁文件。项目可配置允许的协议和禁用依赖：

```json
{
  "repository": {
    "dependencyPolicy": {
      "enabled": true,
      "requireExactVersions": true,
      "requireLockfile": true,
      "allowedProtocols": [
        "npm",
        "workspace"
      ],
      "bannedPackages": []
    }
  }
}
```

<!-- config-fields:start -->
**字段说明**（以下使用完整的 v2 配置路径）：

| 字段 | 用途 | 可填值与默认值 | 约束与要求 |
|---|---|---|---|
| `repository.dependencyPolicy.enabled` | 是否启用依赖声明与锁文件检查 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.dependencyPolicy.requireExactVersions` | 是否要求 peerDependencies 以外使用精确依赖版本 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.dependencyPolicy.requireLockfile` | 是否要求 npm 锁文件存在且根依赖与 package.json 一致 | `true` / `false`<br>默认：`true` | 使用 JSON 布尔值，不能写成字符串 "true" / "false" |
| `repository.dependencyPolicy.allowedProtocols` | 允许的额外依赖来源协议名，例如 npm、workspace；不带冒号 | 字符串数组<br>默认：`["npm","workspace"]` | 允许空数组；元素不可重复；每项：协议名使用小写字母开头，后续可含数字、加号、点或连字符；不带冒号 |
| `repository.dependencyPolicy.bannedPackages` | 禁止使用的包及审核原因，空数组表示没有项目禁用包 | 对象数组；对象字段见后续行<br>默认：`[]` | 允许空数组 |
| `repository.dependencyPolicy.bannedPackages[].name` | 被禁止的 npm 包名 | 字符串<br>本对象内必填，无自动代填值 | 至少 1 个字符 |
| `repository.dependencyPolicy.bannedPackages[].reason` | 禁用该依赖的具体理由 | 字符串<br>本对象内必填，无自动代填值 | 至少 10 个字符 |
| `repository.dependencyPolicy.bannedPackages[].replacement` | 建议替代包；可省略或设为 null | 字符串 / null<br>未声明固定默认值 | 非 null 时：至少 1 个字符 |

<!-- config-fields:end -->

```bash
npx repo-guard dependencies
```

提交阶段读取最终 Git 索引中的依赖声明和锁文件。按报告修复版本、依赖分组、来源或锁文件一致性，再同时暂存相关文件。

## 具体检查

| 规则 | 处理方式 |
|---|---|
| 非精确版本 | 使用精确版本安装；`peerDependencies` 不受精确版本要求限制 |
| 非允许来源 | 核对协议白名单，`npm:` 别名在精确版本策略下也须指向精确版本 |
| 重复声明 | 移除普通依赖、开发依赖、可选依赖间的重复归属；peer 声明单独处理 |
| 禁用包 | 按 `bannedPackages` 中的原因和替代方案调整 |
| 锁文件缺失或不一致 | 重新生成同步的 npm 锁文件，要求 lockfileVersion 至少为 2 且有根包条目 |

本能力比较根包普通、开发和可选依赖与锁文件根条目，不等同于漏洞扫描或完整供应链审计。

## 生命周期与复核

pre-commit 读取最终索引中的 `package.json` 与 `package-lock.json`；CI 三档复核对应项目事实。显式 `dependencies` 可在自动开关关闭时审计。修复后同时暂存声明与锁文件，再用相同入口检查，避免工作区已正确而索引仍不同步。

## 维护依据

[实现入口](../../src/gates/repository/dependency-policy.js) · [对应测试](../../test/gates/repository/dependency-policy.test.js)
