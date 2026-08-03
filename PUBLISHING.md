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
- ESLint/Prettier 暂存自动修复、部分暂存恢复、失败回滚和 Hook 升级测试通过；
- `npm whoami --registry=https://registry.npmjs.org/` 返回正确账号。

## 发布

```bash
npm publish --access public
```

发布后验证：

```bash
npm view @cxyi7/repo-guard@0.4.0 version
npm view @cxyi7/repo-guard@0.4.0 dist.integrity
```

不要从业务项目、临时目录或 `node_modules` 发布。所有版本都必须从本独立仓库
验证并发布。
