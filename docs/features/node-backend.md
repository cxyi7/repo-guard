# Node 后端规范与接入边界

支持显式 node-javascript、node-typescript 两种 Node 后端身份。应用根配置声明 role=backend、stack=node；使用项目本身的依赖、原生配置、脚本与目录。安装了 Vue 等依赖不会改变项目身份。

| 规范 | 新建默认 | 执行与边界 |
|---|---|---|
| ESLint | 开 | 推荐规则及维护规则；TS 身份加载 typescript-eslint。Node globals、模块模式等由原生配置提供，不加载 Vue 插件。 |
| Prettier | 开 | 消费项目原生格式配置优先。 |
| 源码安全 | 开 | 默认仅动态代码分类；浏览器 DOM、窗口和模板分类关闭。 |
| 文件规模 | 开 | JS/MJS/CJS/TS/MTS/CTS 默认 1000 行。 |
| 测试文件归位 | 开 | 允许 test、tests、__tests__ 及 src 内测试文件，用户可修改。 |
| 依赖策略 | 开 | 普通依赖版本、锁文件、npm/pnpm/Yarn 和工具就绪；特殊引用跳过对应检查。 |
| 类型检查、构建 | 构建开；类型检查仅 TS 开 | 使用后端自己的 tsc 或精确脚本；不自动导入 Vite 构建选项。 |
| 单元测试、覆盖率、变异测试 | 开 | Vitest/Stryker 和实际项目测试配置；后端源码范围默认 src 全部 JS/TS，而不是前端公共方法目录。 |
| 架构、Knip、路径命名、文件头、函数文档 | 开 | 按实际后端目录与原生工具配置接入；不套用前端业务分层目录。 |
| 普通 Stylelint、图片、代码位置 | 关，可按需开启 | 按实际需要配置。普通 Stylelint 不开启 Vue 治理或 UI Tokens；代码位置是精确代码文本的位置约束，必须提供具体规则。 |

Lighthouse、Vue 异步资源清理、样式隔离治理和 UI Tokens 不用于 Node 后端。提交规范、交付合同、CI、通知和保护文件是仓库公共能力。

## 必须准备

ESLint 预设需要 eslint、@eslint/js；TS 项目另需 typescript-eslint、typescript。Node 使用原生 eslint.config 文件明确环境；Prettier 使用实际原生配置。可选类型检查应明确 tsc 及 tsconfig，或配置真实类型脚本。构建和单元测试需存在配置指定的精确脚本，不能把工具安装完成当成业务测试完成。

repo-guard 不提供 Express/Koa/NestJS 的完整专项业务规则，不自动判断鉴权、事务、参数约束或业务异常处理正确性。类型检查不进入 pre-commit；前端预设不是后端默认预设。

## 验证依据

[独立 Node 消费测试](../../test/integrations/node-backend-audit.test.js)在系统临时目录创建独立 Git 仓库，链接明确选择的真实工具，没有 Vue 安装。覆盖 JS/TS ESLint、Prettier、tsc、构建产物执行、Vitest、dependency-cruiser、Knip 以及工具就绪。使用自定义 server 目录，不假设源码必须叫 utils。

Vitest 专项使用 test/.tmp/node-audit-tools 中的真实 Vitest 4.0.18；常规环境没有该工具会明确跳过，不冒充验证。本轮审查已安装并真实运行，未改变仓库正式依赖。安装忽略生命周期脚本、不执行漏洞上传。

[前端与 Node 审查记录](../reviews/frontend-node-audit-7.1.3.md)列出复现与修复。

7.1.4 仅调整新建 Node 配置的开关，不改已有配置和通用补缺值，也不更改现有阈值。类型检查、构建、测试脚本与原生工具配置仍需接入准备；默认开启不是已经完成检查。源码路径可由用户修改，不强制叫 utils。
