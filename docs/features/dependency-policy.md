# 依赖声明、锁文件与工具就绪

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

7.0.0 支持 npm、pnpm、Yarn Classic 与现代 Yarn 的普通注册表依赖。声明固定、锁文件记录一致、真实冻结安装成功是不同事实，不互相替代。特殊引用跳过依赖策略检查，不报不支持，不视为已验证。删除 allowedProtocols，不保留旧读取入口。

## 配置

以下为 pnpm 示例，所有开关均可修改。安装根目录相对当前应用，锁文件路径相对安装根目录；省略 path 时按明确的包管理器选择默认文件。name 默认 npm，不根据文件重新猜测。

```json
{
  "repository": {
    "dependencyPolicy": {
      "enabled": true,
      "requireExactVersions": true,
      "requireLockfile": true,
      "checkConflictingDeclarations": true,
      "packageManager": {
        "name": "pnpm",
        "root": ".",
        "requireVersionDeclaration": true,
        "checkInstalledVersion": true
      },
      "lockfile": {
        "path": "pnpm-lock.yaml",
        "checkManifestSync": true,
        "checkConflictingLockfiles": true
      },
      "toolReadiness": {
        "enabled": true,
        "requireDeclaredDependencies": true,
        "checkToolVersions": true,
        "checkNodeEngines": true,
        "checkPeerDependencies": true,
        "checkConfigLoading": true,
        "checkRequiredScripts": true
      },
      "bannedPackages": []
    }
  }
}
```

<!-- config-fields:start -->
| 字段 | 用途与默认 |
|---|---|
| `repository.dependencyPolicy.enabled` | 默认 true；自动依赖门禁总开关，显式 dependencies 命令仍审计 |
| `repository.dependencyPolicy.requireExactVersions` | 默认 true；普通直接依赖要求规范精确版本，peerDependencies 接受合法范围 |
| `repository.dependencyPolicy.requireLockfile` | 默认 true；锁文件必须存在 |
| `repository.dependencyPolicy.checkConflictingDeclarations` | 默认 true；不同普通区段存在冲突版本时报告，尊重可选依赖覆盖，不禁止同值或 peer 配套声明 |
| `repository.dependencyPolicy.packageManager.name` | npm、pnpm、yarn；默认 npm，接入者明确修改 |
| `repository.dependencyPolicy.packageManager.root` | 默认 .；当前应用所属安装根目录，必须位于同一仓库 |
| `repository.dependencyPolicy.packageManager.requireVersionDeclaration` | 默认 true；安装根 package.json 必须声明 packageManager 精确版本 |
| `repository.dependencyPolicy.packageManager.checkInstalledVersion` | 默认 true；Doctor 与正式非 Hook 检查核对实际包管理器版本 |
| `repository.dependencyPolicy.lockfile.path` | 默认随 name 分别为 package-lock.json、pnpm-lock.yaml、yarn.lock；npm-shrinkwrap.json 可显式指定 |
| `repository.dependencyPolicy.lockfile.checkManifestSync` | 默认 true；比较当前应用直接依赖声明与锁定记录 |
| `repository.dependencyPolicy.lockfile.checkConflictingLockfiles` | 默认 true；同一安装根存在其他未选中锁文件时报告，不全仓禁止独立项目各自维护锁文件 |
| `repository.dependencyPolicy.toolReadiness.enabled` | 默认 true；核对已启用工具的安装与配置条件 |
| `repository.dependencyPolicy.toolReadiness.requireDeclaredDependencies` | 默认 true；工具在当前应用或明确所属工作区根直接声明 |
| `repository.dependencyPolicy.toolReadiness.checkToolVersions` | 默认 true；实际工具版本满足已登记适配器范围，未登记范围不伪称已验证兼容 |
| `repository.dependencyPolicy.toolReadiness.checkNodeEngines` | 默认 true；核对项目及所检查工具明确声明的 Node engines |
| `repository.dependencyPolicy.toolReadiness.checkPeerDependencies` | 默认 true；核对所检查工具 peer 的实际可解析版本，可选 peer 缺失不误报 |
| `repository.dependencyPolicy.toolReadiness.checkConfigLoading` | 默认 true；子进程加载当前范围内 ESLint、Prettier、Stylelint、类型配置，30 秒超时，不写源码 |
| `repository.dependencyPolicy.toolReadiness.checkRequiredScripts` | 默认 true；按配置使用脚本的构建与类型检查必须有对应脚本 |
| `repository.dependencyPolicy.bannedPackages` | 默认空数组；只审计明确登记的普通直接依赖，不推断业务用途 |
| `repository.dependencyPolicy.bannedPackages[].name` | 精确包名 |
| `repository.dependencyPolicy.bannedPackages[].reason` | 至少 10 个字符的审核原因 |
| `repository.dependencyPolicy.bannedPackages[].replacement` | 可省略、null 或替代包名，不自动替换 |
<!-- config-fields:end -->

