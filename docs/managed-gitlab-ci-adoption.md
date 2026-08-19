# 三个现有项目的 GitLab CI 接入映射

本文记录 `front`、`owner`、`employee` 接入 `@cxyi7/repo-guard@1.8.2` 托管应用交付标准时的边界。它是迁移依据，不包含密钥、服务器地址、仓库凭据或其他环境秘密。

## 统一部分

三个项目统一由 repo-guard 管理以下内容：

- `repo_guard` 门禁以及 `ci.gatePolicy` 的 CI 专属启停和阻断策略；
- 默认 Node.js 22.23.2、可配置的验证/发布镜像、npm 下载缓存、`npm ci` 和 Hook 跳过变量；
- 非交付分支验证、测试环境自动发布、生产环境手动发布、可选快速发布；
- GitLab 分支规则、Job 名、阶段、Runner 标签、`.post` 阶段成功/失败通知和运行中取消通知；
- 受管模板升级、缺失脚本、阶段冲突、Job 名冲突和模板改写诊断。

项目继续管理以下内容：

- 构建模式、微信小程序 appKey/robot、版本描述和上传实现；
- Dockerfile、镜像仓库、镜像清理、容器、端口、健康检查、Nginx 和蓝绿切换；
- GitLab 受保护变量中的密钥、账号、Webhook 和环境地址；
- 固定验证与发布 npm scripts 背后的业务脚本。

启用 `notifications` 的项目只需在 GitLab CI/CD Variables 中设置受保护、已遮蔽的 `REPO_GUARD_WECOM_WEBHOOK`；需要 @ 成员时再设置逗号分隔的 `REPO_GUARD_MENTION_MOBILES`。通知命令由 npm 包提供，项目不再维护 `ci:notify` script。生成的成功与失败通知 Job 位于 `.post` 阶段且互斥执行，所以每条完整流水线只发送一条最终结果通知；运行中的受管 Job 被手动或自动取消时，另发送明确的“已取消（canceled）”通知。提交标题最多显示前 10 个字符并追加省略号。

## owner

建议配置：

```json
{
  "ci": {
    "pipeline": {
      "enabled": true,
      "testBranches": ["dev", "future/*"],
      "productionBranches": ["publish"],
      "runnerTags": ["docker"],
      "legacyPeerDeps": true,
      "quickDeploy": true,
      "notifications": true
    }
  }
}
```

建议脚本映射：

```json
{
  "ci:verify": "npm run build:mp-weixin-test",
  "ci:deploy:test": "node scripts/ci-deploy.mjs owner test",
  "ci:deploy:production": "node scripts/ci-deploy.mjs owner production",
  "ci:deploy:quick": "node scripts/ci-deploy.mjs owner quick"
}
```

`scripts/ci-deploy.mjs` 只负责把标准生命周期转换为已有 `mp-ci-deploy.js` 参数。应从 `mp-ci-deploy.js` 移除内部依赖安装，避免与受管 Job 的 `npm ci --legacy-peer-deps` 重复。

## employee

当前流水线在 `dev` 上自动发布测试版，同时提供手动生产发布，因此测试与生产分支允许重叠：

```json
{
  "ci": {
    "pipeline": {
      "enabled": true,
      "testBranches": ["dev"],
      "productionBranches": ["dev"],
      "runnerTags": ["docker"],
      "legacyPeerDeps": true,
      "quickDeploy": true,
      "notifications": false
    }
  }
}
```

建议脚本映射与 `owner` 相同，但 appKey 使用 `employee`。若后续把正式发布统一迁到 `publish` 分支，只需修改 `productionBranches`，不需要改受管 YAML。

## front

`front` 的 Web 镜像和蓝绿发布与小程序不同，但可以使用同一生命周期外壳：

```json
{
  "ci": {
    "pipeline": {
      "enabled": true,
      "testBranches": ["dev", "test"],
      "productionBranches": [],
      "runnerTags": [],
      "deployImage": "registry.example.com/ci/node-docker:22",
      "legacyPeerDeps": false,
      "quickDeploy": false,
      "notifications": false
    }
  }
}
```

建议脚本映射：

```json
{
  "ci:verify": "npm run build:test",
  "ci:deploy:test": "node scripts/ci-deploy-web.cjs"
}
```

上面的 `deployImage` 只是结构示例，实际迁移时应替换为 `front` 可访问、同时包含 Node.js 22、npm 与 Docker CLI 的内部 CI 镜像。`scripts/ci-deploy-web.cjs` 根据 `CI_COMMIT_BRANCH` 选择 `build:dev` 或 `build:test`，并复用现有镜像构建、推送、健康检查和蓝绿切换实现。现有 YAML 中的服务器、镜像、端口与 Nginx 细节应迁入该项目脚本或 GitLab 变量，而不是进入 repo-guard 的通用配置。

## 迁移顺序

每个项目独立迁移和验证，避免三个发布链路同时切换：

1. 升级并精确锁定 `@cxyi7/repo-guard@1.8.2`。
2. 增加固定 `ci:*` scripts，并先在本地或临时 Runner 验证业务脚本。
3. 增加 `ci.pipeline` 配置，运行 `repo-guard install-ci --provider gitlab --profile policy --dry-run`。
4. 删除根 `.gitlab-ci.yml` 中已被托管 Job 替代的旧任务，保留项目确实需要的非重名自有任务。
5. 正式运行 `install-ci` 与 `doctor --ci`，在临时分支验证门禁和手动任务可见性。
6. 先迁移 `owner`，再迁移结构相似的 `employee`，最后迁移发布实现差异最大的 `front`。

迁移消费项目属于后续独立评审任务，不与 npm 包 `1.8.2` 的能力实现提交混在同一发布中。
