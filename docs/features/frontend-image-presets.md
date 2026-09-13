# 前端图片治理预设

前端 Node 项目初始化与启用对应能力时写入可编辑的预设。已有项目不会在读取配置时自动开启新规则；再次启用时递归补缺，用户显式值和数组优先。所有路径均相对所选应用，用户可替换资源目录、源码范围、用途规则、别名及页面地址。

## 默认行为

- `checks.imageAssets` 开启，`enforcement: "allFiles"`；命名为 kebab-case，小写扩展名，允许 @2x/@3x。
- 精确重复阻断；像素重复、压缩、WebP 转换机会只报告。Hook/CI 只读，不自动删除或改图。
- `checks.unusedImageAssets` 开启、`action: "report"`、`referenceIntegrity: true`。根目录 `styles` 纳入源码引用扫描。
- 通用配置补缺的图片命名仍为 camelCase，保留非前端项目行为；前端预设明确写入 kebab-case，并须与路径命名一致。
- 默认读取上限 25 MiB、解码上限 4000 万像素，前端允许最多 1000 帧用于受限分析；这些不是性能预算。动画超限必须调整资源或明确配置，不能丢弃帧。
- 新增分析复用消费项目 Sharp/SVGO；包不代替项目安装依赖，也不生成自动接入 Skill。

## 文件预算与格式

`checks.imageAssets.governance` 下的字段如下。各组有独立 `enabled` 与 `action`（report/error），AVIF 默认关闭，其余默认开启并报告。

| 分组 | 字段及默认值 | 含义 |
|---|---|---|
| budgets | maxBytes=1048576、maxWidth=4096、maxHeight=4096 | 未分类资源体积与位图单帧尺寸预算 |
| budgets.rules | name、patterns、可选 maxBytes/maxWidth/maxHeight | 第一个匹配规则覆盖兜底预算；数组由用户整体替换 |
| formats | discouraged=[bmp,tif,tiff] | 不推荐格式只报告，不排除扫描 |
| metadata | enabled=true、action=report | 检查 EXIF/IPTC/XMP 是否存在，不输出其中的隐私内容 |
| animation | maxBytes=1048576、maxFrames=200、maxDurationMs=30000 | 动画体积、帧数和单轮时长预算，不包含无限循环总时长 |
| avif | quality=60、effort=4、minSavingsBytes=4096、minSavingsPercent=20 | 静态 PNG/JPEG/WebP 的有损 AVIF 候选收益；输入至少 8 KiB，不自动写入 |

前端用途规则初始按 `**/icons/**`、`**/avatars/**`、`**/thumbnails/**`、`**/content/**`、`**/banners/**` 分别设置 20、50、100、300、500 KiB。它们是可替换的路径规则，不是运行时根据名字猜测的图片用途。SVG/ICO/BMP 未通过 Sharp 读取尺寸时只评估文件体积与格式，不能把缺少尺寸当成尺寸已验证。

`checks.imageAssets.compression.raster.metadata` 支持 preserve（默认保留）、strip（全部移除）、display（应用方向并保留 ICC，去除 EXIF/IPTC/XMP）。显式优化才写入，display 要求消费项目 Sharp 支持 keepIccProfile。无损转换仍执行像素一致性验证。

## 动态图片保留依据

```json
{
  "checks": {
    "imageAssets": { "enabled": true, "enforcement": "allFiles" },
    "unusedImageAssets": {
      "enabled": true,
      "action": "report",
      "referenceIntegrity": true,
      "dynamicReferences": [
        {
          "sourcePatterns": ["src/pages/orders.vue"],
          "assetPatterns": ["public/assets/status/*.png"],
          "reason": "订单接口返回状态图片名，页面在该目录拼接图片地址",
          "api": {
            "method": "GET",
            "endpoint": "/api/orders",
            "responseField": "data.items[].statusImage"
          }
        }
      ]
    }
  }
}
```

接口驱动的图片应填写 api；非接口驱动的动态资源可以只填写原因。提供 api 时三个字段缺一不可；endpoint 只接受不含查询参数的接口路径，不保存令牌。声明必须同时匹配真实源码和图片，否则报配置错误。报告逐项列出保留资源、使用位置、接口、字段与原因，明确这是配置声明，未验证真实响应。Vue 中未声明的动态绑定会提示核对；此提示不代表已覆盖所有运行时拼接方式。

引用完整性检查只阻断配置资源范围内可确定的本地引用缺失或大小写不一致；远程地址、普通脚本数据字符串不据此报错。解析到的大小写错误仍记为被引用，避免同一图片同时误报未使用。删除最后一个图片文件后仍检查其失效引用。只报告与跳过都不能当作交付证据。

