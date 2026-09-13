/* global document, getComputedStyle, innerHeight, devicePixelRatio */
/** 在真实页面读取渲染后的图片；自定义组件通过 DOM 选择器和属性映射。 */
export async function observePageImages(page, options) {
  return page.evaluate((settings) => {
    const entries = [];
    const seen = new Set();
    const mappings = [...settings.components, { selector: 'img', sourceAttribute: 'src' }];
    for (const mapping of mappings) {
      for (const element of document.querySelectorAll(mapping.selector)) {
        if (seen.has(element)) continue;
        const box = element.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        const style = getComputedStyle(element);
        const source = mapping.sourceAttribute === 'src' ? element.currentSrc || element.getAttribute('src') : element.getAttribute(mapping.sourceAttribute);
        if (!source) continue;
        seen.add(element);
        const aboveFold = box.bottom > 0 && box.top < innerHeight;
        const lazy = element.getAttribute(mapping.loadingAttribute || 'loading') === 'lazy';
        const issues = [];
        if (!element.hasAttribute('width') && !element.hasAttribute('height') && style.aspectRatio === 'auto') issues.push('layout-space-review');
        if (aboveFold && lazy) issues.push('above-fold-lazy');
        if (!aboveFold && !lazy) issues.push('below-fold-eager');
        if (element.naturalWidth > box.width * devicePixelRatio * settings.maxDimensionRatio) issues.push('oversized-image');
        const requestedSource = element.currentSrc || element.getAttribute('src') || element.getAttribute('srcset');
        if (settings.failedRequests !== false && element.tagName === 'IMG' && requestedSource && element.complete && element.naturalWidth === 0) issues.push('broken-image');
        if (element.getAttribute('fetchpriority') === 'high') issues.push('high-priority');
        entries.push({ selector: mapping.selector, issues, width: box.width, height: box.height });
      }
    }
    return entries;
  }, options);
}

/** 布局与加载策略只作建议；页面状态不足以证明覆盖所有业务分支。 */
export function observationFindings(entries, options = {}) {
  const messages = {
    'layout-space-review': '图片没有声明宽高或比例，请人工核对容器是否已预留布局空间',
    'above-fold-lazy': '首屏图片使用懒加载，请确认是否为关键图片',
    'below-fold-eager': '屏外图片未使用原生懒加载，请核对组件是否已有加载策略',
    'oversized-image': '图片固有宽度明显超过当前展示宽度与设备像素比需求',
    'broken-image': '页面中图片已完成加载但没有有效像素，请检查资源地址',
  };
  const findings = entries.flatMap((entry) => entry.issues.filter((issue) => messages[issue]).map((issue) => ({
    rule: 'lighthouse/image-usage', issue: `lighthouse/${issue}`, severity: issue === 'broken-image' && options.action === 'error' ? 'error' : 'warning',
    message: messages[issue], remediation: `核对页面中 ${entry.selector} 元素的实际用途和加载结果。`,
  })));
  if (entries.filter((entry) => entry.issues.includes('high-priority')).length > 1) findings.push({ rule: 'lighthouse/image-usage', issue: 'lighthouse/image-priority', severity: 'warning', message: '多张图片被设置为高加载优先级，请只为关键资源保留此设置', remediation: '结合页面关键图片与网络瀑布图调整优先级。' });
  return findings;
}
