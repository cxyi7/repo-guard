# @cxyi7/repo-guard

`@cxyi7/repo-guard` 是面向 Vue、JavaScript 和 TypeScript 仓库的质量与安全门禁平台。它复用项目已有的 ESLint、Prettier、Stylelint、测试和构建工具，把需求确认、本地开发、Git 提交、推送、GitLab CI、真实反馈和发布准备串成固定、可审计的工程流程。

核心目标是为 AI 辅助开发提供强制、可审计的工程规范：人工负责确认，AI 和开发者负责实现与修复，Git 保存事实，repo-guard 负责阻止不符合约定的变更继续流转。

- 当前版本：`1.23.1`
- Node.js：`>=22.23.2`
- 配置契约：`version: 1`
- 开源协议：MIT

## 生命周期能力分层图

![repo-guard 生命周期能力分层图](docs/images/repo-guard-feature-map.svg)

未启用的能力会明确跳过；`release-ready` 只复核发布条件，不会自动发布 npm 包或部署业务应用。pre-commit 只处理暂存范围并保持固定顺序，通过 `lint-staged` 保留部分暂存内容，并使用仓库级锁阻止重叠提交；TypeScript、测试、架构、构建和 Lighthouse 等重型检查位于 pre-push 或 CI。

## 三步接入

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@1.23.1
npx repo-guard init
npx repo-guard doctor
```

完整安装、配置和命令见[使用说明](docs/usage-guide.md)，项目工作模型与模块职责见[项目结构与能力总览](docs/project-structure-and-feature-inventory.md)，单项能力文档见[功能说明索引](docs/features/README.md)，合同与证据格式见[合同驱动交付格式](docs/contract-driven-delivery.md)。
