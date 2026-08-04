# 发布流程

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
npm view @cxyi7/repo-guard@0.7.0 version
npm view @cxyi7/repo-guard@0.7.0 dist.integrity
```

不要从业务项目、临时目录或 `node_modules` 发布。所有版本都必须从本独立仓库
验证并发布。
