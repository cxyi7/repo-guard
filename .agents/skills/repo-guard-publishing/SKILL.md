---
name: repo-guard-publishing
description: 为 @cxyi7/repo-guard 判定发布版本、完成发布前验证，并在用户明确要求后执行 npm Web 登录、2FA、发布和注册表复核。适用于当前仓库的版本准备、发布审查或 npm 发布；不用于消费项目发布，也不把“检查发布条件”视为“执行发布”的授权。
---

# Repo Guard npm 发布

只用于 `@cxyi7/repo-guard` 的规范仓库。开始前解析当前 Git 仓库根目录并确认 `package.json` 的 `name` 恰好是 `@cxyi7/repo-guard`；不要使用硬编码工作目录，不要从业务项目、临时目录或 `node_modules` 发布。

## 区分准备与发布

- “检查”“审查”“准备版本”只授权只读检查、项目内版本与文档修改以及验证，不授权登录或 `npm publish`。
- 只有用户明确要求发布到 npm，才进入登录和发布阶段。
- 登录、发布、打标签、推送和合并是不同外部操作；不要从其中一项推断另一项授权。

## 版本判断

一个可独立评审的功能对应一个版本，不把下一个功能并入已经完成评审的版本：

- 单条规则、局部兼容增强或小范围修复使用 patch。
- 新的完整门禁体系、跨阶段工作流或其他大型兼容能力使用 minor。
- 删除公开能力、改变已有配置含义或产生其他不兼容行为时，先完成影响与迁移审查，再决定 major。

在开发开始时提出版本建议和理由，在代码审查与发布准备时基于最终差异复核。不要为了减少发布次数合并无关功能，也不要把大型功能降为 patch。认证失败、网络失败或版本已存在不是随意修改版本号的理由。

## 发布前验证

1. 检查当前分支、目标提交、工作树和完整差异，确认本版本只有一个独立评审功能，没有遗留调试文件、凭据或无关修改。
2. 核对 `package.json`、`package-lock.json`、`CHANGELOG.md`、`README.md`、使用说明和长期功能清单中的版本与能力描述。行为或配置变化必须同步测试和相应 Schema。
3. 在确认不会覆盖用户未保存工作的前提下，从仓库根目录执行：

   ```bash
   npm ci
   npm run check
   npm test
   npm run pack:check
   ```

4. 检查完整测试是否覆盖配置迁移、Hook 安全与部分暂存恢复、GitLab CI 可信范围和报告、通知开关、消费项目工具集成以及本次功能的新增行为。
5. 阅读 `npm run pack:check` 的真实文件清单，确认入口、Schema、README、许可证、文档和运行时代码齐全，并确认凭据、临时报告及仓库本地 `.agents/` Skill 没有进入包。
6. 发布前要求用于发布的提交已经确定且 Git 工作区干净；任何检查失败都返回修复和重新验证，不得绕过。

## npm 登录与发布

获得用户明确发布授权后：

1. 新开一个位于当前仓库根目录的可见 PowerShell 终端，执行官方 Web 登录：

   ```powershell
   npm login --registry=https://registry.npmjs.org/ --auth-type=web
   npm whoami --registry=https://registry.npmjs.org/
   ```

2. 由用户在官方页面完成账号登录与 2FA。只有 `npm whoami` 明确返回 `cxyi7` 才能继续。
3. 再新开第二个可见 PowerShell 终端，确认仍位于同一仓库和已验证提交，然后执行：

   ```powershell
   npm publish --access public
   ```

4. 如果返回 `E401`，或在写入包地址时返回权限相关 `E404`，回到官方 Web 登录与 2FA；不要因此修改版本号。

禁止把 npm 密码、访问令牌、恢复码或一次性验证码写入仓库、脚本、命令参数、命令历史、日志、Evidence 或文档。不要替用户填写这些信息，也不要复用未经本轮验证的旧登录状态。

## 发布后复核

从 `package.json` 读取本次精确版本，使用该版本复核注册表：

```bash
npm view @cxyi7/repo-guard@<version> version
npm view @cxyi7/repo-guard@<version> dist.integrity
```

只有发布命令成功，且注册表返回的版本与目标版本一致、`dist.integrity` 非空，才报告 npm 发布完成。最终汇报版本选择理由、发布提交、四项发布前检查、`npm whoami` 身份、发布结果和注册表复核；不得记录任何认证秘密。
