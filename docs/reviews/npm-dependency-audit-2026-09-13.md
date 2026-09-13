# npm 官方依赖漏洞审计（2026-09-13）

用户已明确授权向 npm 官方注册表发送依赖树。本次只执行审计与依赖来源核对，没有升级或改写依赖锁文件。

## 结果

`npm audit --registry=https://registry.npmjs.org --json` 成功获取报告，因发现漏洞退出码为 1；这不是命令执行失败。共 4 个受影响包，3 个高危、1 个中危，涉及 7 条公告。以下修复版本来自本次 npm 报告及公告，尚未在项目中安装验证。

| 依赖 | 当前版本 | 评级 | 引入路径 | 修复版本与公告 |
|---|---|---|---|---|
| colord | 2.9.3 | 中危 | stylelint → colord | [2.9.4](https://github.com/advisories/GHSA-2wm5-q62r-hmrv) |
| fast-uri | 3.1.5 | 高危 | ajv → fast-uri | [3.1.6](https://github.com/advisories/GHSA-5jgf-p345-68v8)，另涉及 GHSA-f65p-4m7j-42xc、GHSA-fph4-wmhf-6fwf、GHSA-jqff-g426-hqxp |
| js-yaml | 4.3.1 | 高危 | @eslint/eslintrc / cosmiconfig → js-yaml | [4.3.2](https://github.com/advisories/GHSA-2883-xcg3-v3hh) |
| sharp | 0.35.3 | 高危 | 仓库直接 devDependency | [0.35.4](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) |

四个节点在当前锁文件均标记为开发依赖，在本次依赖治理变更前的暂存锁文件中也已有相同版本，因此不是本轮新增的四个依赖包引入。

`npm audit --omit=dev --registry=https://registry.npmjs.org --json` 返回 0，生产依赖没有检出已知漏洞。开发依赖仍可能在本仓库 CI、检查或测试时处理不可信输入，不能据此称其无风险。消费项目安装的 ESLint、Stylelint、Sharp 等工具属于消费项目自己的依赖树，本报告不替代对它们的审计。

## 修复方向与证明范围

colord、fast-uri、js-yaml 的修复版本落在当前父依赖声明范围内，可针对这些传递依赖更新锁文件；sharp 需将精确开发依赖升级到 0.35.4。更新后需重新审计，并运行对应样式、配置加载、图片处理及工程回归。此次没有执行自动修复。

本次验证的是锁定版本命中公开漏洞数据库，不是应用攻击链复现；没有证明这些公告中的所有攻击条件都能在本项目满足。

原始报告保存于本地 `test/.tmp/dependency-managers-audit.json`，生产依赖报告为 `test/.tmp/dependency-managers-audit-production.json`，引入路径为 `test/.tmp/dependency-audit-paths.json`。临时目录不纳入发布交付。

## 修复结果（2026-09-13）

用户随后授权修复，现已完成以下升级：

| 依赖 | 修复前 | 实际锁定并安装版本 |
|---|---|---|
| colord | 2.9.3 | 2.10.0 |
| fast-uri | 3.1.5 | 3.1.7 |
| js-yaml | 4.3.1 | 4.3.2 |
| sharp | 0.35.3 | 0.35.4 |

三个传递依赖均在已有父依赖声明范围内更新，没有提升为直接依赖或添加 overrides。Sharp 的平台包和 libvips 随其升级同步更新。消费项目自己的工具安装仍由消费项目管理，本次不修改消费项目依赖。

### 验证

- `npm ci --ignore-scripts --registry=https://registry.npmjs.org` 成功；采用冻结安装校验锁文件，关闭安装钩子以保留仓库 Hook 配置。随后真实 Sharp 测试确认平台二进制可用。
- 冻结安装后 `npm audit --registry=https://registry.npmjs.org --json` 返回 0；完整依赖树已无已知漏洞，不是仅省略开发依赖后得到的结果。
- 相关功能回归 84/84 通过，覆盖真实图片解析、转换、回滚及工具配置加载；配置 Schema、统一 Stylelint 回归 13/13 通过。
- 定向烟测通过：RGBA/HSLA 各 128 KiB 的异常颜色输入在本机合计约 2 ms 内拒绝，正常颜色、YAML 合并、URI 解析及原生 Stylelint color-named 规则保持正确行为。
- `npm run check` 通过：ESLint、架构、语法、中文文案检查均通过。
- 未对第三方原生内存漏洞或全部 fast-uri 公告构造攻击样本；它们的修复证据是安装版本、上游修复范围和审计结果，不能表述为已在本项目复现全部攻击链。

结果文件：`test/.tmp/dependency-security-audit-after.json`、`dependency-security-ci.log`、`dependency-security-focused.log`、`dependency-security-schema-style.log`、`dependency-security-smoke.json`、`dependency-security-check.log`。上文“未升级”描述属于初次审计阶段，当前修复状态以本节为准。

### 独立审查

审查确认锁定与安装版本一致、无重复旧包、父依赖范围满足，Sharp 各平台依赖记录完整；Windows 原生 PNG 转 WebP 烟测成功。发现图片检查接入文档仍固定安装 Sharp 0.35.3，已核实并改为 0.35.4，避免指导消费项目重新安装已知漏洞版本。打包检查通过。历史审计表中的旧版本保留用于记录修复前状态。
