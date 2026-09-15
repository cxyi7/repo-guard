# 蓝绿部署与数据恢复

目标版本 2.1.0。GitLab 和手动执行共用 `repo-guard ops deploy`；当前适配 Linux Docker 守护进程、Node 构建及 Java Maven 构建。每个应用配置一个独立入口和两个颜色槽位。多仓库应用分别发布，不冒充跨仓原子事务。

## 检查配置与运维配置

`repo-guard.config.json` 继续决定质量检查；`repo-guard.ops.json` 声明构建和部署。部署要求质量 CI 开启，使用本轮唯一报告核对目标提交及通过状态，随后构建产物、计算摘要并绑定实际 Docker 镜像 ID。禁止使用未提交修改、旧报告或可变镜像标签代替目标版本。部署入口再次检查和构建，因此 GitLab 上游检查通过也不能绕过手动入口的相同要求。

## 配置示例

```json
{
  "version": 2,
  "enabled": true,
  "provider": "gitlab",
  "projects": {
    "api": {
      "enabled": true,
      "build": { "command": "mvn", "args": ["-B", "-ntp", "clean", "package"] },
      "artifactPaths": ["target/acceptance-api.jar"],
      "environments": {
        "test": {
          "production": false,
          "branches": ["test", "main"],
          "blueGreen": {
            "name": "acceptance-api",
            "network": "acceptance-network",
            "port": 18081,
            "containerPort": 8080,
            "healthUrl": "http://example.test:18081/api/health",
            "env": { "DATABASE_URL": "ACCEPTANCE_DATABASE_URL" },
            "backup": { "enabled": true },
            "mysql": {
              "container": "acceptance-mysql",
              "database": "acceptance",
              "defaultsFile": "/run/secrets/backup.cnf"
            },
            "uploads": { "source": "/srv/acceptance/uploads", "target": "/uploads" },
            "redis": { "container": "acceptance-redis", "volume": "acceptance-redis-data" }
          }
        }
      }
    }
  }
}
```

Node 应用沿用 `buildScript`；Java 使用 `build.command` 与 `build.args`。部署脚本 `script` 和 `blueGreen` 互斥。`env` 的值是执行环境变量名称，不是秘密值。`mysql`、`uploads`、`redis` 可以省略。Dockerfile 默认 `Dockerfile`；`timeoutSeconds` 默认 120，健康状态要求精确 HTTP 200，不接受重定向。健康探针镜像默认 `node:22.23.2-alpine`，代理镜像默认 `nginx:1.28-alpine`；自定义镜像须提供相同工具。

## 可选备份

`blueGreen.backup.enabled` 默认 `false`，省略 `backup` 等价于关闭。普通蓝绿发布只切换应用，回滚保留当前 MySQL、上传文件和 Redis 数据，不执行反向 SQL。应用通过 `env` 配置数据库和 Redis 连接即可，无需提供备份账号、数据资源归属标签或上传目录归属标记；`uploads` 仍可用于挂载本地目录，目录须存在并允许应用读写。

上例显式启用备份，至少需要声明 `mysql`、`uploads`、`redis` 中的一种；只对声明的资源执行快照与恢复。`mysql` 和 `redis` 是备份资源声明，不是应用连接配置；备份关闭时不会检查或操作这些资源。启用备份但没有声明资源会报配置错误，不会悄悄降级为无备份发布。

没有快照的上一版本不能在启用备份的情况下执行整套回滚；可关闭备份后仅回退应用。中断部署的 `recover` 遵循已登记的快照完成状态，关闭开关不会跳过尚未完成的数据恢复。

## 服务器准备

下述数据归属、备份账号和专用 Redis 限制仅在启用备份时适用；Docker 运行环境、应用资源归属和上传目录读写权限始终需要。

- Docker 守护进程须允许创建该项目容器、专用网络、状态卷以及访问上传目录。执行环境提供 Node、repo-guard、Git、Docker CLI 和本应用构建工具。
- 数据容器与 Redis 数据卷必须由运维明确登记标签 `com.repo-guard.deployment=<blueGreen.name>`。上传目录必须存在，且 `.repo-guard-owner` 文件内容等于同一名称；工具不擅自认领已有数据。
- 网络使用 `com.repo-guard.deployment=<blueGreen.network>` 标签，允许同一组应用连接。每个部署拥有自己的状态卷 `<name>-state`、锁容器 `<name>-lock`、代理 `<name>-proxy`、应用 `<name>-blue` 和 `<name>-green`。
- MySQL 凭据放在数据容器中的 `defaultsFile`，账号必须能够导出与恢复指定数据库。只备份指定数据库及其表、视图、触发器、存储程序和事件，不备份服务器账号等全局配置。
- Redis 必须是项目独立实例，其完整持久化目录挂载在声明的数据卷 `/data`；备份前正常停止 Redis，复制持久化文件后重新启动。不支持共享实例的选择性恢复。
- 上传目录为服务器本地绑定目录；维护期间不得有部署范围外的写入者。数据库、目录和 Redis 的标识改变后不能套用旧恢复点。

