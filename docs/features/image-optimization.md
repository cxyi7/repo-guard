# 图片安全优化与 WebP 转换

[返回使用说明](../usage-guide.md) · [功能索引](README.md)

在明确指定的图片上预估压缩收益，并在显式写入时保留可检查的 Git 差异。资源检查本身不会自动覆盖图片。

## 准备与运行

先按[图片资源质量](image-assets.md)启用 `imageAssets` 及压缩配置，准备项目自己的 Sharp；SVG 优化使用项目 SVGO。预览和写入分开：

```bash
npx repo-guard image-optimize -- src/assets/banner.png
npx repo-guard image-optimize --write -- src/assets/banner.png
```

开启 `imageAssets.compression.conversion.enabled` 后可生成 WebP：

```bash
npx repo-guard image-optimize --to webp -- src/assets/banner.png
npx repo-guard image-optimize --to webp --write -- src/assets/banner.png
```

## 写入条件

| 条件 | 要求 |
|---|---|
| 路径 | 必须在仓库与配置范围内，不得经过符号链接 |
| 源文件 | 写入前必须受 Git 跟踪且没有暂存或未暂存改动 |
| 内容 | 扩展名与真实格式一致，并满足输入、像素和帧数限制 |
| 收益 | 同时满足配置的输入大小、节省字节及节省比例阈值 |
| 有损操作 | 相应策略允许有损，写入时还需 `--allow-lossy` |
| SVG 写入 | 额外要求 `compression.svg.allowWrite: true` |
| WebP 输出 | 新目标文件必须不存在；保留原图与全部引用 |

## 验证与失败处理

未达到收益阈值会说明原因并保留原文件。工具、路径、脏文件或格式问题需先修复；不要为覆盖未提交内容而绕过保护。原格式压缩使用安全替换，WebP 生成新文件。

写入后检查视觉质量、透明度、尺寸和浏览器/平台兼容性，再人工切换引用。确认无引用后才决定是否删除原图，重新运行资源检查并提交相关差异。该命令是显式维护入口，不进入自动 Hook 写入流程。

## 维护依据

[实现入口](../../src/gates/repository/image-assets-optimizer.js) · [对应测试](../../test/image-assets.test.js)
