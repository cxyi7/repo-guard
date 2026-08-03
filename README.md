# @cxyi7/repo-guard

面向团队 Git 仓库的本地提交门禁，提供暂存文件 ESLint 自动修复、Prettier
格式化、公共文件保护、企业微信备案和提交信息文件清单。

## 安装

```bash
npm install --save-dev --save-exact @cxyi7/repo-guard@0.4.0
npx repo-guard init
```

`init` 会：

1. 生成四个受管理的 Git Hook；
2. 设置当前仓库的 `core.hooksPath=.githooks`；
3. 增量维护 `.gitattributes` 和 `.gitignore`；
4. 创建本地且被忽略的 `.env.config`；
5. 在配置不存在时生成 `repo-guard.config.json`；
6. 补充 `guard:init`、`guard:doctor`、`guard:check` 和 `guard:dry-run`；
7. 在项目没有 `prepare` 脚本时添加 `repo-guard install-hooks`。

已有的非托管 Hook 不会被覆盖。重复执行 `init` 不会生成重复配置。

## 提交顺序

```text
git commit
  → lint-staged 隔离本次暂存内容
  → ESLint 检查和自动修复
  → Prettier 检查或格式化
  → ESLint 最终只读复检
  → 质量结果写回暂存区并恢复未暂存内容
  → 保护文件识别、指纹和企业微信通知
  → 提交信息文件清单
```

ESLint 或 Prettier 失败时，`lint-staged` 恢复执行前状态并阻止提交。保护文件
门禁始终在代码质量门禁成功之后运行，因此通知和指纹对应最终暂存内容。

本工具不执行 `tsc`、`vue-tsc` 或其他 TypeScript 类型检查。`.ts`、`.tsx`
文件只会在项目 ESLint 配置支持时接受普通 ESLint 检查。

## 项目配置

规则和代码质量配置都保存在项目根目录的 `repo-guard.config.json`：

```json
{
  "$schema": "./node_modules/@cxyi7/repo-guard/config.schema.json",
  "version": 1,
  "preCommit": {
    "prettier": {
      "enabled": true,
      "pattern": "*.{js,jsx,mjs,cjs,ts,tsx,vue,json,json5,jsonc,css,scss,less,html,md,mdx,yml,yaml}",
      "fix": true,
      "requireConfig": true
    },
    "eslint": {
      "enabled": true,
      "pattern": "*.{js,jsx,ts,tsx,vue}",
      "fix": true,
      "maxWarnings": 0
    }
  },
  "rules": [
    {
      "pattern": "src/components/**",
      "category": "公共组件",
      "level": "notify"
    }
  ],
  "exclusions": []
}
```

### ESLint 配置

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | `false` | 是否启用暂存文件 ESLint 门禁 |
| `pattern` | `*.{js,jsx,ts,tsx,vue}` | `lint-staged` 文件匹配规则 |
| `fix` | `true` | 是否应用 ESLint 自动修复 |
| `maxWarnings` | `0` | 提交允许的最大警告数 |

ESLint 必须由业务项目自行安装和配置。repo-guard 使用项目本地的 ESLint，
不会强制替换项目的 ESLint 版本、插件或规则。项目 ESLint 配置中忽略的文件
不会阻止提交。

不要把全项目 `npm run lint:fix` 配置成 Hook 命令。repo-guard 只对暂存文件
执行修复，避免把同一文件中的未暂存内容或其他任务改动带入提交。

### Prettier 配置

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enabled` | `false` | 是否启用暂存文件 Prettier 门禁 |
| `pattern` | 常见代码、样式、数据和文档扩展名 | 需要格式化的暂存文件 |
| `fix` | `true` | 自动格式化；设为 `false` 时只检查并阻止不合规提交 |
| `requireConfig` | `true` | 是否要求匹配文件必须找到项目 Prettier 配置 |

Prettier 必须由业务项目安装为开发依赖，支持 `>=3 <4`。repo-guard 加载业务项目
本地的 Prettier，并使用项目已有的 `.prettierrc`、`prettier.config.*` 或
`package.json#prettier` 规则。`.gitignore` 和 `.prettierignore` 中的文件不会被
格式化。

建议在 ESLint 配置的 `extends` 最后添加 `prettier`，通过
`eslint-config-prettier` 关闭相互冲突的格式规则。无需启用
`eslint-plugin-prettier`，格式化由独立的 Prettier 门禁负责。

### 保护文件规则

- `notify`：企业微信通知成功后允许提交。
- `audit`：计入检查和提交清单，但不发送通知。
- `*` 不跨目录，`**` 可以跨任意目录。
- 第一条命中的规则生效，`exclusions` 优先于规则。

## 通知配置

`init` 创建不会被提交的 `.env.config`：

```dotenv
REPO_GUARD_WECOM_WEBHOOK=
REPO_GUARD_MENTION_MOBILES=
```

系统同名环境变量优先于文件值。`.env.config` 被普通 Git 操作忽略；即使使用
`git add -f` 强制暂存，提交门禁也会阻止泄漏。

## 常用命令

```bash
repo-guard init
repo-guard install-hooks
repo-guard doctor
repo-guard check
repo-guard dry-run
repo-guard gate --dry-run
```

`doctor` 会检查 Node.js、配置、Hook 版本、项目 ESLint、项目 Prettier 配置和
通知设置。

## 从 0.3.0 升级

1. 安装 `@cxyi7/repo-guard@0.4.0` 和项目级 `prettier@^3`；
2. 在项目配置中显式加入 `preCommit.prettier`；
3. 准备项目 Prettier 配置和 `.prettierignore`；
4. 运行 `npx repo-guard doctor`。

0.4.0 继续使用 v2 托管 Hook，不需要重新生成 Hook；旧项目未配置
`preCommit.prettier` 时保持禁用，行为与 0.3.0 一致。
