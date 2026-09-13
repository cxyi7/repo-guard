import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { configurationError } from '../../core/error/repo-guard-error.js';

/** 复用消费项目 LHCI 所使用的 Lighthouse 配置解析器，不猜测版本相关的设备默认值。 */
export async function lighthouseBrowserSettings(root, settings = {}) {
  const screen = settings.screenEmulation;
  if (screen && ['width', 'height', 'deviceScaleFactor'].every((key) => Number.isFinite(screen[key]))
    && typeof screen.mobile === 'boolean' && settings.emulatedUserAgent !== undefined && !settings.configPath) return settings;
  try {
    const fromProject = createRequire(path.join(root, 'package.json'));
    const fromCli = createRequire(fromProject.resolve('@lhci/cli/package.json'));
    const load = async (file) => import(pathToFileURL(fromCli.resolve(`lighthouse/core/config/${file}.js`)).href);
    const { initializeConfig } = await load('config');
    const configPath = settings.configPath ? path.resolve(root, settings.configPath) : undefined;
    const native = configPath ? (await import(pathToFileURL(configPath).href)).default
      : settings.preset === 'desktop' ? (await load('desktop-config')).default : undefined;
    if (settings.preset && !['desktop', 'perf', 'experimental'].includes(settings.preset)) throw configurationError('lighthouse/browser-preset', '图片观察不支持该 Lighthouse preset，请使用明确的视口与用户代理配置。');
    const { resolvedConfig } = await initializeConfig('navigation', native, { ...settings, ...(configPath ? { configPath } : {}) });
    return resolvedConfig.settings;
  } catch (error) {
    throw configurationError('lighthouse/browser-settings', '无法解析消费项目 Lighthouse 的浏览器配置，请核对其版本或显式配置完整 screenEmulation 和 emulatedUserAgent。', { cause: error });
  }
}

export async function applyLighthouseBrowserSettings(page, settings) {
  const screen = settings.screenEmulation;
  if (screen?.disabled) await page.setViewport(null);
  else if (screen) await page.setViewport({ width: screen.width, height: screen.height,
    deviceScaleFactor: screen.deviceScaleFactor, isMobile: screen.mobile, hasTouch: screen.mobile });
  if (typeof settings.emulatedUserAgent === 'string') await page.setUserAgent(settings.emulatedUserAgent);
}
