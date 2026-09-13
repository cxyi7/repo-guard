# 包体积分析

[功能索引](README.md) · [前端性能预设](frontend-performance-presets.md)

使用消费项目 `rollup-plugin-visualizer`（>=6 <8），通过 `@cxyi7/repo-guard/vite` 在同次生产构建输出 HTML 模块图、原始 JSON、模块清单及中文摘要。附属于 build，不重复构建。

<!-- config-fields:start -->
| 字段 | 初始值与约束 |
|---|---|
| `checks.build.bundleAnalysis.enabled` | 前端初始化 true；普通补缺 false |
| `checks.build.bundleAnalysis.adapter` | rollup-visualizer，当前唯一适配器 |
| `checks.build.bundleAnalysis.reportsDirectory` | reports/bundle；reports/ 下明确目录，不与部署产物重叠 |
| `checks.build.bundleAnalysis.formats` | html、json；不可重复，必须包含 json |
| `checks.build.bundleAnalysis.template` | treemap；也可 network/sunburst |
| `checks.build.bundleAnalysis.gzipSize` | true，计算模块 gzip 体积 |
| `checks.build.bundleAnalysis.brotliSize` | true，计算模块 Brotli 体积 |
| `checks.build.bundleAnalysis.open` | false；用户可手动打开 HTML |
<!-- config-fields:end -->

生成 bundle.html、bundle.json、modules.json、summary.json。摘要包含主要依赖、最大模块、重复模块和入口/动态分块，提供与上次同配置主要依赖的体积比较。首次或配置不同明确不比较；差异只供诊断，不自动创建豁免基线。

报告须非空且绑定本次构建。路径拒绝源码、越界、符号链接和 Git 跟踪文件。只在 build 清理托管报告文件，生产 preview 不清空报告。关闭检查不卸载依赖或删除用户配置。

模块渲染体积不同于实际压缩产物大小，是否超预算以产物预算为准。静态首屏不包含懒加载页面的全部资源，结合 Lighthouse 的 network-requests 明细分析真实加载量。当前不自动适配 webpack，也不替用户划分 manualChunks。