## 发布与恢复流程

普通模式（默认）：

```text
质量检查 → 构建固定镜像 → 获取部署锁 → 保持旧应用服务
→ 启动候选 → 候选 /api/health → 切换正式入口
→ 正式 /api/health 与版本标识 → 停止并保留旧应用 → 登记通过
```

候选或正式入口失败时自动回退旧应用，恢复期间暂时维护，数据保持当前状态。旧应用也不健康时保持维护并通知人工处理；不自动撤销 SQL 或保证破坏性数据库变更可回退。首次部署没有旧应用时，在候选就绪前提供维护入口。

启用备份时：

```text
质量检查 → 构建镜像 → 获取服务器部署锁 → 维护入口 → 停止应用写入
→ MySQL 导出、上传目录和 Redis 备份及校验值
→ 启动候选环境 → 候选 /api/health
→ 正式入口维护态切流 → 正式 /api/health 与版本标识
→ 开放入口 → 登记通过
```

健康接口通过即自动完成，无额外人工业务确认。正式入口同时核对由代理写入的版本标识，避免旧环境的健康结果冒充本次切换。此结论只证明健康接口，不证明所有业务功能正确。

发布失败自动尝试恢复发布前的数据和应用，发布结果仍为执行错误。恢复失败保留维护状态及待恢复记录，不自动开放。恢复点包含 MySQL 导出、上传目录归档、Redis 持久化归档和范围清单，并用 SHA-256 核验；每次备份的文件校验不等于逐次完成完整数据库恢复演练。

成功后保留上一颜色的容器。`rollback` 先备份当前状态，再恢复上一版本及其数据；因此可以再次执行回滚切换回来。**整套回滚会撤销恢复点之后的数据修改，包括真实用户写入**，不自动合并数据。仅应在明确接受历史恢复语义的环境使用。

## 两种执行方式

```sh
npx --no-install repo-guard ops plan
npx --no-install repo-guard ops install
npx --no-install repo-guard ops deploy --project api --environment test
npx --no-install repo-guard ops status --project api --environment test
npx --no-install repo-guard ops rollback --project api --environment test
npx --no-install repo-guard ops recover --project api --environment test
```

GitLab 生成的蓝绿作业调用同一 `ops deploy`。Runner 必须提供 Node、Docker CLI 和构建工具，并能操作目标 Docker 守护进程。手动可在服务器的已安装干净 checkout 执行，或从 Windows 通过 SSH 调用服务器上的同一命令。不要把本机的上传目录误当成 Docker 服务器的目录。

同一 Docker 守护进程的锁容器覆盖流水线和手动并发。正常结束释放锁；进程被强制终止后保留锁，避免盲目接管仍在执行的 Docker 操作。运维须先确认原进程、流水线及相关后台操作均已停止，再核验锁归属并移除该项目锁容器，随后运行 `ops recover`。不会按固定过期时间自动抢锁。

## 边界

普通模式在候选启动期间保持旧应用服务，新旧应用需兼容当前数据，短暂共存期间的后台写入由项目自行协调。备份模式会维护停机，备份期间旧应用也暂停；不承诺数据库变更期间零停机。定时任务、外部消息队列及外部系统副作用不在当前适配范围。备份留在项目专用状态卷，不能代替异机灾备。不会自动清理恢复点或其他业务资源。

部署命令、Docker 失败和健康超时复用公共退出码：检查违规为 2、范围错误为 3、配置或执行失败为 1；成功及成功状态查询为 0。参见[统一结果](gate-result-and-reporting.md)。

实现：`src/operations/deployment/`、`src/operations/providers/java.js`、`src/orchestration/cli/deployment.js`。测试：`test/operations/blue-green.test.js`。真实验收结果须单独记录，不能把状态机模拟测试视为真实数据库恢复成功。

## 部署状态通知

GitLab 与手动入口均复用 `repo-guard.config.json` 的 `ci.notification.enabled` 和 `ci.notification.channels`，不再配置一套机器人。配置飞书就发送飞书，配置企业微信就发送企业微信；同时配置则分别发送。关闭该开关会同时关闭 CI 与部署通知。

- 开始时：普通模式通知旧应用继续服务、本次不恢复数据；备份模式和显式恢复通知即将暂停使用服务。
- 健康检查通过且入口开放后：通知成功、服务恢复，以及源码版本。
- 发布失败且自动恢复成功：普通模式通知已切回旧应用、数据保持不变；备份模式通知已恢复发布前快照，并提供失败原因标识。
- 恢复失败或状态未确认：通知请勿使用服务、维护状态和排查方式；首次部署没有旧应用时不会声称服务已恢复。
- 检查或构建阶段失败：通知未进入停服切换阶段。

错误通知包含项目、环境、稳定错误标识和日志排查入口，不发送原始第三方异常、环境变量或凭据。各渠道独立发送，结果记录于终端／GitLab 作业日志；通知失败不修改部署退出码，不阻止数据恢复，也不会把部署成功改成失败。状态查询不发送通知。没有配置渠道时只提示未配置，不能视为真实通知验收通过。
