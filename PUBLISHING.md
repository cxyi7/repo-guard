# 发布流程

## 功能规模与版本号

每个独立功能必须单独审查、提交和发布，不得把下一项功能混入已经完成审查的版本。发布前按兼容性和功能规模选择 SemVer：

- 单条规则、局部兼容增强或小范围修复升级补丁版本，例如 `0.12.12` → `0.12.13`；
- 新的完整门禁体系、跨阶段执行流程或其他大型兼容功能升级次版本，例如 `0.12.x` → `0.13.0`；
- 删除公开能力、改变已有配置含义或产生其他不兼容行为时，必须先进行影响审查，再决定主版本升级和迁移方案。

AI 不得为了减少发布次数合并无关功能，也不得把大型功能降为补丁版本。版本判断及其理由应在开发开始时明确，并在代码审查汇报中复核。

## 发布前检查

```bash
npm ci
npm run check
npm test
npm run pack:check
```

确认：

- Git 工作区干净；
- `package.json` 与 `CHANGELOG.md` 版本一致；
- 配置 Schema、README 和行为同步；
- 配置迁移、通知开关、Stylelint/ESLint AI 提示、诊断修复和 Hook 安全预检测试通过；
- Stylelint/ESLint/Prettier 暂存自动修复、部分暂存恢复和失败回滚测试通过；
- Vue Lighthouse 构建、collect/assert、禁用跳过、失败阻断和 v3 pre-push Hook 测试通过；

## npm 登录与 2FA

每次发布都必须新开一个可见的 PowerShell 终端，在独立仓库中重新完成 npm Web
登录和账号 2FA，不依赖旧登录状态：

```powershell
Set-Location -LiteralPath 'D:\Projects\repo-guard'
npm login --registry=https://registry.npmjs.org/ --auth-type=web
npm whoami --registry=https://registry.npmjs.org/
```

在浏览器中输入账号信息和动态验证码。只有 `npm whoami` 明确返回 `cxyi7` 后，
才能继续发布。禁止把密码、访问令牌、恢复码或一次性动态验证码写入仓库、脚本、
命令历史和文档。

## 发布

登录验证成功后，再新开一个可见的 PowerShell 发布终端：

```powershell
Set-Location -LiteralPath 'D:\Projects\repo-guard'
npm publish --access public
```

如果发布返回 `E401`，或者在 `PUT` 包地址时返回权限相关的 `E404`，表示登录凭证
无效或已失效。重新执行上面的 Web 登录和 2FA 流程，不要因此修改包版本号。

发布后验证：

```bash
npm view @cxyi7/repo-guard@0.8.0 version
npm view @cxyi7/repo-guard@0.8.0 dist.integrity
```

不要从业务项目、临时目录或 `node_modules` 发布。所有版本都必须从本独立仓库
验证并发布。
