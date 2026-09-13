import { pathToFileURL } from 'node:url';
import { executionError } from '../../core/error/repo-guard-error.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { observePageImages } from './image-observations.js';
import { lighthouseBrowserSettings, applyLighthouseBrowserSettings } from './browser-settings.js';

/** 复用 LHCI 浏览器及用户登录状态，验证配置中的业务页面身份。 */
export async function validateLighthousePages(
  browser,
  context,
  { pages, hook, headers, imageUsage, observationsFile, settings, root = process.cwd() },
) {
  if (hook) {
    const module = await import(pathToFileURL(hook).href);
    await module.default(browser, context);
  }
  const selectedPages = context?.url ? pages.filter((page) => new URL(page.url).href === new URL(context.url).href) : pages;
  if (selectedPages.length === 0) throw executionError('lighthouse/unconfigured-page', 'LHCI 请求了未配置的业务页面。');
  const browserSettings = settings ? await lighthouseBrowserSettings(root, settings) : null;
  for (const target of selectedPages) {
    const page = await browser.newPage();
    try {
      if (browserSettings) await applyLighthouseBrowserSettings(page, browserSettings);
      if (headers)
        await page.setExtraHTTPHeaders(
          typeof headers === 'string' ? JSON.parse(headers) : headers,
        );
      const response = await page.goto(target.url, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      if (
        !response ||
        response.status() >= 400 ||
        new URL(page.url()).href !== new URL(target.expectedUrl).href
      ) {
        throw executionError(
          'lighthouse/wrong-page',
          'Lighthouse 页面状态或最终地址不符合配置。',
        );
      }
      await page.waitForSelector(target.selector, {
        visible: true,
        timeout: 30000,
      });
      if (imageUsage?.enabled && observationsFile) {
        const observations = existsSync(observationsFile) ? JSON.parse(readFileSync(observationsFile, 'utf8')) : {};
        observations[new URL(target.url).href] = await observePageImages(page, imageUsage);
        writeFileSync(observationsFile, JSON.stringify(observations));
      }
    } finally {
      await page.close();
    }
  }
}
