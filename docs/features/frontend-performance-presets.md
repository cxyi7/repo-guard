# 前端构建与性能预设

[功能索引](README.md) · [Skill 接入待办清单](skill-integration-backlog.md)

前端 Node 项目首次创建配置默认开启生产构建、产物预算、包体积分析和 Lighthouse。全部预设持久化在 `repo-guard.config.json`，用户可修改；已有配置只补缺，原值优先。读取既有配置不会暗中新增开关。

Lighthouse 的 URL/pages 初始为空，目前需由接入者根据实际业务补全，默认开启不表示接入已完成。当前自动插件适配 Vite/Rollup，页面性能适配 Vue。

## 初始值

| 功能 | 默认值 |
|---|---|
| 构建 | build 脚本，超时 300000ms |
| JS / CSS 压缩 | 开启 |
| CSS 拆分 | 开启 |
| source map | 关闭，部署产物默认禁止携带 |
| 小资源内联上限 | 4096 字节 |
| 产物预算 | 严格模式，超标阻断 |
| 总原始体积 | 8 MiB |
| 静态首屏 JS / CSS Brotli | 350 KiB / 100 KiB |
| 单 JS 分块 / 单资源 | 600 KiB / 2 MiB |
| 分块数量 | 不设通用上限 |
| 包体积分析 | HTML + JSON，treemap，gzip + Brotli，不弹出浏览器 |
| Lighthouse | 三次采集中位数，桌面环境，仅性能分类 |
| 页面阈值 | 90 分、FCP 1800ms、LCP 2500ms、TBT 200ms、CLS 0.1 |
| 页面检查阶段 | 手动、CI full、release-ready；prePush 默认 false |

这些是可修改的初始工程目标，不保证适合所有业务。AI 不得为通过检查自行降低阈值。

<!-- config-fields:start -->
| 字段 | 用途与可填值 |
|---|---|
| `checks.build.options.minify` | true/false/esbuild/terser；terser 需相应依赖 |
| `checks.build.options.cssMinify` | true/false/esbuild/lightningcss |
| `checks.build.options.cssCodeSplit` | 布尔值，默认 true |
| `checks.build.options.sourcemap` | true/false/inline/hidden；需同时满足预算策略 |
| `checks.build.options.assetsInlineLimit` | 非负整数字节，默认 4096 |
| `checks.build.bundleAnalysis` | 见包体积分析文档 |
| `checks.lighthouse.options` | 内联 LHCI collect/assert，原生配置优先 |
| `checks.lighthouse.pages` | 每项提供 url、expectedUrl、selector |
| `checks.lighthouse.prePush` | 是否在推送前运行，前端默认 false |
<!-- config-fields:end -->

## 接入与配置优先级

后续 Skill 需要读取实际脚本、目录、路由、公共方法范围和已有配置，使用包导出的 `createProjectDocument`、`normalizeProjectDocument`、`getFrontendToolRequirements` 及 Schema。核对 engines/peerDependencies 后安装兼容的精确 devDependency，复用项目锁文件及包管理器。

在现有 Vite 配置中导入 `@cxyi7/repo-guard/vite` 的 `createFrontendBuildPlugins`，将 `await createFrontendBuildPlugins({ root: 实际应用根目录 })` 追加到 plugins，保留原有配置函数与插件。独立配置文件位置通过 configFile 传入。构建默认选项只补缺，原生 build 和 environments.client.build 明确值优先。初始化不自动改写 Vite 文件。

Lighthouse 原生配置与内联配置对象递归合并，数组整项替换，原生优先。项目路径、URL、登录方式和 Chrome 环境需由接入者写入，自动配置列入后续 Skill 待办，npm 日常执行不重新猜测。

## 阶段衔接

构建通过产物预算和模块报告验证后，登记本轮标识及输入/产物指纹。Lighthouse 只复用同一进程中指纹一致的已通过构建，单独执行会真实构建；代码或产物中途变化必须重跑。Git 可见源码、配置、锁文件进入输入指纹，生成报告与输出目录排除。

指纹不能证明外部服务器发布了同一版本；接入者必须启动服务本轮产物目录的生产预览。检查不自动开启部署或代替合同验收。预提交不执行构建或浏览器，报告不隐式上传。

完整初始配置由程序生成如下；路由为空是待接入状态。

```json
{
  "checks": {
    "build": {
      "enabled": true,
      "script": "build",
      "timeoutMs": 300000,
      "options": {
        "minify": true,
        "cssMinify": true,
        "cssCodeSplit": true,
        "sourcemap": false,
        "assetsInlineLimit": 4096
      },
      "artifactBudget": {
        "enabled": true,
        "platform": "pc",
        "outputDirectory": "dist",
        "cleanScript": null,
        "action": "error",
        "mode": "strict",
        "pc": {
          "analyzer": "viteManifest",
          "manifest": ".vite/manifest.json",
          "sourceMaps": "forbid",
          "compression": [
            "raw",
            "gzip",
            "brotli"
          ],
          "limits": {
            "totalRawBytes": 8388608,
            "initialJsBrotliBytes": 358400,
            "initialCssBrotliBytes": 102400,
            "maxChunkRawBytes": 614400,
            "maxChunkCount": null,
            "maxAssetRawBytes": 2097152
          }
        }
      },
      "bundleAnalysis": {
        "enabled": true,
        "adapter": "rollup-visualizer",
        "reportsDirectory": "reports/bundle",
        "formats": [
          "html",
          "json"
        ],
        "template": "treemap",
        "gzipSize": true,
        "brotliSize": true,
        "open": false
      }
    },
    "lighthouse": {
      "enabled": true,
      "prePush": false,
      "configFile": null,
      "buildScript": "build",
      "timeoutMs": 600000,
      "pages": [],
      "options": {
        "ci": {
          "collect": {
            "url": [],
            "numberOfRuns": 3,
            "settings": {
              "preset": "desktop",
              "onlyCategories": [
                "performance"
              ]
            }
          },
          "assert": {
            "assertions": {
              "categories:performance": [
                "error",
                {
                  "minScore": 0.9,
                  "aggregationMethod": "median"
                }
              ],
              "first-contentful-paint": [
                "error",
                {
                  "maxNumericValue": 1800,
                  "aggregationMethod": "median"
                }
              ],
              "largest-contentful-paint": [
                "error",
                {
                  "maxNumericValue": 2500,
                  "aggregationMethod": "median"
                }
              ],
              "total-blocking-time": [
                "error",
                {
                  "maxNumericValue": 200,
                  "aggregationMethod": "median"
                }
              ],
              "cumulative-layout-shift": [
                "error",
                {
                  "maxNumericValue": 0.1,
                  "aggregationMethod": "median"
                }
              ]
            }
          }
        }
      }
    }
  }
}
```

托管 AGENTS.md 保留同次构建与真实验证约束，不引用尚未实现的接入 Skill。后续需要自动化的工作及验收要求统一登记在 [Skill 接入待办清单](skill-integration-backlog.md)。