## 页面图片使用

`checks.lighthouse.imageUsage` 与已有 pages、Chrome、登录初始化和真实构建验证共用流程；不进入 pre-commit，不上传报告。

| 字段 | 默认值 | 说明 |
|---|---|---|
| enabled | true | 前端预设启用 |
| action | report | 网络预算与可用审计结果的处理方式 |
| failedRequests | true | 根据网络记录检查图片加载失败 |
| maxTransferBytes | 1572864 | 本次页面图片总传输预算，默认 1.5 MiB |
| routes | [] | 使用 url、maxTransferBytes 配置页面预算覆盖 |
| maxDimensionRatio | 2 | 固有宽度超过展示宽度 × 设备像素比 × 此比例时提示 |
| components | [] | 渲染后 DOM 的 selector、sourceAttribute、可选 loadingAttribute 映射 |
| auditIds | unsized-images、offscreen-images、uses-responsive-images、modern-image-formats、uses-optimized-images、lcp-lazy-loaded | 可按项目 Lighthouse 支持的审计名称替换 |

浏览器观察报告首屏懒加载、屏外立即加载、尺寸过大、图片加载失败、多张高优先级图片及需人工核对的布局空间。CSS 容器可能已经预留空间，因此 DOM 观察始终作为建议。自定义组件填写其实际 DOM 选择器，不填写 Vue 组件源码名称。Lighthouse 版本缺少某项审计时明确报告“未验证”，不伪造通过结果。

报告写入 `.lighthouseci/repo-guard-summary.json`，包含图片问题与网络资源摘要。只覆盖实际访问页面和当前状态；接口分支和业务全量取值继续由交付合同、测试与人工验收承担。

## 批量优化与静态引用更新

```bash
npx repo-guard image-optimize --to webp --update-references -- src/assets/banner.png
npx repo-guard image-optimize --to webp --update-references --write -- src/assets/banner.png
```

无 `--write` 只输出规划。整批先生成候选、检查收益和输出冲突，再写入；源图片及待改源码必须被 Git 跟踪且无暂存/未暂存修改。失败恢复本批已写内容；回滚遇到外部修改停止覆盖并报执行错误。原图片不会删除。

引用更新只修改可精确定位的静态 import、new URL、模板属性和 CSS url。动态接口引用、普通数据字符串、Markdown/JSON 及无法定位的表达式保留并提示人工核对。有损转换仍需配置 allowLossy 和显式 `--allow-lossy`。重新执行遇到同名输出拒绝覆盖，避免反复转换和追加文件。

## 实现、验证与接入记录

预设在 `src/profiles/frontend-image-presets.js`，配置校验在 `src/config/image-governance-options.js`，文件策略在 `src/policies/image-governance.js`，浏览器观察在 `src/integrations/lighthouse/image-observations.js`。测试见 `test/integrations/frontend-image-governance.test.js` 及图片门禁测试。Skill 所需接入工作只记录在 [Skill 接入待办](skill-integration-backlog.md)，本轮不新增 Skill。

## 审查后的执行边界

引用完整性仅分析完整、可确定的路径表达式；动态拼接中的片段与远程 `new URL()` 基址不作为本地静态引用。问题位置采用真实源码行列；有效人工例外按规则和位置精确匹配。`changedFiles` 的缺失引用也与基线比较，位置或目标变化会重新检查。

关闭全部治理子项不再隐式要求 Sharp；仅 GIF/TIFF 元数据治理也会校验消费项目 Sharp。`jpg`/`tif` 与实际编码 `jpeg`/`tiff` 对应。超出输入大小上限的文件在哈希读取之前阻断。

自定义 DOM 映射优先于默认 `img`。未请求的 `data-src` 图片不当作损坏；`failedRequests=false` 关闭损坏图片检测。真实加载失败在 `action=error` 时阻断；布局、首屏和优先级判断保持建议性质。观察复用 Lighthouse 设备配置，按 LHCI 当前 URL 检查对应业务页面。

必需审计缺失在严格模式报配置错误；审计执行错误、非法分数、图片传输量缺失或非法均报执行错误。只有明确不适用或信息项允许空分数。路由预算使用不含凭据的 HTTP(S) URL，规范化后不允许重复，并要求匹配配置页面。开启图片观察必须配置页面并提供本轮观察证据。

批量优化登记输出后再清理临时文件，清理失败仍回滚；逐项尝试恢复，遇到外部修改保留现场并报告未恢复路径。关闭位图压缩后，显式原格式优化也拒绝执行。详细复现见 [审查记录](../reviews/frontend-image-governance-3.2.0.md)。