## 准确性与范围

精确版本使用 npm-package-arg 与严格 SemVer 校验：接受合法完整版本、预发布及构建元数据；拒绝前导零、v 前缀、等号前缀、范围、不完整版本和标签。别名、workspace、catalog、patch、file、link、Git、URL 和本地路径引用均跳过声明、禁用包、重复声明及对应锁记录检查；不影响同一清单内普通依赖的检查。禁用包只匹配直接声明，不扫描完整传递依赖树。

npm 支持锁格式 2/3，核对应用根条目和实际直接依赖版本记录；pnpm 支持锁格式 6/9，核对 importer、specifier 和 packages；Yarn Classic 使用原生解析器，现代 Yarn 核对结构化 YAML 描述符和版本。现代元数据格式支持 4–10；未知格式、解析失败、缺少结构明确报错。Yarn 检查不证明删除依赖后所有历史锁条目都已清除。

多版本传递依赖可以并存。锁文件文本核对不验证下载内容，也不证明安装成功。npm ci、pnpm install --frozen-lockfile、Yarn Classic install --frozen-lockfile、现代 Yarn install --immutable 的真实结果才是对应环境的安装证据。

工作区本身可以包含多个应用，但应用之间的特殊依赖引用不参与依赖策略检查。共享安装根必须在原生工作区配置中明确包含当前应用；多应用需在 sharedPaths 登记共享清单、锁文件及包管理器配置的受影响应用，保证仅共享文件变更时也调度这些应用。

Yarn PnP 不要求 node_modules，应通过项目 Yarn 环境启动 repo-guard，使原生 PnP API 和虚拟文件系统生效。用户工具配置继续优先，不降阈值、不删检查、不自动卸载工具。没有目标文件或全部目标被忽略时不能声称配置就绪。

## 执行

```bash
npx repo-guard dependencies
pnpm exec repo-guard dependencies
yarn exec repo-guard dependencies
```

pre-commit 只检查最终 Git 索引，不调用包管理器、不安装、不加载工作区可执行配置。Doctor 检查当前磁盘事实及工具就绪；manual、CI 与交付复核 在静态策略通过后执行就绪检查。实际代码规则、测试、覆盖率、变异测试和构建仍由各自门禁执行。

托管 GitLab 工程模板按配置和原生版本声明生成准确版本的包管理器准备与冻结安装。自定义 CI、独立运维配置仍由自身入口管理，不因启用依赖策略自动部署。自动接入 Skill 暂不实现，需求见[Skill 待办](skill-integration-backlog.md)。

[策略实现](../../src/gates/repository/dependency-policy.js) · [锁文件适配](../../src/integrations/dependencies/lockfile.js) · [就绪检查](../../src/gates/repository/dependency-tool-readiness.js) · [边界测试](../../test/integrations/dependency-managers.test.js) · [真实联调](../../test/integrations/dependency-manager-real.test.js)

托管 GitLab 质量 CI 仅支持所选包管理器的默认锁文件路径；配置自定义路径时，静态核对仍读取配置文件，但托管 CI 生成会明确拒绝，需由项目配置并验证原生安装流程。

工具版本核对同时验证能力要求范围及项目声明范围；已安装版本即使满足预设范围，也不能与项目声明的精确版本不符。关闭构建后，包体积分析的残留子配置不会要求安装分析工具。

## 特殊引用跳过边界

`workspace:`、npm 别名、本地路径及其他特殊引用不参与普通依赖的声明、禁用包、重复声明、锁记录和工具依赖元数据校验，不报“不支持”，也不计为已检查。遇到特殊引用只跳过对应依赖，继续检查同一清单中的普通依赖；普通声明不能被锁文件中同名特殊引用掩盖。

包管理器声明、锁文件存在性和格式等项目级检查仍按配置执行。已开启工具的配置加载和实际工程检查、原生冻结安装仍由对应工具执行；跳过引用检查不等于跳过这些独立能力。

工具就绪按实际执行方式收集依赖：ESLint 使用内联 options 或 preset 时都登记推荐规则及对应语言插件，Node 预设不要求 Vue 插件。配置加载覆盖 .mts/.cts；checkRequiredScripts 同时验证 typeCheck（脚本模式）、build 和 unitTest 的精确脚本名。Windows 入口先统一真实路径，避免 8.3 短路径与 Git 长路径误判。

Prettier 配置加载目标遵循项目 pattern，不额外按固定扩展名过滤 YAML、样式或插件格式。配置就绪仅确认配置可加载，实际格式解析由 Prettier 检查验证。
